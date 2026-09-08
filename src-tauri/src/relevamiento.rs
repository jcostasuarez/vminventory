//! # Relevamiento masivo de máquinas virtuales
//!
//! El descubrimiento y el procesamiento de imágenes pertenecen exclusivamente a
//! la API pública de `vmspect`:
//!
//! 1. `vmspect::list_vms(..., true)` descubre recursivamente las imágenes y
//!    filtra extensiones secundarias.
//! 2. `vmspect::ConcurrentProcessor` coordina la concurrencia y la cancelación.
//! 3. `vmspect::InspectionEngine` realiza cada inspección.
//!
//! Este módulo conserva únicamente la integración de la aplicación: telemetría
//! Tauri, clasificación de software, enriquecimiento de metadatos y persistencia
//! del inventario JSON.

use crate::clasificacion::ReglasClasificacion;
use crate::models::{
    BdRelevamiento, ConfiguracionApp, EstadoSupervision, LogSupervision, MetadatosRelevamiento,
    ProgramaClasificado, RegistroVM, ResumenRelevamiento, VmActiva,
};
use crate::vmspect_backend;
use std::collections::{BTreeMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use vmspect::VmSpectError;

/// Capacidad máxima de la bitácora en vivo (entradas rotativas).
const CAPACIDAD_LOGS: usize = 40;
/// GiB exacto, coherente con `formatearBytes` del frontend (base 1024).
const GIB: f64 = 1024.0 * 1024.0 * 1024.0;

type ResultadoImagen = std::result::Result<vmspect::InspectionReport, VmSpectError>;
type ResultadoTrabajo = (usize, PathBuf, ResultadoImagen);

// ============================================================================
// UTILIDADES DE TIEMPO (UTC, sin dependencias externas)
// ============================================================================

/// Formatea una duración en segundos como `MM:SS` o `H:MM:SS`.
pub fn formatear_duracion(segundos: u64) -> String {
    if segundos >= 3600 {
        format!(
            "{}:{:02}:{:02}",
            segundos / 3600,
            (segundos % 3600) / 60,
            segundos % 60
        )
    } else {
        format!("{:02}:{:02}", segundos / 60, segundos % 60)
    }
}

fn ahora_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Marca temporal `HH:MM:SS` para la bitácora en vivo.
pub fn marca_temporal() -> String {
    let r = ahora_unix() % 86_400;
    format!("{:02}:{:02}:{:02}", r / 3600, (r % 3600) / 60, r % 60)
}

/// Algoritmo de conversión días-época -> fecha civil (Howard Hinnant).
fn dias_a_civil(dias: i64) -> (i64, u32, u32) {
    let z = dias + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// Fecha actual en formato ISO `YYYY-MM-DD`.
pub fn fecha_iso() -> String {
    let secs = ahora_unix();
    let (anios, mes, dia) = dias_a_civil((secs / 86_400) as i64);
    format!("{anios:04}-{mes:02}-{dia:02}")
}

/// Fecha y hora actual en formato ISO `YYYY-MM-DDTHH:MM:SS`.
pub fn fecha_hora_iso() -> String {
    let secs = ahora_unix();
    let r = secs % 86_400;
    let (anios, mes, dia) = dias_a_civil((secs / 86_400) as i64);
    format!(
        "{anios:04}-{mes:02}-{dia:02}T{:02}:{:02}:{:02}",
        r / 3600,
        (r % 3600) / 60,
        r % 60
    )
}

/// Clasifica y filtra los programas detectados por `vmspect`.
/// Con `modo_dump` activo se conserva todo el inventario sin filtrar ruido.
pub(crate) fn clasificar_programas(
    programas: &[vmspect::Program],
    reglas: &ReglasClasificacion,
    modo_dump: bool,
) -> Vec<ProgramaClasificado> {
    programas
        .iter()
        .filter_map(|p| {
            let veredicto = reglas.clasificar(&p.name, p.publisher.as_deref());
            if !veredicto.es_relevante && !modo_dump {
                return None;
            }
            Some(ProgramaClasificado {
                nombre: p.name.clone(),
                version: p.version.clone(),
                editor: p.publisher.clone(),
                categoria: veredicto.categoria,
                tags: veredicto.tags,
                relevante: veredicto.es_relevante,
            })
        })
        .collect()
}

// ============================================================================
// SUPERVISIÓN (telemetría compartida entre trabajadores de vmspect)
// ============================================================================

/// Contadores, bitácora y progreso del relevamiento.
///
/// La inspección no se ejecuta aquí: los trabajadores pertenecen a
/// `vmspect::ConcurrentProcessor`. Esta estructura solo agrega telemetría de la
/// aplicación alrededor de esos trabajadores.
struct Supervision {
    cancelacion: Arc<AtomicBool>,
    total_vms: usize,
    inicio: Instant,
    procesadas: AtomicUsize,
    exitosas: AtomicUsize,
    con_observaciones: AtomicUsize,
    discrepantes: AtomicUsize,
    fallidas: AtomicUsize,
    peso_bytes: AtomicU64,
    activas: Mutex<BTreeMap<usize, VmActiva>>,
    logs: Mutex<VecDeque<LogSupervision>>,
}

impl Supervision {
    fn new(cancelacion: Arc<AtomicBool>) -> Self {
        Self {
            cancelacion,
            total_vms: 0,
            inicio: Instant::now(),
            procesadas: AtomicUsize::new(0),
            exitosas: AtomicUsize::new(0),
            con_observaciones: AtomicUsize::new(0),
            discrepantes: AtomicUsize::new(0),
            fallidas: AtomicUsize::new(0),
            peso_bytes: AtomicU64::new(0),
            activas: Mutex::new(BTreeMap::new()),
            logs: Mutex::new(VecDeque::new()),
        }
    }

    fn cancelada(&self) -> bool {
        self.cancelacion.load(Ordering::Acquire)
    }

    fn registrar_log(&self, nivel: &str, vm: &str, mensaje: String) {
        if let Ok(mut logs) = self.logs.lock() {
            if logs.len() >= CAPACIDAD_LOGS {
                logs.pop_front();
            }
            logs.push_back(LogSupervision {
                timestamp: marca_temporal(),
                nivel: nivel.to_string(),
                vm: vm.to_string(),
                mensaje,
            });
        }
    }

    fn actualizar_activa(
        &self,
        indice: usize,
        nombre: &str,
        etapa: &str,
        porcentaje: u8,
        detalle: Option<String>,
    ) {
        if let Ok(mut activas) = self.activas.lock() {
            activas.insert(
                indice,
                VmActiva {
                    indice,
                    nombre_vm: nombre.to_string(),
                    etapa: etapa.to_string(),
                    porcentaje,
                    detalle,
                },
            );
        }
    }

    fn remover_activa(&self, indice: usize) {
        if let Ok(mut activas) = self.activas.lock() {
            activas.remove(&indice);
        }
    }

    /// Construye el paquete de telemetría consumido por la interfaz.
    fn snapshot(&self, fase: &str, mensaje: String) -> EstadoSupervision {
        let procesadas = self.procesadas.load(Ordering::Relaxed);
        let activas: Vec<VmActiva> = self
            .activas
            .lock()
            .map(|a| a.values().cloned().collect())
            .unwrap_or_default();
        let vm_actual = activas.iter().max_by_key(|v| v.indice).cloned();

        let progreso = match fase {
            "iniciando" => 2.0,
            "escaneando_directorio" => 8.0,
            "generando_reporte" => 93.0,
            "finalizado" | "cancelado" => 100.0,
            "analizando_v_ms" => {
                let avance: f64 = activas.iter().map(|v| v.porcentaje as f64 / 100.0).sum();
                10.0 + 80.0 * ((procesadas as f64 + avance) / self.total_vms.max(1) as f64)
            }
            _ => 0.0,
        }
        .clamp(0.0, 100.0);

        let segundos = self.inicio.elapsed().as_secs();
        let velocidad = if segundos >= 1 {
            procesadas as f64 / segundos as f64 * 60.0
        } else {
            0.0
        };
        let restante =
            if fase == "analizando_v_ms" && velocidad > 0.01 && procesadas < self.total_vms {
                let pendientes = (self.total_vms - procesadas) as f64;
                Some(formatear_duracion(
                    (pendientes / velocidad * 60.0).ceil() as u64
                ))
            } else {
                None
            };

        EstadoSupervision {
            fase: fase.to_string(),
            progreso_global: progreso,
            mensaje_estado: mensaje,
            vms_procesadas: procesadas,
            total_vms: self.total_vms,
            vms_exitosas: self.exitosas.load(Ordering::Relaxed),
            vms_con_observaciones: self.con_observaciones.load(Ordering::Relaxed),
            vms_discrepantes: self.discrepantes.load(Ordering::Relaxed),
            vms_fallidas: self.fallidas.load(Ordering::Relaxed),
            tiempo_transcurrido_formateado: formatear_duracion(segundos),
            tiempo_restante_formateado: restante,
            velocidad_vms_minuto: velocidad,
            vm_actual_indice: vm_actual.as_ref().map(|v| v.indice).unwrap_or(0),
            vm_actual_nombre: vm_actual.as_ref().map(|v| v.nombre_vm.clone()),
            progreso_vm_actual: vm_actual.as_ref().map(|v| v.porcentaje).unwrap_or(0),
            etapa_vm_actual: vm_actual
                .as_ref()
                .map(|v| v.etapa.clone())
                .unwrap_or_default(),
            detalle_vm_actual: vm_actual.as_ref().and_then(|v| v.detalle.clone()),
            vms_activas: activas,
            logs_recientes: self
                .logs
                .lock()
                .map(|l| l.iter().cloned().collect())
                .unwrap_or_default(),
            peso_total_procesado_gb: self.peso_bytes.load(Ordering::Relaxed) as f64 / GIB,
        }
    }

    /// Emite el paquete de telemetría hacia el frontend.
    fn emitir(&self, app: &AppHandle, fase: &str, mensaje: String) {
        let _ = app.emit("progreso_supervision", self.snapshot(fase, mensaje));
    }
}

fn resumen_cancelado() -> ResumenRelevamiento {
    ResumenRelevamiento {
        fase: "cancelado".to_string(),
        total_vms: 0,
        vms_exitosas: 0,
        vms_con_observaciones: 0,
        vms_discrepantes: 0,
        vms_fallidas: 0,
        total_programas: 0,
        peso_total_gb: 0.0,
        duracion_formateada: "0s".to_string(),
        ruta_informe: String::new(),
        cancelado: true,
    }
}

/// Conserva la política de exclusiones de la aplicación sin reemplazar el
/// descubrimiento recursivo de `vmspect`.
fn aplicar_exclusiones_vmspect(
    imagenes: Vec<PathBuf>,
    origen: &Path,
    exclusiones: &crate::clasificacion::ExclusionesConfig,
) -> Vec<PathBuf> {
    imagenes
        .into_iter()
        .filter(|ruta| {
            let nombre_archivo = ruta
                .file_name()
                .and_then(|nombre| nombre.to_str())
                .unwrap_or("");
            if exclusiones.es_archivo_excluido(nombre_archivo) {
                return false;
            }

            let mut directorio = ruta.parent();
            while let Some(actual) = directorio {
                if actual == origen || !actual.starts_with(origen) {
                    break;
                }
                let nombre = actual
                    .file_name()
                    .and_then(|valor| valor.to_str())
                    .unwrap_or("");
                if exclusiones.es_carpeta_excluida(nombre) {
                    return false;
                }
                directorio = actual.parent();
            }
            true
        })
        .collect()
}

// ============================================================================
// PIPELINE PRINCIPAL: descubrimiento y análisis delegados a vmspect
// ============================================================================

/// Ejecuta el relevamiento recursivo de un directorio de VMs.
///
/// La aplicación no implementa una búsqueda de archivos ni un pool de análisis:
/// ambas operaciones se delegan a `vmspect::list_vms` y a
/// `vmspect::ConcurrentProcessor`, respectivamente.
pub fn ejecutar_relevamiento(
    app: &AppHandle,
    cancelacion: Arc<AtomicBool>,
    ruta_origen: &str,
    ruta_destino: &str,
    generar_discrepancias: bool,
    config: &ConfiguracionApp,
) -> Result<ResumenRelevamiento, String> {
    let origen = PathBuf::from(ruta_origen);
    if !origen.is_dir() {
        return Err(format!(
            "El directorio de origen no existe o no es válido: {ruta_origen}"
        ));
    }

    let destino = PathBuf::from(ruta_destino);
    std::fs::create_dir_all(&destino)
        .map_err(|e| format!("No se pudo preparar el directorio destino ({ruta_destino}): {e}"))?;

    let mut supervision = Supervision::new(cancelacion.clone());
    if supervision.cancelada() {
        return Ok(resumen_cancelado());
    }

    supervision.emitir(
        app,
        "iniciando",
        "Preparando el motor vmspect para el relevamiento recursivo...".to_string(),
    );

    let reglas = ReglasClasificacion::cargar(config.ruta_reglas.as_deref());

    supervision.emitir(
        app,
        "escaneando_directorio",
        format!("vmspect está descubriendo recursivamente imágenes en «{ruta_origen}»..."),
    );

    // El descubrimiento recursivo, los formatos soportados y el filtrado de
    // extents secundarios pertenecen a vmspect. Las exclusiones configurables
    // de la app se aplican únicamente sobre las rutas ya descubiertas; no
    // existe un segundo recorrido recursivo propio.
    let descubiertas = match vmspect::list_vms(&origen, true) {
        Ok(lista) => lista,
        Err(error) => {
            let detalle = format!("Fallo el descubrimiento recursivo de vmspect: {error}");
            supervision.emitir(app, "error", detalle.clone());
            return Err(detalle);
        }
    };

    if supervision.cancelada() {
        return Ok(resumen_cancelado());
    }

    let imagenes = aplicar_exclusiones_vmspect(descubiertas, &origen, &reglas.exclusions);
    let total_vms = imagenes.len();
    supervision.total_vms = total_vms;
    supervision.emitir(
        app,
        "escaneando_directorio",
        format!("vmspect detectó {total_vms} imágenes de máquinas virtuales."),
    );

    if total_vms > 0 {
        supervision.registrar_log(
            "info",
            "",
            format!("Relevamiento vmspect iniciado sobre {total_vms} imágenes."),
        );
    }

    if supervision.cancelada() {
        return Ok(resumen_cancelado());
    }

    let opciones = vmspect_backend::construir_opciones(config, &cancelacion);
    let hilos = config.max_hilos.unwrap_or(4).clamp(1, 32);
    let supervision = Arc::new(supervision);
    let supervision_workers = Arc::clone(&supervision);
    let app_handle = app.clone();

    // La concurrencia, la cola de trabajos, el join de trabajadores y la
    // cancelación son responsabilidad de la API pública de vmspect. El valor
    // interno del resultado conserva los errores por imagen para que una VM
    // dañada no descarte el resto del relevamiento.
    let trabajos = imagenes
        .into_iter()
        .enumerate()
        .map(|(indice, ruta)| (indice + 1, ruta))
        .collect::<Vec<_>>();
    let progreso_motor = Arc::new(vmspect::InspectionProgress::new());
    let resultados: Vec<ResultadoTrabajo> = vmspect::ConcurrentProcessor::process_in_parallel(
        trabajos,
        Some(cancelacion.clone()),
        Some(progreso_motor),
        hilos,
        move |(indice, ruta)| {
            let nombre = nombre_vm_desde_ruta(&ruta);
            supervision_workers.actualizar_activa(
                indice,
                &nombre,
                "Preparando inspección vmspect",
                0,
                Some(ruta.display().to_string()),
            );
            supervision_workers.emitir(
                &app_handle,
                "analizando_v_ms",
                format!("vmspect inició la inspección de «{nombre}»..."),
            );

            let inicio_imagen = Instant::now();
            let motor = vmspect::InspectionEngine::new(opciones.clone());
            let resultado = motor.inspect_with_progress(&ruta, |evento| {
                if supervision_workers.cancelada() {
                    return;
                }
                supervision_workers.actualizar_activa(
                    indice,
                    &nombre,
                    &evento.stage,
                    evento.percentage,
                    evento.detail.clone(),
                );
                supervision_workers.emitir(
                    &app_handle,
                    "analizando_v_ms",
                    format!("Inspeccionando «{nombre}» con vmspect"),
                );
            });

            supervision_workers.remover_activa(indice);
            supervision_workers
                .procesadas
                .fetch_add(1, Ordering::Relaxed);
            let peso = match resultado.as_ref() {
                Ok(reporte) => reporte.image.actual_size,
                Err(_) => std::fs::metadata(&ruta).map(|m| m.len()).unwrap_or(0),
            };
            supervision_workers
                .peso_bytes
                .fetch_add(peso, Ordering::Relaxed);

            let duracion_ms = inicio_imagen.elapsed().as_millis();
            supervision_workers.emitir_finalizacion(&app_handle, &nombre, duracion_ms);

            // El `Ok` exterior pertenece al coordinador de vmspect. El
            // resultado interior conserva el fallo de esta imagen sin
            // abortar las demás tareas del lote.
            Ok((indice, ruta, resultado))
        },
    )
    .map_err(|error| format!("Fallo el procesamiento concurrente de vmspect: {error}"))?;

    let cancelado = supervision.cancelada();
    supervision.emitir(
        app,
        "generando_reporte",
        "Transformando los InspectionReport de vmspect en la base JSON...".to_string(),
    );

    let mut pares: Vec<(usize, RegistroVM)> = Vec::with_capacity(resultados.len());
    for (indice, ruta, resultado) in resultados {
        let registro =
            construir_registro_vm(&ruta, resultado, generar_discrepancias, config, &reglas);

        if registro.exitosa {
            if registro.observaciones.is_empty() {
                supervision.exitosas.fetch_add(1, Ordering::Relaxed);
                supervision.registrar_log(
                    "exito",
                    &registro.nombre_vm,
                    format!(
                        "Inspección vmspect completa: {} programas indexados.",
                        registro.programas.len()
                    ),
                );
            } else {
                supervision
                    .con_observaciones
                    .fetch_add(1, Ordering::Relaxed);
                supervision.registrar_log(
                    "advertencia",
                    &registro.nombre_vm,
                    registro.observaciones.join(" | "),
                );
            }
        } else {
            supervision.fallidas.fetch_add(1, Ordering::Relaxed);
            supervision.registrar_log(
                "error",
                &registro.nombre_vm,
                registro.observaciones.join(" | "),
            );
        }
        if registro.discrepante {
            supervision.discrepantes.fetch_add(1, Ordering::Relaxed);
        }
        pares.push((indice, registro));
    }
    pares.sort_by_key(|(indice, _)| *indice);
    let registros: Vec<RegistroVM> = pares.into_iter().map(|(_, registro)| registro).collect();

    let total_programas: usize = registros.iter().map(|r| r.programas.len()).sum();
    let duracion = supervision.inicio.elapsed().as_secs();
    let ruta_bd = destino.join(sanitizar_nombre_salida(
        config.nombre_archivo_salida.as_deref(),
    ));

    let bd = BdRelevamiento {
        metadatos: MetadatosRelevamiento {
            aplicacion: "VM Inventory".to_string(),
            fecha_relevamiento: fecha_hora_iso(),
            ruta_origen: ruta_origen.to_string(),
            duracion_formateada: formatear_duracion(duracion),
            total_vms,
            vms_exitosas: supervision.exitosas.load(Ordering::Relaxed),
            vms_con_observaciones: supervision.con_observaciones.load(Ordering::Relaxed),
            vms_discrepantes: supervision.discrepantes.load(Ordering::Relaxed),
            vms_fallidas: supervision.fallidas.load(Ordering::Relaxed),
            total_programas,
            peso_total_gb: supervision.peso_bytes.load(Ordering::Relaxed) as f64 / GIB,
            cancelado,
        },
        vms: registros,
    };

    let contenido = serde_json::to_vec_pretty(&bd).map_err(|e| e.to_string())?;
    if let Err(e) = std::fs::write(&ruta_bd, contenido) {
        supervision.emitir(
            app,
            "error",
            format!("No se pudo guardar la base de datos: {e}"),
        );
        return Err(format!(
            "No se pudo escribir la base de datos ({}): {e}",
            ruta_bd.display()
        ));
    }
    supervision.registrar_log(
        "info",
        "",
        format!("Base de datos guardada en {}.", ruta_bd.display()),
    );

    let fase = if cancelado { "cancelado" } else { "finalizado" };
    let procesadas = supervision.procesadas.load(Ordering::Relaxed);
    let mensaje_final = if cancelado {
        format!(
            "Relevamiento cancelado. Se preservaron {} de {} imágenes procesadas.",
            procesadas, total_vms
        )
    } else {
        format!(
            "Relevamiento completo: {total_vms} imágenes, {total_programas} programas indexados."
        )
    };
    supervision.emitir(app, fase, mensaje_final);

    Ok(ResumenRelevamiento {
        fase: fase.to_string(),
        total_vms,
        vms_exitosas: supervision.exitosas.load(Ordering::Relaxed),
        vms_con_observaciones: supervision.con_observaciones.load(Ordering::Relaxed),
        vms_discrepantes: supervision.discrepantes.load(Ordering::Relaxed),
        vms_fallidas: supervision.fallidas.load(Ordering::Relaxed),
        total_programas,
        peso_total_gb: supervision.peso_bytes.load(Ordering::Relaxed) as f64 / GIB,
        duracion_formateada: formatear_duracion(duracion),
        ruta_informe: ruta_bd.display().to_string(),
        cancelado,
    })
}

impl Supervision {
    fn emitir_finalizacion(&self, app: &AppHandle, nombre: &str, duracion_ms: u128) {
        self.emitir(
            app,
            "analizando_v_ms",
            format!(
                "Finalizada «{nombre}» ({}/{}; {duracion_ms} ms).",
                self.procesadas.load(Ordering::Relaxed),
                self.total_vms
            ),
        );
    }
}

// ============================================================================
// ADAPTACIÓN DE INFORMES vmspect AL INVENTARIO DE LA APP
// ============================================================================

fn construir_registro_vm(
    ruta: &Path,
    resultado: ResultadoImagen,
    generar_discrepancias: bool,
    config: &ConfiguracionApp,
    reglas: &ReglasClasificacion,
) -> RegistroVM {
    let carpeta = ruta
        .parent()
        .filter(|padre| !padre.as_os_str().is_empty())
        .unwrap_or(ruta);
    let nombre_vm = nombre_vm_desde_ruta(ruta);
    let nombre_interno = detectar_nombre_interno(carpeta);
    let cat_posesion = deducir_tipo_posesion(carpeta);
    let mut observaciones = Vec::new();
    let discrepante = if generar_discrepancias {
        nombre_interno
            .as_deref()
            .map(|interno| normalizar_nombre(interno) != normalizar_nombre(&nombre_vm))
            .unwrap_or(false)
    } else {
        false
    };

    if discrepante {
        if let Some(interno) = nombre_interno.as_deref() {
            observaciones.push(format!(
                "Discrepancia de nomenclatura: la carpeta es «{nombre_vm}» pero la VM se llama «{interno}»."
            ));
        }
    }

    let peso_archivo = std::fs::metadata(ruta).map(|m| m.len()).unwrap_or(0);
    let ruta_carpeta = carpeta.display().to_string();

    match resultado {
        Ok(reporte) => {
            observaciones.extend(reporte.warnings);
            let programas =
                clasificar_programas(&reporte.installed_programs, reglas, config.modo_dump);
            let peso_bytes = reporte.image.actual_size.max(peso_archivo);
            RegistroVM {
                exitosa: true,
                nombre_vm,
                nombre_interno,
                ruta_carpeta,
                propietario: None,
                tipo_posesion: cat_posesion.clone(),
                elemento_asignado: None,
                origen_categoria: cat_posesion,
                asignado: None,
                elemento: None,
                sistema_operativo: reporte.guest_info.formatted_os_string(),
                hipervisor: Some(reporte.image.hypervisor.name().to_string()),
                peso_gb: peso_bytes as f64 / GIB,
                discrepante,
                observaciones,
                fecha_relevamiento: fecha_iso(),
                programas,
                peso_bytes,
            }
        }
        Err(error) => {
            let detalle = match error {
                VmSpectError::Cancelled => "Inspección cancelada por el usuario.".to_string(),
                otro => format!("Fallo la inspección de {}: {otro}", ruta.display()),
            };
            observaciones.push(detalle);
            RegistroVM {
                exitosa: false,
                nombre_vm,
                nombre_interno,
                ruta_carpeta,
                propietario: None,
                tipo_posesion: cat_posesion.clone(),
                elemento_asignado: None,
                origen_categoria: cat_posesion,
                asignado: None,
                elemento: None,
                sistema_operativo: "No identificado".to_string(),
                hipervisor: None,
                peso_gb: peso_archivo as f64 / GIB,
                discrepante,
                observaciones,
                fecha_relevamiento: fecha_iso(),
                programas: Vec::new(),
                peso_bytes: peso_archivo,
            }
        }
    }
}

fn nombre_vm_desde_ruta(ruta: &Path) -> String {
    ruta.parent()
        .and_then(|padre| padre.file_name())
        .map(|nombre| nombre.to_string_lossy().to_string())
        .filter(|nombre| !nombre.is_empty())
        .or_else(|| {
            ruta.file_stem()
                .map(|nombre| nombre.to_string_lossy().to_string())
        })
        .unwrap_or_else(|| ruta.display().to_string())
}

// ============================================================================
// METADATOS AUXILIARES DE LA APLICACIÓN
// ============================================================================

/// Extrae el nombre interno de la VM desde el descriptor `.vmx`
/// (`displayName = "..."`) o el XML `.vbox` (`<Machine name="..."`).
fn detectar_nombre_interno(carpeta: &Path) -> Option<String> {
    let entradas = std::fs::read_dir(carpeta).ok()?;
    let mut nombre_vmx: Option<String> = None;
    let mut nombre_vbox: Option<String> = None;
    for entrada in entradas.flatten() {
        let ruta = entrada.path();
        let extension = ruta
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase());
        match extension.as_deref() {
            Some("vmx") if nombre_vmx.is_none() => {
                nombre_vmx = leer_display_name_vmx(&ruta);
            }
            Some("vbox") if nombre_vbox.is_none() => {
                nombre_vbox = leer_nombre_vbox(&ruta);
            }
            _ => {}
        }
    }
    nombre_vmx.or(nombre_vbox)
}

fn leer_display_name_vmx(ruta: &Path) -> Option<String> {
    let contenido = std::fs::read_to_string(ruta).ok()?;
    for linea in contenido.lines() {
        if linea.trim().to_ascii_lowercase().starts_with("displayname") {
            let original = linea.trim();
            if let (Some(ini), Some(fin)) = (original.find('"'), original.rfind('"')) {
                if fin > ini + 1 {
                    return Some(original[ini + 1..fin].to_string());
                }
            }
        }
    }
    None
}

fn leer_nombre_vbox(ruta: &Path) -> Option<String> {
    let contenido = std::fs::read_to_string(ruta).ok()?;
    const MARCA: &str = "<Machine name=\"";
    let inicio = contenido.find(MARCA)? + MARCA.len();
    let resto = &contenido[inicio..];
    let fin = resto.find('"')?;
    Some(resto[..fin].to_string())
}

/// Normaliza un nombre para comparación: solo caracteres alfanuméricos en minúsculas.
fn normalizar_nombre(texto: &str) -> String {
    texto
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect::<String>()
        .to_lowercase()
}

/// Deduce el tipo de tenencia (Personas / Discos / Servidores) desde la ruta
/// de la carpeta, siguiendo las convenciones de nomenclatura del inventario.
fn deducir_tipo_posesion(carpeta: &Path) -> Option<String> {
    let ruta = carpeta.to_string_lossy().to_lowercase();
    if ruta.contains("serv") {
        Some("Servidores".to_string())
    } else if ruta.contains("disco") || ruta.contains("disk") {
        Some("Discos".to_string())
    } else {
        Some("Personas".to_string())
    }
}

/// Sanitiza el nombre del archivo de salida: sin rutas anidadas y siempre `.json`.
fn sanitizar_nombre_salida(nombre: Option<&str>) -> String {
    let base = nombre
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .unwrap_or("Relevamiento_VMs");
    let solo_nombre = Path::new(base)
        .file_name()
        .and_then(|f| f.to_str())
        .unwrap_or("Relevamiento_VMs");
    if solo_nombre.to_ascii_lowercase().ends_with(".json") {
        solo_nombre.to_string()
    } else {
        format!("{solo_nombre}.json")
    }
}

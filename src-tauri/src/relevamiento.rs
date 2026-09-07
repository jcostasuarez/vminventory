//! # Motor de Relevamiento Masivo
//! Pipeline de supervisión multihilo que:
//!
//! 1. Descubre imágenes de disco con `vmspect::list_vms` (`.qcow2`, `.raw`,
//!    `.vmdk`, `.vdi`, `.vhdx`, ...), filtrando extents secundarios.
//! 2. Agrupa las imágenes por carpeta contenedora (una carpeta = una VM) e
//!    inspecciona sus discos en paralelo con un pool de hilos acotado por
//!    `max_hilos`.
//! 3. Emite telemetría en vivo (`progreso_supervision`) con progreso global,
//!    workers activos, bitácora y ETA.
//! 4. Soporta cancelación limpia (graceful shutdown) preservando los informes
//!    completados hasta el momento de la interrupción.
//! 5. Consolida la base de datos indexada en JSON para el Consultor.

use crate::clasificacion::ReglasClasificacion;
use crate::models::{
    BdRelevamiento, ConfiguracionApp, EstadoSupervision, LogSupervision, MetadatosRelevamiento,
    ProgramaClasificado, RegistroVM, ResumenRelevamiento, VmActiva,
};
use std::collections::{BTreeMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use vmspect::{InspectionEngine, Options, VmSpectError};

/// Capacidad máxima de la bitácora en vivo (entradas rotativas).
const CAPACIDAD_LOGS: usize = 40;
/// GiB exacto, coherente con `formatearBytes` del frontend (base 1024).
const GIB: f64 = 1024.0 * 1024.0 * 1024.0;

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

// ============================================================================
// OPCIONES DE VM SPECT
// ============================================================================

/// Traduce la configuración del frontend a las `Options` de `vmspect`,
/// enlazando la bandera de cancelación global con el motor de inspección.
pub fn construir_opciones(config: &ConfiguracionApp, cancelacion: &Arc<AtomicBool>) -> Options {
    let mut opciones = Options::default();
    opciones.include_system = config.incluir_system;
    opciones.force_nbd = config.forzar_qemu;
    if let Some(qemu) = config.ruta_qemu_img.as_deref() {
        if !qemu.trim().is_empty() {
            opciones.qemu_nbd = Some(PathBuf::from(qemu));
        }
    }
    if let Some(kb) = config.tamano_chunk_kb {
        if kb > 0 {
            opciones.chunk_size = Some(kb.saturating_mul(1024));
        }
    }
    opciones.cancel_token = Some(cancelacion.clone());
    opciones
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
// SUPERVISIÓN (telemetría compartida entre hilos)
// ============================================================================

/// Contadores, bitácora y progreso del relevamiento compartidos por los hilos
/// trabajadores (todo lock-free salvo la bitácora y el mapa de workers).
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

    /// Construye el paquete de telemetría consumido por `telemetry.js`.
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

// ============================================================================
// PIPELINE PRINCIPAL
// ============================================================================

/// Ejecuta el relevamiento completo de un directorio de VMs.
pub fn ejecutar_relevamiento(
    app: &AppHandle,
    cancelacion: Arc<AtomicBool>,
    ruta_origen: &str,
    ruta_destino: &str,
    generar_discrepancias: bool,
    config: &ConfiguracionApp,
) -> Result<ResumenRelevamiento, String> {
    // --- Validación de rutas -------------------------------------------------
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
        return Ok(ResumenRelevamiento {
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
        });
    }

    supervision.emitir(
        app,
        "iniciando",
        "Preparando motor de inspección de discos...".to_string(),
    );

    // --- Fase 1: descubrimiento de imágenes ----------------------------------
    supervision.emitir(
        app,
        "escaneando_directorio",
        format!("Escaneando «{ruta_origen}» en busca de imágenes de disco..."),
    );
    let imagenes = match vmspect::list_vms(&origen, true) {
        Ok(lista) => lista,
        Err(e) => {
            supervision.emitir(
                app,
                "error",
                format!("Fallo el escaneo del directorio: {e}"),
            );
            return Err(e.to_string());
        }
    };

    if supervision.cancelada() {
        return Ok(ResumenRelevamiento {
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
        });
    }

    // --- Fase 2: agrupación por carpeta (una carpeta = una VM) ----------------
    let mut grupos: BTreeMap<PathBuf, Vec<PathBuf>> = BTreeMap::new();
    for imagen in imagenes {
        if let Some(carpeta) = imagen.parent() {
            grupos
                .entry(carpeta.to_path_buf())
                .or_default()
                .push(imagen);
        }
    }
    // El disco del sistema suele ser el mayor de la carpeta.
    for discos in grupos.values_mut() {
        discos.sort_by_key(|d| std::fs::metadata(d).map(|m| m.len()).unwrap_or(0));
        discos.reverse();
    }

    let total_vms = grupos.len();
    supervision.total_vms = total_vms;
    supervision.emitir(
        app,
        "escaneando_directorio",
        format!("Se detectaron {total_vms} máquinas virtuales potenciales."),
    );
    if total_vms > 0 {
        supervision.registrar_log(
            "info",
            "",
            format!("Relevamiento iniciado sobre {total_vms} VMs."),
        );
    }

    // --- Fase 3: inspección concurrente ---------------------------------------
    let reglas = ReglasClasificacion::cargar(config.ruta_reglas.as_deref());
    let hilos = config.max_hilos.unwrap_or(4).clamp(1, 16);
    let opciones = construir_opciones(config, &cancelacion);

    let cola: Mutex<VecDeque<(usize, String, PathBuf, Vec<PathBuf>)>> = Mutex::new(
        grupos
            .into_iter()
            .enumerate()
            .map(|(i, (carpeta, discos))| {
                let nombre = carpeta
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| carpeta.to_string_lossy().to_string());
                (i + 1, nombre, carpeta, discos)
            })
            .collect(),
    );
    let informes: Mutex<Vec<(usize, RegistroVM)>> = Mutex::new(Vec::new());

    if total_vms > 0 {
        thread::scope(|s| {
            for _ in 0..hilos.min(total_vms) {
                s.spawn(|| loop {
                    if supervision.cancelada() {
                        break;
                    }
                    let tarea = cola.lock().unwrap_or_else(|e| e.into_inner()).pop_front();
                    let Some((indice, nombre, carpeta, discos)) = tarea else {
                        break;
                    };
                    if supervision.cancelada() {
                        break;
                    }

                    supervision.actualizar_activa(
                        indice,
                        &nombre,
                        "Preparando discos",
                        2,
                        Some(format!("{} disco(s) en la carpeta", discos.len())),
                    );
                    supervision.emitir(
                        app,
                        "analizando_v_ms",
                        format!("Iniciando inspección de «{nombre}»..."),
                    );

                    let registro = inspeccionar_vm(
                        &supervision,
                        app,
                        &opciones,
                        indice,
                        &nombre,
                        &carpeta,
                        &discos,
                        generar_discrepancias,
                        config,
                        &reglas,
                    );

                    supervision.remover_activa(indice);
                    supervision.procesadas.fetch_add(1, Ordering::Relaxed);
                    supervision
                        .peso_bytes
                        .fetch_add(registro.peso_bytes, Ordering::Relaxed);

                    if registro.exitosa {
                        if registro.observaciones.is_empty() {
                            supervision.exitosas.fetch_add(1, Ordering::Relaxed);
                            supervision.registrar_log(
                                "exito",
                                &nombre,
                                format!(
                                    "Inspección completa: {} programas indexados.",
                                    registro.programas.len()
                                ),
                            );
                        } else {
                            supervision
                                .con_observaciones
                                .fetch_add(1, Ordering::Relaxed);
                            supervision.registrar_log(
                                "advertencia",
                                &nombre,
                                registro.observaciones.join(" | "),
                            );
                        }
                    } else {
                        supervision.fallidas.fetch_add(1, Ordering::Relaxed);
                        supervision.registrar_log(
                            "error",
                            &nombre,
                            registro.observaciones.join(" | "),
                        );
                    }
                    if registro.discrepante {
                        supervision.discrepantes.fetch_add(1, Ordering::Relaxed);
                    }

                    supervision.emitir(
                        app,
                        "analizando_v_ms",
                        format!(
                            "Finalizada «{nombre}» ({}/{}).",
                            supervision.procesadas.load(Ordering::Relaxed),
                            total_vms
                        ),
                    );
                    if let Ok(mut guardia) = informes.lock() {
                        guardia.push((indice, registro));
                    }
                });
            }
        });
    }

    // --- Fase 4: consolidación de la base de datos ----------------------------
    let cancelado = supervision.cancelada();
    supervision.emitir(
        app,
        "generando_reporte",
        "Consolidando la base de datos JSON...".to_string(),
    );

    let mut pares = informes.into_inner().unwrap_or_default();
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

    // --- Fase 5: cierre --------------------------------------------------------
    let fase = if cancelado { "cancelado" } else { "finalizado" };
    let mensaje_final = if cancelado {
        format!(
            "Relevamiento cancelado. Se preservaron {} de {} VMs procesadas.",
            supervision.procesadas.load(Ordering::Relaxed),
            total_vms
        )
    } else {
        format!("Relevamiento completo: {total_vms} VMs, {total_programas} programas indexados.")
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

// ============================================================================
// INSPECCIÓN DE UNA VM (uno o varios discos en la misma carpeta)
// ============================================================================

fn inspeccionar_vm(
    supervision: &Supervision,
    app: &AppHandle,
    opciones: &Options,
    indice: usize,
    nombre: &str,
    carpeta: &Path,
    discos: &[PathBuf],
    generar_discrepancias: bool,
    config: &ConfiguracionApp,
    reglas: &ReglasClasificacion,
) -> RegistroVM {
    let mut observaciones: Vec<String> = Vec::new();
    let mut informe: Option<vmspect::InspectionReport> = None;
    let peso_bytes: u64 = discos
        .iter()
        .filter_map(|d| std::fs::metadata(d).ok().map(|m| m.len()))
        .sum();

    // Inspecciona los discos de mayor a menor hasta hallar el disco del SO.
    'discos: for disco in discos {
        if supervision.cancelada() {
            break;
        }
        match vmspect::verify_image_integrity(disco) {
            Ok(true) => {}
            Ok(false) => {
                observaciones.push(format!(
                    "Imagen con cabecera no reconocida (omitida): {}",
                    disco.display()
                ));
                continue;
            }
            Err(e) => {
                observaciones.push(format!("No se pudo verificar {}: {e}", disco.display()));
                continue;
            }
        }

        if supervision.cancelada() {
            break 'discos;
        }

        let engine = InspectionEngine::new(opciones.clone());
        let resultado = engine.inspect_with_progress(disco, |ev| {
            if supervision.cancelada() {
                return;
            }
            supervision.actualizar_activa(
                indice,
                nombre,
                &ev.stage,
                ev.percentage,
                ev.detail.clone(),
            );
            supervision.emitir(app, "analizando_v_ms", format!("Inspeccionando «{nombre}»"));
        });

        match resultado {
            Ok(reporte) => {
                let tiene_so = reporte.operating_system != vmspect::OperatingSystem::Unknown;
                observaciones.extend(reporte.warnings.iter().cloned());
                if informe.is_none() || tiene_so {
                    informe = Some(reporte);
                }
                if tiene_so {
                    break 'discos;
                }
            }
            Err(VmSpectError::Cancelled) => break 'discos,
            Err(e) => {
                observaciones.push(format!("Fallo la inspección de {}: {e}", disco.display()))
            }
        }
    }

    // Discrepancias de nomenclatura: carpeta vs displayName (.vmx) / Machine name (.vbox).
    let nombre_interno = detectar_nombre_interno(carpeta);
    let mut discrepante = false;
    if generar_discrepancias {
        if let Some(interno) = &nombre_interno {
            if normalizar_nombre(interno) != normalizar_nombre(nombre) {
                discrepante = true;
                observaciones.push(format!(
                    "Discrepancia de nomenclatura: la carpeta es «{nombre}» pero la VM se llama «{interno}»."
                ));
            }
        }
    }

    match informe {
        Some(reporte) => RegistroVM {
            exitosa: true,
            nombre_vm: nombre.to_string(),
            nombre_interno,
            ruta_carpeta: carpeta.display().to_string(),
            propietario: None,
            tipo_posesion: deducir_tipo_posesion(carpeta),
            elemento_asignado: None,
            sistema_operativo: reporte.guest_info.formatted_os_string(),
            hipervisor: Some(reporte.image.hypervisor.name().to_string()),
            peso_gb: peso_bytes as f64 / GIB,
            discrepante,
            observaciones,
            fecha_relevamiento: fecha_iso(),
            programas: clasificar_programas(&reporte.installed_programs, reglas, config.modo_dump),
            peso_bytes,
        },
        None => RegistroVM {
            exitosa: false,
            nombre_vm: nombre.to_string(),
            nombre_interno,
            ruta_carpeta: carpeta.display().to_string(),
            propietario: None,
            tipo_posesion: deducir_tipo_posesion(carpeta),
            elemento_asignado: None,
            sistema_operativo: "No identificado".to_string(),
            hipervisor: None,
            peso_gb: peso_bytes as f64 / GIB,
            discrepante,
            observaciones: if observaciones.is_empty() {
                vec!["No se obtuvo ningún informe de los discos disponibles.".to_string()]
            } else {
                observaciones
            },
            fecha_relevamiento: fecha_iso(),
            programas: Vec::new(),
            peso_bytes,
        },
    }
}

// ============================================================================
// Utilidades de nomenclatura y deducción
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

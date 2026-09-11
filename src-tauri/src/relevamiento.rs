//! # Relevamiento masivo de máquinas virtuales
//!
//! El descubrimiento y el procesamiento de imágenes pertenecen exclusivamente a
//! la API pública de `vmspect`:
//!
//! 1. `vmspect::list_vms_with_options` descubre imágenes bajo una carpeta
//!    seleccionada y conserva sus diagnósticos no fatales.
//! 2. `vmspect::InspectionEngine::inspect_batch` coordina el lote,
//!    la concurrencia limitada y la cancelación.
//! 3. La aplicación transforma los resultados parciales en sus propios DTOs.
//!
//! Este módulo conserva únicamente la integración de la aplicación:
//! clasificación de software, enriquecimiento de metadatos y persistencia del
//! inventario JSON. El progreso se obtiene del snapshot del motor compartido.

use crate::clasificacion::ReglasClasificacion;
use crate::models::{
    BdRelevamiento, ConfiguracionApp, LogSupervision, MetadatosRelevamiento, MetricasRelevamiento,
    ProgramaClasificado, RegistroVM, ResumenRelevamiento,
};

use std::collections::{BTreeMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use vmspect::{DiscoveryOptions, InspectionEngine, VmSpectError};

/// Capacidad máxima de la bitácora en vivo (entradas rotativas).
const CAPACIDAD_LOGS: usize = 40;
/// GiB exacto, coherente con `formatearBytes` del frontend (base 1024).
const GIB: f64 = 1024.0 * 1024.0 * 1024.0;

type ResultadoImagen = std::result::Result<vmspect::InspectionReport, VmSpectError>;

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
        metricas: MetricasRelevamiento::default(),
    }
}

/// Conserva la política de exclusiones de la aplicación sin reemplazar el
/// descubrimiento recursivo de `vmspect`.
fn aplicar_exclusiones_vmspect(
    imagenes: Vec<PathBuf>,
    origen: &Path,
    reglas: &ReglasClasificacion,
) -> Vec<PathBuf> {
    imagenes
        .into_iter()
        .filter(|ruta| {
            let nombre_archivo = ruta
                .file_name()
                .and_then(|nombre| nombre.to_str())
                .unwrap_or("");
            if reglas.es_archivo_excluido(nombre_archivo) {
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
                if reglas.es_carpeta_excluida(nombre) {
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
    engine: Arc<InspectionEngine>,
    cancelacion: Arc<AtomicBool>,
    ruta_origen: &str,
    ruta_destino: &str,
    generar_discrepancias: bool,
    config: &ConfiguracionApp,
) -> Result<ResumenRelevamiento, String> {
    let total_started = Instant::now();
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

    let carga_reglas_iniciada = Instant::now();
    let reglas = ReglasClasificacion::cargar(config.ruta_reglas.as_deref());
    let rules_load_and_compile_ms = carga_reglas_iniciada.elapsed().as_millis();

    // El descubrimiento se limita estrictamente a la carpeta seleccionada. La
    // crate filtra extents secundarios y conserva advertencias sin escribirlas
    // en stderr, adecuado para esta aplicación GUI.
    let opciones_descubrimiento = DiscoveryOptions {
        recursive: true,
        excluded_directories: reglas
            .exclusions
            .folders
            .iter()
            .map(PathBuf::from)
            .collect(),
        emit_warnings: false,
        max_depth: None,
    };
    let discovery_started = Instant::now();
    let descubrimiento = match vmspect::list_vms_with_options(&origen, &opciones_descubrimiento) {
        Ok(resultado) => resultado,
        Err(error) => {
            let detalle = format!("Fallo el descubrimiento recursivo de vmspect: {error}");
            return Err(detalle);
        }
    };
    let discovery_ms = discovery_started.elapsed().as_millis();
    let warnings_count = descubrimiento.warnings.len();
    let inaccessible_count = descubrimiento.inaccessible_directories.len();
    if warnings_count + inaccessible_count > 0 {
        supervision.registrar_log(
            "advertencia",
            "",
            format!(
                "El descubrimiento encontró {} advertencias y {} directorios inaccesibles.",
                warnings_count, inaccessible_count
            ),
        );
    }
    let discovered_count = descubrimiento.images.len();
    let descubiertas = descubrimiento.images;

    if supervision.cancelada() {
        return Ok(resumen_cancelado());
    }

    let mut imagenes = aplicar_exclusiones_vmspect(descubiertas, &origen, &reglas);
    imagenes.sort();
    imagenes.dedup();
    let total_vms = imagenes.len();
    supervision.total_vms = total_vms;

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

    // El lote usa exactamente dos workers y el motor compartido preparado por
    // el comando antes de entrar al contexto bloqueante.
    let hilos = 2;
    let supervision = Arc::new(supervision);
    let indices = imagenes
        .iter()
        .enumerate()
        .map(|(indice, ruta)| (ruta.clone(), indice + 1))
        .collect::<BTreeMap<_, _>>();

    // La API batch conserva los informes exitosos y los errores por imagen.
    // No recibe callbacks: el frontend consulta el snapshot del mismo motor.
    let batch_started = Instant::now();
    let batch = engine
        .inspect_batch(imagenes, hilos)
        .map_err(|error| format!("Fallo el procesamiento batch de vmspect: {error}"))?;
    let batch_ms = batch_started.elapsed().as_millis();
    let reports_count = batch.reports.len();
    let errors_count = batch.errors.len();
    supervision
        .procesadas
        .store(reports_count + errors_count, Ordering::Relaxed);

    let cancelado = engine.is_cancelled();
    let mapping_started = Instant::now();
    let mut resultados = Vec::with_capacity(batch.reports.len() + batch.errors.len());
    for reporte in batch.reports {
        let ruta = reporte.image.path.clone();
        let indice = indices.get(&ruta).copied().unwrap_or(usize::MAX);
        resultados.push((indice, ruta, Ok(reporte)));
    }
    for error in batch.errors {
        let indice = indices.get(&error.path).copied().unwrap_or(usize::MAX);
        resultados.push((indice, error.path, Err(error.error)));
    }

    let mut pares: Vec<(usize, RegistroVM)> = Vec::with_capacity(resultados.len());
    for (indice, ruta, resultado) in resultados {
        let registro =
            construir_registro_vm(&ruta, resultado, generar_discrepancias, config, &reglas);

        if registro.exitosa {
            if registro.observaciones.is_empty() {
                supervision.exitosas.fetch_add(1, Ordering::Relaxed);
                supervision.registrar_log(
                    "exito",
                    "",
                    "Inspección vmspect completada.".to_string(),
                );
            } else {
                supervision
                    .con_observaciones
                    .fetch_add(1, Ordering::Relaxed);
                supervision.registrar_log(
                    "advertencia",
                    "",
                    "Una inspección completó con observaciones.".to_string(),
                );
            }
        } else {
            supervision.fallidas.fetch_add(1, Ordering::Relaxed);
            supervision.registrar_log(
                "error",
                "",
                "Una inspección falló; el lote continúa sin retry global.".to_string(),
            );
        }
        if registro.discrepante {
            supervision.discrepantes.fetch_add(1, Ordering::Relaxed);
        }
        supervision
            .peso_bytes
            .fetch_add(registro.peso_bytes, Ordering::Relaxed);
        pares.push((indice, registro));
    }
    pares.sort_by_key(|(indice, _)| *indice);
    let registros: Vec<RegistroVM> = pares.into_iter().map(|(_, registro)| registro).collect();

    let summary_mapping_ms = mapping_started.elapsed().as_millis();
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

    let serialization_started = Instant::now();
    let contenido = serde_json::to_vec_pretty(&bd).map_err(|e| e.to_string())?;
    let serialization_ms = serialization_started.elapsed().as_millis();
    let store_started = Instant::now();
    if let Err(e) = std::fs::write(&ruta_bd, contenido) {
        return Err(format!(
            "No se pudo escribir la base de datos ({}): {e}",
            ruta_bd.display()
        ));
    }
    let store_update_ms = store_started.elapsed().as_millis();
    supervision.registrar_log("info", "", "Base de datos guardada localmente.".to_string());

    let fase = if cancelado { "cancelado" } else { "finalizado" };
    let procesadas = supervision.procesadas.load(Ordering::Relaxed);
    let _ = procesadas;
    let metricas = MetricasRelevamiento {
        discovery_ms,
        batch_ms,
        summary_mapping_ms,
        serialization_ms,
        ipc_ms: 0,
        store_update_ms,
        ui_render_ms: 0,
        total_ms: total_started.elapsed().as_millis(),
        selected_roots: 1,
        discovered_count,
        unique_count: total_vms,
        reports_count,
        errors_count,
        inspections_count: reports_count + errors_count,
        retries_count: 0,
    };
    log::info!(
        "VM scan timing: rules_load_and_compile_ms={}, discovery_ms={}, selected_roots={}, discovered_count={}, unique_count={}, batch_ms={}, reports_count={}, errors_count={}, summary_mapping_ms={}, serialization_ms={}, ipc_ms={}, store_update_ms={}, ui_render_ms={}, total_ms={}, inspections_count={}, retries_count={}, no_apps=false, force_nbd=false, nbd_max_sessions=2",
        rules_load_and_compile_ms, metricas.discovery_ms, metricas.selected_roots, metricas.discovered_count,
        metricas.unique_count, metricas.batch_ms, metricas.reports_count, metricas.errors_count,
        metricas.summary_mapping_ms, metricas.serialization_ms, metricas.ipc_ms,
        metricas.store_update_ms, metricas.ui_render_ms, metricas.total_ms,
        metricas.inspections_count, metricas.retries_count
    );

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
        metricas,
    })
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
                responsable: None,
                tipo: None,
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
                otro => format!("Fallo la inspección: {otro}"),
            };
            observaciones.push(detalle);
            RegistroVM {
                exitosa: false,
                nombre_vm,
                nombre_interno,
                ruta_carpeta,
                responsable: None,
                tipo: None,
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

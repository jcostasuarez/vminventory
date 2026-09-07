//! # Comandos Tauri (IPC)
//! Endpoints `#[tauri::command]` invocados desde el frontend con `invoke(...)`.
//! Las tareas pesadas (inspección de discos, escaneo de directorios) se
//! ejecutan en `spawn_blocking` para no bloquear el runtime asíncrono.

use crate::clasificacion::ReglasClasificacion;
use crate::models::{
    AppState, BdRelevamiento, CoincidenciaSoftware, ConfiguracionApp, DiagnosticoSistema,
    InformeDirecto, ProgramaClasificado, ProgresoInspeccion, RegistroVM, ResultadoClasificacion,
    ResultadoConsultaSoftware, ResultadoValidacionQemu, ResumenEstadisticas, ResumenImagen,
    ResumenParticion, ResumenRelevamiento, ResumenVmInfo, TaskGuard, TAREA_INSPECCION_DIRECTA,
    TAREA_RELEVAMIENTO,
};
use crate::relevamiento::{clasificar_programas, construir_opciones, ejecutar_relevamiento};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

// ============================================================================
// RELEVAMIENTO MASIVO
// ============================================================================

/// Escanea el directorio origen en busca de imágenes de disco de VMs
/// (`.qcow2`, `.raw`, `.vmdk`, `.vdi`, `.vhdx`, ...), las inspecciona con
/// `vmspect` en paralelo, emite telemetría `progreso_supervision` en tiempo
/// real y guarda la base de datos indexada en JSON en el directorio destino.
#[tauri::command]
pub async fn procesar_relevamiento(
    app: AppHandle,
    state: State<'_, AppState>,
    ruta_origen: String,
    ruta_destino: String,
    generar_discrepancias: Option<bool>,
    configuracion: Option<ConfiguracionApp>,
) -> Result<ResumenRelevamiento, String> {
    let cancelacion = state.cancel_requested.clone();
    let mut config = configuracion.unwrap_or_default();
    config.generar_discrepancias = generar_discrepancias.unwrap_or(config.generar_discrepancias);
    let origen = ruta_origen.clone();
    let destino = ruta_destino.clone();

    tokio::task::spawn_blocking(move || {
        let gestion = app.state::<AppState>();
        let _guardia = TaskGuard::new(
            &gestion,
            TAREA_RELEVAMIENTO,
            &format!("{origen} → {destino}"),
        );
        ejecutar_relevamiento(
            &app,
            cancelacion,
            &origen,
            &destino,
            config.generar_discrepancias,
            &config,
        )
    })
    .await
    .map_err(|e| format!("Error interno del runtime de tareas: {e}"))?
}

/// Solicita la cancelación del relevamiento masivo en curso.
#[tauri::command]
pub fn cancelar_relevamiento(state: State<AppState>) -> Result<(), String> {
    state.solicitar_cancelacion();
    Ok(())
}

/// Alias canónico de `cancelar_relevamiento`: detiene cualquier inspección o
/// relevamiento activo conmutando la bandera de cancelación del `AppState`.
#[tauri::command]
pub fn detener_inspeccion(state: State<AppState>) -> Result<(), String> {
    state.solicitar_cancelacion();
    Ok(())
}

// ============================================================================
// INSPECCIÓN DIRECTA DE DISCOS
// ============================================================================

/// Inspección estática de una única imagen de disco con eventos de progreso
/// `progreso_inspeccion_directa`; devuelve el informe directo completo.
#[tauri::command]
pub async fn inspeccionar_disco_individual(
    app: AppHandle,
    state: State<'_, AppState>,
    ruta_disco: String,
    configuracion: Option<ConfiguracionApp>,
) -> Result<InformeDirecto, String> {
    let cancelacion = state.cancel_requested.clone();
    let config = configuracion.unwrap_or_default();
    let ruta = ruta_disco.clone();
    let app_handle = app.clone();

    tokio::task::spawn_blocking(move || {
        let gestion = app_handle.state::<AppState>();
        let _guardia = TaskGuard::new(&gestion, TAREA_INSPECCION_DIRECTA, &ruta);
        inspeccionar_disco(&app_handle, &cancelacion, &ruta, &config)
    })
    .await
    .map_err(|e| format!("Error interno del runtime de tareas: {e}"))?
}

/// Alias canónico de `inspeccionar_disco_individual` (nombre del diseño original).
#[tauri::command]
pub async fn inspeccionar_disco_vm(
    app: AppHandle,
    state: State<'_, AppState>,
    ruta_disco: String,
    configuracion: Option<ConfiguracionApp>,
) -> Result<InformeDirecto, String> {
    inspeccionar_disco_individual(app, state, ruta_disco, configuracion).await
}

/// Núcleo de la inspección directa: valida la ruta, ejecuta `vmspect` con
/// callback de progreso y mapea el informe al DTO del frontend.
fn inspeccionar_disco(
    app: &AppHandle,
    cancelacion: &Arc<AtomicBool>,
    ruta: &str,
    config: &ConfiguracionApp,
) -> Result<InformeDirecto, String> {
    if cancelacion.load(std::sync::atomic::Ordering::Relaxed) {
        return Err("Inspección cancelada por el usuario.".to_string());
    }

    let ruta_img = PathBuf::from(ruta);
    if !ruta_img.is_file() {
        return Err(format!("El archivo de disco no existe: {ruta}"));
    }

    let reglas = ReglasClasificacion::cargar(config.ruta_reglas.as_deref());
    let opciones = construir_opciones(config, cancelacion);

    let _ = app.emit(
        "progreso_inspeccion_directa",
        ProgresoInspeccion {
            porcentaje: 5,
            etapa: "Iniciando inspección estática".to_string(),
            detalle: Some(ruta.to_string()),
        },
    );

    let engine = vmspect::InspectionEngine::new(opciones);
    let resultado = engine.inspect_with_progress(&ruta_img, |ev| {
        if cancelacion.load(std::sync::atomic::Ordering::Relaxed) {
            return;
        }
        let _ = app.emit(
            "progreso_inspeccion_directa",
            ProgresoInspeccion {
                porcentaje: ev.percentage,
                etapa: ev.stage.clone(),
                detalle: ev.detail.clone(),
            },
        );
    });

    match resultado {
        Ok(reporte) => {
            let _ = app.emit(
                "progreso_inspeccion_directa",
                ProgresoInspeccion {
                    porcentaje: 100,
                    etapa: "Inspección finalizada".to_string(),
                    detalle: Some(format!(
                        "{} programas detectados",
                        reporte.installed_programs.len()
                    )),
                },
            );
            Ok(construir_informe_directo(ruta, reporte, &reglas, config))
        }
        Err(vmspect::VmSpectError::Cancelled) => {
            Err("Inspección cancelada por el usuario.".to_string())
        }
        Err(e) => Err(format!("Fallo la inspección de {ruta}: {e}")),
    }
}

/// Mapea un `InspectionReport` de vmspect al `InformeDirecto` que consume
/// `inspector-view.js`, clasificando los programas con las reglas activas.
fn construir_informe_directo(
    ruta: &str,
    reporte: vmspect::InspectionReport,
    reglas: &ReglasClasificacion,
    config: &ConfiguracionApp,
) -> InformeDirecto {
    let vmtools_version = reporte.guest_info.guest_tools.as_ref().and_then(|t| {
        t.version.clone().or_else(|| {
            if t.present && !t.kind.is_empty() {
                Some(t.kind.clone())
            } else {
                None
            }
        })
    });

    InformeDirecto {
        exito: true,
        archivo: ruta.to_string(),
        imagen: ResumenImagen {
            formato: reporte.image.format.clone(),
            hipervisor: reporte.image.hypervisor.name().to_string(),
            tamano_virtual: reporte.image.virtual_size,
            tamano_real: reporte.image.actual_size,
        },
        estadisticas: ResumenEstadisticas {
            modo_acceso: reporte.stats.access_mode.clone(),
            duracion_ms: reporte.stats.duration_ms,
            bytes_leidos: reporte.stats.bytes_read,
            invocaciones_qemu: reporte.stats.nbd_requests,
        },
        vm_info: ResumenVmInfo {
            os_nombre: reporte.guest_info.os_name.clone(),
            os_edition_version: reporte.guest_info.os_edition.clone(),
            os_build: reporte.guest_info.os_build.clone(),
            os_service_pack: reporte.guest_info.os_service_pack.clone(),
            vmtools_version,
            hostname: None,
            arquitectura: None,
        },
        sistema_operativo: match reporte.operating_system {
            vmspect::OperatingSystem::Windows => "Windows".to_string(),
            vmspect::OperatingSystem::Linux => "Linux".to_string(),
            vmspect::OperatingSystem::Unknown => "Desconocido".to_string(),
        },
        esquema: format!("{:?}", reporte.scheme),
        particiones: reporte
            .partitions
            .iter()
            .map(|p| ResumenParticion {
                indice: p.index,
                inicio: p.start,
                tamano: p.size,
                tipo: p.kind.clone(),
                etiqueta: p.label.clone(),
                sistema_archivos: p.file_system.name().to_string(),
            })
            .collect(),
        programas: clasificar_programas(&reporte.installed_programs, reglas, config.modo_dump),
        advertencias: reporte.warnings.clone(),
    }
}

// ============================================================================
// CONSULTOR DE SOFTWARE
// ============================================================================

/// Consulta la base de datos de reportes JSON con filtros opcionales y
/// devuelve totales, sugerencias de autocompletado y coincidencias.
#[tauri::command]
pub async fn consultar_software_en_jsons(
    directorio: String,
    filtro_programa: Option<String>,
    filtro_vm: Option<String>,
    filtro_version: Option<String>,
    filtro_tipo: Option<String>,
    filtro_propietario: Option<String>,
    filtro_so: Option<String>,
    filtro_categoria: Option<String>,
) -> Result<ResultadoConsultaSoftware, String> {
    tauri::async_runtime::spawn_blocking(move || {
        consultar_software(
            &directorio,
            filtro_programa,
            filtro_vm,
            filtro_version,
            filtro_tipo,
            filtro_propietario,
            filtro_so,
            filtro_categoria,
        )
    })
    .await
    .map_err(|e| format!("Error interno del runtime de tareas: {e}"))?
}

/// Filtros normalizados (minúsculas, sin espacios circundantes).
struct FiltrosConsulta {
    programa: Option<String>,
    vm: Option<String>,
    version: Option<String>,
    tipo: Option<String>,
    propietario: Option<String>,
    so: Option<String>,
    categoria: Option<String>,
}

impl FiltrosConsulta {
    fn nuevo(
        programa: Option<String>,
        vm: Option<String>,
        version: Option<String>,
        tipo: Option<String>,
        propietario: Option<String>,
        so: Option<String>,
        categoria: Option<String>,
    ) -> Self {
        let limpiar =
            |v: Option<String>| v.map(|s| s.trim().to_lowercase()).filter(|s| !s.is_empty());
        Self {
            programa: limpiar(programa),
            vm: limpiar(vm),
            version: limpiar(version),
            tipo: limpiar(tipo),
            propietario: limpiar(propietario),
            so: limpiar(so),
            categoria: limpiar(categoria),
        }
    }

    fn alguno(&self) -> bool {
        self.programa.is_some()
            || self.vm.is_some()
            || self.version.is_some()
            || self.tipo.is_some()
            || self.propietario.is_some()
            || self.so.is_some()
            || self.categoria.is_some()
    }

    fn cumple(&self, vm: &RegistroVM, programa: &ProgramaClasificado) -> bool {
        // El filtro de programa casa contra el nombre o las etiquetas.
        if let Some(patron) = &self.programa {
            let nombre_ok = programa.nombre.to_lowercase().contains(patron);
            let tag_ok = programa
                .tags
                .iter()
                .any(|t| t.to_lowercase().contains(patron));
            if !nombre_ok && !tag_ok {
                return false;
            }
        }
        // El filtro de VM casa contra el nombre de la carpeta o el nombre interno.
        if let Some(patron) = &self.vm {
            let carpeta_ok = vm.nombre_vm.to_lowercase().contains(patron);
            let interno_ok = vm
                .nombre_interno
                .as_deref()
                .map(|n| n.to_lowercase().contains(patron))
                .unwrap_or(false);
            if !carpeta_ok && !interno_ok {
                return false;
            }
        }
        if !pasa_opcion(programa.version.as_deref(), &self.version) {
            return false;
        }
        if !pasa_opcion(vm.tipo_posesion.as_deref(), &self.tipo) {
            return false;
        }
        if !pasa_opcion(vm.propietario.as_deref(), &self.propietario) {
            return false;
        }
        if !pasa(&vm.sistema_operativo, &self.so) {
            return false;
        }
        if !pasa_opcion(programa.categoria.as_deref(), &self.categoria) {
            return false;
        }
        true
    }
}

/// Un valor pasa si el filtro es `None` (sin filtro) o contiene el patrón.
fn pasa(valor: &str, filtro: &Option<String>) -> bool {
    match filtro {
        Some(patron) => valor.to_lowercase().contains(patron.as_str()),
        None => true,
    }
}

/// Variante para campos opcionales: con filtro activo, `None` no coincide.
fn pasa_opcion(valor: Option<&str>, filtro: &Option<String>) -> bool {
    match filtro {
        Some(patron) => valor
            .map(|v| v.to_lowercase().contains(patron.as_str()))
            .unwrap_or(false),
        None => true,
    }
}

fn consultar_software(
    directorio: &str,
    filtro_programa: Option<String>,
    filtro_vm: Option<String>,
    filtro_version: Option<String>,
    filtro_tipo: Option<String>,
    filtro_propietario: Option<String>,
    filtro_so: Option<String>,
    filtro_categoria: Option<String>,
) -> Result<ResultadoConsultaSoftware, String> {
    let ruta = Path::new(directorio);
    if !ruta.is_dir() {
        return Err("El directorio especificado no existe".to_string());
    }

    let mut archivos_json: Vec<PathBuf> = Vec::new();
    for entrada in std::fs::read_dir(ruta)
        .map_err(|e| e.to_string())?
        .flatten()
    {
        let p = entrada.path();
        if p.is_file() {
            let es_json = p
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.eq_ignore_ascii_case("json"))
                .unwrap_or(false);
            if es_json {
                archivos_json.push(p);
            }
        }
    }
    archivos_json.sort();

    let filtros = FiltrosConsulta::nuevo(
        filtro_programa,
        filtro_vm,
        filtro_version,
        filtro_tipo,
        filtro_propietario,
        filtro_so,
        filtro_categoria,
    );
    let hay_filtros = filtros.alguno();

    let mut coincidencias: Vec<CoincidenciaSoftware> = Vec::new();
    let mut programas: BTreeSet<String> = BTreeSet::new();
    let mut vms: BTreeSet<String> = BTreeSet::new();
    let mut versiones: BTreeSet<String> = BTreeSet::new();
    let mut propietarios: BTreeSet<String> = BTreeSet::new();
    let mut tipos: BTreeSet<String> = BTreeSet::new();
    let mut categorias: BTreeSet<String> = BTreeSet::new();
    let mut tags: BTreeSet<String> = BTreeSet::new();
    let mut total_vms_escaneadas = 0usize;
    let mut total_programas_indexados = 0usize;

    for archivo in &archivos_json {
        let nombre_archivo = archivo
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let contenido = match std::fs::read_to_string(archivo) {
            Ok(c) => c,
            Err(_) => continue,
        };
        // Se toleran archivos JSON ajenos al formato: se omiten sin abortar.
        let bd: BdRelevamiento = match serde_json::from_str(&contenido) {
            Ok(bd) => bd,
            Err(_) => continue,
        };

        total_vms_escaneadas += bd.vms.len();
        for vm in &bd.vms {
            vms.insert(vm.nombre_vm.clone());
            if let Some(t) = &vm.tipo_posesion {
                tipos.insert(t.clone());
            }
            if let Some(p) = &vm.propietario {
                propietarios.insert(p.clone());
            }
            for programa in &vm.programas {
                total_programas_indexados += 1;
                programas.insert(programa.nombre.clone());
                if let Some(v) = &programa.version {
                    versiones.insert(v.clone());
                }
                if let Some(c) = &programa.categoria {
                    categorias.insert(c.clone());
                }
                for t in &programa.tags {
                    tags.insert(t.clone());
                }
                if hay_filtros && filtros.cumple(vm, programa) {
                    coincidencias.push(CoincidenciaSoftware {
                        nombre_programa: programa.nombre.clone(),
                        version: programa.version.clone(),
                        editor: programa.editor.clone(),
                        categoria: programa.categoria.clone(),
                        tags: programa.tags.clone(),
                        nombre_vm: vm.nombre_vm.clone(),
                        nombre_interno: vm.nombre_interno.clone(),
                        ruta_carpeta: vm.ruta_carpeta.clone(),
                        propietario: vm.propietario.clone(),
                        tipo_posesion: vm.tipo_posesion.clone(),
                        elemento_asignado: vm.elemento_asignado.clone(),
                        sistema_operativo: vm.sistema_operativo.clone(),
                        peso_gb: vm.peso_gb,
                        hipervisor: vm.hipervisor.clone(),
                        archivo_json: nombre_archivo.clone(),
                        fecha_relevamiento: vm.fecha_relevamiento.clone(),
                    });
                }
            }
        }
    }

    Ok(ResultadoConsultaSoftware {
        total_archivos_json: archivos_json.len(),
        total_vms_escaneadas,
        total_programas_indexados,
        programas_disponibles: programas.into_iter().collect(),
        vms_disponibles: vms.into_iter().collect(),
        versiones_disponibles: versiones.into_iter().collect(),
        propietarios_disponibles: propietarios.into_iter().collect(),
        tipos_disponibles: tipos.into_iter().collect(),
        categorias_disponibles: categorias.into_iter().collect(),
        tags_disponibles: tags.into_iter().collect(),
        coincidencias,
    })
}

// ============================================================================
// VALIDACIÓN DE HERRAMIENTAS Y REGLAS
// ============================================================================

/// Verifica la existencia y ejecutabilidad del binario `qemu-nbd` requerido
/// por `vmspect` (resolución automática: PATH, `QEMU_NBD`, rutas estándar).
#[tauri::command]
pub async fn validar_binario_qemu(ruta: Option<String>) -> Result<ResultadoValidacionQemu, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let explicita = ruta
            .as_deref()
            .map(str::trim)
            .filter(|r| !r.is_empty())
            .map(Path::new);

        let resuelta = match vmspect::vms::nbd::resolve_qemu_nbd(explicita) {
            Ok(p) => p,
            Err(e) => {
                return ResultadoValidacionQemu {
                    es_valido: false,
                    version_info: None,
                    ruta_resuelta: explicita.map(|p| p.display().to_string()),
                    error: Some(e.to_string()),
                };
            }
        };

        match ejecutar_version_qemu(&resuelta) {
            Ok(version) => ResultadoValidacionQemu {
                es_valido: true,
                version_info: Some(version),
                ruta_resuelta: Some(resuelta.display().to_string()),
                error: None,
            },
            Err(e) => ResultadoValidacionQemu {
                es_valido: false,
                version_info: None,
                ruta_resuelta: Some(resuelta.display().to_string()),
                error: Some(e),
            },
        }
    })
    .await
    .map_err(|e| format!("Error interno del runtime de tareas: {e}"))
}

/// Ejecuta `qemu-nbd --version` y devuelve la primera línea de salida.
fn ejecutar_version_qemu(ruta: &Path) -> Result<String, String> {
    let mut cmd = std::process::Command::new(ruta);
    cmd.arg("--version");
    // Evita el parpadeo de ventana de consola en Windows.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let salida = cmd
        .output()
        .map_err(|e| format!("No se pudo ejecutar {}: {e}", ruta.display()))?;
    if !salida.status.success() {
        return Err(format!(
            "El binario existió pero respondió con código de error: {}",
            salida.status
        ));
    }
    let texto = String::from_utf8_lossy(&salida.stdout);
    let primera = texto.lines().next().unwrap_or("").trim();
    if primera.is_empty() {
        return Err("El binario no reportó información de versión.".to_string());
    }
    Ok(primera.to_string())
}

/// Devuelve los metadatos del conjunto de reglas activo para el simulador.
#[tauri::command]
pub fn obtener_informacion_reglas(
    ruta_reglas: Option<String>,
) -> Result<crate::models::InfoReglas, String> {
    let reglas = ReglasClasificacion::cargar(ruta_reglas.as_deref());
    Ok(reglas.informacion())
}

/// Simula la clasificación de un programa contra las reglas activas.
#[tauri::command]
pub fn probar_clasificacion_software(
    nombre: String,
    editor: Option<String>,
    sistema_operativo: Option<String>,
    ruta_reglas: Option<String>,
) -> Result<ResultadoClasificacion, String> {
    let nombre = nombre.trim();
    if nombre.is_empty() {
        return Err("El nombre del software es obligatorio.".to_string());
    }
    let reglas = ReglasClasificacion::cargar(ruta_reglas.as_deref());
    let mut veredicto = reglas.clasificar(nombre, editor.as_deref().map(str::trim));

    // Contexto informativo del sistema operativo objetivo en el veredicto.
    if let Some(so) = sistema_operativo.as_deref() {
        if veredicto.categoria.is_none() && !veredicto.es_whitelist {
            veredicto.motivo_veredicto = format!(
                "{} (evaluado como software de {so}).",
                veredicto.motivo_veredicto.trim_end_matches('.')
            );
        }
    }
    Ok(veredicto)
}

// ============================================================================
// DIAGNÓSTICO DEL SISTEMA
// ============================================================================

/// Diagnóstico del equipo anfitrión: CPU, SO, arquitectura y disponibilidad de QEMU.
#[tauri::command]
pub fn obtener_diagnostico() -> Result<DiagnosticoSistema, String> {
    let hilos_cpu = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);
    Ok(DiagnosticoSistema {
        equipo_ejecucion: std::env::var("COMPUTERNAME")
            .or_else(|_| std::env::var("HOSTNAME"))
            .unwrap_or_else(|_| "Equipo local".to_string()),
        sistema_operativo: match std::env::consts::OS {
            "windows" => "Windows".to_string(),
            "linux" => "Linux".to_string(),
            "macos" => "macOS".to_string(),
            otro => otro.to_string(),
        },
        arquitectura: std::env::consts::ARCH.to_string(),
        hilos_cpu,
        hilos_recomendados: (hilos_cpu / 2).clamp(1, 8),
        qemu_img_disponible: vmspect::vms::nbd::resolve_qemu_nbd(None).is_ok(),
    })
}

// ============================================================================
// EXPORTACIÓN Y UTILIDADES
// ============================================================================

/// Exporta un informe individual como JSON formateado en la ruta destino.
#[tauri::command]
pub fn exportar_informe_individual(
    ruta_destino: String,
    informe: serde_json::Value,
) -> Result<String, String> {
    let ruta = PathBuf::from(&ruta_destino);
    if let Some(padre) = ruta.parent() {
        if !padre.as_os_str().is_empty() && !padre.exists() {
            std::fs::create_dir_all(padre)
                .map_err(|e| format!("Error al crear directorio: {e}"))?;
        }
    }
    let contenido = serde_json::to_string_pretty(&informe)
        .map_err(|e| format!("Error al serializar el informe: {e}"))?;
    std::fs::write(&ruta, contenido).map_err(|e| format!("Error al escribir archivo: {e}"))?;
    Ok(format!("Informe exportado exitosamente a: {ruta_destino}"))
}

/// Abre una carpeta en el explorador de archivos del sistema operativo.
#[tauri::command]
pub fn abrir_carpeta(ruta: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&ruta)
            .spawn()
            .map_err(|e| format!("Error al abrir carpeta: {e}"))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&ruta)
            .spawn()
            .map_err(|e| format!("Error al abrir carpeta: {e}"))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&ruta)
            .spawn()
            .map_err(|e| format!("Error al abrir carpeta: {e}"))?;
    }

    Ok(())
}

// ============================================================================
// CONTROLES DE VENTANA (título personalizado sin marco)
// ============================================================================

/// Minimiza la ventana principal.
#[tauri::command]
pub fn ventana_minimizar(window: tauri::Window) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

/// Maximiza o restaura la ventana principal.
#[tauri::command]
pub fn ventana_maximizar_restaurar(window: tauri::Window) -> Result<(), String> {
    if window.is_maximized().unwrap_or(false) {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        window.maximize().map_err(|e| e.to_string())
    }
}

/// Cierra la aplicación.
#[tauri::command]
pub fn ventana_cerrar() -> Result<(), String> {
    std::process::exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{MetadatosRelevamiento, ProgramaClasificado, RegistroVM};
    use std::fs::File;
    use std::io::Write;

    fn crear_vm_ejemplo() -> (RegistroVM, ProgramaClasificado) {
        let programa = ProgramaClasificado {
            nombre: "Microsoft SQL Server 2019".to_string(),
            version: Some("15.0.2000".to_string()),
            editor: Some("Microsoft Corporation".to_string()),
            categoria: Some("Bases de datos".to_string()),
            tags: vec!["db".to_string(), "sql".to_string(), "rdbms".to_string()],
            relevante: true,
        };

        let vm = RegistroVM {
            exitosa: true,
            nombre_vm: "SRV-SQL-PROD".to_string(),
            nombre_interno: Some("SRV-SQL-INTERNAL".to_string()),
            ruta_carpeta: "D:\\Servidores\\SRV-SQL-PROD".to_string(),
            propietario: Some("Infraestructura".to_string()),
            tipo_posesion: Some("Servidores".to_string()),
            elemento_asignado: Some("Cluster-A".to_string()),
            sistema_operativo: "Windows Server 2022".to_string(),
            hipervisor: Some("VMware".to_string()),
            peso_gb: 40.0,
            discrepante: false,
            observaciones: vec![],
            fecha_relevamiento: "2026-09-07".to_string(),
            programas: vec![programa.clone()],
            peso_bytes: 42949672960,
        };

        (vm, programa)
    }

    #[test]
    fn test_filtros_consulta_normalizacion_y_alguno() {
        let f_vacio =
            FiltrosConsulta::nuevo(None, Some("   ".to_string()), None, None, None, None, None);
        assert!(!f_vacio.alguno());

        let f_prog = FiltrosConsulta::nuevo(
            Some("  PostgreSQL  ".to_string()),
            None,
            None,
            None,
            None,
            None,
            None,
        );
        assert!(f_prog.alguno());
        assert_eq!(f_prog.programa.as_deref(), Some("postgresql"));
    }

    #[test]
    fn test_filtros_consulta_cumple() {
        let (vm, prog) = crear_vm_ejemplo();

        // 1. Coincidencia por nombre de programa
        let f1 = FiltrosConsulta::nuevo(
            Some("sql server".to_string()),
            None,
            None,
            None,
            None,
            None,
            None,
        );
        assert!(f1.cumple(&vm, &prog));

        // 2. Coincidencia por tag
        let f2 = FiltrosConsulta::nuevo(
            Some("rdbms".to_string()),
            None,
            None,
            None,
            None,
            None,
            None,
        );
        assert!(f2.cumple(&vm, &prog));

        // 3. Coincidencia por nombre de VM (carpeta)
        let f3 = FiltrosConsulta::nuevo(
            None,
            Some("srv-sql".to_string()),
            None,
            None,
            None,
            None,
            None,
        );
        assert!(f3.cumple(&vm, &prog));

        // 4. Coincidencia por nombre interno
        let f4 = FiltrosConsulta::nuevo(
            None,
            Some("internal".to_string()),
            None,
            None,
            None,
            None,
            None,
        );
        assert!(f4.cumple(&vm, &prog));

        // 5. Coincidencia por versión
        let f5 =
            FiltrosConsulta::nuevo(None, None, Some("15.0".to_string()), None, None, None, None);
        assert!(f5.cumple(&vm, &prog));

        // 6. Coincidencia por tipo de posesión
        let f6 = FiltrosConsulta::nuevo(
            None,
            None,
            None,
            Some("servidores".to_string()),
            None,
            None,
            None,
        );
        assert!(f6.cumple(&vm, &prog));

        // 7. Coincidencia por propietario
        let f7 = FiltrosConsulta::nuevo(
            None,
            None,
            None,
            None,
            Some("infra".to_string()),
            None,
            None,
        );
        assert!(f7.cumple(&vm, &prog));

        // 8. Coincidencia por SO
        let f8 = FiltrosConsulta::nuevo(
            None,
            None,
            None,
            None,
            None,
            Some("windows".to_string()),
            None,
        );
        assert!(f8.cumple(&vm, &prog));

        // 9. Coincidencia por categoría
        let f9 = FiltrosConsulta::nuevo(
            None,
            None,
            None,
            None,
            None,
            None,
            Some("bases de datos".to_string()),
        );
        assert!(f9.cumple(&vm, &prog));

        // 10. No coincide cuando un filtro no hace match
        let f_mismatch = FiltrosConsulta::nuevo(
            Some("nginx".to_string()),
            None,
            None,
            None,
            None,
            None,
            None,
        );
        assert!(!f_mismatch.cumple(&vm, &prog));
    }

    #[test]
    fn test_consultar_software_end_to_end() {
        let temp_dir = std::env::temp_dir().join("vminventory_test_consultor");
        let _ = std::fs::remove_dir_all(&temp_dir);
        std::fs::create_dir_all(&temp_dir).unwrap();

        let (vm1, _) = crear_vm_ejemplo();
        let bd1 = BdRelevamiento {
            metadatos: MetadatosRelevamiento {
                aplicacion: "VM Inventory".to_string(),
                fecha_relevamiento: "2026-09-07".to_string(),
                ruta_origen: "D:\\Servidores".to_string(),
                duracion_formateada: "00:01:00".to_string(),
                total_vms: 1,
                vms_exitosas: 1,
                vms_con_observaciones: 0,
                vms_discrepantes: 0,
                vms_fallidas: 0,
                total_programas: 1,
                peso_total_gb: 40.0,
                cancelado: false,
            },
            vms: vec![vm1],
        };

        // Escribimos reporte 1
        let mut f1 = File::create(temp_dir.join("reporte1.json")).unwrap();
        f1.write_all(serde_json::to_string(&bd1).unwrap().as_bytes())
            .unwrap();

        // Escribimos un archivo no JSON y un JSON corrupto (deben ser ignorados con gracia)
        let mut f_txt = File::create(temp_dir.join("notas.txt")).unwrap();
        f_txt.write_all(b"texto plano").unwrap();

        let mut f_bad = File::create(temp_dir.join("corrupto.json")).unwrap();
        f_bad.write_all(b"{ json corrupto }").unwrap();

        // 1. Consulta sin filtros (debe indexar sugerencias)
        let res_todos = consultar_software(
            temp_dir.to_str().unwrap(),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .expect("Debe consultar software sin error");

        assert_eq!(res_todos.total_archivos_json, 2); // reporte1.json y corrupto.json encontrados
        assert_eq!(res_todos.total_vms_escaneadas, 1);
        assert_eq!(res_todos.total_programas_indexados, 1);
        assert!(res_todos
            .programas_disponibles
            .contains(&"Microsoft SQL Server 2019".to_string()));
        assert!(res_todos
            .vms_disponibles
            .contains(&"SRV-SQL-PROD".to_string()));
        assert!(res_todos
            .tipos_disponibles
            .contains(&"Servidores".to_string()));
        assert!(
            res_todos.coincidencias.is_empty(),
            "Sin filtros no devuelve lista de coincidencias"
        );

        // 2. Consulta con filtro coincidente
        let res_filtrado = consultar_software(
            temp_dir.to_str().unwrap(),
            Some("sql".to_string()),
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .expect("Consulta filtrada");

        assert_eq!(res_filtrado.coincidencias.len(), 1);
        assert_eq!(
            res_filtrado.coincidencias[0].nombre_programa,
            "Microsoft SQL Server 2019"
        );
        assert_eq!(res_filtrado.coincidencias[0].nombre_vm, "SRV-SQL-PROD");
        assert_eq!(res_filtrado.coincidencias[0].archivo_json, "reporte1.json");

        // 3. Directorio inexistente retorna Error
        let res_err = consultar_software(
            "directorio_que_no_existe_xyz",
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        );
        assert!(res_err.is_err());

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}

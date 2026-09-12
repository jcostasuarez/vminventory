//! # Comandos Tauri (IPC)
//! Endpoints `#[tauri::command]` invocados desde el frontend con `invoke(...)`.
//! Las tareas pesadas (inspección de discos, escaneo de directorios) se
//! ejecutan en `spawn_blocking` para no bloquear el runtime asíncrono.

use crate::clasificacion::ReglasClasificacion;
use crate::models::{
    AppState, BdRelevamiento, ConfiguracionApp, DiagnosticoSistema, InformeDirecto,
    InspectionProgressDto, RegistroVM, ResultadoClasificacion, ResultadoConsultaSoftware,
    ResumenEstadisticas, ResumenImagen, ResumenParticion, ResumenRelevamiento, ResumenVmInfo,
};
use crate::relevamiento::{clasificar_programas, ejecutar_relevamiento};
use crate::vmspect_backend::{construir_opciones, construir_opciones_resumen, inspeccionar};
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tauri::State;

// ============================================================================
// RELEVAMIENTO MASIVO
// ============================================================================

/// Escanea el directorio origen en busca de imágenes de disco de VMs
/// (`.qcow2`, `.raw`, `.vmdk`, `.vdi`, `.vhdx`, ...), las inspecciona con
/// `vmspect` en paralelo y guarda la base de datos indexada en JSON en el
/// directorio destino. El progreso se consulta por `inspection_progress`.
#[tauri::command]
pub async fn procesar_relevamiento(
    state: State<'_, AppState>,
    ruta_origen: String,
    ruta_destino: String,
    generar_discrepancias: Option<bool>,
    configuracion: Option<ConfiguracionApp>,
) -> Result<ResumenRelevamiento, String> {
    let mut config = configuracion.unwrap_or_default();
    config.generar_discrepancias = generar_discrepancias.unwrap_or(config.generar_discrepancias);
    let mut opciones = construir_opciones_resumen(&config, &state.cancel_requested);
    // El relevamiento consolida los programas; el modo resumido solo conserva
    // los parámetros de backend seguros para los lotes.
    opciones.no_apps = false;
    let (operacion, engine) = state.iniciar_relevamiento(opciones)?;
    let cancelacion = state.cancel_requested.clone();
    let origen = ruta_origen.clone();
    let destino = ruta_destino.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let _operacion = operacion;
        ejecutar_relevamiento(
            engine,
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

/// Devuelve el snapshot del mismo motor que está ejecutando el relevamiento.
#[tauri::command]
pub fn inspection_progress(state: State<AppState>) -> InspectionProgressDto {
    state
        .engine()
        .map(|engine| InspectionProgressDto::from_engine(&engine))
        .unwrap_or_else(InspectionProgressDto::idle)
}

/// Detiene la operación de inspección o relevamiento activa.
#[tauri::command]
pub fn detener_inspeccion(state: State<AppState>) -> Result<(), String> {
    state.solicitar_cancelacion();
    Ok(())
}

// ============================================================================
// INSPECCIÓN DIRECTA DE DISCOS
// ============================================================================

/// Inspección estática de una única imagen de disco; devuelve el informe
/// directo completo y publica el snapshot del motor durante la operación.
#[tauri::command]
pub async fn inspeccionar_disco_vm(
    state: State<'_, AppState>,
    ruta_disco: String,
    configuracion: Option<ConfiguracionApp>,
) -> Result<InformeDirecto, String> {
    let config = configuracion.unwrap_or_default();
    let opciones = construir_opciones(&config, &state.cancel_requested);
    let (operacion, engine) = state.iniciar_inspeccion(opciones)?;
    let cancelacion = state.cancel_requested.clone();
    let ruta = ruta_disco.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let _operacion = operacion;
        inspeccionar_disco(&cancelacion, &ruta, &config, &engine)
    })
    .await
    .map_err(|e| format!("Error interno del runtime de tareas: {e}"))?
}

/// Núcleo de la inspección directa: valida la ruta, ejecuta `vmspect` y mapea
/// el informe al DTO del frontend.
fn inspeccionar_disco(
    cancelacion: &Arc<AtomicBool>,
    ruta: &str,
    config: &ConfiguracionApp,
    engine: &vmspect::InspectionEngine,
) -> Result<InformeDirecto, String> {
    if cancelacion.load(std::sync::atomic::Ordering::Relaxed) {
        return Err("Inspección cancelada por el usuario.".to_string());
    }

    let ruta_img = PathBuf::from(ruta);
    if !ruta_img.is_file() {
        return Err(format!("El archivo de disco no existe: {ruta}"));
    }

    // Soporte para inspeccionar o visualizar reportes JSON directamente en el analizador
    let es_json = ruta_img
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("json"))
        .unwrap_or(false);

    if es_json {
        let contenido = std::fs::read_to_string(&ruta_img)
            .map_err(|e| format!("No se pudo leer el archivo JSON: {e}"))?;

        if let Ok(informe) = serde_json::from_str::<InformeDirecto>(&contenido) {
            return Ok(informe);
        } else if let Ok(bd) = serde_json::from_str::<BdRelevamiento>(&contenido) {
            if let Some(vm) = bd.vms.into_iter().next() {
                return Ok(convertir_registro_vm_a_informe_directo(&ruta_img, vm));
            }
        } else if let Ok(mut vms) = serde_json::from_str::<Vec<RegistroVM>>(&contenido) {
            if !vms.is_empty() {
                let vm = vms.remove(0);
                return Ok(convertir_registro_vm_a_informe_directo(&ruta_img, vm));
            }
        } else if let Ok(vm) = serde_json::from_str::<RegistroVM>(&contenido) {
            return Ok(convertir_registro_vm_a_informe_directo(&ruta_img, vm));
        }
    }

    let reglas = ReglasClasificacion::cargar(config.ruta_reglas.as_deref());
    // La resolución y ejecución de qemu-nbd pertenecen exclusivamente a vmspect.
    // El motor ya fue publicado para que `inspection_progress` pueda observarlo.
    let resultado = inspeccionar(engine, &ruta_img);

    match resultado {
        Ok(reporte) => Ok(construir_informe_directo(ruta, reporte, &reglas, config)),
        Err(vmspect::VmSpectError::Cancelled) => {
            Err("Inspección cancelada por el usuario.".to_string())
        }
        Err(e) => Err(format!("Fallo la inspección de {ruta}: {e}")),
    }
}

/// Convierte un `RegistroVM` a un `InformeDirecto` compatible con la vista del Analizador/Inspector.
fn convertir_registro_vm_a_informe_directo(ruta: &Path, vm: RegistroVM) -> InformeDirecto {
    let peso_real = vm.peso_bytes;
    InformeDirecto {
        exito: vm.exitosa,
        archivo: if vm.ruta_carpeta.is_empty() {
            ruta.to_string_lossy().to_string()
        } else {
            vm.ruta_carpeta.clone()
        },
        imagen: ResumenImagen {
            formato: "VMDK".to_string(),
            hipervisor: vm.hipervisor.unwrap_or_else(|| "Desconocido".to_string()),
            tamano_virtual: peso_real,
            tamano_real: peso_real,
        },
        estadisticas: ResumenEstadisticas {
            modo_acceso: "Reporte JSON".to_string(),
            duracion_ms: 0,
            bytes_leidos: 0,
            invocaciones_qemu: 0,
        },
        vm_info: ResumenVmInfo {
            os_nombre: vm.sistema_operativo.clone(),
            os_edition_version: String::new(),
            os_build: String::new(),
            os_service_pack: String::new(),
            vmtools_version: None,
            hostname: None,
            arquitectura: None,
        },
        sistema_operativo: vm.sistema_operativo,
        esquema: "MBR".to_string(),
        particiones: Vec::new(),
        programas: vm.programas,
        advertencias: vm.observaciones,
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
/// Delegado al módulo aislado `consultor.rs`.
#[tauri::command]
pub async fn consultar_software_en_jsons(
    directorio: String,
    filtro_programa: Option<String>,
    filtro_vm: Option<String>,
    filtro_version: Option<String>,
    filtro_tipo: Option<String>,
    filtro_responsable: Option<String>,
    limite_coincidencias: Option<usize>,
    criterio_agrupacion: Option<String>,
    pagina: Option<usize>,
) -> Result<ResultadoConsultaSoftware, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::consultor::consultar_software_inventario_con_agrupacion(
            &directorio,
            filtro_programa,
            filtro_version,
            filtro_vm,
            filtro_tipo,
            filtro_responsable,
            limite_coincidencias.unwrap_or(30),
            crate::models::CriterioAgrupacion::desde_valor(criterio_agrupacion.as_deref()),
            pagina.unwrap_or(1),
        )
    })
    .await
    .map_err(|e| format!("Error interno del runtime de tareas: {e}"))?
}

// ============================================================================
// REGLAS DE CLASIFICACIÓN
// ============================================================================
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
        if veredicto.categoria.is_none() {
            veredicto.motivo_veredicto = format!(
                "{} (evaluado como software de {so}).",
                veredicto.motivo_veredicto.trim_end_matches('.')
            );
        }
    }
    Ok(veredicto)
}

// ============================================================================
// VERSIÓN Y DIAGNÓSTICO DEL SISTEMA
// ============================================================================

/// Fuente única de versión para el frontend: la versión declarada en Cargo.toml.
#[tauri::command]
pub fn obtener_version_app() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// Diagnóstico del equipo anfitrión: CPU, SO y arquitectura.
#[tauri::command]
pub fn obtener_diagnostico() -> Result<DiagnosticoSistema, String> {
    let hilos_cpu = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);
    Ok(DiagnosticoSistema {
        equipo_ejecucion: "Equipo local".to_string(),
        sistema_operativo: match std::env::consts::OS {
            "windows" => "Windows".to_string(),
            "linux" => "Linux".to_string(),
            "macos" => "macOS".to_string(),
            otro => otro.to_string(),
        },
        arquitectura: std::env::consts::ARCH.to_string(),
        hilos_cpu,
        hilos_recomendados: (hilos_cpu / 2).clamp(1, 8),
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
pub fn ventana_cerrar(window: tauri::Window) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

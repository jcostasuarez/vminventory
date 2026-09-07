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

    if config.forzar_qemu && resolver_ruta_qemu_nbd(opciones.qemu_nbd.as_deref()).is_err() {
        return Err("El backend QEMU NBD está forzado en la configuración pero el ejecutable qemu-nbd no se encuentra disponible en el sistema.".to_string());
    }

    let _ = app.emit(
        "progreso_inspeccion_directa",
        ProgresoInspeccion {
            porcentaje: 5,
            etapa: "Iniciando inspección estática".to_string(),
            detalle: Some(ruta.to_string()),
        },
    );

    let (tx_ev, rx_ev) = std::sync::mpsc::channel();
    let (tx_res, rx_res) = std::sync::mpsc::channel();
    let ruta_copia = ruta_img.clone();
    let cancelacion_worker = cancelacion.clone();

    let _hilo = std::thread::Builder::new()
        .name("vmspect-inspect-direct".to_string())
        .spawn(move || {
            let engine = vmspect::InspectionEngine::new(opciones);
            let res = engine.inspect_with_progress(&ruta_copia, |ev| {
                if !cancelacion_worker.load(std::sync::atomic::Ordering::Relaxed) {
                    let _ = tx_ev.send(ev);
                }
            });
            let _ = tx_res.send(res);
        });

    let timeout = std::time::Duration::from_secs(5);
    let mut ultima_actividad = std::time::Instant::now();
    let resultado = loop {
        if cancelacion.load(std::sync::atomic::Ordering::Relaxed) {
            break Err(vmspect::VmSpectError::Cancelled);
        }

        while let Ok(ev) = rx_ev.try_recv() {
            ultima_actividad = std::time::Instant::now();
            let _ = app.emit(
                "progreso_inspeccion_directa",
                ProgresoInspeccion {
                    porcentaje: ev.percentage,
                    etapa: ev.stage.clone(),
                    detalle: ev.detail.clone(),
                },
            );
        }

        match rx_res.try_recv() {
            Ok(res) => break res,
            Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                break Err(vmspect::VmSpectError::Other(
                    "El hilo de inspección se cerró inesperadamente.".into(),
                ));
            }
            Err(std::sync::mpsc::TryRecvError::Empty) => {
                if ultima_actividad.elapsed() > timeout {
                    break Err(vmspect::VmSpectError::Other(
                        "Timeout de I/O (5s) al intentar leer particiones o colmenas del registro (Windows\\System32\\config)."
                            .into(),
                    ));
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
        }
    };

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
    filtro_asignado: Option<String>,
    filtro_elemento: Option<String>,
    filtro_discrepante: Option<bool>,
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
            filtro_asignado,
            filtro_elemento,
            filtro_discrepante,
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
    asignado: Option<String>,
    elemento: Option<String>,
    so: Option<String>,
    categoria: Option<String>,
    discrepante: Option<bool>,
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
        asignado: Option<String>,
        elemento: Option<String>,
        discrepante: Option<bool>,
    ) -> Self {
        let limpiar = |v: Option<String>| {
            v.map(|s| s.trim().to_lowercase()).filter(|s| {
                !s.is_empty()
                    && s != "-"
                    && s != "todos"
                    && s != "todas"
                    && s != "null"
                    && s != "undefined"
            })
        };
        Self {
            programa: limpiar(programa),
            vm: limpiar(vm),
            version: limpiar(version),
            tipo: limpiar(tipo),
            propietario: limpiar(propietario),
            asignado: limpiar(asignado),
            elemento: limpiar(elemento),
            so: limpiar(so),
            categoria: limpiar(categoria),
            discrepante,
        }
    }

    fn alguno(&self) -> bool {
        self.programa.is_some()
            || self.vm.is_some()
            || self.version.is_some()
            || self.tipo.is_some()
            || self.propietario.is_some()
            || self.asignado.is_some()
            || self.elemento.is_some()
            || self.so.is_some()
            || self.categoria.is_some()
            || self.discrepante.is_some()
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
        // El filtro de VM casa contra el nombre de la carpeta, nombre interno o ruta.
        if let Some(patron) = &self.vm {
            let carpeta_ok = vm.nombre_vm.to_lowercase().contains(patron);
            let interno_ok = vm
                .nombre_interno
                .as_deref()
                .map(|n| n.to_lowercase().contains(patron))
                .unwrap_or(false);
            let ruta_ok = vm.ruta_carpeta.to_lowercase().contains(patron);
            if !carpeta_ok && !interno_ok && !ruta_ok {
                return false;
            }
        }
        if !pasa_opcion(programa.version.as_deref(), &self.version) {
            return false;
        }
        // Filtro por Tipo / Ubicación / Categoría Origen
        if let Some(tipo_filtro) = &self.tipo {
            let tipo_ok = vm
                .tipo_posesion
                .as_deref()
                .map(|t| t.to_lowercase().contains(tipo_filtro))
                .unwrap_or(false)
                || vm
                    .origen_categoria
                    .as_deref()
                    .map(|c| c.to_lowercase().contains(tipo_filtro))
                    .unwrap_or(false);
            if !tipo_ok {
                return false;
            }
        }
        // Filtro Propietario / Asignado / Elemento genérico
        if let Some(prop_filtro) = &self.propietario {
            let prop_ok = vm
                .propietario
                .as_deref()
                .map(|p| p.to_lowercase().contains(prop_filtro))
                .unwrap_or(false)
                || vm
                    .elemento_asignado
                    .as_deref()
                    .map(|e| e.to_lowercase().contains(prop_filtro))
                    .unwrap_or(false)
                || vm
                    .asignado
                    .as_deref()
                    .map(|a| a.to_lowercase().contains(prop_filtro))
                    .unwrap_or(false)
                || vm
                    .elemento
                    .as_deref()
                    .map(|e| e.to_lowercase().contains(prop_filtro))
                    .unwrap_or(false);
            if !prop_ok {
                return false;
            }
        }
        // Filtro específico Asignado (Personas)
        if let Some(asig_filtro) = &self.asignado {
            let asig_ok = vm
                .asignado
                .as_deref()
                .map(|a| a.to_lowercase().contains(asig_filtro))
                .unwrap_or(false)
                || vm
                    .propietario
                    .as_deref()
                    .map(|p| p.to_lowercase().contains(asig_filtro))
                    .unwrap_or(false);
            if !asig_ok {
                return false;
            }
        }
        // Filtro específico Elemento (Discos / Servidores)
        if let Some(elem_filtro) = &self.elemento {
            let elem_ok = vm
                .elemento
                .as_deref()
                .map(|e| e.to_lowercase().contains(elem_filtro))
                .unwrap_or(false)
                || vm
                    .elemento_asignado
                    .as_deref()
                    .map(|e| e.to_lowercase().contains(elem_filtro))
                    .unwrap_or(false);
            if !elem_ok {
                return false;
            }
        }
        if !pasa(&vm.sistema_operativo, &self.so) {
            return false;
        }
        if !pasa_opcion(programa.categoria.as_deref(), &self.categoria) {
            return false;
        }
        if let Some(disc) = self.discrepante {
            if vm.discrepante != disc {
                return false;
            }
        }
        true
    }
}

/// Sanitiza una cadena opcional eliminando cadenas vacías, "-", "null", "undefined".
fn sanitizar_opcion(val: Option<&str>) -> Option<String> {
    let s = val?.trim();
    if s.is_empty()
        || s == "-"
        || s.eq_ignore_ascii_case("null")
        || s.eq_ignore_ascii_case("undefined")
    {
        None
    } else {
        Some(s.to_string())
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

#[derive(Clone, Debug)]
struct ArchivoReporteInfo {
    ruta: PathBuf,
    categoria_inferida: Option<String>,
    subcarpeta_nombre: Option<String>,
}

/// Normaliza una cadena de categoría a uno de los 3 valores canónicos: "Personas", "Discos", "Servidores".
fn normalizar_categoria_origen(texto: &str) -> String {
    let lower = texto.to_lowercase();
    if lower.contains("serv") {
        "Servidores".to_string()
    } else if lower.contains("disco") || lower.contains("disk") {
        "Discos".to_string()
    } else {
        "Personas".to_string()
    }
}

/// Recorre recursivamente un directorio raíz identificando subcarpetas `Personas/`, `Discos/`, `Servidores/`
/// y recolectando todos los archivos `.json` con su categoría asignada.
fn recolectar_archivos_json(directorio_raiz: &Path) -> Vec<ArchivoReporteInfo> {
    let mut resultado = Vec::new();
    let mut stack: Vec<(PathBuf, Option<String>, Option<String>)> =
        vec![(directorio_raiz.to_path_buf(), None, None)];

    while let Some((dir_actual, cat_heredada, sub_heredada)) = stack.pop() {
        let entradas = match std::fs::read_dir(&dir_actual) {
            Ok(e) => e,
            Err(_) => continue,
        };

        for entrada in entradas.flatten() {
            let path = entrada.path();
            let file_name = match path.file_name().and_then(|n| n.to_str()) {
                Some(n) => n.to_string(),
                None => continue,
            };

            if path.is_dir() {
                let name_lower = file_name.to_lowercase();
                let (nueva_cat, nueva_sub) = match cat_heredada.as_deref() {
                    Some("Personas") | Some("Discos") | Some("Servidores") => {
                        let sub = sub_heredada.clone().or(Some(file_name.clone()));
                        (cat_heredada.clone(), sub)
                    }
                    _ => {
                        if name_lower == "personas" || name_lower.contains("persona") {
                            (Some("Personas".to_string()), None)
                        } else if name_lower == "discos"
                            || name_lower.contains("disco")
                            || name_lower.contains("disk")
                        {
                            (Some("Discos".to_string()), None)
                        } else if name_lower == "servidores"
                            || name_lower.contains("servidor")
                            || name_lower.contains("server")
                        {
                            (Some("Servidores".to_string()), None)
                        } else {
                            (None, None)
                        }
                    }
                };
                stack.push((path, nueva_cat, nueva_sub));
            } else if path.is_file() {
                let es_json = path
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|e| e.eq_ignore_ascii_case("json"))
                    .unwrap_or(false);
                if es_json {
                    let cat = cat_heredada.clone().or_else(|| {
                        let ruta_str = path.to_string_lossy().to_lowercase();
                        if ruta_str.contains("serv") {
                            Some("Servidores".to_string())
                        } else if ruta_str.contains("disco") || ruta_str.contains("disk") {
                            Some("Discos".to_string())
                        } else if ruta_str.contains("persona") {
                            Some("Personas".to_string())
                        } else {
                            None
                        }
                    });
                    resultado.push(ArchivoReporteInfo {
                        ruta: path,
                        categoria_inferida: cat,
                        subcarpeta_nombre: sub_heredada.clone(),
                    });
                }
            }
        }
    }

    resultado.sort_by(|a, b| a.ruta.cmp(&b.ruta));
    resultado
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
    filtro_asignado: Option<String>,
    filtro_elemento: Option<String>,
    filtro_discrepante: Option<bool>,
) -> Result<ResultadoConsultaSoftware, String> {
    let ruta = Path::new(directorio);
    if !ruta.is_dir() {
        return Err("El directorio especificado no existe".to_string());
    }

    let archivos_info = recolectar_archivos_json(ruta);

    let filtros = FiltrosConsulta::nuevo(
        filtro_programa,
        filtro_vm,
        filtro_version,
        filtro_tipo,
        filtro_propietario,
        filtro_so,
        filtro_categoria,
        filtro_asignado,
        filtro_elemento,
        filtro_discrepante,
    );
    let hay_filtros = filtros.alguno();

    let mut coincidencias: Vec<CoincidenciaSoftware> = Vec::new();
    let mut programas: BTreeSet<String> = BTreeSet::new();
    let mut vms: BTreeSet<String> = BTreeSet::new();
    let mut versiones: BTreeSet<String> = BTreeSet::new();
    let mut propietarios: BTreeSet<String> = BTreeSet::new();
    let mut asignados: BTreeSet<String> = BTreeSet::new();
    let mut elementos: BTreeSet<String> = BTreeSet::new();
    let mut tipos: BTreeSet<String> = BTreeSet::new();
    let mut categorias: BTreeSet<String> = BTreeSet::new();
    let mut tags: BTreeSet<String> = BTreeSet::new();
    let mut total_vms_escaneadas = 0usize;
    let mut total_programas_indexados = 0usize;

    for archivo_info in &archivos_info {
        let nombre_archivo = archivo_info
            .ruta
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let contenido = match std::fs::read_to_string(&archivo_info.ruta) {
            Ok(c) => c,
            Err(_) => continue,
        };

        // Tolerancia: parsear BdRelevamiento completo o arreglos planos de RegistroVM
        let lista_vms: Vec<RegistroVM> =
            if let Ok(bd) = serde_json::from_str::<BdRelevamiento>(&contenido) {
                bd.vms
            } else if let Ok(vms_arr) = serde_json::from_str::<Vec<RegistroVM>>(&contenido) {
                vms_arr
            } else if let Ok(single_vm) = serde_json::from_str::<RegistroVM>(&contenido) {
                vec![single_vm]
            } else {
                continue;
            };

        total_vms_escaneadas += lista_vms.len();
        for mut vm in lista_vms {
            // Normalizar y deducir origen_categoria y tipo_posesion
            let cat_raw = vm
                .origen_categoria
                .as_deref()
                .or(archivo_info.categoria_inferida.as_deref())
                .or(vm.tipo_posesion.as_deref())
                .unwrap_or("Personas");
            let cat_normalizada = normalizar_categoria_origen(cat_raw);
            vm.origen_categoria = Some(cat_normalizada.clone());
            vm.tipo_posesion = Some(cat_normalizada.clone());

            // Normalizar y sanitizar Asignado / Elemento según la categoría
            if cat_normalizada == "Personas" {
                let asig = sanitizar_opcion(vm.asignado.as_deref())
                    .or_else(|| sanitizar_opcion(vm.propietario.as_deref()))
                    .or_else(|| sanitizar_opcion(vm.elemento_asignado.as_deref()))
                    .or_else(|| sanitizar_opcion(archivo_info.subcarpeta_nombre.as_deref()));
                vm.asignado = asig.clone();
                if vm.propietario.is_none() {
                    vm.propietario = asig.clone();
                }
                if vm.elemento_asignado.is_none() {
                    vm.elemento_asignado = asig.clone();
                }
                if let Some(a) = &asig {
                    asignados.insert(a.clone());
                    propietarios.insert(a.clone());
                }
            } else {
                // Discos o Servidores
                let elem = sanitizar_opcion(vm.elemento.as_deref())
                    .or_else(|| sanitizar_opcion(vm.elemento_asignado.as_deref()))
                    .or_else(|| sanitizar_opcion(vm.propietario.as_deref()))
                    .or_else(|| sanitizar_opcion(archivo_info.subcarpeta_nombre.as_deref()));
                vm.elemento = elem.clone();
                if vm.elemento_asignado.is_none() {
                    vm.elemento_asignado = elem.clone();
                }
                if vm.propietario.is_none() {
                    vm.propietario = elem.clone();
                }
                if let Some(e) = &elem {
                    elementos.insert(e.clone());
                    propietarios.insert(e.clone());
                }
            }

            if let Some(nom_vm) = sanitizar_opcion(Some(&vm.nombre_vm)) {
                vms.insert(nom_vm);
            }
            tipos.insert(cat_normalizada.clone());

            if let Some(p) = sanitizar_opcion(vm.propietario.as_deref()) {
                propietarios.insert(p);
            }
            if let Some(ea) = sanitizar_opcion(vm.elemento_asignado.as_deref()) {
                propietarios.insert(ea);
            }

            for programa in &vm.programas {
                total_programas_indexados += 1;
                if let Some(np) = sanitizar_opcion(Some(&programa.nombre)) {
                    programas.insert(np);
                }
                if let Some(v) = sanitizar_opcion(programa.version.as_deref()) {
                    versiones.insert(v);
                }
                if let Some(c) = sanitizar_opcion(programa.categoria.as_deref()) {
                    categorias.insert(c);
                }
                for t in &programa.tags {
                    if let Some(tag_limpio) = sanitizar_opcion(Some(t)) {
                        tags.insert(tag_limpio);
                    }
                }
                if hay_filtros && filtros.cumple(&vm, programa) {
                    coincidencias.push(CoincidenciaSoftware {
                        nombre_programa: programa.nombre.clone(),
                        version: sanitizar_opcion(programa.version.as_deref()),
                        editor: sanitizar_opcion(programa.editor.as_deref()),
                        categoria: sanitizar_opcion(programa.categoria.as_deref()),
                        tags: programa.tags.clone(),
                        nombre_vm: vm.nombre_vm.clone(),
                        nombre_interno: sanitizar_opcion(vm.nombre_interno.as_deref()),
                        ruta_carpeta: vm.ruta_carpeta.clone(),
                        propietario: sanitizar_opcion(vm.propietario.as_deref()),
                        tipo_posesion: Some(cat_normalizada.clone()),
                        elemento_asignado: sanitizar_opcion(vm.elemento_asignado.as_deref()),
                        origen_categoria: Some(cat_normalizada.clone()),
                        asignado: sanitizar_opcion(vm.asignado.as_deref()),
                        elemento: sanitizar_opcion(vm.elemento.as_deref()),
                        sistema_operativo: vm.sistema_operativo.clone(),
                        peso_gb: vm.peso_gb,
                        hipervisor: sanitizar_opcion(vm.hipervisor.as_deref()),
                        discrepante: Some(vm.discrepante),
                        archivo_json: nombre_archivo.clone(),
                        fecha_relevamiento: vm.fecha_relevamiento.clone(),
                    });
                }
            }
        }
    }

    Ok(ResultadoConsultaSoftware {
        total_archivos_json: archivos_info.len(),
        total_vms_escaneadas,
        total_programas_indexados,
        programas_disponibles: programas.into_iter().collect(),
        vms_disponibles: vms.into_iter().collect(),
        versiones_disponibles: versiones.into_iter().collect(),
        propietarios_disponibles: propietarios.into_iter().collect(),
        asignados_disponibles: asignados.into_iter().collect(),
        elementos_disponibles: elementos.into_iter().collect(),
        tipos_disponibles: tipos.into_iter().collect(),
        categorias_disponibles: categorias.into_iter().collect(),
        tags_disponibles: tags.into_iter().collect(),
        coincidencias,
    })
}

// ============================================================================
// VALIDACIÓN DE HERRAMIENTAS Y REGLAS
// ============================================================================

/// Resuelve la ruta del ejecutable `qemu-nbd`, priorizando la ruta explícita,
/// la ruta predeterminada de Windows (`C:\Program Files\qemu\qemu-nbd.exe`),
/// la variable de entorno `QEMU_NBD` y la búsqueda en el `PATH` del sistema.
pub fn resolver_ruta_qemu_nbd(explicita: Option<&Path>) -> Result<PathBuf, String> {
    if let Some(p) = explicita {
        if p.is_file() {
            return Ok(p.to_path_buf());
        }
        return Err(format!(
            "No existe el archivo especificado: {}",
            p.display()
        ));
    }

    #[cfg(windows)]
    {
        let default_win = PathBuf::from(r"C:\Program Files\qemu\qemu-nbd.exe");
        if default_win.is_file() {
            return Ok(default_win);
        }
        let default_x86 = PathBuf::from(r"C:\Program Files (x86)\qemu\qemu-nbd.exe");
        if default_x86.is_file() {
            return Ok(default_x86);
        }
    }

    if let Ok(env_path) = std::env::var("QEMU_NBD") {
        let p = PathBuf::from(env_path);
        if p.is_file() {
            return Ok(p);
        }
    }

    match vmspect::vms::nbd::resolve_qemu_nbd(None) {
        Ok(p) => Ok(p),
        Err(e) => {
            #[cfg(windows)]
            {
                Err(format!(
                    "No se halló qemu-nbd en 'C:\\Program Files\\qemu\\qemu-nbd.exe' ni en el PATH: {e}"
                ))
            }
            #[cfg(not(windows))]
            {
                Err(format!(
                    "No se halló qemu-nbd en PATH ni rutas estándar: {e}"
                ))
            }
        }
    }
}

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

        let resuelta = match resolver_ruta_qemu_nbd(explicita) {
            Ok(p) => p,
            Err(e) => {
                return ResultadoValidacionQemu {
                    es_valido: false,
                    version_info: None,
                    ruta_resuelta: explicita
                        .map(|p| p.display().to_string())
                        .or_else(|| Some(r"C:\Program Files\qemu\qemu-nbd.exe".to_string())),
                    error: Some(e),
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
        let texto_err = String::from_utf8_lossy(&salida.stderr);
        let primera_err = texto_err.lines().next().unwrap_or("").trim();
        if !primera_err.is_empty() {
            return Ok(primera_err.to_string());
        }
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
        qemu_nbd_disponible: resolver_ruta_qemu_nbd(None).is_ok(),
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
            origen_categoria: Some("Servidores".to_string()),
            asignado: None,
            elemento: Some("Cluster-A".to_string()),
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
        let f_vacio = FiltrosConsulta::nuevo(
            None,
            Some("   ".to_string()),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        );
        assert!(!f_vacio.alguno());

        let f_prog = FiltrosConsulta::nuevo(
            Some("  PostgreSQL  ".to_string()),
            None,
            None,
            None,
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
            None,
            None,
            None,
        );
        assert!(f4.cumple(&vm, &prog));

        // 5. Coincidencia por versión
        let f5 = FiltrosConsulta::nuevo(
            None,
            None,
            Some("15.0".to_string()),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        );
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
            None,
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
            None,
            None,
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
            None,
            None,
            None,
        );
        assert!(f9.cumple(&vm, &prog));

        // 10. Coincidencia por elemento
        let f10 = FiltrosConsulta::nuevo(
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some("cluster-a".to_string()),
            None,
        );
        assert!(f10.cumple(&vm, &prog));

        // 11. No coincide cuando un filtro no hace match
        let f_mismatch = FiltrosConsulta::nuevo(
            Some("nginx".to_string()),
            None,
            None,
            None,
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

        // Creamos la jerarquía Personas, Discos y Servidores
        let dir_personas = temp_dir.join("Personas").join("JuanPerez");
        let dir_discos = temp_dir.join("Discos").join("Disco01");
        let dir_servidores = temp_dir.join("Servidores").join("ClusterA");
        std::fs::create_dir_all(&dir_personas).unwrap();
        std::fs::create_dir_all(&dir_discos).unwrap();
        std::fs::create_dir_all(&dir_servidores).unwrap();

        let (vm1, _) = crear_vm_ejemplo();
        let bd_serv = BdRelevamiento {
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

        let vm_persona = RegistroVM {
            exitosa: true,
            nombre_vm: "PC-Juan".to_string(),
            nombre_interno: None,
            ruta_carpeta: "C:\\Users\\Juan".to_string(),
            propietario: Some("Juan Perez".to_string()),
            tipo_posesion: Some("Personas".to_string()),
            elemento_asignado: Some("Juan Perez".to_string()),
            origen_categoria: Some("Personas".to_string()),
            asignado: Some("Juan Perez".to_string()),
            elemento: None,
            sistema_operativo: "Windows 11".to_string(),
            hipervisor: Some("VirtualBox".to_string()),
            peso_gb: 20.0,
            discrepante: false,
            observaciones: vec![],
            fecha_relevamiento: "2026-09-07".to_string(),
            programas: vec![ProgramaClasificado {
                nombre: "Visual Studio Code".to_string(),
                version: Some("1.85.0".to_string()),
                editor: Some("Microsoft".to_string()),
                categoria: Some("Desarrollo".to_string()),
                tags: vec!["editor".to_string()],
                relevante: true,
            }],
            peso_bytes: 21474836480,
        };

        let vm_disco = RegistroVM {
            exitosa: true,
            nombre_vm: "Backup-VM".to_string(),
            nombre_interno: None,
            ruta_carpeta: "E:\\VMs\\Backup".to_string(),
            propietario: Some("Disco01".to_string()),
            tipo_posesion: Some("Discos".to_string()),
            elemento_asignado: Some("Disco01".to_string()),
            origen_categoria: Some("Discos".to_string()),
            asignado: None,
            elemento: Some("Disco01".to_string()),
            sistema_operativo: "Linux Debian 12".to_string(),
            hipervisor: Some("VMware".to_string()),
            peso_gb: 15.0,
            discrepante: false,
            observaciones: vec![],
            fecha_relevamiento: "2026-09-07".to_string(),
            programas: vec![ProgramaClasificado {
                nombre: "Docker".to_string(),
                version: Some("24.0".to_string()),
                editor: Some("Docker Inc".to_string()),
                categoria: Some("Contenedores".to_string()),
                tags: vec!["containers".to_string()],
                relevante: true,
            }],
            peso_bytes: 16106127360,
        };

        // Escribimos reportes en las 3 subcarpetas
        let mut f_serv = File::create(dir_servidores.join("reporte_serv.json")).unwrap();
        f_serv
            .write_all(serde_json::to_string(&bd_serv).unwrap().as_bytes())
            .unwrap();

        let mut f_per = File::create(dir_personas.join("reporte_per.json")).unwrap();
        f_per
            .write_all(serde_json::to_string(&vec![vm_persona]).unwrap().as_bytes())
            .unwrap();

        let mut f_disc = File::create(dir_discos.join("reporte_disc.json")).unwrap();
        f_disc
            .write_all(serde_json::to_string(&vec![vm_disco]).unwrap().as_bytes())
            .unwrap();

        // Escribimos un archivo no JSON y un JSON corrupto (deben ser ignorados con gracia)
        let mut f_txt = File::create(temp_dir.join("notas.txt")).unwrap();
        f_txt.write_all(b"texto plano").unwrap();

        let mut f_bad = File::create(temp_dir.join("corrupto.json")).unwrap();
        f_bad.write_all(b"{ json corrupto }").unwrap();

        // 1. Consulta sin filtros (debe indexar sugerencias de las 3 carpetas)
        let res_todos = consultar_software(
            temp_dir.to_str().unwrap(),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .expect("Debe consultar software sin error");

        assert_eq!(res_todos.total_archivos_json, 4); // 3 válidos + 1 corrupto
        assert_eq!(res_todos.total_vms_escaneadas, 3);
        assert_eq!(res_todos.total_programas_indexados, 3);
        assert!(res_todos
            .programas_disponibles
            .contains(&"Microsoft SQL Server 2019".to_string()));
        assert!(res_todos
            .programas_disponibles
            .contains(&"Visual Studio Code".to_string()));
        assert!(res_todos
            .programas_disponibles
            .contains(&"Docker".to_string()));
        assert!(res_todos
            .vms_disponibles
            .contains(&"SRV-SQL-PROD".to_string()));
        assert!(res_todos.vms_disponibles.contains(&"PC-Juan".to_string()));
        assert!(res_todos
            .tipos_disponibles
            .contains(&"Personas".to_string()));
        assert!(res_todos.tipos_disponibles.contains(&"Discos".to_string()));
        assert!(res_todos
            .tipos_disponibles
            .contains(&"Servidores".to_string()));
        assert!(res_todos
            .asignados_disponibles
            .contains(&"Juan Perez".to_string()));
        assert!(res_todos
            .elementos_disponibles
            .contains(&"Disco01".to_string()));
        assert!(
            res_todos.coincidencias.is_empty(),
            "Sin filtros no devuelve lista de coincidencias"
        );

        // 2. Consulta con filtro Asignado (Personas)
        let res_asig = consultar_software(
            temp_dir.to_str().unwrap(),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some("juan".to_string()),
            None,
            None,
        )
        .expect("Consulta filtrada por Asignado");

        assert_eq!(res_asig.coincidencias.len(), 1);
        assert_eq!(
            res_asig.coincidencias[0].nombre_programa,
            "Visual Studio Code"
        );
        assert_eq!(
            res_asig.coincidencias[0].origen_categoria.as_deref(),
            Some("Personas")
        );
        assert_eq!(
            res_asig.coincidencias[0].asignado.as_deref(),
            Some("Juan Perez")
        );

        // 3. Consulta con filtro Elemento (Discos)
        let res_elem = consultar_software(
            temp_dir.to_str().unwrap(),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some("disco01".to_string()),
            None,
        )
        .expect("Consulta filtrada por Elemento");

        assert_eq!(res_elem.coincidencias.len(), 1);
        assert_eq!(res_elem.coincidencias[0].nombre_programa, "Docker");
        assert_eq!(
            res_elem.coincidencias[0].origen_categoria.as_deref(),
            Some("Discos")
        );

        // 4. Directorio inexistente retorna Error
        let res_err = consultar_software(
            "directorio_que_no_existe_xyz",
            None,
            None,
            None,
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

//! # Modelos de Datos
//! Estructuras compartidas para la comunicación IPC entre el backend Rust
//! y el frontend web, además del estado global de la aplicación.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

/// Identificador de la tarea de relevamiento masivo en el estado global.
pub const TAREA_RELEVAMIENTO: &str = "relevamiento_masivo";
/// Identificador de la tarea de inspección directa en el estado global.
pub const TAREA_INSPECCION_DIRECTA: &str = "inspeccion_directa";

// ============================================================================
// ESTADO GLOBAL DE LA APLICACIÓN
// ============================================================================

/// Estado global gestionado por Tauri (`Builder::manage`).
///
/// * `cancel_requested` / `cancelacion`: bandera atómica compartida con `vmspect`,
///   que se consulta de forma frecuente en cada etapa para abortar oportunamente.
/// * `running_task`: identificador de la tarea en ejecución activa (`None` si está inactiva).
/// * `tareas`: registro de tareas activas (id -> descripción).
pub struct AppState {
    pub cancel_requested: Arc<AtomicBool>,
    #[allow(dead_code)]
    pub cancelacion: Arc<AtomicBool>,
    pub running_task: Arc<Mutex<Option<String>>>,
    pub tareas: Arc<Mutex<HashMap<String, String>>>,
}

impl Default for AppState {
    fn default() -> Self {
        let cancel = Arc::new(AtomicBool::new(false));
        Self {
            cancel_requested: cancel.clone(),
            cancelacion: cancel,
            running_task: Arc::new(Mutex::new(None)),
            tareas: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl AppState {
    /// Prepara una nueva tarea: limpia la bandera de cancelación y registra
    /// el identificador en `running_task` y `tareas`.
    pub fn preparar_tarea(&self, id: &str, descripcion: &str) {
        self.cancel_requested.store(false, Ordering::SeqCst);
        if let Ok(mut running) = self.running_task.lock() {
            *running = Some(id.to_string());
        }
        if let Ok(mut tareas) = self.tareas.lock() {
            tareas.insert(id.to_string(), descripcion.to_string());
        }
    }

    /// Finaliza una tarea liberando `running_task` y retirándola de `tareas`.
    pub fn finalizar_tarea(&self, id: &str) {
        if let Ok(mut running) = self.running_task.lock() {
            if running.as_deref() == Some(id) {
                *running = None;
            }
        }
        if let Ok(mut tareas) = self.tareas.lock() {
            tareas.remove(id);
        }
    }

    /// Solicita la cancelación inmediata de las tareas en curso.
    pub fn solicitar_cancelacion(&self) {
        self.cancel_requested.store(true, Ordering::SeqCst);
    }

    /// Indica si se ha solicitado la cancelación.
    #[inline]
    #[allow(dead_code)]
    pub fn esta_cancelada(&self) -> bool {
        self.cancel_requested.load(Ordering::Relaxed)
    }

    /// Devuelve el identificador de la tarea activa, si existe.
    #[allow(dead_code)]
    pub fn tarea_en_curso(&self) -> Option<String> {
        self.running_task.lock().ok().and_then(|g| g.clone())
    }

    /// Número de tareas registradas actualmente en ejecución.
    #[allow(dead_code)]
    pub fn tareas_activas(&self) -> usize {
        self.tareas.lock().map(|t| t.len()).unwrap_or(0)
    }
}

/// Guardia RAII que asegura la liberación incondicional del estado de una tarea
/// al salir del ámbito, sea por éxito, error, cancelación o pánico.
pub struct TaskGuard<'a> {
    state: &'a AppState,
    task_id: &'static str,
}

impl<'a> TaskGuard<'a> {
    pub fn new(state: &'a AppState, task_id: &'static str, descripcion: &str) -> Self {
        state.preparar_tarea(task_id, descripcion);
        Self { state, task_id }
    }
}

impl<'a> Drop for TaskGuard<'a> {
    fn drop(&mut self) {
        self.state.finalizar_tarea(self.task_id);
    }
}

// ============================================================================
// CONFIGURACIÓN (payload `configuracion` enviado desde el frontend)
// ============================================================================

/// Configuración del analizador enviada por el frontend (`state.obtenerPayload()`).
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct ConfiguracionApp {
    #[serde(default)]
    pub max_hilos: Option<usize>,
    #[serde(default)]
    pub modo_dump: bool,
    #[serde(default)]
    pub incluir_system: bool,
    #[serde(default)]
    pub forzar_qemu: bool,
    #[serde(default, alias = "ruta_qemu_img")]
    pub ruta_qemu_nbd: Option<String>,
    #[serde(default)]
    pub ruta_reglas: Option<String>,
    #[serde(default)]
    pub tamano_chunk_kb: Option<u64>,
    #[serde(default)]
    pub generar_discrepancias: bool,
    #[serde(default)]
    pub habilitar_bitacora: bool,
    #[serde(default)]
    pub mostrar_progreso_individual: bool,
    #[serde(default)]
    pub nombre_archivo_salida: Option<String>,
}

// ============================================================================
// TELEMETRÍA DEL RELEVAMIENTO (evento `progreso_supervision`)
// ============================================================================

/// VM activa being inspectada por un hilo trabajador (fila del panel de workers).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct VmActiva {
    pub indice: usize,
    pub nombre_vm: String,
    pub etapa: String,
    pub porcentaje: u8,
    /// Detalle técnico del paso actual (no se serializa en `vms_activas`).
    #[serde(skip_serializing, default)]
    pub detalle: Option<String>,
}

/// Entrada de la bitácora en vivo (`logs_recientes`).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LogSupervision {
    pub timestamp: String,
    pub nivel: String,
    pub vm: String,
    pub mensaje: String,
}

/// Paquete de telemetría emitido en tiempo real vía `progreso_supervision`.
/// Los nombres de campo coinciden exactamente con lo que espera `telemetry.js`.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct EstadoSupervision {
    pub fase: String,
    pub progreso_global: f64,
    pub mensaje_estado: String,
    pub vms_procesadas: usize,
    pub total_vms: usize,
    pub vms_exitosas: usize,
    pub vms_con_observaciones: usize,
    pub vms_discrepantes: usize,
    pub vms_fallidas: usize,
    pub tiempo_transcurrido_formateado: String,
    pub tiempo_restante_formateado: Option<String>,
    pub velocidad_vms_minuto: f64,
    pub vm_actual_indice: usize,
    pub vm_actual_nombre: Option<String>,
    pub progreso_vm_actual: u8,
    pub etapa_vm_actual: String,
    pub detalle_vm_actual: Option<String>,
    pub vms_activas: Vec<VmActiva>,
    pub logs_recientes: Vec<LogSupervision>,
    pub peso_total_procesado_gb: f64,
}

/// Alias canónico de telemetría de relevamiento.
#[allow(dead_code)]
pub type EventoProgresoRelevamiento = EstadoSupervision;

/// Progreso de la inspección directa (evento `progreso_inspeccion_directa`).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ProgresoInspeccion {
    pub porcentaje: u8,
    pub etapa: String,
    pub detalle: Option<String>,
}

// ============================================================================
// INFORME DIRECTO (respuesta de `inspeccionar_disco_individual`)
// ============================================================================

/// Resumen de la imagen de disco inspeccionada.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ResumenImagen {
    pub formato: String,
    pub hipervisor: String,
    pub tamano_virtual: u64,
    pub tamano_real: u64,
}

/// Métricas de rendimiento de la inspección.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ResumenEstadisticas {
    pub modo_acceso: String,
    pub duracion_ms: u64,
    pub bytes_leidos: u64,
    pub invocaciones_qemu: u64,
}

/// Metadatos del sistema operativo huésped.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ResumenVmInfo {
    pub os_nombre: String,
    pub os_edition_version: String,
    pub os_build: String,
    pub os_service_pack: String,
    pub vmtools_version: Option<String>,
    #[serde(default)]
    pub hostname: Option<String>,
    #[serde(default)]
    pub arquitectura: Option<String>,
}

/// Partición detectada dentro del disco.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ResumenParticion {
    pub indice: usize,
    pub inicio: u64,
    pub tamano: u64,
    pub tipo: String,
    pub etiqueta: Option<String>,
    pub sistema_archivos: String,
}

/// Informe completo de una inspección directa, consumido por `inspector-view.js`.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct InformeDirecto {
    pub exito: bool,
    pub archivo: String,
    pub imagen: ResumenImagen,
    pub estadisticas: ResumenEstadisticas,
    pub vm_info: ResumenVmInfo,
    pub sistema_operativo: String,
    pub esquema: String,
    pub particiones: Vec<ResumenParticion>,
    pub programas: Vec<ProgramaClasificado>,
    pub advertencias: Vec<String>,
}

// ============================================================================
// CLASIFICACIÓN DE SOFTWARE
// ============================================================================

/// Programa detectado en el huésped, enriquecido con la clasificación de reglas.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ProgramaClasificado {
    pub nombre: String,
    pub version: Option<String>,
    pub editor: Option<String>,
    pub categoria: Option<String>,
    pub tags: Vec<String>,
    pub relevante: bool,
}

/// Metadatos del conjunto de reglas (respuesta de `obtener_informacion_reglas`).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct InfoReglas {
    pub origen_reglas: String,
    pub total_whitelist: usize,
    pub categorias: BTreeMap<String, usize>,
    #[serde(default)]
    pub total_clasificaciones: usize,
    #[serde(default)]
    pub total_exclusiones_carpetas: usize,
    #[serde(default)]
    pub total_exclusiones_archivos: usize,
}

/// Resultado de la simulación de clasificación (`probar_clasificacion_software`).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ResultadoClasificacion {
    pub es_relevante: bool,
    pub es_whitelist: bool,
    pub motivo_veredicto: String,
    pub categoria: Option<String>,
    pub tags: Vec<String>,
}

// ============================================================================
// BASE DE DATOS JSON (salida de `procesar_relevamiento`)
// ============================================================================

/// VM registrada en la base de datos del relevamiento.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RegistroVM {
    /// `true` si al menos un disco produjo un informe válido.
    pub exitosa: bool,
    pub nombre_vm: String,
    #[serde(default)]
    pub nombre_interno: Option<String>,
    pub ruta_carpeta: String,
    #[serde(default)]
    pub propietario: Option<String>,
    #[serde(default)]
    pub tipo_posesion: Option<String>,
    #[serde(default)]
    pub elemento_asignado: Option<String>,
    #[serde(default)]
    pub origen_categoria: Option<String>,
    #[serde(default)]
    pub asignado: Option<String>,
    #[serde(default)]
    pub elemento: Option<String>,
    pub sistema_operativo: String,
    #[serde(default)]
    pub hipervisor: Option<String>,
    pub peso_gb: f64,
    #[serde(default)]
    pub discrepante: bool,
    #[serde(default)]
    pub observaciones: Vec<String>,
    pub fecha_relevamiento: String,
    pub programas: Vec<ProgramaClasificado>,
    /// Peso bruto en bytes (uso interno, no se serializa).
    #[serde(skip)]
    pub peso_bytes: u64,
}

/// Metadatos del relevamiento consolidado.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MetadatosRelevamiento {
    pub aplicacion: String,
    pub fecha_relevamiento: String,
    pub ruta_origen: String,
    pub duracion_formateada: String,
    pub total_vms: usize,
    pub vms_exitosas: usize,
    pub vms_con_observaciones: usize,
    pub vms_discrepantes: usize,
    pub vms_fallidas: usize,
    pub total_programas: usize,
    pub peso_total_gb: f64,
    pub cancelado: bool,
}

/// Estructura raíz del archivo JSON generado por el relevamiento.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BdRelevamiento {
    pub metadatos: MetadatosRelevamiento,
    pub vms: Vec<RegistroVM>,
}

/// Resumen devuelto por `procesar_relevamiento` al finalizar (o cancelar).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ResumenRelevamiento {
    pub fase: String,
    pub total_vms: usize,
    pub vms_exitosas: usize,
    pub vms_con_observaciones: usize,
    pub vms_discrepantes: usize,
    pub vms_fallidas: usize,
    pub total_programas: usize,
    pub peso_total_gb: f64,
    pub duracion_formateada: String,
    pub ruta_informe: String,
    pub cancelado: bool,
}

/// Alias canónico del resultado del proceso de relevamiento.
#[allow(dead_code)]
pub type ResumenProceso = ResumenRelevamiento;

// ============================================================================
// CONSULTOR DE SOFTWARE (respuesta de `consultar_software_en_jsons`)
// ============================================================================

/// Coincidencia individual de software en la base de datos de reportes.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CoincidenciaSoftware {
    pub nombre_programa: String,
    pub version: Option<String>,
    pub editor: Option<String>,
    pub categoria: Option<String>,
    pub tags: Vec<String>,
    pub nombre_vm: String,
    pub nombre_interno: Option<String>,
    pub ruta_carpeta: String,
    pub propietario: Option<String>,
    pub tipo_posesion: Option<String>,
    pub elemento_asignado: Option<String>,
    pub origen_categoria: Option<String>,
    pub asignado: Option<String>,
    pub elemento: Option<String>,
    pub sistema_operativo: String,
    pub peso_gb: f64,
    pub hipervisor: Option<String>,
    pub discrepante: Option<bool>,
    pub archivo_json: String,
    pub fecha_relevamiento: String,
}

/// Respuesta completa del consultor con totales, sugerencias y coincidencias.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ResultadoConsultaSoftware {
    pub total_archivos_json: usize,
    pub total_vms_escaneadas: usize,
    pub total_programas_indexados: usize,
    pub programas_disponibles: Vec<String>,
    pub vms_disponibles: Vec<String>,
    pub versiones_disponibles: Vec<String>,
    pub propietarios_disponibles: Vec<String>,
    #[serde(default)]
    pub asignados_disponibles: Vec<String>,
    #[serde(default)]
    pub elementos_disponibles: Vec<String>,
    pub tipos_disponibles: Vec<String>,
    pub categorias_disponibles: Vec<String>,
    pub tags_disponibles: Vec<String>,
    pub coincidencias: Vec<CoincidenciaSoftware>,
}

// ============================================================================
// DIAGNÓSTICO Y VALIDACIÓN DE HERRAMIENTAS
// ============================================================================

/// Diagnóstico del equipo anfitrión (respuesta de `obtener_diagnostico`).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DiagnosticoSistema {
    pub equipo_ejecucion: String,
    pub sistema_operativo: String,
    pub arquitectura: String,
    pub hilos_cpu: usize,
    pub hilos_recomendados: usize,
    #[serde(default, alias = "qemu_img_disponible")]
    pub qemu_nbd_disponible: bool,
}

/// Resultado de la validación del binario QEMU (`validar_binario_qemu`).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ResultadoValidacionQemu {
    pub es_valido: bool,
    pub version_info: Option<String>,
    pub ruta_resuelta: Option<String>,
    pub error: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_app_state_lifecycle() {
        let state = AppState::default();
        assert!(!state.esta_cancelada());
        assert_eq!(state.tarea_en_curso(), None);
        assert_eq!(state.tareas_activas(), 0);

        state.preparar_tarea(TAREA_RELEVAMIENTO, "Relevamiento de prueba");
        assert_eq!(state.tarea_en_curso(), Some(TAREA_RELEVAMIENTO.to_string()));
        assert_eq!(state.tareas_activas(), 1);
        assert!(!state.esta_cancelada());

        state.solicitar_cancelacion();
        assert!(state.esta_cancelada());

        state.finalizar_tarea(TAREA_RELEVAMIENTO);
        assert_eq!(state.tarea_en_curso(), None);
        assert_eq!(state.tareas_activas(), 0);
    }

    #[test]
    fn test_task_guard_raii() {
        let state = AppState::default();
        {
            let _guard = TaskGuard::new(&state, TAREA_INSPECCION_DIRECTA, "Inspección de disco");
            assert_eq!(
                state.tarea_en_curso(),
                Some(TAREA_INSPECCION_DIRECTA.to_string())
            );
            assert_eq!(state.tareas_activas(), 1);
        }
        // Al salir del ámbito, TaskGuard debe liberar la tarea
        assert_eq!(state.tarea_en_curso(), None);
        assert_eq!(state.tareas_activas(), 0);
    }

    #[test]
    fn test_configuracion_app_serde() {
        let json_data = r#"{
            "max_hilos": 8,
            "modo_dump": true,
            "incluir_system": true,
            "forzar_qemu": false,
            "ruta_qemu_nbd": "/usr/bin/qemu-nbd",
            "ruta_reglas": null,
            "tamano_chunk_kb": 1024,
            "generar_discrepancias": true,
            "habilitar_bitacora": true,
            "mostrar_progreso_individual": true,
            "nombre_archivo_salida": "salida.json"
        }"#;

        let config: ConfiguracionApp =
            serde_json::from_str(json_data).expect("Debe deserializar ConfiguracionApp");
        assert_eq!(config.max_hilos, Some(8));
        assert!(config.modo_dump);
        assert!(config.incluir_system);
        assert!(!config.forzar_qemu);
        assert_eq!(config.ruta_qemu_nbd.as_deref(), Some("/usr/bin/qemu-nbd"));
        assert_eq!(config.ruta_reglas, None);
        assert_eq!(config.tamano_chunk_kb, Some(1024));
        assert!(config.generar_discrepancias);
        assert!(config.habilitar_bitacora);
        assert_eq!(config.nombre_archivo_salida.as_deref(), Some("salida.json"));

        let serialized = serde_json::to_string(&config).expect("Debe serializar ConfiguracionApp");
        assert!(serialized.contains("\"max_hilos\":8"));
    }

    #[test]
    fn test_bd_relevamiento_serde() {
        let bd = BdRelevamiento {
            metadatos: MetadatosRelevamiento {
                aplicacion: "VM Inventory".to_string(),
                fecha_relevamiento: "2026-09-07".to_string(),
                ruta_origen: "D:\\VMs".to_string(),
                duracion_formateada: "00:05:30".to_string(),
                total_vms: 1,
                vms_exitosas: 1,
                vms_con_observaciones: 0,
                vms_discrepantes: 0,
                vms_fallidas: 0,
                total_programas: 2,
                peso_total_gb: 25.5,
                cancelado: false,
            },
            vms: vec![RegistroVM {
                exitosa: true,
                nombre_vm: "Windows 10 Dev".to_string(),
                nombre_interno: Some("Win10-Dev".to_string()),
                ruta_carpeta: "D:\\VMs\\Win10".to_string(),
                propietario: Some("Operador".to_string()),
                tipo_posesion: Some("Personas".to_string()),
                elemento_asignado: Some("Operador".to_string()),
                origen_categoria: Some("Personas".to_string()),
                asignado: Some("Operador".to_string()),
                elemento: None,
                sistema_operativo: "Windows 10 Pro".to_string(),
                hipervisor: Some("VMware".to_string()),
                peso_gb: 25.5,
                discrepante: false,
                observaciones: vec![],
                fecha_relevamiento: "2026-09-07".to_string(),
                programas: vec![ProgramaClasificado {
                    nombre: "PostgreSQL 15".to_string(),
                    version: Some("15.3".to_string()),
                    editor: Some("PostgreSQL".to_string()),
                    categoria: Some("Bases de datos".to_string()),
                    tags: vec!["db".to_string()],
                    relevante: true,
                }],
                peso_bytes: 27380416512,
            }],
        };

        let json = serde_json::to_string_pretty(&bd).expect("Debe serializar BdRelevamiento");
        let deserialized: BdRelevamiento =
            serde_json::from_str(&json).expect("Debe deserializar BdRelevamiento");

        assert_eq!(deserialized.metadatos.total_vms, 1);
        assert_eq!(deserialized.vms.len(), 1);
        assert_eq!(deserialized.vms[0].nombre_vm, "Windows 10 Dev");
        assert_eq!(deserialized.vms[0].programas.len(), 1);
        assert_eq!(deserialized.vms[0].programas[0].nombre, "PostgreSQL 15");
        assert_eq!(
            deserialized.vms[0].programas[0].categoria.as_deref(),
            Some("Bases de datos")
        );
    }

    #[test]
    fn test_informe_directo_serde() {
        let informe = InformeDirecto {
            exito: true,
            archivo: "test.vmdk".to_string(),
            imagen: ResumenImagen {
                formato: "VMDK".to_string(),
                hipervisor: "VMware".to_string(),
                tamano_virtual: 53687091200,
                tamano_real: 21474836480,
            },
            estadisticas: ResumenEstadisticas {
                modo_acceso: "Nativo".to_string(),
                duracion_ms: 120,
                bytes_leidos: 5242880,
                invocaciones_qemu: 0,
            },
            vm_info: ResumenVmInfo {
                os_nombre: "Ubuntu 22.04".to_string(),
                os_edition_version: "22.04.3 LTS".to_string(),
                os_build: "5.15.0".to_string(),
                os_service_pack: String::new(),
                vmtools_version: Some("12.1.0".to_string()),
                hostname: Some("ubuntu-srv".to_string()),
                arquitectura: Some("x86_64".to_string()),
            },
            sistema_operativo: "Ubuntu 22.04".to_string(),
            esquema: "GPT".to_string(),
            particiones: vec![ResumenParticion {
                indice: 1,
                inicio: 1048576,
                tamano: 53686042624,
                tipo: "Linux filesystem".to_string(),
                etiqueta: Some("root".to_string()),
                sistema_archivos: "ext4".to_string(),
            }],
            programas: vec![],
            advertencias: vec![],
        };

        let json = serde_json::to_string(&informe).expect("Debe serializar InformeDirecto");
        let res: InformeDirecto =
            serde_json::from_str(&json).expect("Debe deserializar InformeDirecto");
        assert_eq!(res.imagen.formato, "VMDK");
        assert_eq!(res.particiones.len(), 1);
        assert_eq!(res.particiones[0].sistema_archivos, "ext4");
    }

    #[test]
    fn test_diagnostico_y_validacion_qemu_serde() {
        let diag = DiagnosticoSistema {
            equipo_ejecucion: "TEST-PC".to_string(),
            sistema_operativo: "windows".to_string(),
            arquitectura: "x86_64".to_string(),
            hilos_cpu: 16,
            hilos_recomendados: 8,
            qemu_nbd_disponible: true,
        };
        let diag_json = serde_json::to_string(&diag).unwrap();
        let diag_res: DiagnosticoSistema = serde_json::from_str(&diag_json).unwrap();
        assert_eq!(diag_res.hilos_cpu, 16);

        let qemu_val = ResultadoValidacionQemu {
            es_valido: true,
            version_info: Some("qemu-nbd 8.2.0".to_string()),
            ruta_resuelta: Some("C:\\Program Files\\qemu\\qemu-nbd.exe".to_string()),
            error: None,
        };
        let qemu_json = serde_json::to_string(&qemu_val).unwrap();
        let qemu_res: ResultadoValidacionQemu = serde_json::from_str(&qemu_json).unwrap();
        assert!(qemu_res.es_valido);
        assert_eq!(qemu_res.version_info.as_deref(), Some("qemu-nbd 8.2.0"));
    }
}

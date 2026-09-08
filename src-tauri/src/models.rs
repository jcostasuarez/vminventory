//! # Modelos de Datos
//! Estructuras compartidas para la comunicación IPC entre el backend Rust
//! y el frontend web, además del estado global de la aplicación.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

// ============================================================================
// ESTADO GLOBAL DE LA APLICACIÓN
// ============================================================================

/// Estado mínimo gestionado por Tauri.
///
/// El motor `vmspect` recibe esta misma bandera en sus opciones y la consulta
/// durante la inspección. La app admite una operación activa a la vez.
pub struct AppState {
    pub cancel_requested: Arc<AtomicBool>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            cancel_requested: Arc::new(AtomicBool::new(false)),
        }
    }
}

impl AppState {
    /// Limpia la cancelación antes de iniciar una nueva operación.
    pub fn preparar_tarea(&self) {
        self.cancel_requested.store(false, Ordering::SeqCst);
    }

    /// Solicita la cancelación de la operación activa.
    pub fn solicitar_cancelacion(&self) {
        self.cancel_requested.store(true, Ordering::SeqCst);
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

/// Progreso de la inspección directa (evento `progreso_inspeccion_directa`).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ProgresoInspeccion {
    pub porcentaje: u8,
    pub etapa: String,
    pub detalle: Option<String>,
}

// ============================================================================
// INFORME DIRECTO (respuesta de `inspeccionar_disco_vm`)
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
// DIAGNÓSTICO DEL SISTEMA
// ============================================================================

/// Diagnóstico del equipo anfitrión (respuesta de `obtener_diagnostico`).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DiagnosticoSistema {
    pub equipo_ejecucion: String,
    pub sistema_operativo: String,
    pub arquitectura: String,
    pub hilos_cpu: usize,
    pub hilos_recomendados: usize,
}

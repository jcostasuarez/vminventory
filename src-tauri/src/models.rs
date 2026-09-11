//! # Modelos de Datos
//! Estructuras compartidas para la comunicación IPC entre el backend Rust
//! y el frontend web, además del estado global de la aplicación.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use vmspect::{InspectionEngine, Options};

// ============================================================================
// ESTADO GLOBAL DE LA APLICACIÓN
// ============================================================================

/// Estado mínimo gestionado por Tauri.
///
/// El motor `vmspect` recibe esta misma bandera en sus opciones y la consulta
/// durante la inspección. La app admite una operación activa a la vez.
pub struct AppState {
    pub cancel_requested: Arc<AtomicBool>,
    active: Arc<AtomicBool>,
    /// Motor del último relevamiento. El lote y `inspection_progress` comparten
    /// esta misma instancia para que el snapshot represente la operación real.
    engine: Arc<Mutex<Option<Arc<InspectionEngine>>>>,
}

/// Guardia RAII que libera la exclusión mutua al terminar, incluso ante pánico.
pub struct OperacionActiva {
    active: Arc<AtomicBool>,
    engine: Option<Arc<Mutex<Option<Arc<InspectionEngine>>>>>,
}

impl Drop for OperacionActiva {
    fn drop(&mut self) {
        if let Some(engine) = &self.engine {
            if let Ok(mut engine) = engine.lock() {
                *engine = None;
            }
        }
        self.active.store(false, Ordering::Release);
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            cancel_requested: Arc::new(AtomicBool::new(false)),
            active: Arc::new(AtomicBool::new(false)),
            engine: Arc::new(Mutex::new(None)),
        }
    }
}

impl AppState {
    /// Inicia una operación si no existe otra activa y devuelve su guardia.
    pub fn iniciar_tarea(&self) -> Result<OperacionActiva, String> {
        self.active
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "Ya hay una búsqueda o inspección activa.".to_string())?;
        self.cancel_requested.store(false, Ordering::Release);
        if let Ok(mut engine) = self.engine.lock() {
            *engine = None;
        }
        Ok(OperacionActiva {
            active: self.active.clone(),
            engine: None,
        })
    }

    /// Crea y publica el motor que ejecutará una operación antes de que el
    /// trabajo bloqueante comience. `options` ya contiene el token de
    /// cancelación compartido de la aplicación.
    fn iniciar_motor(
        &self,
        options: Options,
    ) -> Result<(OperacionActiva, Arc<InspectionEngine>), String> {
        let mut operacion = self.iniciar_tarea()?;
        let engine = Arc::new(InspectionEngine::new(options));
        *self
            .engine
            .lock()
            .map_err(|_| "No se pudo acceder al motor de inspección.".to_string())? =
            Some(engine.clone());
        operacion.engine = Some(self.engine.clone());
        Ok((operacion, engine))
    }

    /// Inicia un relevamiento y publica su motor antes de que el trabajo
    /// bloqueante comience.
    pub fn iniciar_relevamiento(
        &self,
        options: Options,
    ) -> Result<(OperacionActiva, Arc<InspectionEngine>), String> {
        self.iniciar_motor(options)
    }

    /// Inicia una inspección individual y publica el mismo motor que consulta
    /// el comando `inspection_progress` del frontend.
    pub fn iniciar_inspeccion(
        &self,
        options: Options,
    ) -> Result<(OperacionActiva, Arc<InspectionEngine>), String> {
        self.iniciar_motor(options)
    }

    /// Devuelve el motor asociado al último relevamiento, si ya se inició uno.
    pub fn engine(&self) -> Option<Arc<InspectionEngine>> {
        self.engine.lock().ok().and_then(|engine| engine.clone())
    }

    #[cfg(test)]
    pub fn esta_activa(&self) -> bool {
        self.active.load(Ordering::Acquire)
    }

    /// Solicita la cancelación de la operación activa.
    pub fn solicitar_cancelacion(&self) {
        self.cancel_requested.store(true, Ordering::SeqCst);
        if let Some(engine) = self.engine() {
            // `vmspect` mantiene su propia marca de cancelación en el snapshot;
            // cancelar el motor asegura que el polling la vea de inmediato.
            engine.cancel();
        }
    }
}

/// Snapshot serializable del progreso real de `vmspect`.
///
/// La versión 0.8.0 expone `stage_id`, pero no una descripción ni el detalle de
/// cada worker. Esos campos se adaptan a valores neutrales en el frontend.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct InspectionProgressDto {
    pub completed_tasks: usize,
    pub total_tasks: usize,
    pub percentage: u8,
    pub stage_id: u8,
    pub bytes_processed: u64,
    pub total_bytes: u64,
    pub cancelled: bool,
}

impl InspectionProgressDto {
    pub fn idle() -> Self {
        Self {
            completed_tasks: 0,
            total_tasks: 0,
            percentage: 0,
            stage_id: 0,
            bytes_processed: 0,
            total_bytes: 0,
            cancelled: false,
        }
    }

    pub fn from_engine(engine: &InspectionEngine) -> Self {
        let snapshot = engine.progress().snapshot();
        Self {
            completed_tasks: snapshot.completed_tasks,
            total_tasks: snapshot.total_tasks,
            percentage: snapshot.percentage,
            stage_id: snapshot.stage_id,
            bytes_processed: snapshot.bytes_processed,
            total_bytes: snapshot.total_bytes,
            cancelled: snapshot.cancelled || engine.is_cancelled(),
        }
    }
}

// ============================================================================
// CONFIGURACIÓN (payload `configuracion` enviado desde el frontend)
// ============================================================================

#[cfg(test)]
mod tests {
    use super::{AppState, InspectionProgressDto};
    use std::sync::Arc;
    use vmspect::Options;

    #[test]
    fn rechaza_una_segunda_operacion_mientras_la_primera_esta_activa() {
        let estado = AppState::default();
        let primera = estado
            .iniciar_tarea()
            .expect("la primera operación debe iniciar");

        assert!(estado.esta_activa());
        assert!(estado.iniciar_tarea().is_err());

        drop(primera);
        assert!(!estado.esta_activa());
        assert!(estado.iniciar_tarea().is_ok());
    }

    #[test]
    fn comparte_el_motor_del_lote_con_el_snapshot_de_progreso() {
        let estado = AppState::default();
        assert!(estado.engine().is_none());

        let (operacion, engine) = estado
            .iniciar_relevamiento(Options::default())
            .expect("el relevamiento debe publicar su motor");
        let publicado = estado
            .engine()
            .expect("el motor debe permanecer disponible");

        assert!(Arc::ptr_eq(&engine, &publicado));
        assert_eq!(
            InspectionProgressDto::from_engine(&publicado),
            InspectionProgressDto::idle()
        );
        drop(operacion);
    }
}

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
// TELEMETRÍA DEL RELEVAMIENTO (snapshot consultado por polling)
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

/// Contrato visual de telemetría construido en el frontend desde snapshots.
/// Los nombres de campo coinciden exactamente con lo que espera `ui.ts`.
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
///
/// `responsable` reemplaza los campos históricos `asignado` y `elemento`.
/// El tipo se determina al consultar según la subcarpeta directa que contiene
/// el reporte, por eso solo existe durante la indexación y no se persiste.
#[derive(Serialize, Clone, Debug)]
pub struct RegistroVM {
    /// `true` si al menos un disco produjo un informe válido.
    pub exitosa: bool,
    pub nombre_vm: String,
    #[serde(default)]
    pub nombre_interno: Option<String>,
    pub ruta_carpeta: String,
    #[serde(default)]
    pub responsable: Option<String>,
    #[serde(skip)]
    pub tipo: Option<String>,
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

/// Forma de lectura compatible con los reportes generados antes de unificar
/// `asignado` y `elemento` bajo `responsable`.
#[derive(Deserialize)]
struct RegistroVMCompatible {
    exitosa: bool,
    nombre_vm: String,
    #[serde(default)]
    nombre_interno: Option<String>,
    ruta_carpeta: String,
    #[serde(default)]
    responsable: Option<String>,
    #[serde(default)]
    propietario: Option<String>,
    #[serde(default)]
    elemento_asignado: Option<String>,
    #[serde(default)]
    asignado: Option<String>,
    #[serde(default)]
    elemento: Option<String>,
    #[serde(default)]
    tipo: Option<String>,
    #[serde(default)]
    tipo_posesion: Option<String>,
    #[serde(default)]
    origen_categoria: Option<String>,
    sistema_operativo: String,
    #[serde(default)]
    hipervisor: Option<String>,
    peso_gb: f64,
    #[serde(default)]
    discrepante: bool,
    #[serde(default)]
    observaciones: Vec<String>,
    fecha_relevamiento: String,
    #[serde(default)]
    programas: Vec<ProgramaClasificado>,
    #[serde(default)]
    peso_bytes: u64,
}

impl<'de> Deserialize<'de> for RegistroVM {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = RegistroVMCompatible::deserialize(deserializer)?;
        Ok(Self {
            exitosa: value.exitosa,
            nombre_vm: value.nombre_vm,
            nombre_interno: value.nombre_interno,
            ruta_carpeta: value.ruta_carpeta,
            responsable: value
                .responsable
                .or(value.asignado)
                .or(value.elemento)
                .or(value.propietario)
                .or(value.elemento_asignado),
            tipo: value
                .tipo
                .or(value.tipo_posesion)
                .or(value.origen_categoria),
            sistema_operativo: value.sistema_operativo,
            hipervisor: value.hipervisor,
            peso_gb: value.peso_gb,
            discrepante: value.discrepante,
            observaciones: value.observaciones,
            fecha_relevamiento: value.fecha_relevamiento,
            programas: value.programas,
            peso_bytes: value.peso_bytes,
        })
    }
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

/// Duraciones agregadas del relevamiento. No contiene rutas, nombres de VM ni reportes.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct MetricasRelevamiento {
    pub discovery_ms: u128,
    pub batch_ms: u128,
    pub summary_mapping_ms: u128,
    pub serialization_ms: u128,
    pub ipc_ms: u64,
    pub store_update_ms: u128,
    /// Se mide en el frontend; el backend lo inicializa en cero.
    pub ui_render_ms: u128,
    pub total_ms: u128,
    pub selected_roots: usize,
    pub discovered_count: usize,
    pub unique_count: usize,
    pub reports_count: usize,
    pub errors_count: usize,
    pub inspections_count: usize,
    pub retries_count: usize,
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
    pub metricas: MetricasRelevamiento,
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
    pub responsable: Option<String>,
    /// Nombre de la subcarpeta directa del inventario que contiene el reporte.
    pub tipo: String,
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
    pub responsables_disponibles: Vec<String>,
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

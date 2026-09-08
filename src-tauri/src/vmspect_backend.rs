//! Integración única con el motor `vmspect`.
//!
//! Este módulo no conoce Tauri ni la interfaz gráfica. Traduce la configuración
//! de la aplicación al motor y expone la inspección para el inspector individual
//! y el relevamiento masivo.

use crate::models::ConfiguracionApp;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use vmspect::{InspectionEngine, InspectionProgressEvent, InspectionReport, Options, VmSpectError};

/// Construye las opciones de `vmspect` a partir de la configuración de la app.
pub fn construir_opciones(config: &ConfiguracionApp, cancelacion: &Arc<AtomicBool>) -> Options {
    let mut opciones = Options {
        include_system: config.incluir_system,
        force_nbd: config.forzar_qemu,
        ..Options::default()
    };

    if let Some(qemu) = config.ruta_qemu_nbd.as_deref() {
        if !qemu.trim().is_empty() {
            opciones.qemu_nbd = Some(PathBuf::from(qemu.trim()));
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

/// Ejecuta una inspección síncrona dentro del contexto bloqueante del llamador.
///
/// `vmspect` ya soporta cancelación mediante `Options::cancel_token`, por lo que
/// no hace falta crear otro hilo, canales ni un bucle de polling alrededor suyo.
pub fn inspeccionar<F>(
    ruta: &Path,
    opciones: Options,
    progreso: F,
) -> Result<InspectionReport, VmSpectError>
where
    F: FnMut(InspectionProgressEvent),
{
    InspectionEngine::new(opciones).inspect_with_progress(ruta, progreso)
}

#[cfg(test)]
mod tests {
    use super::construir_opciones;
    use crate::models::ConfiguracionApp;
    use std::path::Path;
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;

    #[test]
    fn deja_la_resolucion_y_ejecucion_de_qemu_en_vmspect() {
        let config = ConfiguracionApp {
            forzar_qemu: true,
            ruta_qemu_nbd: None,
            ..Default::default()
        };
        let cancelacion = Arc::new(AtomicBool::new(false));

        let opciones = construir_opciones(&config, &cancelacion);

        assert!(opciones.force_nbd);
        assert!(opciones.qemu_nbd.is_none());
    }

    #[test]
    fn solo_transmite_a_vmspect_la_ruta_explicita_configurada() {
        let config = ConfiguracionApp {
            ruta_qemu_nbd: Some("ruta/que/vmspect/debe/resolver".to_string()),
            ..Default::default()
        };
        let cancelacion = Arc::new(AtomicBool::new(false));

        let opciones = construir_opciones(&config, &cancelacion);

        assert_eq!(
            opciones.qemu_nbd.as_deref(),
            Some(Path::new("ruta/que/vmspect/debe/resolver"))
        );
    }
}

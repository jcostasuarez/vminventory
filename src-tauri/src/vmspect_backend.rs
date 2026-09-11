//! Integración única con el motor `vmspect`.
//!
//! Este módulo no conoce Tauri ni la interfaz gráfica. Traduce la configuración
//! de la aplicación al motor y expone la inspección para el inspector individual
//! y el relevamiento masivo.

use crate::models::ConfiguracionApp;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use vmspect::{CancellationToken, InspectionEngine, InspectionReport, Options, VmSpectError};

/// Construye las opciones de `vmspect` a partir de la configuración de la app.
pub fn construir_opciones(config: &ConfiguracionApp, cancelacion: &Arc<AtomicBool>) -> Options {
    let token = CancellationToken::from_arc(cancelacion.clone());
    let mut opciones = Options {
        include_system: config.incluir_system,
        force_nbd: config.forzar_qemu,
        ..Options::default()
    }
    .with_cancellation_token(&token)
    .with_nbd_max_sessions(2);

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

    opciones
}

/// Opciones para el listado inicial: conserva el resumen de cada VM y difiere
/// la extracción de programas hasta que el usuario abra una imagen concreta.
pub fn construir_opciones_resumen(
    config: &ConfiguracionApp,
    cancelacion: &Arc<AtomicBool>,
) -> Options {
    let mut opciones = construir_opciones(config, cancelacion);
    opciones.no_apps = true;
    opciones.force_nbd = false;
    opciones.nbd_max_sessions = 2;
    opciones
}

/// Ejecuta una inspección síncrona dentro del contexto bloqueante del llamador
/// usando un motor ya publicado por `AppState`.
///
/// `vmspect` mantiene el progreso en el propio `InspectionEngine`, por lo que el
/// frontend puede consultar su snapshot mientras esta llamada sigue bloqueada.
pub fn inspeccionar(
    engine: &InspectionEngine,
    ruta: &Path,
) -> Result<InspectionReport, VmSpectError> {
    engine.inspect(ruta)
}

#[cfg(test)]
mod tests {
    use super::{construir_opciones, construir_opciones_resumen};
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
        assert_eq!(opciones.nbd_max_sessions, 2);
        assert!(opciones.cancel_token.is_some());
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

    #[test]
    fn usa_dos_sesiones_nbd_y_no_fuerza_el_backend_por_defecto() {
        let cancelacion = Arc::new(AtomicBool::new(false));
        let opciones = construir_opciones_resumen(&ConfiguracionApp::default(), &cancelacion);

        assert_eq!(opciones.nbd_max_sessions, 2);
        assert!(!opciones.force_nbd);
        assert!(opciones.no_apps);
    }

    #[test]
    fn el_resumen_inicial_ignora_el_forzado_nbd_configurado() {
        let config = ConfiguracionApp {
            forzar_qemu: true,
            ..Default::default()
        };
        let cancelacion = Arc::new(AtomicBool::new(false));

        let opciones = construir_opciones_resumen(&config, &cancelacion);

        assert!(opciones.no_apps);
        assert!(!opciones.force_nbd);
        assert_eq!(opciones.nbd_max_sessions, 2);
    }
}

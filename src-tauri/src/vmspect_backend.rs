//! Integración única con el motor `vmspect`.
//!
//! Este módulo no conoce Tauri ni la interfaz gráfica. Traduce la configuración
//! de la aplicación al motor, resuelve `qemu-nbd` y expone la inspección para
//! el inspector individual y el relevamiento masivo.

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

    #[cfg(windows)]
    if opciones.qemu_nbd.is_none() {
        let ruta_predeterminada = PathBuf::from(r"C:\Program Files\qemu\qemu-nbd.exe");
        if ruta_predeterminada.is_file() {
            opciones.qemu_nbd = Some(ruta_predeterminada);
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

/// Resuelve el ejecutable `qemu-nbd` priorizando una ruta explícita, la variable
/// `QEMU_NBD` y la resolución nativa del motor.
pub fn resolver_qemu_nbd(explicita: Option<&Path>) -> Result<PathBuf, String> {
    if let Some(ruta) = explicita {
        if ruta.is_file() {
            return Ok(ruta.to_path_buf());
        }
        return Err(format!(
            "No existe el archivo especificado: {}",
            ruta.display()
        ));
    }

    #[cfg(windows)]
    {
        for ruta in [
            PathBuf::from(r"C:\Program Files\qemu\qemu-nbd.exe"),
            PathBuf::from(r"C:\Program Files (x86)\qemu\qemu-nbd.exe"),
        ] {
            if ruta.is_file() {
                return Ok(ruta);
            }
        }
    }

    if let Ok(valor) = std::env::var("QEMU_NBD") {
        let ruta = PathBuf::from(valor);
        if ruta.is_file() {
            return Ok(ruta);
        }
    }

    match vmspect::vms::nbd::resolve_qemu_nbd(None) {
        Ok(ruta) => Ok(ruta),
        Err(error) => {
            #[cfg(windows)]
            {
                Err(format!(
                    "No se halló qemu-nbd en rutas estándar ni en el PATH: {error}"
                ))
            }
            #[cfg(not(windows))]
            {
                Err(format!(
                    "No se halló qemu-nbd en PATH ni rutas estándar: {error}"
                ))
            }
        }
    }
}

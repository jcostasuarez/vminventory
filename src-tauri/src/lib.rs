//! VM Inventory — Backend Tauri v2.
//! Relevamiento e inspección estática de máquinas virtuales sobre el motor `vmspect`.

pub mod clasificacion;
mod commands;
pub mod consultor;
pub mod models;
pub mod relevamiento;
mod vmspect_backend;

use commands::{
    abrir_carpeta, consultar_software_en_jsons, detener_inspeccion, exportar_informe_individual,
    inspeccionar_disco_vm, obtener_diagnostico, obtener_informacion_reglas, obtener_version_app,
    probar_clasificacion_software, procesar_relevamiento, ventana_cerrar,
    ventana_maximizar_restaurar, ventana_minimizar,
};
use models::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            // Relevamiento masivo y cancelación
            procesar_relevamiento,
            detener_inspeccion,
            // Inspección directa de discos
            inspeccionar_disco_vm,
            // Consultor de software
            consultar_software_en_jsons,
            exportar_informe_individual,
            // Versión y diagnóstico del sistema
            obtener_version_app,
            obtener_diagnostico,
            // Reglas de clasificación
            obtener_informacion_reglas,
            probar_clasificacion_software,
            // Utilidades del sistema
            abrir_carpeta,
            // Controles de ventana sin marco
            ventana_minimizar,
            ventana_maximizar_restaurar,
            ventana_cerrar,
        ])
        .setup(|app| {
            // Inicialización automática de archivo de reglas si no existe
            let _ = clasificacion::asegurar_archivo_predeterminado();

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.maximize();
                #[cfg(debug_assertions)]
                {
                    window.open_devtools();
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

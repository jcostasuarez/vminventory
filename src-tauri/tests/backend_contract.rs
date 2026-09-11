//! Contratos backend independientes de Tauri, QEMU y del sistema anfitrión.

use app_lib::clasificacion::{
    coincide_patron, CategoriaReglas, ClasificacionSoftware, EntradaPatron, ExclusionesConfig,
    ReglasArchivo, ReglasClasificacion,
};
use app_lib::consultor::{sanitizar_opcion, texto_coincide, FiltrosConsultor};
use app_lib::models::AppState;
use app_lib::relevamiento::formatear_duracion;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

struct TemporaryDirectory {
    path: PathBuf,
}

impl TemporaryDirectory {
    fn new(label: &str) -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("El reloj del sistema debe ser posterior a la época Unix")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "vminventory-contract-{label}-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).expect("Debe poder crearse el directorio temporal");
        Self { path }
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TemporaryDirectory {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

#[test]
fn el_motor_de_patrones_y_reglas_es_determinista() {
    assert!(coincide_patron("Example Agent", "*agent"));
    assert!(coincide_patron("release-42", r"^release-\d+$"));
    assert!(!coincide_patron("Digital Assistant", "git"));

    let exclusiones = ExclusionesConfig {
        folders: vec!["cache".to_string()],
        files: vec!["*.temporary".to_string()],
    };
    assert!(exclusiones.es_carpeta_excluida("CACHE"));
    assert!(exclusiones.es_archivo_excluido("snapshot.temporary"));
    assert!(!exclusiones.es_archivo_excluido("snapshot.data"));

    let reglas = ReglasClasificacion::desde_configuracion(
        "fixture",
        ReglasArchivo {
            exclusions: ExclusionesConfig::default(),
            classifications: vec![ClasificacionSoftware {
                vendor: None,
                software: "Analytics Client".to_string(),
                patterns: vec!["*Analytics*".to_string()],
                category: Some("Analytics".to_string()),
                tags: vec!["data".to_string()],
            }],
            whitelist: vec![EntradaPatron {
                patron: "Critical Tool".to_string(),
                editor: None,
                motivo: "Fixture prioritario".to_string(),
            }],
            noise: vec![EntradaPatron {
                patron: "Telemetry Agent".to_string(),
                editor: None,
                motivo: "Fixture no relevante".to_string(),
            }],
            categories: vec![CategoriaReglas {
                nombre: "Utilities".to_string(),
                patrones: vec!["*Utility*".to_string()],
                tags: vec!["utility".to_string()],
            }],
        },
    );

    let whitelisted = reglas.clasificar("Critical Tool", None);
    assert!(whitelisted.es_relevante);
    assert!(whitelisted.es_whitelist);

    let ignored = reglas.clasificar("Telemetry Agent", None);
    assert!(!ignored.es_relevante);

    let classified = reglas.clasificar("Analytics Client", None);
    assert!(classified.es_relevante);
    assert_eq!(classified.categoria.as_deref(), Some("Analytics"));
    assert_eq!(classified.tags, vec!["data"]);
}

#[test]
fn normaliza_filtros_y_valores_de_dominio_sin_asumir_plataforma() {
    let filters = FiltrosConsultor::nuevo(
        Some("  Example  ".to_string()),
        Some(" 1.2 ".to_string()),
        Some("todos".to_string()),
        Some("todas".to_string()),
        Some("-".to_string()),
    );

    assert!(filters.hay_filtros_activos());
    assert_eq!(filters.programa.as_deref(), Some("example"));
    assert_eq!(filters.version.as_deref(), Some("1.2"));
    assert_eq!(filters.vm, None);
    assert_eq!(filters.tipo, None);
    assert_eq!(filters.responsable, None);

    assert!(texto_coincide("Example_VM", "example vm"));
    assert_eq!(sanitizar_opcion(Some(" undefined ")), None);
    assert_eq!(
        sanitizar_opcion(Some("Responsable")),
        Some("Responsable".to_string())
    );
}

#[test]
fn mantiene_el_estado_de_cancelacion_y_los_formatos_compartidos() {
    let state = AppState::default();
    assert!(!state
        .cancel_requested
        .load(std::sync::atomic::Ordering::Relaxed));

    state.solicitar_cancelacion();
    assert!(state
        .cancel_requested
        .load(std::sync::atomic::Ordering::Relaxed));

    let operacion = state.iniciar_tarea().expect("debe iniciar la operación");
    assert!(!state
        .cancel_requested
        .load(std::sync::atomic::Ordering::Relaxed));
    drop(operacion);

    assert_eq!(formatear_duracion(0), "00:00");
    assert_eq!(formatear_duracion(65), "01:05");
    assert_eq!(formatear_duracion(3665), "1:01:05");
}

#[test]
fn consulta_reportes_json_sinteticos_entrega_el_contrato_del_consultor() {
    let directory = TemporaryDirectory::new("query");
    let tipo = directory.path().join("Operaciones");
    std::fs::create_dir_all(&tipo).expect("Debe crearse el tipo dinámico");
    let report = tipo.join("cluster_a.json");
    let content = r#"
    [
      {
        "exitosa": true,
        "nombre_vm": "vm-alpha",
        "nombre_interno": null,
        "ruta_carpeta": "portable/vm-alpha",
        "propietario": "team-alpha",
        "tipo_posesion": "servers",
        "elemento_asignado": null,
        "origen_categoria": "servers",
        "asignado": null,
        "elemento": "cluster-a",
        "sistema_operativo": "generic-os",
        "hipervisor": "generic-hypervisor",
        "peso_gb": 10.0,
        "discrepante": false,
        "observaciones": [],
        "fecha_relevamiento": "2026-01-01",
        "programas": [
          {
            "nombre": "Example Service",
            "version": "1.2.3",
            "editor": "Example Vendor",
            "categoria": "Service",
            "tags": ["service", "example"],
            "relevante": true
          }
        ]
      },
      {
        "exitosa": true,
        "nombre_vm": "vm-beta",
        "nombre_interno": null,
        "ruta_carpeta": "portable/vm-beta",
        "propietario": "team-beta",
        "tipo_posesion": "workgroup",
        "elemento_asignado": null,
        "origen_categoria": "workgroup",
        "asignado": null,
        "elemento": "pool-b",
        "sistema_operativo": "generic-os",
        "hipervisor": "generic-hypervisor",
        "peso_gb": 5.0,
        "discrepante": false,
        "observaciones": [],
        "fecha_relevamiento": "2026-01-01",
        "programas": [
          {
            "nombre": "Example Tool",
            "version": "2.0.0",
            "editor": "Example Vendor",
            "categoria": "Tool",
            "tags": ["tool", "example"],
            "relevante": true
          }
        ]
      }
    ]
    "#;
    std::fs::write(&report, content).expect("Debe escribirse el fixture JSON");

    let all = app_lib::consultor::consultar_software_inventario(
        directory.path().to_str().expect("Ruta temporal válida"),
        None,
        None,
        None,
        None,
        None,
    )
    .expect("El consultor debe leer el fixture");

    assert_eq!(all.total_archivos_json, 1);
    assert_eq!(all.total_vms_escaneadas, 2);
    assert_eq!(all.total_programas_indexados, 2);
    assert_eq!(all.tipos_disponibles, vec!["Operaciones"]);
    assert!(all.coincidencias.is_empty());

    let filtered = app_lib::consultor::consultar_software_inventario(
        directory.path().to_str().expect("Ruta temporal válida"),
        Some("Example Service".to_string()),
        None,
        None,
        None,
        None,
    )
    .expect("El filtro por programa debe ser válido");

    assert_eq!(filtered.versiones_disponibles, vec!["1.2.3"]);
    assert_eq!(filtered.coincidencias.len(), 1);
    assert_eq!(filtered.coincidencias[0].nombre_vm, "vm-alpha");
    assert_eq!(filtered.coincidencias[0].tipo, "Operaciones");
    assert_eq!(
        filtered.coincidencias[0].responsable.as_deref(),
        Some("cluster a")
    );

    let by_owner = app_lib::consultor::consultar_software_inventario(
        directory.path().to_str().expect("Ruta temporal válida"),
        None,
        None,
        None,
        None,
        Some("cluster a".to_string()),
    )
    .expect("El filtro por responsable debe ser válido");
    assert_eq!(by_owner.coincidencias.len(), 2);
    assert!(by_owner
        .coincidencias
        .iter()
        .any(|item| item.nombre_programa == "Example Tool"));
}

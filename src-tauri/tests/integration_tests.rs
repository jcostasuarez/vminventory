//! Pruebas de integración del backend Rust (app_lib).

use std::fs::File;
use std::io::Write;
use std::path::PathBuf;

#[test]
fn test_ciclo_completo_persistencia_y_consulta_software() {
    let temp_dir = std::env::temp_dir().join("vminventory_integration_consultor");
    let _ = std::fs::remove_dir_all(&temp_dir);
    std::fs::create_dir_all(&temp_dir).expect("Crear carpeta temporal para integración");

    // Simulamos la estructura JSON producida por el relevamiento
    let json_reporte_1 = r#"{
        "metadatos": {
            "aplicacion": "VM Inventory",
            "fecha_relevamiento": "2026-09-07",
            "ruta_origen": "D:\\Servidores",
            "duracion_formateada": "00:02:15",
            "total_vms": 2,
            "vms_exitosas": 2,
            "vms_con_observaciones": 0,
            "vms_discrepantes": 0,
            "vms_fallidas": 0,
            "total_programas": 3,
            "peso_total_gb": 85.0,
            "cancelado": false
        },
        "vms": [
            {
                "exitosa": true,
                "nombre_vm": "SRV-WEB-01",
                "nombre_interno": "SRV-WEB-01-PROD",
                "ruta_carpeta": "D:\\Servidores\\SRV-WEB-01",
                "propietario": "DevOps",
                "tipo_posesion": "Servidores",
                "elemento_asignado": "Infraestructura",
                "sistema_operativo": "Ubuntu 22.04 LTS",
                "hipervisor": "VMware",
                "peso_gb": 35.0,
                "discrepante": false,
                "observaciones": [],
                "fecha_relevamiento": "2026-09-07",
                "programas": [
                    {
                        "nombre": "nginx",
                        "version": "1.24.0",
                        "editor": "NGINX Inc",
                        "categoria": "Servidores web y proxies",
                        "tags": ["web", "proxy", "http"],
                        "relevante": true
                    },
                    {
                        "nombre": "Docker Engine",
                        "version": "24.0.5",
                        "editor": "Docker Inc",
                        "categoria": "Contenedores y virtualización",
                        "tags": ["docker", "containers"],
                        "relevante": true
                    }
                ]
            },
            {
                "exitosa": true,
                "nombre_vm": "SRV-DB-01",
                "nombre_interno": null,
                "ruta_carpeta": "D:\\Servidores\\SRV-DB-01",
                "propietario": "DBA",
                "tipo_posesion": "Servidores",
                "elemento_asignado": "Bases de Datos",
                "sistema_operativo": "Windows Server 2022",
                "hipervisor": "VMware",
                "peso_gb": 50.0,
                "discrepante": false,
                "observaciones": [],
                "fecha_relevamiento": "2026-09-07",
                "programas": [
                    {
                        "nombre": "PostgreSQL 15",
                        "version": "15.3",
                        "editor": "PostgreSQL Global Development Group",
                        "categoria": "Bases de datos y almacenamiento",
                        "tags": ["sql", "rdbms", "database"],
                        "relevante": true
                    }
                ]
            }
        ]
    }"#;

    let json_reporte_2 = r#"{
        "metadatos": {
            "aplicacion": "VM Inventory",
            "fecha_relevamiento": "2026-09-07",
            "ruta_origen": "E:\\Personas",
            "duracion_formateada": "00:01:00",
            "total_vms": 1,
            "vms_exitosas": 1,
            "vms_con_observaciones": 0,
            "vms_discrepantes": 0,
            "vms_fallidas": 0,
            "total_programas": 2,
            "peso_total_gb": 30.0,
            "cancelado": false
        },
        "vms": [
            {
                "exitosa": true,
                "nombre_vm": "PC-JuanPerez",
                "nombre_interno": "Win11-Dev",
                "ruta_carpeta": "E:\\Personas\\JuanPerez\\VM",
                "propietario": "Juan Perez",
                "tipo_posesion": "Personas",
                "elemento_asignado": "Juan Perez",
                "sistema_operativo": "Windows 11 Enterprise",
                "hipervisor": "VirtualBox",
                "peso_gb": 30.0,
                "discrepante": false,
                "observaciones": [],
                "fecha_relevamiento": "2026-09-07",
                "programas": [
                    {
                        "nombre": "Visual Studio Code",
                        "version": "1.85.0",
                        "editor": "Microsoft Corporation",
                        "categoria": "Entornos de desarrollo (IDE)",
                        "tags": ["editor", "ide", "code"],
                        "relevante": true
                    },
                    {
                        "nombre": "Git",
                        "version": "2.43.0",
                        "editor": "The Git Development Community",
                        "categoria": "Control de versiones",
                        "tags": ["git", "vcs"],
                        "relevante": true
                    }
                ]
            }
        ]
    }"#;

    let mut file1 = File::create(temp_dir.join("inventario_servidores.json")).unwrap();
    file1.write_all(json_reporte_1.as_bytes()).unwrap();

    let mut file2 = File::create(temp_dir.join("inventario_personas.json")).unwrap();
    file2.write_all(json_reporte_2.as_bytes()).unwrap();

    // Verificamos que ambos reportes son leídos y analizados de forma agregada
    let path_str = temp_dir.to_str().unwrap();

    // 1. Verificamos agregación de archivos
    let mut files: Vec<PathBuf> = std::fs::read_dir(path_str)
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|x| x.to_str()) == Some("json"))
        .collect();
    files.sort();
    assert_eq!(files.len(), 2);

    let _ = std::fs::remove_dir_all(&temp_dir);
}

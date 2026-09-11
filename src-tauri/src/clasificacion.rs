//! # Motor de Clasificación y Filtrado de Software
//! Sistema dinámico de reglas desacoplado que decide qué software se incluye en los
//! reportes, cómo se categoriza/etiqueta y qué carpetas o archivos se excluyen
//! durante el relevamiento de imágenes de disco.
//!
//! Las reglas se cargan dinámicamente desde un archivo `rules.json` (o `rules.toml`)
//! editable por el usuario en `%APPDATA%\VMInventory\rules.json` o en el directorio
//! de la aplicación. Si el archivo no existe, se genera automáticamente con los
//! patrones por defecto.

use crate::models::{InfoReglas, ResultadoClasificacion};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

// ============================================================================
// ESTRUCTURAS DE CONFIGURACIÓN Y MODELO DE REGLAS
// ============================================================================

/// Patrones de exclusión de carpetas y archivos para el escaneo de imágenes.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct ExclusionesConfig {
    #[serde(default)]
    pub folders: Vec<String>,
    #[serde(default)]
    pub files: Vec<String>,
}

impl ExclusionesConfig {
    /// Determina si un nombre de carpeta o segmento de ruta debe ser omitido.
    pub fn es_carpeta_excluida(&self, nombre_o_ruta: &str) -> bool {
        let nombre = nombre_o_ruta.trim();
        if nombre.is_empty() {
            return false;
        }
        self.folders
            .iter()
            .any(|patron| coincide_patron(nombre, patron))
    }

    /// Determina si un archivo debe ser omitido durante el escaneo.
    pub fn es_archivo_excluido(&self, nombre_archivo: &str) -> bool {
        let nombre = nombre_archivo.trim();
        if nombre.is_empty() {
            return false;
        }
        self.files
            .iter()
            .any(|patron| coincide_patron(nombre, patron))
    }
}

/// Regla de clasificación de software industrial o corporativo específico.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ClasificacionSoftware {
    #[serde(default)]
    pub vendor: Option<String>,
    #[serde(default)]
    pub software: String,
    #[serde(default)]
    pub patterns: Vec<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

/// Entrada de patrón de coincidencia (whitelist o ruido).
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct EntradaPatron {
    #[serde(default, alias = "nombre")]
    pub patron: String,
    #[serde(default, alias = "vendor", alias = "fabricante")]
    pub editor: Option<String>,
    #[serde(default, alias = "reason", alias = "descripcion")]
    pub motivo: String,
}

/// Categoría temática con patrones de nombres y etiquetas asociadas.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct CategoriaReglas {
    pub nombre: String,
    #[serde(default)]
    pub patrones: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

/// Estructura de serialización / deserialización del archivo de reglas (`rules.json` o `rules.toml`).
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct ReglasArchivo {
    #[serde(default)]
    pub exclusions: ExclusionesConfig,
    #[serde(default)]
    pub classifications: Vec<ClasificacionSoftware>,
    #[serde(default)]
    pub whitelist: Vec<EntradaPatron>,
    #[serde(default, alias = "ruido")]
    pub noise: Vec<EntradaPatron>,
    #[serde(default, alias = "categoria", alias = "categorias")]
    pub categories: Vec<CategoriaReglas>,
}

/// Conjunto completo de reglas de clasificación cargado en memoria.
///
/// Si se modifican directamente sus colecciones públicas, se debe llamar a
/// [`ReglasClasificacion::recompilar_matchers`] antes de volver a clasificar.
#[derive(Clone, Debug)]
pub struct ReglasClasificacion {
    pub origen: String,
    pub exclusions: ExclusionesConfig,
    pub classifications: Vec<ClasificacionSoftware>,
    pub whitelist: Vec<EntradaPatron>,
    pub ruido: Vec<EntradaPatron>,
    pub categorias: Vec<CategoriaReglas>,
    compiladas: ReglasCompiladas,
}

/// Instantánea inmutable de los matchers de una configuración de reglas.
///
/// Se construye una vez al cargar o crear las reglas y no requiere
/// sincronización durante la clasificación.
#[derive(Clone, Debug)]
struct ReglasCompiladas {
    exclusiones: ExclusionesCompiladas,
    clasificaciones: Vec<ClasificacionSoftwareCompilada>,
    whitelist: Vec<EntradaPatronCompilada>,
    ruido: Vec<EntradaPatronCompilada>,
    categorias: Vec<CategoriaReglasCompilada>,
}

#[derive(Clone, Debug)]
struct ExclusionesCompiladas {
    carpetas: Vec<PatronCompilado>,
    archivos: Vec<PatronCompilado>,
}

#[derive(Clone, Debug)]
struct ClasificacionSoftwareCompilada {
    vendor: Option<PatronCompilado>,
    software: String,
    patrones: Vec<PatronCompilado>,
    categoria: Option<String>,
    tags: Vec<String>,
}

#[derive(Clone, Debug)]
struct EntradaPatronCompilada {
    patron: PatronCompilado,
    editor: Option<PatronCompilado>,
    motivo: String,
}

#[derive(Clone, Debug)]
struct CategoriaReglasCompilada {
    nombre: String,
    patrones: Vec<PatronCompilado>,
    tags: Vec<String>,
}

#[derive(Clone, Debug)]
struct PatronCompilado {
    original: String,
    matcher: MatcherPatron,
}

#[derive(Clone, Debug)]
enum MatcherPatron {
    Vacio,
    Regex(regex::Regex),
    Palabra { normalizado: String },
    Subcadena { normalizado: String },
}

#[derive(Clone, Debug)]
struct DiagnosticoPatron {
    contexto: String,
    patron: String,
    detalle: String,
}

// ============================================================================
// RESOLUCIÓN DE RUTAS Y AUTO-GENERACIÓN DE ARCHIVO
// ============================================================================

/// Resuelve la ruta predeterminada para el archivo `rules.json`.
/// Prioridades:
/// 1. `rules.json` en el directorio actual de ejecución.
/// 2. `rules.json` en el directorio del binario ejecutable.
/// 3. `%APPDATA%\VMInventory\rules.json` (Windows) o `~/.config/vminventory/rules.json` (Linux/macOS).
pub fn ruta_archivo_predeterminado() -> PathBuf {
    let local_json = PathBuf::from("rules.json");
    if local_json.is_file() {
        return local_json;
    }

    let local_toml = PathBuf::from("rules.toml");
    if local_toml.is_file() {
        return local_toml;
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let exe_json = parent.join("rules.json");
            if exe_json.is_file() {
                return exe_json;
            }
        }
    }

    #[cfg(windows)]
    {
        if let Some(appdata) = std::env::var_os("APPDATA") {
            let app_dir = PathBuf::from(appdata).join("VMInventory");
            return app_dir.join("rules.json");
        }
    }

    #[cfg(not(windows))]
    {
        if let Some(home) = std::env::var_os("HOME") {
            let config_dir = PathBuf::from(home).join(".config").join("vminventory");
            return config_dir.join("rules.json");
        }
    }

    PathBuf::from("rules.json")
}

/// Asegura que el archivo `rules.json` exista en la ubicación predeterminada.
/// Si no existe, lo crea automáticamente con la plantilla por defecto.
pub fn asegurar_archivo_predeterminado() -> PathBuf {
    let ruta = ruta_archivo_predeterminado();
    if !ruta.is_file() {
        if let Some(padre) = ruta.parent() {
            let _ = std::fs::create_dir_all(padre);
        }
        let contenido = plantilla_json_predeterminada();
        let _ = std::fs::write(&ruta, contenido);
    }
    ruta
}

/// Devuelve la plantilla JSON por defecto formateada para producción.
pub fn plantilla_json_predeterminada() -> String {
    let archivo = ReglasClasificacion::configuracion_integrada();
    serde_json::to_string_pretty(&archivo)
        .unwrap_or_else(|_| "{\n  \"exclusions\": {},\n  \"classifications\": []\n}".to_string())
}

// ============================================================================
// IMPLEMENTACIÓN DE REGLAS
// ============================================================================

impl ReglasClasificacion {
    /// Define las reglas integradas de fábrica antes de compilar sus matchers.
    fn configuracion_integrada() -> ReglasArchivo {
        let exclusions = ExclusionesConfig {
            folders: vec![
                "System Volume Information".to_string(),
                "$RECYCLE.BIN".to_string(),
                "$Recycle.Bin".to_string(),
                "RECYCLER".to_string(),
                "Temp".to_string(),
                "tmp".to_string(),
                "$WinREAgent".to_string(),
                ".git".to_string(),
                ".svn".to_string(),
                "node_modules".to_string(),
            ],
            files: vec![
                "*.tmp".to_string(),
                "*.temp".to_string(),
                "*.pagefile".to_string(),
                "*.sys".to_string(),
                "*.log".to_string(),
                "*.iso".to_string(),
                "*.bak".to_string(),
                "*.swp".to_string(),
            ],
        };

        let classifications = vec![
            ClasificacionSoftware {
                vendor: Some("Siemens".to_string()),
                software: "SIMATIC STEP 7".to_string(),
                patterns: vec![
                    "s7dbg.exe".to_string(),
                    "s7tgtopx.exe".to_string(),
                    "*Step7*".to_string(),
                    "*Simatic*".to_string(),
                    "Step 7*".to_string(),
                ],
                category: Some("Automatización Industrial".to_string()),
                tags: vec![
                    "plc".to_string(),
                    "siemens".to_string(),
                    "step7".to_string(),
                    "industrial".to_string(),
                ],
            },
            ClasificacionSoftware {
                vendor: Some("Siemens".to_string()),
                software: "TIA Portal".to_string(),
                patterns: vec![
                    "*TIA Portal*".to_string(),
                    "*Siemens.Automation.Portal*".to_string(),
                    "Siemens.Automation.Portal.exe".to_string(),
                ],
                category: Some("Automatización Industrial".to_string()),
                tags: vec![
                    "plc".to_string(),
                    "hmi".to_string(),
                    "scada".to_string(),
                    "siemens".to_string(),
                    "tia-portal".to_string(),
                ],
            },
            ClasificacionSoftware {
                vendor: Some("Siemens".to_string()),
                software: "SIMATIC WinCC".to_string(),
                patterns: vec![
                    "*WinCC*".to_string(),
                    "*SIMATIC WinCC*".to_string(),
                    "WinCCExplorer.exe".to_string(),
                ],
                category: Some("SCADA & HMI".to_string()),
                tags: vec![
                    "scada".to_string(),
                    "hmi".to_string(),
                    "siemens".to_string(),
                    "wincc".to_string(),
                ],
            },
            ClasificacionSoftware {
                vendor: Some("Rockwell Automation".to_string()),
                software: "Studio 5000 Logix Designer".to_string(),
                patterns: vec![
                    "*Studio 5000*".to_string(),
                    "*Studio 5K*".to_string(),
                    "*LogixDesigner*".to_string(),
                    "LogixDesigner.exe".to_string(),
                ],
                category: Some("Automatización Industrial".to_string()),
                tags: vec![
                    "plc".to_string(),
                    "rockwell".to_string(),
                    "allen-bradley".to_string(),
                    "studio5000".to_string(),
                ],
            },
            ClasificacionSoftware {
                vendor: Some("Rockwell Automation".to_string()),
                software: "RSLogix 500 / 5000".to_string(),
                patterns: vec![
                    "*RSLogix 500*".to_string(),
                    "*RSLogix 5000*".to_string(),
                    "*RSLogix*".to_string(),
                    "rs500.exe".to_string(),
                    "rs5000.exe".to_string(),
                ],
                category: Some("Automatización Industrial".to_string()),
                tags: vec![
                    "plc".to_string(),
                    "rockwell".to_string(),
                    "allen-bradley".to_string(),
                    "rslogix".to_string(),
                ],
            },
            ClasificacionSoftware {
                vendor: Some("Rockwell Automation".to_string()),
                software: "FactoryTalk View".to_string(),
                patterns: vec![
                    "*FactoryTalk*".to_string(),
                    "*FactoryTalk View*".to_string(),
                    "FTViewStudio.exe".to_string(),
                    "FTViewME.exe".to_string(),
                ],
                category: Some("SCADA & HMI".to_string()),
                tags: vec![
                    "scada".to_string(),
                    "hmi".to_string(),
                    "rockwell".to_string(),
                    "factorytalk".to_string(),
                ],
            },
            ClasificacionSoftware {
                vendor: Some("Schneider Electric".to_string()),
                software: "EcoStruxure Control Expert (Unity Pro)".to_string(),
                patterns: vec![
                    "*EcoStruxure*".to_string(),
                    "*Unity Pro*".to_string(),
                    "*Schneider Electric*".to_string(),
                    "UnityPro.exe".to_string(),
                ],
                category: Some("Automatización Industrial".to_string()),
                tags: vec![
                    "plc".to_string(),
                    "schneider".to_string(),
                    "modicon".to_string(),
                    "unity-pro".to_string(),
                ],
            },
            ClasificacionSoftware {
                vendor: Some("Schneider Electric".to_string()),
                software: "Citect SCADA / Plant SCADA".to_string(),
                patterns: vec![
                    "*Citect*".to_string(),
                    "*Plant SCADA*".to_string(),
                    "Citect32.exe".to_string(),
                ],
                category: Some("SCADA & HMI".to_string()),
                tags: vec![
                    "scada".to_string(),
                    "schneider".to_string(),
                    "citect".to_string(),
                ],
            },
            ClasificacionSoftware {
                vendor: Some("AVEVA / Wonderware".to_string()),
                software: "InTouch HMI".to_string(),
                patterns: vec![
                    "*InTouch*".to_string(),
                    "*Wonderware*".to_string(),
                    "*AVEVA*".to_string(),
                    "view.exe".to_string(),
                    "intouch.exe".to_string(),
                ],
                category: Some("SCADA & HMI".to_string()),
                tags: vec![
                    "scada".to_string(),
                    "hmi".to_string(),
                    "wonderware".to_string(),
                    "aveva".to_string(),
                ],
            },
            ClasificacionSoftware {
                vendor: Some("Omron".to_string()),
                software: "Sysmac Studio".to_string(),
                patterns: vec![
                    "*Sysmac Studio*".to_string(),
                    "*Sysmac*".to_string(),
                    "SysmacStudio.exe".to_string(),
                ],
                category: Some("Automatización Industrial".to_string()),
                tags: vec![
                    "plc".to_string(),
                    "hmi".to_string(),
                    "omron".to_string(),
                    "motion".to_string(),
                ],
            },
            ClasificacionSoftware {
                vendor: Some("Omron".to_string()),
                software: "CX-Programmer / CX-One".to_string(),
                patterns: vec![
                    "*CX-Programmer*".to_string(),
                    "*CX-One*".to_string(),
                    "*CX-Supervisor*".to_string(),
                    "cx-p.exe".to_string(),
                ],
                category: Some("Automatización Industrial".to_string()),
                tags: vec!["plc".to_string(), "omron".to_string(), "cx-one".to_string()],
            },
            ClasificacionSoftware {
                vendor: Some("Mitsubishi Electric".to_string()),
                software: "GX Works2 / GX Works3".to_string(),
                patterns: vec![
                    "*GX Works*".to_string(),
                    "*GX Developer*".to_string(),
                    "*MELSOFT*".to_string(),
                    "GD3.exe".to_string(),
                ],
                category: Some("Automatización Industrial".to_string()),
                tags: vec![
                    "plc".to_string(),
                    "mitsubishi".to_string(),
                    "melsoft".to_string(),
                ],
            },
            ClasificacionSoftware {
                vendor: Some("ABB".to_string()),
                software: "Automation Builder".to_string(),
                patterns: vec![
                    "*Automation Builder*".to_string(),
                    "*ABB Control Builder*".to_string(),
                    "*RobotStudio*".to_string(),
                ],
                category: Some("Automatización Industrial".to_string()),
                tags: vec!["plc".to_string(), "robotica".to_string(), "abb".to_string()],
            },
            ClasificacionSoftware {
                vendor: Some("Beckhoff".to_string()),
                software: "TwinCAT".to_string(),
                patterns: vec![
                    "*TwinCAT*".to_string(),
                    "*TC3*".to_string(),
                    "TcXaeShell.exe".to_string(),
                ],
                category: Some("Automatización Industrial".to_string()),
                tags: vec![
                    "plc".to_string(),
                    "beckhoff".to_string(),
                    "twincat".to_string(),
                    "softplc".to_string(),
                ],
            },
            ClasificacionSoftware {
                vendor: Some("Inductive Automation".to_string()),
                software: "Ignition SCADA".to_string(),
                patterns: vec![
                    "*Ignition*".to_string(),
                    "*Ignition Gateway*".to_string(),
                    "*Inductive Automation*".to_string(),
                ],
                category: Some("SCADA & HMI".to_string()),
                tags: vec![
                    "scada".to_string(),
                    "hmi".to_string(),
                    "iiot".to_string(),
                    "ignition".to_string(),
                ],
            },
            ClasificacionSoftware {
                vendor: Some("GE Digital / Emerson".to_string()),
                software: "iFIX / CIMPLICITY / PAC Machine Edition".to_string(),
                patterns: vec![
                    "*iFIX*".to_string(),
                    "*CIMPLICITY*".to_string(),
                    "*Proficy*".to_string(),
                    "*Machine Edition*".to_string(),
                ],
                category: Some("SCADA & HMI".to_string()),
                tags: vec![
                    "scada".to_string(),
                    "hmi".to_string(),
                    "ge".to_string(),
                    "emerson".to_string(),
                    "proficy".to_string(),
                ],
            },
            ClasificacionSoftware {
                vendor: Some("CODESYS".to_string()),
                software: "CODESYS Development System".to_string(),
                patterns: vec!["*CODESYS*".to_string(), "CODESYS.exe".to_string()],
                category: Some("Automatización Industrial".to_string()),
                tags: vec![
                    "plc".to_string(),
                    "iec61131".to_string(),
                    "codesys".to_string(),
                ],
            },
            ClasificacionSoftware {
                vendor: Some("National Instruments".to_string()),
                software: "LabVIEW".to_string(),
                patterns: vec![
                    "*LabVIEW*".to_string(),
                    "*National Instruments*".to_string(),
                    "LabVIEW.exe".to_string(),
                ],
                category: Some("Automatización Industrial".to_string()),
                tags: vec![
                    "daas".to_string(),
                    "instrumentacion".to_string(),
                    "ni".to_string(),
                    "labview".to_string(),
                ],
            },
        ];

        let whitelist = vec![
            entrada(
                "microsoft office",
                Some("Microsoft"),
                "Suite ofimática corporativa estándar.",
            ),
            entrada(
                "microsoft 365",
                Some("Microsoft"),
                "Suscripción ofimática corporativa estándar.",
            ),
            entrada(
                "adobe acrobat",
                Some("Adobe"),
                "Lector/editor de PDF estándar de la organización.",
            ),
            entrada(
                "autocad",
                Some("Autodesk"),
                "Herramienta de diseño asistido (CAD) crítica.",
            ),
            entrada(
                "visual studio",
                Some("Microsoft"),
                "Entorno de desarrollo corporativo prioritario.",
            ),
            entrada(
                "sql server",
                Some("Microsoft"),
                "Motor de base de datos corporativo prioritario.",
            ),
            entrada(
                "vmware tools",
                Some("VMware"),
                "Stack de integración de VMware: revela la plataforma de la VM.",
            ),
            entrada(
                "virtualbox guest additions",
                Some("Oracle"),
                "Stack de integración de VirtualBox: revela la plataforma de la VM.",
            ),
            entrada(
                "eset",
                Some("ESET"),
                "Endpoint de seguridad corporativo obligatorio.",
            ),
            entrada(
                "kaspersky",
                Some("Kaspersky"),
                "Endpoint de seguridad corporativo obligatorio.",
            ),
            entrada(
                "mcafee",
                Some("McAfee"),
                "Endpoint de seguridad corporativo obligatorio.",
            ),
            entrada(
                "sophos",
                Some("Sophos"),
                "Endpoint de seguridad corporativo obligatorio.",
            ),
            entrada(
                "trend micro",
                Some("Trend Micro"),
                "Endpoint de seguridad corporativo obligatorio.",
            ),
            entrada(
                "forticlient",
                Some("Fortinet"),
                "Cliente VPN/seguridad corporativo obligatorio.",
            ),
            entrada(
                "globalprotect",
                Some("Palo Alto"),
                "Cliente VPN/seguridad corporativo obligatorio.",
            ),
        ];

        let ruido = vec![
            entrada(
                "redistributable",
                None,
                "Componente redistribuible de runtime (VC++).",
            ),
            entrada(
                "runtime",
                None,
                "Runtime de plataforma (.NET, Java, Edge WebView).",
            ),
            entrada(
                "microsoft .net framework",
                None,
                "Plataforma de ejecución del sistema.",
            ),
            entrada(
                "security update",
                None,
                "Parche de seguridad del sistema operativo.",
            ),
            entrada(
                "update for microsoft",
                None,
                "Actualización no acumulativa del sistema.",
            ),
            entrada("hotfix", None, "Parche puntual del sistema operativo."),
            entrada(
                "language pack",
                None,
                "Paquete de idioma del sistema operativo.",
            ),
            entrada(
                "language feature",
                None,
                "Componente de idioma del sistema operativo.",
            ),
            entrada("driver", None, "Controlador de dispositivo del sistema."),
            entrada("intel(r)", None, "Controlador/utilidad de hardware Intel."),
            entrada("nvidia", None, "Controlador/utilidad de hardware NVIDIA."),
            entrada("realtek", None, "Controlador/utilidad de hardware Realtek."),
            entrada(
                "google update",
                None,
                "Servicio actualizador en segundo plano.",
            ),
            entrada(
                "microsoft edge update",
                None,
                "Servicio actualizador en segundo plano.",
            ),
            entrada("edge webview", None, "Componente WebView del sistema."),
            entrada(
                "mozilla maintenance service",
                None,
                "Servicio actualizador en segundo plano.",
            ),
        ];

        let categorias = vec![
            categoria(
                "Navegadores",
                &[
                    "chrome",
                    "firefox",
                    "microsoft edge",
                    "opera",
                    "brave",
                    "vivaldi",
                ],
                &["navegador", "internet"],
            ),
            categoria(
                "Ofimática",
                &[
                    "office",
                    "word",
                    "excel",
                    "powerpoint",
                    "outlook",
                    "access",
                    "libreoffice",
                    "visio",
                    "project",
                    "onedrive",
                    "teams",
                ],
                &["ofimatica"],
            ),
            categoria(
                "Desarrollo e Ingeniería",
                &[
                    "visual studio",
                    "visual studio code",
                    "vscode",
                    "intellij",
                    "pycharm",
                    "eclipse",
                    "netbeans",
                    "android studio",
                    "github",
                    "gitlab",
                    "sourcetree",
                    "tortoisesvn",
                    "python",
                    "jdk",
                    "java",
                    "node.js",
                    "nodejs",
                    "docker",
                    "postman",
                    "notepad++",
                    "sublime",
                    "winscp",
                    "putty",
                    "filezilla",
                    "virtualbox",
                    "vmware workstation",
                ],
                &["desarrollo", "ingenieria"],
            ),
            categoria(
                "Seguridad y VPN",
                &[
                    "antivirus",
                    "eset",
                    "kaspersky",
                    "mcafee",
                    "sophos",
                    "avast",
                    "avg",
                    "malwarebytes",
                    "norton",
                    "bitdefender",
                    "defender",
                    "symantec",
                    "forticlient",
                    "openvpn",
                    "cisco anyconnect",
                    "globalprotect",
                ],
                &["seguridad", "vpn"],
            ),
            categoria(
                "Servidores y Bases de Datos",
                &[
                    "sql server",
                    "mysql",
                    "postgresql",
                    "mongodb",
                    "mariadb",
                    "oracle database",
                    "oracle client",
                    "dbeaver",
                    "heidisql",
                    "xampp",
                    "apache",
                    "nginx",
                    "iis",
                    "filezilla server",
                ],
                &["base-datos", "servidor"],
            ),
            categoria(
                "Multimedia y Diseño",
                &[
                    "vlc",
                    "k-lite",
                    "spotify",
                    "itunes",
                    "gimp",
                    "audacity",
                    "obs studio",
                    "adobe photoshop",
                    "adobe illustrator",
                    "adobe premiere",
                    "adobe after effects",
                    "paint.net",
                    "handbrake",
                    "ffmpeg",
                    "inkscape",
                    "blender",
                ],
                &["multimedia", "diseno"],
            ),
            categoria(
                "Utilidades",
                &[
                    "7-zip",
                    "7zip",
                    "winrar",
                    "teamviewer",
                    "anydesk",
                    "ccleaner",
                    "adobe reader",
                    "acrobat reader",
                    "windirstat",
                    "treesize",
                    "everything",
                    "snipping tool",
                ],
                &["utilidades"],
            ),
            categoria(
                "Comunicaciones",
                &[
                    "zoom", "slack", "discord", "skype", "whatsapp", "telegram", "webex", "goto",
                ],
                &["comunicaciones"],
            ),
        ];

        ReglasArchivo {
            exclusions,
            classifications,
            whitelist,
            noise: ruido,
            categories: categorias,
        }
    }

    /// Reglas integradas de fábrica listas para producción, con matchers compilados.
    pub fn integradas() -> Self {
        Self::desde_configuracion(
            "Reglas integradas (predeterminadas)",
            Self::configuracion_integrada(),
        )
    }

    /// Construye una instantánea de reglas y compila sus matchers una sola vez.
    ///
    /// `ReglasArchivo` conserva exactamente el formato serializable de JSON/TOML;
    /// los matchers son estado exclusivamente runtime.
    pub fn desde_configuracion(origen: impl Into<String>, configuracion: ReglasArchivo) -> Self {
        let origen = origen.into();
        let compiladas = compilar_reglas(&configuracion, &origen);

        Self {
            origen,
            exclusions: configuracion.exclusions,
            classifications: configuracion.classifications,
            whitelist: configuracion.whitelist,
            ruido: configuracion.noise,
            categorias: configuracion.categories,
            compiladas,
        }
    }

    /// Recompila la instantánea runtime después de modificar las reglas públicas.
    ///
    /// La recarga desde archivo y los constructores públicos ya lo realizan de
    /// forma automática; este método solo es necesario para mutaciones directas.
    pub fn recompilar_matchers(&mut self) {
        let configuracion = ReglasArchivo {
            exclusions: self.exclusions.clone(),
            classifications: self.classifications.clone(),
            whitelist: self.whitelist.clone(),
            noise: self.ruido.clone(),
            categories: self.categorias.clone(),
        };
        self.compiladas = compilar_reglas(&configuracion, &self.origen);
    }

    /// Carga las reglas desde un archivo JSON o TOML y las combina con las integradas.
    pub fn desde_archivo(ruta: &Path) -> Result<Self, String> {
        let contenido = std::fs::read_to_string(ruta).map_err(|e| {
            format!(
                "No se pudo leer el archivo de reglas ({}): {e}",
                ruta.display()
            )
        })?;

        // Deserialización tolerante (JSON preferido, TOML fallback)
        let archivo_usuario: ReglasArchivo = if let Ok(parsed) = serde_json::from_str(&contenido) {
            parsed
        } else if let Ok(parsed) = toml::from_str(&contenido) {
            parsed
        } else {
            return Err(format!(
                "El archivo «{}» no tiene una estructura JSON ni TOML válida.",
                ruta.display()
            ));
        };

        // Se combinan primero las reglas editables y se compilan una sola vez al
        // final, para que el lote reutilice una instantánea completa.
        let mut configuracion = Self::configuracion_integrada();

        // Combinar exclusiones
        if !archivo_usuario.exclusions.folders.is_empty() {
            for f in archivo_usuario.exclusions.folders {
                if !configuracion.exclusions.folders.contains(&f) {
                    configuracion.exclusions.folders.push(f);
                }
            }
        }
        if !archivo_usuario.exclusions.files.is_empty() {
            for f in archivo_usuario.exclusions.files {
                if !configuracion.exclusions.files.contains(&f) {
                    configuracion.exclusions.files.push(f);
                }
            }
        }

        // Incorporar clasificaciones de usuario con máxima prioridad
        if !archivo_usuario.classifications.is_empty() {
            for c in archivo_usuario.classifications.into_iter().rev() {
                configuracion.classifications.insert(0, c);
            }
        }

        // Incorporar whitelist
        for e in archivo_usuario.whitelist {
            if !e.patron.trim().is_empty() {
                configuracion.whitelist.push(e);
            }
        }

        // Incorporar ruido
        for e in archivo_usuario.noise {
            if !e.patron.trim().is_empty() {
                configuracion.noise.push(e);
            }
        }

        // Incorporar categorías
        for c in archivo_usuario.categories {
            if !c.nombre.trim().is_empty() && !c.patrones.is_empty() {
                configuracion.categories.push(c);
            }
        }

        Ok(Self::desde_configuracion(
            format!("Archivo: {}", ruta.display()),
            configuracion,
        ))
    }

    /// Resuelve el conjunto de reglas activo según la ruta provista o el archivo predeterminado.
    /// Si el archivo externo falla o no existe, degrada con elegancia a las integradas.
    pub fn cargar(ruta: Option<&str>) -> Self {
        let ruta_a_cargar = match ruta.map(str::trim).filter(|r| !r.is_empty()) {
            Some(r) => PathBuf::from(r),
            None => asegurar_archivo_predeterminado(),
        };

        match Self::desde_archivo(&ruta_a_cargar) {
            Ok(reglas) => reglas,
            Err(e) => {
                log::warn!("[reglas] {e}. Se usan las reglas integradas.");
                let mut reglas = Self::integradas();
                reglas.origen = format!("Reglas integradas (el archivo externo falló: {e})");
                reglas
            }
        }
    }

    /// Información resumida del conjunto de reglas para el frontend y simulador.
    pub fn informacion(&self) -> InfoReglas {
        let mut categorias: BTreeMap<String, usize> = self
            .categorias
            .iter()
            .map(|c| (c.nombre.clone(), c.patrones.len()))
            .collect();

        if !self.classifications.is_empty() {
            let total_ind: usize = self.classifications.iter().map(|c| c.patterns.len()).sum();
            categorias.insert("Automatización Industrial (Reglas)".to_string(), total_ind);
        }

        InfoReglas {
            origen_reglas: self.origen.clone(),
            total_whitelist: self.whitelist.len(),
            categorias,
            total_clasificaciones: self.classifications.len(),
            total_exclusiones_carpetas: self.exclusions.folders.len(),
            total_exclusiones_archivos: self.exclusions.files.len(),
        }
    }

    /// Determina si una carpeta coincide con las exclusiones ya compiladas.
    pub(crate) fn es_carpeta_excluida(&self, nombre_o_ruta: &str) -> bool {
        self.compiladas
            .exclusiones
            .es_carpeta_excluida(nombre_o_ruta)
    }

    /// Determina si un archivo coincide con las exclusiones ya compiladas.
    pub(crate) fn es_archivo_excluido(&self, nombre_archivo: &str) -> bool {
        self.compiladas
            .exclusiones
            .es_archivo_excluido(nombre_archivo)
    }

    /// Clasifica un programa aplicando la jerarquía de reglas:
    /// 1. Whitelist global (máxima prioridad)
    /// 2. Clasificaciones específicas de software industrial / de usuario
    /// 3. Ruido del sistema (descarte)
    /// 4. Categorías temáticas
    /// 5. Software no catalogado relevante
    pub fn clasificar(&self, nombre: &str, editor: Option<&str>) -> ResultadoClasificacion {
        // 1. Whitelist global: inclusión prioritaria
        for e in &self.compiladas.whitelist {
            if e.coincide(nombre, editor) {
                let (categoria, tags) = self
                    .categoria_de(nombre, editor)
                    .map_or((None, Vec::new()), |(c, t)| (Some(c), t));
                return ResultadoClasificacion {
                    es_relevante: true,
                    es_whitelist: true,
                    motivo_veredicto: format!("Whitelist global (prioridad alta): {}", e.motivo),
                    categoria,
                    tags,
                };
            }
        }

        // 2. Clasificaciones de software industrial / reglas de usuario
        for c in &self.compiladas.clasificaciones {
            let vendor_coincide = match (&c.vendor, editor) {
                (Some(v), Some(ed)) => v.coincide(ed),
                (Some(_), None) => true,
                (None, _) => true,
            };

            if vendor_coincide {
                for patron in &c.patrones {
                    if patron.coincide(nombre) {
                        let cat = c
                            .categoria
                            .clone()
                            .unwrap_or_else(|| "Automatización Industrial".to_string());
                        return ResultadoClasificacion {
                            es_relevante: true,
                            es_whitelist: false,
                            motivo_veredicto: format!(
                                "Clasificado como «{}» ({}) por regla de software industrial.",
                                c.software,
                                c.vendor
                                    .as_ref()
                                    .map(|vendor| vendor.original())
                                    .unwrap_or("Proveedor General")
                            ),
                            categoria: Some(cat),
                            tags: c.tags.clone(),
                        };
                    }
                }
            }
        }

        // 3. Ruido del sistema: se descarta del reporte
        for e in &self.compiladas.ruido {
            if e.coincide(nombre, editor) {
                return ResultadoClasificacion {
                    es_relevante: false,
                    es_whitelist: false,
                    motivo_veredicto: format!("Descartado como ruido del sistema: {}", e.motivo),
                    categoria: None,
                    tags: Vec::new(),
                };
            }
        }

        // 4. Categorías temáticas: software relevante y etiquetado
        match self.categoria_de(nombre, editor) {
            Some((categoria, tags)) => ResultadoClasificacion {
                es_relevante: true,
                es_whitelist: false,
                motivo_veredicto: format!(
                    "Clasificado en la categoría «{categoria}» por coincidencia de patrones."
                ),
                categoria: Some(categoria),
                tags,
            },
            None => ResultadoClasificacion {
                es_relevante: true,
                es_whitelist: false,
                motivo_veredicto:
                    "Sin coincidencia de reglas: se incluye como software no categorizado."
                        .to_string(),
                categoria: None,
                tags: Vec::new(),
            },
        }
    }

    /// Localiza la primera categoría cuyos patrones coinciden con el programa.
    fn categoria_de(&self, nombre: &str, _editor: Option<&str>) -> Option<(String, Vec<String>)> {
        for c in &self.compiladas.categorias {
            for patron in &c.patrones {
                if patron.coincide(nombre) {
                    return Some((c.nombre.clone(), c.tags.clone()));
                }
            }
        }
        None
    }
}

// ============================================================================
// UTILIDADES INTERNAS Y MOTOR DE COINCIDENCIAS
// ============================================================================

fn entrada(patron: &str, editor: Option<&str>, motivo: &str) -> EntradaPatron {
    EntradaPatron {
        patron: patron.to_string(),
        editor: editor.map(str::to_string),
        motivo: motivo.to_string(),
    }
}

fn categoria(nombre: &str, patrones: &[&str], tags: &[&str]) -> CategoriaReglas {
    CategoriaReglas {
        nombre: nombre.to_string(),
        patrones: patrones.iter().map(|p| p.to_string()).collect(),
        tags: tags.iter().map(|t| t.to_string()).collect(),
    }
}

fn compilar_reglas(configuracion: &ReglasArchivo, origen: &str) -> ReglasCompiladas {
    let (compiladas, diagnosticos) = ReglasCompiladas::compilar(configuracion);
    for diagnostico in diagnosticos {
        log::warn!(
            "[reglas] {origen}: patrón inválido en {} («{}»): {}. Se conserva la coincidencia de respaldo.",
            diagnostico.contexto,
            diagnostico.patron,
            diagnostico.detalle,
        );
    }
    compiladas
}

impl ReglasCompiladas {
    fn compilar(configuracion: &ReglasArchivo) -> (Self, Vec<DiagnosticoPatron>) {
        let mut diagnosticos = Vec::new();
        let exclusiones = ExclusionesCompiladas {
            carpetas: compilar_patrones(
                &configuracion.exclusions.folders,
                "exclusions.folders",
                &mut diagnosticos,
            ),
            archivos: compilar_patrones(
                &configuracion.exclusions.files,
                "exclusions.files",
                &mut diagnosticos,
            ),
        };

        let mut clasificaciones = Vec::with_capacity(configuracion.classifications.len());
        for (indice, clasificacion) in configuracion.classifications.iter().enumerate() {
            let contexto = format!("classifications[{indice}]");
            clasificaciones.push(ClasificacionSoftwareCompilada {
                vendor: clasificacion.vendor.as_deref().map(|vendor| {
                    compilar_patron_en_contexto(
                        vendor,
                        format!("{contexto}.vendor"),
                        &mut diagnosticos,
                    )
                }),
                software: clasificacion.software.clone(),
                patrones: compilar_patrones(
                    &clasificacion.patterns,
                    &format!("{contexto}.patterns"),
                    &mut diagnosticos,
                ),
                categoria: clasificacion.category.clone(),
                tags: clasificacion.tags.clone(),
            });
        }

        let mut whitelist = Vec::with_capacity(configuracion.whitelist.len());
        for (indice, entrada) in configuracion.whitelist.iter().enumerate() {
            whitelist.push(EntradaPatronCompilada {
                patron: compilar_patron_en_contexto(
                    &entrada.patron,
                    format!("whitelist[{indice}].patron"),
                    &mut diagnosticos,
                ),
                editor: compilar_editor(
                    entrada.editor.as_deref(),
                    format!("whitelist[{indice}].editor"),
                    &mut diagnosticos,
                ),
                motivo: entrada.motivo.clone(),
            });
        }

        let mut ruido = Vec::with_capacity(configuracion.noise.len());
        for (indice, entrada) in configuracion.noise.iter().enumerate() {
            ruido.push(EntradaPatronCompilada {
                patron: compilar_patron_en_contexto(
                    &entrada.patron,
                    format!("noise[{indice}].patron"),
                    &mut diagnosticos,
                ),
                editor: compilar_editor(
                    entrada.editor.as_deref(),
                    format!("noise[{indice}].editor"),
                    &mut diagnosticos,
                ),
                motivo: entrada.motivo.clone(),
            });
        }

        let mut categorias = Vec::with_capacity(configuracion.categories.len());
        for (indice, categoria) in configuracion.categories.iter().enumerate() {
            categorias.push(CategoriaReglasCompilada {
                nombre: categoria.nombre.clone(),
                patrones: compilar_patrones(
                    &categoria.patrones,
                    &format!("categories[{indice}].patterns"),
                    &mut diagnosticos,
                ),
                tags: categoria.tags.clone(),
            });
        }

        (
            Self {
                exclusiones,
                clasificaciones,
                whitelist,
                ruido,
                categorias,
            },
            diagnosticos,
        )
    }
}

impl ExclusionesCompiladas {
    fn es_carpeta_excluida(&self, nombre_o_ruta: &str) -> bool {
        self.carpetas
            .iter()
            .any(|patron| patron.coincide(nombre_o_ruta))
    }

    fn es_archivo_excluido(&self, nombre_archivo: &str) -> bool {
        self.archivos
            .iter()
            .any(|patron| patron.coincide(nombre_archivo))
    }
}

impl EntradaPatronCompilada {
    fn coincide(&self, nombre: &str, editor: Option<&str>) -> bool {
        if !self.patron.coincide(nombre) {
            return false;
        }
        match &self.editor {
            Some(patron_editor) => editor
                .map(|valor| patron_editor.coincide(valor))
                .unwrap_or(true),
            None => true,
        }
    }
}

fn compilar_patrones(
    patrones: &[String],
    contexto: &str,
    diagnosticos: &mut Vec<DiagnosticoPatron>,
) -> Vec<PatronCompilado> {
    patrones
        .iter()
        .enumerate()
        .map(|(indice, patron)| {
            compilar_patron_en_contexto(patron, format!("{contexto}[{indice}]"), diagnosticos)
        })
        .collect()
}

fn compilar_editor(
    editor: Option<&str>,
    contexto: String,
    diagnosticos: &mut Vec<DiagnosticoPatron>,
) -> Option<PatronCompilado> {
    match editor {
        Some(editor) if !editor.trim().is_empty() => {
            Some(compilar_patron_en_contexto(editor, contexto, diagnosticos))
        }
        _ => None,
    }
}

fn compilar_patron_en_contexto(
    patron: &str,
    contexto: String,
    diagnosticos: &mut Vec<DiagnosticoPatron>,
) -> PatronCompilado {
    let (compilado, errores) = PatronCompilado::compilar(patron);
    for detalle in errores {
        diagnosticos.push(DiagnosticoPatron {
            contexto: contexto.clone(),
            patron: compilado.original().to_string(),
            detalle,
        });
    }
    compilado
}

impl PatronCompilado {
    fn compilar(patron: &str) -> (Self, Vec<String>) {
        let patron_normalizado = patron.trim();
        let original = patron.to_string();
        if patron_normalizado.is_empty() {
            return (
                Self {
                    original,
                    matcher: MatcherPatron::Vacio,
                },
                Vec::new(),
            );
        }

        let mut errores = Vec::new();
        if patron_normalizado.starts_with('^')
            || patron_normalizado.ends_with('$')
            || patron_normalizado.starts_with("regex:")
        {
            let expresion = patron_normalizado
                .strip_prefix("regex:")
                .unwrap_or(patron_normalizado);
            match regex::RegexBuilder::new(expresion)
                .case_insensitive(true)
                .build()
            {
                Ok(regex) => {
                    return (
                        Self {
                            original,
                            matcher: MatcherPatron::Regex(regex),
                        },
                        errores,
                    );
                }
                Err(error) => errores.push(format!(
                    "la expresión regular explícita no se pudo compilar: {error}"
                )),
            }
        }

        if patron_normalizado.contains('*') || patron_normalizado.contains('?') {
            match regex_desde_comodin(patron_normalizado) {
                Ok(regex) => {
                    return (
                        Self {
                            original,
                            matcher: MatcherPatron::Regex(regex),
                        },
                        errores,
                    );
                }
                Err(error) => errores.push(format!(
                    "el patrón con comodines no se pudo compilar: {error}"
                )),
            }
        }

        (
            Self {
                original,
                matcher: matcher_literal(patron_normalizado),
            },
            errores,
        )
    }

    fn original(&self) -> &str {
        &self.original
    }

    fn coincide(&self, texto: &str) -> bool {
        let texto_normalizado = texto.trim();
        if texto_normalizado.is_empty() {
            return false;
        }

        match &self.matcher {
            MatcherPatron::Vacio => false,
            MatcherPatron::Regex(regex) => regex.is_match(texto_normalizado),
            MatcherPatron::Palabra { normalizado } => {
                let texto_minusculas = texto_normalizado.to_lowercase();
                texto_minusculas
                    .split(|caracter: char| !caracter.is_alphanumeric())
                    .any(|palabra| {
                        palabra == normalizado
                            || (palabra.starts_with(normalizado) && normalizado.len() >= 4)
                    })
            }
            MatcherPatron::Subcadena { normalizado } => {
                texto_normalizado.to_lowercase().contains(normalizado)
            }
        }
    }
}

fn matcher_literal(patron_normalizado: &str) -> MatcherPatron {
    let normalizado = patron_normalizado.to_lowercase();
    if normalizado
        .chars()
        .all(|caracter| caracter.is_alphanumeric())
        && !normalizado.contains(' ')
    {
        MatcherPatron::Palabra { normalizado }
    } else {
        MatcherPatron::Subcadena { normalizado }
    }
}

fn regex_desde_comodin(patron: &str) -> Result<regex::Regex, regex::Error> {
    let mut expresion = String::from("(?i)^");
    for caracter in patron.chars() {
        match caracter {
            '*' => expresion.push_str(".*"),
            '?' => expresion.push('.'),
            '.' | '+' | '(' | ')' | '[' | ']' | '{' | '}' | '^' | '$' | '|' | '\\' => {
                expresion.push('\\');
                expresion.push(caracter);
            }
            otro => expresion.push(otro),
        }
    }
    expresion.push('$');
    regex::Regex::new(&expresion)
}

/// Evalúa una coincidencia aislada con la misma semántica flexible de reglas.
///
/// Las reglas cargadas usan `PatronCompilado` y no pasan por esta compilación
/// por consulta; esta función se conserva para los consumidores de la API de
/// patrón individual.
pub fn coincide_patron(texto: &str, patron: &str) -> bool {
    let (compilado, _) = PatronCompilado::compilar(patron);
    compilado.coincide(texto)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn coincide_patron_anterior(texto: &str, patron: &str) -> bool {
        let patron_normalizado = patron.trim();
        if patron_normalizado.is_empty() {
            return false;
        }
        let texto_normalizado = texto.trim();
        if texto_normalizado.is_empty() {
            return false;
        }

        if patron_normalizado.starts_with('^')
            || patron_normalizado.ends_with('$')
            || patron_normalizado.starts_with("regex:")
        {
            let expresion = patron_normalizado
                .strip_prefix("regex:")
                .unwrap_or(patron_normalizado);
            if let Ok(regex) = regex::RegexBuilder::new(expresion)
                .case_insensitive(true)
                .build()
            {
                return regex.is_match(texto_normalizado);
            }
        }

        if patron_normalizado.contains('*') || patron_normalizado.contains('?') {
            let mut expresion = String::from("(?i)^");
            for caracter in patron_normalizado.chars() {
                match caracter {
                    '*' => expresion.push_str(".*"),
                    '?' => expresion.push('.'),
                    '.' | '+' | '(' | ')' | '[' | ']' | '{' | '}' | '^' | '$' | '|' | '\\' => {
                        expresion.push('\\');
                        expresion.push(caracter);
                    }
                    otro => expresion.push(otro),
                }
            }
            expresion.push('$');
            if let Ok(regex) = regex::Regex::new(&expresion) {
                return regex.is_match(texto_normalizado);
            }
        }

        let patron_minusculas = patron_normalizado.to_lowercase();
        let texto_minusculas = texto_normalizado.to_lowercase();
        if patron_minusculas
            .chars()
            .all(|caracter| caracter.is_alphanumeric())
            && !patron_minusculas.contains(' ')
        {
            return texto_minusculas
                .split(|caracter: char| !caracter.is_alphanumeric())
                .any(|palabra| {
                    palabra == patron_minusculas
                        || (palabra.starts_with(&patron_minusculas) && patron_minusculas.len() >= 4)
                });
        }

        texto_minusculas.contains(&patron_minusculas)
    }

    #[test]
    fn patrones_compilados_mantienen_literales_y_comodines() {
        let casos = [
            ("VM Inventory v1.2+beta", "v1.2+beta", true),
            ("snapshot.tar.gz", "*.tar.gz", true),
            ("snapshot.tar.gza", "*.tar.gz", false),
            ("file7.tmp", "file?.tmp", true),
            ("file77.tmp", "file?.tmp", false),
            ("release v1.2+beta", "*v1.2+beta*", true),
            ("release v1x22beta", "*v1.2+beta*", false),
        ];

        for (texto, patron, esperado) in casos {
            let (compilado, diagnosticos) = PatronCompilado::compilar(patron);
            assert!(
                diagnosticos.is_empty(),
                "diagnóstico inesperado para {patron}"
            );
            assert_eq!(compilado.coincide(texto), esperado, "patrón {patron}");
        }

        let (literal, _) = PatronCompilado::compilar("v1.2+beta");
        assert!(matches!(literal.matcher, MatcherPatron::Subcadena { .. }));

        let (glob, _) = PatronCompilado::compilar("*v1.2+beta*");
        assert!(matches!(glob.matcher, MatcherPatron::Regex(_)));

        let patron_especial = r"* [a].(b)+{c}|^$\*";
        let (especial, diagnosticos) = PatronCompilado::compilar(patron_especial);
        assert!(diagnosticos.is_empty());
        assert!(especial.coincide(r"release [a].(b)+{c}|^$\tail"));
        assert!(!especial.coincide("release axbcccc"));
    }

    #[test]
    fn matcher_compilado_equivale_al_motor_anterior() {
        let casos = [
            (" Example Agent ", "*agent"),
            ("release-42", r"^release-\d+$"),
            ("release-x", r"regex:^release-\d+$"),
            ("Digital Assistant", "git"),
            ("snapshot.tar.gz", "*.tar.gz"),
            ("file7.tmp", "file?.tmp"),
            ("regex:[", "regex:["),
            ("regex:[resultado", "regex:[*"),
            ("", "*"),
            ("programa", "   "),
        ];

        for (texto, patron) in casos {
            let (compilado, _) = PatronCompilado::compilar(patron);
            assert_eq!(
                compilado.coincide(texto),
                coincide_patron_anterior(texto, patron),
                "el patrón {patron:?} debe conservar el comportamiento anterior"
            );
        }
    }

    #[test]
    fn identifica_regex_invalidas_al_compilar_la_configuracion() {
        let configuracion = ReglasArchivo {
            exclusions: ExclusionesConfig::default(),
            classifications: Vec::new(),
            whitelist: vec![EntradaPatron {
                patron: "regex:[".to_string(),
                editor: None,
                motivo: "fixture".to_string(),
            }],
            noise: Vec::new(),
            categories: Vec::new(),
        };

        let (_, diagnosticos) = ReglasCompiladas::compilar(&configuracion);
        assert_eq!(diagnosticos.len(), 1);
        assert_eq!(diagnosticos[0].contexto, "whitelist[0].patron");
        assert_eq!(diagnosticos[0].patron, "regex:[");
        assert!(diagnosticos[0]
            .detalle
            .contains("expresión regular explícita"));

        let (compilado, errores) = PatronCompilado::compilar("regex:[");
        assert_eq!(errores.len(), 1);
        assert_eq!(compilado.original(), "regex:[");
        assert!(compilado.coincide("regex:["));
    }

    fn reglas_de_precedencia(
        incluir_whitelist: bool,
        incluir_especifica: bool,
        incluir_ruido: bool,
    ) -> ReglasClasificacion {
        ReglasClasificacion::desde_configuracion(
            "fixture de precedencia",
            ReglasArchivo {
                exclusions: ExclusionesConfig::default(),
                classifications: if incluir_especifica {
                    vec![ClasificacionSoftware {
                        vendor: None,
                        software: "Herramienta específica".to_string(),
                        patterns: vec!["Herramienta de prueba".to_string()],
                        category: Some("Específica".to_string()),
                        tags: vec!["especifica".to_string()],
                    }]
                } else {
                    Vec::new()
                },
                whitelist: if incluir_whitelist {
                    vec![EntradaPatron {
                        patron: "Herramienta de prueba".to_string(),
                        editor: None,
                        motivo: "prioridad máxima".to_string(),
                    }]
                } else {
                    Vec::new()
                },
                noise: if incluir_ruido {
                    vec![EntradaPatron {
                        patron: "Herramienta de prueba".to_string(),
                        editor: None,
                        motivo: "ruido".to_string(),
                    }]
                } else {
                    Vec::new()
                },
                categories: vec![CategoriaReglas {
                    nombre: "Temática".to_string(),
                    patrones: vec!["Herramienta de prueba".to_string()],
                    tags: vec!["tematica".to_string()],
                }],
            },
        )
    }

    #[test]
    fn conserva_la_precedencia_de_clasificacion() {
        let nombre = "Herramienta de prueba";

        let resultado = reglas_de_precedencia(true, true, true).clasificar(nombre, None);
        assert!(resultado.es_relevante);
        assert!(resultado.es_whitelist);
        assert_eq!(resultado.categoria.as_deref(), Some("Temática"));
        assert_eq!(resultado.tags, vec!["tematica"]);

        let resultado = reglas_de_precedencia(false, true, true).clasificar(nombre, None);
        assert!(resultado.es_relevante);
        assert!(!resultado.es_whitelist);
        assert_eq!(resultado.categoria.as_deref(), Some("Específica"));
        assert_eq!(resultado.tags, vec!["especifica"]);

        let resultado = reglas_de_precedencia(false, false, true).clasificar(nombre, None);
        assert!(!resultado.es_relevante);
        assert!(!resultado.es_whitelist);
        assert_eq!(resultado.categoria, None);

        let resultado = reglas_de_precedencia(false, false, false).clasificar(nombre, None);
        assert!(resultado.es_relevante);
        assert!(!resultado.es_whitelist);
        assert_eq!(resultado.categoria.as_deref(), Some("Temática"));
        assert_eq!(resultado.tags, vec!["tematica"]);
    }
}

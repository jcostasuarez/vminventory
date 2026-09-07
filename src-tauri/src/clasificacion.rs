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
#[derive(Clone, Debug)]
pub struct ReglasClasificacion {
    pub origen: String,
    pub exclusions: ExclusionesConfig,
    pub classifications: Vec<ClasificacionSoftware>,
    pub whitelist: Vec<EntradaPatron>,
    pub ruido: Vec<EntradaPatron>,
    pub categorias: Vec<CategoriaReglas>,
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
    let reglas = ReglasClasificacion::integradas();
    let archivo = ReglasArchivo {
        exclusions: reglas.exclusions,
        classifications: reglas.classifications,
        whitelist: reglas.whitelist,
        noise: reglas.ruido,
        categories: reglas.categorias,
    };
    serde_json::to_string_pretty(&archivo)
        .unwrap_or_else(|_| "{\n  \"exclusions\": {},\n  \"classifications\": []\n}".to_string())
}

// ============================================================================
// IMPLEMENTACIÓN DE REGLAS
// ============================================================================

impl ReglasClasificacion {
    /// Reglas integradas de fábrica listas para producción (incluye exclusiones, software industrial, whitelist, ruido y categorías).
    pub fn integradas() -> Self {
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

        Self {
            origen: "Reglas integradas (predeterminadas)".to_string(),
            exclusions,
            classifications,
            whitelist,
            ruido,
            categorias,
        }
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
        let archivo: ReglasArchivo = if let Ok(parsed) = serde_json::from_str(&contenido) {
            parsed
        } else if let Ok(parsed) = toml::from_str(&contenido) {
            parsed
        } else {
            return Err(format!(
                "El archivo «{}» no tiene una estructura JSON ni TOML válida.",
                ruta.display()
            ));
        };

        let mut reglas = Self::integradas();
        reglas.origen = format!("Archivo: {}", ruta.display());

        // Combinar exclusiones
        if !archivo.exclusions.folders.is_empty() {
            for f in archivo.exclusions.folders {
                if !reglas.exclusions.folders.contains(&f) {
                    reglas.exclusions.folders.push(f);
                }
            }
        }
        if !archivo.exclusions.files.is_empty() {
            for f in archivo.exclusions.files {
                if !reglas.exclusions.files.contains(&f) {
                    reglas.exclusions.files.push(f);
                }
            }
        }

        // Incorporar clasificaciones de usuario con máxima prioridad
        if !archivo.classifications.is_empty() {
            for c in archivo.classifications.into_iter().rev() {
                reglas.classifications.insert(0, c);
            }
        }

        // Incorporar whitelist
        for e in archivo.whitelist {
            if !e.patron.trim().is_empty() {
                reglas.whitelist.push(e);
            }
        }

        // Incorporar ruido
        for e in archivo.noise {
            if !e.patron.trim().is_empty() {
                reglas.ruido.push(e);
            }
        }

        // Incorporar categorías
        for c in archivo.categories {
            if !c.nombre.trim().is_empty() && !c.patrones.is_empty() {
                reglas.categorias.push(c);
            }
        }

        Ok(reglas)
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

    /// Clasifica un programa aplicando la jerarquía de reglas:
    /// 1. Whitelist global (máxima prioridad)
    /// 2. Clasificaciones específicas de software industrial / de usuario
    /// 3. Ruido del sistema (descarte)
    /// 4. Categorías temáticas
    /// 5. Software no catalogado relevante
    pub fn clasificar(&self, nombre: &str, editor: Option<&str>) -> ResultadoClasificacion {
        // 1. Whitelist global: inclusión prioritaria
        for e in &self.whitelist {
            if coincide(nombre, editor, &e.patron, e.editor.as_deref()) {
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
        for c in &self.classifications {
            let vendor_coincide = match (&c.vendor, editor) {
                (Some(v), Some(ed)) => coincide_patron(ed, v),
                (Some(_), None) => true,
                (None, _) => true,
            };

            if vendor_coincide {
                for patron in &c.patterns {
                    if coincide_patron(nombre, patron) {
                        let cat = c
                            .category
                            .clone()
                            .unwrap_or_else(|| "Automatización Industrial".to_string());
                        return ResultadoClasificacion {
                            es_relevante: true,
                            es_whitelist: false,
                            motivo_veredicto: format!(
                                "Clasificado como «{}» ({}) por regla de software industrial.",
                                c.software,
                                c.vendor.as_deref().unwrap_or("Proveedor General")
                            ),
                            categoria: Some(cat),
                            tags: c.tags.clone(),
                        };
                    }
                }
            }
        }

        // 3. Ruido del sistema: se descarta del reporte
        for e in &self.ruido {
            if coincide(nombre, editor, &e.patron, e.editor.as_deref()) {
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
    fn categoria_de(&self, nombre: &str, editor: Option<&str>) -> Option<(String, Vec<String>)> {
        for c in &self.categorias {
            for patron in &c.patrones {
                if coincide(nombre, editor, patron, None) {
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

/// Evalúa si un texto coincide con un patrón flexible:
/// - Expresiones regulares si comienza con `^`, `regex:` o contiene metacaracteres.
/// - Comodines glob (`*` y `?`).
/// - Coincidencia de palabra completa o prefijo alfanumérico.
/// - Contención de subcadena insensible a mayúsculas/minúsculas.
pub fn coincide_patron(texto: &str, patron: &str) -> bool {
    let patron_norm = patron.trim();
    if patron_norm.is_empty() {
        return false;
    }
    let texto_norm = texto.trim();
    if texto_norm.is_empty() {
        return false;
    }

    // 1. Regex explícito
    if patron_norm.starts_with('^')
        || patron_norm.ends_with('$')
        || patron_norm.starts_with("regex:")
    {
        let expr = patron_norm.strip_prefix("regex:").unwrap_or(patron_norm);
        if let Ok(re) = regex::RegexBuilder::new(expr)
            .case_insensitive(true)
            .build()
        {
            return re.is_match(texto_norm);
        }
    }

    // 2. Comodines glob (* y ?)
    if patron_norm.contains('*') || patron_norm.contains('?') {
        let mut regex_str = String::from("(?i)^");
        for c in patron_norm.chars() {
            match c {
                '*' => regex_str.push_str(".*"),
                '?' => regex_str.push('.'),
                '.' | '+' | '(' | ')' | '[' | ']' | '{' | '}' | '^' | '$' | '|' | '\\' => {
                    regex_str.push('\\');
                    regex_str.push(c);
                }
                other => regex_str.push(other),
            }
        }
        regex_str.push('$');
        if let Ok(re) = regex::Regex::new(&regex_str) {
            return re.is_match(texto_norm);
        }
    }

    let p_lower = patron_norm.to_lowercase();
    let t_lower = texto_norm.to_lowercase();

    // 3. Palabra única alfanumérica -> límite de palabra o prefijo largo
    if p_lower.chars().all(|c| c.is_alphanumeric()) && !p_lower.contains(' ') {
        return t_lower
            .split(|c: char| !c.is_alphanumeric())
            .any(|palabra| {
                palabra == p_lower || (palabra.starts_with(&p_lower) && p_lower.len() >= 4)
            });
    }

    // 4. Subcadena general para patrones compuestos
    t_lower.contains(&p_lower)
}

/// Coincidencia combinada de nombre y editor del software.
fn coincide(nombre: &str, editor: Option<&str>, patron: &str, patron_editor: Option<&str>) -> bool {
    if !coincide_patron(nombre, patron) {
        return false;
    }
    match patron_editor.map(str::trim).filter(|e| !e.is_empty()) {
        Some(pe) => editor.map(|e| coincide_patron(e, pe)).unwrap_or(true),
        None => true,
    }
}

// ============================================================================
// TESTS UNITARIOS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn test_coincide_limite_palabra() {
        assert!(coincide("Git for Windows", None, "git", None));
        assert!(coincide("Git", None, "git", None));
        assert!(coincide("Cliente Git-SCM", None, "git", None));
        assert!(!coincide("Logitech Gaming Software", None, "git", None));
        assert!(!coincide("Digital Audio Workstation", None, "git", None));

        assert!(coincide("Docker Desktop", None, "docker", None));
        assert!(coincide("dockerservice", None, "docker", None));

        assert!(coincide(
            "Microsoft Visual Studio Code",
            None,
            "visual studio code",
            None
        ));
        assert!(coincide("SQL Server 2019", None, "sql server", None));
        assert!(!coincide("PostgreSQL", None, "mysql", None));

        assert!(!coincide("Cualquier Programa", None, "", None));
        assert!(!coincide("Cualquier Programa", None, "   ", None));
    }

    #[test]
    fn test_coincide_con_editor() {
        assert!(coincide(
            "Java 8 Update 351",
            Some("Oracle Corporation"),
            "java",
            Some("oracle")
        ));

        assert!(!coincide(
            "Java 8 Update 351",
            Some("Adoptium"),
            "java",
            Some("oracle")
        ));
    }

    #[test]
    fn test_coincide_patron_globs_y_regex() {
        // Globs
        assert!(coincide_patron("s7dbg.exe", "s7dbg.exe"));
        assert!(coincide_patron("SIMATIC Step7 V5.5 SP2", "*Step7*"));
        assert!(coincide_patron("Simatic Manager", "*Simatic*"));
        assert!(
            coincide_patron("Studio 5000 Logix Designer", "*Studio 5K*")
                || coincide_patron("Studio 5000 Logix", "*Studio 5000*")
        );
        assert!(coincide_patron("archivo.tmp", "*.tmp"));
        assert!(coincide_patron("SWAP.PAGEFILE", "*.pagefile"));
        assert!(!coincide_patron("archivo.vmdk", "*.tmp"));

        // Regex
        assert!(coincide_patron("s7dbg.exe", "^s7.*\\.exe$"));
        assert!(!coincide_patron("otros7dbg.dll", "^s7.*\\.exe$"));
    }

    #[test]
    fn test_exclusiones_carpetas_y_archivos() {
        let exclusiones = ExclusionesConfig {
            folders: vec![
                "System Volume Information".to_string(),
                "$RECYCLE.BIN".to_string(),
                "Temp".to_string(),
            ],
            files: vec!["*.tmp".to_string(), "*.pagefile".to_string()],
        };

        assert!(exclusiones.es_carpeta_excluida("System Volume Information"));
        assert!(exclusiones.es_carpeta_excluida("$RECYCLE.BIN"));
        assert!(exclusiones.es_carpeta_excluida("Temp"));
        assert!(exclusiones.es_carpeta_excluida("temp"));
        assert!(!exclusiones.es_carpeta_excluida("MisVMs"));

        assert!(exclusiones.es_archivo_excluido("swap.tmp"));
        assert!(exclusiones.es_archivo_excluido("memoria.pagefile"));
        assert!(!exclusiones.es_archivo_excluido("disco.qcow2"));
        assert!(!exclusiones.es_archivo_excluido("disco.vmdk"));
    }

    #[test]
    fn test_reglas_integradas_e_informacion() {
        let reglas = ReglasClasificacion::integradas();
        assert!(
            !reglas.whitelist.is_empty(),
            "La whitelist no debe estar vacía"
        );
        assert!(!reglas.ruido.is_empty(), "El ruido no debe estar vacío");
        assert!(
            !reglas.classifications.is_empty(),
            "Las clasificaciones industriales no deben estar vacías"
        );
        assert!(
            !reglas.categorias.is_empty(),
            "Las categorías no deben estar vacías"
        );

        let info = reglas.informacion();
        assert_eq!(info.total_whitelist, reglas.whitelist.len());
        assert_eq!(info.total_clasificaciones, reglas.classifications.len());
        assert!(!info.categorias.is_empty());
        assert!(info.origen_reglas.contains("integradas"));
    }

    #[test]
    fn test_clasificacion_industrial_software() {
        let reglas = ReglasClasificacion::integradas();

        // Siemens Step7
        let res_step7 = reglas.clasificar(
            "Siemens SIMATIC Step7 Professional V5.5",
            Some("Siemens AG"),
        );
        assert!(res_step7.es_relevante);
        assert!(!res_step7.es_whitelist);
        assert_eq!(
            res_step7.categoria.as_deref(),
            Some("Automatización Industrial")
        );
        assert!(res_step7.tags.contains(&"siemens".to_string()));

        // Rockwell Studio 5000
        let res_rockwell = reglas.clasificar(
            "Studio 5000 Logix Designer v33",
            Some("Rockwell Automation"),
        );
        assert!(res_rockwell.es_relevante);
        assert_eq!(
            res_rockwell.categoria.as_deref(),
            Some("Automatización Industrial")
        );
        assert!(res_rockwell.tags.contains(&"rockwell".to_string()));

        // Schneider Citect
        let res_citect = reglas.clasificar("Citect SCADA 2018 R2", Some("Schneider Electric"));
        assert!(res_citect.es_relevante);
        assert_eq!(res_citect.categoria.as_deref(), Some("SCADA & HMI"));
        assert!(res_citect.tags.contains(&"citect".to_string()));
    }

    #[test]
    fn test_clasificacion_jerarquia() {
        let reglas = ReglasClasificacion::integradas();

        // 1. Whitelist prioritaria (ej. Microsoft SQL Server)
        let res_sql = reglas.clasificar("Microsoft SQL Server 2019", Some("Microsoft Corporation"));
        assert!(res_sql.es_relevante);
        assert!(res_sql.es_whitelist);
        assert!(res_sql.categoria.is_some());

        // 2. Ruido del sistema (ej. Microsoft Visual C++ Redistributable)
        let res_ruido = reglas.clasificar(
            "Microsoft Visual C++ 2015-2022 Redistributable (x64)",
            Some("Microsoft Corporation"),
        );
        assert!(!res_ruido.es_relevante);
        assert!(!res_ruido.es_whitelist);
        assert_eq!(res_ruido.categoria, None);

        // 3. Categoría temática no en whitelist (ej. PostgreSQL o Wireshark)
        let res_cat =
            reglas.clasificar("PostgreSQL 15", Some("PostgreSQL Global Development Group"));
        assert!(res_cat.es_relevante);
        assert!(!res_cat.es_whitelist);
        assert!(res_cat.categoria.is_some());

        // 4. Software no catalogado (se preserva pero sin categoría)
        let res_desconocido = reglas.clasificar("SoftwareInternoDePrueba v99.0", None);
        assert!(res_desconocido.es_relevante);
        assert!(!res_desconocido.es_whitelist);
        assert_eq!(res_desconocido.categoria, None);
        assert!(res_desconocido.tags.is_empty());
    }

    #[test]
    fn test_cargar_reglas_desde_json_y_fallback() {
        // Fallback cuando la ruta no existe
        let reglas_fallback = ReglasClasificacion::cargar(Some("archivo_que_no_existe_9999.json"));
        assert!(!reglas_fallback.whitelist.is_empty());
        assert!(reglas_fallback.origen.contains("el archivo externo falló"));

        // Carga exitosa de archivo JSON personalizado
        let temp_json = std::env::temp_dir().join("vminventory_test_reglas.json");
        let json_content = r#"{
            "exclusions": {
                "folders": ["CustomExclusionFolder"],
                "files": ["*.customtmp"]
            },
            "classifications": [
                {
                    "vendor": "TestVendor",
                    "software": "Custom SCADA System",
                    "patterns": ["*CustomSCADA*", "custom_scada.exe"],
                    "category": "SCADA Personalizado",
                    "tags": ["scada", "custom"]
                }
            ],
            "whitelist": [
                {
                    "nombre": "MiSoftwareCritico",
                    "editor": "MiEmpresa",
                    "motivo": "Software clave de la organización"
                }
            ],
            "noise": [
                {
                    "nombre": "AgenteDeMonitoreoInterno",
                    "motivo": "Telemetría interna descartable"
                }
            ]
        }"#;

        let mut f = std::fs::File::create(&temp_json).expect("Crear archivo JSON de prueba");
        f.write_all(json_content.as_bytes()).expect("Escribir JSON");

        let reglas_custom = ReglasClasificacion::cargar(Some(temp_json.to_str().unwrap()));
        assert!(reglas_custom
            .origen
            .contains("vminventory_test_reglas.json"));

        // Comprobar exclusiones cargadas
        assert!(reglas_custom
            .exclusions
            .es_carpeta_excluida("CustomExclusionFolder"));
        assert!(reglas_custom
            .exclusions
            .es_archivo_excluido("dump.customtmp"));

        // Comprobar clasificación industrial cargada
        let res_scada = reglas_custom.clasificar("CustomSCADA Runtime v4", Some("TestVendor"));
        assert!(res_scada.es_relevante);
        assert_eq!(res_scada.categoria.as_deref(), Some("SCADA Personalizado"));
        assert!(res_scada.tags.contains(&"custom".to_string()));

        // Comprobar whitelist personalizada
        let res_white = reglas_custom.clasificar("MiSoftwareCritico v2", Some("MiEmpresa"));
        assert!(res_white.es_relevante);
        assert!(res_white.es_whitelist);

        // Comprobar ruido personalizado
        let res_noise = reglas_custom.clasificar("AgenteDeMonitoreoInterno", None);
        assert!(!res_noise.es_relevante);

        let _ = std::fs::remove_file(&temp_json);
    }

    #[test]
    fn test_recarga_dinamica_reglas_en_disco() {
        let temp_json = std::env::temp_dir().join("vminventory_test_recarga_dinamica.json");
        let initial_content = r#"{
            "exclusions": {
                "folders": ["CarpetaV1"],
                "files": ["*.v1"]
            },
            "classifications": [
                {
                    "vendor": "VendorV1",
                    "software": "AppV1",
                    "patterns": ["*AppV1*"],
                    "category": "CatV1",
                    "tags": ["v1"]
                }
            ]
        }"#;

        std::fs::write(&temp_json, initial_content.as_bytes()).expect("Escribir V1");

        let reglas_v1 = ReglasClasificacion::cargar(Some(temp_json.to_str().unwrap()));
        assert!(reglas_v1.exclusions.es_carpeta_excluida("CarpetaV1"));
        assert!(!reglas_v1.exclusions.es_carpeta_excluida("CarpetaV2"));
        let res_v1 = reglas_v1.clasificar("AppV1 Enterprise", Some("VendorV1"));
        assert_eq!(res_v1.categoria.as_deref(), Some("CatV1"));

        // Usuario edita el archivo en disco
        let updated_content = r#"{
            "exclusions": {
                "folders": ["CarpetaV2"],
                "files": ["*.v2"]
            },
            "classifications": [
                {
                    "vendor": "VendorV2",
                    "software": "AppV2 Actualizada",
                    "patterns": ["*AppV2*"],
                    "category": "CatV2 Industrial",
                    "tags": ["v2", "scada"]
                }
            ]
        }"#;

        std::fs::write(&temp_json, updated_content.as_bytes()).expect("Escribir V2");

        // El siguiente relevamiento o llamada a cargar() lee dinámicamente el archivo modificado
        let reglas_v2 = ReglasClasificacion::cargar(Some(temp_json.to_str().unwrap()));
        assert!(reglas_v2.exclusions.es_carpeta_excluida("CarpetaV2"));
        let res_v2 = reglas_v2.clasificar("AppV2 Actualizada", Some("VendorV2"));
        assert_eq!(res_v2.categoria.as_deref(), Some("CatV2 Industrial"));
        assert!(res_v2.tags.contains(&"scada".to_string()));

        let _ = std::fs::remove_file(&temp_json);
    }
}

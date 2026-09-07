//! # Motor de Clasificación de Software
//! Sistema de reglas de tres niveles que decide qué software se incluye en los
//! reportes y cómo se etiqueta:
//!
//! 1. **Whitelist global**: software corporativo crítico, siempre incluido con
//!    prioridad alta.
//! 2. **Ruido del sistema**: redistribuibles, runtimes, actualizaciones y
//!    controladores que se descartan (salvo que se active `modo_dump`).
//! 3. **Categorías temáticas**: etiquetado funcional (Navegadores, Ofimática,
//!    Desarrollo, ...) con tags asociadas.
//!
//! Las reglas integradas se combinan con las de un archivo `reglas.toml`
//! personalizado cuando la configuración lo indica.

use crate::models::{InfoReglas, ResultadoClasificacion};
use serde::Deserialize;
use std::path::Path;

/// Entrada de patrón de coincidencia (whitelist o ruido).
#[derive(Clone, Debug)]
pub struct EntradaPatron {
    pub patron: String,
    pub editor: Option<String>,
    pub motivo: String,
}

/// Categoría temática con patrones de nombres y etiquetas asociadas.
#[derive(Clone, Debug)]
pub struct CategoriaReglas {
    pub nombre: String,
    pub patrones: Vec<String>,
    pub tags: Vec<String>,
}

/// Conjunto completo de reglas de clasificación cargado en memoria.
#[derive(Clone, Debug)]
pub struct ReglasClasificacion {
    pub origen: String,
    pub whitelist: Vec<EntradaPatron>,
    pub ruido: Vec<EntradaPatron>,
    pub categorias: Vec<CategoriaReglas>,
}

// ============================================================================
// Deserialización del archivo reglas.toml
// ============================================================================

#[derive(Debug, Deserialize, Default)]
struct ReglasArchivo {
    #[serde(default)]
    whitelist: Vec<EntradaArchivo>,
    #[serde(default)]
    ruido: Vec<EntradaArchivo>,
    #[serde(default)]
    categoria: Vec<CategoriaArchivo>,
}

#[derive(Debug, Deserialize, Default)]
struct EntradaArchivo {
    #[serde(default, alias = "patron")]
    nombre: Option<String>,
    #[serde(default)]
    editor: Option<String>,
    #[serde(default)]
    motivo: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct CategoriaArchivo {
    #[serde(default)]
    nombre: Option<String>,
    #[serde(default)]
    patrones: Vec<String>,
    #[serde(default)]
    tags: Vec<String>,
}

impl ReglasClasificacion {
    /// Reglas integradas de fábrica (usadas cuando no hay archivo externo).
    pub fn integradas() -> Self {
        let whitelist = vec![
            entrada(
                "microsoft office",
                None,
                "Suite ofimática corporativa estándar.",
            ),
            entrada(
                "microsoft 365",
                None,
                "Suscripción ofimática corporativa estándar.",
            ),
            entrada(
                "adobe acrobat",
                None,
                "Lector/editor de PDF estándar de la organización.",
            ),
            entrada(
                "autocad",
                None,
                "Herramienta de diseño asistido (CAD) crítica.",
            ),
            entrada(
                "visual studio",
                None,
                "Entorno de desarrollo corporativo prioritario.",
            ),
            entrada(
                "sql server",
                None,
                "Motor de base de datos corporativo prioritario.",
            ),
            entrada(
                "vmware tools",
                None,
                "Stack de integración de VMware: revela la plataforma de la VM.",
            ),
            entrada(
                "virtualbox guest additions",
                None,
                "Stack de integración de VirtualBox: revela la plataforma de la VM.",
            ),
            entrada(
                "eset",
                None,
                "Endpoint de seguridad corporativo obligatorio.",
            ),
            entrada(
                "kaspersky",
                None,
                "Endpoint de seguridad corporativo obligatorio.",
            ),
            entrada(
                "mcafee",
                None,
                "Endpoint de seguridad corporativo obligatorio.",
            ),
            entrada(
                "sophos",
                None,
                "Endpoint de seguridad corporativo obligatorio.",
            ),
            entrada(
                "trend micro",
                None,
                "Endpoint de seguridad corporativo obligatorio.",
            ),
            entrada(
                "forticlient",
                None,
                "Cliente VPN/seguridad corporativo obligatorio.",
            ),
            entrada(
                "globalprotect",
                None,
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
                    "winscp",
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
                    "winrar",
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
            whitelist,
            ruido,
            categorias,
        }
    }

    /// Carga las reglas de un archivo TOML y las **combina** con las integradas.
    fn desde_archivo(ruta: &Path) -> Result<Self, String> {
        let contenido = std::fs::read_to_string(ruta).map_err(|e| {
            format!(
                "No se pudo leer el archivo de reglas ({}): {e}",
                ruta.display()
            )
        })?;
        let archivo: ReglasArchivo = toml::from_str(&contenido)
            .map_err(|e| format!("El archivo de reglas no es un TOML válido: {e}"))?;

        let mut reglas = Self::integradas();
        reglas.origen = format!(
            "Archivo: {} (combinado con reglas integradas)",
            ruta.display()
        );

        for e in archivo.whitelist {
            if let Some(patron) = e.nombre {
                reglas.whitelist.push(EntradaPatron {
                    patron,
                    editor: e.editor,
                    motivo: e.motivo.unwrap_or_else(|| {
                        "Entrada de whitelist definida por el usuario.".to_string()
                    }),
                });
            }
        }
        for e in archivo.ruido {
            if let Some(patron) = e.nombre {
                reglas.ruido.push(EntradaPatron {
                    patron,
                    editor: e.editor,
                    motivo: e
                        .motivo
                        .unwrap_or_else(|| "Entrada de ruido definida por el usuario.".to_string()),
                });
            }
        }
        for c in archivo.categoria {
            if let Some(nombre) = c.nombre {
                if !c.patrones.is_empty() {
                    reglas.categorias.push(CategoriaReglas {
                        nombre,
                        patrones: c.patrones,
                        tags: c.tags,
                    });
                }
            }
        }
        Ok(reglas)
    }

    /// Resuelve el conjunto de reglas activo según la configuración.
    /// Si el archivo externo falla, degrada con elegancia a las integradas.
    pub fn cargar(ruta: Option<&str>) -> Self {
        match ruta.map(str::trim).filter(|r| !r.is_empty()) {
            Some(r) => match Self::desde_archivo(Path::new(r)) {
                Ok(reglas) => reglas,
                Err(e) => {
                    log::warn!("[reglas] {e}. Se usan las reglas integradas.");
                    let mut reglas = Self::integradas();
                    reglas.origen = format!("Reglas integradas (el archivo externo falló: {e})");
                    reglas
                }
            },
            None => Self::integradas(),
        }
    }

    /// Información resumida del conjunto de reglas para el simulador del frontend.
    pub fn informacion(&self) -> InfoReglas {
        let categorias: std::collections::BTreeMap<String, usize> = self
            .categorias
            .iter()
            .map(|c| (c.nombre.clone(), c.patrones.len()))
            .collect();
        InfoReglas {
            origen_reglas: self.origen.clone(),
            total_whitelist: self.whitelist.len(),
            categorias,
        }
    }

    /// Clasifica un programa aplicando los tres niveles de reglas en orden.
    pub fn clasificar(&self, nombre: &str, editor: Option<&str>) -> ResultadoClasificacion {
        // 1. Whitelist global: inclusión prioritaria.
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

        // 2. Ruido del sistema: se descarta del reporte.
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

        // 3. Categorías temáticas: software relevante y etiquetado.
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
// Utilidades internas
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

/// Coincidencia con límite de palabra: un patrón de una sola palabra debe
/// alinearse con palabras completas del nombre (p. ej. "git" no debe casar con
/// "Logitech"). Los patrones compuestos o con símbolos usan contención directa.
fn coincide(nombre: &str, editor: Option<&str>, patron: &str, patron_editor: Option<&str>) -> bool {
    let patron_norm = patron.trim().to_lowercase();
    if patron_norm.is_empty() {
        return false;
    }
    let nombre_norm = nombre.trim().to_lowercase();

    let hay = if patron_norm.chars().all(|c| c.is_alphanumeric()) && !patron_norm.contains(' ') {
        nombre_norm
            .split(|c: char| !c.is_alphanumeric())
            .any(|palabra| {
                palabra == patron_norm
                    || (palabra.starts_with(&patron_norm) && patron_norm.len() >= 4)
            })
    } else {
        nombre_norm.contains(&patron_norm)
    };
    if !hay {
        return false;
    }
    match patron_editor.map(str::trim).filter(|e| !e.is_empty()) {
        Some(pe) => editor
            .map(|e| e.trim().to_lowercase().contains(&pe.to_lowercase()))
            .unwrap_or(false),
        None => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn test_coincide_limite_palabra() {
        // Palabra corta (longitud < 4): solo match de palabra completa
        assert!(coincide("Git for Windows", None, "git", None));
        assert!(coincide("Git", None, "git", None));
        assert!(coincide("Cliente Git-SCM", None, "git", None));
        assert!(!coincide("Logitech Gaming Software", None, "git", None));
        assert!(!coincide("Digital Audio Workstation", None, "git", None));

        // Palabra >= 4 caracteres: prefijo válido
        assert!(coincide("Docker Desktop", None, "docker", None));
        assert!(coincide("dockerservice", None, "docker", None));

        // Patrones con espacios o símbolos: contención directa
        assert!(coincide(
            "Microsoft Visual Studio Code",
            None,
            "visual studio code",
            None
        ));
        assert!(coincide("SQL Server 2019", None, "sql server", None));
        assert!(!coincide("PostgreSQL", None, "mysql", None));

        // Patrón vacío
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
    fn test_reglas_integradas_e_informacion() {
        let reglas = ReglasClasificacion::integradas();
        assert!(
            !reglas.whitelist.is_empty(),
            "La whitelist no debe estar vacía"
        );
        assert!(!reglas.ruido.is_empty(), "El ruido no debe estar vacío");
        assert!(
            !reglas.categorias.is_empty(),
            "Las categorías no deben estar vacías"
        );

        let info = reglas.informacion();
        assert_eq!(info.total_whitelist, reglas.whitelist.len());
        assert!(!info.categorias.is_empty());
        assert!(info.origen_reglas.contains("integradas"));
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
    fn test_cargar_reglas_desde_archivo_y_fallback() {
        // Fallback cuando la ruta no existe
        let reglas_fallback = ReglasClasificacion::cargar(Some("archivo_que_no_existe_9999.toml"));
        assert!(!reglas_fallback.whitelist.is_empty());
        assert!(reglas_fallback.origen.contains("el archivo externo falló"));

        // Carga exitosa de archivo TOML personalizado
        let temp_toml = std::env::temp_dir().join("vminventory_test_reglas.toml");
        let toml_content = r#"
            [[whitelist]]
            nombre = "MiSoftwareCritico"
            editor = "MiEmpresa"
            motivo = "Software clave de la organización"

            [[ruido]]
            nombre = "AgenteDeMonitoreoInterno"
            motivo = "Telemetría interna descartable"

            [[categoria]]
            nombre = "Sistemas Propietarios"
            patrones = ["MiSoftwareCritico", "ERP_Corporativo"]
            tags = ["interno", "critico"]
        "#;

        let mut f = std::fs::File::create(&temp_toml).expect("Crear archivo TOML de prueba");
        f.write_all(toml_content.as_bytes()).expect("Escribir TOML");

        let reglas_custom = ReglasClasificacion::cargar(Some(temp_toml.to_str().unwrap()));
        assert!(reglas_custom.origen.contains("combinado"));

        // Debe clasificar según la nueva whitelist
        let res1 = reglas_custom.clasificar("MiSoftwareCritico v2", Some("MiEmpresa"));
        assert!(res1.es_relevante);
        assert!(res1.es_whitelist);
        assert_eq!(res1.categoria.as_deref(), Some("Sistemas Propietarios"));
        assert!(res1.tags.contains(&"critico".to_string()));

        // Debe descartar según el nuevo ruido
        let res2 = reglas_custom.clasificar("AgenteDeMonitoreoInterno", None);
        assert!(!res2.es_relevante);

        let _ = std::fs::remove_file(&temp_toml);
    }
}

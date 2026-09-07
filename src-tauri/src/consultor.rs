//! # Módulo Consultor de Software e Inventario de VMs
//!
//! Aísla y centraliza toda la lógica de indexación, consulta, autocompletado y
//! filtrado de software en máquinas virtuales sobre archivos de reporte JSON.
//!
//! Filtros soportados:
//! - Programa / Aplicación
//! - Versión del programa
//! - Máquina virtual (nombre, nombre interno, ruta)
//! - Tipo de posesión / Ubicación (Personas, Discos, Servidores)
//! - Propietario / Asignado / Elemento

use crate::models::{
    BdRelevamiento, CoincidenciaSoftware, InformeDirecto, ProgramaClasificado, RegistroVM,
    ResultadoConsultaSoftware,
};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

/// Criterios de filtrado normalizados para la consulta de software.
#[derive(Clone, Debug, Default)]
pub struct FiltrosConsultor {
    pub programa: Option<String>,
    pub version: Option<String>,
    pub vm: Option<String>,
    pub tipo: Option<String>,
    pub propietario: Option<String>,
}

impl FiltrosConsultor {
    /// Construye una nueva instancia normalizando las cadenas (minúsculas, trim, descarte de centinelas).
    pub fn nuevo(
        programa: Option<String>,
        version: Option<String>,
        vm: Option<String>,
        tipo: Option<String>,
        propietario: Option<String>,
    ) -> Self {
        let limpiar = |v: Option<String>| {
            v.map(|s| s.trim().to_lowercase()).filter(|s| {
                !s.is_empty()
                    && s != "-"
                    && s != "todos"
                    && s != "todas"
                    && s != "null"
                    && s != "undefined"
            })
        };

        Self {
            programa: limpiar(programa),
            version: limpiar(version),
            vm: limpiar(vm),
            tipo: limpiar(tipo),
            propietario: limpiar(propietario),
        }
    }

    /// Indica si al menos un filtro de búsqueda está activo.
    pub fn hay_filtros_activos(&self) -> bool {
        self.programa.is_some()
            || self.version.is_some()
            || self.vm.is_some()
            || self.tipo.is_some()
            || self.propietario.is_some()
    }

    /// Evalúa si una máquina virtual cumple con los filtros a nivel de VM (VM, Tipo y Propietario).
    pub fn cumple_vm(&self, vm: &RegistroVM) -> bool {
        // 1. Filtro por Máquina Virtual
        if let Some(patron) = &self.vm {
            let carpeta_ok = texto_coincide(&vm.nombre_vm, patron);
            let interno_ok = texto_opcion_coincide(vm.nombre_interno.as_deref(), patron);
            let ruta_ok = texto_coincide(&vm.ruta_carpeta, patron);
            if !carpeta_ok && !interno_ok && !ruta_ok {
                return false;
            }
        }

        // 2. Filtro por Tipo / Ubicación
        if let Some(tipo_filtro) = &self.tipo {
            let tipo_ok = texto_opcion_coincide(vm.tipo_posesion.as_deref(), tipo_filtro)
                || texto_opcion_coincide(vm.origen_categoria.as_deref(), tipo_filtro);
            if !tipo_ok {
                return false;
            }
        }

        // 3. Filtro por Propietario / Asignado / Elemento
        if let Some(prop_filtro) = &self.propietario {
            let prop_ok = texto_opcion_coincide(vm.propietario.as_deref(), prop_filtro)
                || texto_opcion_coincide(vm.elemento_asignado.as_deref(), prop_filtro)
                || texto_opcion_coincide(vm.asignado.as_deref(), prop_filtro)
                || texto_opcion_coincide(vm.elemento.as_deref(), prop_filtro);
            if !prop_ok {
                return false;
            }
        }

        true
    }

    /// Evalúa si un programa cumple con el filtro de Programa (nombre, editor o tags).
    pub fn cumple_programa(&self, programa: &ProgramaClasificado) -> bool {
        if let Some(patron) = &self.programa {
            let nombre_ok = texto_coincide(&programa.nombre, patron);
            let editor_ok = texto_opcion_coincide(programa.editor.as_deref(), patron);
            let tag_ok = programa.tags.iter().any(|t| texto_coincide(t, patron));
            if !nombre_ok && !editor_ok && !tag_ok {
                return false;
            }
        }
        true
    }

    /// Evalúa si un programa cumple con el filtro de Versión.
    pub fn cumple_version(&self, programa: &ProgramaClasificado) -> bool {
        if let Some(patron) = &self.version {
            if !texto_opcion_coincide(programa.version.as_deref(), patron) {
                return false;
            }
        }
        true
    }

    /// Evalúa si el par (VM, Programa) satisface todos los criterios activos.
    pub fn cumple(&self, vm: &RegistroVM, programa: &ProgramaClasificado) -> bool {
        self.cumple_vm(vm) && self.cumple_programa(programa) && self.cumple_version(programa)
    }
}

/// Comprueba si un texto coincide con un patrón de búsqueda de forma insensible a mayúsculas,
/// soportando coincidencias tanto con espacios como con guiones bajos.
pub fn texto_coincide(valor: &str, patron: &str) -> bool {
    let v_low = valor.trim().to_lowercase();
    let p_low = patron.trim().to_lowercase();
    if p_low.is_empty() {
        return true;
    }
    let p_espacios = p_low.replace('_', " ");
    let v_espacios = v_low.replace('_', " ");
    v_low.contains(&p_low)
        || v_low.contains(&p_espacios)
        || v_espacios.contains(&p_low)
        || v_espacios.contains(&p_espacios)
}

/// Comprueba si una opción de texto coincide con el patrón.
pub fn texto_opcion_coincide(valor: Option<&str>, patron: &str) -> bool {
    valor.map(|v| texto_coincide(v, patron)).unwrap_or(false)
}

/// Sanitiza una cadena opcional eliminando cadenas vacías, "-", "null", "undefined".
pub fn sanitizar_opcion(val: Option<&str>) -> Option<String> {
    let s = val?.trim();
    if s.is_empty()
        || s == "-"
        || s.eq_ignore_ascii_case("null")
        || s.eq_ignore_ascii_case("undefined")
    {
        None
    } else {
        Some(s.to_string())
    }
}

/// Deducir nombre de entidad legible a partir del nombre o stem del archivo de reporte.
pub fn deducir_nombre_entidad_desde_archivo(stem: &str) -> Option<String> {
    let s = stem.trim();
    if s.is_empty()
        || s.eq_ignore_ascii_case("reporte")
        || s.eq_ignore_ascii_case("informe")
        || s.eq_ignore_ascii_case("vms")
        || s.eq_ignore_ascii_case("inventario")
    {
        None
    } else {
        let con_espacios = s.replace('_', " ");
        Some(con_espacios.trim().to_string())
    }
}

#[derive(Clone, Debug)]
pub struct ArchivoReporteInfo {
    pub ruta: PathBuf,
    pub categoria_inferida: Option<String>,
    pub subcarpeta_nombre: Option<String>,
}

/// Normaliza una cadena de categoría a uno de los 3 valores canónicos: "Personas", "Discos", "Servidores".
pub fn normalizar_categoria_origen(texto: &str) -> String {
    let lower = texto.to_lowercase();
    if lower.contains("serv") {
        "Servidores".to_string()
    } else if lower.contains("disco") || lower.contains("disk") {
        "Discos".to_string()
    } else {
        "Personas".to_string()
    }
}

/// Recorre recursivamente un directorio raíz identificando subcarpetas `Personas/`, `Discos/`, `Servidores/`
/// y recolectando todos los archivos `.json` con su categoría asignada.
pub fn recolectar_archivos_json(directorio_raiz: &Path) -> Vec<ArchivoReporteInfo> {
    let mut resultado = Vec::new();
    let mut stack: Vec<(PathBuf, Option<String>, Option<String>)> =
        vec![(directorio_raiz.to_path_buf(), None, None)];

    while let Some((dir_actual, cat_heredada, sub_heredada)) = stack.pop() {
        let entradas = match std::fs::read_dir(&dir_actual) {
            Ok(e) => e,
            Err(_) => continue,
        };

        for entrada in entradas.flatten() {
            let path = entrada.path();
            let file_name = match path.file_name().and_then(|n| n.to_str()) {
                Some(n) => n.to_string(),
                None => continue,
            };

            if path.is_dir() {
                let name_lower = file_name.to_lowercase();
                let (nueva_cat, nueva_sub) = match cat_heredada.as_deref() {
                    Some("Personas") | Some("Discos") | Some("Servidores") => {
                        let sub = sub_heredada.clone().or(Some(file_name.clone()));
                        (cat_heredada.clone(), sub)
                    }
                    _ => {
                        if name_lower == "personas" || name_lower.contains("persona") {
                            (Some("Personas".to_string()), None)
                        } else if name_lower == "discos"
                            || name_lower.contains("disco")
                            || name_lower.contains("disk")
                        {
                            (Some("Discos".to_string()), None)
                        } else if name_lower == "servidores"
                            || name_lower.contains("servidor")
                            || name_lower.contains("server")
                        {
                            (Some("Servidores".to_string()), None)
                        } else {
                            (None, None)
                        }
                    }
                };
                stack.push((path, nueva_cat, nueva_sub));
            } else if path.is_file() {
                let es_json = path
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|e| e.eq_ignore_ascii_case("json"))
                    .unwrap_or(false);
                if es_json {
                    let cat = cat_heredada.clone().or_else(|| {
                        let ruta_str = path.to_string_lossy().to_lowercase();
                        if ruta_str.contains("serv") {
                            Some("Servidores".to_string())
                        } else if ruta_str.contains("disco") || ruta_str.contains("disk") {
                            Some("Discos".to_string())
                        } else if ruta_str.contains("persona") {
                            Some("Personas".to_string())
                        } else {
                            None
                        }
                    });
                    resultado.push(ArchivoReporteInfo {
                        ruta: path,
                        categoria_inferida: cat,
                        subcarpeta_nombre: sub_heredada.clone(),
                    });
                }
            }
        }
    }

    resultado.sort_by(|a, b| a.ruta.cmp(&b.ruta));
    resultado
}

/// Ejecuta la consulta de software sobre el directorio de reportes JSON y devuelve
/// totales, opciones de autocompletado y coincidencias filtradas.
pub fn consultar_software_inventario(
    directorio: &str,
    filtro_programa: Option<String>,
    filtro_version: Option<String>,
    filtro_vm: Option<String>,
    filtro_tipo: Option<String>,
    filtro_propietario: Option<String>,
) -> Result<ResultadoConsultaSoftware, String> {
    let ruta = Path::new(directorio);
    if !ruta.is_dir() {
        return Err("El directorio especificado no existe".to_string());
    }

    let archivos_info = recolectar_archivos_json(ruta);
    let filtros = FiltrosConsultor::nuevo(
        filtro_programa,
        filtro_version,
        filtro_vm,
        filtro_tipo,
        filtro_propietario,
    );
    let hay_filtros = filtros.hay_filtros_activos();

    let mut coincidencias: Vec<CoincidenciaSoftware> = Vec::new();
    let mut programas: BTreeSet<String> = BTreeSet::new();
    let mut vms: BTreeSet<String> = BTreeSet::new();
    let mut versiones: BTreeSet<String> = BTreeSet::new();
    let mut propietarios: BTreeSet<String> = BTreeSet::new();
    let mut asignados: BTreeSet<String> = BTreeSet::new();
    let mut elementos: BTreeSet<String> = BTreeSet::new();
    let mut tipos: BTreeSet<String> = BTreeSet::new();
    let mut categorias: BTreeSet<String> = BTreeSet::new();
    let mut tags: BTreeSet<String> = BTreeSet::new();
    let mut total_vms_escaneadas = 0usize;
    let mut total_programas_indexados = 0usize;

    for archivo_info in &archivos_info {
        let nombre_archivo = archivo_info
            .ruta
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let stem_archivo = archivo_info
            .ruta
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        let contenido = match std::fs::read_to_string(&archivo_info.ruta) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let lista_vms: Vec<RegistroVM> =
            if let Ok(bd) = serde_json::from_str::<BdRelevamiento>(&contenido) {
                bd.vms
            } else if let Ok(vms_arr) = serde_json::from_str::<Vec<RegistroVM>>(&contenido) {
                vms_arr
            } else if let Ok(single_vm) = serde_json::from_str::<RegistroVM>(&contenido) {
                vec![single_vm]
            } else if let Ok(direct_info) = serde_json::from_str::<InformeDirecto>(&contenido) {
                let vm_name = Path::new(&direct_info.archivo)
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| "VM Inspeccionada".to_string());
                let ruta_dir = Path::new(&direct_info.archivo)
                    .parent()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_else(|| direct_info.archivo.clone());
                let os_nombre = if !direct_info.vm_info.os_nombre.is_empty() {
                    direct_info.vm_info.os_nombre.clone()
                } else {
                    direct_info.sistema_operativo.clone()
                };
                vec![RegistroVM {
                    exitosa: direct_info.exito,
                    nombre_vm: vm_name.clone(),
                    nombre_interno: Some(vm_name),
                    ruta_carpeta: ruta_dir,
                    propietario: None,
                    tipo_posesion: archivo_info.categoria_inferida.clone(),
                    elemento_asignado: None,
                    origen_categoria: archivo_info.categoria_inferida.clone(),
                    asignado: None,
                    elemento: None,
                    sistema_operativo: os_nombre,
                    hipervisor: Some(direct_info.imagen.hipervisor),
                    peso_gb: direct_info.imagen.tamano_real as f64 / (1024.0 * 1024.0 * 1024.0),
                    discrepante: false,
                    observaciones: direct_info.advertencias,
                    fecha_relevamiento: String::new(),
                    programas: direct_info.programas,
                    peso_bytes: direct_info.imagen.tamano_real,
                }]
            } else {
                continue;
            };

        total_vms_escaneadas += lista_vms.len();
        for mut vm in lista_vms {
            let cat_raw = vm
                .origen_categoria
                .as_deref()
                .or(archivo_info.categoria_inferida.as_deref())
                .or(vm.tipo_posesion.as_deref())
                .unwrap_or("Personas");
            let cat_normalizada = normalizar_categoria_origen(cat_raw);
            vm.origen_categoria = Some(cat_normalizada.clone());
            vm.tipo_posesion = Some(cat_normalizada.clone());

            let entidad_archivo = deducir_nombre_entidad_desde_archivo(&stem_archivo);

            if cat_normalizada == "Personas" {
                let asig = sanitizar_opcion(vm.asignado.as_deref())
                    .or_else(|| sanitizar_opcion(vm.propietario.as_deref()))
                    .or_else(|| sanitizar_opcion(vm.elemento_asignado.as_deref()))
                    .or_else(|| sanitizar_opcion(archivo_info.subcarpeta_nombre.as_deref()))
                    .or_else(|| entidad_archivo.clone());
                vm.asignado = asig.clone();
                if vm.propietario.is_none() {
                    vm.propietario = asig.clone();
                }
                if vm.elemento_asignado.is_none() {
                    vm.elemento_asignado = asig.clone();
                }
                if let Some(a) = &asig {
                    asignados.insert(a.clone());
                    propietarios.insert(a.clone());
                }
            } else {
                let elem = sanitizar_opcion(vm.elemento.as_deref())
                    .or_else(|| sanitizar_opcion(vm.elemento_asignado.as_deref()))
                    .or_else(|| sanitizar_opcion(vm.propietario.as_deref()))
                    .or_else(|| sanitizar_opcion(archivo_info.subcarpeta_nombre.as_deref()))
                    .or_else(|| entidad_archivo.clone());
                vm.elemento = elem.clone();
                if vm.elemento_asignado.is_none() {
                    vm.elemento_asignado = elem.clone();
                }
                if vm.propietario.is_none() {
                    vm.propietario = elem.clone();
                }
                if let Some(e) = &elem {
                    elementos.insert(e.clone());
                    propietarios.insert(e.clone());
                }
            }

            if let Some(nom_vm) = sanitizar_opcion(Some(&vm.nombre_vm)) {
                vms.insert(nom_vm);
            }
            tipos.insert(cat_normalizada.clone());

            if let Some(p) = sanitizar_opcion(vm.propietario.as_deref()) {
                propietarios.insert(p);
            }
            if let Some(ea) = sanitizar_opcion(vm.elemento_asignado.as_deref()) {
                propietarios.insert(ea);
            }

            // ¿Cumple la VM con los filtros a nivel de VM (VM, Tipo, Propietario)?
            let vm_cumple_filtros = filtros.cumple_vm(&vm);

            for programa in &vm.programas {
                total_programas_indexados += 1;

                if let Some(np) = sanitizar_opcion(Some(&programa.nombre)) {
                    programas.insert(np);
                }
                if let Some(c) = sanitizar_opcion(programa.categoria.as_deref()) {
                    categorias.insert(c);
                }
                for t in &programa.tags {
                    if let Some(tag_limpio) = sanitizar_opcion(Some(t)) {
                        tags.insert(tag_limpio);
                    }
                }

                // ====================================================================
                // AUTOCOMPLETADO DE VERSIONES AISLADO:
                // Si el usuario filtró por una app (programa), solo incluimos en
                // `versiones_disponibles` las versiones correspondientes a esa app.
                // ====================================================================
                let programa_coincide = filtros.cumple_programa(programa);
                if let Some(v) = sanitizar_opcion(programa.version.as_deref()) {
                    if filtros.programa.is_some() {
                        // Si hay filtro de programa, solo agregar versiones de esa app
                        if programa_coincide && vm_cumple_filtros {
                            versiones.insert(v);
                        }
                    } else if vm_cumple_filtros {
                        // Si no hay filtro de programa pero hay filtro de VM/propietario/tipo
                        versiones.insert(v);
                    } else if !hay_filtros {
                        // Sin filtros activos, mostrar todas las versiones
                        versiones.insert(v);
                    }
                }

                // Coincidencia para la lista de resultados
                if hay_filtros
                    && vm_cumple_filtros
                    && programa_coincide
                    && filtros.cumple_version(programa)
                {
                    coincidencias.push(CoincidenciaSoftware {
                        nombre_programa: programa.nombre.clone(),
                        version: sanitizar_opcion(programa.version.as_deref()),
                        editor: sanitizar_opcion(programa.editor.as_deref()),
                        categoria: sanitizar_opcion(programa.categoria.as_deref()),
                        tags: programa.tags.clone(),
                        nombre_vm: vm.nombre_vm.clone(),
                        nombre_interno: sanitizar_opcion(vm.nombre_interno.as_deref()),
                        ruta_carpeta: vm.ruta_carpeta.clone(),
                        propietario: sanitizar_opcion(vm.propietario.as_deref()),
                        tipo_posesion: Some(cat_normalizada.clone()),
                        elemento_asignado: sanitizar_opcion(vm.elemento_asignado.as_deref()),
                        origen_categoria: Some(cat_normalizada.clone()),
                        asignado: sanitizar_opcion(vm.asignado.as_deref()),
                        elemento: sanitizar_opcion(vm.elemento.as_deref()),
                        sistema_operativo: vm.sistema_operativo.clone(),
                        peso_gb: vm.peso_gb,
                        hipervisor: sanitizar_opcion(vm.hipervisor.as_deref()),
                        discrepante: Some(vm.discrepante),
                        archivo_json: nombre_archivo.clone(),
                        fecha_relevamiento: vm.fecha_relevamiento.clone(),
                    });
                }
            }
        }
    }

    Ok(ResultadoConsultaSoftware {
        total_archivos_json: archivos_info.len(),
        total_vms_escaneadas,
        total_programas_indexados,
        programas_disponibles: programas.into_iter().collect(),
        vms_disponibles: vms.into_iter().collect(),
        versiones_disponibles: versiones.into_iter().collect(),
        propietarios_disponibles: propietarios.into_iter().collect(),
        asignados_disponibles: asignados.into_iter().collect(),
        elementos_disponibles: elementos.into_iter().collect(),
        tipos_disponibles: tipos.into_iter().collect(),
        categorias_disponibles: categorias.into_iter().collect(),
        tags_disponibles: tags.into_iter().collect(),
        coincidencias,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::MetadatosRelevamiento;
    use std::fs::File;
    use std::io::Write;

    fn crear_vm_ejemplo() -> (RegistroVM, ProgramaClasificado) {
        let programa = ProgramaClasificado {
            nombre: "Microsoft SQL Server 2019".to_string(),
            version: Some("15.0.2000".to_string()),
            editor: Some("Microsoft Corporation".to_string()),
            categoria: Some("Bases de datos".to_string()),
            tags: vec!["db".to_string(), "sql".to_string(), "rdbms".to_string()],
            relevante: true,
        };

        let vm = RegistroVM {
            exitosa: true,
            nombre_vm: "SRV-SQL-PROD".to_string(),
            nombre_interno: Some("SRV-SQL-INTERNAL".to_string()),
            ruta_carpeta: "D:\\Servidores\\SRV-SQL-PROD".to_string(),
            propietario: Some("Infraestructura".to_string()),
            tipo_posesion: Some("Servidores".to_string()),
            elemento_asignado: Some("Cluster-A".to_string()),
            origen_categoria: Some("Servidores".to_string()),
            asignado: None,
            elemento: Some("Cluster-A".to_string()),
            sistema_operativo: "Windows Server 2022".to_string(),
            hipervisor: Some("VMware".to_string()),
            peso_gb: 40.0,
            discrepante: false,
            observaciones: vec![],
            fecha_relevamiento: "2026-09-07".to_string(),
            programas: vec![programa.clone()],
            peso_bytes: 42949672960,
        };

        (vm, programa)
    }

    #[test]
    fn test_filtros_consultor_normalizacion_y_activos() {
        let f_vacio = FiltrosConsultor::nuevo(
            None,
            Some("   ".to_string()),
            None,
            Some("todos".to_string()),
            None,
        );
        assert!(!f_vacio.hay_filtros_activos());

        let f_prog = FiltrosConsultor::nuevo(
            Some("  PostgreSQL  ".to_string()),
            Some("15.2".to_string()),
            None,
            None,
            None,
        );
        assert!(f_prog.hay_filtros_activos());
        assert_eq!(f_prog.programa.as_deref(), Some("postgresql"));
        assert_eq!(f_prog.version.as_deref(), Some("15.2"));
    }

    #[test]
    fn test_filtros_consultor_cumple() {
        let (vm, prog) = crear_vm_ejemplo();

        // 1. Coincidencia por nombre de programa
        let f1 = FiltrosConsultor::nuevo(Some("sql server".to_string()), None, None, None, None);
        assert!(f1.cumple(&vm, &prog));

        // 2. Coincidencia por tag
        let f2 = FiltrosConsultor::nuevo(Some("rdbms".to_string()), None, None, None, None);
        assert!(f2.cumple(&vm, &prog));

        // 3. Coincidencia por versión
        let f3 = FiltrosConsultor::nuevo(None, Some("15.0".to_string()), None, None, None);
        assert!(f3.cumple(&vm, &prog));

        // 4. Coincidencia por nombre VM
        let f4 = FiltrosConsultor::nuevo(None, None, Some("srv-sql".to_string()), None, None);
        assert!(f4.cumple(&vm, &prog));

        // 5. Coincidencia por tipo
        let f5 = FiltrosConsultor::nuevo(None, None, None, Some("Servidores".to_string()), None);
        assert!(f5.cumple(&vm, &prog));

        // 6. Coincidencia por propietario / asignado
        let f6 = FiltrosConsultor::nuevo(None, None, None, None, Some("Cluster-A".to_string()));
        assert!(f6.cumple(&vm, &prog));

        // 7. No coincidencia
        let f_mismatch =
            FiltrosConsultor::nuevo(Some("Oracle".to_string()), None, None, None, None);
        assert!(!f_mismatch.cumple(&vm, &prog));
    }

    #[test]
    fn test_aislamiento_sugerencias_version_por_app() {
        let temp_dir = std::env::temp_dir().join("test_sugerencias_version_app");
        let _ = std::fs::remove_dir_all(&temp_dir);
        std::fs::create_dir_all(&temp_dir).unwrap();

        let vm = RegistroVM {
            exitosa: true,
            nombre_vm: "Dev-Box".to_string(),
            nombre_interno: None,
            ruta_carpeta: "D:\\VMs\\Dev".to_string(),
            propietario: Some("Operador".to_string()),
            tipo_posesion: Some("Personas".to_string()),
            elemento_asignado: Some("Operador".to_string()),
            origen_categoria: Some("Personas".to_string()),
            asignado: Some("Operador".to_string()),
            elemento: None,
            sistema_operativo: "Ubuntu 22.04".to_string(),
            hipervisor: Some("VMware".to_string()),
            peso_gb: 20.0,
            discrepante: false,
            observaciones: vec![],
            fecha_relevamiento: "2026-09-07".to_string(),
            programas: vec![
                ProgramaClasificado {
                    nombre: "Python".to_string(),
                    version: Some("3.11.4".to_string()),
                    editor: None,
                    categoria: None,
                    tags: vec![],
                    relevante: true,
                },
                ProgramaClasificado {
                    nombre: "Python".to_string(),
                    version: Some("2.7.18".to_string()),
                    editor: None,
                    categoria: None,
                    tags: vec![],
                    relevante: true,
                },
                ProgramaClasificado {
                    nombre: "Node.js".to_string(),
                    version: Some("20.9.0".to_string()),
                    editor: None,
                    categoria: None,
                    tags: vec![],
                    relevante: true,
                },
                ProgramaClasificado {
                    nombre: "PostgreSQL".to_string(),
                    version: Some("15.2".to_string()),
                    editor: None,
                    categoria: None,
                    tags: vec![],
                    relevante: true,
                },
            ],
            peso_bytes: 20000000000,
        };

        let mut f = File::create(temp_dir.join("inventario.json")).unwrap();
        f.write_all(serde_json::to_string(&vec![vm]).unwrap().as_bytes())
            .unwrap();

        // 1. Filtrando por "Python": solo deben aparecer versiones de Python
        let res_py = consultar_software_inventario(
            temp_dir.to_str().unwrap(),
            Some("Python".to_string()),
            None,
            None,
            None,
            None,
        )
        .unwrap();

        assert_eq!(res_py.versiones_disponibles.len(), 2);
        assert!(res_py.versiones_disponibles.contains(&"3.11.4".to_string()));
        assert!(res_py.versiones_disponibles.contains(&"2.7.18".to_string()));
        assert!(!res_py.versiones_disponibles.contains(&"20.9.0".to_string()));
        assert!(!res_py.versiones_disponibles.contains(&"15.2".to_string()));

        // 2. Filtrando por "Node": solo versión de Node
        let res_node = consultar_software_inventario(
            temp_dir.to_str().unwrap(),
            Some("Node".to_string()),
            None,
            None,
            None,
            None,
        )
        .unwrap();

        assert_eq!(res_node.versiones_disponibles.len(), 1);
        assert_eq!(res_node.versiones_disponibles[0], "20.9.0");

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_consultar_software_end_to_end() {
        let temp_dir = std::env::temp_dir().join("vminventory_test_consultor_e2e");
        let _ = std::fs::remove_dir_all(&temp_dir);
        std::fs::create_dir_all(&temp_dir).unwrap();

        let dir_personas = temp_dir.join("Personas").join("OperadorDev");
        let dir_discos = temp_dir.join("Discos").join("Disco01");
        let dir_servidores = temp_dir.join("Servidores").join("ClusterA");
        std::fs::create_dir_all(&dir_personas).unwrap();
        std::fs::create_dir_all(&dir_discos).unwrap();
        std::fs::create_dir_all(&dir_servidores).unwrap();

        let (vm1, _) = crear_vm_ejemplo();
        let bd_serv = BdRelevamiento {
            metadatos: MetadatosRelevamiento {
                aplicacion: "VM Inventory".to_string(),
                fecha_relevamiento: "2026-09-07".to_string(),
                ruta_origen: "D:\\Servidores".to_string(),
                duracion_formateada: "00:01:00".to_string(),
                total_vms: 1,
                vms_exitosas: 1,
                vms_con_observaciones: 0,
                vms_discrepantes: 0,
                vms_fallidas: 0,
                total_programas: 1,
                peso_total_gb: 40.0,
                cancelado: false,
            },
            vms: vec![vm1],
        };

        let vm_persona = RegistroVM {
            exitosa: true,
            nombre_vm: "PC-Dev".to_string(),
            nombre_interno: None,
            ruta_carpeta: "C:\\Users\\Dev".to_string(),
            propietario: Some("Operador Dev".to_string()),
            tipo_posesion: Some("Personas".to_string()),
            elemento_asignado: Some("Operador Dev".to_string()),
            origen_categoria: Some("Personas".to_string()),
            asignado: Some("Operador Dev".to_string()),
            elemento: None,
            sistema_operativo: "Windows 11".to_string(),
            hipervisor: Some("VirtualBox".to_string()),
            peso_gb: 20.0,
            discrepante: false,
            observaciones: vec![],
            fecha_relevamiento: "2026-09-07".to_string(),
            programas: vec![ProgramaClasificado {
                nombre: "Visual Studio Code".to_string(),
                version: Some("1.85.0".to_string()),
                editor: Some("Microsoft".to_string()),
                categoria: Some("Desarrollo".to_string()),
                tags: vec!["editor".to_string()],
                relevante: true,
            }],
            peso_bytes: 21474836480,
        };

        let vm_disco = RegistroVM {
            exitosa: true,
            nombre_vm: "Backup-VM".to_string(),
            nombre_interno: None,
            ruta_carpeta: "E:\\VMs\\Backup".to_string(),
            propietario: Some("Disco01".to_string()),
            tipo_posesion: Some("Discos".to_string()),
            elemento_asignado: Some("Disco01".to_string()),
            origen_categoria: Some("Discos".to_string()),
            asignado: None,
            elemento: Some("Disco01".to_string()),
            sistema_operativo: "Linux Debian 12".to_string(),
            hipervisor: Some("VMware".to_string()),
            peso_gb: 15.0,
            discrepante: false,
            observaciones: vec![],
            fecha_relevamiento: "2026-09-07".to_string(),
            programas: vec![ProgramaClasificado {
                nombre: "Docker".to_string(),
                version: Some("24.0".to_string()),
                editor: Some("Docker Inc".to_string()),
                categoria: Some("Contenedores".to_string()),
                tags: vec!["containers".to_string()],
                relevante: true,
            }],
            peso_bytes: 16106127360,
        };

        let mut f_serv = File::create(dir_servidores.join("reporte_serv.json")).unwrap();
        f_serv
            .write_all(serde_json::to_string(&bd_serv).unwrap().as_bytes())
            .unwrap();

        let mut f_per = File::create(dir_personas.join("reporte_per.json")).unwrap();
        f_per
            .write_all(serde_json::to_string(&vec![vm_persona]).unwrap().as_bytes())
            .unwrap();

        let mut f_disc = File::create(dir_discos.join("reporte_disc.json")).unwrap();
        f_disc
            .write_all(serde_json::to_string(&vec![vm_disco]).unwrap().as_bytes())
            .unwrap();

        // 1. Consulta sin filtros
        let res_todos =
            consultar_software_inventario(temp_dir.to_str().unwrap(), None, None, None, None, None)
                .expect("Debe consultar software sin error");

        assert_eq!(res_todos.total_archivos_json, 3);
        assert_eq!(res_todos.total_vms_escaneadas, 3);
        assert_eq!(res_todos.total_programas_indexados, 3);
        assert!(res_todos
            .programas_disponibles
            .contains(&"Microsoft SQL Server 2019".to_string()));
        assert!(res_todos
            .programas_disponibles
            .contains(&"Visual Studio Code".to_string()));
        assert!(res_todos
            .programas_disponibles
            .contains(&"Docker".to_string()));
        assert!(res_todos
            .vms_disponibles
            .contains(&"SRV-SQL-PROD".to_string()));
        assert!(res_todos.vms_disponibles.contains(&"PC-Dev".to_string()));
        assert!(res_todos
            .tipos_disponibles
            .contains(&"Personas".to_string()));
        assert!(res_todos.tipos_disponibles.contains(&"Discos".to_string()));
        assert!(res_todos
            .tipos_disponibles
            .contains(&"Servidores".to_string()));
        assert!(res_todos.coincidencias.is_empty());

        // 2. Consulta con filtro Propietario (Personas)
        let res_asig = consultar_software_inventario(
            temp_dir.to_str().unwrap(),
            None,
            None,
            None,
            None,
            Some("operador".to_string()),
        )
        .expect("Consulta filtrada por Asignado");

        assert_eq!(res_asig.coincidencias.len(), 1);
        assert_eq!(
            res_asig.coincidencias[0].nombre_programa,
            "Visual Studio Code"
        );

        // 3. Consulta con filtro VM
        let res_vm = consultar_software_inventario(
            temp_dir.to_str().unwrap(),
            None,
            None,
            Some("Backup-VM".to_string()),
            None,
            None,
        )
        .expect("Consulta filtrada por VM");

        assert_eq!(res_vm.coincidencias.len(), 1);
        assert_eq!(res_vm.coincidencias[0].nombre_programa, "Docker");

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}

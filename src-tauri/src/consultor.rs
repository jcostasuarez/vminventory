//! # Módulo Consultor de Software e Inventario de VMs
//!
//! Indexa reportes JSON contenidos en las subcarpetas directas de la carpeta de
//! inventario. Cada subcarpeta legible define dinámicamente un tipo.

use crate::models::{
    BdRelevamiento, CoincidenciaSoftware, InformeDirecto, ProgramaClasificado, RegistroVM,
    ResultadoConsultaSoftware,
};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

/// Criterios de filtrado normalizados para la consulta de software.
#[derive(Clone, Debug, Default)]
pub struct FiltrosConsultor {
    pub programa: Option<String>,
    pub version: Option<String>,
    pub vm: Option<String>,
    pub tipo: Option<String>,
    pub responsable: Option<String>,
}

impl FiltrosConsultor {
    pub fn nuevo(
        programa: Option<String>,
        version: Option<String>,
        vm: Option<String>,
        tipo: Option<String>,
        responsable: Option<String>,
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
            responsable: limpiar(responsable),
        }
    }

    pub fn hay_filtros_activos(&self) -> bool {
        self.programa.is_some()
            || self.version.is_some()
            || self.vm.is_some()
            || self.tipo.is_some()
            || self.responsable.is_some()
    }

    pub fn cumple_vm(&self, vm: &RegistroVM) -> bool {
        if let Some(patron) = &self.vm {
            let carpeta_ok = texto_coincide(&vm.nombre_vm, patron);
            let interno_ok = texto_opcion_coincide(vm.nombre_interno.as_deref(), patron);
            let ruta_ok = texto_coincide(&vm.ruta_carpeta, patron);
            if !carpeta_ok && !interno_ok && !ruta_ok {
                return false;
            }
        }

        if let Some(tipo_filtro) = &self.tipo {
            if !texto_opcion_coincide(vm.tipo.as_deref(), tipo_filtro) {
                return false;
            }
        }

        if let Some(responsable_filtro) = &self.responsable {
            if !texto_opcion_coincide(vm.responsable.as_deref(), responsable_filtro) {
                return false;
            }
        }

        true
    }

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

    pub fn cumple_version(&self, programa: &ProgramaClasificado) -> bool {
        self.version
            .as_deref()
            .map(|patron| texto_opcion_coincide(programa.version.as_deref(), patron))
            .unwrap_or(true)
    }

    pub fn cumple(&self, vm: &RegistroVM, programa: &ProgramaClasificado) -> bool {
        self.cumple_vm(vm) && self.cumple_programa(programa) && self.cumple_version(programa)
    }
}

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

pub fn texto_opcion_coincide(valor: Option<&str>, patron: &str) -> bool {
    valor.map(|v| texto_coincide(v, patron)).unwrap_or(false)
}

pub fn responsable_desde_archivo(ruta: &Path) -> Option<String> {
    let nombre = ruta.file_stem()?.to_string_lossy();
    let responsable = nombre.replace('_', " ").trim().to_string();
    (!responsable.is_empty()).then_some(responsable)
}

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

#[derive(Clone, Debug)]
pub struct ArchivoReporteInfo {
    pub ruta: PathBuf,
    pub tipo: String,
}

#[derive(Clone, Debug)]
struct TipoInventario {
    nombre: String,
    ruta: PathBuf,
}

/// Detecta los tipos desde las carpetas directas legibles del inventario.
///
/// Las carpetas vacías se exponen como tipos sin registros. Los archivos y las
/// carpetas inaccesibles se omiten. Si el sistema permite nombres que solo se
/// diferencian por mayúsculas/minúsculas, se conserva una única carpeta (la
/// primera por orden alfabético insensible a mayúsculas). Los JSON ubicados en
/// la raíz no se indexan: no pertenecen a ningún tipo.
fn detectar_tipos_inventario(directorio_raiz: &Path) -> Result<Vec<TipoInventario>, String> {
    let entradas = std::fs::read_dir(directorio_raiz).map_err(|e| {
        format!(
            "No se puede leer la carpeta de inventario ({}): {e}",
            directorio_raiz.display()
        )
    })?;
    let mut candidatas: Vec<(String, PathBuf)> = entradas
        .flatten()
        .filter_map(|entrada| {
            let ruta = entrada.path();
            if !ruta.is_dir() {
                return None;
            }
            let nombre = ruta.file_name()?.to_str()?.trim().to_string();
            (!nombre.is_empty()).then_some((nombre, ruta))
        })
        .collect();
    candidatas.sort_by(|a, b| {
        a.0.to_lowercase()
            .cmp(&b.0.to_lowercase())
            .then_with(|| a.0.cmp(&b.0))
    });

    let mut tipos = BTreeMap::new();
    for (nombre, ruta) in candidatas {
        // Abrir la carpeta aquí permite distinguir una carpeta vacía de una
        // carpeta a la que no se puede acceder.
        if std::fs::read_dir(&ruta).is_ok() {
            tipos
                .entry(nombre.to_lowercase())
                .or_insert(TipoInventario { nombre, ruta });
        }
    }
    Ok(tipos.into_values().collect())
}

/// Recolecta JSON recursivamente, sin cruzar los límites de cada tipo directo.
fn recolectar_json_en_tipo(directorio: &Path, tipo: &str, resultado: &mut Vec<ArchivoReporteInfo>) {
    let mut stack = vec![directorio.to_path_buf()];
    while let Some(actual) = stack.pop() {
        let entradas = match std::fs::read_dir(&actual) {
            Ok(entradas) => entradas,
            Err(_) => continue,
        };
        for entrada in entradas.flatten() {
            let ruta = entrada.path();
            if ruta.is_dir() {
                stack.push(ruta);
            } else if ruta.is_file()
                && ruta
                    .extension()
                    .and_then(|extension| extension.to_str())
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("json"))
            {
                resultado.push(ArchivoReporteInfo {
                    ruta,
                    tipo: tipo.to_string(),
                });
            }
        }
    }
}

pub fn recolectar_archivos_json(directorio_raiz: &Path) -> Result<Vec<ArchivoReporteInfo>, String> {
    let tipos = detectar_tipos_inventario(directorio_raiz)?;
    let mut resultado = Vec::new();
    for tipo in tipos {
        recolectar_json_en_tipo(&tipo.ruta, &tipo.nombre, &mut resultado);
    }
    resultado.sort_by(|a, b| a.ruta.cmp(&b.ruta));
    Ok(resultado)
}

pub fn consultar_software_inventario(
    directorio: &str,
    filtro_programa: Option<String>,
    filtro_version: Option<String>,
    filtro_vm: Option<String>,
    filtro_tipo: Option<String>,
    filtro_responsable: Option<String>,
) -> Result<ResultadoConsultaSoftware, String> {
    consultar_software_inventario_con_limite(
        directorio,
        filtro_programa,
        filtro_version,
        filtro_vm,
        filtro_tipo,
        filtro_responsable,
        30,
    )
}

pub fn consultar_software_inventario_con_limite(
    directorio: &str,
    filtro_programa: Option<String>,
    filtro_version: Option<String>,
    filtro_vm: Option<String>,
    filtro_tipo: Option<String>,
    filtro_responsable: Option<String>,
    limite_coincidencias: usize,
) -> Result<ResultadoConsultaSoftware, String> {
    let ruta = Path::new(directorio);
    if !ruta.is_dir() {
        return Err("La carpeta de inventario no existe".to_string());
    }

    let tipos_inventario = detectar_tipos_inventario(ruta)?;
    let mut archivos_info = Vec::new();
    for tipo in &tipos_inventario {
        recolectar_json_en_tipo(&tipo.ruta, &tipo.nombre, &mut archivos_info);
    }
    archivos_info.sort_by(|a, b| a.ruta.cmp(&b.ruta));

    let filtros = FiltrosConsultor::nuevo(
        filtro_programa,
        filtro_version,
        filtro_vm,
        filtro_tipo,
        filtro_responsable,
    );
    let hay_filtros = filtros.hay_filtros_activos();
    let limite_coincidencias = limite_coincidencias.clamp(10, 100);

    let mut coincidencias = Vec::new();
    let mut programas = BTreeSet::new();
    let mut vms = BTreeSet::new();
    let mut versiones = BTreeSet::new();
    let mut responsables = BTreeSet::new();
    let mut categorias = BTreeSet::new();
    let mut tags = BTreeSet::new();
    let mut total_vms_escaneadas = 0usize;
    let mut total_programas_indexados = 0usize;

    for archivo_info in &archivos_info {
        let nombre_archivo = archivo_info
            .ruta
            .file_name()
            .map(|nombre| nombre.to_string_lossy().to_string())
            .unwrap_or_default();
        let contenido = match std::fs::read_to_string(&archivo_info.ruta) {
            Ok(contenido) => contenido,
            Err(_) => continue,
        };

        let lista_vms: Vec<RegistroVM> =
            if let Ok(bd) = serde_json::from_str::<BdRelevamiento>(&contenido) {
                bd.vms
            } else if let Ok(vms) = serde_json::from_str::<Vec<RegistroVM>>(&contenido) {
                vms
            } else if let Ok(vm) = serde_json::from_str::<RegistroVM>(&contenido) {
                vec![vm]
            } else if let Ok(informe) = serde_json::from_str::<InformeDirecto>(&contenido) {
                let nombre_vm = Path::new(&informe.archivo)
                    .file_stem()
                    .map(|nombre| nombre.to_string_lossy().to_string())
                    .unwrap_or_else(|| "VM inspeccionada".to_string());
                let ruta_carpeta = Path::new(&informe.archivo)
                    .parent()
                    .map(|ruta| ruta.to_string_lossy().to_string())
                    .unwrap_or_else(|| informe.archivo.clone());
                vec![RegistroVM {
                    exitosa: informe.exito,
                    nombre_vm: nombre_vm.clone(),
                    nombre_interno: Some(nombre_vm),
                    ruta_carpeta,
                    responsable: None,
                    tipo: Some(archivo_info.tipo.clone()),
                    sistema_operativo: if informe.vm_info.os_nombre.is_empty() {
                        informe.sistema_operativo
                    } else {
                        informe.vm_info.os_nombre
                    },
                    hipervisor: Some(informe.imagen.hipervisor),
                    peso_gb: informe.imagen.tamano_real as f64 / (1024.0 * 1024.0 * 1024.0),
                    discrepante: false,
                    observaciones: informe.advertencias,
                    fecha_relevamiento: String::new(),
                    programas: informe.programas,
                    peso_bytes: informe.imagen.tamano_real,
                }]
            } else {
                continue;
            };

        total_vms_escaneadas += lista_vms.len();
        for mut vm in lista_vms {
            // El tipo persistido se ignora deliberadamente: la ubicación actual
            // del reporte dentro del inventario es la fuente de verdad.
            vm.tipo = Some(archivo_info.tipo.clone());
            // El nombre del reporte es la fuente de verdad del responsable;
            // así el filtro, las sugerencias y las tarjetas comparten el mismo valor.
            vm.responsable = responsable_desde_archivo(&archivo_info.ruta);

            if let Some(nombre) = sanitizar_opcion(Some(&vm.nombre_vm)) {
                vms.insert(nombre);
            }
            if let Some(responsable) = &vm.responsable {
                responsables.insert(responsable.clone());
            }

            let vm_cumple_filtros = filtros.cumple_vm(&vm);
            for programa in &vm.programas {
                total_programas_indexados += 1;
                if let Some(nombre) = sanitizar_opcion(Some(&programa.nombre)) {
                    programas.insert(nombre);
                }
                if let Some(categoria) = sanitizar_opcion(programa.categoria.as_deref()) {
                    categorias.insert(categoria);
                }
                for tag in &programa.tags {
                    if let Some(tag) = sanitizar_opcion(Some(tag)) {
                        tags.insert(tag);
                    }
                }

                let programa_coincide = filtros.cumple_programa(programa);
                if let Some(version) = sanitizar_opcion(programa.version.as_deref()) {
                    if (filtros.programa.is_some() && programa_coincide && vm_cumple_filtros)
                        || (filtros.programa.is_none() && vm_cumple_filtros)
                        || !hay_filtros
                    {
                        versiones.insert(version);
                    }
                }

                if hay_filtros
                    && filtros.cumple(&vm, programa)
                    && coincidencias.len() < limite_coincidencias
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
                        responsable: vm.responsable.clone(),
                        tipo: archivo_info.tipo.clone(),
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
        responsables_disponibles: responsables.into_iter().collect(),
        tipos_disponibles: tipos_inventario
            .into_iter()
            .map(|tipo| tipo.nombre)
            .collect(),
        categorias_disponibles: categorias.into_iter().collect(),
        tags_disponibles: tags.into_iter().collect(),
        coincidencias,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn directorio_temporal(nombre: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("reloj válido")
            .as_nanos();
        let ruta = std::env::temp_dir().join(format!("vminventory-{nombre}-{nonce}"));
        fs::create_dir_all(&ruta).expect("crear directorio temporal");
        ruta
    }

    fn reporte_legacy() -> &'static str {
        r#"{
          "exitosa": true,
          "nombre_vm": "vm-produccion",
          "ruta_carpeta": "/vms/produccion",
          "propietario": null,
          "tipo_posesion": "Personas",
          "elemento_asignado": null,
          "origen_categoria": "Personas",
          "asignado": "Operador A",
          "elemento": null,
          "sistema_operativo": "Windows",
          "peso_gb": 4.0,
          "fecha_relevamiento": "2026-01-01",
          "programas": [{"nombre": "Editor", "version": "1.0", "editor": null, "categoria": null, "tags": [], "relevante": true}]
        }"#
    }

    #[test]
    fn detecta_tipos_directos_e_ignora_archivos_y_raiz() {
        let raiz = directorio_temporal("tipos");
        fs::create_dir_all(raiz.join("Produccion/servidor-a")).unwrap();
        fs::create_dir_all(raiz.join("QA")).unwrap();
        fs::write(raiz.join("archivo.json"), reporte_legacy()).unwrap();
        fs::write(raiz.join("Produccion/reporte.json"), reporte_legacy()).unwrap();

        let tipos = detectar_tipos_inventario(&raiz).unwrap();
        assert_eq!(
            tipos.iter().map(|tipo| &tipo.nombre).collect::<Vec<_>>(),
            vec!["Produccion", "QA"]
        );
        let archivos = recolectar_archivos_json(&raiz).unwrap();
        assert_eq!(archivos.len(), 1);
        assert_eq!(archivos[0].tipo, "Produccion");
        fs::remove_dir_all(raiz).unwrap();
    }

    #[test]
    fn agrupa_y_filtra_por_tipo_dinamico_y_responsable_legacy() {
        let raiz = directorio_temporal("consulta");
        fs::create_dir_all(raiz.join("Produccion")).unwrap();
        fs::create_dir_all(raiz.join("Pruebas")).unwrap();
        fs::write(raiz.join("Produccion/operador_a.json"), reporte_legacy()).unwrap();
        fs::write(raiz.join("Pruebas/otro_responsable.json"), reporte_legacy()).unwrap();

        let resultado = consultar_software_inventario_con_limite(
            raiz.to_str().unwrap(),
            Some("Editor".to_string()),
            None,
            None,
            Some("Produccion".to_string()),
            Some("operador a".to_string()),
            30,
        )
        .unwrap();

        assert_eq!(resultado.tipos_disponibles, vec!["Produccion", "Pruebas"]);
        assert_eq!(resultado.coincidencias.len(), 1);
        assert_eq!(resultado.coincidencias[0].tipo, "Produccion");
        assert_eq!(
            resultado.coincidencias[0].responsable.as_deref(),
            Some("operador a")
        );
        assert_eq!(
            responsable_desde_archivo(Path::new("juan_perez.json")),
            Some("juan perez".to_string())
        );
        assert_eq!(
            responsable_desde_archivo(Path::new("sin_guiones_bajos.json")),
            Some("sin guiones bajos".to_string())
        );
        assert_eq!(
            responsable_desde_archivo(Path::new("reporte.JSON")),
            Some("reporte".to_string())
        );
        fs::remove_dir_all(raiz).unwrap();
    }

    #[test]
    fn rechaza_una_carpeta_de_inventario_inexistente_o_no_legible() {
        let raiz = directorio_temporal("inaccesible");
        let archivo = raiz.join("no-es-carpeta");
        fs::write(&archivo, "contenido").unwrap();

        let error =
            consultar_software_inventario(archivo.to_str().unwrap(), None, None, None, None, None)
                .expect_err("un archivo no puede leerse como carpeta de inventario");
        assert!(error.contains("no existe"));
        fs::remove_dir_all(raiz).unwrap();
    }
}

/**
 * @file main.js
 * @description Orquestador principal de la aplicación de escritorio Relevador de VMs.
 * Coordina la comunicación IPC de Tauri, la gestión del estado reactivo, la persistencia de auditoría y los controladores de interfaz.
 * @module main
 */

import { AppState } from './state.js';
import { HistoryManager } from './history.js';
import { UIManager } from './ui.js';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';

// Instancias centrales de estado y controladores
const state = new AppState();
const history = new HistoryManager();
let ui;

let rutaOrigenSeleccionada = '';
let rutaDestinoSeleccionada = '';
let rutaDiscoInspectorSeleccionada = '';
let procesoEnCurso = false;
let ultimoEstadoSupervision = null;
let debounceTimerBusqueda = null;
let ultimoRequestIdBusqueda = 0;

/**
 * Ejecuta la consulta de software sobre la base de datos de reportes JSON configurada.
 * Implementa control de secuencialidad para evitar condiciones de carrera en búsquedas rápidas.
 *
 * @async
 * @returns {Promise<void>}
 */
async function ejecutarConsultaSoftware() {
  const dir = state.config.ruta_bd_json || rutaDestinoSeleccionada;
  if (!dir) {
    ui.renderResultadosSoftware(
      null,
      {},
      () => {}
    );
    return;
  }

  const currentRequestId = ++ultimoRequestIdBusqueda;

  const queryProg = ui.inputBuscarPrograma ? ui.inputBuscarPrograma.value.trim() : '';
  const queryVm = ui.inputBuscarVm ? ui.inputBuscarVm.value.trim() : '';
  const queryVer = ui.inputBuscarVersion ? ui.inputBuscarVersion.value.trim() : '';
  const queryTipo = ui.selectBuscarTipo ? ui.selectBuscarTipo.value : 'todos';
  const queryProp = ui.inputBuscarPropietario ? ui.inputBuscarPropietario.value.trim() : '';

  if (ui.btnRecargarSoftware) {
    ui.btnRecargarSoftware.classList.add('spinning');
  }

  try {
    const resultado = await invoke('consultar_software_en_jsons', {
      directorio: dir,
      filtroPrograma: queryProg || null,
      filtroVm: queryVm || null,
      filtroVersion: queryVer || null,
      filtroTipo: queryTipo && queryTipo !== 'todos' ? queryTipo : null,
      filtroPropietario: queryProp || null
    });

    // Descartar si una búsqueda posterior ya fue emitida
    if (currentRequestId !== ultimoRequestIdBusqueda) {
      return;
    }

    if (resultado) {
      ui.poblarSugerenciasSoftware(
        resultado.programas_disponibles,
        resultado.vms_disponibles,
        resultado.versiones_disponibles,
        resultado.propietarios_disponibles,
        resultado.asignados_disponibles || [],
        resultado.elementos_disponibles || []
      );
      ui.renderResultadosSoftware(
        resultado,
        {
          programa: queryProg,
          vm: queryVm,
          version: queryVer,
          tipo: queryTipo,
          propietario: queryProp
        },
        async (ruta) => {
          try {
            await invoke('abrir_carpeta', { ruta });
          } catch (e) {
            alert("Error al abrir la carpeta de la VM: " + e);
          }
        }
      );
    }
  } catch (err) {
    if (currentRequestId === ultimoRequestIdBusqueda) {
      console.error("Error al consultar software:", err);
      if (ui.lblSoftwareMetricas) {
        ui.lblSoftwareMetricas.textContent = "Error al escanear directorio: " + err;
      }
    }
  } finally {
    if (currentRequestId === ultimoRequestIdBusqueda && ui.btnRecargarSoftware) {
      ui.btnRecargarSoftware.classList.remove('spinning');
    }
  }
}

/**
 * Actualiza la vista del historial de auditoría de relevamientos en el modal.
 */
function actualizarVistaHistorial() {
  ui.renderHistorial(history.obtenerTodos(), async (ruta) => {
    try {
      await invoke('abrir_carpeta', { ruta });
    } catch (e) {
      alert("Error al abrir carpeta: " + e);
    }
  });
}

/**
 * Consulta y sincroniza el diagnóstico de hardware y herramientas del sistema anfitrión.
 *
 * @async
 * @returns {Promise<void>}
 */
async function cargarDiagnostico() {
  try {
    const diag = await invoke('obtener_diagnostico');
    ui.actualizarDiagnostico(diag);

    if (!localStorage.getItem('relevador_vms_config_v4')) {
      state.guardar({ max_hilos: diag.hilos_recomendados });
      ui.sincronizarAjustes(state.config);
    }
  } catch (err) {
    console.warn("Diagnóstico no disponible:", err);
  }
}

// Inicializar UIManager conectando callbacks de acción
ui = new UIManager({
  onEjecutarBusquedaSoftware: ejecutarConsultaSoftware,
  onSeleccionarDiscoInspector: async () => {
    try {
      const selected = await open({
        directory: false,
        multiple: false,
        title: "Seleccionar imagen de disco virtual para inspección",
        filters: [{
          name: "Imágenes de Disco Virtual",
          extensions: ["vmdk", "vdi", "vhdx", "raw", "qcow2", "img", "vpc"]
        }]
      });
      if (selected) {
        rutaDiscoInspectorSeleccionada = selected;
        ui.inspectorView.setDiscoSeleccionado(selected);
      }
    } catch (err) {
      alert("Error al seleccionar disco: " + err);
    }
  },
  onIniciarInspeccionDisco: async () => {
    if (!rutaDiscoInspectorSeleccionada) return;
    ui.inspectorView.setEstadoEjecucion(true);
    ui.inspectorView.actualizarProgreso({
      porcentaje: 5,
      etapa: "Iniciando inspección estática",
      detalle: rutaDiscoInspectorSeleccionada
    });
    const payloadConfig = state.obtenerPayload();

    try {
      const informe = await invoke('inspeccionar_disco_vm', {
        rutaDisco: rutaDiscoInspectorSeleccionada,
        configuracion: payloadConfig
      });
      if (informe) {
        ui.inspectorView.renderInforme(informe);
      }
    } catch (err) {
      console.error("Error durante la inspección de disco:", err);
      alert("Error durante la inspección de disco: " + err);
    } finally {
      ui.inspectorView.setEstadoEjecucion(false);
    }
  },
  onExportarInformeDisco: async (informe) => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Seleccionar carpeta donde guardar el informe JSON del disco"
      });
      if (selected) {
        const rutaFinal = `${selected.replace(/[\\/]$/, '')}/Informe_Inspeccion_VM.json`;
        const msg = await invoke('exportar_informe_individual', {
          rutaDestino: rutaFinal,
          informe
        });
        alert(msg);
      }
    } catch (err) {
      alert("Error al exportar informe: " + err);
    }
  }
});

// Sincronizar estado visual inicial
ui.aplicarTema(state.config.tema || 'light');
ui.sincronizarAjustes(state.config);
ui.actualizarPasos(rutaOrigenSeleccionada, rutaDestinoSeleccionada, state.config.nombre_archivo_salida);
actualizarVistaHistorial();
cargarDiagnostico();

// Conectar conmutador de tema visual
if (ui.btnToggleTheme) {
  ui.btnToggleTheme.addEventListener('click', () => {
    const nuevoTema = state.config.tema === 'dark' ? 'light' : 'dark';
    state.guardar({ tema: nuevoTema });
    ui.aplicarTema(nuevoTema);
  });
}

// Controles nativos de ventana sin marco (Frameless Window)
if (ui.btnWinMinimize) {
  ui.btnWinMinimize.addEventListener('click', () => invoke('ventana_minimizar'));
}
if (ui.btnWinMaximize) {
  ui.btnWinMaximize.addEventListener('click', () => invoke('ventana_maximizar_restaurar'));
}
if (ui.btnWinClose) {
  ui.btnWinClose.addEventListener('click', () => invoke('ventana_cerrar'));
}
if (ui.customTitlebar) {
  ui.customTitlebar.addEventListener('dblclick', (e) => {
    if (e.target.closest('.win-btn') || e.target.closest('.nav-btn') || e.target.closest('.tool-tab-btn')) return;
    invoke('ventana_maximizar_restaurar');
  });
}

// Escuchar eventos de telemetría y supervisión multihilo en vivo emitidos desde Rust
listen('progreso_supervision', (event) => {
  ultimoEstadoSupervision = event.payload;
  ui.actualizarTelemetria(ultimoEstadoSupervision, state.config);
});

// Escuchar eventos de progreso del Inspector de VM
listen('progreso_inspeccion_directa', (event) => {
  if (ui && ui.inspectorView) {
    ui.inspectorView.actualizarProgreso(event.payload);
  }
});

// ============================================================================
// HERRAMIENTA 1: ANALIZADOR DE VIRTUALES
// ============================================================================

// Selector de Carpeta Origen (Paso 1)
ui.cardStepOrigen.addEventListener('click', async () => {
  if (procesoEnCurso) return;
  try {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Paso 1: Seleccionar carpeta o disco de origen con VMs"
    });
    if (selected) {
      rutaOrigenSeleccionada = selected;
      ui.actualizarPasos(rutaOrigenSeleccionada, rutaDestinoSeleccionada);
    }
  } catch (err) {
    alert("Error al seleccionar origen: " + err);
  }
});

// Selector de Carpeta Destino (Paso 2)
ui.cardStepDestino.addEventListener('click', async () => {
  if (procesoEnCurso) return;
  try {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Paso 2: Seleccionar carpeta donde guardar el reporte JSON"
    });
    if (selected) {
      rutaDestinoSeleccionada = selected;
      ui.actualizarPasos(rutaOrigenSeleccionada, rutaDestinoSeleccionada);
      if (!state.config.ruta_bd_json) {
        state.guardar({ ruta_bd_json: selected });
        ui.sincronizarAjustes(state.config);
      }
    }
  } catch (err) {
    alert("Error al seleccionar destino: " + err);
  }
});

// Nombre del Archivo JSON (Paso 3)
if (ui.cardStepNombreJson) {
  ui.cardStepNombreJson.addEventListener('click', (e) => {
    if (e.target !== ui.inputNombreArchivoSalida && ui.inputNombreArchivoSalida) {
      ui.inputNombreArchivoSalida.focus();
      ui.inputNombreArchivoSalida.select();
    }
  });
}

if (ui.inputNombreArchivoSalida) {
  ui.inputNombreArchivoSalida.addEventListener('input', () => {
    const rawVal = ui.inputNombreArchivoSalida.value;
    state.guardar({ nombre_archivo_salida: rawVal });
    if (ui.cfgNombreArchivo) ui.cfgNombreArchivo.value = rawVal;
    ui.actualizarPasos(rutaOrigenSeleccionada, rutaDestinoSeleccionada);
  });

  ui.inputNombreArchivoSalida.addEventListener('blur', () => {
    let val = ui.inputNombreArchivoSalida.value.trim();
    if (!val) {
      val = 'Relevamiento_VMs.json';
    } else if (!val.toLowerCase().endsWith('.json')) {
      val += '.json';
    }
    ui.inputNombreArchivoSalida.value = val;
    state.guardar({ nombre_archivo_salida: val });
    if (ui.cfgNombreArchivo) ui.cfgNombreArchivo.value = val;
    ui.actualizarPasos(rutaOrigenSeleccionada, rutaDestinoSeleccionada);
  });
}

// Disparador de Análisis / Cancelación (Paso 4)
ui.btnIniciarAccion.addEventListener('click', async () => {
  if (procesoEnCurso) {
    ui.btnIniciarAccion.disabled = true;
    if (ui.lblHilosAccion) ui.lblHilosAccion.textContent = 'Cancelando...';
    try {
      await invoke('detener_inspeccion');
    } catch (e) {
      console.error("Error al cancelar:", e);
      ui.btnIniciarAccion.disabled = false;
    }
    return;
  }

  if (!rutaOrigenSeleccionada || !rutaDestinoSeleccionada) {
    alert("Por favor selecciona tanto el origen como el destino antes de iniciar el análisis.");
    return;
  }

  procesoEnCurso = true;
  ui.setEstadoEjecucion(true);

  const payloadConfig = state.obtenerPayload();

  try {
    await invoke('procesar_relevamiento', {
      rutaOrigen: rutaOrigenSeleccionada,
      rutaDestino: rutaDestinoSeleccionada,
      generarDiscrepancias: Boolean(state.config.generar_discrepancias),
      configuracion: payloadConfig
    });

    // Registrar en Historial si terminó con éxito
    if (ultimoEstadoSupervision && ultimoEstadoSupervision.fase === 'finalizado') {
      history.agregar({
        ruta_origen: rutaOrigenSeleccionada,
        ruta_destino: rutaDestinoSeleccionada,
        total_vms: ultimoEstadoSupervision.total_vms,
        exitosas: ultimoEstadoSupervision.vms_exitosas,
        con_observaciones: ultimoEstadoSupervision.vms_con_observaciones,
        discrepantes: ultimoEstadoSupervision.vms_discrepantes,
        duracion: ultimoEstadoSupervision.tiempo_transcurrido_formateado,
        peso_gb: ultimoEstadoSupervision.peso_total_procesado_gb
      });
      actualizarVistaHistorial();

      // Si el consultor usa este directorio, refrescar sugerencias automáticamente
      if (state.config.ruta_bd_json === rutaDestinoSeleccionada) {
        ejecutarConsultaSoftware();
      }
    }
  } catch (error) {
    console.error("Proceso detenido o con error:", error);
  } finally {
    procesoEnCurso = false;
    ui.setEstadoEjecucion(false);
    ui.actualizarPasos(rutaOrigenSeleccionada, rutaDestinoSeleccionada, state.config.nombre_archivo_salida);
  }
});

// ============================================================================
// HERRAMIENTA 2: CONSULTOR DE SOFTWARE Y VMS
// ============================================================================

// Al seleccionar pestaña Consultor, sincronizar y consultar
if (ui.tabBtnConsultor) {
  ui.tabBtnConsultor.addEventListener('click', () => {
    if (!state.config.ruta_bd_json && rutaDestinoSeleccionada) {
      state.guardar({ ruta_bd_json: rutaDestinoSeleccionada });
      ui.sincronizarAjustes(state.config);
    }
    ejecutarConsultaSoftware();
  });
}

// Botones de acción del Consultor
if (ui.btnEjecutarBusquedaSoftware) {
  ui.btnEjecutarBusquedaSoftware.addEventListener('click', () => {
    ejecutarConsultaSoftware();
  });
}

if (ui.btnRecargarSoftware) {
  ui.btnRecargarSoftware.addEventListener('click', () => {
    ejecutarConsultaSoftware();
  });
}

if (ui.btnLimpiarPrograma) {
  ui.btnLimpiarPrograma.addEventListener('click', () => {
    if (ui.inputBuscarPrograma) {
      ui.inputBuscarPrograma.value = '';
      ui.btnLimpiarPrograma.style.display = 'none';
      ejecutarConsultaSoftware();
      ui.inputBuscarPrograma.focus();
    }
  });
}

if (ui.btnLimpiarVm) {
  ui.btnLimpiarVm.addEventListener('click', () => {
    if (ui.inputBuscarVm) {
      ui.inputBuscarVm.value = '';
      ui.btnLimpiarVm.style.display = 'none';
      ejecutarConsultaSoftware();
      ui.inputBuscarVm.focus();
    }
  });
}

// Búsqueda en tiempo real con Debounce en campos de texto
const camposDeBusqueda = [
  ui.inputBuscarPrograma,
  ui.inputBuscarVm,
  ui.inputBuscarVersion,
  ui.inputBuscarPropietario
];

camposDeBusqueda.forEach(input => {
  if (!input) return;
  input.addEventListener('input', () => {
    clearTimeout(debounceTimerBusqueda);
    debounceTimerBusqueda = setTimeout(() => {
      ejecutarConsultaSoftware();
    }, 250);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      clearTimeout(debounceTimerBusqueda);
      ejecutarConsultaSoftware();
    }
  });
});

if (ui.selectBuscarTipo) {
  ui.selectBuscarTipo.addEventListener('change', () => {
    ejecutarConsultaSoftware();
  });
}

// ============================================================================
// MODALES Y FORMULARIOS DE CONFIGURACIÓN
// ============================================================================

// Selector de Carpeta BD JSON en Configuración del Consultor
if (ui.btnExaminarBdJson) {
  ui.btnExaminarBdJson.addEventListener('click', async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Seleccionar carpeta donde residen los archivos JSON de reporte"
      });
      if (selected && ui.cfgRutaBdJson) {
        ui.cfgRutaBdJson.value = selected;
      }
    } catch (err) {
      alert("Error al seleccionar carpeta: " + err);
    }
  });
}

// Guardar Configuración del Consultor
if (ui.btnGuardarConfigConsultor) {
  ui.btnGuardarConfigConsultor.addEventListener('click', () => {
    const nuevosValores = ui.leerFormularioConfigConsultor();
    state.guardar(nuevosValores);
    ui.sincronizarAjustes(state.config);
    ui.modalsManager.cerrarModal(ui.modalConfigConsultor);
    ejecutarConsultaSoftware();
  });
}

// Selector de binario qemu-nbd en Configuración del Analizador
if (ui.btnExaminarQemu) {
  ui.btnExaminarQemu.addEventListener('click', async () => {
    try {
      const selected = await open({
        directory: false,
        multiple: false,
        title: "Seleccionar binario ejecutable qemu-nbd"
      });
      if (selected && ui.cfgRutaQemu) {
        ui.cfgRutaQemu.value = selected;
      }
    } catch (err) {
      alert("Error al seleccionar binario: " + err);
    }
  });
}

// Guardar Ajustes del Analizador
if (ui.btnGuardarAjustes) {
  ui.btnGuardarAjustes.addEventListener('click', () => {
    const nuevosValores = ui.leerFormularioAjustesAnalizador();
    state.guardar(nuevosValores);
    ui.sincronizarAjustes(state.config);
    ui.modalsManager.cerrarModal(ui.modalAjustes);
  });
}

// Restablecer Ajustes del Analizador
if (ui.btnRestablecerAjustes) {
  ui.btnRestablecerAjustes.addEventListener('click', () => {
    if (confirm("¿Deseas restablecer la configuración del analizador a los valores por defecto?")) {
      state.restablecer();
      ui.sincronizarAjustes(state.config);
      ui.modalsManager.cerrarModal(ui.modalAjustes);
    }
  });
}

// Selector de archivo de reglas (rules.json / rules.toml) personalizado
if (ui.btnExaminarReglas) {
  ui.btnExaminarReglas.addEventListener('click', async () => {
    try {
      const selected = await open({
        directory: false,
        multiple: false,
        title: "Seleccionar archivo de reglas de clasificación",
        filters: [{ name: "Reglas de Clasificación (*.json, *.toml)", extensions: ["json", "toml"] }]
      });
      if (selected && ui.cfgRutaReglas) {
        ui.cfgRutaReglas.value = selected;
      }
    } catch (err) {
      alert("Error al seleccionar archivo de reglas: " + err);
    }
  });
}

// Validador de binario QEMU
if (ui.btnValidarQemu) {
  ui.btnValidarQemu.addEventListener('click', async () => {
    const ruta = ui.cfgRutaQemu ? ui.cfgRutaQemu.value.trim() : '';
    if (ui.lblEstadoValidacionQemu) {
      ui.lblEstadoValidacionQemu.textContent = "Validando ejecutable...";
    }
    try {
      const res = await invoke('validar_binario_qemu', { ruta: ruta || null });
      if (res.es_valido) {
        ui.lblEstadoValidacionQemu.innerHTML = `<span style="color: #22c55e; font-weight: 600;">✓ Ejecutable funcional:</span> ${res.version_info || ''} <span style="opacity: 0.7;">(${res.ruta_resuelta || ''})</span>`;
      } else {
        ui.lblEstadoValidacionQemu.innerHTML = `<span style="color: var(--danger); font-weight: 600;">✗ No disponible:</span> ${res.error || 'Fallo de ejecución'}`;
      }
    } catch (e) {
      if (ui.lblEstadoValidacionQemu) {
        ui.lblEstadoValidacionQemu.innerHTML = `<span style="color: var(--danger);">Error: ${e}</span>`;
      }
    }
  });
}

// Apertura del Simulador de Reglas
if (ui.btnOpenSimuladorReglas) {
  ui.btnOpenSimuladorReglas.addEventListener('click', async () => {
    const rutaReglas = ui.cfgRutaReglas ? ui.cfgRutaReglas.value.trim() : '';
    try {
      const info = await invoke('obtener_informacion_reglas', {
        rutaReglas: rutaReglas || null
      });
      if (info) {
        if (ui.lblSimOrigenReglas) ui.lblSimOrigenReglas.textContent = info.origen_reglas;
        if (ui.lblSimTotalWhitelist) ui.lblSimTotalWhitelist.textContent = info.total_whitelist;
        if (ui.lblSimTotalCategorias) ui.lblSimTotalCategorias.textContent = Object.keys(info.categorias || {}).length;
      }
    } catch (err) {
      console.warn("No se pudo obtener información de reglas:", err);
    }
    ui.modalsManager.abrirModal(ui.modalSimuladorReglas);
  });
}

// Ejecución de la simulación de reglas
if (ui.btnEjecutarSimulacionReglas) {
  ui.btnEjecutarSimulacionReglas.addEventListener('click', async () => {
    const nombre = ui.inputSimNombre ? ui.inputSimNombre.value.trim() : '';
    if (!nombre) {
      alert("Por favor ingresa el nombre de la aplicación o paquete a clasificar.");
      return;
    }
    const editor = ui.inputSimEditor ? ui.inputSimEditor.value.trim() : '';
    const so = ui.selectSimSo ? ui.selectSimSo.value : 'windows';
    const rutaReglas = ui.cfgRutaReglas ? ui.cfgRutaReglas.value.trim() : '';

    try {
      const res = await invoke('probar_clasificacion_software', {
        nombre,
        editor: editor || null,
        sistemaOperativo: so,
        rutaReglas: rutaReglas || null
      });

      if (res && ui.containerResultadoSimulacion) {
        ui.containerResultadoSimulacion.style.display = 'block';
        const badgeClass = res.es_relevante ? 'text-success' : 'text-warn';
        const estadoIcon = res.es_relevante ? '✓ INCLUIDO EN REPORTE' : '✗ DESCARTADO / FILTRADO';

        ui.containerResultadoSimulacion.innerHTML = `
          <div style="font-size: 13px; font-weight: 700; margin-bottom: 8px;" class="${badgeClass}">
            ${estadoIcon}
          </div>
          <div style="font-size: 12px; line-height: 1.5; color: var(--text);">
            <div><strong>Veredicto:</strong> ${res.motivo_veredicto}</div>
            <div><strong>Whitelist Global:</strong> ${res.es_whitelist ? '<span style="color: #22c55e;">Sí (Prioridad alta)</span>' : '<span style="color: var(--text-muted);">No</span>'}</div>
            <div style="margin-top: 4px;">
              <strong>Categoría asignada:</strong> 
              ${res.categoria ? `<span class="consultor-category-badge">${res.categoria}</span>` : '<span style="color: var(--text-muted);">Ninguna coincidente</span>'}
            </div>
            ${Array.isArray(res.tags) && res.tags.length > 0 ? `
              <div style="margin-top: 4px; display: flex; align-items: center; gap: 4px; flex-wrap: wrap;">
                <strong>Etiquetas / Palabras clave:</strong> 
                ${res.tags.map(t => `<span class="consultor-tag-pill">#${t}</span>`).join(' ')}
              </div>
            ` : ''}
          </div>
        `;
      }
    } catch (err) {
      alert("Error al simular clasificación: " + err);
    }
  });
}

// Limpiar Historial
if (ui.btnClearHistorial) {
  ui.btnClearHistorial.addEventListener('click', () => {
    if (confirm("¿Deseas limpiar todo el historial de análisis realizados?")) {
      history.limpiar();
      actualizarVistaHistorial();
    }
  });
}

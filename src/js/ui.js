/**
 * @file ui.js
 * @description Fachada orquestadora de interfaz de usuario para las herramientas de Analizador y Consultor.
 * @module js/ui
 */

import { ThemeManager } from './theme.js';
import { TelemetryManager } from './telemetry.js';
import { CardsView } from './cards-view.js';
import { GraphView } from './graph-view.js';
import { ModalsManager } from './modals.js';
import { ConsultorController } from './consultor-controller.js';
import { InspectorView } from './inspector-view.js';
import { renderHistorial } from './history-view.js';

export { extraerInfoDisco, escapeHtml, truncarTexto } from './utils.js';

/**
 * Clase principal de control de la interfaz gráfica que conecta vistas, formularios y eventos DOM.
 */
export class UIManager {
  /**
   * Inicializa las referencias DOM, subgestores modulares y listeners de eventos.
   * @param {Object} [callbacks={}] - Callbacks opcionales para acciones del usuario.
   * @param {function(): void} [callbacks.onEjecutarBusquedaSoftware] - Dispara la consulta en la BD.
   */
  constructor(callbacks = {}) {
    this.herramientaActiva = 'analizador';
    this.initElements();

    // 1. Gestor de Tema
    this.themeManager = new ThemeManager(this.btnToggleTheme);

    // 2. Gestor de Modales
    this.modalsManager = new ModalsManager(this, () => this.herramientaActiva);

    // 3. Gestor de Telemetría
    this.telemetryManager = new TelemetryManager(this);

    // 4. Vistas del Consultor
    this.cardsView = new CardsView(this.consultorCardsWrapper);
    this.graphView = new GraphView(this, (campo, valor) => {
      if (this.consultorController) {
        if (campo === 'programa_con_version') {
          this.consultorController.limpiarFiltros();
          if (this.inputBuscarPrograma) this.inputBuscarPrograma.value = valor.programa || '';
          if (this.inputBuscarVersion) this.inputBuscarVersion.value = valor.version || '';
          if (this.btnLimpiarPrograma) {
            this.btnLimpiarPrograma.style.display = valor.programa ? 'block' : 'none';
          }
        } else {
          this.consultorController.limpiarTodosFiltrosExcepto(campo, valor);
        }
        if (callbacks.onEjecutarBusquedaSoftware) {
          callbacks.onEjecutarBusquedaSoftware();
        }
      }
    });

    // 5. Controlador de Búsqueda y Vistas del Consultor
    this.consultorController = new ConsultorController(
      this,
      { cardsView: this.cardsView, graphView: this.graphView },
      callbacks.onEjecutarBusquedaSoftware || (() => {})
    );

    // 6. Vista del Inspector de VM
    this.inspectorView = new InspectorView(this, {
      onSeleccionarDisco: callbacks.onSeleccionarDiscoInspector,
      onIniciarInspeccion: callbacks.onIniciarInspeccionDisco,
      onExportarInforme: callbacks.onExportarInformeDisco
    });

    this.initPestanas();
  }

  /**
   * Mapea todas las referencias a los elementos del DOM.
   * @private
   */
  initElements() {
    // Titlebar
    this.customTitlebar = document.getElementById('customTitlebar');
    this.btnToggleTheme = document.getElementById('btnToggleTheme');
    this.lblThemeText = document.getElementById('lblThemeText');
    this.btnWinMinimize = document.getElementById('btnWinMinimize');
    this.btnWinMaximize = document.getElementById('btnWinMaximize');
    this.btnWinClose = document.getElementById('btnWinClose');

    // Pestañas Principales
    this.tabBtnAnalizador = document.getElementById('tabBtnAnalizador');
    this.tabBtnConsultor = document.getElementById('tabBtnConsultor');
    this.tabBtnInspector = document.getElementById('tabBtnInspector');
    this.viewAnalizador = document.getElementById('viewAnalizador');
    this.viewConsultor = document.getElementById('viewConsultor');
    this.viewInspector = document.getElementById('viewInspector');

    // Navegación Global
    this.btnOpenHistorial = document.getElementById('btnOpenHistorial');
    this.btnOpenAjustes = document.getElementById('btnOpenAjustes');

    // Consultor de Software (Formularios y Filtros)
    this.inputBuscarPrograma = document.getElementById('inputBuscarPrograma');
    this.inputBuscarVm = document.getElementById('inputBuscarVm');
    this.inputBuscarVersion = document.getElementById('inputBuscarVersion');
    this.selectBuscarTipo = document.getElementById('selectBuscarTipo');
    this.inputBuscarPropietario = document.getElementById('inputBuscarPropietario');
    this.btnLimpiarPrograma = document.getElementById('btnLimpiarPrograma');
    this.btnLimpiarVm = document.getElementById('btnLimpiarVm');
    this.btnLimpiarFiltros = document.getElementById('btnLimpiarFiltros');
    this.btnEjecutarBusquedaSoftware = document.getElementById('btnEjecutarBusquedaSoftware');
    this.btnRecargarSoftware = document.getElementById('btnRecargarSoftware');
    this.datalistProgramas = document.getElementById('datalistProgramas');
    this.datalistVms = document.getElementById('datalistVms');
    this.datalistVersiones = document.getElementById('datalistVersiones');
    this.datalistPropietarios = document.getElementById('datalistPropietarios');
    this.barResumenSoftware = document.getElementById('barResumenSoftware');
    this.lblSoftwareMetricas = document.getElementById('lblSoftwareMetricas');
    this.containerResultadosSoftware = document.getElementById('containerResultadosSoftware');

    // Inspector de VM
    this.cardStepDiscoInspector = document.getElementById('cardStepDiscoInspector');
    this.lblDiscoInspectorRuta = document.getElementById('lblDiscoInspectorRuta');
    this.btnSeleccionarDiscoInspector = document.getElementById('btnSeleccionarDiscoInspector');
    this.btnIniciarInspeccionDisco = document.getElementById('btnIniciarInspeccionDisco');
    this.btnExportarInformeDisco = document.getElementById('btnExportarInformeDisco');
    this.wrapperProgresoInspector = document.getElementById('wrapperProgresoInspector');
    this.barProgresoInspector = document.getElementById('barProgresoInspector');
    this.lblPorcentajeInspector = document.getElementById('lblPorcentajeInspector');
    this.lblEtapaInspector = document.getElementById('lblEtapaInspector');
    this.lblDetalleInspector = document.getElementById('lblDetalleInspector');
    this.containerResultadosInspector = document.getElementById('containerResultadosInspector');
    this.inspectorWarningsBox = document.getElementById('inspectorWarningsBox');
    this.inspectorEmptyState = document.getElementById('inspectorEmptyState');

    this.lblInspFormato = document.getElementById('lblInspFormato');
    this.lblInspHipervisor = document.getElementById('lblInspHipervisor');
    this.lblInspTamanoVirtual = document.getElementById('lblInspTamanoVirtual');
    this.lblInspTamanoReal = document.getElementById('lblInspTamanoReal');
    this.lblInspAcceso = document.getElementById('lblInspAcceso');
    this.lblInspDuracion = document.getElementById('lblInspDuracion');
    this.lblInspBytesLeidos = document.getElementById('lblInspBytesLeidos');
    this.lblInspQemuCalls = document.getElementById('lblInspQemuCalls');
    this.lblInspSoNombre = document.getElementById('lblInspSoNombre');
    this.lblInspSoDetalles = document.getElementById('lblInspSoDetalles');
    this.lblInspVmTools = document.getElementById('lblInspVmTools');
    this.lblInspEsquema = document.getElementById('lblInspEsquema');
    this.listInspParticiones = document.getElementById('listInspParticiones');
    this.inputFiltrarSoftwareInspector = document.getElementById('inputFiltrarSoftwareInspector');
    this.selectCategoriaSoftwareInspector = document.getElementById('selectCategoriaSoftwareInspector');
    this.lblTotalProgramasInspector = document.getElementById('lblTotalProgramasInspector');
    this.tbodySoftwareInspector = document.getElementById('tbodySoftwareInspector');

    // Conmutador de Vistas del Consultor
    this.btnVistaDiagrama = document.getElementById('btnVistaDiagrama');
    this.btnVistaTarjetas = document.getElementById('btnVistaTarjetas');
    this.consultorGraphWrapper = document.getElementById('consultorGraphWrapper');
    this.consultorCardsWrapper = document.getElementById('consultorCardsWrapper');
    this.consultorEmptyState = document.getElementById('consultorEmptyState');

    // Diagrama Relacional (Grafo)
    this.graphCanvasContainer = document.getElementById('graphCanvasContainer');
    this.consultorGraphSvg = document.getElementById('consultorGraphSvg');
    this.btnGraphZoomIn = document.getElementById('btnGraphZoomIn');
    this.btnGraphZoomOut = document.getElementById('btnGraphZoomOut');
    this.btnGraphFit = document.getElementById('btnGraphFit');
    this.graphTooltip = document.getElementById('graphTooltip');
    this.graphDetailDrawer = document.getElementById('graphDetailDrawer');
    this.drawerTitle = document.getElementById('drawerTitle');
    this.drawerBody = document.getElementById('drawerBody');
    this.btnCloseDetailDrawer = document.getElementById('btnCloseDetailDrawer');

    // Modales
    this.modalHistorial = document.getElementById('modalHistorial');
    this.btnCloseHistorial = document.getElementById('btnCloseHistorial');
    this.btnOkHistorial = document.getElementById('btnOkHistorial');
    this.btnClearHistorial = document.getElementById('btnClearHistorial');
    this.containerHistorial = document.getElementById('containerHistorial');

    this.modalAjustes = document.getElementById('modalAjustes');
    this.btnCloseAjustes = document.getElementById('btnCloseAjustes');
    this.btnGuardarAjustes = document.getElementById('btnGuardarAjustes');
    this.btnRestablecerAjustes = document.getElementById('btnRestablecerAjustes');

    this.modalConfigConsultor = document.getElementById('modalConfigConsultor');
    this.btnCloseConfigConsultor = document.getElementById('btnCloseConfigConsultor');
    this.btnCancelarConfigConsultor = document.getElementById('btnCancelarConfigConsultor');
    this.btnGuardarConfigConsultor = document.getElementById('btnGuardarConfigConsultor');

    // Pasos del Analizador
    this.cardStepOrigen = document.getElementById('cardStepOrigen');
    this.lblOrigen = document.getElementById('lblOrigen');
    this.cardStepDestino = document.getElementById('cardStepDestino');
    this.lblDestino = document.getElementById('lblDestino');
    this.cardStepNombreJson = document.getElementById('cardStepNombreJson');
    this.inputNombreArchivoSalida = document.getElementById('inputNombreArchivoSalida');
    this.btnIniciarAccion = document.getElementById('btnIniciarAccion');
    this.lblTitleAccion = document.getElementById('lblTitleAccion');
    this.lblHilosAccion = document.getElementById('lblHilosAccion');
    this.iconAnalisis = document.getElementById('iconAnalisis');

    // Telemetría & Visual HUD
    this.badgeFase = document.getElementById('badgeFase');
    this.lblBigPorcentaje = document.getElementById('lblBigPorcentaje');
    this.lblProgresoMsg = document.getElementById('lblProgresoMsg');
    this.barGlobal = document.getElementById('barGlobal');

    this.telemetryVisualHud = document.getElementById('telemetryVisualHud');
    this.canvasTelemetryVisual = document.getElementById('canvasTelemetryVisual');
    this.donutSegOk = document.getElementById('donutSegOk');
    this.donutSegWarn = document.getElementById('donutSegWarn');
    this.donutSegActive = document.getElementById('donutSegActive');
    this.hudDonutCenterVal = document.getElementById('hudDonutCenterVal');
    this.hudDonutCenterSub = document.getElementById('hudDonutCenterSub');
    this.hudLegOk = document.getElementById('hudLegOk');
    this.hudLegWarn = document.getElementById('hudLegWarn');
    this.hudLegActive = document.getElementById('hudLegActive');
    this.hudLegPending = document.getElementById('hudLegPending');
    this.hudThroughputText = document.getElementById('hudThroughputText');
    this.stageStepDesc = document.getElementById('stageStepDesc');
    this.stageStepDisk = document.getElementById('stageStepDisk');
    this.stageStepFs = document.getElementById('stageStepFs');
    this.stageStepSoft = document.getElementById('stageStepSoft');
    this.hudCanvasWorkersBadge = document.getElementById('hudCanvasWorkersBadge');
    this.hudCanvasLabel = document.getElementById('hudCanvasLabel');

    this.statVms = document.getElementById('statVms');
    this.statExitosas = document.getElementById('statExitosas');
    this.statObservaciones = document.getElementById('statObservaciones');
    this.statTiempo = document.getElementById('statTiempo');
    this.itemEta = document.getElementById('itemEta');
    this.statEta = document.getElementById('statEta');
    this.statVelocidad = document.getElementById('statVelocidad');

    this.wrapperWorkers = document.getElementById('wrapperWorkers');
    this.listWorkers = document.getElementById('listWorkers');

    this.wrapperVmIndividual = document.getElementById('wrapperVmIndividual');
    this.lblVmIndividualTitulo = document.getElementById('lblVmIndividualTitulo');
    this.lblVmIndividualPorcentaje = document.getElementById('lblVmIndividualPorcentaje');
    this.barVmIndividual = document.getElementById('barVmIndividual');
    this.lblVmIndividualEtapa = document.getElementById('lblVmIndividualEtapa');

    this.wrapperBitacora = document.getElementById('wrapperBitacora');
    this.logConsole = document.getElementById('logConsole');

    // Statusbar
    this.sysDiagnosticText = document.getElementById('sysDiagnosticText');

    // Campos de Configuración
    this.cfgRutaBdJson = document.getElementById('cfgRutaBdJson');
    this.btnExaminarBdJson = document.getElementById('btnExaminarBdJson');
    this.cfgMaxHilos = document.getElementById('cfgMaxHilos');
    this.lblHilosRecomendados = document.getElementById('lblHilosRecomendados');
    this.cfgModoDump = document.getElementById('cfgModoDump');
    this.cfgIncluirSystem = document.getElementById('cfgIncluirSystem');
    this.cfgForzarQemu = document.getElementById('cfgForzarQemu');
    this.cfgRutaQemu = document.getElementById('cfgRutaQemu');
    this.btnExaminarQemu = document.getElementById('btnExaminarQemu');
    this.btnValidarQemu = document.getElementById('btnValidarQemu');
    this.lblEstadoValidacionQemu = document.getElementById('lblEstadoValidacionQemu');
    this.cfgRutaReglas = document.getElementById('cfgRutaReglas');
    this.btnExaminarReglas = document.getElementById('btnExaminarReglas');
    this.btnOpenSimuladorReglas = document.getElementById('btnOpenSimuladorReglas');
    this.cfgTamanoChunk = document.getElementById('cfgTamanoChunk');
    this.cfgGenerarDiscrepancias = document.getElementById('cfgGenerarDiscrepancias');
    this.cfgHabilitarBitacora = document.getElementById('cfgHabilitarBitacora');
    this.cfgMostrarProgresoIndividual = document.getElementById('cfgMostrarProgresoIndividual');
    this.cfgNombreArchivo = document.getElementById('cfgNombreArchivo');

    // Modal Simulador de Reglas
    this.modalSimuladorReglas = document.getElementById('modalSimuladorReglas');
    this.btnCloseSimuladorReglas = document.getElementById('btnCloseSimuladorReglas');
    this.btnOkSimuladorReglas = document.getElementById('btnOkSimuladorReglas');
    this.inputSimNombre = document.getElementById('inputSimNombre');
    this.inputSimEditor = document.getElementById('inputSimEditor');
    this.selectSimSo = document.getElementById('selectSimSo');
    this.btnEjecutarSimulacionReglas = document.getElementById('btnEjecutarSimulacionReglas');
    this.containerResultadoSimulacion = document.getElementById('containerResultadoSimulacion');
    this.lblSimOrigenReglas = document.getElementById('lblSimOrigenReglas');
    this.lblSimTotalWhitelist = document.getElementById('lblSimTotalWhitelist');
    this.lblSimTotalCategorias = document.getElementById('lblSimTotalCategorias');
  }

  /**
   * Conecta los listeners de las pestañas principales (Analizador / Consultor).
   * @private
   */
  initPestanas() {
    if (this.tabBtnAnalizador) {
      this.tabBtnAnalizador.addEventListener('click', () => {
        this.seleccionarPestana('analizador');
      });
    }

    if (this.tabBtnConsultor) {
      this.tabBtnConsultor.addEventListener('click', () => {
        this.seleccionarPestana('consultor');
      });
    }

    if (this.tabBtnInspector) {
      this.tabBtnInspector.addEventListener('click', () => {
        this.seleccionarPestana('inspector');
      });
    }

    if (this.inputBuscarPrograma && this.btnLimpiarPrograma) {
      this.inputBuscarPrograma.addEventListener('input', () => {
        this.btnLimpiarPrograma.style.display = this.inputBuscarPrograma.value ? 'block' : 'none';
      });
    }

    if (this.inputBuscarVm && this.btnLimpiarVm) {
      this.inputBuscarVm.addEventListener('input', () => {
        this.btnLimpiarVm.style.display = this.inputBuscarVm.value ? 'block' : 'none';
      });
    }
  }

  /**
   * Conmuta la visibilidad de las herramientas entre Analizador, Consultor e Inspector.
   *
   * @param {'analizador'|'consultor'|'inspector'} nombre - Identificador de la herramienta.
   * @returns {void}
   */
  seleccionarPestana(nombre) {
    this.herramientaActiva = nombre;

    [this.tabBtnAnalizador, this.tabBtnConsultor, this.tabBtnInspector].forEach(btn => {
      if (btn) btn.classList.remove('active');
    });
    [this.viewAnalizador, this.viewConsultor, this.viewInspector].forEach(view => {
      if (view) view.style.display = 'none';
    });

    if (nombre === 'analizador') {
      if (this.tabBtnAnalizador) this.tabBtnAnalizador.classList.add('active');
      if (this.viewAnalizador) this.viewAnalizador.style.display = 'flex';
      if (this.btnOpenHistorial) this.btnOpenHistorial.style.display = 'inline-flex';
      if (this.btnOpenAjustes) this.btnOpenAjustes.title = "Configurar parámetros y multithreading del Analizador";
    } else if (nombre === 'consultor') {
      if (this.tabBtnConsultor) this.tabBtnConsultor.classList.add('active');
      if (this.viewConsultor) this.viewConsultor.style.display = 'flex';
      if (this.btnOpenHistorial) this.btnOpenHistorial.style.display = 'none';
      if (this.btnOpenAjustes) this.btnOpenAjustes.title = "Configurar base de datos JSON del Consultor";
    } else if (nombre === 'inspector') {
      if (this.tabBtnInspector) this.tabBtnInspector.classList.add('active');
      if (this.viewInspector) this.viewInspector.style.display = 'flex';
      if (this.btnOpenHistorial) this.btnOpenHistorial.style.display = 'none';
      if (this.btnOpenAjustes) this.btnOpenAjustes.title = "Configurar opciones del motor de inspección vminspect-rs";
    }
  }

  /**
   * Aplica el tema visual a la aplicación.
   *
   * @param {'light'|'dark'} tema - Tema a aplicar.
   */
  aplicarTema(tema) {
    this.themeManager.aplicarTema(tema);
  }

  /**
   * Actualiza el estado visual de los 4 pasos del Analizador.
   *
   * @param {string} rutaOrigen - Carpeta de origen seleccionada.
   * @param {string} rutaDestino - Carpeta de destino seleccionada.
   * @param {string} [nombreArchivo] - Nombre del archivo de reporte JSON.
   */
  actualizarPasos(rutaOrigen, rutaDestino, nombreArchivo) {
    if (rutaOrigen) {
      this.lblOrigen.textContent = rutaOrigen;
      this.lblOrigen.title = rutaOrigen;
      this.cardStepOrigen.classList.add('ready');
    } else {
      this.lblOrigen.textContent = 'Seleccionar carpeta';
      this.lblOrigen.title = '';
      this.cardStepOrigen.classList.remove('ready');
    }

    if (rutaDestino) {
      this.lblDestino.textContent = rutaDestino;
      this.lblDestino.title = rutaDestino;
      this.cardStepDestino.classList.add('ready');
    } else {
      this.lblDestino.textContent = 'Seleccionar carpeta';
      this.lblDestino.title = '';
      this.cardStepDestino.classList.remove('ready');
    }

    if (nombreArchivo !== undefined && this.inputNombreArchivoSalida) {
      this.inputNombreArchivoSalida.value = nombreArchivo;
    }

    const nombreValido = this.inputNombreArchivoSalida ? Boolean(this.inputNombreArchivoSalida.value.trim()) : true;
    if (this.cardStepNombreJson) {
      if (nombreValido) {
        this.cardStepNombreJson.classList.add('ready');
      } else {
        this.cardStepNombreJson.classList.remove('ready');
      }
    }

    const listo = Boolean(rutaOrigen && rutaDestino && nombreValido);
    this.btnIniciarAccion.disabled = !listo;
    if (listo) {
      this.btnIniciarAccion.classList.add('ready-to-run');
      if (this.lblHilosAccion) this.lblHilosAccion.textContent = 'Iniciar análisis';
    } else {
      this.btnIniciarAccion.classList.remove('ready-to-run');
      if (this.lblHilosAccion) this.lblHilosAccion.textContent = 'Pendiente';
    }
  }

  /**
   * Sincroniza los formularios de ajustes con el objeto de configuración activa.
   *
   * @param {Object} config - Configuración activa.
   */
  sincronizarAjustes(config) {
    if (this.cfgRutaBdJson) this.cfgRutaBdJson.value = config.ruta_bd_json || '';
    if (this.cfgMaxHilos) this.cfgMaxHilos.value = config.max_hilos || 4;
    if (this.lblHilosAccion) this.lblHilosAccion.textContent = `Configuración: ${config.max_hilos || 4} hilos`;
    if (this.cfgModoDump) this.cfgModoDump.checked = Boolean(config.modo_dump);
    if (this.cfgIncluirSystem) this.cfgIncluirSystem.checked = Boolean(config.incluir_system);
    if (this.cfgForzarQemu) this.cfgForzarQemu.checked = Boolean(config.forzar_qemu);
    if (this.cfgRutaQemu) this.cfgRutaQemu.value = config.ruta_qemu_nbd || config.ruta_qemu_img || '';
    if (this.cfgRutaReglas) this.cfgRutaReglas.value = config.ruta_reglas || '';
    if (this.cfgTamanoChunk) this.cfgTamanoChunk.value = config.tamano_chunk_kb || '';
    if (this.cfgGenerarDiscrepancias) this.cfgGenerarDiscrepancias.checked = Boolean(config.generar_discrepancias);
    if (this.cfgHabilitarBitacora) this.cfgHabilitarBitacora.checked = Boolean(config.habilitar_bitacora);
    if (this.cfgMostrarProgresoIndividual) this.cfgMostrarProgresoIndividual.checked = Boolean(config.mostrar_progreso_individual);
    if (this.cfgNombreArchivo) this.cfgNombreArchivo.value = config.nombre_archivo_salida || 'Relevamiento_VMs.json';
    if (this.inputNombreArchivoSalida) this.inputNombreArchivoSalida.value = config.nombre_archivo_salida || 'Relevamiento_VMs.json';

    if (this.wrapperBitacora) this.wrapperBitacora.style.display = config.habilitar_bitacora ? 'flex' : 'none';
    if (this.wrapperVmIndividual) this.wrapperVmIndividual.style.display = config.mostrar_progreso_individual ? 'flex' : 'none';
  }

  /**
   * Lee y normaliza los valores del formulario modal de configuración del Analizador.
   *
   * @returns {Object} Diccionario con los parámetros de configuración.
   */
  leerFormularioAjustesAnalizador() {
    const hilos = parseInt(this.cfgMaxHilos.value, 10);
    const chunk = parseInt(this.cfgTamanoChunk.value, 10);

    return {
      max_hilos: (!isNaN(hilos) && hilos >= 1) ? Math.min(32, hilos) : 4,
      modo_dump: this.cfgModoDump.checked,
      incluir_system: this.cfgIncluirSystem.checked,
      forzar_qemu: this.cfgForzarQemu.checked,
      ruta_qemu_nbd: this.cfgRutaQemu.value.trim() || '',
      ruta_reglas: this.cfgRutaReglas ? this.cfgRutaReglas.value.trim() : '',
      tamano_chunk_kb: (!isNaN(chunk) && chunk > 0) ? chunk : null,
      generar_discrepancias: this.cfgGenerarDiscrepancias.checked,
      habilitar_bitacora: this.cfgHabilitarBitacora.checked,
      mostrar_progreso_individual: this.cfgMostrarProgresoIndividual.checked,
      nombre_archivo_salida: this.cfgNombreArchivo.value.trim() || 'Relevamiento_VMs.json'
    };
  }

  /**
   * Lee los campos del formulario modal de configuración del Consultor.
   *
   * @returns {{ruta_bd_json: string}} Ruta del directorio de base de datos de JSONs.
   */
  leerFormularioConfigConsultor() {
    return {
      ruta_bd_json: this.cfgRutaBdJson ? this.cfgRutaBdJson.value.trim() : ''
    };
  }

  /**
   * Actualiza los textos de diagnóstico de hardware en la barra de estado.
   *
   * @param {Object} diag - Datos de diagnóstico obtenidos del backend.
   */
  actualizarDiagnostico(diag) {
    const nbdDisponible = Boolean(diag?.qemu_nbd_disponible ?? diag?.qemu_img_disponible);
    const qemuText = nbdDisponible ? 'qemu-nbd: OK' : 'qemu-nbd: No detectado';
    if (this.sysDiagnosticText) {
      this.sysDiagnosticText.textContent = `${diag.equipo_ejecucion} • ${diag.sistema_operativo} (${diag.arquitectura}) • ${diag.hilos_cpu} CPUs • ${qemuText}`;
    }
    if (this.lblHilosRecomendados) {
      this.lblHilosRecomendados.textContent = `(Recomendado: ${diag.hilos_recomendados} núcleos)`;
    }
  }

  /**
   * Actualiza el módulo de telemetría y supervisión.
   *
   * @param {Object} estado - Estado de supervisión recibido vía IPC.
   * @param {Object} config - Configuración activa.
   */
  actualizarTelemetria(estado, config) {
    this.telemetryManager.actualizar(estado, config);
  }

  /**
   * Modifica el estado visual del botón de acción según si el proceso está corriendo o detenido.
   *
   * @param {boolean} ejecutando - True si hay un análisis en ejecución.
   */
  setEstadoEjecucion(ejecutando) {
    if (ejecutando) {
      if (this.telemetryManager) {
        this.telemetryManager.iniciarCronometro();
      }
      if (this.lblTitleAccion) this.lblTitleAccion.textContent = 'Cancelar';
      if (this.lblHilosAccion) this.lblHilosAccion.textContent = 'Detener análisis';
      if (this.iconAnalisis) {
        this.iconAnalisis.innerHTML = `
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="2"/>
          </svg>
        `;
      }
      this.btnIniciarAccion.classList.add('cancel');
      this.btnIniciarAccion.disabled = false;
      this.cardStepOrigen.style.pointerEvents = 'none';
      this.cardStepDestino.style.pointerEvents = 'none';
      if (this.inputNombreArchivoSalida) this.inputNombreArchivoSalida.disabled = true;
    } else {
      if (this.telemetryManager) {
        this.telemetryManager.detenerCronometro();
      }
      if (this.lblTitleAccion) this.lblTitleAccion.textContent = 'Análisis';
      if (this.lblHilosAccion) this.lblHilosAccion.textContent = 'Iniciar';
      if (this.iconAnalisis) {
        this.iconAnalisis.innerHTML = `
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
        `;
      }
      this.btnIniciarAccion.classList.remove('cancel');
      this.btnIniciarAccion.disabled = false;
      this.cardStepOrigen.style.pointerEvents = 'auto';
      this.cardStepDestino.style.pointerEvents = 'auto';
      if (this.inputNombreArchivoSalida) this.inputNombreArchivoSalida.disabled = false;
    }
  }

  /**
   * Puebla los datalists del consultor con sugerencias de autocompletado.
   */
  poblarSugerenciasSoftware(programas, vms, versiones, propietarios, asignados = [], elementos = []) {
    this.consultorController.poblarSugerencias(programas, vms, versiones, propietarios, asignados, elementos);
  }

  /**
   * Renderiza el resultado de la consulta sobre la base de datos de software.
   */
  renderResultadosSoftware(resultado, filtros, onAbrirUbicacion) {
    this.consultorController.renderResultados(resultado, filtros, onAbrirUbicacion);
  }

  /**
   * Renderiza la lista de registros en el modal de historial.
   */
  renderHistorial(items, onAbrirCarpeta) {
    renderHistorial(this.containerHistorial, items, onAbrirCarpeta);
  }
}

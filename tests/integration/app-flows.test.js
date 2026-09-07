import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDomEnvironment, MockElement } from '../helpers/dom-helper.js';
import { AppState } from '../../src/js/state.js';
import { HistoryManager } from '../../src/js/history.js';
import { renderHistorial } from '../../src/js/history-view.js';
import { TelemetryManager } from '../../src/js/telemetry.js';
import { ConsultorController } from '../../src/js/consultor-controller.js';
import { CardsView } from '../../src/js/cards-view.js';
import { InspectorView } from '../../src/js/inspector-view.js';

describe('Flujos de Integración Frontend (app-flows.test.js)', () => {
  beforeEach(() => {
    setupDomEnvironment();
  });

  it('Flujo 1: Configuración -> Payload -> Telemetría -> Historial -> Vista Historial', () => {
    // 1. Configuración de la sesión
    const appState = new AppState();
    appState.guardar({
      max_hilos: 8,
      modo_dump: true,
      forzar_qemu: false,
      nombre_archivo_salida: 'Inventario_Corporativo_2026.json'
    });

    const payload = appState.obtenerPayload();
    assert.equal(payload.max_hilos, 8);
    assert.equal(payload.modo_dump, true);
    assert.equal(payload.nombre_archivo_salida, 'Inventario_Corporativo_2026.json');

    // 2. Telemetría en vivo
    const telemetryDom = {
      badgeFase: new MockElement('span'),
      lblBigPorcentaje: new MockElement('span'),
      lblProgresoMsg: new MockElement('span'),
      barGlobal: new MockElement('div'),
      statVms: new MockElement('span'),
      statExitosas: new MockElement('span'),
      statObservaciones: new MockElement('span'),
      statTiempo: new MockElement('span'),
      itemEta: new MockElement('div'),
      statEta: new MockElement('span'),
      statVelocidad: new MockElement('span'),
      wrapperWorkers: new MockElement('div'),
      listWorkers: new MockElement('div'),
      wrapperVmIndividual: new MockElement('div'),
      lblVmIndividualTitulo: new MockElement('span'),
      lblVmIndividualPorcentaje: new MockElement('span'),
      barVmIndividual: new MockElement('div'),
      lblVmIndividualEtapa: new MockElement('span'),
      wrapperBitacora: new MockElement('div'),
      logConsole: new MockElement('div'),
      telemetryCanvasVisual: new MockElement('canvas')
    };

    const telemetry = new TelemetryManager(telemetryDom);
    telemetry.actualizar({
      fase: 'finalizado',
      progreso_global: 100.0,
      mensaje_estado: 'Relevamiento finalizado con éxito',
      vms_procesadas: 15,
      total_vms: 15,
      vms_exitosas: 14,
      vms_con_observaciones: 1,
      vms_discrepantes: 0,
      vms_fallidas: 0,
      tiempo_transcurrido_formateado: '04:20',
      tiempo_restante_formateado: null,
      velocidad_vms_minuto: 3.5,
      peso_total_procesado_gb: 250.0,
      vm_actual_indice: 15,
      vm_actual_nombre: null,
      progreso_vm_actual: 100,
      etapa_vm_actual: 'Completado',
      detalle_vm_actual: null,
      vms_activas: [],
      logs_recientes: [
        {
          timestamp: '15:30:00',
          nivel: 'INFO',
          vm: 'GLOBAL',
          mensaje: 'Reporte generado con éxito'
        }
      ]
    });

    assert.ok(telemetryDom.statExitosas.textContent.includes('14 exitosas'));
    assert.equal(telemetryDom.barGlobal.style.width, '100%');

    // 3. Registro en Historial
    const historyManager = new HistoryManager();
    const registro = historyManager.agregar({
      ruta_origen: 'D:\\VMs_Produccion',
      ruta_destino: 'D:\\Auditorias',
      archivo_json: payload.nombre_archivo_salida,
      total_vms: 15,
      exitosas: 14,
      con_observaciones: 1,
      discrepantes: 0,
      duracion: '04:20',
      peso_gb: 250.0
    });

    assert.equal(historyManager.obtenerTodos().length, 1);

    // 4. Renderizado en Modal de Historial
    const historyContainer = new MockElement('div');
    let rutaAbierta = null;
    renderHistorial(historyContainer, historyManager.obtenerTodos(), (ruta) => {
      rutaAbierta = ruta;
    });

    assert.ok(historyContainer.innerHTML.includes('14 exitosas'));
    assert.ok(historyContainer.innerHTML.includes('250.00 GB'));

    const btnAbrir = historyContainer.querySelector('.btn-abrir-dest');
    assert.ok(btnAbrir);
    btnAbrir.click();
    assert.equal(rutaAbierta, 'D:\\Auditorias');
  });

  it('Flujo 2: Búsqueda en Consultor -> Renderizado Tarjetas -> Interacción', () => {
    const cardsContainer = new MockElement('div');
    const cardsView = new CardsView(cardsContainer);
    let zoomAjustado = false;
    const graphView = {
      render() {},
      ajustarZoom() { zoomAjustado = true; }
    };

    const consultorDom = {
      inputBuscarPrograma: new MockElement('input'),
      inputBuscarVm: new MockElement('input'),
      inputBuscarVersion: new MockElement('input'),
      selectBuscarTipo: new MockElement('select'),
      inputBuscarPropietario: new MockElement('input'),
      selectBuscarSo: new MockElement('select'),
      selectBuscarCategoria: new MockElement('select'),
      btnLimpiarPrograma: new MockElement('button'),
      btnLimpiarVm: new MockElement('button'),
      btnLimpiarFiltros: new MockElement('button'),
      btnVistaDiagrama: new MockElement('button'),
      btnVistaTarjetas: new MockElement('button'),
      consultorCardsWrapper: new MockElement('div'),
      consultorGraphWrapper: new MockElement('div'),
      consultorGraphSvg: new MockElement('svg'),
      graphDetailDrawer: new MockElement('div'),
      consultorEmptyState: new MockElement('div'),
      lblSoftwareMetricas: new MockElement('span'),
      datalistProgramas: new MockElement('datalist'),
      datalistVms: new MockElement('datalist'),
      datalistVersiones: new MockElement('datalist'),
      datalistPropietarios: new MockElement('datalist')
    };

    let busquedasCount = 0;
    const controller = new ConsultorController(
      consultorDom,
      { cardsView, graphView },
      () => { busquedasCount++; }
    );

    // 1. Poblado de autocompletado
    controller.poblarSugerencias(
      ['PostgreSQL 15', 'Nginx 1.24'],
      ['SRV-DB-01', 'SRV-WEB-01'],
      ['15.3', '1.24.0'],
      ['Infraestructura'],
      ['Bases de datos', 'Servidores web']
    );

    // 2. Simulación de respuesta con resultados
    const resultadoBackend = {
      total_archivos_json: 1,
      total_vms_escaneadas: 2,
      total_programas_indexados: 2,
      coincidencias: [
        {
          nombre_programa: 'PostgreSQL 15',
          version: '15.3',
          editor: 'PostgreSQL Group',
          categoria: 'Bases de datos',
          tags: ['sql', 'rdbms'],
          nombre_vm: 'SRV-DB-01',
          nombre_interno: 'SRV-DB-PRIMARY',
          ruta_carpeta: 'D:\\Servidores\\SRV-DB-01',
          propietario: 'DBA Team',
          tipo_posesion: 'Servidores',
          elemento_asignado: 'Infraestructura',
          sistema_operativo: 'Ubuntu 22.04',
          peso_gb: 45.0,
          hipervisor: 'VMware',
          archivo_json: 'Relevamiento.json',
          fecha_relevamiento: '2026-09-07'
        }
      ]
    };

    let rutaSeleccionada = null;
    controller.renderResultados(
      resultadoBackend,
      { programa: 'PostgreSQL' },
      (ruta) => { rutaSeleccionada = ruta; }
    );

    // Verificamos que las tarjetas se hayan renderizado
    assert.equal(cardsContainer.children.length, 1);
    assert.ok(cardsContainer.innerHTML.includes('PostgreSQL 15'));
    assert.ok(cardsContainer.innerHTML.includes('badge-servidor'));

    // Clic en abrir carpeta de la tarjeta
    const btnAbrir = cardsContainer.querySelector('.btn-abrir-ubicacion-vm');
    assert.ok(btnAbrir);
    btnAbrir.click();
    assert.equal(rutaSeleccionada, 'D:\\Servidores\\SRV-DB-01');

    // Cambiar a vista de diagrama
    controller.cambiarVista('diagrama');
    assert.equal(controller.vistaActiva, 'diagrama');
    assert.equal(zoomAjustado, true);

    // Limpiar filtros
    controller.limpiarFiltros();
    assert.equal(consultorDom.inputBuscarPrograma.value, '');
  });

  it('Flujo 3: Inspector directo de VM -> Progreso -> Informe -> Filtros Software', () => {
    const inspectorDom = {
      btnSeleccionarDiscoInspector: new MockElement('button'),
      btnIniciarInspeccionDisco: new MockElement('button'),
      btnExportarInformeDisco: new MockElement('button'),
      lblDiscoInspectorRuta: new MockElement('span'),
      cardStepDiscoInspector: new MockElement('div'),
      wrapperProgresoInspector: new MockElement('div'),
      barProgresoInspector: new MockElement('div'),
      lblPorcentajeInspector: new MockElement('span'),
      lblEtapaInspector: new MockElement('span'),
      lblDetalleInspector: new MockElement('span'),
      containerResultadosInspector: new MockElement('div'),
      inspectorEmptyState: new MockElement('div'),
      lblInspFormato: new MockElement('span'),
      lblInspHipervisor: new MockElement('span'),
      lblInspTamanoVirtual: new MockElement('span'),
      lblInspTamanoReal: new MockElement('span'),
      lblInspAcceso: new MockElement('span'),
      lblInspDuracion: new MockElement('span'),
      lblInspBytesLeidos: new MockElement('span'),
      lblInspQemuCalls: new MockElement('span'),
      lblInspSoNombre: new MockElement('span'),
      lblInspSoDetalles: new MockElement('span'),
      lblInspVmTools: new MockElement('span'),
      lblInspEsquema: new MockElement('span'),
      listInspParticiones: new MockElement('div'),
      inputFiltrarSoftwareInspector: new MockElement('input'),
      selectCategoriaSoftwareInspector: new MockElement('select'),
      tbodySoftwareInspector: new MockElement('tbody'),
      lblTotalProgramasInspector: new MockElement('span')
    };

    let exportado = null;
    const inspector = new InspectorView(inspectorDom, {
      onExportarInforme: (informe) => { exportado = informe; }
    });

    // 1. Selección de disco
    inspector.setDiscoSeleccionado('E:\\Discos\\WindowsServer.vmdk');
    assert.equal(inspectorDom.btnIniciarInspeccionDisco.disabled, false);

    // 2. Progreso
    inspector.setEstadoEjecucion(true);
    assert.equal(inspectorDom.btnIniciarInspeccionDisco.disabled, true);
    inspector.actualizarProgreso({
      porcentaje: 90,
      etapa: 'Indexando software',
      detalle: 'Analizando claves de registro'
    });
    assert.equal(inspectorDom.lblPorcentajeInspector.textContent, '90%');
    inspector.setEstadoEjecucion(false);

    // 3. Renderizado de informe
    const informeCompleto = {
      exito: true,
      archivo: 'E:\\Discos\\WindowsServer.vmdk',
      imagen: {
        formato: 'VMDK',
        hipervisor: 'VMware Workstation',
        tamano_virtual: 107374182400,
        tamano_real: 42949672960
      },
      estadisticas: {
        modo_acceso: 'Nativo',
        duracion_ms: 220,
        bytes_leidos: 15728640,
        invocaciones_qemu: 0
      },
      vm_info: {
        os_nombre: 'Windows Server 2022 Datacenter',
        os_edition_version: '21H2',
        os_build: '20348',
        vmtools_version: '12.3.5'
      },
      sistema_operativo: 'Windows Server 2022',
      esquema: 'GPT',
      particiones: [
        {
          indice: 1,
          inicio: 1048576,
          tamano: 107373133824,
          tipo: 'Basic data partition',
          etiqueta: 'SYSTEM',
          sistema_archivos: 'NTFS'
        }
      ],
      programas: [
        {
          nombre: 'Microsoft SQL Server 2022',
          version: '16.0.1000',
          editor: 'Microsoft Corporation',
          categoria: 'Bases de datos',
          tags: ['sql', 'rdbms'],
          relevante: true
        },
        {
          nombre: 'IIS 10.0',
          version: '10.0',
          editor: 'Microsoft Corporation',
          categoria: 'Servidores web',
          tags: ['web', 'http'],
          relevante: true
        }
      ],
      advertencias: []
    };

    inspector.renderInforme(informeCompleto);
    assert.equal(inspectorDom.lblInspSoNombre.textContent, 'Windows Server 2022 Datacenter');
    assert.ok(inspectorDom.tbodySoftwareInspector.innerHTML.includes('Microsoft SQL Server 2022'));
    assert.ok(inspectorDom.tbodySoftwareInspector.innerHTML.includes('IIS 10.0'));

    // Exportación de informe
    inspectorDom.btnExportarInformeDisco.click();
    assert.equal(exportado.archivo, 'E:\\Discos\\WindowsServer.vmdk');
  });
});

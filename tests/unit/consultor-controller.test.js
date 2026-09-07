import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDomEnvironment, MockElement } from '../helpers/dom-helper.js';
import { ConsultorController } from '../../src/js/consultor-controller.js';

describe('Controlador del Consultor de Software (consultor-controller.js)', () => {
  let dom;
  let views;
  let busquedasEjecutadas;

  beforeEach(() => {
    setupDomEnvironment();
    busquedasEjecutadas = 0;
    dom = {
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

    views = {
      cardsView: {
        renderCalled: false,
        render(coincidencias) {
          this.renderCalled = true;
          this.coincidencias = coincidencias;
        }
      },
      graphView: {
        renderCalled: false,
        ajustarZoomCalled: false,
        render(coincidencias) {
          this.renderCalled = true;
          this.coincidencias = coincidencias;
        },
        ajustarZoom() {
          this.ajustarZoomCalled = true;
        }
      }
    };
  });

  it('debe limpiar los campos de búsqueda con limpiarFiltros()', () => {
    const controller = new ConsultorController(dom, views, () => { busquedasEjecutadas++; });

    dom.inputBuscarPrograma.value = 'Oracle';
    dom.inputBuscarVm.value = 'SRV-01';
    dom.selectBuscarTipo.value = 'Servidores';
    dom.selectBuscarCategoria.value = 'Bases de datos';

    controller.limpiarFiltros();

    assert.equal(dom.inputBuscarPrograma.value, '');
    assert.equal(dom.inputBuscarVm.value, '');
    assert.equal(dom.selectBuscarTipo.value, 'todos');
    assert.equal(dom.selectBuscarCategoria.value, 'todas');
  });

  it('debe preservar solo el campo especificado con limpiarTodosFiltrosExcepto()', () => {
    const controller = new ConsultorController(dom, views, () => {});

    dom.inputBuscarPrograma.value = 'Postgres';
    dom.inputBuscarVm.value = 'SRV-01';

    controller.limpiarTodosFiltrosExcepto('programa', 'PostgreSQL');

    assert.equal(dom.inputBuscarPrograma.value, 'PostgreSQL');
    assert.equal(dom.inputBuscarVm.value, '');
    assert.equal(dom.selectBuscarTipo.value, 'todos');
  });

  it('debe poblar las opciones de datalists y categorías con poblarSugerencias()', () => {
    const controller = new ConsultorController(dom, views, () => {});

    controller.poblarSugerencias(
      ['Node.js', 'PostgreSQL'],
      ['SRV-WEB', 'SRV-DB'],
      ['18.0', '15.0'],
      ['Juan', 'Maria'],
      ['Desarrollo', 'Bases de datos']
    );

    assert.ok(dom.datalistProgramas.innerHTML.includes('Node.js'));
    assert.ok(dom.datalistVms.innerHTML.includes('SRV-WEB'));
    assert.ok(dom.datalistVersiones.innerHTML.includes('18.0'));
    assert.ok(dom.datalistPropietarios.innerHTML.includes('Juan'));
    assert.ok(dom.selectBuscarCategoria.innerHTML.includes('Desarrollo'));
  });

  it('debe gestionar los 4 estados de renderResultados()', () => {
    const controller = new ConsultorController(dom, views, () => {});

    // Estado 1: Sin base de datos configurada o sin reportes
    controller.renderResultados(null, {});
    assert.equal(dom.consultorEmptyState.style.display, 'flex');
    assert.ok(dom.consultorEmptyState.innerHTML.includes('No se encontró ningún reporte JSON'));
    assert.equal(dom.btnVistaDiagrama.disabled, true);

    // Estado 2: Base de datos disponible pero sin filtros activos
    const mockResultado = {
      total_archivos_json: 2,
      total_vms_escaneadas: 10,
      total_programas_indexados: 45,
      coincidencias: []
    };
    controller.renderResultados(mockResultado, {});
    assert.equal(dom.consultorEmptyState.style.display, 'flex');
    assert.ok(dom.consultorEmptyState.innerHTML.includes('Aplica al menos un filtro'));

    // Estado 3: Filtro activo pero 0 coincidencias
    controller.renderResultados(mockResultado, { programa: 'SoftwareInexistente' });
    assert.equal(dom.consultorEmptyState.style.display, 'flex');
    assert.ok(dom.consultorEmptyState.innerHTML.includes('No se encontraron resultados'));

    // Estado 4: Coincidencias encontradas
    const mockConResultados = {
      ...mockResultado,
      coincidencias: [
        {
          nombre_programa: 'PostgreSQL',
          nombre_vm: 'SRV-DB',
          ruta_carpeta: 'D:\\VMs\\SRV-DB'
        }
      ]
    };
    controller.renderResultados(mockConResultados, { programa: 'PostgreSQL' }, () => {});
    assert.equal(dom.consultorEmptyState.style.display, 'none');
    assert.equal(dom.btnVistaTarjetas.disabled, false);
    assert.equal(dom.btnVistaDiagrama.disabled, false);
    assert.ok(views.cardsView.renderCalled);
    assert.ok(views.graphView.renderCalled);
  });
});

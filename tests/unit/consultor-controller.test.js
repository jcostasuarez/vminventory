import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDomEnvironment, MockElement } from '../helpers/dom-helper.js';
import {
  ConsultorController,
  sanitizarTexto,
  extraerOpcionesFiltros,
  filtrarVirtuales
} from '../../src/js/consultor-controller.js';

describe('Controlador del Consultor de Software (consultor-controller.js)', () => {
  let dom;
  let views;
  let busquedasEjecutadas;

  // Mock de datos simulando la estructura jerárquica unificada (Personas, Discos, Servidores)
  const mockVMsJerarquia = [
    {
      nombre_vm: 'Win11-Dev-Juan',
      nombre_interno: 'Win11-Dev',
      ruta_carpeta: 'C:\\Relevamientos_VMs\\Personas\\Juan Costa\\Win11',
      origen_categoria: 'Personas',
      tipo_posesion: 'Personas',
      asignado: 'Juan Costa Suarez',
      elemento: null,
      propietario: 'Juan Costa Suarez',
      elemento_asignado: 'Juan Costa Suarez',
      sistema_operativo: 'Windows 11 Enterprise',
      categoria: 'Desarrollo',
      discrepante: false,
      programas: [
        { nombre: 'Visual Studio Code', version: '1.85.0', tags: ['editor', 'ide'], categoria: 'Desarrollo' },
        { nombre: 'Node.js', version: '20.10.0', tags: ['javascript', 'runtime'], categoria: 'Desarrollo' }
      ]
    },
    {
      nombre_vm: 'Debian-Backup-VM',
      nombre_interno: null,
      ruta_carpeta: 'C:\\Relevamientos_VMs\\Discos\\Disco_Externo_01\\BackupVM',
      origen_categoria: 'Discos',
      tipo_posesion: 'Discos',
      asignado: null,
      elemento: 'Disco 01 Externo',
      propietario: 'Disco 01 Externo',
      elemento_asignado: 'Disco 01 Externo',
      sistema_operativo: 'Debian GNU/Linux 12',
      categoria: 'Infraestructura',
      discrepante: true,
      programas: [
        { nombre: 'Docker Engine', version: '24.0.7', tags: ['docker', 'containers'], categoria: 'Contenedores' }
      ]
    },
    {
      nombre_vm: 'SRV-SQL-PROD-01',
      nombre_interno: 'SRV-SQL-PROD',
      ruta_carpeta: 'C:\\Relevamientos_VMs\\Servidores\\Cluster_Principal\\SQLProd',
      origen_categoria: 'Servidores',
      tipo_posesion: 'Servidores',
      asignado: null,
      elemento: 'Cluster Principal ESXi',
      propietario: 'Cluster Principal ESXi',
      elemento_asignado: 'Cluster Principal ESXi',
      sistema_operativo: 'Windows Server 2022 Datacenter',
      categoria: 'Bases de datos',
      discrepante: false,
      programas: [
        { nombre: 'Microsoft SQL Server 2019', version: '15.0.2000', tags: ['sql', 'database'], categoria: 'Bases de datos' }
      ]
    },
    {
      // Elemento con valores vacíos, "-" o nulos sin sanitizar
      nombre_vm: 'VM-Sin-Asignar',
      nombre_interno: null,
      ruta_carpeta: 'C:\\Relevamientos_VMs\\Personas\\Unknown\\VM',
      origen_categoria: 'Personas',
      tipo_posesion: 'Personas',
      asignado: '-',
      elemento: 'null',
      propietario: '   ',
      elemento_asignado: 'undefined',
      sistema_operativo: 'Ubuntu 20.04',
      categoria: 'General',
      discrepante: false,
      programas: []
    }
  ];

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

  describe('sanitizarTexto() y extraerOpcionesFiltros()', () => {
    it('debe sanitizar cadenas descartando null, undefined, "-" y espacios en blanco', () => {
      assert.equal(sanitizarTexto('  Juan Costa  '), 'Juan Costa');
      assert.equal(sanitizarTexto(''), null);
      assert.equal(sanitizarTexto('   '), null);
      assert.equal(sanitizarTexto('-'), null);
      assert.equal(sanitizarTexto('null'), null);
      assert.equal(sanitizarTexto('undefined'), null);
      assert.equal(sanitizarTexto(null), null);
      assert.equal(sanitizarTexto(undefined), null);
    });

    it('debe extraer opciones únicas para Asignado y Elemento sin colar valores inválidos', () => {
      const { opcionesAsignado, opcionesElemento, opcionesPropietario } = extraerOpcionesFiltros(mockVMsJerarquia);

      assert.deepEqual(opcionesAsignado, ['Juan Costa Suarez']);
      assert.deepEqual(opcionesElemento, ['Cluster Principal ESXi', 'Disco 01 Externo']);
      assert.ok(!opcionesAsignado.includes('-'));
      assert.ok(!opcionesAsignado.includes('null'));
      assert.ok(!opcionesElemento.includes('undefined'));
      assert.ok(opcionesPropietario.includes('Juan Costa Suarez'));
      assert.ok(opcionesPropietario.includes('Cluster Principal ESXi'));
    });
  });

  describe('filtrarVirtuales() - Lógica AND y Normalización de Cadenas', () => {
    it('debe filtrar por Asignado con normalización case-insensitive y espacios', () => {
      const res = filtrarVirtuales(mockVMsJerarquia, { asignado: '  juan costa  ' });
      assert.equal(res.length, 1);
      assert.equal(res[0].nombre_vm, 'Win11-Dev-Juan');
    });

    it('debe filtrar por Elemento en Discos y Servidores', () => {
      const resDiscos = filtrarVirtuales(mockVMsJerarquia, { elemento: 'disco 01' });
      assert.equal(resDiscos.length, 1);
      assert.equal(resDiscos[0].nombre_vm, 'Debian-Backup-VM');

      const resServ = filtrarVirtuales(mockVMsJerarquia, { elemento: 'cluster principal' });
      assert.equal(resServ.length, 1);
      assert.equal(resServ[0].nombre_vm, 'SRV-SQL-PROD-01');
    });

    it('debe aplicar condición lógica AND entre Tipo, Asignado/Elemento, Programa y SO', () => {
      // Coincide todo
      const match = filtrarVirtuales(mockVMsJerarquia, {
        tipo: 'Personas',
        asignado: 'Juan',
        programa: 'visual studio',
        so: 'windows'
      });
      assert.equal(match.length, 1);

      // Falla por SO
      const noMatchSo = filtrarVirtuales(mockVMsJerarquia, {
        tipo: 'Personas',
        asignado: 'Juan',
        programa: 'visual studio',
        so: 'linux'
      });
      assert.equal(noMatchSo.length, 0);

      // Falla por Tipo
      const noMatchTipo = filtrarVirtuales(mockVMsJerarquia, {
        tipo: 'Servidores',
        asignado: 'Juan'
      });
      assert.equal(noMatchTipo.length, 0);
    });

    it('debe filtrar por discrepantes correctamente con AND', () => {
      const discrepantes = filtrarVirtuales(mockVMsJerarquia, { discrepante: true });
      assert.equal(discrepantes.length, 1);
      assert.equal(discrepantes[0].nombre_vm, 'Debian-Backup-VM');

      const noDiscrepantes = filtrarVirtuales(mockVMsJerarquia, { discrepante: false });
      assert.equal(noDiscrepantes.length, 3);
    });
  });

  describe('ConsultorController - Métodos de UI y Eventos', () => {
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

    it('debe poblar las opciones de datalists sanitizando valores nulos y vacíos', () => {
      const controller = new ConsultorController(dom, views, () => {});

      controller.poblarSugerencias(
        ['Node.js', 'PostgreSQL', ' - ', null],
        ['SRV-WEB', 'SRV-DB', ''],
        ['18.0', '15.0', 'undefined'],
        ['Juan', 'Maria', '-'],
        ['Desarrollo', 'Bases de datos'],
        ['Juan Costa'],
        ['Disco 01', 'Cluster A']
      );

      assert.ok(dom.datalistProgramas.innerHTML.includes('Node.js'));
      assert.ok(!dom.datalistProgramas.innerHTML.includes('value="-"'));
      assert.ok(dom.datalistVms.innerHTML.includes('SRV-WEB'));
      assert.ok(dom.datalistVersiones.innerHTML.includes('18.0'));
      assert.ok(!dom.datalistVersiones.innerHTML.includes('undefined'));
      assert.ok(dom.datalistPropietarios.innerHTML.includes('Juan Costa'));
      assert.ok(dom.datalistPropietarios.innerHTML.includes('Cluster A'));
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
});

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setupDomEnvironment, MockElement } from '../helpers/dom-helper.js';
import { InspectorView } from '../../src/js/inspector-view.js';

describe('Vista del Inspector Directo (inspector-view.js)', () => {
  let dom;

  beforeEach(() => {
    setupDomEnvironment();
    dom = {
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
      inspectorWarningsBox: new MockElement('div'),
      inputFiltrarSoftwareInspector: new MockElement('input'),
      selectCategoriaSoftwareInspector: new MockElement('select'),
      tbodySoftwareInspector: new MockElement('tbody'),
      lblTotalProgramasInspector: new MockElement('span')
    };
  });

  it('debe actualizar la UI al seleccionar un archivo de disco con setDiscoSeleccionado()', () => {
    const inspector = new InspectorView(dom);

    inspector.setDiscoSeleccionado('C:\\VMs\\Ubuntu\\disk.vmdk');
    assert.equal(dom.lblDiscoInspectorRuta.textContent, 'C:\\VMs\\Ubuntu\\disk.vmdk');
    assert.ok(dom.cardStepDiscoInspector.classList.contains('ready'));
    assert.equal(dom.btnIniciarInspeccionDisco.disabled, false);
    assert.ok(dom.btnIniciarInspeccionDisco.classList.contains('ready-to-run'));

    inspector.setDiscoSeleccionado('');
    assert.equal(dom.lblDiscoInspectorRuta.textContent, 'Ningún archivo de disco seleccionado');
    assert.ok(!dom.cardStepDiscoInspector.classList.contains('ready'));
    assert.equal(dom.btnIniciarInspeccionDisco.disabled, true);
  });

  it('debe actualizar la barra de progreso de inspección con actualizarProgreso()', () => {
    const inspector = new InspectorView(dom);

    inspector.actualizarProgreso({
      porcentaje: 65,
      etapa: 'Analizando colmena SYSTEM',
      detalle: 'Extrayendo hostname'
    });

    assert.equal(dom.barProgresoInspector.style.width, '65%');
    assert.equal(dom.lblPorcentajeInspector.textContent, '65%');
    assert.equal(dom.lblEtapaInspector.textContent, 'Analizando colmena SYSTEM');
    assert.equal(dom.lblDetalleInspector.textContent, 'Extrayendo hostname');
  });

  it('debe renderizar un informe estructurado completo y filtrar software', () => {
    const inspector = new InspectorView(dom);
    const mockInforme = {
      exito: true,
      archivo: 'C:\\VMs\\Ubuntu.vmdk',
      imagen: {
        formato: 'VMDK',
        hipervisor: 'VMware',
        tamano_virtual: 53687091200,
        tamano_real: 21474836480
      },
      estadisticas: {
        modo_acceso: 'Nativo',
        duracion_ms: 150,
        bytes_leidos: 10485760,
        invocaciones_qemu: 0
      },
      vm_info: {
        os_nombre: 'Ubuntu 22.04 LTS',
        os_edition_version: '22.04.3',
        os_build: '5.15.0',
        vmtools_version: '12.1.0'
      },
      sistema_operativo: 'Ubuntu 22.04 LTS',
      esquema: 'GPT',
      particiones: [
        {
          indice: 1,
          inicio: 1048576,
          tamano: 53686042624,
          tipo: 'Linux filesystem',
          etiqueta: 'root',
          sistema_archivos: 'ext4'
        }
      ],
      programas: [
        {
          nombre: 'Docker Engine',
          version: '24.0.7',
          editor: 'Docker Inc',
          categoria: 'Contenedores',
          tags: ['docker', 'containers'],
          relevante: true
        },
        {
          nombre: 'PostgreSQL 15',
          version: '15.4',
          editor: 'PostgreSQL Global Group',
          categoria: 'Bases de datos',
          tags: ['sql', 'db'],
          relevante: true
        }
      ]
    };

    inspector.renderInforme(mockInforme);

    assert.equal(dom.containerResultadosInspector.style.display, 'flex');
    assert.equal(dom.inspectorEmptyState.style.display, 'none');
    assert.equal(dom.lblInspFormato.textContent, 'VMDK');
    assert.equal(dom.lblInspHipervisor.textContent, 'VMware');
    assert.equal(dom.lblInspSoNombre.textContent, 'Ubuntu 22.04 LTS');
    assert.ok(dom.lblInspVmTools.innerHTML.includes('12.1.0'));
    assert.ok(dom.listInspParticiones.innerHTML.includes('fs-ext'));
    assert.ok(dom.tbodySoftwareInspector.innerHTML.includes('Docker Engine'));
    assert.ok(dom.tbodySoftwareInspector.innerHTML.includes('PostgreSQL 15'));

    // Filtrado por texto
    dom.inputFiltrarSoftwareInspector.value = 'docker';
    dom.inputFiltrarSoftwareInspector.dispatchEvent({ type: 'input', target: dom.inputFiltrarSoftwareInspector });

    assert.ok(dom.tbodySoftwareInspector.innerHTML.includes('Docker Engine'));
    assert.ok(!dom.tbodySoftwareInspector.innerHTML.includes('PostgreSQL 15'));
    assert.equal(dom.lblTotalProgramasInspector.textContent, '1 de 2 programas');
  });

  it('debe renderizar adecuadamente un informe de disco que falló (con observaciones y timeout)', () => {
    const inspector = new InspectorView(dom);
    const mockInformeFallo = {
      exito: false,
      exitosa: false,
      archivo: 'C:\\VirtualMachines\\CorruptDisk.vmdk',
      imagen: {
        formato: 'vmdk',
        hipervisor: 'Desconocido',
        tamano_virtual: 8288000000,
        tamano_real: 8288000000
      },
      estadisticas: {
        modo_acceso: 'native',
        duracion_ms: 5000,
        bytes_leidos: 0,
        invocaciones_qemu: 0
      },
      vm_info: {
        os_nombre: '',
        os_edition_version: '',
        os_build: '',
        vmtools_version: null
      },
      sistema_operativo: 'No identificado',
      esquema: 'Desconocido',
      particiones: [],
      programas: [],
      advertencias: [
        'Timeout de I/O (5s) excedido al intentar leer particiones o registros (Windows\\System32\\config)',
        'Fallo la inspección: Inspection error: Timeout de I/O al leer particiones o registros.'
      ]
    };

    inspector.renderInforme(mockInformeFallo);

    assert.equal(dom.containerResultadosInspector.style.display, 'flex');
    assert.equal(dom.inspectorWarningsBox.style.display, 'block');
    assert.ok(dom.inspectorWarningsBox.innerHTML.includes('Timeout de I/O'));
    assert.ok(dom.inspectorWarningsBox.innerHTML.includes('Inspección Fallida'));
    assert.ok(dom.lblInspSoNombre.textContent.includes('No identificado'));
    assert.ok(dom.listInspParticiones.innerHTML.includes('No se pudieron leer las particiones'));
    assert.equal(dom.lblTotalProgramasInspector.textContent, '0 de 0 programas');
  });

  it('debe renderizar un informe con programas clasificados correctamente', () => {
    const informeSimulado = {
      exito: true,
      archivo: 'C:\\VirtualMachines\\ServerApp.vmdk',
      imagen: {
        formato: 'VMDK',
        hipervisor: 'VMware',
        tamano_virtual: 40000000000,
        tamano_real: 20000000000
      },
      estadisticas: {
        modo_acceso: 'Nativo',
        duracion_ms: 120,
        bytes_leidos: 5000000,
        invocaciones_qemu: 0
      },
      vm_info: {
        os_nombre: 'Microsoft Windows Server 2022',
        os_edition_version: 'Datacenter',
        os_build: '20348',
        vmtools_version: '12.0'
      },
      sistema_operativo: 'Microsoft Windows Server 2022',
      esquema: 'GPT',
      particiones: [],
      programas: [
        {
          nombre: 'Security Antivirus Enterprise',
          version: '5.2',
          editor: 'Security Corp',
          categoria: 'Seguridad',
          tags: ['antivirus', 'security'],
          relevante: true
        },
        {
          nombre: 'Industrial Process Controller',
          version: '10.1',
          editor: 'Automation Group',
          categoria: 'Industrial',
          tags: ['scada', 'industrial'],
          relevante: true
        }
      ],
      advertencias: []
    };

    const inspector = new InspectorView(dom);
    inspector.renderInforme(informeSimulado);

    assert.equal(dom.containerResultadosInspector.style.display, 'flex');
    assert.equal(dom.lblInspSoNombre.textContent, 'Microsoft Windows Server 2022');
    assert.ok(dom.tbodySoftwareInspector.innerHTML.includes('Security Antivirus Enterprise'));
    assert.ok(dom.tbodySoftwareInspector.innerHTML.includes('Industrial Process Controller'));
    assert.equal(dom.lblTotalProgramasInspector.textContent, '2 de 2 programas');
  });
});

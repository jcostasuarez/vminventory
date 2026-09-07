import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDomEnvironment, MockElement } from '../helpers/dom-helper.js';
import { TelemetryManager } from '../../src/js/telemetry.js';

describe('Gestor de Telemetría (telemetry.js)', () => {
  let dom;

  beforeEach(() => {
    setupDomEnvironment();
    dom = {
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
  });

  it('debe mapear correctamente las fases a textos y clases en renderBadgeFase()', () => {
    const telemetry = new TelemetryManager(dom);

    telemetry.renderBadgeFase('iniciando');
    assert.equal(dom.badgeFase.textContent, 'Iniciando...');
    assert.ok(dom.badgeFase.className.includes('running'));

    telemetry.renderBadgeFase('escaneando_directorio');
    assert.equal(dom.badgeFase.textContent, 'Escaneando...');

    telemetry.renderBadgeFase('analizando_v_ms');
    assert.equal(dom.badgeFase.textContent, 'Analizando...');

    telemetry.renderBadgeFase('finalizado');
    assert.equal(dom.badgeFase.textContent, 'Finalizado');
    assert.ok(dom.badgeFase.className.includes('finished'));

    telemetry.renderBadgeFase('cancelado');
    assert.equal(dom.badgeFase.textContent, 'Cancelado');
    assert.ok(dom.badgeFase.className.includes('cancelled'));
  });

  it('debe actualizar los contadores globales y progreso en actualizar()', () => {
    const telemetry = new TelemetryManager(dom);
    const mockPayload = {
      fase: 'analizando_v_ms',
      progreso_global: 45.5,
      mensaje_estado: 'Analizando máquina 5 de 10',
      vms_procesadas: 5,
      total_vms: 10,
      vms_exitosas: 4,
      vms_con_observaciones: 1,
      vms_discrepantes: 0,
      vms_fallidas: 0,
      tiempo_transcurrido_formateado: '01:30',
      tiempo_restante_formateado: '01:45',
      velocidad_vms_minuto: 3.3,
      peso_total_procesado_gb: 42.5,
      vm_actual_indice: 5,
      vm_actual_nombre: 'SRV-TEST',
      progreso_vm_actual: 80,
      etapa_vm_actual: 'Extrayendo software',
      detalle_vm_actual: 'Registro SOFTWARE',
      vms_activas: [
        {
          indice: 0,
          nombre_vm: 'SRV-TEST-01',
          etapa: 'Extrayendo software',
          porcentaje: 80
        },
        {
          indice: 1,
          nombre_vm: 'SRV-TEST-02',
          etapa: 'Analizando partición',
          porcentaje: 40
        }
      ],
      logs_recientes: [
        {
          timestamp: '12:00:01',
          nivel: 'INFO',
          vm: 'SRV-TEST',
          mensaje: 'Partición montada con éxito'
        }
      ]
    };

    telemetry.actualizar(mockPayload, { habilitar_bitacora: true });

    assert.equal(dom.barGlobal.style.width, '45.5%');
    assert.equal(dom.lblBigPorcentaje.textContent, '45.5%');
    assert.equal(dom.statVms.textContent, '5 / 10');
    assert.ok(dom.statExitosas.textContent.includes('4 exitosas'));
    assert.equal(dom.statTiempo.textContent, '01:30');
    assert.ok(dom.statEta.textContent.includes('01:45'));
    assert.ok(dom.logConsole.innerHTML.includes('Partición montada con éxito'));
    assert.ok(dom.listWorkers.innerHTML.includes('SRV-TEST-01'));
    assert.ok(dom.listWorkers.innerHTML.includes('SRV-TEST-02'));
  });
});

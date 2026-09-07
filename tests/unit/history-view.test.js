import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDomEnvironment, MockElement } from '../helpers/dom-helper.js';
import { renderHistorial } from '../../src/js/history-view.js';

describe('Vista de Historial (history-view.js)', () => {
  beforeEach(() => {
    setupDomEnvironment();
  });

  it('debe manejar contenedor nulo sin arrojar excepción', () => {
    assert.doesNotThrow(() => {
      renderHistorial(null, []);
    });
  });

  it('debe renderizar mensaje de historial vacío cuando no hay elementos', () => {
    const container = new MockElement('div');
    renderHistorial(container, []);

    assert.ok(container.innerHTML.includes('No hay relevamientos registrados'));
  });

  it('debe renderizar registros históricos con estadísticas y gestionar clic en abrir carpeta', () => {
    const container = new MockElement('div');
    const items = [
      {
        id: '1',
        fecha: '07/09/2026, 10:30:00',
        ruta_origen: 'D:\\VMs_Produccion',
        ruta_destino: 'D:\\Reportes_Auditoria',
        total_vms: 10,
        exitosas: 8,
        con_observaciones: 2,
        discrepantes: 1,
        duracion: '05:45',
        peso_gb: 150.25
      }
    ];

    let carpetaAbierta = null;
    renderHistorial(container, items, (ruta) => {
      carpetaAbierta = ruta;
    });

    assert.ok(container.innerHTML.includes('07/09/2026'));
    assert.ok(container.innerHTML.includes('Duración: 05:45'));
    assert.ok(container.innerHTML.includes('150.25 GB'));
    assert.ok(container.innerHTML.includes('Total VMs:'));
    assert.ok(container.innerHTML.includes('8 exitosas'));
    assert.ok(container.innerHTML.includes('2 con obs. (1 disc.)'));

    const btnAbrir = container.querySelector('.btn-abrir-dest');
    assert.ok(btnAbrir);
    btnAbrir.click();

    assert.equal(carpetaAbierta, 'D:\\Reportes_Auditoria');
  });
});

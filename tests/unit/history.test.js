import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDomEnvironment } from '../helpers/dom-helper.js';
import { HistoryManager } from '../../src/js/history.js';

describe('Gestor de Historial (history.js)', () => {
  beforeEach(() => {
    setupDomEnvironment();
  });

  it('debe inicializarse con historial vacío cuando no hay datos en localStorage', () => {
    const manager = new HistoryManager();
    assert.deepEqual(manager.obtenerTodos(), []);
  });

  it('debe agregar entradas al historial formateadas correctamente', () => {
    const manager = new HistoryManager();
    const nuevaEntrada = manager.agregar({
      ruta_origen: 'D:\\VMs',
      ruta_destino: 'D:\\Reportes',
      archivo_json: 'Relevamiento.json',
      total_vms: 5,
      exitosas: 4,
      con_observaciones: 1,
      discrepantes: 0,
      duracion: '02:30',
      peso_gb: 120.5
    });

    assert.ok(nuevaEntrada.id);
    assert.ok(nuevaEntrada.fecha);
    assert.equal(nuevaEntrada.total_vms, 5);
    assert.equal(nuevaEntrada.exitosas, 4);

    const todos = manager.obtenerTodos();
    assert.equal(todos.length, 1);
    assert.equal(todos[0].id, nuevaEntrada.id);
  });

  it('debe limitar el historial a un máximo de 50 registros más recientes', () => {
    const manager = new HistoryManager();
    for (let i = 1; i <= 55; i++) {
      manager.agregar({
        ruta_origen: `D:\\VMs_${i}`,
        ruta_destino: `D:\\Reportes_${i}`,
        total_vms: i
      });
    }

    const todos = manager.obtenerTodos();
    assert.equal(todos.length, 50);
    // El primer elemento debe ser el más reciente agregado (i = 55)
    assert.equal(todos[0].total_vms, 55);
    // El último elemento debe ser i = 6
    assert.equal(todos[49].total_vms, 6);
  });

  it('debe limpiar todo el historial con limpiar()', () => {
    const manager = new HistoryManager();
    manager.agregar({ ruta_origen: 'D:\\VMs', total_vms: 3 });
    assert.equal(manager.obtenerTodos().length, 1);

    manager.limpiar();
    assert.deepEqual(manager.obtenerTodos(), []);
  });
});

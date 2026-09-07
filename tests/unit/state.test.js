import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDomEnvironment } from '../helpers/dom-helper.js';
import { AppState, CONFIG_DEFAULT, STORAGE_KEY } from '../../src/js/state.js';

describe('Estado y Configuración (state.js)', () => {
  beforeEach(() => {
    setupDomEnvironment();
  });

  it('debe iniciar con los valores predeterminados de CONFIG_DEFAULT', () => {
    const appState = new AppState();
    assert.deepEqual(appState.config, CONFIG_DEFAULT);
    assert.equal(appState.config.tema, 'light');
    assert.equal(appState.config.max_hilos, 4);
    assert.equal(appState.config.modo_dump, false);
    assert.equal(appState.config.incluir_system, false);
    assert.equal(appState.config.nombre_archivo_salida, 'Relevamiento_VMs.json');
  });

  it('debe persistir cambios con guardar() en localStorage sin persistir nombre_archivo_salida', () => {
    const appState = new AppState();
    appState.guardar({
      max_hilos: 8,
      modo_dump: true,
      ruta_qemu_nbd: 'C:\\Program Files\\qemu\\qemu-nbd.exe',
      nombre_archivo_salida: 'MiReportePersonalizado.json'
    });

    assert.equal(appState.config.max_hilos, 8);
    assert.equal(appState.config.modo_dump, true);
    assert.equal(appState.config.nombre_archivo_salida, 'MiReportePersonalizado.json');

    const storedRaw = localStorage.getItem(STORAGE_KEY);
    assert.ok(storedRaw);
    const stored = JSON.parse(storedRaw);
    assert.equal(stored.max_hilos, 8);
    assert.equal(stored.modo_dump, true);
    assert.equal(stored.nombre_archivo_salida, undefined, 'nombre_archivo_salida no debe persistirse en localStorage');
  });

  it('debe cargar configuración existente desde localStorage', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      tema: 'dark',
      max_hilos: 12,
      incluir_system: true
    }));

    const appState = new AppState();
    assert.equal(appState.config.tema, 'dark');
    assert.equal(appState.config.max_hilos, 12);
    assert.equal(appState.config.incluir_system, true);
    assert.equal(appState.config.nombre_archivo_salida, 'Relevamiento_VMs.json', 'Debe usar el nombre por defecto');
  });

  it('debe recuperarse ante JSON inválido en localStorage usando defaults', () => {
    localStorage.setItem(STORAGE_KEY, '{ json corrupto ...');
    const appState = new AppState();
    assert.deepEqual(appState.config, CONFIG_DEFAULT);
  });

  it('debe restablecer la configuración y limpiar localStorage con restablecer()', () => {
    const appState = new AppState();
    appState.guardar({ max_hilos: 16, modo_dump: true });
    assert.ok(localStorage.getItem(STORAGE_KEY));

    appState.restablecer();
    assert.deepEqual(appState.config, CONFIG_DEFAULT);
    assert.equal(localStorage.getItem(STORAGE_KEY), null);
  });

  it('debe generar el payload exacto para Rust en obtenerPayload()', () => {
    const appState = new AppState();
    appState.guardar({
      max_hilos: 6,
      modo_dump: true,
      incluir_system: false,
      forzar_qemu: true,
      ruta_qemu_nbd: 'C:\\Program Files\\qemu\\qemu-nbd.exe',
      ruta_reglas: '',
      tamano_chunk_kb: 512,
      generar_discrepancias: true,
      habilitar_bitacora: false,
      mostrar_progreso_individual: true,
      nombre_archivo_salida: 'Auditoria_2026.json'
    });

    const payload = appState.obtenerPayload();
    assert.deepEqual(payload, {
      max_hilos: 6,
      modo_dump: true,
      incluir_system: false,
      forzar_qemu: true,
      ruta_qemu_nbd: 'C:\\Program Files\\qemu\\qemu-nbd.exe',
      ruta_reglas: null,
      tamano_chunk_kb: 512,
      generar_discrepancias: true,
      habilitar_bitacora: false,
      mostrar_progreso_individual: true,
      nombre_archivo_salida: 'Auditoria_2026.json'
    });
  });
});

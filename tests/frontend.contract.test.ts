import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANALYZER_CONFIG_DEFAULT,
  CONFIG_DEFAULT,
  AnalizadorFlow,
  ConsultorFlow,
  OperationState,
  ReporteFlow,
  AppState,
  crearApi,
  seleccionarArchivo,
  seleccionarCarpeta
} from '../src/js/main';
import {
  agruparCoincidenciasPorTipo,
  deducirResponsableDesdeArchivo,
  escapeHtml,
  extraerInfoDisco,
  formatearBytes,
  sanitizarTexto,
  UIManager
} from '../src/js/ui';
import { ThemeManager } from '../src/js/theme';
import type {
  ConsultarSoftwarePayload,
  ConsultorApi,
  ConsultorFlowUi,
  InvokeFunction,
  OpenFolder,
  OpenFolderOptions,
  AppApi,
  InspectionProgress,
  ResultadoConsultaSoftware,
  SearchFilters
} from '../src/js/types';
import { FakeElement, MemoryStorage } from './support/fakes';

describe('Contratos agnósticos del frontend', () => {
  it('persiste la configuración general y la del analizador con sus límites', () => {
    const storage = new MemoryStorage();
    const state = new AppState(storage);

    assert.deepEqual(state.config, CONFIG_DEFAULT);
    assert.deepEqual(state.obtenerConfiguracionAnalizador(), ANALYZER_CONFIG_DEFAULT);

    state.guardar({ tema: 'dark', ruta_bd_json: '  reports  ' });
    state.guardarAnalizador({
      max_hilos: 100,
      ruta_qemu_nbd: '  tools/qemu  ',
      nombre_archivo_salida: 'inventory'
    });

    assert.deepEqual(state.config, {
      tema: 'dark',
      ruta_bd_json: 'reports',
      limite_coincidencias: 30
    });
    assert.equal(state.obtenerConfiguracionAnalizador().max_hilos, 32);
    assert.equal(state.obtenerConfiguracionAnalizador().ruta_qemu_nbd, 'tools/qemu');
    assert.equal(state.obtenerConfiguracionAnalizador().nombre_archivo_salida, 'inventory');

    const restored = new AppState(storage);
    assert.deepEqual(restored.config, state.config);
    assert.deepEqual(
      restored.obtenerConfiguracionAnalizador(),
      state.obtenerConfiguracionAnalizador()
    );
  });

  it('bloquea operaciones concurrentes y conserva la transición de cancelación', () => {
    const operation = new OperationState();

    assert.equal(operation.start('scan'), true);
    assert.equal(operation.start('query'), false);
    assert.equal(operation.isRunning('scan'), true);

    operation.markCancelling('scan');
    assert.equal(operation.isRunning('scan'), false);
    assert.equal(operation.current?.status, 'cancelling');

    operation.finish('query');
    assert.equal(operation.busy, true);
    operation.finish('scan');
    assert.equal(operation.busy, false);
  });

  it('mantiene estable el contrato de comandos IPC sin ejecutar Tauri', async () => {
    const calls: Array<{ command: string; args?: object }> = [];
    const invoke: InvokeFunction = async <T>(command: string, args?: object): Promise<T> => {
      calls.push(args === undefined ? { command } : { command, args });
      return undefined as T;
    };
    const api = crearApi(invoke);
    const payload: ConsultarSoftwarePayload = {
      directorio: 'reports',
      filtroPrograma: 'Example',
      filtroVm: null,
      filtroVersion: null,
      filtroTipo: null,
      filtroResponsable: null
    };

    await api.obtenerVersion();
    await api.inspectionProgress();
    await api.consultarSoftware(payload);

    assert.deepEqual(calls, [
      { command: 'obtener_version_app' },
      { command: 'inspection_progress' },
      { command: 'consultar_software_en_jsons', args: payload }
    ]);
  });

  it('consulta y limpia un único polling del relevamiento', async () => {
    const storage = new MemoryStorage();
    const state = new AppState(storage);
    const operation = new OperationState();
    const telemetria: unknown[] = [];
    const ui = {
      sincronizarConfiguracionAnalizador: () => {},
      actualizarPasos: () => {},
      setEstadoAnalizador: () => {},
      actualizarTelemetria: (estado: unknown) => telemetria.push(estado),
      renderResumenRelevamiento: () => {},
      mostrarErrorAnalizador: () => {}
    } as never;
    const snapshot: InspectionProgress = {
      completed_tasks: 1,
      total_tasks: 2,
      percentage: 50,
      stage_id: 3,
      bytes_processed: 1024,
      total_bytes: 2048,
      cancelled: false
    };
    let resolver: (value: any) => void = () => {};
    const relevamiento = new Promise<any>((resolve) => { resolver = resolve; });
    let consultas = 0;
    const api = {
      procesarRelevamiento: () => relevamiento,
      inspectionProgress: async () => {
        consultas += 1;
        return snapshot;
      },
      detenerInspeccion: async () => undefined
    } as unknown as AppApi;
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    let tick: (() => void) | null = null;
    let intervalosLimpios = 0;
    globalThis.setInterval = ((callback: () => void) => {
      tick = callback;
      return 1;
    }) as unknown as typeof setInterval;
    globalThis.clearInterval = (() => { intervalosLimpios += 1; }) as typeof clearInterval;

    try {
      const flow = new AnalizadorFlow({
        ui,
        state,
        apiClient: api,
        operation,
        open: async () => null
      });
      (flow as unknown as { rutaOrigen: string }).rutaOrigen = 'origen';
      (flow as unknown as { rutaDestino: string }).rutaDestino = 'destino';

      const ejecucion = flow.ejecutar();
      await Promise.resolve();
      await Promise.resolve();
      assert.equal(consultas, 1);
      assert.equal(telemetria.length, 1);
      (tick as (() => void) | null)?.();
      await Promise.resolve();
      await Promise.resolve();
      assert.equal(telemetria.length, 1, 'los snapshots idénticos se deduplican');

      resolver({
        fase: 'finalizado', total_vms: 2, vms_exitosas: 1,
        vms_con_observaciones: 0, vms_discrepantes: 0, vms_fallidas: 1,
        total_programas: 0, peso_total_gb: 0, duracion_formateada: '1s',
        ruta_informe: 'destino/reporte.json', cancelado: false, metricas: {}
      });
      await ejecucion;
      assert.equal(intervalosLimpios, 1);
      assert.equal(telemetria.length, 2, 'el resultado final actualiza la telemetría');
      flow.dispose();
      assert.equal(intervalosLimpios, 1, 'no queda un intervalo activo al desmontar');
    } finally {
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    }
  });

  it('actualiza el progreso del Reporte con snapshots numéricos y textuales hasta 100%', async () => {
    const operation = new OperationState();
    const state = new AppState(new MemoryStorage());
    const progreso: number[] = [];
    const etapas: string[] = [];
    const estados: boolean[] = [];
    const informe = {} as any;
    let resolverInforme: (value: any) => void = () => {};
    const inspeccion = new Promise<any>((resolve) => { resolverInforme = resolve; });
    const snapshots = [0, 25, 50, 75, 100];
    let consultas = 0;
    let intervalActivo = false;
    let tick: (() => void) | null = null;
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    globalThis.setInterval = ((callback: () => void) => {
      tick = callback;
      intervalActivo = true;
      return 1;
    }) as unknown as typeof setInterval;
    globalThis.clearInterval = (() => { intervalActivo = false; }) as typeof clearInterval;

    const ui = {
      btnIniciarReporte: new FakeElement(),
      btnSeleccionarDiscoReporte: new FakeElement(),
      btnExportarReporte: new FakeElement(),
      setEstadoReporte: (active: boolean) => estados.push(active),
      actualizarProgresoReporte: (value: { porcentaje: number; etapa: string }) => {
        progreso.push(value.porcentaje);
        etapas.push(value.etapa);
      },
      renderInformeDirecto: () => {},
      mostrarErrorReporte: (error: unknown) => { throw error; }
    } as never;
    const api = {
      inspeccionarDisco: () => inspeccion,
      inspectionProgress: async () => {
        const percentage = snapshots[Math.min(consultas++, snapshots.length - 1)];
        return { percentage: String(percentage), completed_tasks: 0, total_tasks: 0,
          stage_id: 1, bytes_processed: '0', total_bytes: '0', cancelled: false
        } as unknown as InspectionProgress;
      }
    } as unknown as AppApi;

    try {
      const flow = new ReporteFlow({
        ui,
        state,
        apiClient: api,
        operation,
        open: async () => null
      });
      (flow as unknown as { rutaDisco: string }).rutaDisco = 'disk.vmdk';
      const ejecucion = flow.ejecutar();
      await Promise.resolve();
      await Promise.resolve();
      for (let indice = 1; indice < snapshots.length; indice += 1) {
        (tick as (() => void) | null)?.();
        await Promise.resolve();
        await Promise.resolve();
      }
      resolverInforme(informe);
      await ejecucion;

      assert.deepEqual(progreso, [0, 0, 25, 50, 75, 100, 100]);
      assert.equal(progreso.at(-1), 100);
      assert.ok(etapas.includes('Reporte completado'));
      assert.deepEqual(estados, [true, false]);
      assert.equal(intervalActivo, false, 'el polling termina al completar la operación');
      assert.equal(consultas, snapshots.length);
    } finally {
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    }
  });

  it('muestra errores del Reporte y limpia el polling', async () => {
    const operation = new OperationState();
    const state = new AppState(new MemoryStorage());
    let errorMostrado: unknown = null;
    let tick: (() => void) | null = null;
    let intervalActivo = false;
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    globalThis.setInterval = ((callback: () => void) => {
      tick = callback;
      intervalActivo = true;
      return 1;
    }) as unknown as typeof setInterval;
    globalThis.clearInterval = (() => { intervalActivo = false; }) as typeof clearInterval;
    const ui = {
      btnIniciarReporte: new FakeElement(),
      btnSeleccionarDiscoReporte: new FakeElement(),
      btnExportarReporte: new FakeElement(),
      setEstadoReporte: () => {},
      actualizarProgresoReporte: () => {},
      renderInformeDirecto: () => {},
      mostrarErrorReporte: (error: unknown) => { errorMostrado = error; }
    } as never;
    const failure = new Error('disco ilegible');
    const api = {
      inspeccionarDisco: async () => { throw failure; },
      inspectionProgress: async () => ({ percentage: '25', stage_id: 2 }) as unknown as InspectionProgress
    } as unknown as AppApi;

    try {
      const flow = new ReporteFlow({ ui, state, apiClient: api, operation, open: async () => null });
      (flow as unknown as { rutaDisco: string }).rutaDisco = 'broken.vmdk';
      await flow.ejecutar();
      (tick as (() => void) | null)?.();
      assert.equal(errorMostrado, failure);
      assert.equal(intervalActivo, false);
      assert.equal(operation.busy, false);
    } finally {
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    }
  });

  it('no vuelve a consultar progreso después de desmontar Reporte', async () => {
    const operation = new OperationState();
    const state = new AppState(new MemoryStorage());
    let resolverInforme: (value: any) => void = () => {};
    const inspeccion = new Promise<any>((resolve) => { resolverInforme = resolve; });
    let consultas = 0;
    let tick: (() => void) | null = null;
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    globalThis.setInterval = ((callback: () => void) => {
      tick = callback;
      return 1;
    }) as unknown as typeof setInterval;
    globalThis.clearInterval = (() => {}) as typeof clearInterval;
    const ui = {
      btnIniciarReporte: new FakeElement(),
      btnSeleccionarDiscoReporte: new FakeElement(),
      btnExportarReporte: new FakeElement(),
      setEstadoReporte: () => {},
      actualizarProgresoReporte: () => {},
      renderInformeDirecto: () => {},
      mostrarErrorReporte: () => {}
    } as never;
    const api = {
      inspeccionarDisco: () => inspeccion,
      inspectionProgress: async () => {
        consultas += 1;
        return { percentage: 10, stage_id: 1 } as unknown as InspectionProgress;
      }
    } as unknown as AppApi;

    try {
      const flow = new ReporteFlow({ ui, state, apiClient: api, operation, open: async () => null });
      (flow as unknown as { rutaDisco: string }).rutaDisco = 'disk.vmdk';
      const ejecucion = flow.ejecutar();
      await Promise.resolve();
      await Promise.resolve();
      flow.dispose();
      (tick as (() => void) | null)?.();
      assert.equal(consultas, 1);
      resolverInforme({} as any);
      await ejecucion;
    } finally {
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    }
  });

  it('normaliza las selecciones del proveedor de archivos', async () => {
    const folderOptions: OpenFolderOptions[] = [];
    const folderOpen: OpenFolder = async (options) => {
      folderOptions.push(options);
      return ['abstract-folder'];
    };
    const fileOptions: OpenFolderOptions[] = [];
    const fileOpen: OpenFolder = async (options) => {
      fileOptions.push(options);
      return 'abstract-file.json';
    };

    assert.equal(await seleccionarCarpeta(folderOpen, 'Folder'), 'abstract-folder');
    assert.equal(
      await seleccionarArchivo(fileOpen, 'File', [{ name: 'JSON', extensions: ['json'] }]),
      'abstract-file.json'
    );
    assert.deepEqual(folderOptions[0], {
      directory: true,
      multiple: false,
      title: 'Folder'
    });
    assert.deepEqual(fileOptions[0], {
      directory: false,
      multiple: false,
      title: 'File',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
  });

  it('mantiene las utilidades de presentación libres de dependencias del entorno', () => {
    assert.equal(sanitizarTexto('  Example  '), 'Example');
    assert.equal(sanitizarTexto('undefined'), null);
    assert.equal(escapeHtml('<tag attr="x">'), '&lt;tag attr=&quot;x&quot;&gt;');

    assert.deepEqual(extraerInfoDisco('/portable/data'), {
      disco: 'Unidad Local',
      ubicacion: '/portable/data'
    });
    assert.equal(formatearBytes(1024 * 1024), '1.0 MB');
    assert.equal(formatearBytes('not-a-number'), '0 B');
  });

  it('deriva el responsable del nombre del reporte y lo usa como fallback de tarjeta', () => {
    assert.equal(deducirResponsableDesdeArchivo('C:\\reportes\\juan_perez.json'), 'juan perez');
    assert.equal(deducirResponsableDesdeArchivo('sin_guiones_bajos.json'), 'sin guiones bajos');
    assert.equal(deducirResponsableDesdeArchivo('reporte.JSON'), 'reporte');
    assert.equal(deducirResponsableDesdeArchivo(''), null);

    const ui = new UIManager({ documentRef: null });
    const tarjeta = ui.crearTarjeta({
      nombre_programa: 'Editor',
      nombre_vm: 'vm-a',
      ruta_carpeta: '/vms/vm-a',
      archivo_json: 'juan_perez.json',
      tipo: 'Operaciones'
    });

    assert.ok(tarjeta.includes('Responsable:</strong> juan perez'));
    assert.ok(tarjeta.includes('Operaciones'));
    assert.ok(!/Abrir carpeta|btn-abrir-ubicacion|Asignado|Elemento/.test(tarjeta));

    const grupos = agruparCoincidenciasPorTipo([
      { nombre_programa: 'A', tipo: 'Pruebas' },
      { nombre_programa: 'B', tipo: 'Operaciones' },
      { nombre_programa: 'C', tipo: 'Pruebas' }
    ]);
    assert.deepEqual(grupos.map(([tipo, coincidencias]) => [tipo, coincidencias.length]), [
      ['Operaciones', 1],
      ['Pruebas', 2]
    ]);

    const cards = new FakeElement();
    ui.consultorCardsWrapper = cards;
    ui.renderTarjetas([{ nombre_programa: 'A', tipo: 'Pruebas' }, { nombre_programa: 'B', tipo: 'Operaciones' }]);
    assert.ok(cards.innerHTML.includes('consultor-type-heading">Operaciones'));
    assert.ok(cards.innerHTML.includes('consultor-type-heading">Pruebas'));
  });

  it('aplica el tema mediante el contrato mínimo del botón', () => {
    const button = new FakeElement();
    const theme = new ThemeManager(button);

    assert.equal(theme.aplicarTema('dark'), 'dark');
    assert.equal(button.title, 'Cambiar a Modo Claro');
    assert.equal(button.getAttribute('aria-label'), 'Cambiar a Modo Claro');
    assert.ok(button.innerHTML.includes('Claro'));

    assert.equal(theme.alternar('dark'), 'light');
    assert.equal(button.title, 'Cambiar a Modo Oscuro');
    assert.ok(button.innerHTML.includes('Oscuro'));
  });

  it('conecta filtros de UI con la respuesta abstracta del backend', async () => {
    const storage = new MemoryStorage();
    const state = new AppState(storage);
    state.guardar({ ruta_bd_json: 'reports' });

    const inputPrograma = new FakeElement();
    const inputVm = new FakeElement();
    const inputVersion = new FakeElement();
    const inputResponsable = new FakeElement();
    const selectTipo = new FakeElement();
    inputPrograma.value = '  Example  ';
    inputVm.value = '';
    inputVersion.value = '';
    inputResponsable.value = '';
    selectTipo.value = 'todos';

    const payloads: ConsultarSoftwarePayload[] = [];
    let renderedFilters: Partial<SearchFilters> | undefined;
    let suggestions: unknown[] | undefined;
    const recargando: boolean[] = [];
    const result: ResultadoConsultaSoftware = {
      total_archivos_json: 1,
      total_vms_escaneadas: 1,
      total_programas_indexados: 1,
      programas_disponibles: ['Example'],
      vms_disponibles: ['vm-a'],
      versiones_disponibles: ['1.0'],
      responsables_disponibles: [],
      tipos_disponibles: ['Operaciones'],
      coincidencias: []
    };

    const ui: ConsultorFlowUi = {
      inputBuscarPrograma: inputPrograma,
      inputBuscarVm: inputVm,
      inputBuscarVersion: inputVersion,
      inputBuscarResponsable: inputResponsable,
      selectBuscarTipo: selectTipo,
      btnEjecutarBusquedaSoftware: new FakeElement(),
      btnRecargarSoftware: new FakeElement(),
      btnLimpiarFiltros: new FakeElement(),
      btnLimpiarPrograma: new FakeElement(),
      btnLimpiarVm: new FakeElement(),
      actualizarBotonesLimpieza: () => {},
      poblarSugerenciasSoftware: (programas) => {
        suggestions = programas;
      },
      renderResultadosSoftware: (_value, filters) => {
        renderedFilters = filters;
      },
      setRecargando: (active) => {
        recargando.push(active);
      },
      mostrarError: (error) => {
        throw error;
      }
    };

    const api: ConsultorApi = {
      consultarSoftware: async (payload) => {
        payloads.push(payload);
        return result;
      },

      ventana: {
        minimizar: async () => undefined,
        maximizar: async () => undefined,
        cerrar: async () => undefined
      }
    };

    const flow = new ConsultorFlow({ ui, state, apiClient: api });
    const received = await flow.buscar();

    assert.equal(received, result);
    assert.deepEqual(payloads, [{
      directorio: 'reports',
      filtroPrograma: 'Example',
      filtroVm: null,
      filtroVersion: null,
      filtroTipo: null,
      filtroResponsable: null,
      limiteCoincidencias: 30
    }]);
    assert.equal(suggestions?.[0], 'Example');
    assert.deepEqual(renderedFilters, {
      programa: 'Example',
      vm: '',
      version: '',
      tipo: 'todos',
      responsable: ''
    });
    assert.deepEqual(recargando, [true, false]);
  });
});

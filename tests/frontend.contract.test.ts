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

  deducirResponsableDesdeArchivo,
  escapeHtml,
  extraerInfoDisco,
  formatearBytes,
  calcularHullGrupoConsultor,
  crearModeloGrafoConsultor,
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
  ConsultorViewMode,
  InspectionProgress,
  ResultadoConsultaSoftware,
  SearchFilters
} from '../src/js/types';
import { FakeElement, MemoryStorage } from './support/fakes';

class FakeGraphElement {
  public readonly style = { display: '' };
  public readonly classList = {
    add: (...names: string[]): void => names.forEach((name) => this.classes.add(name)),
    remove: (...names: string[]): void => names.forEach((name) => this.classes.delete(name)),
    contains: (name: string): boolean => this.classes.has(name),
    toggle: (name: string, force?: boolean): boolean => {
      const active = force ?? !this.classes.has(name);
      if (active) this.classes.add(name);
      else this.classes.delete(name);
      return active;
    }
  };
  public readonly children: FakeGraphElement[] = [];
  public clientWidth = 600;
  public hidden = false;
  public textContent: string | null = '';
  public value = '';
  public title = '';
  public disabled = false;
  public checked = false;
  private readonly classes = new Set<string>();
  private readonly attributes = new Map<string, string>();
  private readonly listeners = new Map<string, EventListener[]>();
  private readonly capturedPointers = new Set<number>();
  private content = '';

  constructor(...classes: string[]) {
    this.classList.add(...classes);
  }

  get innerHTML(): string {
    return this.content;
  }

  set innerHTML(value: string) {
    this.content = value;
    this.children.splice(0);
    if (!value.includes('consultor-graph-canvas')) return;

    const svg = new FakeGraphElement('consultor-graph-canvas');
    const background = new FakeGraphElement('consultor-graph-background');
    const viewport = new FakeGraphElement('consultor-graph-viewport');
    const hulls = new FakeGraphElement('consultor-graph-hulls');
    const links = new FakeGraphElement('consultor-graph-links');
    const nodes = new FakeGraphElement('consultor-graph-nodes');
    const hullLabels = new FakeGraphElement('consultor-graph-hull-labels');
    const details = new FakeGraphElement('consultor-graph-detail');
    const card = new FakeGraphElement('consultor-graph-selected-card');
    const reset = new FakeGraphElement('consultor-graph-reset');
    card.hidden = true;
    viewport.append(hulls, links, nodes, hullLabels);
    svg.append(background, viewport);
    this.append(svg, details, card, reset);
  }

  append(...elements: FakeGraphElement[]): void {
    this.children.push(...elements);
  }

  querySelector(selector: string): FakeGraphElement | null {
    const className = selector.startsWith('.') ? selector.slice(1) : '';
    const pending = [...this.children];
    while (pending.length) {
      const element = pending.shift()!;
      if (element.classList.contains(className)) return element;
      pending.push(...element.children);
    }
    return null;
  }

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type);
    if (!listeners) return;
    this.listeners.set(type, listeners.filter((current) => current !== listener));
  }

  dispatch(type: string, event: Record<string, unknown> = {}): void {
    const dispatched = { type, target: this, ...event } as unknown as Event;
    this.listeners.get(type)?.forEach((listener) => listener(dispatched));
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  hasPointerCapture(pointerId: number): boolean {
    return this.capturedPointers.has(pointerId);
  }

  setPointerCapture(pointerId: number): void {
    this.capturedPointers.add(pointerId);
  }

  releasePointerCapture(pointerId: number): void {
    this.capturedPointers.delete(pointerId);
  }

  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return { left: 0, top: 0, width: this.clientWidth, height: 520 };
  }
}

function crearMapaParaPrueba(): {
  graph: FakeGraphElement;
  svg: FakeGraphElement;
  background: FakeGraphElement;
  reset: FakeGraphElement;
  card: FakeGraphElement;
  nodes: FakeGraphElement[];
  restore: () => void;
} {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const previousHTMLElement = Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement');
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: FakeGraphElement });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { createElementNS: () => new FakeGraphElement() }
  });

  const graph = new FakeGraphElement();
  const ui = new UIManager({
    documentRef: { getElementById: (id) => id === 'consultorGraphWrapper' ? graph as never : null }
  });
  ui.seleccionarVistaConsultor('map');
  ui.renderResultadosSoftware({
    total_archivos_json: 1,
    total_vms_escaneadas: 1,
    coincidencias: [{
      nombre_vm: 'VM-01',
      nombre_programa: 'Editor',
      version: '2.0',
      sistema_operativo: 'Linux',
      responsable: 'Equipo de plataforma',
      tipo: 'Productiva',
      categoria: 'Productividad',
      editor: 'Acme'
    }]
  }, { programa: 'Editor' });

  const svg = graph.querySelector('.consultor-graph-canvas');
  const background = graph.querySelector('.consultor-graph-background');
  const reset = graph.querySelector('.consultor-graph-reset');
  const card = graph.querySelector('.consultor-graph-selected-card');
  const nodesLayer = graph.querySelector('.consultor-graph-nodes');
  assert.ok(svg);
  assert.ok(background);
  assert.ok(reset);
  assert.ok(card);
  assert.ok(nodesLayer);
  return {
    graph,
    svg,
    background,
    reset,
    card,
    nodes: nodesLayer.children,
    restore: () => {
      ui.seleccionarVistaConsultor('cards');
      if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
      else delete (globalThis as Record<string, unknown>).document;
      if (previousHTMLElement) Object.defineProperty(globalThis, 'HTMLElement', previousHTMLElement);
      else delete (globalThis as Record<string, unknown>).HTMLElement;
    }
  };
}

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
      filtroResponsable: null,
      criterioAgrupacion: 'categoria'
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

  it('actualiza la telemetría del Analizador una vez por segundo y libera sus intervalos', async () => {
    const storage = new MemoryStorage();
    const state = new AppState(storage);
    const operation = new OperationState();
    const telemetria: InspectionProgress[] = [];
    const ui = {
      sincronizarConfiguracionAnalizador: () => {},
      actualizarPasos: () => {},
      setEstadoAnalizador: () => {},
      actualizarTelemetria: (estado: unknown) => telemetria.push(estado as InspectionProgress),
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
    const intervalos = new Map<number, () => void>();
    const periodos: number[] = [];
    let siguienteIntervalo = 1;
    let intervalosLimpios = 0;
    globalThis.setInterval = ((callback: () => void, periodo: number) => {
      const id = siguienteIntervalo++;
      intervalos.set(id, callback);
      periodos.push(periodo);
      return id;
    }) as unknown as typeof setInterval;
    globalThis.clearInterval = ((id: number) => {
      if (intervalos.delete(id)) intervalosLimpios += 1;
    }) as unknown as typeof clearInterval;

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
      assert.deepEqual(periodos, [400, 1_000]);
      assert.equal(consultas, 1);
      assert.equal(telemetria.length, 1, 'el primer dibujo establece el estado inicial');

      intervalos.get(1)?.();
      await Promise.resolve();
      await Promise.resolve();
      assert.equal(consultas, 2);
      assert.equal(
        telemetria.length,
        1,
        'recibir snapshots no desencadena actualizaciones visuales adicionales'
      );

      intervalos.get(2)?.();
      assert.equal(telemetria.length, 2, 'solo el intervalo visual de un segundo redibuja');

      resolver({
        fase: 'finalizado', total_vms: 2, vms_exitosas: 1,
        vms_con_observaciones: 0, vms_discrepantes: 0, vms_fallidas: 1,
        total_programas: 0, peso_total_gb: 0, duracion_formateada: '1s',
        ruta_informe: 'destino/reporte.json', cancelado: false, metricas: {}
      });
      await ejecucion;
      assert.equal(intervalosLimpios, 2, 'se liberan polling y refresco visual al finalizar');
      assert.equal(intervalos.size, 0);
      flow.dispose();
      assert.equal(intervalosLimpios, 2, 'no intenta liberar temporizadores ya detenidos');
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


    const cards = new FakeElement();
    ui.consultorCardsWrapper = cards;
    ui.renderTarjetas([{ nombre_programa: 'A', tipo: 'Pruebas' }, { nombre_programa: 'B', tipo: 'Operaciones' }]);
    assert.ok(cards.innerHTML.includes('>A</strong>'));
    assert.ok(cards.innerHTML.includes('>B</strong>'));
  });

  it('renderiza grupos del backend y conserva su expansión accesible', () => {
    const ui = new UIManager({ documentRef: null });
    const cards = new FakeElement();
    ui.consultorCardsWrapper = cards;
    const grupo = {
      clave: 'maquina-virtual:vm-01',
      valor: 'VM-01',
      criterio: 'maquina-virtual' as const,
      cantidad_tarjetas: 2,
      resumen: {
        sistemas_operativos: ['Windows 11'],
        responsables: ['Equipo A'],
        categorias: ['Navegadores']
      },
      tarjetas: [
        { nombre_programa: 'Google Chrome 120', nombre_vm: 'VM-01' },
        { nombre_programa: 'Google Chrome 121', nombre_vm: 'VM-01' }
      ]
    };

    ui.renderGrupos([grupo]);
    assert.ok(cards.innerHTML.includes('consultor-group-card'));
    assert.ok(cards.innerHTML.includes('<header class="consultor-group-card-header" data-grupo-toggle="maquina-virtual:vm-01">'));
    assert.ok(cards.innerHTML.includes('aria-expanded="true"'));
    assert.ok(cards.innerHTML.includes('aria-label="2 tarjetas"'));
    assert.equal((cards.innerHTML.match(/<article class="consultor-card">/g) ?? []).length, 2);

    ui.alternarExpansionGrupo('maquina-virtual:vm-01');
    ui.renderGrupos([grupo]);
    assert.ok(cards.innerHTML.includes('aria-expanded="false"'));
    assert.ok(cards.innerHTML.includes('hidden'));

    ui.renderTarjetas([{ nombre_programa: 'Sin agrupar', nombre_vm: 'VM-02' }]);
    assert.ok(cards.innerHTML.includes('Sin agrupar'));
    assert.ok(!cards.innerHTML.includes('consultor-group-card'));
  });

  it('renderiza la tabla con un campo por filtro, conserva vacíos y alterna el orden', () => {
    const table = new FakeElement();
    const cards = new FakeElement();
    const elements = new Map([
      ['consultorTableWrapper', table],
      ['consultorCardsWrapper', cards]
    ]);
    const ui = new UIManager({
      documentRef: { getElementById: (id) => elements.get(id) ?? null }
    });
    ui.seleccionarVistaConsultor('table');
    ui.renderResultadosSoftware({
      total_archivos_json: 1,
      total_vms_escaneadas: 1,
      total_programas_indexados: 4,
      coincidencias: [
        { nombre_programa: 'Beta', nombre_vm: 'vm-b', version: '10', tipo: 'Tipo B', responsable: 'Equipo B' },
        { nombre_programa: 'alpha', nombre_vm: 'vm-a', version: '2', tipo: 'Tipo A', responsable: 'Equipo A' },
        { nombre_programa: 'Sin versión', nombre_vm: 'vm-c', version: null, tipo: 'Tipo C', responsable: null }
      ],
      grupos: null,
      total_coincidencias: 3
    }, { programa: 'software' });

    assert.equal((table.innerHTML.match(/<th scope="col"/g) ?? []).length, 5);
    assert.ok(table.innerHTML.includes('Programa o aplicación'));
    assert.ok(table.innerHTML.includes('Máquina virtual'));
    assert.ok(table.innerHTML.includes('v10'));
    assert.ok(table.innerHTML.includes('v2'));
    assert.ok(table.innerHTML.includes('>—</span>'));
    assert.equal((table.innerHTML.match(/data-consultor-filter=/g) ?? []).length, 13);
    assert.equal((table.innerHTML.match(/data-group-contrast="none"/g) ?? []).length, 3);

    ui.alternarOrdenTabla('version');
    const ascending = table.innerHTML;
    assert.ok(ascending.indexOf('>v2</button>') < ascending.indexOf('>v10</button>'));
    assert.ok(ascending.indexOf('>—</span>') > ascending.indexOf('>v10</button>'));

    ui.alternarOrdenTabla('version');
    const descending = table.innerHTML;
    assert.ok(descending.indexOf('>v10</button>') < descending.indexOf('>v2</button>'));
    assert.ok(descending.includes('aria-sort="desc"'));
  });

  it('mantiene el contraste por grupo en tabla y acepta resultados históricos', () => {
    const table = new FakeElement();
    const cards = new FakeElement();
    const ui = new UIManager({
      documentRef: {
        getElementById: (id) => new Map([
          ['consultorTableWrapper', table],
          ['consultorCardsWrapper', cards]
        ]).get(id) ?? null
      }
    });
    ui.seleccionarVistaConsultor('table');
    ui.renderResultadosSoftware({
      total_archivos_json: 1,
      total_vms_escaneadas: 2,
      total_coincidencias: 3,
      grupos: [
        {
          clave: 'tipo:produccion',
          valor: 'Producción',
          tarjetas: [
            { nombre_programa: 'A', nombre_vm: 'vm-a', tipo: 'Producción' },
            { nombre_programa: 'B', nombre_vm: 'vm-a', tipo: 'Producción' }
          ]
        },
        {
          clave: 'tipo:pruebas',
          valor: 'Pruebas',
          tarjetas: [
            { nombre_programa: 'C', nombre_vm: 'vm-b', tipo: 'Pruebas' }
          ]
        }
      ]
    }, { programa: 'software' });

    assert.equal((table.innerHTML.match(/data-group-contrast="even"/g) ?? []).length, 2);
    assert.equal((table.innerHTML.match(/data-group-contrast="odd"/g) ?? []).length, 1);
    assert.equal((table.innerHTML.match(/data-group-key="tipo:produccion"/g) ?? []).length, 2);
    assert.equal((table.innerHTML.match(/data-group-key="tipo:pruebas"/g) ?? []).length, 1);
    assert.ok(!cards.innerHTML.includes('consultor-group-card'));

    const historical = {
      total_archivos_json: 1,
      total_vms_escaneadas: 1,
      total_coincidencias: 1,
      ['supertarjetas']: [{
        clave: 'tipo:historico',
        valor: 'Histórico',
        tarjetas: [{ nombre_programa: 'Legacy', tipo: 'Histórico' }]
      }]
    } as unknown as ResultadoConsultaSoftware;
    ui.seleccionarVistaConsultor('cards');
    ui.renderResultadosSoftware(historical, { programa: 'legacy' });
    assert.ok(cards.innerHTML.includes('Histórico'));
    assert.ok(cards.innerHTML.includes('consultor-group-card'));
  });

  it('usa la misma colección completa para tarjetas y tabla agrupadas', () => {
    const table = new FakeElement();
    const cards = new FakeElement();
    const elements = new Map([
      ['consultorTableWrapper', table],
      ['consultorCardsWrapper', cards]
    ]);
    const ui = new UIManager({
      documentRef: { getElementById: (id) => elements.get(id) ?? null }
    });
    const resultado: ResultadoConsultaSoftware = {
      total_archivos_json: 1,
      total_vms_escaneadas: 3,
      total_coincidencias: 4,
      total_grupos: 2,
      total_vms_involucradas: 3,
      grupos: [
        {
          clave: 'maquina-virtual:vm-a',
          valor: 'VM-A',
          tarjetas: [
            { nombre_programa: 'Zulu', nombre_vm: 'vm-a' },
            { nombre_programa: 'Alpha', nombre_vm: 'vm-a' }
          ]
        },
        {
          clave: 'maquina-virtual:vm-b',
          valor: 'VM-B',
          tarjetas: [
            { nombre_programa: 'Gamma', nombre_vm: 'vm-b' },
            { nombre_programa: 'Beta', nombre_vm: 'vm-c' }
          ]
        }
      ]
    };

    ui.renderResultadosSoftware(resultado, { programa: 'software' });
    assert.equal((cards.innerHTML.match(/<article class="consultor-card">/g) ?? []).length, 4);
    assert.equal((cards.innerHTML.match(/<section class="consultor-group-card"/g) ?? []).length, 2);

    ui.seleccionarVistaConsultor('table');
    assert.equal((table.innerHTML.match(/data-row-key=/g) ?? []).length, 4);
    assert.equal((table.innerHTML.match(/data-group-contrast="even"/g) ?? []).length, 2);
    assert.equal((table.innerHTML.match(/data-group-contrast="odd"/g) ?? []).length, 2);
    assert.equal((table.innerHTML.match(/data-group-key="maquina-virtual:vm-a"/g) ?? []).length, 2);
    assert.equal((table.innerHTML.match(/data-group-key="maquina-virtual:vm-b"/g) ?? []).length, 2);

    ui.alternarOrdenTabla('programa');
    assert.equal((table.innerHTML.match(/data-row-key=/g) ?? []).length, 4);
    assert.ok(table.innerHTML.indexOf('>Alpha</button>') < table.innerHTML.indexOf('>Zulu</button>'));

    ui.seleccionarVistaConsultor('cards');
    assert.equal((cards.innerHTML.match(/<article class="consultor-card">/g) ?? []).length, 4);
  });

  it('crea el modelo del mapa desde coincidencias completas y consolida relaciones', () => {
    const model = crearModeloGrafoConsultor([
      { nombre_vm: ' VM-A ', ruta_carpeta: ' /vms/a ', nombre_programa: 'Editor', version: '1.0', sistema_operativo: 'Linux', responsable: 'Equipo A' },
      { nombre_vm: 'vm-a', ruta_carpeta: '/VMS/A', nombre_programa: ' editor ', version: ' 1.0 ', categoria: 'Utilidades', editor: 'Acme' },
      { nombre_vm: 'VM-B', nombre_programa: 'Editor', version: '1.0' },
      { nombre_vm: null, nombre_programa: 'Sin VM' },
      { nombre_vm: 'Sin programa', nombre_programa: '   ' }
    ]);

    assert.equal(model.nodes.filter((node) => node.type === 'vm').length, 2);
    assert.equal(model.nodes.filter((node) => node.type === 'software').length, 1);
    assert.equal(model.links.length, 2);
    assert.deepEqual(model.links.map((link) => link.weight).sort(), [1, 2]);
    assert.equal(model.nodes.find((node) => node.type === 'software')?.categoria, 'Utilidades');
    assert.ok(model.nodes.every((node) => node.id.startsWith(`${node.type}:`)));
  });

  it('conserva grupos del backend, asigna nodos compartidos de forma estable y genera hulls válidos', () => {
    const tarjetas = [
      { nombre_vm: 'VM-A', nombre_programa: 'Editor', version: '1' },
      { nombre_vm: 'VM-B', nombre_programa: 'Editor', version: '1' }
    ];
    const model = crearModeloGrafoConsultor(tarjetas, [
      { clave: 'tipo:produccion', valor: 'Producción', criterio: 'tipo', tarjetas: [tarjetas[0], tarjetas[0]] },
      { clave: 'tipo:desarrollo', valor: 'Desarrollo', criterio: 'tipo', tarjetas: [tarjetas[1]] }
    ]);
    const software = model.nodes.find((node) => node.type === 'software');

    assert.equal(model.groups.length, 2);
    assert.deepEqual(model.groups.map((group) => group.label), ['Tipo: Desarrollo', 'Tipo: Producción']);
    assert.equal(software?.groupKey, 'tipo:produccion');
    const tied = crearModeloGrafoConsultor([tarjetas[0]], [
      { clave: 'zeta', valor: 'Zeta', criterio: 'tipo', tarjetas: [tarjetas[0]] },
      { clave: 'alfa', valor: 'Alfa', criterio: 'tipo', tarjetas: [tarjetas[0]] }
    ]);
    assert.equal(tied.nodes.find((node) => node.type === 'software')?.groupKey, 'alfa');
    assert.equal(model.nodes.filter((node) => node.type === 'software').length, 1);
    assert.ok(model.groups.every((group) => group.nodeIds.length > 0));

    const single = model.nodes.slice(0, 1);
    const pair = model.nodes.slice(0, 2);
    single[0].x = 120;
    single[0].y = 90;
    pair.forEach((node, index) => { node.x = 120 + index * 100; node.y = 90; });
    const singleHull = calcularHullGrupoConsultor(single);
    const pairHull = calcularHullGrupoConsultor(pair);
    assert.ok(singleHull?.path.endsWith(' Z'));
    assert.ok(pairHull?.path.endsWith(' Z'));
    assert.equal(singleHull?.path.includes('NaN'), false);
    assert.equal(pairHull?.path.includes('NaN'), false);

    const ungrouped = crearModeloGrafoConsultor(tarjetas, [{
      clave: 'sin-agrupar', valor: 'Sin agrupar', criterio: 'sin-agrupar', tarjetas
    }]);
    assert.equal(ungrouped.groups.length, 0);
    assert.ok(ungrouped.nodes.every((node) => node.groupKey === null));
  });

  it('activa Mapa con resultados agrupados y limpia el gráfico en estados vacíos', () => {
    const mapMode: ConsultorViewMode = 'map';
    assert.equal(mapMode, 'map');
    const cards = new FakeElement();
    const table = new FakeElement();
    const graph = new FakeElement();
    const cardsButton = new FakeElement();
    const tableButton = new FakeElement();
    const mapButton = new FakeElement();
    const empty = new FakeElement();
    const elements = new Map([
      ['consultorCardsWrapper', cards],
      ['consultorTableWrapper', table],
      ['consultorGraphWrapper', graph],
      ['btnConsultorVistaTarjetas', cardsButton],
      ['btnConsultorVistaTabla', tableButton],
      ['btnConsultorVistaMapa', mapButton],
      ['consultorEmptyState', empty]
    ]);
    const ui = new UIManager({ documentRef: { getElementById: (id) => elements.get(id) ?? null } });
    ui.seleccionarVistaConsultor('map');
    ui.renderResultadosSoftware({
      total_archivos_json: 1,
      total_vms_escaneadas: 2,
      grupos: [{
        clave: 'categoria:utilidades',
        valor: 'Utilidades',
        criterio: 'categoria',
        tarjetas: [
          { nombre_vm: 'VM-A', nombre_programa: 'Editor', version: '1' },
          { nombre_vm: 'VM-B', nombre_programa: 'Editor', version: '1' }
        ]
      }]
    }, { programa: 'editor' });

    assert.equal(ui.consultorViewMode, 'map');
    assert.equal(mapButton.getAttribute('aria-pressed'), 'true');
    assert.equal(cardsButton.getAttribute('aria-pressed'), 'false');
    assert.equal(tableButton.getAttribute('aria-pressed'), 'false');
    assert.ok(graph.innerHTML.includes('consultor-graph-canvas'));
    assert.ok(graph.innerHTML.includes('data-graph-node-count="3"'));
    assert.ok(graph.innerHTML.includes('data-graph-group-count="1"'));
    assert.equal(graph.style.display, 'block');

    ui.seleccionarVistaConsultor('table');
    assert.equal(mapButton.getAttribute('aria-pressed'), 'false');
    assert.equal(tableButton.getAttribute('aria-pressed'), 'true');
    assert.equal(graph.innerHTML, '');
    ui.seleccionarVistaConsultor('map');
    ui.renderResultadosSoftware({ total_archivos_json: 1, total_vms_escaneadas: 2, coincidencias: [] }, { programa: 'editor' });
    assert.equal(graph.innerHTML, '');
    assert.equal(graph.style.display, 'none');
    assert.equal(empty.style.display, 'flex');
  });

  it('selecciona un nodo con click izquierdo y muestra su tarjeta debajo del mapa', () => {
    const fixture = crearMapaParaPrueba();
    try {
      const node = fixture.nodes[0];
      node.dispatch('pointerdown', { button: 0, pointerId: 1, clientX: 120, clientY: 180, preventDefault: () => {} });
      node.dispatch('pointerup', { button: 0, pointerId: 1, clientX: 120, clientY: 180 });

      assert.equal(fixture.card.hidden, false);
      assert.ok(fixture.card.innerHTML.includes('VM-01'));
      assert.ok(fixture.card.innerHTML.includes('Sistema operativo'));
      assert.ok(fixture.card.innerHTML.includes('Equipo de plataforma'));
      assert.ok(fixture.card.innerHTML.includes('Relaciones directas'));
      assert.ok(fixture.card.innerHTML.includes('Editor'));
      assert.ok(fixture.card.innerHTML.includes('data-consultor-filter-value="Editor"'));
    } finally {
      fixture.restore();
    }
  });

  it('no selecciona un nodo al arrastrarlo más de cuatro píxeles', () => {
    const fixture = crearMapaParaPrueba();
    try {
      const node = fixture.nodes[0];
      node.dispatch('pointerdown', { button: 0, pointerId: 1, clientX: 120, clientY: 180, preventDefault: () => {} });
      node.dispatch('pointermove', { pointerId: 1, clientX: 125, clientY: 180 });
      node.dispatch('pointerup', { button: 0, pointerId: 1, clientX: 125, clientY: 180 });

      assert.equal(fixture.card.hidden, true);
      assert.equal(fixture.card.innerHTML, '');
    } finally {
      fixture.restore();
    }
  });

  it('conserva la selección al navegar el mapa y la restablece solo con el botón', () => {
    const fixture = crearMapaParaPrueba();
    try {
      const node = fixture.nodes[0];
      node.dispatch('pointerdown', { button: 0, pointerId: 1, clientX: 120, clientY: 180, preventDefault: () => {} });
      node.dispatch('pointerup', { button: 0, pointerId: 1, clientX: 120, clientY: 180 });
      const selectedContent = fixture.card.innerHTML;

      fixture.svg.dispatch('pointerdown', {
        target: fixture.background,
        button: 0,
        pointerId: 2,
        clientX: 200,
        clientY: 200,
        preventDefault: () => {}
      });
      fixture.svg.dispatch('pointerup', { button: 0, pointerId: 2 });
      fixture.svg.dispatch('click', { target: fixture.background, button: 0 });
      node.dispatch('pointerdown', { button: 0, pointerId: 3, clientX: 120, clientY: 180, preventDefault: () => {} });
      node.dispatch('pointerup', { button: 0, pointerId: 3, clientX: 120, clientY: 180 });

      assert.equal(fixture.card.hidden, false);
      assert.equal(fixture.card.innerHTML, selectedContent);

      fixture.reset.dispatch('click');
      assert.equal(fixture.card.hidden, true);
      assert.equal(fixture.card.innerHTML, '');
    } finally {
      fixture.restore();
    }
  });

  it('restablece la selección del mapa con Escape', () => {
    const fixture = crearMapaParaPrueba();
    try {
      fixture.nodes[0].dispatch('keydown', { key: 'Enter', preventDefault: () => {} });
      fixture.graph.dispatch('keydown', { key: 'Escape', preventDefault: () => {} });

      assert.equal(fixture.card.hidden, true);
      assert.equal(fixture.card.innerHTML, '');
    } finally {
      fixture.restore();
    }
  });

  it('ignora el click derecho sobre un nodo del mapa', () => {
    const fixture = crearMapaParaPrueba();
    try {
      const node = fixture.nodes[0];
      node.dispatch('pointerdown', { button: 0, pointerId: 1, clientX: 120, clientY: 180, preventDefault: () => {} });
      node.dispatch('pointerup', { button: 0, pointerId: 1, clientX: 120, clientY: 180 });
      const selectedContent = fixture.card.innerHTML;

      node.dispatch('pointerdown', { button: 2, pointerId: 2, clientX: 120, clientY: 180 });
      node.dispatch('pointerup', { button: 2, pointerId: 2, clientX: 120, clientY: 180 });

      assert.equal(fixture.card.hidden, false);
      assert.equal(fixture.card.innerHTML, selectedContent);
    } finally {
      fixture.restore();
    }
  });

  it('mantiene Enter y Espacio para seleccionar nodos del mapa', () => {
    const fixture = crearMapaParaPrueba();
    try {
      fixture.nodes[0].dispatch('keydown', { key: 'Enter', preventDefault: () => {} });
      assert.equal(fixture.card.hidden, false);
      assert.ok(fixture.card.innerHTML.includes('VM-01'));

      fixture.nodes[1].dispatch('keydown', { key: ' ', preventDefault: () => {} });
      assert.equal(fixture.card.hidden, false);
      assert.ok(fixture.card.innerHTML.includes('Editor'));
    } finally {
      fixture.restore();
    }
  });

  it('renderiza el contenido y la acción de filtro de tarjetas de programa, virtual y asignado', () => {
    const ui = new UIManager({ documentRef: null });
    const programa = ui.crearTarjeta({
      nombre_programa: 'Suite industrial',
      categoria: 'Automatización',
      tags: ['plc', 'scada'],
      editor: 'Acme',
      version: '4.2'
    });
    const virtual = ui.crearTarjeta({
      nombre_vm: 'VM-Producción',
      sistema_operativo: 'Windows 11',
      ruta_carpeta: 'D:/VMs/Producción',
      responsable: 'Equipo OT'
    });
    const asignado = ui.crearTarjeta({ responsable: 'Equipo OT', tipo: 'Área' });

    assert.ok(programa.includes('Suite industrial'));
    assert.ok(programa.includes('Automatización'));
    assert.ok(programa.includes('#plc'));
    assert.ok(programa.includes('Clasificación: Acme'));
    assert.ok(programa.includes('v4.2'));
    assert.ok(virtual.includes('VM-Producción'));
    assert.ok(virtual.includes('Sistema operativo:</strong> Windows 11'));
    assert.ok(virtual.includes('Ubicación:</strong> D:/VMs/Producción'));
    assert.ok(virtual.includes('Asignado:</strong> Equipo OT'));
    assert.ok(asignado.includes('Equipo OT'));
    assert.ok(asignado.includes('Tipo de asignado:</strong> Área'));
    assert.equal((`${programa}${virtual}${asignado}`.match(/>Filtrar solo por<\/button>/g) ?? []).length, 3);
  });

  it('aplica el filtro existente al usar la acción de una tarjeta', () => {
    const cards = new FakeElement();
    const ui = new UIManager({
      documentRef: { getElementById: (id) => id === 'consultorCardsWrapper' ? cards : null }
    });
    const selections: Array<[string, string]> = [];
    ui.onConsultorFilterValueSelected = (field, value) => selections.push([field, value]);
    const action = new FakeElement();
    action.setAttribute('data-consultor-filter', 'responsable');
    action.setAttribute('data-consultor-filter-value', 'Equipo OT');
    let propagationStopped = false;

    cards.dispatch('click', { target: action, stopPropagation: () => { propagationStopped = true; } });

    assert.deepEqual(selections, [['responsable', 'Equipo OT']]);
    assert.equal(propagationStopped, true);
  });

  it('conserva el estado sin resultados al cambiar al modo tabla', () => {
    const table = new FakeElement();
    const empty = new FakeElement();
    const elements = new Map([
      ['consultorTableWrapper', table],
      ['consultorEmptyState', empty]
    ]);
    const ui = new UIManager({
      documentRef: { getElementById: (id) => elements.get(id) ?? null }
    });
    ui.seleccionarVistaConsultor('table');
    ui.renderResultadosSoftware({
      total_archivos_json: 1,
      total_vms_escaneadas: 1,
      total_programas_indexados: 2,
      coincidencias: [],
      total_coincidencias: 0
    }, { programa: 'missing' });

    assert.equal(table.style.display, 'none');
    assert.equal(empty.style.display, 'flex');
    assert.ok(empty.innerHTML.includes('No se encontraron coincidencias'));
  });

  it('aplica el filtro existente al activar una celda de la tabla', () => {
    const table = new FakeElement();
    const elements = new Map([['consultorTableWrapper', table]]);
    const ui = new UIManager({
      documentRef: { getElementById: (id) => elements.get(id) ?? null }
    });
    const selections: Array<[string, string]> = [];
    ui.onConsultorFilterValueSelected = (field, value) => selections.push([field, value]);

    const cell = new FakeElement();
    cell.setAttribute('data-consultor-filter', 'vm');
    cell.setAttribute('data-consultor-filter-value', 'vm-a');
    table.dispatch('click', { target: cell });
    assert.deepEqual(selections, [['vm', 'vm-a']]);

    const emptyCell = new FakeElement();
    emptyCell.setAttribute('data-consultor-filter', 'version');
    emptyCell.setAttribute('data-consultor-filter-value', '');
    table.dispatch('click', { target: emptyCell });
    assert.deepEqual(selections, [['vm', 'vm-a']], 'una celda vacía no dispara un filtro');
  });

  it('conecta la selección de celda con la búsqueda del Consultor', async () => {
    const state = new AppState(new MemoryStorage());
    state.guardar({ ruta_bd_json: 'reports' });
    const vm = new FakeElement();
    const inputPrograma = new FakeElement();
    const inputVersion = new FakeElement();
    const inputResponsable = new FakeElement();
    const tipo = new FakeElement();
    tipo.value = 'todos';
    const payloads: ConsultarSoftwarePayload[] = [];
    const ui: ConsultorFlowUi = {
      inputBuscarPrograma: inputPrograma,
      inputBuscarVm: vm,
      inputBuscarVersion: inputVersion,
      inputBuscarResponsable: inputResponsable,
      selectBuscarTipo: tipo,
      btnEjecutarBusquedaSoftware: new FakeElement(),
      btnRecargarSoftware: new FakeElement(),
      btnLimpiarFiltros: new FakeElement(),
      renderResultadosSoftware: () => {},
      setRecargando: () => {}
    };
    const api: ConsultorApi = {
      consultarSoftware: async (payload) => {
        payloads.push(payload);
        return { total_archivos_json: 1, total_vms_escaneadas: 1, total_coincidencias: 1, coincidencias: [] };
      },
      ventana: {
        minimizar: async () => undefined,
        maximizar: async () => undefined,
        cerrar: async () => undefined
      }
    };
    new ConsultorFlow({ ui, state, apiClient: api });
    ui.onConsultorFilterValueSelected?.('vm', 'vm-a');
    await Promise.resolve();

    assert.equal(vm.value, 'vm-a');
    assert.equal(payloads[0]?.filtroVm, 'vm-a');
    assert.equal(payloads[0]?.filtroPrograma, null);
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
    const selectCriterioAgrupacion = new FakeElement();
    inputPrograma.value = '  Example  ';
    inputVm.value = '';
    inputVersion.value = '';
    inputResponsable.value = '';
    selectTipo.value = 'todos';
    selectCriterioAgrupacion.value = 'maquina-virtual';

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
      selectCriterioAgrupacion,
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
      limiteCoincidencias: 30,
      criterioAgrupacion: 'maquina-virtual'
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

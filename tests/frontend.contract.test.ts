import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANALYZER_CONFIG_DEFAULT,
  CONFIG_DEFAULT,
  ConsultorFlow,
  OperationState,
  AppState,
  crearApi,
  seleccionarArchivo,
  seleccionarCarpeta
} from '../src/js/main';
import {
  deducirEntidadDesdeArchivo,
  escapeHtml,
  extraerInfoDisco,
  formatearBytes,
  sanitizarTexto
} from '../src/js/ui';
import { ThemeManager } from '../src/js/theme';
import type {
  ConsultarSoftwarePayload,
  ConsultorApi,
  ConsultorFlowUi,
  InvokeFunction,
  OpenFolder,
  OpenFolderOptions,
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
      ruta_bd_json: 'reports'
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
      filtroPropietario: null
    };

    await api.obtenerVersion();
    await api.consultarSoftware(payload);
    await api.validarQemu(null);

    assert.deepEqual(calls, [
      { command: 'obtener_version_app' },
      { command: 'consultar_software_en_jsons', args: payload },
      { command: 'validar_binario_qemu', args: { ruta: null } }
    ]);
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
    assert.equal(deducirEntidadDesdeArchivo('group_name.json'), 'group name');
    assert.equal(deducirEntidadDesdeArchivo('reporte.json'), null);
    assert.deepEqual(extraerInfoDisco('/portable/data'), {
      disco: 'Unidad Local',
      ubicacion: '/portable/data'
    });
    assert.equal(formatearBytes(1024 * 1024), '1.0 MB');
    assert.equal(formatearBytes('not-a-number'), '0 B');
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
    const inputPropietario = new FakeElement();
    const selectTipo = new FakeElement();
    inputPrograma.value = '  Example  ';
    inputVm.value = '';
    inputVersion.value = '';
    inputPropietario.value = '';
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
      propietarios_disponibles: [],
      coincidencias: []
    };

    const ui: ConsultorFlowUi = {
      inputBuscarPrograma: inputPrograma,
      inputBuscarVm: inputVm,
      inputBuscarVersion: inputVersion,
      inputBuscarPropietario: inputPropietario,
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
      abrirCarpeta: async () => undefined,
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
      filtroPropietario: null
    }]);
    assert.equal(suggestions?.[0], 'Example');
    assert.deepEqual(renderedFilters, {
      programa: 'Example',
      vm: '',
      version: '',
      tipo: 'todos',
      propietario: ''
    });
    assert.deepEqual(recargando, [true, false]);
  });
});

import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen as tauriListen } from '@tauri-apps/api/event';
import { open as tauriOpen } from '@tauri-apps/plugin-dialog';
import { UIManager } from './ui';
import type {
  AnalyzerConfig,
  AnalyzerConfigPayload,
  AppApi,
  AppConfig,
  ConsultarSoftwarePayload,
  ConsultorApi,
  ConsultorFlowUi,
  DiagnosticoSistema,
  DocumentLike,
  EstadoSupervision,
  InformeDirecto,
  InvokeFunction,
  OpenFolder,
  OpenFolderOptions,
  OperationRecord,
  ProgresoInspeccion,
  RelevamientoPayload,
  ResumenRelevamiento,
  ResultadoConsultaSoftware,
  SearchFilters,
  StorageLike,
  Theme,
  ToolName
} from './types';

export const STORAGE_KEY = 'relevador_vms_config_v4';
export const ANALYZER_STORAGE_KEY = 'relevador_vms_analizador_v1';
export const APP_VERSION_FALLBACK =
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '—';

export const CONFIG_DEFAULT: Readonly<AppConfig> = Object.freeze({
  tema: 'light',
  ruta_bd_json: ''
});

export const ANALYZER_CONFIG_DEFAULT: Readonly<AnalyzerConfig> = Object.freeze({
  max_hilos: 4,
  modo_dump: false,
  incluir_system: false,
  forzar_qemu: false,
  ruta_qemu_nbd: '',
  ruta_reglas: '',
  tamano_chunk_kb: null,
  generar_discrepancias: false,
  habilitar_bitacora: false,
  mostrar_progreso_individual: false,
  nombre_archivo_salida: 'Relevamiento_VMs.json'
});

function normalizarConfiguracionAnalizador(value: unknown): AnalyzerConfig {
  const saved = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
  const numberOr = (candidate: unknown, fallback: number): number => {
    const parsed = Number(candidate);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const textOr = (candidate: unknown, fallback: string): string =>
    typeof candidate === 'string' ? candidate.trim() : fallback;

  return {
    max_hilos: Math.min(32, Math.max(1, Math.round(numberOr(
      saved.max_hilos,
      ANALYZER_CONFIG_DEFAULT.max_hilos
    )))),
    modo_dump: saved.modo_dump === true,
    incluir_system: saved.incluir_system === true,
    forzar_qemu: saved.forzar_qemu === true,
    ruta_qemu_nbd: textOr(saved.ruta_qemu_nbd, ANALYZER_CONFIG_DEFAULT.ruta_qemu_nbd),
    ruta_reglas: textOr(saved.ruta_reglas, ANALYZER_CONFIG_DEFAULT.ruta_reglas),
    tamano_chunk_kb: Number(saved.tamano_chunk_kb) > 0
      ? Number(saved.tamano_chunk_kb)
      : ANALYZER_CONFIG_DEFAULT.tamano_chunk_kb,
    generar_discrepancias: saved.generar_discrepancias === true,
    habilitar_bitacora: saved.habilitar_bitacora === true,
    mostrar_progreso_individual: saved.mostrar_progreso_individual === true,
    nombre_archivo_salida: textOr(
      saved.nombre_archivo_salida,
      ANALYZER_CONFIG_DEFAULT.nombre_archivo_salida
    ) || ANALYZER_CONFIG_DEFAULT.nombre_archivo_salida
  };
}

/**
 * Bloquea operaciones pesadas concurrentes en el frontend.
 * Se conserva como una primitiva pequeña para cualquier operación futura que
 * comparta la bandera de cancelación del backend.
 */
export class OperationState {
  public current: OperationRecord | null = null;

  start(kind: string): boolean {
    if (this.current) return false;
    this.current = { kind, status: 'running' };
    return true;
  }

  markCancelling(kind: string): void {
    if (this.current?.kind === kind) this.current.status = 'cancelling';
  }

  finish(kind?: string): void {
    if (!kind || this.current?.kind === kind) this.current = null;
  }

  isRunning(kind: string): boolean {
    return this.current?.kind === kind && this.current.status === 'running';
  }

  get busy(): boolean {
    return Boolean(this.current);
  }
}

/**
 * Estado de preferencias generales y configuración persistente del Analizador.
 * La configuración del Consultor se mantiene separada de los parámetros del motor.
 */
export class AppState {
  public config: AppConfig;
  private analizador: AnalyzerConfig;
  private readonly storage: StorageLike | null;

  constructor(
    storage: StorageLike | null = typeof localStorage !== 'undefined' ? localStorage : null
  ) {
    this.storage = storage;
    this.config = { ...CONFIG_DEFAULT };
    this.analizador = { ...ANALYZER_CONFIG_DEFAULT };
    this.cargar();
  }

  cargar(): AppConfig {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        const saved = parsed && typeof parsed === 'object'
          ? parsed as Record<string, unknown>
          : {};

        this.config = {
          ...CONFIG_DEFAULT,
          tema: saved.tema === 'dark' ? 'dark' : 'light',
          ruta_bd_json: typeof saved.ruta_bd_json === 'string' ? saved.ruta_bd_json : ''
        };
      }

      const analyzerRaw = this.storage?.getItem(ANALYZER_STORAGE_KEY);
      if (analyzerRaw) {
        const parsed: unknown = JSON.parse(analyzerRaw);
        this.analizador = normalizarConfiguracionAnalizador(parsed);
      }
    } catch (error) {
      console.warn('No se pudo cargar la configuración de VM Inventory:', error);
      this.config = { ...CONFIG_DEFAULT };
      this.analizador = { ...ANALYZER_CONFIG_DEFAULT };
    }
    return this.config;
  }

  guardar(values: Partial<AppConfig> = {}): AppConfig {
    this.config = {
      ...this.config,
      ...(values.tema !== undefined ? { tema: values.tema === 'dark' ? 'dark' : 'light' } : {}),
      ...(values.ruta_bd_json !== undefined
        ? { ruta_bd_json: String(values.ruta_bd_json || '').trim() }
        : {})
    };

    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.config));
    } catch (error) {
      console.warn('No se pudo persistir la configuración general:', error);
    }
    return this.config;
  }

  guardarAnalizador(values: Partial<AnalyzerConfig> = {}): AnalyzerConfig {
    this.analizador = normalizarConfiguracionAnalizador({ ...this.analizador, ...values });
    try {
      this.storage?.setItem(ANALYZER_STORAGE_KEY, JSON.stringify(this.analizador));
    } catch (error) {
      console.warn('No se pudo persistir la configuración del Analizador:', error);
    }
    return this.obtenerConfiguracionAnalizador();
  }

  obtenerConfiguracionAnalizador(): AnalyzerConfig {
    return { ...this.analizador };
  }

  obtenerPayloadAnalizador(): AnalyzerConfigPayload {
    const config = this.analizador;
    return {
      max_hilos: config.max_hilos,
      modo_dump: config.modo_dump,
      incluir_system: config.incluir_system,
      forzar_qemu: config.forzar_qemu,
      ruta_qemu_nbd: config.ruta_qemu_nbd || null,
      ruta_reglas: config.ruta_reglas || null,
      tamano_chunk_kb: config.tamano_chunk_kb,
      generar_discrepancias: config.generar_discrepancias,
      habilitar_bitacora: config.habilitar_bitacora,
      mostrar_progreso_individual: config.mostrar_progreso_individual,
      nombre_archivo_salida: config.nombre_archivo_salida
    };
  }

  restablecer(): AppConfig {
    this.config = { ...CONFIG_DEFAULT };
    this.analizador = { ...ANALYZER_CONFIG_DEFAULT };
    try {
      this.storage?.removeItem(STORAGE_KEY);
      this.storage?.removeItem(ANALYZER_STORAGE_KEY);
    } catch (error) {
      console.warn('No se pudo limpiar la configuración:', error);
    }
    return this.config;
  }
}

/**
 * Frontera pequeña con Tauri. Recibir las funciones permite probar el flujo
 * sin levantar una ventana nativa.
 */
export function crearApi(invoke: InvokeFunction = tauriInvoke as InvokeFunction): AppApi {
  return Object.freeze({
    obtenerVersion: () => invoke<string>('obtener_version_app'),
    procesarRelevamiento: (payload: RelevamientoPayload) => invoke<ResumenRelevamiento>(
      'procesar_relevamiento',
      payload
    ),
    detenerInspeccion: () => invoke<void>('detener_inspeccion'),
    inspeccionarDisco: (rutaDisco: string, configuracion: AnalyzerConfigPayload) =>
      invoke<InformeDirecto>('inspeccionar_disco_vm', {
        rutaDisco,
        configuracion
      }),
    exportarInforme: (rutaDestino: string, informe: InformeDirecto) =>
      invoke<string>('exportar_informe_individual', { rutaDestino, informe }),
    obtenerDiagnostico: () => invoke<DiagnosticoSistema>('obtener_diagnostico'),
    consultarSoftware: (payload: ConsultarSoftwarePayload) => invoke<ResultadoConsultaSoftware>(
      'consultar_software_en_jsons',
      payload
    ),
    abrirCarpeta: (ruta: string) => invoke<void>('abrir_carpeta', { ruta }),
    ventana: Object.freeze({
      minimizar: () => invoke<void>('ventana_minimizar'),
      maximizar: () => invoke<void>('ventana_maximizar_restaurar'),
      cerrar: () => invoke<void>('ventana_cerrar')
    })
  });
}

export const api = crearApi();

export async function seleccionarCarpeta(
  open: OpenFolder = tauriOpen as unknown as OpenFolder,
  title = 'Seleccionar carpeta donde residen los reportes JSON'
): Promise<string | null> {
  const options: OpenFolderOptions = {
    directory: true,
    multiple: false,
    title
  };
  const selected = await open(options);
  if (Array.isArray(selected)) return selected[0] || null;
  return selected || null;
}

export async function seleccionarArchivo(
  open: OpenFolder = tauriOpen as unknown as OpenFolder,
  title = 'Seleccionar archivo',
  filters: OpenFolderOptions['filters'] = []
): Promise<string | null> {
  const options: OpenFolderOptions = {
    directory: false,
    multiple: false,
    title,
    ...(filters.length ? { filters } : {})
  };
  const selected = await open(options);
  if (Array.isArray(selected)) return selected[0] || null;
  return selected || null;
}

const CAMPOS_BUSQUEDA = [
  'inputBuscarPrograma',
  'inputBuscarVm',
  'inputBuscarVersion',
  'inputBuscarPropietario'
] as const;
type CampoBusqueda = typeof CAMPOS_BUSQUEDA[number];
type CampoLimpieza = 'btnLimpiarPrograma' | 'btnLimpiarVm';

interface ConsultorFlowOptions {
  ui: ConsultorFlowUi;
  state: AppState;
  apiClient?: ConsultorApi;
  getDestino?: () => string;
}

/**
 * Flujo de consulta y sincronización de resultados. La clase conserva el
 * debounce y el requestId del flujo original para que una respuesta lenta no
 * sobrescriba una búsqueda posterior.
 */
export class ConsultorFlow {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private requestId = 0;
  private readonly ui: ConsultorFlowUi;
  private readonly state: AppState;
  private readonly api: ConsultorApi;
  private readonly getDestino: () => string;

  constructor({ ui, state, apiClient = api, getDestino = () => '' }: ConsultorFlowOptions) {
    this.ui = ui;
    this.state = state;
    this.api = apiClient;
    this.getDestino = getDestino;
    this.bindEvents();
  }

  private bindEvents(): void {
    this.ui.tabBtnConsultor?.addEventListener('click', () => {
      if (!this.state.config.ruta_bd_json && this.getDestino()) {
        this.state.guardar({ ruta_bd_json: this.getDestino() });
        this.ui.sincronizarAjustes?.(this.state.config);
      }
      void this.buscar();
    });

    this.ui.btnEjecutarBusquedaSoftware?.addEventListener('click', () => {
      void this.buscar();
    });
    this.ui.btnRecargarSoftware?.addEventListener('click', () => {
      void this.buscar();
    });
    this.ui.btnLimpiarFiltros?.addEventListener('click', () => {
      this.ui.limpiarFiltros?.();
      void this.buscar();
    });

    this.ui.btnLimpiarPrograma?.addEventListener('click', () => {
      this.limpiarCampo('inputBuscarPrograma', 'btnLimpiarPrograma');
    });
    this.ui.btnLimpiarVm?.addEventListener('click', () => {
      this.limpiarCampo('inputBuscarVm', 'btnLimpiarVm');
    });

    CAMPOS_BUSQUEDA.forEach((fieldName: CampoBusqueda) => {
      const input = this.ui[fieldName];
      if (!input) return;

      input.addEventListener('input', () => {
        this.ui.actualizarBotonesLimpieza?.();
        this.cancelarDebounce();
        this.timer = setTimeout(() => {
          void this.buscar();
        }, 250);
      });

      input.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault?.();
        this.cancelarDebounce();
        void this.buscar();
      });
    });

    this.ui.selectBuscarTipo?.addEventListener('change', () => {
      void this.buscar();
    });
  }

  private cancelarDebounce(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private limpiarCampo(inputName: CampoBusqueda, buttonName: CampoLimpieza): void {
    const input = this.ui[inputName];
    if (!input) return;
    input.value = '';
    const button = this.ui[buttonName];
    if (button) button.style.display = 'none';
    void this.buscar();
    input.focus?.();
  }

  async buscar(): Promise<ResultadoConsultaSoftware | null> {
    const directorio = this.state.config.ruta_bd_json || this.getDestino();
    const requestId = ++this.requestId;

    if (!directorio) {
      this.ui.renderResultadosSoftware?.(null, {});
      return null;
    }

    const filtros = this.leerFiltros();
    this.ui.setRecargando?.(true);

    try {
      const resultado = await this.api.consultarSoftware({
        directorio,
        filtroPrograma: filtros.programa || null,
        filtroVm: filtros.vm || null,
        filtroVersion: filtros.version || null,
        filtroTipo: filtros.tipo !== 'todos' ? filtros.tipo : null,
        filtroPropietario: filtros.propietario || null
      });

      if (requestId !== this.requestId || !resultado) return resultado;
      this.ui.poblarSugerenciasSoftware?.(
        resultado.programas_disponibles ?? [],
        resultado.vms_disponibles ?? [],
        resultado.versiones_disponibles ?? [],
        resultado.propietarios_disponibles ?? [],
        resultado.asignados_disponibles ?? [],
        resultado.elementos_disponibles ?? []
      );
      this.ui.renderResultadosSoftware?.(resultado, filtros, (path) => this.abrirCarpeta(path));
      return resultado;
    } catch (error) {
      if (requestId === this.requestId) {
        console.error('Error al consultar software:', error);
        this.ui.mostrarError?.(error);
      }
      return null;
    } finally {
      if (requestId === this.requestId) this.ui.setRecargando?.(false);
    }
  }

  leerFiltros(): SearchFilters {
    return {
      programa: this.ui.inputBuscarPrograma?.value.trim() || '',
      vm: this.ui.inputBuscarVm?.value.trim() || '',
      version: this.ui.inputBuscarVersion?.value.trim() || '',
      tipo: this.ui.selectBuscarTipo?.value || 'todos',
      propietario: this.ui.inputBuscarPropietario?.value.trim() || ''
    };
  }

  async abrirCarpeta(path: string): Promise<unknown | null> {
    try {
      return await this.api.abrirCarpeta(path);
    } catch (error) {
      console.error('No se pudo abrir la carpeta de la VM:', error);
      if (typeof alert === 'function') alert(`No se pudo abrir la carpeta de la VM: ${error}`);
      return null;
    }
  }
}

interface AnalizadorFlowOptions {
  ui: UIManager;
  state: AppState;
  apiClient: AppApi;
  operation: OperationState;
  open: OpenFolder;
}

export class AnalizadorFlow {
  private readonly ui: UIManager;
  private readonly state: AppState;
  private readonly api: AppApi;
  private readonly operation: OperationState;
  private readonly open: OpenFolder;
  private rutaOrigen = '';
  private rutaDestino = '';

  constructor({ ui, state, apiClient, operation, open }: AnalizadorFlowOptions) {
    this.ui = ui;
    this.state = state;
    this.api = apiClient;
    this.operation = operation;
    this.open = open;
    this.bindEvents();
    this.ui.sincronizarConfiguracionAnalizador(this.state.obtenerConfiguracionAnalizador());
    this.actualizarPasos();
  }

  private bindEvents(): void {
    this.ui.cardStepOrigen?.addEventListener('click', () => void this.seleccionarOrigen());
    this.ui.cardStepDestino?.addEventListener('click', () => void this.seleccionarDestino());
    this.ui.btnIniciarAccion?.addEventListener('click', () => void this.ejecutar());
    this.ui.inputNombreArchivoSalida?.addEventListener('input', () => {
      this.state.guardarAnalizador({ nombre_archivo_salida: this.ui.inputNombreArchivoSalida?.value || '' });
      this.actualizarPasos();
    });
    this.ui.inputNombreArchivoSalida?.addEventListener('blur', () => {
      let nombre = this.ui.inputNombreArchivoSalida?.value.trim() || 'Relevamiento_VMs.json';
      if (!nombre.toLowerCase().endsWith('.json')) nombre += '.json';
      this.state.guardarAnalizador({ nombre_archivo_salida: nombre });
      this.ui.inputNombreArchivoSalida!.value = nombre;
      this.actualizarPasos();
    });
  }

  private actualizarPasos(): void {
    this.ui.actualizarPasos(
      this.rutaOrigen,
      this.rutaDestino,
      this.state.obtenerConfiguracionAnalizador().nombre_archivo_salida
    );
  }

  private async seleccionarOrigen(): Promise<void> {
    if (this.operation.busy) return;
    try {
      const ruta = await seleccionarCarpeta(this.open, 'Seleccionar directorio origen con máquinas virtuales');
      if (ruta) {
        this.rutaOrigen = ruta;
        this.actualizarPasos();
      }
    } catch (error) {
      this.mostrarError(`No se pudo seleccionar el origen: ${error}`);
    }
  }

  private async seleccionarDestino(): Promise<void> {
    if (this.operation.busy) return;
    try {
      const ruta = await seleccionarCarpeta(this.open, 'Seleccionar directorio donde guardar el reporte JSON');
      if (ruta) {
        this.rutaDestino = ruta;
        if (!this.state.config.ruta_bd_json) {
          this.state.guardar({ ruta_bd_json: ruta });
          this.ui.sincronizarAjustes(this.state.config);
        }
        this.actualizarPasos();
      }
    } catch (error) {
      this.mostrarError(`No se pudo seleccionar el destino: ${error}`);
    }
  }

  async ejecutar(): Promise<ResumenRelevamiento | null> {
    if (this.operation.current?.kind === 'analizador') {
      this.operation.markCancelling('analizador');
      this.ui.setEstadoAnalizador(true, true);
      try {
        await this.api.detenerInspeccion();
      } catch (error) {
        this.mostrarError(`No se pudo cancelar el relevamiento: ${error}`);
        this.ui.setEstadoAnalizador(true);
      }
      return null;
    }
    if (this.operation.busy) return null;
    if (!this.rutaOrigen || !this.rutaDestino) {
      this.mostrarError('Selecciona un directorio de origen y uno de destino antes de iniciar.');
      return null;
    }
    if (!this.operation.start('analizador')) return null;

    const config = this.state.obtenerConfiguracionAnalizador();
    this.ui.setEstadoAnalizador(true);
    try {
      const resumen = await this.api.procesarRelevamiento({
        rutaOrigen: this.rutaOrigen,
        rutaDestino: this.rutaDestino,
        generarDiscrepancias: config.generar_discrepancias,
        configuracion: this.state.obtenerPayloadAnalizador()
      });
      this.ui.renderResumenRelevamiento(resumen);
      return resumen;
    } catch (error) {
      console.error('Error durante el relevamiento:', error);
      this.ui.mostrarErrorAnalizador(error);
      return null;
    } finally {
      this.operation.finish('analizador');
      this.ui.setEstadoAnalizador(false);
      this.actualizarPasos();
    }
  }

  private mostrarError(error: unknown): void {
    console.error(error);
    if (typeof alert === 'function') alert(String(error));
  }
}

interface ReporteFlowOptions {
  ui: UIManager;
  state: AppState;
  apiClient: AppApi;
  operation: OperationState;
  open: OpenFolder;
}

export class ReporteFlow {
  private readonly ui: UIManager;
  private readonly state: AppState;
  private readonly api: AppApi;
  private readonly operation: OperationState;
  private readonly open: OpenFolder;
  private rutaDisco = '';
  private informe: InformeDirecto | null = null;

  constructor({ ui, state, apiClient, operation, open }: ReporteFlowOptions) {
    this.ui = ui;
    this.state = state;
    this.api = apiClient;
    this.operation = operation;
    this.open = open;
    this.bindEvents();
  }

  private bindEvents(): void {
    this.ui.cardStepDiscoReporte?.addEventListener('click', (event) => {
      if (event.target?.closest?.('#btnSeleccionarDiscoReporte')) return;
      void this.seleccionarDisco();
    });
    this.ui.btnSeleccionarDiscoReporte?.addEventListener('click', () => void this.seleccionarDisco());
    this.ui.btnIniciarReporte?.addEventListener('click', () => void this.ejecutar());
    this.ui.btnExportarReporte?.addEventListener('click', () => void this.exportar());
  }

  private async seleccionarDisco(): Promise<void> {
    if (this.operation.busy) return;
    try {
      const ruta = await seleccionarArchivo(
        this.open,
        'Seleccionar disco virtual o reporte JSON de una VM',
        [{
          name: 'Discos y reportes',
          extensions: ['vmdk', 'vdi', 'vhd', 'vhdx', 'qcow2', 'qcow', 'raw', 'img', 'json']
        }]
      );
      if (ruta) {
        this.rutaDisco = ruta;
        this.informe = null;
        this.ui.btnExportarReporte && (this.ui.btnExportarReporte.disabled = true);
        this.ui.setDiscoReporte(ruta);
      }
    } catch (error) {
      this.mostrarError(`No se pudo seleccionar el disco o reporte: ${error}`);
    }
  }

  async ejecutar(): Promise<InformeDirecto | null> {
    if (this.operation.busy || !this.rutaDisco) return null;
    if (!this.operation.start('reporte')) return null;
    this.ui.setEstadoReporte(true);
    this.ui.actualizarProgresoReporte({
      porcentaje: 5,
      etapa: 'Iniciando inspección estática',
      detalle: this.rutaDisco
    });
    try {
      const informe = await this.api.inspeccionarDisco(
        this.rutaDisco,
        this.state.obtenerPayloadAnalizador()
      );
      this.informe = informe;
      this.ui.renderInformeDirecto(informe);
      if (this.ui.btnExportarReporte) this.ui.btnExportarReporte.disabled = false;
      return informe;
    } catch (error) {
      console.error('Error durante la inspección individual:', error);
      this.ui.mostrarErrorReporte(error);
      return null;
    } finally {
      this.operation.finish('reporte');
      this.ui.setEstadoReporte(false);
    }
  }

  private async exportar(): Promise<void> {
    if (!this.informe) return;
    try {
      const carpeta = await seleccionarCarpeta(this.open, 'Seleccionar carpeta donde guardar el reporte');
      if (!carpeta) return;
      const rutaDestino = `${carpeta.replace(/[\\/]$/, '')}/Informe_Inspeccion_VM.json`;
      const mensaje = await this.api.exportarInforme(rutaDestino, this.informe);
      if (typeof alert === 'function') alert(mensaje);
    } catch (error) {
      this.mostrarError(`No se pudo exportar el reporte: ${error}`);
    }
  }

  private mostrarError(error: unknown): void {
    console.error(error);
    if (typeof alert === 'function') alert(String(error));
  }
}

function bindShell(
  ui: UIManager,
  state: AppState,
  flow: ConsultorFlow,
  apiClient: AppApi,
  open: OpenFolder
): void {
  ui.btnToggleTheme?.addEventListener('click', () => {
    const theme: Theme = state.config.tema === 'dark' ? 'light' : 'dark';
    state.guardar({ tema: theme });
    ui.aplicarTema(theme);
  });

  ui.btnWinMinimize?.addEventListener('click', () => void apiClient.ventana.minimizar());
  ui.btnWinMaximize?.addEventListener('click', () => void apiClient.ventana.maximizar());
  ui.btnWinClose?.addEventListener('click', () => void apiClient.ventana.cerrar());

  ui.customTitlebar?.addEventListener('dblclick', (event) => {
    if (event.target?.closest?.('.win-btn, .nav-btn')) return;
    void apiClient.ventana.maximizar();
  });

  ui.btnOpenAjustes?.addEventListener('click', () => {
    ui.abrirModal(ui.herramientaActiva === 'consultor'
      ? ui.modalConfigConsultor
      : ui.modalConfigAnalizador);
  });
  ui.btnCloseConfigConsultor?.addEventListener('click', () => ui.cerrarModal(ui.modalConfigConsultor));
  ui.btnCancelarConfigConsultor?.addEventListener('click', () => ui.cerrarModal(ui.modalConfigConsultor));
  ui.btnCloseConfigAnalizador?.addEventListener('click', () => ui.cerrarModal(ui.modalConfigAnalizador));
  ui.btnCancelarConfigAnalizador?.addEventListener('click', () => ui.cerrarModal(ui.modalConfigAnalizador));

  ui.btnExaminarBdJson?.addEventListener('click', async () => {
    try {
      const path = await seleccionarCarpeta(open, 'Seleccionar carpeta donde residen los reportes JSON');
      if (path && ui.cfgRutaBdJson) ui.cfgRutaBdJson.value = path;
    } catch (error) {
      console.error('No se pudo seleccionar la carpeta de reportes:', error);
      if (typeof alert === 'function') alert(`No se pudo seleccionar la carpeta: ${error}`);
    }
  });

  ui.btnGuardarConfigConsultor?.addEventListener('click', () => {
    state.guardar(ui.leerFormularioConfigConsultor());
    ui.sincronizarAjustes(state.config);
    ui.cerrarModal(ui.modalConfigConsultor);
    void flow.buscar();
  });

  ui.btnExaminarQemu?.addEventListener('click', async () => {
    try {
      const path = await seleccionarArchivo(open, 'Seleccionar ruta de qemu-nbd para vmspect');
      if (path && ui.cfgRutaQemu) ui.cfgRutaQemu.value = path;
    } catch (error) {
      if (typeof alert === 'function') alert(`No se pudo seleccionar qemu-nbd: ${error}`);
    }
  });

  ui.btnExaminarReglas?.addEventListener('click', async () => {
    try {
      const path = await seleccionarArchivo(open, 'Seleccionar archivo de reglas', [
        { name: 'Reglas JSON o TOML', extensions: ['json', 'toml'] }
      ]);
      if (path && ui.cfgRutaReglas) ui.cfgRutaReglas.value = path;
    } catch (error) {
      if (typeof alert === 'function') alert(`No se pudo seleccionar las reglas: ${error}`);
    }
  });


  ui.btnGuardarConfigAnalizador?.addEventListener('click', () => {
    const config = state.guardarAnalizador(ui.leerFormularioConfiguracionAnalizador());
    ui.sincronizarConfiguracionAnalizador(config);
    ui.cerrarModal(ui.modalConfigAnalizador);
  });
}

export interface BootstrapResult {
  api: AppApi;
  flow: ConsultorFlow;
  analyzer: AnalizadorFlow;
  reporte: ReporteFlow;
  operation: OperationState;
  state: AppState;
  ui: UIManager;
}

export interface BootstrapOptions {
  documentRef?: DocumentLike | null;
  storage?: StorageLike | null;
  invoke?: InvokeFunction;
  open?: OpenFolder;
}

export function bootstrap({
  documentRef = typeof document !== 'undefined'
    ? (document as unknown as DocumentLike)
    : null,
  storage,
  invoke = tauriInvoke as InvokeFunction,
  open = tauriOpen as unknown as OpenFolder
}: BootstrapOptions = {}): BootstrapResult | null {
  if (!documentRef) return null;

  const state = new AppState(storage);
  const apiClient = crearApi(invoke);
  const abrirCarpeta = (path: string) => apiClient.abrirCarpeta(path);
  const ui = new UIManager({ documentRef, onAbrirCarpeta: abrirCarpeta });
  const operation = new OperationState();
  const flow = new ConsultorFlow({ ui, state, apiClient });
  const analyzer = new AnalizadorFlow({ ui, state, apiClient, operation, open });
  const reporte = new ReporteFlow({ ui, state, apiClient, operation, open });

  ui.sincronizarAjustes(state.config);
  ui.sincronizarConfiguracionAnalizador(state.obtenerConfiguracionAnalizador());
  ui.aplicarTema(state.config.tema);
  ui.seleccionarPestana('analizador');
  ui.mostrarVersion(APP_VERSION_FALLBACK);
  bindShell(ui, state, flow, apiClient, open);

  void apiClient.obtenerVersion()
    .then((version) => ui.mostrarVersion(version))
    .catch((error) => console.warn('No se pudo obtener la versión desde Tauri:', error));
  void apiClient.obtenerDiagnostico()
    .then((diagnostico) => ui.actualizarDiagnostico(diagnostico))
    .catch((error) => console.warn('Diagnóstico no disponible:', error));
  void tauriListen<EstadoSupervision>('progreso_supervision', (event) => {
    ui.actualizarTelemetria(event.payload);
  }).catch((error) => console.warn('Telemetría no disponible:', error));
  void tauriListen<ProgresoInspeccion>('progreso_inspeccion_directa', (event) => {
    ui.actualizarProgresoReporte(event.payload);
  }).catch((error) => console.warn('Progreso de Reporte no disponible:', error));

  if (state.config.ruta_bd_json) void flow.buscar();

  return { api: apiClient, flow, analyzer, reporte, operation, state, ui };
}

if (typeof document !== 'undefined') bootstrap();

import { invoke as tauriInvoke } from '@tauri-apps/api/core';

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
  InspectionProgress,
  InvokeFunction,
  OpenFolder,
  OpenFolderOptions,
  OperationRecord,

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
  ruta_bd_json: '',
  limite_coincidencias: 30
});

export const ANALYZER_CONFIG_DEFAULT: Readonly<AnalyzerConfig> = Object.freeze({
  max_hilos: 2,
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
          ruta_bd_json: typeof saved.ruta_bd_json === 'string' ? saved.ruta_bd_json : '',
          limite_coincidencias: Math.min(100, Math.max(10, Math.round(Number(saved.limite_coincidencias) || 30)))
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
        : {}),
      ...(values.limite_coincidencias !== undefined
        ? { limite_coincidencias: Math.min(100, Math.max(10, Math.round(Number(values.limite_coincidencias) || 30))) }
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
    inspectionProgress: () => invoke<InspectionProgress>('inspection_progress'),
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
    ventana: Object.freeze({
      minimizar: () => invoke<void>('ventana_minimizar'),
      maximizar: () => invoke<void>('ventana_maximizar_restaurar'),
      cerrar: () => invoke<void>('ventana_cerrar')
    })
  });
}

export const api = crearApi();

/**
 * Normaliza el snapshot IPC antes de usarlo en cálculos o en la UI. Aunque
 * Rust serializa números, esta frontera también tolera respuestas antiguas o
 * adaptadores que entreguen valores numéricos como texto.
 */
export function normalizarInspectionProgress(value: unknown): InspectionProgress {
  const source = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
  const nonNegativeInteger = (candidate: unknown): number => {
    const parsed = Number(candidate);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 0;
  };
  const clampPercentage = (candidate: unknown): number => {
    const parsed = Number(candidate);
    return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : 0;
  };

  return {
    completed_tasks: nonNegativeInteger(source.completed_tasks),
    total_tasks: nonNegativeInteger(source.total_tasks),
    percentage: clampPercentage(source.percentage),
    stage_id: nonNegativeInteger(source.stage_id),
    bytes_processed: nonNegativeInteger(source.bytes_processed),
    total_bytes: nonNegativeInteger(source.total_bytes),
    cancelled: source.cancelled === true || String(source.cancelled).toLowerCase() === 'true'
  };
}

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
  'inputBuscarResponsable'
] as const;
type CampoBusqueda = typeof CAMPOS_BUSQUEDA[number];
type CampoLimpieza = 'btnLimpiarPrograma' | 'btnLimpiarVm' | 'btnLimpiarVersion' | 'btnLimpiarResponsable';

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
    this.ui.btnLimpiarVersion?.addEventListener('click', () => {
      this.limpiarCampo('inputBuscarVersion', 'btnLimpiarVersion');
    });
    this.ui.btnLimpiarResponsable?.addEventListener('click', () => {
      this.limpiarCampo('inputBuscarResponsable', 'btnLimpiarResponsable');
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

    this.ui.consultorActiveFilters?.addEventListener('click', (event) => {
      const chip = event.target?.closest?.('[data-filter-clear]');
      const field = chip?.getAttribute('data-filter-clear');
      if (field) this.limpiarFiltroIndividual(field);
    });
  }

  private limpiarFiltroIndividual(field: string): void {
    if (field === 'programa' && this.ui.inputBuscarPrograma) {
      this.ui.inputBuscarPrograma.value = '';
    } else if (field === 'vm' && this.ui.inputBuscarVm) {
      this.ui.inputBuscarVm.value = '';
    } else if (field === 'tipo') {
      if (this.ui.selectBuscarTipo) this.ui.selectBuscarTipo.value = 'todos';
    } else if (field === 'version' && this.ui.inputBuscarVersion) {
      this.ui.inputBuscarVersion.value = '';
    } else if (field === 'responsable' && this.ui.inputBuscarResponsable) {
      this.ui.inputBuscarResponsable.value = '';
    }
    void this.buscar();
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
        filtroResponsable: filtros.responsable || null,
        limiteCoincidencias: this.state.config.limite_coincidencias
      });

      if (requestId !== this.requestId || !resultado) return resultado;
      this.ui.poblarSugerenciasSoftware?.(
        resultado.programas_disponibles ?? [],
        resultado.vms_disponibles ?? [],
        resultado.versiones_disponibles ?? [],
        resultado.responsables_disponibles ?? []
      );
      this.ui.poblarTipos?.(resultado.tipos_disponibles ?? []);
      // Si una carpeta se eliminó o renombró, el selector descarta el tipo
      // obsoleto y se repite la consulta sin ese filtro.
      if (this.leerFiltros().tipo !== filtros.tipo) return this.buscar();
      this.ui.renderResultadosSoftware?.(resultado, filtros);
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
      responsable: this.ui.inputBuscarResponsable?.value.trim() || ''
    };
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
  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  private progressRequestPending = false;
  private startedAt = 0;
  private lastProgressKey: string | null = null;
  private lastSnapshot: InspectionProgress | null = null;

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

  /** Libera el polling si la vista se desmonta antes de acabar la operación. */
  dispose(): void {
    this.detenerPolling();
  }

  private iniciarPolling(): void {
    this.detenerPolling();
    this.startedAt = performance.now();
    this.lastProgressKey = null;
    this.pollingTimer = setInterval(() => void this.consultarProgreso(), 400);
    void this.consultarProgreso();
  }

  private detenerPolling(): void {
    if (this.pollingTimer !== null) clearInterval(this.pollingTimer);
    this.pollingTimer = null;
    this.progressRequestPending = false;
  }

  private async consultarProgreso(): Promise<void> {
    if (this.progressRequestPending || this.pollingTimer === null) return;
    this.progressRequestPending = true;
    try {
      const snapshot = normalizarInspectionProgress(await this.api.inspectionProgress());
      const key = [
        snapshot.completed_tasks,
        snapshot.total_tasks,
        snapshot.percentage,
        snapshot.stage_id,
        snapshot.bytes_processed,
        snapshot.total_bytes,
        snapshot.cancelled
      ].join(':');
      if (key !== this.lastProgressKey) {
        this.lastProgressKey = key;
        this.lastSnapshot = snapshot;
        this.ui.actualizarTelemetria(this.adaptarProgreso(snapshot));
      }
      if (snapshot.total_tasks > 0 && snapshot.completed_tasks >= snapshot.total_tasks) {
        this.detenerPolling();
      }
    } catch (error) {
      // Un fallo transitorio de IPC no invalida el resultado final del lote.
      console.warn('No se pudo consultar el progreso del relevamiento:', error);
    } finally {
      this.progressRequestPending = false;
    }
  }

  private adaptarProgreso(snapshot: InspectionProgress): EstadoSupervision {
    const elapsedSeconds = Math.max(0, (performance.now() - this.startedAt) / 1000);
    const completed = snapshot.completed_tasks;
    const total = snapshot.total_tasks;
    const speed = elapsedSeconds > 0 ? completed / elapsedSeconds * 60 : 0;
    const eta = speed > 0 && total > completed
      ? `${Math.ceil((total - completed) / speed * 60)}s`
      : null;
    const etapa = snapshot.cancelled ? 'Cancelación solicitada' : `Etapa vmspect ${snapshot.stage_id}`;

    return {
      fase: snapshot.cancelled ? 'cancelado' : 'analizando_v_ms',
      progreso_global: snapshot.percentage,
      mensaje_estado: total > 0
        ? `Imágenes completadas: ${completed} / ${total}.`
        : 'Preparando relevamiento...',
      vms_procesadas: completed,
      total_vms: total,
      // El snapshot de vmspect no separa éxitos y errores durante el lote.
      vms_exitosas: 0,
      vms_con_observaciones: 0,
      vms_discrepantes: 0,
      vms_fallidas: 0,
      tiempo_transcurrido_formateado: `${Math.floor(elapsedSeconds)}s`,
      tiempo_restante_formateado: eta,
      velocidad_vms_minuto: speed,
      vm_actual_indice: 0,
      vm_actual_nombre: null,
      progreso_vm_actual: snapshot.percentage,
      etapa_vm_actual: etapa,
      detalle_vm_actual: null,
      vms_activas: [],
      logs_recientes: [],
      peso_total_procesado_gb: snapshot.bytes_processed / (1024 ** 3)
    };
  }

  private actualizarTelemetriaFinal(resumen: ResumenRelevamiento): void {
    const procesadas = resumen.vms_exitosas + resumen.vms_con_observaciones + resumen.vms_fallidas;
    const snapshot = this.lastSnapshot ?? {
      completed_tasks: procesadas,
      total_tasks: resumen.total_vms,
      percentage: 100,
      stage_id: 0,
      bytes_processed: Math.round(resumen.peso_total_gb * (1024 ** 3)),
      total_bytes: Math.round(resumen.peso_total_gb * (1024 ** 3)),
      cancelled: resumen.cancelado
    };
    const estado = this.adaptarProgreso(snapshot);
    this.ui.actualizarTelemetria({
      ...estado,
      fase: resumen.fase,
      progreso_global: 100,
      mensaje_estado: resumen.cancelado
        ? `Relevamiento cancelado: ${resumen.total_vms} imágenes detectadas.`
        : `Relevamiento finalizado: ${resumen.total_vms} imágenes procesadas.`,
      vms_procesadas: procesadas,
      total_vms: resumen.total_vms,
      vms_exitosas: resumen.vms_exitosas,
      vms_con_observaciones: resumen.vms_con_observaciones,
      vms_discrepantes: resumen.vms_discrepantes,
      vms_fallidas: resumen.vms_fallidas,
      tiempo_transcurrido_formateado: resumen.duracion_formateada,
      tiempo_restante_formateado: null,
      peso_total_procesado_gb: resumen.peso_total_gb
    });
    console.info('Estado final del relevamiento', {
      cancelado: resumen.cancelado,
      total_vms: resumen.total_vms,
      exitosas: resumen.vms_exitosas,
      fallidas: resumen.vms_fallidas
    });
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
    const relevamiento = this.api.procesarRelevamiento({
      rutaOrigen: this.rutaOrigen,
      rutaDestino: this.rutaDestino,
      generarDiscrepancias: config.generar_discrepancias,
      configuracion: this.state.obtenerPayloadAnalizador()
    });
    this.iniciarPolling();
    try {
      const resumen = await relevamiento;
      this.actualizarTelemetriaFinal(resumen);
      const renderStarted = performance.now();
      this.ui.renderResumenRelevamiento(resumen);
      const uiRenderMs = Math.round(performance.now() - renderStarted);
      resumen.metricas.ui_render_ms = uiRenderMs;
      console.info('VM scan timing', {
        ui_render_ms: uiRenderMs,
        total_ms: resumen.metricas.total_ms,
        batch_ms: resumen.metricas.batch_ms
      });
      return resumen;
    } catch (error) {
      console.error('Error durante el relevamiento:', error);
      this.ui.mostrarErrorAnalizador(error);
      return null;
    } finally {
      this.detenerPolling();
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

const REPORTE_POLLING_MS = 250;
const MAX_REPORTE_PROGRESS_ERRORS = 3;

function etapaReporte(stageId: number): string {
  return {
    0: 'Preparando inspección',
    1: 'Detectando imagen de disco',
    2: 'Leyendo particiones',
    3: 'Analizando sistema operativo y software',
    4: 'Finalizando reporte'
  }[stageId] || `Etapa vmspect ${stageId}`;
}

function esSnapshotDeProgreso(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && 'percentage' in value);
}

export class ReporteFlow {
  private readonly ui: UIManager;
  private readonly state: AppState;
  private readonly api: AppApi;
  private readonly operation: OperationState;
  private readonly open: OpenFolder;
  private rutaDisco = '';
  private informe: InformeDirecto | null = null;
  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  private progressRequestPending = false;
  private progressErrors = 0;
  private lastPercentage = 0;
  private disposed = false;

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
    this.ui.cardStepDiscoReporte?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault?.();
      void this.seleccionarDisco();
    });
    this.ui.btnSeleccionarDiscoReporte?.addEventListener('click', () => void this.seleccionarDisco());
    this.ui.btnIniciarReporte?.addEventListener('click', () => void this.ejecutar());
    this.ui.btnExportarReporte?.addEventListener('click', () => void this.exportar());
  }

  private async seleccionarDisco(): Promise<void> {
    if (this.disposed || this.operation.busy) return;
    try {
      const ruta = await seleccionarArchivo(
        this.open,
        'Seleccionar disco virtual o reporte JSON de una VM',
        [{
          name: 'Discos y reportes',
          extensions: ['vmdk', 'vdi', 'vhd', 'vhdx', 'qcow2', 'qcow', 'raw', 'img', 'json']
        }]
      );
      if (ruta && !this.disposed) {
        this.rutaDisco = ruta;
        this.informe = null;
        this.detenerPolling();
        this.ui.setEstadoReporte(false);
        this.ui.btnExportarReporte && (this.ui.btnExportarReporte.disabled = true);
        this.ui.setDiscoReporte(ruta);
      }
    } catch (error) {
      this.mostrarError(`No se pudo seleccionar el disco o reporte: ${error}`);
    }
  }

  /** Detiene el polling cuando la vista deja de existir. */
  dispose(): void {
    this.disposed = true;
    this.detenerPolling();
  }

  private iniciarPolling(): void {
    this.detenerPolling();
    this.progressErrors = 0;
    this.lastPercentage = 0;
    this.pollingTimer = setInterval(() => void this.consultarProgreso(), REPORTE_POLLING_MS);
    void this.consultarProgreso();
  }

  private detenerPolling(): void {
    if (this.pollingTimer !== null) clearInterval(this.pollingTimer);
    this.pollingTimer = null;
    this.progressRequestPending = false;
  }

  private async consultarProgreso(): Promise<void> {
    if (this.disposed || this.progressRequestPending || this.pollingTimer === null) return;
    this.progressRequestPending = true;
    try {
      const raw = await this.api.inspectionProgress();
      if (this.disposed || this.pollingTimer === null) return;
      if (!esSnapshotDeProgreso(raw)) {
        this.progressErrors += 1;
        this.ui.actualizarProgresoReporte({
          porcentaje: this.lastPercentage,
          etapa: 'Progreso no disponible',
          detalle: 'La API no devolvió un porcentaje para esta inspección.'
        });
        if (this.progressErrors >= MAX_REPORTE_PROGRESS_ERRORS) this.detenerPolling();
        return;
      }

      const snapshot = normalizarInspectionProgress(raw);
      this.progressErrors = 0;
      this.lastPercentage = snapshot.percentage;
      this.ui.actualizarProgresoReporte({
        porcentaje: snapshot.percentage,
        etapa: snapshot.cancelled ? 'Inspección cancelada' : etapaReporte(snapshot.stage_id),
        detalle: snapshot.total_tasks > 0
          ? `Tareas completadas: ${snapshot.completed_tasks} / ${snapshot.total_tasks}`
          : snapshot.total_bytes > 0
            ? `Procesado: ${snapshot.bytes_processed} / ${snapshot.total_bytes} bytes`
            : null
      });

      if (snapshot.cancelled || snapshot.percentage >= 100) this.detenerPolling();
    } catch (error) {
      if (!this.disposed) {
        this.progressErrors += 1;
        console.warn('No se pudo consultar el progreso del Reporte:', error);
        this.ui.actualizarProgresoReporte({
          porcentaje: this.lastPercentage,
          etapa: 'Progreso no disponible',
          detalle: 'La inspección continúa, pero la API no está entregando avances.'
        });
        if (this.progressErrors >= MAX_REPORTE_PROGRESS_ERRORS) this.detenerPolling();
      }
    } finally {
      this.progressRequestPending = false;
    }
  }

  async ejecutar(): Promise<InformeDirecto | null> {
    if (this.disposed || this.operation.busy || !this.rutaDisco) return null;
    if (!this.operation.start('reporte')) return null;
    this.ui.setEstadoReporte(true);
    this.ui.actualizarProgresoReporte({
      porcentaje: 0,
      etapa: 'Pendiente',
      detalle: this.rutaDisco
    });

    const inspeccion = this.api.inspeccionarDisco(
      this.rutaDisco,
      this.state.obtenerPayloadAnalizador()
    );
    this.iniciarPolling();

    let completado = false;
    try {
      const informe = await inspeccion;
      if (this.disposed) return null;
      this.informe = informe;
      this.detenerPolling();
      this.ui.actualizarProgresoReporte({
        porcentaje: 100,
        etapa: 'Reporte completado',
        detalle: 'La inspección finalizó correctamente.'
      });
      this.ui.renderInformeDirecto(informe);
      if (this.ui.btnExportarReporte) this.ui.btnExportarReporte.disabled = false;
      completado = true;
      return informe;
    } catch (error) {
      console.error('Error durante la inspección individual:', error);
      if (!this.disposed) {
        this.ui.actualizarProgresoReporte({
          porcentaje: this.lastPercentage,
          etapa: 'Error en la inspección',
          detalle: String(error)
        });
        this.ui.mostrarErrorReporte(error);
      }
      return null;
    } finally {
      this.detenerPolling();
      this.operation.finish('reporte');
      if (!this.disposed) this.ui.setEstadoReporte(false, completado);
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
    ui.abrirModal(
      ui.herramientaActiva === 'consultor' ? ui.modalConfigConsultor : ui.modalConfigAnalizador,
      ui.btnOpenAjustes
    );
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

  ui.btnRestablecerConfigAnalizador?.addEventListener('click', () => {
    ui.restablecerFormularioConfigAnalizador(ANALYZER_CONFIG_DEFAULT);
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
  const ui = new UIManager({ documentRef });
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


  if (state.config.ruta_bd_json) void flow.buscar();

  return { api: apiClient, flow, analyzer, reporte, operation, state, ui };
}

if (typeof document !== 'undefined') bootstrap();

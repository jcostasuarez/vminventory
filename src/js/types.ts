export type Theme = 'light' | 'dark';
export type ToolName = 'analizador' | 'consultor' | 'reporte';

export interface AppConfig {
  tema: Theme;
  ruta_bd_json: string;
  limite_coincidencias: number;
}

export interface AnalyzerConfig {
  max_hilos: number;
  modo_dump: boolean;
  incluir_system: boolean;
  forzar_qemu: boolean;
  ruta_qemu_nbd: string;
  ruta_reglas: string;
  tamano_chunk_kb: number | null;
  generar_discrepancias: boolean;
  habilitar_bitacora: boolean;
  mostrar_progreso_individual: boolean;
  nombre_archivo_salida: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type OperationStatus = 'running' | 'cancelling';

export interface OperationRecord {
  kind: string;
  status: OperationStatus;
}

export interface OperationGate {
  current: OperationRecord | null;
  start(kind: string): boolean;
  markCancelling(kind: string): void;
  finish(kind?: string): void;
  isRunning(kind: string): boolean;
  readonly busy: boolean;
}

export interface DomClassList {
  add(...classes: string[]): void;
  remove(...classes: string[]): void;
  contains(className: string): boolean;
  toggle(className: string, force?: boolean): boolean;
}

export interface DomStyle {
  display: string;
  width?: string;
  pointerEvents?: string;
  opacity?: string;
}

export interface DomEvent {
  type: string;
  target?: DomElementLike | null;
  key?: string;
  bubbles?: boolean;
  preventDefault?: () => void;
  stopPropagation?: () => void;
}

export type DomEventListener = (event: DomEvent) => void;

export interface DomElementLike {
  style: DomStyle;
  classList: DomClassList;
  innerHTML: string;
  textContent: string | null;
  value: string;
  title: string;
  disabled: boolean;
  checked?: boolean;
  addEventListener(type: string, listener: DomEventListener): void;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  removeAttribute(name: string): void;
  hasAttribute(name: string): boolean;
  closest?: (selector: string) => DomElementLike | null;
  focus?: () => void;
  select?: () => void;
}

export interface DocumentLike {
  getElementById(id: string): DomElementLike | null;
  addEventListener?(type: string, listener: DomEventListener): void;
}

export interface SearchFilters {
  programa: string;
  vm: string;
  version: string;
  tipo: string;
  responsable: string;
}

export type ConsultorViewMode = 'cards' | 'table' | 'map';
export type ConsultorTableField = keyof SearchFilters;

export type CriterioAgrupacion =
  | 'sin-agrupar'
  | 'maquina-virtual'
  | 'categoria'
  | 'sistema-operativo'
  | 'responsable'
  | 'tipo';

export interface ConsultarSoftwarePayload {
  directorio: string;
  filtroPrograma: string | null;
  filtroVm: string | null;
  filtroVersion: string | null;
  filtroTipo: string | null;
  filtroResponsable: string | null;
  limiteCoincidencias?: number;
  criterioAgrupacion?: CriterioAgrupacion;
  pagina?: number;
}

export interface CoincidenciaSoftware {
  nombre_programa?: string | null;
  version?: string | null;
  editor?: string | null;
  categoria?: string | null;
  tags?: unknown[] | null;
  nombre_vm?: string | null;
  nombre_interno?: string | null;
  ruta_carpeta?: string | null;
  responsable?: string | null;
  tipo?: string | null;
  sistema_operativo?: string | null;
  peso_gb?: number | null;
  hipervisor?: string | null;
  discrepante?: boolean | null;
  archivo_json?: string | null;
  fecha_relevamiento?: string | null;
}

export interface ResumenGrupoSoftware {
  sistemas_operativos?: unknown[];
  responsables?: unknown[];
  categorias?: unknown[];
}

export interface GrupoSoftware {
  clave?: string | null;
  valor?: string | null;
  criterio?: CriterioAgrupacion | null;
  cantidad_tarjetas?: number | null;
  resumen?: ResumenGrupoSoftware | null;
  tarjetas?: CoincidenciaSoftware[];
}

/** Fila de tabla con identidad de grupo conservada para la presentación. */
export interface ConsultorTableRow {
  item: CoincidenciaSoftware;
  claveGrupo: string | null;
  indiceGrupo: number | null;
}

export interface ResultadoConsultaSoftware {
  total_archivos_json?: number;
  total_vms_escaneadas?: number;
  total_programas_indexados?: number;
  programas_disponibles?: unknown[];
  vms_disponibles?: unknown[];
  versiones_disponibles?: unknown[];
  responsables_disponibles?: unknown[];
  tipos_disponibles?: unknown[];
  categorias_disponibles?: unknown[];
  tags_disponibles?: unknown[];
  coincidencias?: CoincidenciaSoftware[];
  /** El alias histórico se acepta al deserializar; las respuestas nuevas usan `grupos`. */
  grupos?: GrupoSoftware[] | null;
  total_coincidencias?: number;
  total_grupos?: number | null;
  total_vms_involucradas?: number;
}

export interface RelevamientoPayload {
  rutaOrigen: string;
  rutaDestino: string;
  generarDiscrepancias: boolean;
  configuracion: AnalyzerConfigPayload;
}

export interface AnalyzerConfigPayload {
  max_hilos: number;
  modo_dump: boolean;
  incluir_system: boolean;
  forzar_qemu: boolean;
  ruta_qemu_nbd: string | null;
  ruta_reglas: string | null;
  tamano_chunk_kb: number | null;
  generar_discrepancias: boolean;
  habilitar_bitacora: boolean;
  mostrar_progreso_individual: boolean;
  nombre_archivo_salida: string;
}

export interface MetricasRelevamiento {
  discovery_ms: number;
  batch_ms: number;
  summary_mapping_ms: number;
  serialization_ms: number;
  ipc_ms: number;
  store_update_ms: number;
  ui_render_ms: number;
  total_ms: number;
  selected_roots: number;
  discovered_count: number;
  unique_count: number;
  reports_count: number;
  errors_count: number;
  inspections_count: number;
  retries_count: number;
}

export interface ResumenRelevamiento {
  fase: string;
  total_vms: number;
  vms_exitosas: number;
  vms_con_observaciones: number;
  vms_discrepantes: number;
  vms_fallidas: number;
  total_programas: number;
  peso_total_gb: number;
  duracion_formateada: string;
  ruta_informe: string;
  cancelado: boolean;
  metricas: MetricasRelevamiento;
}

export interface VmActiva {
  indice: number;
  nombre_vm: string;
  etapa: string;
  porcentaje: number;
  detalle?: string | null;
}

export interface LogSupervision {
  timestamp: string;
  nivel: string;
  vm: string;
  mensaje: string;
}

export interface EstadoSupervision {
  fase: string;
  progreso_global: number;
  mensaje_estado: string;
  vms_procesadas: number;
  total_vms: number;
  vms_exitosas: number;
  vms_con_observaciones: number;
  vms_discrepantes: number;
  vms_fallidas: number;
  tiempo_transcurrido_formateado: string;
  tiempo_restante_formateado?: string | null;
  velocidad_vms_minuto: number;
  vm_actual_indice: number;
  vm_actual_nombre?: string | null;
  progreso_vm_actual: number;
  etapa_vm_actual: string;
  detalle_vm_actual?: string | null;
  vms_activas: VmActiva[];
  logs_recientes: LogSupervision[];
  peso_total_procesado_gb: number;
}

export interface InspectionProgress {
  completed_tasks: number;
  total_tasks: number;
  percentage: number;
  stage_id: number;
  bytes_processed: number;
  total_bytes: number;
  cancelled: boolean;
}

export interface ProgresoInspeccion {
  porcentaje: number;
  etapa: string;
  detalle?: string | null;
}

export interface ResumenImagen {
  formato: string;
  hipervisor: string;
  tamano_virtual: number;
  tamano_real: number;
}

export interface ResumenEstadisticas {
  modo_acceso: string;
  duracion_ms: number;
  bytes_leidos: number;
  invocaciones_qemu: number;
}

export interface ResumenVmInfo {
  os_nombre: string;
  os_edition_version: string;
  os_build: string;
  os_service_pack: string;
  vmtools_version?: string | null;
  hostname?: string | null;
  arquitectura?: string | null;
}

export interface ResumenParticion {
  indice: number;
  inicio: number;
  tamano: number;
  tipo: string;
  etiqueta?: string | null;
  sistema_archivos: string;
}

export interface ProgramaClasificado {
  nombre: string;
  version?: string | null;
  editor?: string | null;
  categoria?: string | null;
  tags: string[];
  relevante: boolean;
}

export interface InformeDirecto {
  exito: boolean;
  archivo: string;
  imagen: ResumenImagen;
  estadisticas: ResumenEstadisticas;
  vm_info: ResumenVmInfo;
  sistema_operativo: string;
  esquema: string;
  particiones: ResumenParticion[];
  programas: ProgramaClasificado[];
  advertencias: string[];
}

export interface DiagnosticoSistema {
  equipo_ejecucion: string;
  sistema_operativo: string;
  arquitectura: string;
  hilos_cpu: number;
  hilos_recomendados: number;
}

export interface InvokeFunction {
  <T = unknown>(command: string, args?: object): Promise<T>;
}

export interface OpenFileFilter {
  name: string;
  extensions: string[];
}

export interface OpenFolderOptions {
  directory: boolean;
  multiple: boolean;
  title: string;
  filters?: OpenFileFilter[];
}

export type OpenFolder = (
  options: OpenFolderOptions
) => Promise<string | string[] | null>;

export interface WindowApi {
  minimizar(): Promise<unknown>;
  maximizar(): Promise<unknown>;
  cerrar(): Promise<unknown>;
}

export interface ConsultorApi {
  consultarSoftware(payload: ConsultarSoftwarePayload): Promise<ResultadoConsultaSoftware>;
  ventana: WindowApi;
}

export interface AppApi extends ConsultorApi {
  obtenerVersion(): Promise<string>;
  procesarRelevamiento(payload: RelevamientoPayload): Promise<ResumenRelevamiento>;
  inspectionProgress(): Promise<InspectionProgress>;
  detenerInspeccion(): Promise<unknown>;
  inspeccionarDisco(
    rutaDisco: string,
    configuracion: AnalyzerConfigPayload
  ): Promise<InformeDirecto>;
  exportarInforme(rutaDestino: string, informe: InformeDirecto): Promise<string>;
  obtenerDiagnostico(): Promise<DiagnosticoSistema>;
}

export interface ConsultorFlowUi {
  tabBtnConsultor?: DomElementLike | null;
  btnEjecutarBusquedaSoftware?: DomElementLike | null;
  btnRecargarSoftware?: DomElementLike | null;
  btnLimpiarFiltros?: DomElementLike | null;
  btnLimpiarPrograma?: DomElementLike | null;
  btnLimpiarVm?: DomElementLike | null;
  btnLimpiarVersion?: DomElementLike | null;
  btnLimpiarResponsable?: DomElementLike | null;
  inputBuscarPrograma?: DomElementLike | null;
  inputBuscarVm?: DomElementLike | null;
  inputBuscarVersion?: DomElementLike | null;
  inputBuscarResponsable?: DomElementLike | null;
  selectBuscarTipo?: DomElementLike | null;
  selectCriterioAgrupacion?: DomElementLike | null;
  btnToggleTheme?: DomElementLike | null;
  btnWinMinimize?: DomElementLike | null;
  btnWinMaximize?: DomElementLike | null;
  btnWinClose?: DomElementLike | null;
  customTitlebar?: DomElementLike | null;
  btnOpenAjustes?: DomElementLike | null;
  btnCloseConfigConsultor?: DomElementLike | null;
  btnCancelarConfigConsultor?: DomElementLike | null;
  btnGuardarConfigConsultor?: DomElementLike | null;
  btnExaminarBdJson?: DomElementLike | null;
  cfgRutaBdJson?: DomElementLike | null;
  cfgLimiteCoincidencias?: DomElementLike | null;
  consultorActiveFilters?: DomElementLike | null;
  onConsultorFilterValueSelected?: ((field: keyof SearchFilters, value: string) => void) | null;
  actualizarBotonesLimpieza?(): void;
  limpiarFiltros?(): void;
  sincronizarAjustes?(config: AppConfig): void;
  poblarSugerenciasSoftware?(
    programas?: unknown[],
    vms?: unknown[],
    versiones?: unknown[],
    responsables?: unknown[]
  ): void;
  poblarTipos?(tipos?: unknown[]): void;
  renderResultadosSoftware?(
    resultado: ResultadoConsultaSoftware | null,
    filtros?: Partial<SearchFilters>
  ): void;
  mostrarError?(error: unknown): void;
  setRecargando?(active: boolean): void;
  leerFormularioConfigConsultor?(): Partial<AppConfig>;
  abrirModal?(): void;
  cerrarModal?(): void;
  aplicarTema?(theme: Theme): Theme;
  seleccionarPestana?(tool?: ToolName): void;
}

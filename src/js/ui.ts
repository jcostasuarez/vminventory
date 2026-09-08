import { ThemeManager } from './theme';
import type {
  AnalyzerConfig,
  AppConfig,
  CoincidenciaSoftware,
  DiagnosticoSistema,
  DocumentLike,
  DomElementLike,
  EstadoSupervision,
  InformeDirecto,
  ProgresoInspeccion,
  ResumenRelevamiento,
  ResultadoConsultaSoftware,
  SearchFilters,
  Theme,
  ToolName
} from './types';

const MAX_SUGGESTIONS = 200;

export function sanitizarTexto(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text || ['-', 'null', 'undefined'].includes(text.toLowerCase())) return null;
  return text;
}

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#039;',
    '"': '&quot;'
  })[character] ?? character);
}

export function deducirEntidadDesdeArchivo(fileName: unknown): string | null {
  if (!fileName) return null;
  const file = String(fileName).split(/[\\/]/).pop() || '';
  const stem = file.replace(/\.json$/i, '').trim();
  const genericNames = ['reporte', 'informe', 'vms', 'inventario'];
  if (!stem || genericNames.includes(stem.toLowerCase())) return null;
  return stem.replace(/_/g, ' ').trim() || null;
}

export function extraerInfoDisco(path: unknown = ''): { disco: string; ubicacion: string } {
  const value = String(path || '');
  if (!value) return { disco: 'Unidad Local', ubicacion: '' };

  const drive = value.match(/^([a-z]):(?:[\\/]|$)/i);
  if (drive) return { disco: `Disco ${drive[1].toUpperCase()}:`, ubicacion: value };

  const network = value.match(/^\\\\([^\\/]+)/);
  if (network) return { disco: `Red \\\\${network[1]}`, ubicacion: value };

  const mount = value.match(/^(\/(?:mnt|media|Volumes)\/[^/]+)/i);
  if (mount) return { disco: mount[1], ubicacion: value };

  return { disco: 'Unidad Local', ubicacion: value };
}

function uniqueValues(values: unknown[], limit = MAX_SUGGESTIONS): string[] {
  return [...new Set(values.map(sanitizarTexto).filter((value): value is string => Boolean(value)))].slice(0, limit);
}

function formatNumber(value: unknown, fallback = '0'): string {
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : fallback;
}

export function formatearBytes(value: unknown): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const amount = bytes / (1024 ** exponent);
  return `${amount >= 10 || exponent === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[exponent]}`;
}

interface UIManagerOptions {
  documentRef?: DocumentLike | null;
  onAbrirCarpeta?: (path: string) => void;
}

/**
 * Capa de acceso al DOM de las tres herramientas.
 * El flujo de negocio vive en main.ts; esta clase solo lee y pinta la interfaz.
 */
export class UIManager {
  private readonly document: DocumentLike | null | undefined;
  public onAbrirCarpeta: (path: string) => void;
  public ultimoResultado: ResultadoConsultaSoftware | null = null;
  private readonly themeManager: ThemeManager;
  public herramientaActiva: ToolName = 'consultor';
  private ultimoInformeReporte: InformeDirecto | null = null;
  private filtroTextoReporte = '';
  private filtroCategoriaReporte = 'todas';
  private habilitarBitacora = false;
  private mostrarProgresoIndividual = false;

  public customTitlebar: DomElementLike | null = null;
  public btnToggleTheme: DomElementLike | null = null;
  public btnWinMinimize: DomElementLike | null = null;
  public btnWinMaximize: DomElementLike | null = null;
  public btnWinClose: DomElementLike | null = null;
  public btnOpenAjustes: DomElementLike | null = null;
  public appVersion: DomElementLike | null = null;
  public tabBtnAnalizador: DomElementLike | null = null;
  public tabBtnConsultor: DomElementLike | null = null;
  public tabBtnReporte: DomElementLike | null = null;

  public viewAnalizador: DomElementLike | null = null;
  public viewConsultor: DomElementLike | null = null;
  public viewReporte: DomElementLike | null = null;

  public cardStepOrigen: DomElementLike | null = null;
  public lblOrigen: DomElementLike | null = null;
  public cardStepDestino: DomElementLike | null = null;
  public lblDestino: DomElementLike | null = null;
  public cardStepNombreJson: DomElementLike | null = null;
  public inputNombreArchivoSalida: DomElementLike | null = null;
  public btnIniciarAccion: DomElementLike | null = null;
  public lblTitleAccion: DomElementLike | null = null;
  public lblHilosAccion: DomElementLike | null = null;
  public badgeFase: DomElementLike | null = null;
  public lblBigPorcentaje: DomElementLike | null = null;
  public lblProgresoMsg: DomElementLike | null = null;
  public barGlobal: DomElementLike | null = null;
  public statVms: DomElementLike | null = null;
  public statExitosas: DomElementLike | null = null;
  public statObservaciones: DomElementLike | null = null;
  public statTiempo: DomElementLike | null = null;
  public itemEta: DomElementLike | null = null;
  public statEta: DomElementLike | null = null;
  public statVelocidad: DomElementLike | null = null;
  public wrapperWorkers: DomElementLike | null = null;
  public listWorkers: DomElementLike | null = null;
  public wrapperVmIndividual: DomElementLike | null = null;
  public lblVmIndividualTitulo: DomElementLike | null = null;
  public lblVmIndividualPorcentaje: DomElementLike | null = null;
  public barVmIndividual: DomElementLike | null = null;
  public lblVmIndividualEtapa: DomElementLike | null = null;
  public wrapperBitacora: DomElementLike | null = null;
  public logConsole: DomElementLike | null = null;
  public analyzerSummary: DomElementLike | null = null;

  public cardStepDiscoReporte: DomElementLike | null = null;
  public lblDiscoReporteRuta: DomElementLike | null = null;
  public btnSeleccionarDiscoReporte: DomElementLike | null = null;
  public btnIniciarReporte: DomElementLike | null = null;
  public btnExportarReporte: DomElementLike | null = null;
  public wrapperProgresoReporte: DomElementLike | null = null;
  public barProgresoReporte: DomElementLike | null = null;
  public lblPorcentajeReporte: DomElementLike | null = null;
  public lblEtapaReporte: DomElementLike | null = null;
  public lblDetalleReporte: DomElementLike | null = null;
  public containerResultadosReporte: DomElementLike | null = null;
  public reporteWarningsBox: DomElementLike | null = null;
  public reporteEmptyState: DomElementLike | null = null;
  public lblReporteArchivo: DomElementLike | null = null;
  public lblReporteFormato: DomElementLike | null = null;
  public lblReporteHipervisor: DomElementLike | null = null;
  public lblReporteTamanoVirtual: DomElementLike | null = null;
  public lblReporteTamanoReal: DomElementLike | null = null;
  public lblReporteAcceso: DomElementLike | null = null;
  public lblReporteDuracion: DomElementLike | null = null;
  public lblReporteBytesLeidos: DomElementLike | null = null;
  public lblReporteQemuCalls: DomElementLike | null = null;
  public lblReporteSoNombre: DomElementLike | null = null;
  public lblReporteSoDetalles: DomElementLike | null = null;
  public lblReporteVmTools: DomElementLike | null = null;
  public lblReporteEsquema: DomElementLike | null = null;
  public listReporteParticiones: DomElementLike | null = null;
  public inputFiltrarSoftwareReporte: DomElementLike | null = null;
  public selectCategoriaSoftwareReporte: DomElementLike | null = null;
  public lblTotalProgramasReporte: DomElementLike | null = null;
  public tbodySoftwareReporte: DomElementLike | null = null;
  public sysDiagnosticText: DomElementLike | null = null;

  public modalConfigAnalizador: DomElementLike | null = null;
  public btnCloseConfigAnalizador: DomElementLike | null = null;
  public btnCancelarConfigAnalizador: DomElementLike | null = null;
  public btnGuardarConfigAnalizador: DomElementLike | null = null;
  public cfgMaxHilos: DomElementLike | null = null;
  public cfgModoDump: DomElementLike | null = null;
  public cfgIncluirSystem: DomElementLike | null = null;
  public cfgForzarQemu: DomElementLike | null = null;
  public cfgRutaQemu: DomElementLike | null = null;
  public btnExaminarQemu: DomElementLike | null = null;
  public btnValidarQemu: DomElementLike | null = null;
  public lblEstadoValidacionQemu: DomElementLike | null = null;
  public cfgRutaReglas: DomElementLike | null = null;
  public btnExaminarReglas: DomElementLike | null = null;
  public cfgTamanoChunk: DomElementLike | null = null;
  public cfgGenerarDiscrepancias: DomElementLike | null = null;
  public cfgHabilitarBitacora: DomElementLike | null = null;
  public cfgMostrarProgresoIndividual: DomElementLike | null = null;
  public cfgNombreArchivo: DomElementLike | null = null;

  public inputBuscarPrograma: DomElementLike | null = null;
  public inputBuscarVm: DomElementLike | null = null;
  public inputBuscarVersion: DomElementLike | null = null;
  public selectBuscarTipo: DomElementLike | null = null;
  public inputBuscarPropietario: DomElementLike | null = null;
  public btnLimpiarPrograma: DomElementLike | null = null;
  public btnLimpiarVm: DomElementLike | null = null;
  public btnLimpiarFiltros: DomElementLike | null = null;
  public btnEjecutarBusquedaSoftware: DomElementLike | null = null;
  public btnRecargarSoftware: DomElementLike | null = null;
  public datalistProgramas: DomElementLike | null = null;
  public datalistVms: DomElementLike | null = null;
  public datalistVersiones: DomElementLike | null = null;
  public datalistPropietarios: DomElementLike | null = null;
  public lblSoftwareMetricas: DomElementLike | null = null;
  public consultorCardsWrapper: DomElementLike | null = null;
  public consultorEmptyState: DomElementLike | null = null;

  public modalConfigConsultor: DomElementLike | null = null;
  public btnCloseConfigConsultor: DomElementLike | null = null;
  public btnCancelarConfigConsultor: DomElementLike | null = null;
  public btnGuardarConfigConsultor: DomElementLike | null = null;
  public cfgRutaBdJson: DomElementLike | null = null;
  public btnExaminarBdJson: DomElementLike | null = null;

  constructor({
    documentRef = typeof document !== 'undefined'
      ? (document as unknown as DocumentLike)
      : null,
    onAbrirCarpeta = () => {}
  }: UIManagerOptions = {}) {
    this.document = documentRef;
    this.onAbrirCarpeta = onAbrirCarpeta;
    this.initElements();
    this.themeManager = new ThemeManager(this.btnToggleTheme);
    this.bindEvents();
  }

  private initElements(): void {
    const get = (id: string): DomElementLike | null => this.document?.getElementById(id) ?? null;

    this.customTitlebar = get('customTitlebar');
    this.btnToggleTheme = get('btnToggleTheme');
    this.btnWinMinimize = get('btnWinMinimize');
    this.btnWinMaximize = get('btnWinMaximize');
    this.btnWinClose = get('btnWinClose');
    this.btnOpenAjustes = get('btnOpenAjustes');
    this.appVersion = get('appVersion');
    this.tabBtnAnalizador = get('tabBtnAnalizador');
    this.tabBtnConsultor = get('tabBtnConsultor');
    this.tabBtnReporte = get('tabBtnReporte');

    this.viewAnalizador = get('viewAnalizador');
    this.viewConsultor = get('viewConsultor');
    this.viewReporte = get('viewReporte');

    this.cardStepOrigen = get('cardStepOrigen');
    this.lblOrigen = get('lblOrigen');
    this.cardStepDestino = get('cardStepDestino');
    this.lblDestino = get('lblDestino');
    this.cardStepNombreJson = get('cardStepNombreJson');
    this.inputNombreArchivoSalida = get('inputNombreArchivoSalida');
    this.btnIniciarAccion = get('btnIniciarAccion');
    this.lblTitleAccion = get('lblTitleAccion');
    this.lblHilosAccion = get('lblHilosAccion');
    this.badgeFase = get('badgeFase');
    this.lblBigPorcentaje = get('lblBigPorcentaje');
    this.lblProgresoMsg = get('lblProgresoMsg');
    this.barGlobal = get('barGlobal');
    this.statVms = get('statVms');
    this.statExitosas = get('statExitosas');
    this.statObservaciones = get('statObservaciones');
    this.statTiempo = get('statTiempo');
    this.itemEta = get('itemEta');
    this.statEta = get('statEta');
    this.statVelocidad = get('statVelocidad');
    this.wrapperWorkers = get('wrapperWorkers');
    this.listWorkers = get('listWorkers');
    this.wrapperVmIndividual = get('wrapperVmIndividual');
    this.lblVmIndividualTitulo = get('lblVmIndividualTitulo');
    this.lblVmIndividualPorcentaje = get('lblVmIndividualPorcentaje');
    this.barVmIndividual = get('barVmIndividual');
    this.lblVmIndividualEtapa = get('lblVmIndividualEtapa');
    this.wrapperBitacora = get('wrapperBitacora');
    this.logConsole = get('logConsole');
    this.analyzerSummary = get('analyzerSummary');
    this.sysDiagnosticText = get('sysDiagnosticText');

    this.cardStepDiscoReporte = get('cardStepDiscoReporte');
    this.lblDiscoReporteRuta = get('lblDiscoReporteRuta');
    this.btnSeleccionarDiscoReporte = get('btnSeleccionarDiscoReporte');
    this.btnIniciarReporte = get('btnIniciarReporte');
    this.btnExportarReporte = get('btnExportarReporte');
    this.wrapperProgresoReporte = get('wrapperProgresoReporte');
    this.barProgresoReporte = get('barProgresoReporte');
    this.lblPorcentajeReporte = get('lblPorcentajeReporte');
    this.lblEtapaReporte = get('lblEtapaReporte');
    this.lblDetalleReporte = get('lblDetalleReporte');
    this.containerResultadosReporte = get('containerResultadosReporte');
    this.reporteWarningsBox = get('reporteWarningsBox');
    this.reporteEmptyState = get('reporteEmptyState');
    this.lblReporteArchivo = get('lblReporteArchivo');
    this.lblReporteFormato = get('lblReporteFormato');
    this.lblReporteHipervisor = get('lblReporteHipervisor');
    this.lblReporteTamanoVirtual = get('lblReporteTamanoVirtual');
    this.lblReporteTamanoReal = get('lblReporteTamanoReal');
    this.lblReporteAcceso = get('lblReporteAcceso');
    this.lblReporteDuracion = get('lblReporteDuracion');
    this.lblReporteBytesLeidos = get('lblReporteBytesLeidos');
    this.lblReporteQemuCalls = get('lblReporteQemuCalls');
    this.lblReporteSoNombre = get('lblReporteSoNombre');
    this.lblReporteSoDetalles = get('lblReporteSoDetalles');
    this.lblReporteVmTools = get('lblReporteVmTools');
    this.lblReporteEsquema = get('lblReporteEsquema');
    this.listReporteParticiones = get('listReporteParticiones');
    this.inputFiltrarSoftwareReporte = get('inputFiltrarSoftwareReporte');
    this.selectCategoriaSoftwareReporte = get('selectCategoriaSoftwareReporte');
    this.lblTotalProgramasReporte = get('lblTotalProgramasReporte');
    this.tbodySoftwareReporte = get('tbodySoftwareReporte');
    this.inputBuscarPrograma = get('inputBuscarPrograma');
    this.inputBuscarVm = get('inputBuscarVm');
    this.inputBuscarVersion = get('inputBuscarVersion');
    this.selectBuscarTipo = get('selectBuscarTipo');
    this.inputBuscarPropietario = get('inputBuscarPropietario');
    this.btnLimpiarPrograma = get('btnLimpiarPrograma');
    this.btnLimpiarVm = get('btnLimpiarVm');
    this.btnLimpiarFiltros = get('btnLimpiarFiltros');
    this.btnEjecutarBusquedaSoftware = get('btnEjecutarBusquedaSoftware');
    this.btnRecargarSoftware = get('btnRecargarSoftware');
    this.datalistProgramas = get('datalistProgramas');
    this.datalistVms = get('datalistVms');
    this.datalistVersiones = get('datalistVersiones');
    this.datalistPropietarios = get('datalistPropietarios');
    this.lblSoftwareMetricas = get('lblSoftwareMetricas');
    this.consultorCardsWrapper = get('consultorCardsWrapper');
    this.consultorEmptyState = get('consultorEmptyState');

    this.modalConfigConsultor = get('modalConfigConsultor');
    this.btnCloseConfigConsultor = get('btnCloseConfigConsultor');
    this.btnCancelarConfigConsultor = get('btnCancelarConfigConsultor');
    this.btnGuardarConfigConsultor = get('btnGuardarConfigConsultor');
    this.cfgRutaBdJson = get('cfgRutaBdJson');
    this.btnExaminarBdJson = get('btnExaminarBdJson');

    this.modalConfigAnalizador = get('modalConfigAnalizador');
    this.btnCloseConfigAnalizador = get('btnCloseConfigAnalizador');
    this.btnCancelarConfigAnalizador = get('btnCancelarConfigAnalizador');
    this.btnGuardarConfigAnalizador = get('btnGuardarConfigAnalizador');
    this.cfgMaxHilos = get('cfgMaxHilos');
    this.cfgModoDump = get('cfgModoDump');
    this.cfgIncluirSystem = get('cfgIncluirSystem');
    this.cfgForzarQemu = get('cfgForzarQemu');
    this.cfgRutaQemu = get('cfgRutaQemu');
    this.btnExaminarQemu = get('btnExaminarQemu');
    this.btnValidarQemu = get('btnValidarQemu');
    this.lblEstadoValidacionQemu = get('lblEstadoValidacionQemu');
    this.cfgRutaReglas = get('cfgRutaReglas');
    this.btnExaminarReglas = get('btnExaminarReglas');
    this.cfgTamanoChunk = get('cfgTamanoChunk');
    this.cfgGenerarDiscrepancias = get('cfgGenerarDiscrepancias');
    this.cfgHabilitarBitacora = get('cfgHabilitarBitacora');
    this.cfgMostrarProgresoIndividual = get('cfgMostrarProgresoIndividual');
    this.cfgNombreArchivo = get('cfgNombreArchivo');
  }

  private bindEvents(): void {
    this.tabBtnAnalizador?.addEventListener('click', () => this.seleccionarPestana('analizador'));
    this.tabBtnConsultor?.addEventListener('click', () => this.seleccionarPestana('consultor'));
    this.tabBtnReporte?.addEventListener('click', () => this.seleccionarPestana('reporte'));

    this.consultorCardsWrapper?.addEventListener('click', (event) => {
      const button = event.target?.closest?.('.btn-abrir-ubicacion-vm');
      const path = button?.getAttribute('data-ruta');
      if (path) this.onAbrirCarpeta(path);
    });

    this.inputFiltrarSoftwareReporte?.addEventListener('input', () => this.renderTablaReporte());
    this.selectCategoriaSoftwareReporte?.addEventListener('change', () => this.renderTablaReporte());

    [this.modalConfigConsultor, this.modalConfigAnalizador].forEach((modal) => {
      modal?.addEventListener('click', (event) => {
        if (event.target === modal) this.cerrarModal(modal);
      });
    });
  }

  aplicarTema(theme: Theme): Theme {
    return this.themeManager.aplicarTema(theme);
  }

  seleccionarPestana(tool: ToolName = 'consultor'): void {
    this.herramientaActiva = tool;
    const buttons = [this.tabBtnAnalizador, this.tabBtnConsultor, this.tabBtnReporte];
    const views = [this.viewAnalizador, this.viewConsultor, this.viewReporte];
    buttons.forEach((button) => button?.classList.remove('active'));
    views.forEach((view) => view?.classList.remove('active'));

    const selectedButton = tool === 'analizador'
      ? this.tabBtnAnalizador
      : tool === 'reporte'
        ? this.tabBtnReporte
        : this.tabBtnConsultor;
    const selectedView = tool === 'analizador'
      ? this.viewAnalizador
      : tool === 'reporte'
        ? this.viewReporte
        : this.viewConsultor;

    selectedButton?.classList.add('active');
    selectedView?.classList.add('active');
    this.btnOpenAjustes?.setAttribute(
      'title',
      tool === 'consultor'
        ? 'Configurar directorio de reportes JSON'
        : 'Configurar opciones del motor vmspect'
    );
  }

  mostrarVersion(version: unknown): void {
    const text = String(version || '').trim() || '—';
    if (this.appVersion) this.appVersion.textContent = `v${text.replace(/^v/i, '')}`;
  }

  sincronizarAjustes(config: Partial<AppConfig> = {}): void {
    if (this.cfgRutaBdJson) this.cfgRutaBdJson.value = config.ruta_bd_json || '';
  }

  sincronizarConfiguracionAnalizador(config: Partial<AnalyzerConfig> = {}): void {
    if (this.cfgMaxHilos) this.cfgMaxHilos.value = String(config.max_hilos ?? 4);
    if (this.cfgModoDump) this.cfgModoDump.checked = Boolean(config.modo_dump);
    if (this.cfgIncluirSystem) this.cfgIncluirSystem.checked = Boolean(config.incluir_system);
    if (this.cfgForzarQemu) this.cfgForzarQemu.checked = Boolean(config.forzar_qemu);
    if (this.cfgRutaQemu) this.cfgRutaQemu.value = config.ruta_qemu_nbd || '';
    if (this.cfgRutaReglas) this.cfgRutaReglas.value = config.ruta_reglas || '';
    if (this.cfgTamanoChunk) this.cfgTamanoChunk.value = config.tamano_chunk_kb
      ? String(config.tamano_chunk_kb)
      : '';
    if (this.cfgGenerarDiscrepancias) this.cfgGenerarDiscrepancias.checked = Boolean(config.generar_discrepancias);
    if (this.cfgHabilitarBitacora) this.cfgHabilitarBitacora.checked = Boolean(config.habilitar_bitacora);
    if (this.cfgMostrarProgresoIndividual) {
      this.cfgMostrarProgresoIndividual.checked = Boolean(config.mostrar_progreso_individual);
    }
    if (this.cfgNombreArchivo) {
      this.cfgNombreArchivo.value = config.nombre_archivo_salida || 'Relevamiento_VMs.json';
    }
    if (this.inputNombreArchivoSalida) {
      this.inputNombreArchivoSalida.value = config.nombre_archivo_salida || 'Relevamiento_VMs.json';
    }
    if (this.lblHilosAccion) {
      this.lblHilosAccion.textContent = `Configuración: ${config.max_hilos || 4} hilos`;
    }
    this.habilitarBitacora = Boolean(config.habilitar_bitacora);
    this.mostrarProgresoIndividual = Boolean(config.mostrar_progreso_individual);
    if (this.wrapperBitacora) {
      this.wrapperBitacora.style.display = this.habilitarBitacora ? 'flex' : 'none';
    }
    if (this.wrapperVmIndividual) {
      this.wrapperVmIndividual.style.display = this.mostrarProgresoIndividual ? 'flex' : 'none';
    }
  }

  leerFormularioConfiguracionAnalizador(): AnalyzerConfig {
    const hilos = Number(this.cfgMaxHilos?.value);
    const chunk = Number(this.cfgTamanoChunk?.value);
    let nombreArchivo = this.cfgNombreArchivo?.value.trim() || 'Relevamiento_VMs.json';
    if (!nombreArchivo.toLowerCase().endsWith('.json')) nombreArchivo += '.json';
    return {
      max_hilos: Number.isFinite(hilos) && hilos >= 1 ? Math.min(32, Math.round(hilos)) : 4,
      modo_dump: Boolean(this.cfgModoDump?.checked),
      incluir_system: Boolean(this.cfgIncluirSystem?.checked),
      forzar_qemu: Boolean(this.cfgForzarQemu?.checked),
      ruta_qemu_nbd: this.cfgRutaQemu?.value.trim() || '',
      ruta_reglas: this.cfgRutaReglas?.value.trim() || '',
      tamano_chunk_kb: Number.isFinite(chunk) && chunk > 0 ? Math.round(chunk) : null,
      generar_discrepancias: Boolean(this.cfgGenerarDiscrepancias?.checked),
      habilitar_bitacora: Boolean(this.cfgHabilitarBitacora?.checked),
      mostrar_progreso_individual: Boolean(this.cfgMostrarProgresoIndividual?.checked),
      nombre_archivo_salida: nombreArchivo
    };
  }

  leerFormularioConfigConsultor(): Pick<AppConfig, 'ruta_bd_json'> {
    return {
      ruta_bd_json: this.cfgRutaBdJson?.value.trim() || ''
    };
  }

  abrirModal(modal: DomElementLike | null = this.modalConfigConsultor): void {
    if (!modal) return;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }

  cerrarModal(modal: DomElementLike | null = this.modalConfigConsultor): void {
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }

  actualizarBotonesLimpieza(): void {
    if (this.btnLimpiarPrograma) {
      this.btnLimpiarPrograma.style.display = this.inputBuscarPrograma?.value ? 'block' : 'none';
    }
    if (this.btnLimpiarVm) {
      this.btnLimpiarVm.style.display = this.inputBuscarVm?.value ? 'block' : 'none';
    }
  }

  limpiarFiltros(): void {
    if (this.inputBuscarPrograma) this.inputBuscarPrograma.value = '';
    if (this.inputBuscarVm) this.inputBuscarVm.value = '';
    if (this.inputBuscarVersion) this.inputBuscarVersion.value = '';
    if (this.selectBuscarTipo) this.selectBuscarTipo.value = 'todos';
    if (this.inputBuscarPropietario) this.inputBuscarPropietario.value = '';
    this.actualizarBotonesLimpieza();
  }

  poblarSugerenciasSoftware(
    programas: unknown[] = [],
    vms: unknown[] = [],
    versiones: unknown[] = [],
    propietarios: unknown[] = [],
    asignados: unknown[] = [],
    elementos: unknown[] = []
  ): void {
    this.poblarDatalist(this.datalistProgramas, programas);
    this.poblarDatalist(this.datalistVms, vms);
    this.poblarDatalist(this.datalistVersiones, versiones, 100);
    this.poblarDatalist(this.datalistPropietarios, [
      ...propietarios,
      ...asignados,
      ...elementos
    ], 100);
  }

  private poblarDatalist(container: DomElementLike | null, values: unknown[], limit = MAX_SUGGESTIONS): void {
    if (!container) return;
    container.innerHTML = uniqueValues(values, limit)
      .map((value) => `<option value="${escapeHtml(value)}"></option>`)
      .join('');
  }

  renderResultadosSoftware(
    resultado: ResultadoConsultaSoftware | null,
    filtros: Partial<SearchFilters> = {},
    onAbrirUbicacion: (path: string) => void = this.onAbrirCarpeta
  ): void {
    this.ultimoResultado = resultado;
    const coincidencias = Array.isArray(resultado?.coincidencias) ? resultado.coincidencias : [];
    const hayBase = Boolean(
      coincidencias.length ||
      Number(resultado?.total_archivos_json) > 0 ||
      Number(resultado?.total_vms_escaneadas) > 0
    );
    const hayFiltro = Boolean(
      filtros.programa?.trim() ||
      filtros.vm?.trim() ||
      filtros.version?.trim() ||
      filtros.propietario?.trim() ||
      (filtros.tipo && filtros.tipo !== 'todos')
    );

    if (!hayBase) {
      this.limpiarResultados();
      this.mostrarEstado(
        'No se encontraron reportes JSON.',
        'Configura el directorio de reportes desde Ajustes para comenzar a consultar.'
      );
      this.actualizarMetricas('Sin reportes JSON encontrados. Configura la base de datos en Ajustes.');
      return;
    }

    if (!hayFiltro) {
      this.limpiarResultados();
      this.mostrarEstado(
        'Aplica al menos un filtro para consultar resultados.',
        `${formatNumber(resultado?.total_vms_escaneadas)} VMs indexadas y ${formatNumber(resultado?.total_programas_indexados)} programas disponibles.`
      );
      this.actualizarMetricas(
        `${formatNumber(resultado?.total_vms_escaneadas)} VMs en la base de datos • aplica un filtro para ver resultados`
      );
      return;
    }

    if (!coincidencias.length) {
      this.limpiarResultados();
      this.mostrarEstado(
        'No se encontraron coincidencias.',
        `${formatNumber(resultado?.total_vms_escaneadas)} VMs fueron consultadas con los filtros actuales.`
      );
      this.actualizarMetricas(`${formatNumber(resultado?.total_vms_escaneadas)} VMs • 0 coincidencias`);
      return;
    }

    if (this.consultorEmptyState) this.consultorEmptyState.style.display = 'none';
    const vms = new Set(coincidencias.map((item) => item.ruta_carpeta || item.nombre_vm)).size;
    this.actualizarMetricas(
      `${coincidencias.length} coincidencia(s) en ${vms} máquina(s) virtual(es) • ${formatNumber(resultado?.total_archivos_json)} reportes`
    );
    this.renderTarjetas(coincidencias, onAbrirUbicacion);
  }

  renderTarjetas(
    items: CoincidenciaSoftware[],
    onAbrirUbicacion: (path: string) => void = this.onAbrirCarpeta
  ): void {
    if (!this.consultorCardsWrapper) return;
    this.consultorCardsWrapper.innerHTML = items.map((item) => this.crearTarjeta(item)).join('');
    this.onAbrirCarpeta = onAbrirUbicacion || this.onAbrirCarpeta;
    this.consultorCardsWrapper.style.display = 'flex';
  }

  crearTarjeta(item: CoincidenciaSoftware = {}): string {
    const { disco, ubicacion } = extraerInfoDisco(item.ruta_carpeta);
    const type = String(item.origen_categoria || item.tipo_posesion || 'Personas').toLowerCase();
    const isDisk = type.includes('disco');
    const isServer = type.includes('servidor') || type.includes('server');
    const badgeClass = isDisk ? 'badge-disco' : isServer ? 'badge-servidor' : 'badge-persona';
    const typeName = isDisk ? 'Disco' : isServer ? 'Servidor' : 'Persona';
    const assigned = (
      (isDisk || isServer ? item.elemento || item.elemento_asignado : item.asignado || item.propietario) ||
      item.elemento_asignado ||
      item.propietario ||
      item.asignado ||
      item.elemento ||
      deducirEntidadDesdeArchivo(item.archivo_json) ||
      'Desconocido'
    );
    const tags = Array.isArray(item.tags)
      ? item.tags.map((tag) => `<span class="consultor-tag-pill">#${escapeHtml(tag)}</span>`).join('')
      : '';
    const version = item.version
      ? `<span class="consultor-version-badge">v${escapeHtml(item.version)}</span>`
      : '';
    const category = item.categoria
      ? `<span class="consultor-category-badge">${escapeHtml(item.categoria)}</span>`
      : '';
    const editor = item.editor
      ? `<span class="consultor-editor-tag">• ${escapeHtml(item.editor)}</span>`
      : '';
    const internalName = item.nombre_interno && item.nombre_interno !== item.nombre_vm
      ? ` <span class="consultor-editor-tag">(${escapeHtml(item.nombre_interno)})</span>`
      : '';
    const path = escapeHtml(item.ruta_carpeta || '');
    const openButton = item.ruta_carpeta
      ? `<button class="step-btn btn-abrir-ubicacion-vm" type="button" data-ruta="${path}">Abrir carpeta</button>`
      : '';

    return `
      <article class="consultor-card">
        <div class="consultor-card-header">
          <div class="consultor-app-title">
            <strong>${escapeHtml(item.nombre_programa || 'Programa sin nombre')}</strong>
            ${version}${category}${editor}
          </div>
          <span class="consultor-possession-badge ${badgeClass}">
            <strong>${typeName}:</strong> ${escapeHtml(assigned)}
          </span>
        </div>
        ${tags ? `<div class="consultor-tags-row"><div class="consultor-tags-wrapper">${tags}</div></div>` : ''}
        <div class="consultor-card-body">
          <div class="consultor-vm-details">
            <div class="consultor-vm-name-row">
              <span>VM: <strong>${escapeHtml(item.nombre_vm || 'VM desconocida')}</strong>${internalName}</span>
              <span class="consultor-os-badge">${escapeHtml(item.sistema_operativo || 'SO desconocido')}</span>
            </div>
            <div class="consultor-location-row">
              <span class="consultor-disk-badge">${escapeHtml(disco)}</span>
              <span class="consultor-path-text" title="Ruta completa de la VM">${escapeHtml(ubicacion)}</span>
            </div>
            <div class="consultor-meta-row">
              <span>Reporte: ${escapeHtml(item.archivo_json || '-')}</span>
              <span>• ${escapeHtml(item.fecha_relevamiento || 'Fecha desconocida')}</span>
            </div>
          </div>
          ${openButton}
        </div>
      </article>
    `;
  }

  private limpiarResultados(): void {
    if (this.consultorCardsWrapper) {
      this.consultorCardsWrapper.innerHTML = '';
      this.consultorCardsWrapper.style.display = 'none';
    }
  }

  private mostrarEstado(title: string, detail: string): void {
    if (!this.consultorEmptyState) return;
    this.consultorEmptyState.style.display = 'flex';
    this.consultorEmptyState.innerHTML = `
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <div class="empty-state-title">${escapeHtml(title)}</div>
      <div class="empty-state-detail">${escapeHtml(detail)}</div>
    `;
  }

  private actualizarMetricas(text: string): void {
    if (this.lblSoftwareMetricas) this.lblSoftwareMetricas.textContent = text;
  }

  mostrarError(error: unknown): void {
    this.limpiarResultados();
    this.mostrarEstado('No se pudo completar la consulta.', String(error));
    this.actualizarMetricas(`Error al consultar los reportes: ${error}`);
  }

  setRecargando(active: boolean): void {
    this.btnRecargarSoftware?.classList.toggle('spinning', active);
    if (this.btnEjecutarBusquedaSoftware) this.btnEjecutarBusquedaSoftware.disabled = active;
  }

  actualizarPasos(rutaOrigen: string, rutaDestino: string, nombreArchivo?: string): void {
    const actualizarRuta = (
      label: DomElementLike | null,
      card: DomElementLike | null,
      ruta: string
    ): void => {
      if (label) {
        label.textContent = ruta || 'Seleccionar carpeta';
        label.title = ruta || '';
      }
      card?.classList.toggle('ready', Boolean(ruta));
    };

    actualizarRuta(this.lblOrigen, this.cardStepOrigen, rutaOrigen);
    actualizarRuta(this.lblDestino, this.cardStepDestino, rutaDestino);
    if (nombreArchivo !== undefined && this.inputNombreArchivoSalida) {
      this.inputNombreArchivoSalida.value = nombreArchivo;
    }

    const nombreValido = Boolean(this.inputNombreArchivoSalida?.value.trim());
    this.cardStepNombreJson?.classList.toggle('ready', nombreValido);
    const listo = Boolean(rutaOrigen && rutaDestino && nombreValido);
    if (this.btnIniciarAccion) {
      this.btnIniciarAccion.disabled = !listo;
      this.btnIniciarAccion.classList.toggle('ready-to-run', listo);
    }
    if (this.lblHilosAccion && !this.btnIniciarAccion?.classList.contains('cancel')) {
      this.lblHilosAccion.textContent = listo ? 'Iniciar análisis' : 'Pendiente';
    }
  }

  setEstadoAnalizador(ejecutando: boolean, cancelando = false): void {
    if (this.lblTitleAccion) this.lblTitleAccion.textContent = ejecutando ? 'Cancelar' : 'Análisis';
    if (this.lblHilosAccion) {
      this.lblHilosAccion.textContent = cancelando
        ? 'Cancelando...'
        : ejecutando
          ? 'Detener análisis'
          : 'Iniciar';
    }
    this.btnIniciarAccion?.classList.toggle('cancel', ejecutando);
    if (this.btnIniciarAccion) this.btnIniciarAccion.disabled = cancelando;
    if (this.cardStepOrigen) this.cardStepOrigen.style.pointerEvents = ejecutando ? 'none' : 'auto';
    if (this.cardStepDestino) this.cardStepDestino.style.pointerEvents = ejecutando ? 'none' : 'auto';
    if (this.inputNombreArchivoSalida) this.inputNombreArchivoSalida.disabled = ejecutando;
    if (!ejecutando) {
      this.barGlobal?.classList.remove('finished');
      this.actualizarPasos(
        this.lblOrigen?.title || '',
        this.lblDestino?.title || '',
        this.inputNombreArchivoSalida?.value
      );
    }
  }

  actualizarDiagnostico(diagnostico: DiagnosticoSistema): void {
    if (!this.sysDiagnosticText) return;
    const qemu = diagnostico.qemu_nbd_disponible ?? diagnostico.qemu_img_disponible;
    this.sysDiagnosticText.textContent = `${diagnostico.equipo_ejecucion} • ${diagnostico.sistema_operativo} (${diagnostico.arquitectura}) • ${diagnostico.hilos_cpu} CPUs • qemu-nbd: ${qemu ? 'OK' : 'No detectado'}`;
  }

  actualizarTelemetria(estado: EstadoSupervision): void {
    const progreso = Math.min(100, Math.max(0, Number(estado.progreso_global) || 0));
    if (this.badgeFase) {
      const faseClass = estado.fase === 'finalizado'
        ? 'finished'
        : estado.fase === 'cancelado'
          ? 'cancelled'
          : estado.fase === 'error'
            ? 'error'
            : ['iniciando', 'escaneando_directorio', 'analizando_v_ms', 'generando_reporte'].includes(estado.fase)
              ? 'running'
              : 'idle';
      this.badgeFase.classList.remove('idle', 'running', 'finished', 'cancelled', 'error');
      this.badgeFase.classList.add(faseClass);
      this.badgeFase.textContent = this.etiquetaFase(estado.fase);
    }
    if (this.lblBigPorcentaje) this.lblBigPorcentaje.textContent = `${progreso.toFixed(1)}%`;
    if (this.lblProgresoMsg) this.lblProgresoMsg.textContent = estado.mensaje_estado || '';
    if (this.barGlobal) {
      this.barGlobal.style.width = `${progreso}%`;
      this.barGlobal.classList.toggle('finished', estado.fase === 'finalizado');
    }
    if (this.statVms) this.statVms.textContent = `${estado.vms_procesadas || 0} / ${estado.total_vms || 0}`;
    if (this.statExitosas) this.statExitosas.textContent = `✓ ${estado.vms_exitosas || 0} exitosas`;
    if (this.statObservaciones) {
      this.statObservaciones.style.display = estado.vms_con_observaciones > 0 ? 'inline-flex' : 'none';
      this.statObservaciones.textContent = `⚠ ${estado.vms_con_observaciones || 0} con observaciones`;
    }
    if (this.statTiempo) this.statTiempo.textContent = estado.tiempo_transcurrido_formateado || '00:00';
    if (this.itemEta && this.statEta) {
      const eta = estado.tiempo_restante_formateado;
      this.itemEta.style.display = eta ? 'inline-flex' : 'none';
      this.statEta.textContent = eta ? `ETA: ${eta}` : 'ETA: --:--';
    }
    if (this.statVelocidad) {
      this.statVelocidad.textContent = `${(Number(estado.velocidad_vms_minuto) || 0).toFixed(1)} VM/min`;
    }

    if (this.wrapperVmIndividual && this.mostrarProgresoIndividual && estado.vm_actual_nombre) {
      this.wrapperVmIndividual.style.display = 'flex';
      if (this.lblVmIndividualTitulo) {
        this.lblVmIndividualTitulo.textContent = `[#${estado.vm_actual_indice}] ${estado.vm_actual_nombre}`;
      }
      if (this.lblVmIndividualPorcentaje) {
        this.lblVmIndividualPorcentaje.textContent = `${estado.progreso_vm_actual || 0}%`;
      }
      if (this.barVmIndividual) this.barVmIndividual.style.width = `${estado.progreso_vm_actual || 0}%`;
      if (this.lblVmIndividualEtapa) {
        this.lblVmIndividualEtapa.textContent = estado.detalle_vm_actual
          ? `${estado.etapa_vm_actual} (${estado.detalle_vm_actual})`
          : estado.etapa_vm_actual || 'En espera';
      }
    }

    if (this.wrapperWorkers && this.listWorkers) {
      const workers = Array.isArray(estado.vms_activas) ? estado.vms_activas : [];
      this.wrapperWorkers.style.display = workers.length ? 'flex' : 'none';
      this.listWorkers.innerHTML = workers.map((worker) => `
        <div class="worker-row">
          <span><strong>[#${worker.indice}]</strong> ${escapeHtml(worker.nombre_vm)} <span class="text-muted">(${escapeHtml(worker.etapa)})</span></span>
          <span class="worker-tag">${worker.porcentaje}%</span>
        </div>
      `).join('');
    }

    if (this.wrapperBitacora && this.logConsole && this.habilitarBitacora && Array.isArray(estado.logs_recientes)) {
      this.wrapperBitacora.style.display = 'flex';
      this.logConsole.innerHTML = estado.logs_recientes.map((log) => {
        const levelClass: Record<string, string> = {
          info: 'log-info',
          exito: 'log-ok',
          advertencia: 'log-warn',
          error: 'log-err'
        };
        const logClass = levelClass[log.nivel.toLowerCase()] || 'log-info';
        return `
          <div class="log-item">
            <span class="log-time">[${escapeHtml(log.timestamp)}]</span>
            <span class="${logClass}">[${escapeHtml(log.nivel.toUpperCase())}]</span>
            <span>${log.vm ? `[${escapeHtml(log.vm)}] ` : ''}${escapeHtml(log.mensaje)}</span>
          </div>
        `;
      }).join('');
    }
  }

  renderResumenRelevamiento(resumen: ResumenRelevamiento): void {
    if (!this.analyzerSummary) return;
    this.analyzerSummary.style.display = 'block';
    this.analyzerSummary.textContent = resumen.cancelado
      ? `Relevamiento cancelado: ${resumen.total_vms} VM(s), informe parcial en ${resumen.ruta_informe || 'el destino seleccionado'}.`
      : `Relevamiento finalizado: ${resumen.total_vms} VM(s), ${resumen.total_programas} programas y ${resumen.peso_total_gb.toFixed(2)} GB procesados en ${resumen.duracion_formateada}. Informe: ${resumen.ruta_informe}`;
  }

  mostrarErrorAnalizador(error: unknown): void {
    if (!this.analyzerSummary) return;
    this.analyzerSummary.style.display = 'block';
    this.analyzerSummary.textContent = `No se pudo completar el relevamiento: ${String(error)}`;
  }

  private etiquetaFase(fase: string): string {
    const labels: Record<string, string> = {
      iniciando: 'Iniciando',
      escaneando_directorio: 'Escaneando directorio',
      analizando_v_ms: 'Analizando VMs',
      generando_reporte: 'Generando reporte',
      finalizado: 'Finalizado',
      cancelado: 'Cancelado',
      error: 'Error'
    };
    return labels[fase] || fase || 'Inactivo';
  }

  setDiscoReporte(ruta: string): void {
    if (this.lblDiscoReporteRuta) {
      this.lblDiscoReporteRuta.textContent = ruta || 'Seleccionar disco o reporte JSON';
      this.lblDiscoReporteRuta.title = ruta || '';
    }
    this.cardStepDiscoReporte?.classList.toggle('ready', Boolean(ruta));
    if (this.btnIniciarReporte) {
      this.btnIniciarReporte.disabled = !ruta;
      this.btnIniciarReporte.classList.toggle('ready-to-run', Boolean(ruta));
    }
  }

  actualizarProgresoReporte(progreso: ProgresoInspeccion): void {
    const porcentaje = Math.min(100, Math.max(0, Number(progreso.porcentaje) || 0));
    if (this.barProgresoReporte) this.barProgresoReporte.style.width = `${porcentaje}%`;
    if (this.lblPorcentajeReporte) this.lblPorcentajeReporte.textContent = `${porcentaje}%`;
    if (this.lblEtapaReporte) this.lblEtapaReporte.textContent = progreso.etapa || 'Analizando...';
    if (this.lblDetalleReporte) this.lblDetalleReporte.textContent = progreso.detalle || '';
  }

  setEstadoReporte(ejecutando: boolean): void {
    if (this.wrapperProgresoReporte) this.wrapperProgresoReporte.style.display = ejecutando ? 'flex' : 'none';
    if (this.btnIniciarReporte) {
      this.btnIniciarReporte.disabled = ejecutando || !this.lblDiscoReporteRuta?.title;
      this.btnIniciarReporte.classList.toggle('ready-to-run', !ejecutando && Boolean(this.lblDiscoReporteRuta?.title));
    }
    if (this.btnSeleccionarDiscoReporte) this.btnSeleccionarDiscoReporte.disabled = ejecutando;
  }

  renderInformeDirecto(informe: InformeDirecto): void {
    this.ultimoInformeReporte = informe;
    if (this.containerResultadosReporte) this.containerResultadosReporte.style.display = 'flex';
    if (this.reporteEmptyState) this.reporteEmptyState.style.display = 'none';

    const warnings = Array.isArray(informe.advertencias) ? informe.advertencias : [];
    const exito = informe.exito !== false;
    if (this.reporteWarningsBox) {
      this.reporteWarningsBox.style.display = warnings.length || !exito ? 'block' : 'none';
      this.reporteWarningsBox.innerHTML = warnings.length
        ? `<div class="reporte-warning-title">Observaciones del análisis</div>${warnings.map((warning) => `<div class="reporte-warning-item">⚠ ${escapeHtml(warning)}</div>`).join('')}`
        : !exito ? '<div class="reporte-warning-title">La inspección no pudo completarse.</div>' : '';
    }

    const imagen = informe.imagen || {};
    const estadisticas = informe.estadisticas || {};
    const vmInfo = informe.vm_info || {};
    this.setText(this.lblReporteArchivo, informe.archivo || '-');
    this.setText(this.lblReporteFormato, String(imagen.formato || '-').toUpperCase());
    this.setText(this.lblReporteHipervisor, imagen.hipervisor || 'Desconocido');
    this.setText(this.lblReporteTamanoVirtual, formatearBytes(imagen.tamano_virtual));
    this.setText(this.lblReporteTamanoReal, formatearBytes(imagen.tamano_real));
    this.setText(this.lblReporteAcceso, estadisticas.modo_acceso || 'Nativo');
    this.setText(this.lblReporteDuracion, `${estadisticas.duracion_ms || 0} ms`);
    this.setText(this.lblReporteBytesLeidos, formatearBytes(estadisticas.bytes_leidos));
    this.setText(this.lblReporteQemuCalls, `${estadisticas.invocaciones_qemu || 0} llamadas`);
    this.setText(this.lblReporteSoNombre, vmInfo.os_nombre || informe.sistema_operativo || 'Desconocido');
    this.setText(this.lblReporteSoDetalles, [
      vmInfo.os_edition_version && `Versión ${vmInfo.os_edition_version}`,
      vmInfo.os_build && `Build ${vmInfo.os_build}`,
      vmInfo.os_service_pack
    ].filter(Boolean).join(' • ') || 'Sin datos adicionales de compilación');
    if (this.lblReporteVmTools) {
      this.lblReporteVmTools.innerHTML = vmInfo.vmtools_version
        ? `<span class="metric-badge-ok">✓ ${escapeHtml(vmInfo.vmtools_version)}</span>`
        : '<span class="text-muted">No detectadas</span>';
    }
    this.setText(this.lblReporteEsquema, `Tabla: ${informe.esquema || 'Desconocida'}`);

    const particiones = Array.isArray(informe.particiones) ? informe.particiones : [];
    if (this.listReporteParticiones) {
      this.listReporteParticiones.innerHTML = particiones.length
        ? particiones.map((particion, index) => `
          <div class="inspector-partition-item">
            <div class="part-header-row">
              <span class="part-index">Partición #${particion.indice || index + 1}</span>
              <span class="fs-badge fs-other">${escapeHtml(String(particion.sistema_archivos || 'Desconocido').toUpperCase())}</span>
            </div>
            <div class="part-info-grid">
              <div><span class="part-label">Tamaño:</span> <strong>${formatearBytes(particion.tamano)}</strong></div>
              <div><span class="part-label">Inicio:</span> <span class="mono">0x${Number(particion.inicio || 0).toString(16).toUpperCase()}</span></div>
              <div><span class="part-label">Tipo:</span> ${escapeHtml(particion.tipo || 'Desconocido')}</div>
              <div><span class="part-label">Etiqueta:</span> ${escapeHtml(particion.etiqueta || '(Sin etiqueta)')}</div>
            </div>
          </div>
        `).join('')
        : '<div class="empty-history-text">No se detectaron particiones estructuradas.</div>';
    }

    const categorias = [...new Set((informe.programas || [])
      .map((programa) => programa.categoria)
      .filter((categoria): categoria is string => Boolean(categoria)))].sort();
    if (this.selectCategoriaSoftwareReporte) {
      this.selectCategoriaSoftwareReporte.innerHTML = [
        '<option value="todas">Todas las categorías</option>',
        ...categorias.map((categoria) => `<option value="${escapeHtml(categoria)}">${escapeHtml(categoria)}</option>`)
      ].join('');
      this.selectCategoriaSoftwareReporte.value = 'todas';
    }
    this.filtroTextoReporte = '';
    if (this.inputFiltrarSoftwareReporte) this.inputFiltrarSoftwareReporte.value = '';
    this.filtroCategoriaReporte = 'todas';
    this.renderTablaReporte();
  }

  private setText(element: DomElementLike | null, value: unknown): void {
    if (element) element.textContent = String(value ?? '-');
  }

  private renderTablaReporte(): void {
    if (!this.ultimoInformeReporte || !this.tbodySoftwareReporte) return;
    this.filtroTextoReporte = this.inputFiltrarSoftwareReporte?.value.trim().toLowerCase() || '';
    this.filtroCategoriaReporte = this.selectCategoriaSoftwareReporte?.value || 'todas';
    const programas = Array.isArray(this.ultimoInformeReporte.programas)
      ? this.ultimoInformeReporte.programas
      : [];
    const filtrados = programas.filter((programa) => {
      const texto = [programa.nombre, programa.version, programa.editor, ...(programa.tags || [])]
        .filter(Boolean).join(' ').toLowerCase();
      const coincideTexto = !this.filtroTextoReporte || texto.includes(this.filtroTextoReporte);
      const coincideCategoria = this.filtroCategoriaReporte === 'todas'
        || String(programa.categoria || '').toLowerCase() === this.filtroCategoriaReporte.toLowerCase();
      return coincideTexto && coincideCategoria;
    });
    if (this.lblTotalProgramasReporte) {
      this.lblTotalProgramasReporte.textContent = `${filtrados.length} de ${programas.length} programas`;
    }
    this.tbodySoftwareReporte.innerHTML = filtrados.length
      ? filtrados.map((programa) => `
        <tr>
          <td><strong>${escapeHtml(programa.nombre)}</strong></td>
          <td>${programa.version ? `<span class="consultor-version-badge">v${escapeHtml(programa.version)}</span>` : '<span class="text-muted">-</span>'}</td>
          <td>${escapeHtml(programa.editor || '-')}</td>
          <td>${programa.categoria ? `<span class="consultor-category-badge">${escapeHtml(programa.categoria)}</span>` : '<span class="text-muted">-</span>'}</td>
          <td>${(programa.tags || []).map((tag) => `<span class="consultor-tag-pill">#${escapeHtml(tag)}</span>`).join(' ') || '<span class="text-muted">-</span>'}</td>
        </tr>
      `).join('')
      : '<tr><td colspan="5" class="report-table-empty">No hay programas para los filtros actuales.</td></tr>';
  }

  mostrarErrorReporte(error: unknown): void {
    if (this.containerResultadosReporte) this.containerResultadosReporte.style.display = 'none';
    if (this.reporteEmptyState) {
      this.reporteEmptyState.style.display = 'flex';
      this.reporteEmptyState.innerHTML = `<div class="empty-state-title">No se pudo generar el reporte.</div><div class="empty-state-detail">${escapeHtml(error)}</div>`;
    }
  }
}

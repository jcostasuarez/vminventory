import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY
} from 'd3-force';
import { polygonHull } from 'd3-polygon';
import type { SimulationLinkDatum, SimulationNodeDatum } from 'd3-force';
import { ThemeManager } from './theme';
import type {
  AnalyzerConfig,
  AppConfig,
  CoincidenciaSoftware,
  CriterioAgrupacion,
  ConsultorTableField,
  ConsultorTableRow,
  DiagnosticoSistema,
  GrupoSoftware,
  DocumentLike,
  DomElementLike,
  EstadoSupervision,
  InformeDirecto,
  ProgresoInspeccion,
  ResumenRelevamiento,
  ResultadoConsultaSoftware,
  SearchFilters,
  ConsultorViewMode,
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


/** Deriva el responsable a partir del nombre base del reporte JSON. */
export function deducirResponsableDesdeArchivo(fileName: unknown): string | null {
  if (fileName === null || fileName === undefined) return null;
  const file = String(fileName).split(/[\\/]/).pop()?.trim() || '';
  const stem = file.replace(/\.json$/i, '').trim();
  return stem ? stem.replace(/_/g, ' ').trim() || null : null;
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

export const CONSULTOR_TABLE_COLUMNS: ReadonlyArray<{
  field: ConsultorTableField;
  label: string;
}> = [
  { field: 'programa', label: 'Programa o aplicación' },
  { field: 'vm', label: 'Máquina virtual' },
  { field: 'version', label: 'Versión' },
  { field: 'tipo', label: 'Tipo' },
  { field: 'responsable', label: 'Responsable' }
];

function obtenerValorFiltroConsultor(
  item: CoincidenciaSoftware,
  field: ConsultorTableField
): string | null {
  switch (field) {
    case 'programa':
      return sanitizarTexto(item.nombre_programa);
    case 'vm':
      return sanitizarTexto(item.nombre_vm);
    case 'version':
      return sanitizarTexto(item.version);
    case 'tipo':
      return sanitizarTexto(item.tipo);
    case 'responsable':
      return sanitizarTexto(item.responsable) || deducirResponsableDesdeArchivo(item.archivo_json);
  }
}

export function formatearValorTablaConsultor(
  item: CoincidenciaSoftware,
  field: ConsultorTableField
): { display: string; filterValue: string | null } {
  const filterValue = obtenerValorFiltroConsultor(item, field);
  const display = filterValue
    ? field === 'version' ? `v${filterValue}` : filterValue
    : (
      field === 'programa'
        ? 'Programa sin nombre'
        : field === 'vm'
          ? 'VM desconocida'
          : field === 'tipo'
            ? 'Sin tipo'
            : '—'
    );
  return { display, filterValue };
}

export function formatearBytes(value: unknown): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const amount = bytes / (1024 ** exponent);
  return `${amount >= 10 || exponent === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[exponent]}`;
}

export interface ConsultorGraphNode extends SimulationNodeDatum {
  id: string;
  type: 'vm' | 'software';
  label: string;
  version: string | null;
  sistemaOperativo: string | null;
  ubicacion: string | null;
  responsable: string | null;
  tipo: string | null;
  categoria: string | null;
  tags: string[];
  editor: string | null;
  degree: number;
  radius: number;
  groupKey: string | null;
}

export interface ConsultorGraphGroup {
  key: string;
  value: string;
  criterion: Exclude<CriterioAgrupacion, 'sin-agrupar'>;
  label: string;
  index: number;
  nodeIds: string[];
}

export interface ConsultorGraphHullGeometry {
  path: string;
  labelX: number;
  labelY: number;
}

export interface ConsultorGraphLink extends SimulationLinkDatum<ConsultorGraphNode> {
  id: string;
  source: string | ConsultorGraphNode;
  target: string | ConsultorGraphNode;
  weight: number;
}

export interface ConsultorGraphModel {
  nodes: ConsultorGraphNode[];
  links: ConsultorGraphLink[];
  groups: ConsultorGraphGroup[];
  totalNodes: number;
  totalLinks: number;
  limited: boolean;
}

const MAX_GRAPH_NODES = 180;
const MAX_GRAPH_LINKS = 500;

function normalizarClaveGrafo(value: unknown): string | null {
  const text = sanitizarTexto(value);
  return text ? text.replace(/\s+/g, ' ').toLocaleLowerCase() : null;
}

function actualizarMetadatosNodo(node: ConsultorGraphNode, item: CoincidenciaSoftware): void {
  const metadata: Array<[keyof Pick<ConsultorGraphNode, 'sistemaOperativo' | 'ubicacion' | 'responsable' | 'tipo' | 'categoria' | 'editor'>, unknown]> = [
    ['sistemaOperativo', item.sistema_operativo],
    ['ubicacion', item.ruta_carpeta],
    ['responsable', sanitizarTexto(item.responsable) || deducirResponsableDesdeArchivo(item.archivo_json)],
    ['tipo', item.tipo],
    ['categoria', item.categoria],
    ['editor', item.editor]
  ];
  metadata.forEach(([field, value]) => {
    if (!node[field]) node[field] = sanitizarTexto(value);
  });
  uniqueValues(item.tags ?? []).forEach((tag) => {
    if (!node.tags.includes(tag)) node.tags.push(tag);
  });
}

function identidadesGrafo(item: CoincidenciaSoftware): { vmId: string; softwareId: string } | null {
  const nombreVm = sanitizarTexto(item.nombre_vm);
  const nombrePrograma = sanitizarTexto(item.nombre_programa);
  const identidadVm = normalizarClaveGrafo(item.ruta_carpeta) || normalizarClaveGrafo(nombreVm);
  if (!nombreVm || !nombrePrograma || !identidadVm) return null;
  const identidadSoftware = `${normalizarClaveGrafo(nombrePrograma)}\u0000${normalizarClaveGrafo(item.version) || ''}`;
  return { vmId: `vm:${identidadVm}`, softwareId: `software:${identidadSoftware}` };
}

export function etiquetaCriterioAgrupacion(criterion: CriterioAgrupacion): string {
  return {
    'maquina-virtual': 'Máquina virtual',
    categoria: 'Categoría',
    'sistema-operativo': 'Sistema operativo',
    responsable: 'Responsable',
    tipo: 'Tipo',
    'sin-agrupar': 'Sin agrupar'
  }[criterion];
}

/** Calcula una envolvente cerrada que contempla forma y etiqueta de los nodos. */
export function calcularHullGrupoConsultor(nodes: ConsultorGraphNode[]): ConsultorGraphHullGeometry | null {
  if (!nodes.length) return null;
  const positioned = nodes.map((node) => ({
    x: Number.isFinite(node.x) ? node.x! : 0,
    y: Number.isFinite(node.y) ? node.y! : 0,
    radius: node.radius
  }));
  const padding = 18;
  const left = Math.min(...positioned.map((node) => node.x - node.radius - padding));
  const right = Math.max(...positioned.map((node) => node.x + node.radius + padding));
  const top = Math.min(...positioned.map((node) => node.y - node.radius - padding - 16));
  const bottom = Math.max(...positioned.map((node) => node.y + node.radius + padding + 16));
  const roundedRect = (): string => {
    const radius = Math.min(16, (right - left) / 2, (bottom - top) / 2);
    return `M ${left + radius} ${top} H ${right - radius} Q ${right} ${top} ${right} ${top + radius} V ${bottom - radius} Q ${right} ${bottom} ${right - radius} ${bottom} H ${left + radius} Q ${left} ${bottom} ${left} ${bottom - radius} V ${top + radius} Q ${left} ${top} ${left + radius} ${top} Z`;
  };
  if (positioned.length < 3) {
    return { path: roundedRect(), labelX: (left + right) / 2, labelY: top + 14 };
  }

  // Se toman los límites de cada nodo, no sólo sus centros, para que el hull no los atraviese.
  const boundaryPoints: Array<[number, number]> = positioned.flatMap((node) => {
    const horizontal = node.radius + padding;
    const vertical = node.radius + padding + 16;
    return [
      [node.x - horizontal, node.y], [node.x + horizontal, node.y],
      [node.x, node.y - vertical], [node.x, node.y + vertical],
      [node.x - horizontal, node.y - vertical], [node.x + horizontal, node.y - vertical],
      [node.x - horizontal, node.y + vertical], [node.x + horizontal, node.y + vertical]
    ];
  });
  const hull = polygonHull(boundaryPoints);
  if (!hull) return { path: roundedRect(), labelX: (left + right) / 2, labelY: top + 14 };
  const path = `M ${hull.map(([x, y]) => `${x} ${y}`).join(' L ')} Z`;
  return { path, labelX: (left + right) / 2, labelY: top + 14 };
}

/** Construye relaciones sin mutar la respuesta ni las filas de presentación. */
export function crearModeloGrafoConsultor(
  items: CoincidenciaSoftware[],
  grupos: GrupoSoftware[] = []
): ConsultorGraphModel {
  const nodes = new Map<string, ConsultorGraphNode>();
  const links = new Map<string, ConsultorGraphLink>();

  items.forEach((item) => {
    const identities = identidadesGrafo(item);
    const nombreVm = sanitizarTexto(item.nombre_vm);
    const nombrePrograma = sanitizarTexto(item.nombre_programa);
    if (!identities || !nombreVm || !nombrePrograma) return;
    const { vmId, softwareId } = identities;
    let vm = nodes.get(vmId);
    if (!vm) {
      vm = {
        id: vmId, type: 'vm', label: nombreVm, version: null,
        sistemaOperativo: null, ubicacion: null, responsable: null, tipo: null, categoria: null, tags: [], editor: null,
        degree: 0, radius: 10, groupKey: null
      };
      nodes.set(vmId, vm);
    }
    let software = nodes.get(softwareId);
    if (!software) {
      software = {
        id: softwareId, type: 'software', label: nombrePrograma, version: sanitizarTexto(item.version),
        sistemaOperativo: null, ubicacion: null, responsable: null, tipo: null, categoria: null, tags: [], editor: null,
        degree: 0, radius: 10, groupKey: null
      };
      nodes.set(softwareId, software);
    }
    actualizarMetadatosNodo(vm, item);
    actualizarMetadatosNodo(software, item);

    const linkId = JSON.stringify([vmId, softwareId]);
    const existing = links.get(linkId);
    if (existing) existing.weight += 1;
    else links.set(linkId, { id: linkId, source: vmId, target: softwareId, weight: 1 });
  });

  const groupCandidates = grupos
    .map((grupo, originalIndex) => {
      const criterion = grupo.criterio;
      if (!criterion || criterion === 'sin-agrupar') return null;
      const key = sanitizarTexto(grupo.clave) || `grupo-${originalIndex}`;
      const value = sanitizarTexto(grupo.valor) || 'Sin especificar';
      return { key, value, criterion, originalIndex, tarjetas: Array.isArray(grupo.tarjetas) ? grupo.tarjetas : [] };
    })
    .filter((group): group is { key: string; value: string; criterion: Exclude<CriterioAgrupacion, 'sin-agrupar'>; originalIndex: number; tarjetas: CoincidenciaSoftware[] } => Boolean(group))
    .sort((a, b) => a.key.localeCompare(b.key, 'es', { sensitivity: 'base', numeric: true }) || a.originalIndex - b.originalIndex)
    .map((group, index) => ({ ...group, index }));
  const candidateCounts = new Map<string, Map<string, number>>();
  groupCandidates.forEach((group) => group.tarjetas.forEach((item) => {
    const identities = identidadesGrafo(item);
    if (!identities) return;
    [identities.vmId, identities.softwareId].forEach((nodeId) => {
      if (!nodes.has(nodeId)) return;
      const counts = candidateCounts.get(nodeId) ?? new Map<string, number>();
      counts.set(group.key, (counts.get(group.key) ?? 0) + 1);
      candidateCounts.set(nodeId, counts);
    });
  }));
  nodes.forEach((node) => {
    const candidates = [...(candidateCounts.get(node.id) ?? new Map<string, number>()).entries()];
    // Un nodo compartido sólo puede ocupar una nube; se resuelve por frecuencia y clave estable.
    node.groupKey = candidates.sort(([keyA, countA], [keyB, countB]) => countB - countA || keyA.localeCompare(keyB, 'es', { sensitivity: 'base', numeric: true }))[0]?.[0] ?? null;
  });

  const completeNodes = [...nodes.values()];
  const completeLinks = [...links.values()];
  completeLinks.forEach((link) => {
    const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
    const targetId = typeof link.target === 'string' ? link.target : link.target.id;
    nodes.get(sourceId)!.degree += 1;
    nodes.get(targetId)!.degree += 1;
  });
  completeNodes.forEach((node) => {
    node.radius = node.type === 'vm'
      ? Math.max(18, Math.min(38, 15 + Math.sqrt(node.degree) * 6))
      : Math.max(10, Math.min(24, 8 + Math.sqrt(node.degree) * 4));
  });

  const byImportance = (a: ConsultorGraphNode, b: ConsultorGraphNode) => b.degree - a.degree || a.id.localeCompare(b.id);
  const vms = completeNodes.filter((node) => node.type === 'vm').sort(byImportance);
  const software = completeNodes.filter((node) => node.type === 'software').sort(byImportance);
  const selected = [...vms.slice(0, Math.ceil(MAX_GRAPH_NODES / 2)), ...software.slice(0, Math.floor(MAX_GRAPH_NODES / 2))];
  if (selected.length < MAX_GRAPH_NODES) {
    const included = new Set(selected.map((node) => node.id));
    completeNodes.sort(byImportance).forEach((node) => {
      if (selected.length < MAX_GRAPH_NODES && !included.has(node.id)) selected.push(node);
    });
  }
  const selectedIds = new Set(selected.map((node) => node.id));
  const visibleLinks = completeLinks
    .filter((link) => selectedIds.has(typeof link.source === 'string' ? link.source : link.source.id) && selectedIds.has(typeof link.target === 'string' ? link.target : link.target.id))
    .sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id))
    .slice(0, MAX_GRAPH_LINKS);
  const connectedIds = new Set(visibleLinks.flatMap((link) => [
    typeof link.source === 'string' ? link.source : link.source.id,
    typeof link.target === 'string' ? link.target : link.target.id
  ]));
  const visibleNodes = selected.filter((node) => connectedIds.has(node.id));
  const visibleGroups = groupCandidates.map((group) => ({
    key: group.key,
    value: group.value,
    criterion: group.criterion,
    label: `${etiquetaCriterioAgrupacion(group.criterion)}: ${group.value}`,
    index: group.index,
    nodeIds: visibleNodes.filter((node) => node.groupKey === group.key).map((node) => node.id)
  })).filter((group) => group.nodeIds.length).map((group, index) => ({ ...group, index }));

  return {
    nodes: visibleNodes,
    links: visibleLinks,
    groups: visibleGroups,
    totalNodes: completeNodes.length,
    totalLinks: completeLinks.length,
    limited: visibleNodes.length < completeNodes.length || visibleLinks.length < completeLinks.length
  };
}

interface UIManagerOptions {
  documentRef?: DocumentLike | null;
}


/**
 * Capa de acceso al DOM de las tres herramientas.
 * El flujo de negocio vive en main.ts; esta clase solo lee y pinta la interfaz.
 */
export class UIManager {
  private readonly document: DocumentLike | null | undefined;
  public ultimoResultado: ResultadoConsultaSoftware | null = null;
  private readonly themeManager: ThemeManager;
  public herramientaActiva: ToolName = 'consultor';
  private ultimoInformeReporte: InformeDirecto | null = null;
  private filtroTextoReporte = '';
  private filtroCategoriaReporte = 'todas';
  private readonly sugerencias = new Map<DomElementLike, string[]>();
  private readonly desplegables: Array<[DomElementLike, DomElementLike]> = [];
  private habilitarBitacora = false;
  private mostrarProgresoIndividual = false;
  private modalTrigger: DomElementLike | null = null;
  private readonly gruposContraidos = new Set<string>();

  private obtenerGruposResultado(resultado: ResultadoConsultaSoftware | null): GrupoSoftware[] {
    if (!resultado) return [];
    if (Array.isArray(resultado.grupos)) return resultado.grupos;

    // Compatibilidad de lectura con respuestas cacheadas del contrato anterior.
    const respuestaAnterior = resultado as unknown as Record<string, unknown>;
    const gruposAnteriores = respuestaAnterior['supertarjetas'];
    return Array.isArray(gruposAnteriores) ? gruposAnteriores as GrupoSoftware[] : [];
  }


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
  public cfgRutaReglas: DomElementLike | null = null;
  public btnExaminarReglas: DomElementLike | null = null;
  public cfgTamanoChunk: DomElementLike | null = null;
  public cfgGenerarDiscrepancias: DomElementLike | null = null;
  public cfgHabilitarBitacora: DomElementLike | null = null;
  public cfgMostrarProgresoIndividual: DomElementLike | null = null;
  public btnRestablecerConfigAnalizador: DomElementLike | null = null;

  public inputBuscarPrograma: DomElementLike | null = null;
  public inputBuscarVm: DomElementLike | null = null;
  public inputBuscarVersion: DomElementLike | null = null;
  public selectBuscarTipo: DomElementLike | null = null;
  public selectCriterioAgrupacion: DomElementLike | null = null;
  public inputBuscarResponsable: DomElementLike | null = null;
  public btnLimpiarPrograma: DomElementLike | null = null;
  public btnLimpiarVm: DomElementLike | null = null;
  public btnLimpiarVersion: DomElementLike | null = null;
  public btnLimpiarResponsable: DomElementLike | null = null;
  public btnLimpiarFiltros: DomElementLike | null = null;
  public suggestionsProgramas: DomElementLike | null = null;
  public suggestionsVms: DomElementLike | null = null;
  public suggestionsVersiones: DomElementLike | null = null;
  public suggestionsResponsables: DomElementLike | null = null;
  public btnEjecutarBusquedaSoftware: DomElementLike | null = null;
  public btnRecargarSoftware: DomElementLike | null = null;

  public lblSoftwareMetricas: DomElementLike | null = null;
  public consultorCardsWrapper: DomElementLike | null = null;
  public consultorTableWrapper: DomElementLike | null = null;
  public consultorGraphWrapper: DomElementLike | null = null;
  public btnConsultorVistaTarjetas: DomElementLike | null = null;
  public btnConsultorVistaTabla: DomElementLike | null = null;
  public btnConsultorVistaMapa: DomElementLike | null = null;
  public consultorEmptyState: DomElementLike | null = null;
  public consultorMoreFilters: DomElementLike | null = null;
  public consultorActiveFilters: DomElementLike | null = null;
  public consultorLoadingIndicator: DomElementLike | null = null;
  public consultorDatasourceBar: DomElementLike | null = null;
  public lblConsultorFuenteDatos: DomElementLike | null = null;
  public btnConsultorCambiarFuente: DomElementLike | null = null;
  public consultorViewMode: ConsultorViewMode = 'cards';
  public onConsultorFilterValueSelected: ((field: ConsultorTableField, value: string) => void) | null = null;
  private consultorTableSort: { field: ConsultorTableField; direction: 'asc' | 'desc' } | null = null;
  private consultorResultadosVisibles = false;
  private graphSimulation: ReturnType<typeof forceSimulation<ConsultorGraphNode>> | null = null;
  private graphCleanup: Array<() => void> = [];

  public modalConfigConsultor: DomElementLike | null = null;
  public btnCloseConfigConsultor: DomElementLike | null = null;
  public btnCancelarConfigConsultor: DomElementLike | null = null;
  public btnGuardarConfigConsultor: DomElementLike | null = null;
  public cfgRutaBdJson: DomElementLike | null = null;
  public cfgLimiteCoincidencias: DomElementLike | null = null;
  public btnExaminarBdJson: DomElementLike | null = null;

  constructor({
    documentRef = typeof document !== 'undefined'
      ? (document as unknown as DocumentLike)
      : null
  }: UIManagerOptions = {}) {
    this.document = documentRef;
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
    this.selectCriterioAgrupacion = get('selectCriterioAgrupacion');
    this.inputBuscarResponsable = get('inputBuscarResponsable');
    this.btnLimpiarPrograma = get('btnLimpiarPrograma');
    this.btnLimpiarVm = get('btnLimpiarVm');
    this.btnLimpiarVersion = get('btnLimpiarVersion');
    this.btnLimpiarResponsable = get('btnLimpiarResponsable');
    this.btnLimpiarFiltros = get('btnLimpiarFiltros');
    this.suggestionsProgramas = get('suggestionsProgramas');
    this.suggestionsVms = get('suggestionsVms');
    this.suggestionsVersiones = get('suggestionsVersiones');
    this.suggestionsResponsables = get('suggestionsResponsables');
    this.btnEjecutarBusquedaSoftware = get('btnEjecutarBusquedaSoftware');
    this.btnRecargarSoftware = get('btnRecargarSoftware');

    this.lblSoftwareMetricas = get('lblSoftwareMetricas');
    this.consultorCardsWrapper = get('consultorCardsWrapper');
    this.consultorTableWrapper = get('consultorTableWrapper');
    this.consultorGraphWrapper = get('consultorGraphWrapper');
    this.btnConsultorVistaTarjetas = get('btnConsultorVistaTarjetas');
    this.btnConsultorVistaTabla = get('btnConsultorVistaTabla');
    this.btnConsultorVistaMapa = get('btnConsultorVistaMapa');
    this.consultorEmptyState = get('consultorEmptyState');
    this.consultorMoreFilters = get('consultorMoreFilters');
    this.consultorActiveFilters = get('consultorActiveFilters');
    this.consultorLoadingIndicator = get('consultorLoadingIndicator');
    this.consultorDatasourceBar = get('consultorDatasourceBar');
    this.lblConsultorFuenteDatos = get('lblConsultorFuenteDatos');
    this.btnConsultorCambiarFuente = get('btnConsultorCambiarFuente');

    this.modalConfigConsultor = get('modalConfigConsultor');
    this.btnCloseConfigConsultor = get('btnCloseConfigConsultor');
    this.btnCancelarConfigConsultor = get('btnCancelarConfigConsultor');
    this.btnGuardarConfigConsultor = get('btnGuardarConfigConsultor');
    this.cfgRutaBdJson = get('cfgRutaBdJson');
    this.cfgLimiteCoincidencias = get('cfgLimiteCoincidencias');
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
    this.cfgRutaReglas = get('cfgRutaReglas');
    this.btnExaminarReglas = get('btnExaminarReglas');
    this.cfgTamanoChunk = get('cfgTamanoChunk');
    this.cfgGenerarDiscrepancias = get('cfgGenerarDiscrepancias');
    this.cfgHabilitarBitacora = get('cfgHabilitarBitacora');
    this.cfgMostrarProgresoIndividual = get('cfgMostrarProgresoIndividual');
    this.btnRestablecerConfigAnalizador = get('btnRestablecerConfigAnalizador');
  }

  private bindEvents(): void {
    const tabs: Array<{ button: DomElementLike | null; tool: ToolName }> = [
      { button: this.tabBtnAnalizador, tool: 'analizador' },
      { button: this.tabBtnConsultor, tool: 'consultor' },
      { button: this.tabBtnReporte, tool: 'reporte' }
    ];
    tabs.forEach(({ button, tool }, index) => {
      button?.addEventListener('click', () => this.seleccionarPestana(tool));
      button?.addEventListener('keydown', (event) => {
        if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key || '')) return;
        event.preventDefault?.();
        const nextIndex = event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? tabs.length - 1
            : (index + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + tabs.length) % tabs.length;
        const next = tabs[nextIndex];
        this.seleccionarPestana(next.tool);
        next.button?.focus?.();
      });
    });


    this.inputFiltrarSoftwareReporte?.addEventListener('input', () => this.renderTablaReporte());
    this.selectCategoriaSoftwareReporte?.addEventListener('change', () => this.renderTablaReporte());

    [this.modalConfigConsultor, this.modalConfigAnalizador].forEach((modal) => {
      modal?.addEventListener('click', (event) => {
        if (event.target === modal) this.cerrarModal(modal);
      });
      modal?.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault?.();
          this.cerrarModal(modal);
        }
      });
    });

    this.btnConsultorCambiarFuente?.addEventListener('click', () => {
      this.abrirModal(this.modalConfigConsultor, this.btnConsultorCambiarFuente);
    });

    this.configurarDesplegable(this.inputBuscarPrograma, this.suggestionsProgramas);
    this.configurarDesplegable(this.inputBuscarVm, this.suggestionsVms);
    this.configurarDesplegable(this.inputBuscarVersion, this.suggestionsVersiones);
    this.configurarDesplegable(this.inputBuscarResponsable, this.suggestionsResponsables);
    this.document?.addEventListener?.('click', (event) => {
      if (event.target?.closest?.('.consultor-filter-control')) return;
      this.cerrarDesplegables();
    });
    this.document?.addEventListener?.('keydown', (event) => {
      if (event.key === 'Escape') this.cerrarDesplegables();
    });
    const aplicarFiltroDesdeTarjeta = (event: { target?: DomElementLike | null; stopPropagation?: () => void }): boolean => {
      const boton = event.target?.closest?.('[data-consultor-filter]');
      const field = boton?.getAttribute('data-consultor-filter');
      const value = boton?.getAttribute('data-consultor-filter-value')?.trim();
      if (!field || !value || !this.esCampoTablaConsultor(field)) return false;
      event.stopPropagation?.();
      this.onConsultorFilterValueSelected?.(field, value);
      return true;
    };
    this.consultorCardsWrapper?.addEventListener('click', (event) => {
      if (aplicarFiltroDesdeTarjeta(event)) return;
      const boton = event.target?.closest?.('[data-grupo-toggle]');
      const clave = boton?.getAttribute('data-grupo-toggle');
      if (!clave) return;
      this.alternarExpansionGrupo(clave);
      this.renderGrupos(this.obtenerGruposResultado(this.ultimoResultado));
    });
    this.consultorGraphWrapper?.addEventListener('click', (event) => {
      aplicarFiltroDesdeTarjeta(event);
    });
    this.btnConsultorVistaTarjetas?.addEventListener('click', () => {
      this.seleccionarVistaConsultor('cards');
    });
    this.btnConsultorVistaTabla?.addEventListener('click', () => {
      this.seleccionarVistaConsultor('table');
    });
    this.btnConsultorVistaMapa?.addEventListener('click', () => {
      this.seleccionarVistaConsultor('map');
    });
    this.consultorTableWrapper?.addEventListener('click', (event) => {
      const sortButton = event.target?.closest?.('[data-consultor-sort]');
      const sortField = sortButton?.getAttribute('data-consultor-sort');
      if (sortField && this.esCampoTablaConsultor(sortField)) {
        this.alternarOrdenTabla(sortField);
        return;
      }

      const cell = event.target?.closest?.('[data-consultor-filter]');
      const field = cell?.getAttribute('data-consultor-filter');
      const value = cell?.getAttribute('data-consultor-filter-value')?.trim();
      if (field && value && this.esCampoTablaConsultor(field)) {
        this.onConsultorFilterValueSelected?.(field, value);
      }
    });
  }

  private configurarDesplegable(input: DomElementLike | null, menu: DomElementLike | null): void {
    if (!input || !menu) return;
    this.desplegables.push([input, menu]);
    input.addEventListener('focus', () => {
      this.actualizarDesplegable(input, menu);
    });
    input.addEventListener('input', () => {
      this.actualizarDesplegable(input, menu);
    });
    menu.addEventListener('click', (event) => {
      const option = event.target?.closest?.('[data-consultor-option]');
      const value = option?.getAttribute('data-consultor-option');
      if (value === null || value === undefined) return;
      input.value = value;
      const dispatch = (input as unknown as { dispatchEvent?: (event: Event) => boolean }).dispatchEvent;
      dispatch?.call(input, new Event('input', { bubbles: true }));
      this.cerrarDesplegable(input, menu);
    });
  }

  private actualizarDesplegable(input: DomElementLike, menu: DomElementLike): void {
    const query = input.value.trim().toLocaleLowerCase();
    const options = (this.sugerencias.get(menu) ?? [])
      .filter((value) => !query || value.toLocaleLowerCase().includes(query));
    menu.innerHTML = options.map((value) => `<div class="consultor-suggestion-option" role="option" data-consultor-option="${escapeHtml(value)}">${escapeHtml(value)}</div>`).join('');
    menu.classList.toggle('is-open', options.length > 0);
    input.setAttribute('aria-expanded', options.length > 0 ? 'true' : 'false');
  }

  private cerrarDesplegable(input: DomElementLike, menu: DomElementLike): void {
    menu.classList.remove('is-open');
    input.setAttribute('aria-expanded', 'false');
  }

  private cerrarDesplegables(): void {
    this.desplegables.forEach(([input, menu]) => this.cerrarDesplegable(input, menu));
  }

  aplicarTema(theme: Theme): Theme {
    return this.themeManager.aplicarTema(theme);
  }

  seleccionarPestana(tool: ToolName = 'consultor'): void {
    if (tool !== 'consultor') this.ocultarMapaConsultor();
    this.herramientaActiva = tool;
    const buttons = [this.tabBtnAnalizador, this.tabBtnConsultor, this.tabBtnReporte];
    const views = [this.viewAnalizador, this.viewConsultor, this.viewReporte];
    buttons.forEach((button) => {
      button?.classList.remove('active');
      button?.setAttribute('aria-selected', 'false');
    });
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
    selectedButton?.setAttribute('aria-selected', 'true');
    selectedView?.classList.add('active');
    if (tool === 'consultor' && this.consultorViewMode === 'map' && this.consultorResultadosVisibles) {
      this.renderMapaConsultor(this.obtenerResultadosPresentacion(this.ultimoResultado).tarjetas);
    }
    this.btnOpenAjustes?.setAttribute(
      'title',
      tool === 'consultor'
        ? 'Configurar la carpeta de inventario del Consultor'
        : 'Configurar opciones avanzadas del Analizador'
    );
  }

  mostrarVersion(version: unknown): void {
    const text = String(version || '').trim() || '—';
    if (this.appVersion) this.appVersion.textContent = `v${text.replace(/^v/i, '')}`;
  }

  sincronizarAjustes(config: Partial<AppConfig> = {}): void {
    if (this.cfgRutaBdJson) this.cfgRutaBdJson.value = config.ruta_bd_json || '';
    if (this.cfgLimiteCoincidencias) this.cfgLimiteCoincidencias.value = String(config.limite_coincidencias ?? 30);
    const ruta = config.ruta_bd_json?.trim();
    if (this.lblConsultorFuenteDatos) {
      this.lblConsultorFuenteDatos.textContent = ruta || 'Sin configurar';
      this.lblConsultorFuenteDatos.title = ruta || '';
    }
    this.consultorDatasourceBar?.classList.toggle('is-unset', !ruta);
  }

  sincronizarConfiguracionAnalizador(config: Partial<AnalyzerConfig> = {}): void {
    this.aplicarCamposModalAnalizador(config);
    if (this.inputNombreArchivoSalida) {
      this.inputNombreArchivoSalida.value = config.nombre_archivo_salida || 'Relevamiento_VMs.json';
    }
    if (this.lblHilosAccion) {
      this.lblHilosAccion.textContent = `Configuración: ${config.max_hilos || 2} hilos`;
    }
    this.habilitarBitacora = Boolean(config.habilitar_bitacora);
    this.mostrarProgresoIndividual = Boolean(config.mostrar_progreso_individual);
    if (this.wrapperBitacora) {
      this.wrapperBitacora.style.display = this.habilitarBitacora ? 'block' : 'none';
      if (!this.habilitarBitacora) this.wrapperBitacora.removeAttribute('open');
    }
    if (this.wrapperVmIndividual) {
      this.wrapperVmIndividual.style.display = this.mostrarProgresoIndividual ? 'flex' : 'none';
    }
  }

  /** Restablece solo los campos del modal, sin tocar el nombre de archivo del panel principal. */
  restablecerFormularioConfigAnalizador(config: Partial<AnalyzerConfig>): void {
    this.aplicarCamposModalAnalizador(config);
  }

  private aplicarCamposModalAnalizador(config: Partial<AnalyzerConfig>): void {
    if (this.cfgMaxHilos) this.cfgMaxHilos.value = String(config.max_hilos ?? 2);
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
  }

  leerFormularioConfiguracionAnalizador(): AnalyzerConfig {
    const hilos = Number(this.cfgMaxHilos?.value);
    const chunk = Number(this.cfgTamanoChunk?.value);
    let nombreArchivo = this.inputNombreArchivoSalida?.value.trim() || 'Relevamiento_VMs.json';
    if (!nombreArchivo.toLowerCase().endsWith('.json')) nombreArchivo += '.json';
    return {
      max_hilos: Number.isFinite(hilos) && hilos >= 1 ? Math.min(32, Math.round(hilos)) : 2,
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

  leerFormularioConfigConsultor(): Pick<AppConfig, 'ruta_bd_json' | 'limite_coincidencias'> {
    const limite = Number(this.cfgLimiteCoincidencias?.value);
    return {
      ruta_bd_json: this.cfgRutaBdJson?.value.trim() || '',
      limite_coincidencias: Number.isFinite(limite) ? Math.min(100, Math.max(10, Math.round(limite))) : 30
    };
  }

  abrirModal(modal: DomElementLike | null = this.modalConfigConsultor, trigger: DomElementLike | null = null): void {
    if (!modal) return;
    this.modalTrigger = trigger;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    this.enfocarPrimerCampoModal(modal);
  }

  private enfocarPrimerCampoModal(modal: DomElementLike): void {
    if (modal === this.modalConfigConsultor) {
      this.cfgRutaBdJson?.focus?.();
    } else if (modal === this.modalConfigAnalizador) {
      this.cfgMaxHilos?.focus?.();
    }
  }

  cerrarModal(modal: DomElementLike | null = this.modalConfigConsultor): void {
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    this.modalTrigger?.focus?.();
    this.modalTrigger = null;
  }

  actualizarBotonesLimpieza(): void {
    const buttons: Array<[DomElementLike | null, DomElementLike | null]> = [
      [this.btnLimpiarPrograma, this.inputBuscarPrograma],
      [this.btnLimpiarVm, this.inputBuscarVm],
      [this.btnLimpiarVersion, this.inputBuscarVersion],
      [this.btnLimpiarResponsable, this.inputBuscarResponsable]
    ];
    buttons.forEach(([button, input]) => {
      if (button) button.style.display = input?.value ? 'inline-flex' : 'none';
    });
  }

  limpiarFiltros(): void {
    if (this.inputBuscarPrograma) this.inputBuscarPrograma.value = '';
    if (this.inputBuscarVm) this.inputBuscarVm.value = '';
    if (this.inputBuscarVersion) this.inputBuscarVersion.value = '';
    if (this.selectBuscarTipo) this.selectBuscarTipo.value = 'todos';
    if (this.inputBuscarResponsable) this.inputBuscarResponsable.value = '';
    this.actualizarBotonesLimpieza();
    this.consultorMoreFilters?.removeAttribute('open');
    this.actualizarFiltrosActivos({});
  }

  poblarSugerenciasSoftware(
    programas: unknown[] = [],
    vms: unknown[] = [],
    versiones: unknown[] = [],
    responsables: unknown[] = []
  ): void {
    this.poblarDesplegable(this.suggestionsProgramas, programas);
    this.poblarDesplegable(this.suggestionsVms, vms);
    this.poblarDesplegable(this.suggestionsVersiones, versiones, 100);
    this.poblarDesplegable(this.suggestionsResponsables, responsables, 100);
  }

  poblarTipos(tipos: unknown[] = []): void {
    if (!this.selectBuscarTipo) return;
    const seleccionado = this.selectBuscarTipo.value;
    const opciones = uniqueValues(tipos).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
    this.selectBuscarTipo.innerHTML = [
      '<option value="todos">Todos</option>',
      ...opciones.map((tipo) => `<option value="${escapeHtml(tipo)}">${escapeHtml(tipo)}</option>`)
    ].join('');
    this.selectBuscarTipo.value = opciones.includes(seleccionado) ? seleccionado : 'todos';
  }

  private poblarDesplegable(container: DomElementLike | null, values: unknown[], limit = MAX_SUGGESTIONS): void {
    if (!container) return;
    const normalized = uniqueValues(values, limit);
    this.sugerencias.set(container, normalized);
    container.innerHTML = normalized
      .map((value) => `<div class="consultor-suggestion-option" role="option" data-consultor-option="${escapeHtml(value)}">${escapeHtml(value)}</div>`)
      .join('');
  }

  private esCampoTablaConsultor(value: string): value is ConsultorTableField {
    return CONSULTOR_TABLE_COLUMNS.some(({ field }) => field === value);
  }

  seleccionarVistaConsultor(mode: ConsultorViewMode): void {
    this.consultorViewMode = mode;
    [
      [this.btnConsultorVistaTarjetas, mode === 'cards'],
      [this.btnConsultorVistaTabla, mode === 'table'],
      [this.btnConsultorVistaMapa, mode === 'map']
    ].forEach(([button, active]) => {
      const element = button as DomElementLike | null;
      element?.classList.toggle('active', Boolean(active));
      element?.setAttribute('aria-pressed', String(Boolean(active)));
    });

    if (!this.consultorResultadosVisibles || !this.ultimoResultado) {
      this.ocultarMapaConsultor();
      this.consultorCardsWrapper?.classList.add('is-hidden');
      this.consultorTableWrapper?.classList.add('is-hidden');
      return;
    }

    const resultados = this.obtenerResultadosPresentacion(this.ultimoResultado);
    if (mode === 'table') {
      this.renderTabla(resultados.filas);
    } else if (mode === 'map') {
      this.renderMapaConsultor(resultados.tarjetas, resultados.grupos);
    } else if (resultados.grupos.length) {
      this.renderGrupos(resultados.grupos);
    } else {
      this.renderTarjetas(resultados.tarjetas);
    }
  }

  /**
   * Fuente única para tarjetas, tabla y métricas. Cuando el backend agrupa,
   * las tarjetas de sus grupos son el resultado canónico; sin grupos se usan
   * las coincidencias planas. La UI no vuelve a agrupar ni filtra estos datos.
   */
  private obtenerResultadosPresentacion(resultado: ResultadoConsultaSoftware | null): {
    grupos: GrupoSoftware[];
    filas: ConsultorTableRow[];
    tarjetas: CoincidenciaSoftware[];
  } {
    if (!resultado) return { grupos: [], filas: [], tarjetas: [] };

    const grupos = this.obtenerGruposResultado(resultado);
    const filas = grupos.length
      ? grupos.flatMap((grupo, indiceGrupo) => {
          const claveGrupo = sanitizarTexto(grupo.clave) || `grupo-${indiceGrupo}`;
          return (Array.isArray(grupo.tarjetas) ? grupo.tarjetas : []).map((item) => ({
            item,
            claveGrupo,
            indiceGrupo
          }));
        })
      : (Array.isArray(resultado.coincidencias) ? resultado.coincidencias : [])
        .map((item) => ({ item, claveGrupo: null, indiceGrupo: null }));

    return { grupos, filas, tarjetas: filas.map(({ item }) => item) };
  }

  private obtenerFilasTabla(resultado: ResultadoConsultaSoftware | null): ConsultorTableRow[] {
    return this.obtenerResultadosPresentacion(resultado).filas;
  }

  renderResultadosSoftware(
    resultado: ResultadoConsultaSoftware | null,
    filtros: Partial<SearchFilters> = {}
  ): void {
    this.ultimoResultado = resultado;
    this.consultorResultadosVisibles = false;
    this.actualizarFiltrosActivos(filtros);
    const resultados = this.obtenerResultadosPresentacion(resultado);
    const { grupos, filas: filasTabla, tarjetas } = resultados;
    // El contador visible se deriva de la misma colección que renderizan ambas vistas.
    const totalCoincidencias = tarjetas.length;
    const hayBase = Boolean(
      totalCoincidencias ||
      Number(resultado?.total_archivos_json) > 0 ||
      Number(resultado?.total_vms_escaneadas) > 0
    );
    const hayFiltro = Boolean(
      filtros.programa?.trim() ||
      filtros.vm?.trim() ||
      filtros.version?.trim() ||
      filtros.responsable?.trim() ||
      (filtros.tipo && filtros.tipo !== 'todos')
    );

    if (!hayBase) {
      this.limpiarResultados();
      this.mostrarEstado(
        'No se encontraron reportes JSON en la carpeta de inventario.',
        'Configura la carpeta de inventario desde Configuración para comenzar a consultar.'
      );
      this.actualizarMetricas('Sin reportes JSON encontrados. Configura la carpeta de inventario.');
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

    if (!totalCoincidencias) {
      this.limpiarResultados();
      this.mostrarEstado(
        'No se encontraron coincidencias.',
        `${formatNumber(resultado?.total_vms_escaneadas)} VMs fueron consultadas con los filtros actuales.`
      );
      this.actualizarMetricas(`${formatNumber(resultado?.total_vms_escaneadas)} VMs • 0 coincidencias`);
      return;
    }

    if (this.consultorEmptyState) this.consultorEmptyState.style.display = 'none';
    const vms = new Set(filasTabla.map(({ item }) => item.ruta_carpeta || item.nombre_vm)).size;
    const totalGrupos = grupos.length;
    this.actualizarMetricas(
      grupos.length
        ? `${totalCoincidencias} coincidencia(s) en ${totalGrupos} grupo(s) • ${vms} máquina(s) virtual(es) • ${formatNumber(resultado?.total_archivos_json)} reportes`
        : `${totalCoincidencias} coincidencia(s) en ${vms} máquina(s) virtual(es) • ${formatNumber(resultado?.total_archivos_json)} reportes`
    );
    this.consultorResultadosVisibles = true;
    if (this.consultorViewMode === 'table') {
      this.renderTabla(filasTabla);
    } else if (this.consultorViewMode === 'map') {
      this.renderMapaConsultor(tarjetas, grupos);
    } else if (grupos.length) {
      this.renderGrupos(grupos);
    } else {
      this.renderTarjetas(tarjetas);
    }
  }

  private actualizarFiltrosActivos(filtros: Partial<SearchFilters> = {}): void {
    if (this.consultorMoreFilters && (
      filtros.version?.trim() || filtros.responsable?.trim() || (filtros.tipo && filtros.tipo !== 'todos')
    )) {
      this.consultorMoreFilters.setAttribute('open', '');
    }
    if (!this.consultorActiveFilters) return;
    const chips: string[] = [];
    if (filtros.programa?.trim()) {
      chips.push(this.crearChipFiltro('programa', 'Programa', filtros.programa.trim()));
    }
    if (filtros.vm?.trim()) {
      chips.push(this.crearChipFiltro('vm', 'Máquina virtual', filtros.vm.trim()));
    }
    if (filtros.version?.trim()) {
      chips.push(this.crearChipFiltro('version', 'Versión', filtros.version.trim()));
    }
    if (filtros.tipo && filtros.tipo !== 'todos') {
      chips.push(this.crearChipFiltro('tipo', 'Tipo', filtros.tipo));
    }
    if (filtros.responsable?.trim()) {
      chips.push(this.crearChipFiltro('responsable', 'Responsable', filtros.responsable.trim()));
    }
    this.consultorActiveFilters.innerHTML = chips.join('');
    this.consultorActiveFilters.style.display = chips.length ? 'flex' : 'none';
  }

  private crearChipFiltro(field: string, label: string, value: string): string {
    return `<span class="consultor-filter-chip">${escapeHtml(label)}: ${escapeHtml(value)}<button type="button" class="consultor-filter-chip-clear" data-filter-clear="${field}" aria-label="Quitar filtro ${escapeHtml(label)}: ${escapeHtml(value)}">×</button></span>`;
  }

  renderTarjetas(items: CoincidenciaSoftware[]): void {
    if (!this.consultorCardsWrapper) return;
    this.ocultarMapaConsultor();
    this.consultorCardsWrapper.classList.remove('is-hidden');
    this.consultorTableWrapper?.classList.add('is-hidden');
    this.consultorCardsWrapper.innerHTML = items.map((item) => this.renderizarTarjetaSoftware(item)).join('');
    this.consultorCardsWrapper.style.display = 'flex';
  }

  renderGrupos(grupos: GrupoSoftware[]): void {
    if (!this.consultorCardsWrapper) return;
    this.ocultarMapaConsultor();
    this.consultorCardsWrapper.classList.remove('is-hidden');
    this.consultorTableWrapper?.classList.add('is-hidden');
    this.consultorCardsWrapper.innerHTML = grupos
      .map((grupo, indice) => this.renderizarGrupo(grupo, indice))
      .join('');
    this.consultorCardsWrapper.style.display = 'flex';
  }

  alternarOrdenTabla(field: ConsultorTableField): void {
    this.consultorTableSort = this.consultorTableSort?.field === field
      ? {
          field,
          direction: this.consultorTableSort.direction === 'asc' ? 'desc' : 'asc'
        }
      : { field, direction: 'asc' };
    if (this.consultorViewMode === 'table' && this.consultorResultadosVisibles) {
      this.renderTabla(this.obtenerFilasTabla(this.ultimoResultado));
    }
  }

  private normalizarFilaTabla(
    fila: CoincidenciaSoftware | ConsultorTableRow
  ): ConsultorTableRow {
    return 'item' in fila
      ? fila
      : { item: fila, claveGrupo: null, indiceGrupo: null };
  }

  renderTabla(items: Array<CoincidenciaSoftware | ConsultorTableRow>): void {
    if (!this.consultorTableWrapper) return;
    this.ocultarMapaConsultor();
    const sortedItems = items
      .map((fila, originalIndex) => ({ fila: this.normalizarFilaTabla(fila), originalIndex }))
      .sort((a, b) => {
        const comparison = this.compararFilasTabla(a.fila.item, b.fila.item);
        return comparison || a.originalIndex - b.originalIndex;
      });
    const activeSort = this.consultorTableSort;
    const headers = CONSULTOR_TABLE_COLUMNS.map(({ field, label }) => {
      const active = activeSort?.field === field;
      const direction = active ? activeSort.direction : null;
      const indicator = direction === 'asc' ? ' ↑' : direction === 'desc' ? ' ↓' : '';
      return `
        <th scope="col" aria-sort="${direction || 'none'}">
          <button type="button" class="consultor-table-sort" data-consultor-sort="${field}" aria-label="Ordenar por ${escapeHtml(label)}${direction ? `, ${direction === 'asc' ? 'ascendente' : 'descendente'}` : ''}">
            <span>${escapeHtml(label)}</span><span class="consultor-table-sort-indicator" aria-hidden="true">${indicator}</span>
          </button>
        </th>
      `;
    }).join('');
    const rows = sortedItems.map(({ fila, originalIndex }) => {
      const { item } = fila;
      const rowKey = this.crearClaveFilaTabla(item, originalIndex);
      const contrast = fila.indiceGrupo === null
        ? 'none'
        : fila.indiceGrupo % 2 === 0 ? 'even' : 'odd';
      const groupAttributes = fila.claveGrupo
        ? ` data-group-key="${escapeHtml(fila.claveGrupo)}"`
        : '';
      const cells = CONSULTOR_TABLE_COLUMNS.map(({ field, label }) => {
        const value = formatearValorTablaConsultor(item, field);
        const content = value.filterValue
          ? `<button type="button" class="consultor-table-cell-action" data-consultor-filter="${field}" data-consultor-filter-value="${escapeHtml(value.filterValue)}" aria-label="Filtrar por ${escapeHtml(label)}: ${escapeHtml(value.display)}">${escapeHtml(value.display)}</button>`
          : `<span class="consultor-table-cell-empty">${escapeHtml(value.display)}</span>`;
        return `<td data-cell-key="${escapeHtml(`${rowKey}-${field}`)}" class="${value.filterValue ? 'is-filterable' : 'is-empty'}">${content}</td>`;
      }).join('');
      return `<tr class="consultor-table-row consultor-table-row-group-${contrast}" data-row-key="${escapeHtml(rowKey)}" data-group-contrast="${contrast}"${groupAttributes}>${cells}</tr>`;
    }).join('');

    this.consultorCardsWrapper?.classList.add('is-hidden');
    this.consultorCardsWrapper?.style && (this.consultorCardsWrapper.style.display = 'none');
    this.consultorTableWrapper.classList.remove('is-hidden');
    this.consultorTableWrapper.style.display = 'block';
    this.consultorTableWrapper.innerHTML = `
      <div class="consultor-table-scroll">
        <table class="consultor-table">

          <thead><tr>${headers}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  private ocultarMapaConsultor(): void {
    this.graphSimulation?.stop();
    this.graphSimulation = null;
    this.graphCleanup.splice(0).forEach((cleanup) => cleanup());
    if (this.consultorGraphWrapper) {
      this.consultorGraphWrapper.innerHTML = '';
      this.consultorGraphWrapper.style.display = 'none';
      this.consultorGraphWrapper.classList.add('is-hidden');
    }
  }

  private renderMapaConsultor(items: CoincidenciaSoftware[], grupos: GrupoSoftware[] = []): void {
    const wrapper = this.consultorGraphWrapper;
    if (!wrapper) return;
    this.ocultarMapaConsultor();
    const model = crearModeloGrafoConsultor(items, grupos);
    wrapper.classList.remove('is-hidden');
    wrapper.style.display = 'block';
    this.consultorCardsWrapper?.classList.add('is-hidden');
    this.consultorCardsWrapper?.style && (this.consultorCardsWrapper.style.display = 'none');
    this.consultorTableWrapper?.classList.add('is-hidden');
    this.consultorTableWrapper?.style && (this.consultorTableWrapper.style.display = 'none');

    const limitNotice = model.limited
      ? `<p class="consultor-graph-limit" role="status">Para mantener el mapa ágil se muestran ${model.nodes.length} de ${model.totalNodes} nodos y ${model.links.length} de ${model.totalLinks} relaciones, priorizando los más conectados.</p>`
      : '';
    wrapper.innerHTML = `
      <section class="consultor-graph" aria-label="Mapa relacional de la consulta" data-graph-node-count="${model.nodes.length}" data-graph-link-count="${model.links.length}" data-graph-group-count="${model.groups.length}">
        <div class="consultor-graph-toolbar">
          <div class="consultor-graph-legend" aria-label="Leyenda del mapa">
            <span><i class="consultor-graph-legend-marker vm" aria-hidden="true"></i>Máquinas virtuales</span>
            <span><i class="consultor-graph-legend-marker software" aria-hidden="true"></i>Software</span>
          </div>
          <button class="step-btn consultor-graph-reset" type="button">Restablecer vista del mapa</button>
        </div>
        <p class="consultor-graph-help" id="consultorGraphHelp">Arrastrá nodos para reorganizarlos, usá la rueda o pinch para acercar y alejar, y restablecé la vista para reencuadrar.</p>
        ${limitNotice}
        <svg class="consultor-graph-canvas" role="group" aria-label="Grafo de máquinas virtuales y software" aria-describedby="consultorGraphHelp" tabindex="0">
          <rect class="consultor-graph-background" width="100%" height="100%"></rect>
          <g class="consultor-graph-viewport"><g class="consultor-graph-hulls" aria-hidden="true"></g><g class="consultor-graph-links"></g><g class="consultor-graph-nodes"></g><g class="consultor-graph-hull-labels" aria-hidden="true"></g></g>
        </svg>
        <div class="consultor-graph-detail" aria-live="polite" tabindex="-1">Seleccioná un nodo para ver sus detalles. También podés enfocarlo con Tab y usar Enter o Espacio.</div>
        <div class="consultor-graph-selected-card" aria-live="polite" hidden></div>
      </section>
    `;

    // Los dobles de prueba no implementan el DOM SVG; el contenido accesible sigue verificable.
    if (typeof document === 'undefined' || !(wrapper instanceof HTMLElement)) return;
    const svg = wrapper.querySelector<SVGSVGElement>('.consultor-graph-canvas');
    const viewport = wrapper.querySelector<SVGGElement>('.consultor-graph-viewport');
    const hullsLayer = wrapper.querySelector<SVGGElement>('.consultor-graph-hulls');
    const linksLayer = wrapper.querySelector<SVGGElement>('.consultor-graph-links');
    const nodesLayer = wrapper.querySelector<SVGGElement>('.consultor-graph-nodes');
    const hullLabelsLayer = wrapper.querySelector<SVGGElement>('.consultor-graph-hull-labels');
    const background = wrapper.querySelector<SVGRectElement>('.consultor-graph-background');
    const details = wrapper.querySelector<HTMLElement>('.consultor-graph-detail');
    const selectedCard = wrapper.querySelector<HTMLElement>('.consultor-graph-selected-card');
    const resetButton = wrapper.querySelector<HTMLButtonElement>('.consultor-graph-reset');
    if (!svg || !viewport || !hullsLayer || !linksLayer || !nodesLayer || !hullLabelsLayer || !background || !details || !selectedCard || !resetButton || !model.nodes.length) {
      if (!model.nodes.length && details) details.textContent = 'No hay relaciones completas entre máquinas virtuales y programas para representar en el mapa.';
      return;
    }

    const width = Math.max(svg.clientWidth || 0, 360);
    const height = 520;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('height', String(height));
    const createSvg = <T extends SVGElement>(name: string): T => document.createElementNS('http://www.w3.org/2000/svg', name) as T;
    const sourceId = (link: ConsultorGraphLink): string => typeof link.source === 'string' ? link.source : link.source.id;
    const targetId = (link: ConsultorGraphLink): string => typeof link.target === 'string' ? link.target : link.target.id;
    const hash = (value: string): number => [...value].reduce((total, character) => (total * 31 + character.charCodeAt(0)) >>> 0, 7);
    const columns = Math.max(1, Math.ceil(Math.sqrt(model.groups.length)));
    const rows = Math.max(1, Math.ceil(model.groups.length / columns));
    const groupCenters = new Map(model.groups.map((group) => [group.key, {
      x: width * ((group.index % columns) + 0.5) / columns,
      y: height * (Math.floor(group.index / columns) + 0.5) / rows
    }]));
    const nodeTarget = (node: ConsultorGraphNode): { x: number; y: number } => {
      const center = node.groupKey ? groupCenters.get(node.groupKey) : null;
      const baseX = center?.x ?? width / 2;
      const baseY = center?.y ?? height / 2;
      const sideOffset = node.type === 'vm' ? -width * 0.12 : width * 0.12;
      return {
        x: Math.max(node.radius + 12, Math.min(width - node.radius - 12, baseX + sideOffset)),
        y: baseY
      };
    };
    model.nodes.forEach((node) => {
      const seed = hash(node.id);
      const target = nodeTarget(node);
      node.x = target.x + (seed % 71) - 35;
      node.y = target.y + ((seed >>> 8) % 71) - 35;
    });

    const groupElements = new Map<ConsultorGraphGroup, { path: SVGPathElement; label: SVGTextElement; nodes: ConsultorGraphNode[] }>();
    const nodesById = new Map(model.nodes.map((node) => [node.id, node]));
    model.groups.forEach((graphGroup) => {
      const path = createSvg<SVGPathElement>('path');
      path.classList.add('consultor-graph-hull');
      path.setAttribute('aria-hidden', 'true');
      path.setAttribute('pointer-events', 'none');
      path.style.setProperty('--consultor-group-hull-hue', String(hash(graphGroup.key) % 360));
      hullsLayer.append(path);
      const label = createSvg<SVGTextElement>('text');
      label.classList.add('consultor-graph-hull-label');
      label.setAttribute('aria-hidden', 'true');
      label.setAttribute('pointer-events', 'none');
      label.style.setProperty('--consultor-group-hull-hue', String(hash(graphGroup.key) % 360));
      label.textContent = graphGroup.label;
      hullLabelsLayer.append(label);
      groupElements.set(graphGroup, {
        path,
        label,
        nodes: graphGroup.nodeIds.map((id) => nodesById.get(id)).filter((node): node is ConsultorGraphNode => Boolean(node))
      });
    });

    const linkElements = new Map<ConsultorGraphLink, SVGLineElement>();
    model.links.forEach((link) => {
      const line = createSvg<SVGLineElement>('line');
      line.classList.add('consultor-graph-link');
      line.style.strokeWidth = String(Math.min(5, 1 + Math.sqrt(link.weight)));
      line.style.opacity = String(Math.min(0.82, 0.3 + link.weight * 0.12));
      linksLayer.append(line);
      linkElements.set(link, line);
    });

    const nodeElements = new Map<ConsultorGraphNode, SVGGElement>();
    model.nodes.forEach((node) => {
      const group = createSvg<SVGGElement>('g');
      group.classList.add('consultor-graph-node', `consultor-graph-node-${node.type}`);
      group.setAttribute('tabindex', '0');
      group.setAttribute('role', 'button');
      group.setAttribute('aria-pressed', 'false');
      group.setAttribute('aria-label', `${node.type === 'vm' ? 'Máquina virtual' : 'Software'}: ${node.label}${node.version ? `, versión ${node.version}` : ''}. ${node.degree} relación(es).`);
      const title = createSvg<SVGTitleElement>('title');
      title.textContent = node.type === 'vm'
        ? `${node.label}: ${node.degree} programa(s) relacionado(s)`
        : `${node.label}${node.version ? ` ${node.version}` : ''}: ${node.degree} VM(s) relacionada(s)`;
      group.append(title);
      if (node.type === 'vm') {
        const circle = createSvg<SVGCircleElement>('circle');
        circle.setAttribute('r', String(node.radius));
        group.append(circle);
      } else {
        const rect = createSvg<SVGRectElement>('rect');
        rect.setAttribute('x', String(-node.radius));
        rect.setAttribute('y', String(-node.radius));
        rect.setAttribute('width', String(node.radius * 2));
        rect.setAttribute('height', String(node.radius * 2));
        rect.setAttribute('rx', '4');
        group.append(rect);
      }
      const label = createSvg<SVGTextElement>('text');
      label.setAttribute('y', String(node.radius + 14));
      const visibleLabel = `${node.label}${node.type === 'software' && node.version ? ` ${node.version}` : ''}`;
      label.textContent = visibleLabel.length > 28 ? `${visibleLabel.slice(0, 27)}…` : visibleLabel;
      group.append(label);
      nodesLayer.append(group);
      nodeElements.set(node, group);
    });

    let scale = 1;
    let panX = 0;
    let panY = 0;
    let selectedNode: ConsultorGraphNode | null = null;
    let highlightedNode: ConsultorGraphNode | null = null;
    let draggedNode: ConsultorGraphNode | null = null;
    let draggedNodePointerId: number | null = null;
    let draggedNodeStart: { x: number; y: number } | null = null;
    let nodeWasDragged = false;
    let panning = false;
    let pointerStart: { x: number; y: number; panX: number; panY: number } | null = null;
    const touchPoints = new Map<number, { x: number; y: number }>();
    let pinchStart: { distance: number; centerX: number; centerY: number; scale: number; panX: number; panY: number } | null = null;
    const transform = (): void => viewport.setAttribute('transform', `translate(${panX} ${panY}) scale(${scale})`);
    const updateDetails = (): void => {
      if (!selectedNode) {
        details.textContent = 'Seleccioná un nodo para ver sus detalles. También podés enfocarlo con Tab y usar Enter o Espacio.';
        return;
      }
      const node = selectedNode;
      details.textContent = node.type === 'vm'
        ? `Máquina virtual: ${node.label}. Sistema operativo: ${node.sistemaOperativo || 'No informado'}. Responsable: ${node.responsable || 'No informado'}. Tipo: ${node.tipo || 'No informado'}. ${node.degree} programa(s) relacionado(s).`
        : `Software: ${node.label}. Versión: ${node.version || 'No informada'}. Categoría: ${node.categoria || 'No informada'}. Editor: ${node.editor || 'No informado'}. ${node.degree} máquina(s) virtual(es) relacionada(s).`;
    };
    const updateHighlight = (): void => {
      const active = selectedNode || highlightedNode;
      const related = new Set<string>();
      if (active) {
        related.add(active.id);
        model.links.forEach((link) => {
          if (sourceId(link) === active.id) related.add(targetId(link));
          if (targetId(link) === active.id) related.add(sourceId(link));
        });
      }
      nodeElements.forEach((element, node) => {
        element.classList.toggle('is-dimmed', Boolean(active && !related.has(node.id)));
        element.classList.toggle('is-highlighted', highlightedNode === node || selectedNode === node);
        element.setAttribute('aria-pressed', String(selectedNode === node));
      });
      linkElements.forEach((element, link) => {
        element.classList.toggle('is-dimmed', Boolean(active && sourceId(link) !== active.id && targetId(link) !== active.id));
        element.classList.toggle('is-highlighted', Boolean(active && (sourceId(link) === active.id || targetId(link) === active.id)));
      });
    };
    const localCoordinates = (event: PointerEvent): { x: number; y: number } => {
      const rect = svg.getBoundingClientRect();
      return {
        x: (event.clientX - rect.left) * width / (rect.width || width),
        y: (event.clientY - rect.top) * height / (rect.height || height)
      };
    };
    const coordinates = (event: PointerEvent): { x: number; y: number } => {
      const point = localCoordinates(event);
      return { x: (point.x - panX) / scale, y: (point.y - panY) / scale };
    };
    const startPinch = (): void => {
      const points = [...touchPoints.values()];
      if (points.length < 2) return;
      const [first, second] = points;
      pinchStart = {
        distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
        centerX: (first.x + second.x) / 2,
        centerY: (first.y + second.y) / 2,
        scale,
        panX,
        panY
      };
      panning = false;
      pointerStart = null;
    };
    const relacionesDelNodo = (node: ConsultorGraphNode): Array<{ node: ConsultorGraphNode; weight: number }> => model.links
      .filter((link) => sourceId(link) === node.id || targetId(link) === node.id)
      .map((link) => {
        const relatedId = sourceId(link) === node.id ? targetId(link) : sourceId(link);
        return { node: model.nodes.find((candidate) => candidate.id === relatedId)!, weight: link.weight };
      })
      .filter((relation) => Boolean(relation.node))
      .sort((a, b) => a.node.label.localeCompare(b.node.label, 'es', { sensitivity: 'base', numeric: true }));
    const clearSelection = (): void => {
      selectedNode = null;
      selectedCard.hidden = true;
      selectedCard.innerHTML = '';
      updateDetails();
      updateHighlight();
    };
    const selectNode = (node: ConsultorGraphNode): void => {
      selectedNode = node;
      selectedCard.hidden = false;
      selectedCard.innerHTML = this.crearTarjetaDesdeNodoMapa(node, relacionesDelNodo(node));
      updateDetails();
      updateHighlight();
    };
    const listen = (target: EventTarget, type: string, listener: EventListener, options?: AddEventListenerOptions): void => {
      target.addEventListener(type, listener, options);
      this.graphCleanup.push(() => target.removeEventListener(type, listener, options));
    };

    nodeElements.forEach((element, node) => {
      const releaseNodePointer = (pointer: PointerEvent, selectWhenStationary: boolean): void => {
        if (draggedNode !== node || draggedNodePointerId !== pointer.pointerId) return;
        if (element.hasPointerCapture(pointer.pointerId)) element.releasePointerCapture(pointer.pointerId);
        node.fx = null;
        node.fy = null;
        simulation.alphaTarget(0);
        const wasDragged = nodeWasDragged || Boolean(draggedNodeStart && Math.hypot(
          pointer.clientX - draggedNodeStart.x,
          pointer.clientY - draggedNodeStart.y
        ) > 4);
        const shouldSelect = selectWhenStationary && !wasDragged;
        draggedNode = null;
        draggedNodePointerId = null;
        draggedNodeStart = null;
        nodeWasDragged = false;
        if (shouldSelect) selectNode(node);
      };
      listen(element, 'pointerdown', ((event: Event) => {
        const pointer = event as PointerEvent;
        if (pointer.button !== 0 || draggedNodePointerId !== null) return;
        pointer.preventDefault();
        draggedNode = node;
        draggedNodePointerId = pointer.pointerId;
        draggedNodeStart = { x: pointer.clientX, y: pointer.clientY };
        nodeWasDragged = false;
        const point = coordinates(pointer);
        node.fx = point.x;
        node.fy = point.y;
        element.setPointerCapture(pointer.pointerId);
        simulation.alphaTarget(0.25).restart();
      }) as EventListener);
      listen(element, 'pointermove', ((event: Event) => {
        const pointer = event as PointerEvent;
        if (draggedNode !== node || draggedNodePointerId !== pointer.pointerId) return;
        const point = coordinates(pointer);
        node.fx = point.x;
        node.fy = point.y;
        if (draggedNodeStart && Math.hypot(
          pointer.clientX - draggedNodeStart.x,
          pointer.clientY - draggedNodeStart.y
        ) > 4) {
          nodeWasDragged = true;
        }
      }) as EventListener);
      listen(element, 'pointerup', ((event: Event) => {
        const pointer = event as PointerEvent;
        if (pointer.button !== 0) return;
        releaseNodePointer(pointer, true);
      }) as EventListener);
      listen(element, 'pointercancel', ((event: Event) => {
        releaseNodePointer(event as PointerEvent, false);
      }) as EventListener);
      listen(element, 'pointerenter', (() => { highlightedNode = node; updateHighlight(); }) as EventListener);
      listen(element, 'pointerleave', (() => { highlightedNode = null; updateHighlight(); }) as EventListener);
      listen(element, 'focus', (() => { highlightedNode = node; updateHighlight(); }) as EventListener);
      listen(element, 'blur', (() => { highlightedNode = null; updateHighlight(); }) as EventListener);
      listen(element, 'keydown', ((event: Event) => {
        const keyboard = event as KeyboardEvent;
        if (keyboard.key === 'Enter' || keyboard.key === ' ') {
          keyboard.preventDefault();
          selectNode(node);
        }
      }) as EventListener);
    });

    const simulation = forceSimulation<ConsultorGraphNode>(model.nodes)
      .force('link', forceLink<ConsultorGraphNode, ConsultorGraphLink>(model.links).id((node) => node.id).distance((link) => 150 + Math.min(60, link.weight * 10)).strength(0.52))
      .force('charge', forceManyBody<ConsultorGraphNode>().strength(-340))
      .force('collide', forceCollide<ConsultorGraphNode>().radius((node) => node.radius + 28).strength(0.95))
      .force('x', forceX<ConsultorGraphNode>((node) => nodeTarget(node).x).strength((node) => node.type === 'vm' ? 0.18 : 0.11))
      .force('y', forceY<ConsultorGraphNode>((node) => nodeTarget(node).y).strength((node) => node.type === 'vm' ? 0.09 : 0.065));
    this.graphSimulation = simulation;
    simulation.on('tick', () => {
      linkElements.forEach((line, link) => {
        const source = typeof link.source === 'string' ? null : link.source;
        const target = typeof link.target === 'string' ? null : link.target;
        if (!source || !target) return;
        line.setAttribute('x1', String(source.x || 0));
        line.setAttribute('y1', String(source.y || 0));
        line.setAttribute('x2', String(target.x || 0));
        line.setAttribute('y2', String(target.y || 0));
      });
      nodeElements.forEach((element, node) => element.setAttribute('transform', `translate(${node.x || 0} ${node.y || 0})`));
      groupElements.forEach(({ path, label, nodes }) => {
        const geometry = calcularHullGrupoConsultor(nodes);
        if (!geometry) return;
        path.setAttribute('d', geometry.path);
        label.setAttribute('x', String(geometry.labelX));
        label.setAttribute('y', String(geometry.labelY));
      });
    });

    listen(svg, 'wheel', ((event: Event) => {
      const wheel = event as WheelEvent;
      wheel.preventDefault();
      const rect = svg.getBoundingClientRect();
      const localX = (wheel.clientX - rect.left) * width / (rect.width || width);
      const localY = (wheel.clientY - rect.top) * height / (rect.height || height);
      const nextScale = Math.max(0.45, Math.min(2.8, scale * Math.exp(-wheel.deltaY * 0.0015)));
      panX = localX - (localX - panX) * nextScale / scale;
      panY = localY - (localY - panY) * nextScale / scale;
      scale = nextScale;
      transform();
    }) as EventListener, { passive: false });
    listen(svg, 'pointerdown', ((event: Event) => {
      const pointer = event as PointerEvent;
      if (pointer.button !== 0 || (pointer.target !== svg && pointer.target !== background)) return;
      pointer.preventDefault();
      if (pointer.pointerType === 'touch') {
        touchPoints.set(pointer.pointerId, localCoordinates(pointer));
        if (touchPoints.size > 1) startPinch();
      }
      if (touchPoints.size < 2) {
        panning = true;
        pointerStart = { x: pointer.clientX, y: pointer.clientY, panX, panY };
      }
      svg.setPointerCapture?.(pointer.pointerId);
    }) as EventListener);
    listen(svg, 'pointermove', ((event: Event) => {
      const pointer = event as PointerEvent;
      if (pointer.pointerType === 'touch' && touchPoints.has(pointer.pointerId)) {
        touchPoints.set(pointer.pointerId, localCoordinates(pointer));
        if (pinchStart && touchPoints.size > 1) {
          const [first, second] = [...touchPoints.values()];
          const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
          const nextScale = Math.max(0.45, Math.min(2.8, pinchStart.scale * distance / pinchStart.distance));
          const centerX = (first.x + second.x) / 2;
          const centerY = (first.y + second.y) / 2;
          panX = centerX - (pinchStart.centerX - pinchStart.panX) * nextScale / pinchStart.scale;
          panY = centerY - (pinchStart.centerY - pinchStart.panY) * nextScale / pinchStart.scale;
          scale = nextScale;
          transform();
          return;
        }
      }
      if (!panning || !pointerStart) return;
      const rect = svg.getBoundingClientRect();
      panX = pointerStart.panX + (pointer.clientX - pointerStart.x) * width / (rect.width || width);
      panY = pointerStart.panY + (pointer.clientY - pointerStart.y) * height / (rect.height || height);
      transform();
    }) as EventListener);
    const finishSvgPointer = (event: Event, cancelled = false): void => {
      const pointer = event as PointerEvent;
      if (!cancelled && pointer.button !== 0) return;
      touchPoints.delete(pointer.pointerId);
      if (touchPoints.size > 1) startPinch();
      else {
        pinchStart = null;
        panning = false;
        pointerStart = null;
      }
      if (svg.hasPointerCapture?.(pointer.pointerId)) svg.releasePointerCapture(pointer.pointerId);
    };
    listen(svg, 'pointerup', (event => finishSvgPointer(event)) as EventListener);
    listen(svg, 'pointercancel', (event => finishSvgPointer(event, true)) as EventListener);
    const clearSelectionOnEscape = ((event: Event): void => {
      const keyboard = event as KeyboardEvent;
      if (keyboard.key !== 'Escape') return;
      keyboard.preventDefault();
      clearSelection();
    }) as EventListener;
    listen(wrapper, 'keydown', clearSelectionOnEscape);
    const documentTarget = this.document as unknown as {
      addEventListener?: (type: string, listener: EventListener) => void;
      removeEventListener?: (type: string, listener: EventListener) => void;
    } | null;
    if (documentTarget?.addEventListener && documentTarget.removeEventListener) {
      documentTarget.addEventListener('keydown', clearSelectionOnEscape);
      this.graphCleanup.push(() => documentTarget.removeEventListener?.('keydown', clearSelectionOnEscape));
    }
    listen(resetButton, 'click', (() => {
      scale = 1;
      panX = 0;
      panY = 0;
      transform();
      clearSelection();
      simulation.alpha(0.5).restart();
    }) as EventListener);
  }

  private crearClaveFilaTabla(item: CoincidenciaSoftware, index: number): string {
    const identity = [item.nombre_programa, item.nombre_vm, item.version, item.tipo, item.responsable, item.archivo_json]
      .map((value) => sanitizarTexto(value) || '')
      .join('|');
    return `resultado-${index}-${identity || 'sin-datos'}`;
  }

  private compararFilasTabla(a: CoincidenciaSoftware, b: CoincidenciaSoftware): number {
    if (!this.consultorTableSort) return 0;
    const { field, direction } = this.consultorTableSort;
    const aValue = formatearValorTablaConsultor(a, field).filterValue;
    const bValue = formatearValorTablaConsultor(b, field).filterValue;
    const aEmpty = !aValue;
    const bEmpty = !bValue;
    if (aEmpty || bEmpty) {
      if (aEmpty && bEmpty) return 0;
      return aEmpty ? 1 : -1;
    }

    const aNumber = Number(aValue);
    const bNumber = Number(bValue);
    let comparison: number;
    if (Number.isFinite(aNumber) && Number.isFinite(bNumber)) {
      comparison = aNumber - bNumber;
    } else {
      const aDate = Date.parse(aValue);
      const bDate = Date.parse(bValue);
      comparison = Number.isFinite(aDate) && Number.isFinite(bDate)
        ? aDate - bDate
        : aValue.localeCompare(bValue, 'es', { sensitivity: 'base', numeric: true });
    }
    return direction === 'asc' ? comparison : -comparison;
  }

  alternarExpansionGrupo(clave: string): void {
    if (this.gruposContraidos.has(clave)) this.gruposContraidos.delete(clave);
    else this.gruposContraidos.add(clave);
  }

  renderizarGrupo(grupo: GrupoSoftware, indice: number): string {
    const clave = sanitizarTexto(grupo.clave) || `grupo-${indice}`;
    const valor = sanitizarTexto(grupo.valor) || 'Sin información';
    const tarjetas = Array.isArray(grupo.tarjetas) ? grupo.tarjetas : [];
    const cantidad = Number.isFinite(Number(grupo.cantidad_tarjetas))
      ? Number(grupo.cantidad_tarjetas)
      : tarjetas.length;
    const contraido = this.gruposContraidos.has(clave);
    const cuerpoId = `consultor-grupo-${indice}`;
    const resumen = grupo.resumen ?? {};
    const detalle = [
      ['Sistemas operativos', uniqueValues(resumen.sistemas_operativos ?? []).join(', ')],
      ['Responsables', uniqueValues(resumen.responsables ?? []).join(', ')],
      ['Categorías', uniqueValues(resumen.categorias ?? []).join(', ')]
    ].filter(([, valorResumen]) => Boolean(valorResumen))
      .map(([etiqueta, valorResumen]) => `<div><dt>${escapeHtml(etiqueta)}</dt><dd>${escapeHtml(valorResumen)}</dd></div>`)
      .join('');
    return `
      <section class="consultor-group-card" aria-labelledby="${cuerpoId}-titulo">
        <header class="consultor-group-card-header" data-grupo-toggle="${escapeHtml(clave)}">
          <h3 id="${cuerpoId}-titulo" class="consultor-group-heading">
            <button type="button" class="consultor-group-toggle" data-grupo-toggle="${escapeHtml(clave)}" aria-expanded="${String(!contraido)}" aria-controls="${cuerpoId}">
              <span>${escapeHtml(valor)}</span>
              <span class="consultor-group-count" aria-label="${cantidad} tarjetas">${cantidad} ${cantidad === 1 ? 'tarjeta' : 'tarjetas'}</span>
              <span class="consultor-group-state">${contraido ? 'Expandir' : 'Contraer'}</span>
            </button>
          </h3>
          ${detalle ? `<dl class="consultor-group-summary">${detalle}</dl>` : ''}
        </header>
        <div id="${cuerpoId}" class="consultor-group-cards" ${contraido ? 'hidden' : ''}>
          ${tarjetas.map((item) => this.renderizarTarjetaSoftware(item)).join('')}
        </div>
      </section>
    `;
  }

  renderizarTarjetaSoftware(item: CoincidenciaSoftware = {}): string {
    return this.crearTarjeta(item);
  }

  crearTarjeta(item: CoincidenciaSoftware = {}): string {
    const programa = sanitizarTexto(item.nombre_programa);
    const virtual = sanitizarTexto(item.nombre_vm);
    const responsable = sanitizarTexto(item.responsable)
      || deducirResponsableDesdeArchivo(item.archivo_json);
    if (!programa && !virtual && responsable) return this.crearTarjetaAsignado(responsable, item.tipo);
    if (!programa && virtual) return this.crearTarjetaVirtual(item);
    return this.crearTarjetaPrograma(item);
  }

  private crearTarjetaDesdeNodoMapa(
    node: ConsultorGraphNode,
    relaciones: Array<{ node: ConsultorGraphNode; weight: number }>
  ): string {
    const esVm = node.type === 'vm';
    const tipoNodo = esVm ? 'Máquina virtual' : 'Software';
    const tipoRelacionado = esVm ? 'programa' : 'máquina virtual';
    const tipoRelacionadoPlural = esVm ? 'programas' : 'máquinas virtuales';
    const relacionesOcultas = Math.max(0, node.degree - relaciones.length);
    const coincidencias = relaciones.reduce((total, relation) => total + relation.weight, 0);
    const etiquetaVersion = !esVm && node.version ? `<span class="consultor-graph-context-badge">v${escapeHtml(node.version)}</span>` : '';
    const etiquetaCategoria = !esVm && node.categoria ? `<span class="consultor-graph-context-badge is-subtle">${escapeHtml(node.categoria)}</span>` : '';
    const tags = !esVm && node.tags.length
      ? `<div class="consultor-graph-context-tags" aria-label="Etiquetas">${node.tags.map((tag) => `<span class="consultor-tag-pill">#${escapeHtml(tag)}</span>`).join('')}</div>`
      : '';
    const campos = esVm
      ? [
          ['Sistema operativo', node.sistemaOperativo || 'No informado'],
          ['Responsable', node.responsable || 'No informado'],
          ['Tipo de inventario', node.tipo || 'No informado'],
          ['Ubicación', node.ubicacion || 'No informada']
        ]
      : [
          ['Versión', node.version || 'No informada'],
          ['Categoría', node.categoria || 'No informada'],
          ['Editor', node.editor || 'No informado'],
          ['Tipo de inventario', node.tipo || 'No informado']
        ];
    const ficha = campos
      .map(([etiqueta, valor]) => `<div><dt>${escapeHtml(etiqueta)}</dt><dd title="${escapeHtml(valor)}">${escapeHtml(valor)}</dd></div>`)
      .join('');
    const listaRelaciones = relaciones.map(({ node: relacionado, weight }) => {
      const meta = (relacionado.type === 'software'
        ? [relacionado.version ? `v${relacionado.version}` : null, relacionado.categoria, relacionado.editor]
        : [relacionado.sistemaOperativo, relacionado.responsable, relacionado.ubicacion])
        .filter((value): value is string => Boolean(value))
        .slice(0, 2);
      const field: ConsultorTableField = relacionado.type === 'vm' ? 'vm' : 'programa';
      const ariaLabel = `Filtrar por ${relacionado.type === 'vm' ? 'máquina virtual' : 'programa'}: ${relacionado.label}`;
      return `
        <li>
          <button type="button" class="consultor-graph-relation" data-consultor-filter="${field}" data-consultor-filter-value="${escapeHtml(relacionado.label)}" aria-label="${escapeHtml(ariaLabel)}">
            <span class="consultor-graph-relation-name">${escapeHtml(relacionado.label)}</span>
            ${meta.length ? `<span class="consultor-graph-relation-meta">${meta.map(escapeHtml).join(' · ')}</span>` : ''}
          </button>
          <span class="consultor-graph-relation-count">${weight === 1 ? '1 coincidencia' : `${weight} coincidencias`}</span>
        </li>`;
    }).join('');
    const resumenAlcance = relacionesOcultas
      ? `Se muestran ${relaciones.length} de ${node.degree} relaciones directas; ${relacionesOcultas} quedan fuera de este encuadre.`
      : `Todas sus relaciones directas están visibles en este encuadre.`;

    return `
      <article class="consultor-graph-context-card consultor-graph-context-card-${node.type}">
        <header class="consultor-graph-context-header">
          <div>
            <p class="consultor-graph-context-eyebrow">Nodo seleccionado · ${tipoNodo}</p>
            <h3>${escapeHtml(node.label)}</h3>
          </div>
          <div class="consultor-graph-context-badges">${etiquetaVersion}${etiquetaCategoria}</div>
        </header>
        <div class="consultor-graph-context-summary">
          <div class="consultor-graph-context-metric">
            <strong>${relaciones.length}</strong>
            <span>${relaciones.length === 1 ? tipoRelacionado : tipoRelacionadoPlural} visibles</span>
          </div>
          <div class="consultor-graph-context-metric">
            <strong>${coincidencias}</strong>
            <span>${coincidencias === 1 ? 'coincidencia' : 'coincidencias'}</span>
          </div>
          <p>${escapeHtml(resumenAlcance)}</p>
        </div>
        <div class="consultor-graph-context-content">
          <section aria-labelledby="consultorGraphFicha">
            <h4 id="consultorGraphFicha">Ficha del nodo</h4>
            <dl class="consultor-graph-context-details">${ficha}</dl>
            ${tags}
          </section>
          <section class="consultor-graph-context-relations" aria-labelledby="consultorGraphRelaciones">
            <div class="consultor-graph-context-section-heading">
              <h4 id="consultorGraphRelaciones">Relaciones directas</h4>
              <span>${relaciones.length} visibles</span>
            </div>
            <ul>${listaRelaciones || `<li class="consultor-graph-empty-relations">No hay relaciones visibles.</li>`}</ul>
          </section>
        </div>
        <footer class="consultor-graph-context-actions">
          ${this.crearBotonFiltroTarjeta(esVm ? 'vm' : 'programa', node.label, tipoNodo.toLocaleLowerCase())}
        </footer>
      </article>
    `;
  }

  private crearBotonFiltroTarjeta(field: ConsultorTableField, value: string | null, label: string): string {
    const disabled = !value;
    return `<button type="button" class="step-btn consultor-card-filter" data-consultor-filter="${field}"${value ? ` data-consultor-filter-value="${escapeHtml(value)}"` : ''}${disabled ? ' disabled' : ''} aria-label="Filtrar solo por ${escapeHtml(label)}${value ? `: ${escapeHtml(value)}` : ''}">Filtrar solo por</button>`;
  }

  private crearTarjetaPrograma(item: CoincidenciaSoftware): string {
    const { disco, ubicacion } = extraerInfoDisco(item.ruta_carpeta);
    const programa = sanitizarTexto(item.nombre_programa);
    const tipo = sanitizarTexto(item.tipo) || 'Sin tipo';
    const responsable = sanitizarTexto(item.responsable)
      || deducirResponsableDesdeArchivo(item.archivo_json)
      || 'Sin responsable';
    const tags = Array.isArray(item.tags)
      ? item.tags.map((tag) => `<span class="consultor-tag-pill">#${escapeHtml(tag)}</span>`).join('')
      : '';
    const version = item.version
      ? `<span class="consultor-version-badge">v${escapeHtml(item.version)}</span>`
      : '';
    const category = item.categoria
      ? `<span class="consultor-category-badge">${escapeHtml(item.categoria)}</span>`
      : '';
    const classification = sanitizarTexto(item.editor) || sanitizarTexto(item.categoria) || tipo;
    const editor = item.editor
      ? `<span class="consultor-editor-tag">• ${escapeHtml(item.editor)}</span>`
      : '';
    const internalName = item.nombre_interno && item.nombre_interno !== item.nombre_vm
      ? ` <span class="consultor-editor-tag">(${escapeHtml(item.nombre_interno)})</span>`
      : '';

    return `
      <article class="consultor-card">
        <div class="consultor-card-header">
          <div class="consultor-app-title">
            <strong>${escapeHtml(programa || 'Programa sin nombre')}</strong>
            ${version}${category}${editor}
          </div>
          <span class="consultor-type-badge" title="Tipo de inventario">${escapeHtml(tipo)}</span>
          <span class="consultor-responsable-badge"><strong>Responsable:</strong> ${escapeHtml(responsable)}</span>
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
              <span>Clasificación: ${escapeHtml(classification)}</span>
              <span>Reporte: ${escapeHtml(item.archivo_json || '-')}</span>
              <span>• ${escapeHtml(item.fecha_relevamiento || 'Fecha desconocida')}</span>
            </div>
          </div>
        </div>
        <div class="consultor-card-actions">${this.crearBotonFiltroTarjeta('programa', programa, 'programa')}</div>
      </article>
    `;
  }

  private crearTarjetaVirtual(item: CoincidenciaSoftware): string {
    const virtual = sanitizarTexto(item.nombre_vm);
    const { ubicacion } = extraerInfoDisco(item.ruta_carpeta);
    const responsable = sanitizarTexto(item.responsable)
      || deducirResponsableDesdeArchivo(item.archivo_json)
      || 'Sin responsable';
    return `
      <article class="consultor-card consultor-card-virtual">
        <div class="consultor-card-header"><strong>${escapeHtml(virtual || 'VM desconocida')}</strong></div>
        <div class="consultor-card-body consultor-card-entity-details">
          <span><strong>Sistema operativo:</strong> ${escapeHtml(item.sistema_operativo || 'SO desconocido')}</span>
          <span><strong>Ubicación:</strong> ${escapeHtml(ubicacion || 'No informada')}</span>
          <span><strong>Asignado:</strong> ${escapeHtml(responsable)}</span>
        </div>
        <div class="consultor-card-actions">${this.crearBotonFiltroTarjeta('vm', virtual, 'máquina virtual')}</div>
      </article>
    `;
  }

  private crearTarjetaAsignado(responsable: string, tipo: unknown): string {
    return `
      <article class="consultor-card consultor-card-asignado">
        <div class="consultor-card-header"><strong>${escapeHtml(responsable)}</strong></div>
        <div class="consultor-card-body consultor-card-entity-details">
          <span><strong>Tipo de asignado:</strong> ${escapeHtml(sanitizarTexto(tipo) || 'Sin tipo')}</span>
        </div>
        <div class="consultor-card-actions">${this.crearBotonFiltroTarjeta('responsable', responsable, 'asignado')}</div>
      </article>
    `;
  }

  private limpiarResultados(): void {
    this.consultorResultadosVisibles = false;
    this.ocultarMapaConsultor();
    if (this.consultorCardsWrapper) {
      this.consultorCardsWrapper.innerHTML = '';
      this.consultorCardsWrapper.style.display = 'none';
      this.consultorCardsWrapper.classList.remove('is-hidden');
    }
    if (this.consultorTableWrapper) {
      this.consultorTableWrapper.innerHTML = '';
      this.consultorTableWrapper.style.display = 'none';
      this.consultorTableWrapper.classList.remove('is-hidden');
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
    this.mostrarEstado(
      'No se pudo completar la consulta.',
      `${String(error)} Revisa la carpeta de inventario configurada e intenta nuevamente con «Recargar reportes».`
    );
    this.actualizarMetricas(`Error al consultar los reportes: ${error}`);
  }

  setRecargando(active: boolean): void {
    this.btnRecargarSoftware?.classList.toggle('spinning', active);
    this.consultorDatasourceBar?.setAttribute('aria-busy', active ? 'true' : 'false');
    if (this.btnEjecutarBusquedaSoftware) this.btnEjecutarBusquedaSoftware.disabled = active;
    if (this.consultorLoadingIndicator) {
      this.consultorLoadingIndicator.style.display = active ? 'inline-flex' : 'none';
    }
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
      this.lblHilosAccion.textContent = listo ? 'Iniciar análisis' : 'Selecciona origen y destino';
    }
  }

  setEstadoAnalizador(ejecutando: boolean, cancelando = false): void {
    if (this.lblTitleAccion) this.lblTitleAccion.textContent = ejecutando ? 'Cancelar' : 'Iniciar análisis';
    if (this.lblHilosAccion) {
      this.lblHilosAccion.textContent = cancelando
        ? 'Cancelando...'
        : ejecutando
          ? 'Detener análisis'
          : 'Iniciar análisis';
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
    this.sysDiagnosticText.textContent = `${diagnostico.equipo_ejecucion} • ${diagnostico.sistema_operativo} (${diagnostico.arquitectura}) • ${diagnostico.hilos_cpu} CPUs`;
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
      this.barGlobal.setAttribute('aria-valuenow', progreso.toFixed(1));
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
      if (this.barVmIndividual) {
        const progresoVm = Math.min(100, Math.max(0, Number(estado.progreso_vm_actual) || 0));
        this.barVmIndividual.style.width = `${progresoVm}%`;
        this.barVmIndividual.setAttribute('aria-valuenow', progresoVm.toFixed(1));
      }
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
      this.wrapperBitacora.style.display = 'block';
      const faseEnCurso = ['iniciando', 'escaneando_directorio', 'analizando_v_ms', 'generando_reporte']
        .includes(estado.fase);
      const mostrarBitacora = faseEnCurso || estado.fase === 'error' || estado.fase === 'cancelado';
      if (mostrarBitacora) {
        this.wrapperBitacora.setAttribute('open', '');
      } else if (estado.fase === 'finalizado') {
        this.wrapperBitacora.removeAttribute('open');
      }
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
    if (this.wrapperBitacora && !resumen.cancelado) this.wrapperBitacora.removeAttribute('open');
    this.analyzerSummary.style.display = 'block';
    this.analyzerSummary.textContent = resumen.cancelado
      ? `Relevamiento cancelado: ${resumen.total_vms} VM(s), informe parcial en ${resumen.ruta_informe || 'el destino seleccionado'}.`
      : `Relevamiento finalizado: ${resumen.total_vms} VM(s), ${resumen.total_programas} programas y ${resumen.peso_total_gb.toFixed(2)} GB procesados en ${resumen.duracion_formateada}. Informe: ${resumen.ruta_informe}`;
  }

  mostrarErrorAnalizador(error: unknown): void {
    if (!this.analyzerSummary) return;
    if (this.wrapperBitacora && this.habilitarBitacora) this.wrapperBitacora.setAttribute('open', '');
    this.analyzerSummary.style.display = 'block';
    this.analyzerSummary.textContent = `No se pudo completar el relevamiento: ${String(error)} Revisa el origen, el destino y la configuración avanzada, y vuelve a intentarlo.`;
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
    const numero = Number(progreso.porcentaje);
    const porcentaje = Number.isFinite(numero) ? Math.min(100, Math.max(0, numero)) : 0;
    if (this.barProgresoReporte) {
      this.barProgresoReporte.style.width = `${porcentaje}%`;
      this.barProgresoReporte.setAttribute('aria-valuenow', String(porcentaje));
    }
    if (this.lblPorcentajeReporte) this.lblPorcentajeReporte.textContent = `${porcentaje}%`;
    if (this.lblEtapaReporte) this.lblEtapaReporte.textContent = progreso.etapa || 'Analizando...';
    if (this.lblDetalleReporte) this.lblDetalleReporte.textContent = progreso.detalle || '';
  }

  setEstadoReporte(ejecutando: boolean, conservarProgreso = false): void {
    if (this.wrapperProgresoReporte) {
      this.wrapperProgresoReporte.style.display = ejecutando || conservarProgreso ? 'flex' : 'none';
    }
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
      this.reporteEmptyState.innerHTML = `<div class="empty-state-title">No se pudo generar el reporte.</div><div class="empty-state-detail">${escapeHtml(error)} Verifica que el archivo exista y sea accesible, y vuelve a intentarlo.</div>`;
    }
  }
}

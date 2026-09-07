/**
 * @file graph-view.js
 * @description Visualizador de grafo y diagrama relacional interactivo en SVG para el Consultor de Software.
 * @module js/graph-view
 */

import { extraerInfoDisco, escapeHtml, truncarTexto } from './utils.js';

/**
 * @typedef {Object} GraphNode
 * @property {string} id - Identificador único del nodo.
 * @property {'app'|'vm'|'owner'|'disk_entity'|'server_entity'} type - Tipo de nodo para estilización.
 * @property {string} title - Título principal visible.
 * @property {string} subtitle - Subtítulo o metadato descriptivo.
 * @property {Object} data - Datos completos asociados al nodo.
 * @property {number} [x] - Posición X calculada.
 * @property {number} [y] - Posición Y calculada.
 * @property {number} [w] - Ancho del nodo en píxeles.
 * @property {number} [h] - Altura del nodo en píxeles.
 */

/**
 * @typedef {Object} GraphLink
 * @property {string} id - Identificador único del enlace.
 * @property {string} source - ID del nodo de origen.
 * @property {string} target - ID del nodo de destino.
 */

/**
 * Clase que orquesta el renderizado, interacción y transformaciones (zoom/pan) del diagrama relacional en SVG.
 */
export class GraphView {
  /**
   * Crea una instancia de GraphView.
   * @param {Object} domElements - Mapeo de elementos DOM del visor de grafo.
   * @param {function(string, string): void} onFiltrarCallback - Callback para filtrar el consultor al hacer click en un nodo.
   */
  constructor(domElements, onFiltrarCallback) {
    this.wrapper = domElements.consultorGraphWrapper;
    this.canvasContainer = domElements.graphCanvasContainer;
    this.svg = domElements.consultorGraphSvg;
    this.btnZoomIn = domElements.btnGraphZoomIn;
    this.btnZoomOut = domElements.btnGraphZoomOut;
    this.btnFit = domElements.btnGraphFit;
    this.tooltip = domElements.graphTooltip;
    this.drawer = domElements.graphDetailDrawer;
    this.drawerTitle = domElements.drawerTitle;
    this.drawerBody = domElements.drawerBody;
    this.btnCloseDrawer = domElements.btnCloseDetailDrawer;

    this.onFiltrarCallback = onFiltrarCallback;
    this.onAbrirUbicacionCallback = null;

    // Estado de transformación y arrastre
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.rafId = null;

    this.initEvents();
  }

  /**
   * Inicializa los listeners de eventos para interactividad, zoom, arrastre y cierre de paneles.
   * @private
   */
  initEvents() {
    if (this.btnCloseDrawer) {
      this.btnCloseDrawer.addEventListener('click', () => {
        if (this.drawer) this.drawer.style.display = 'none';
      });
    }

    if (this.btnZoomIn) {
      this.btnZoomIn.addEventListener('click', () => {
        this.zoom = Math.min(2.5, this.zoom * 1.25);
        this.scheduleTransform();
      });
    }

    if (this.btnZoomOut) {
      this.btnZoomOut.addEventListener('click', () => {
        this.zoom = Math.max(0.3, this.zoom / 1.25);
        this.scheduleTransform();
      });
    }

    if (this.btnFit) {
      this.btnFit.addEventListener('click', () => {
        this.ajustarZoom();
      });
    }

    if (this.canvasContainer) {
      this.canvasContainer.addEventListener('mousedown', (e) => {
        if (e.target.closest('.graph-floating-toolbar') || e.target.closest('.graph-detail-drawer') || e.target.closest('.graph-node')) return;
        this.isDragging = true;
        this.dragStartX = e.clientX - this.panX;
        this.dragStartY = e.clientY - this.panY;
        this.canvasContainer.classList.add('panning');
        if (this.tooltip) this.tooltip.style.display = 'none';
      });

      window.addEventListener('mousemove', (e) => {
        if (!this.isDragging) return;
        this.panX = e.clientX - this.dragStartX;
        this.panY = e.clientY - this.dragStartY;
        this.scheduleTransform();
      });

      window.addEventListener('mouseup', () => {
        if (this.isDragging) {
          this.isDragging = false;
          if (this.canvasContainer) this.canvasContainer.classList.remove('panning');
        }
      });

      this.canvasContainer.addEventListener('wheel', (e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.12 : 0.89;
        const nuevoZoom = Math.max(0.25, Math.min(3.0, this.zoom * factor));

        const rect = this.canvasContainer.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        this.panX = mouseX - (mouseX - this.panX) * (nuevoZoom / this.zoom);
        this.panY = mouseY - (mouseY - this.panY) * (nuevoZoom / this.zoom);
        this.zoom = nuevoZoom;
        this.scheduleTransform();
      }, { passive: false });
    }
  }

  /**
   * Programa la aplicación de la matriz de transformación en el siguiente frame de renderizado.
   */
  scheduleTransform() {
    if (!this.rafId) {
      this.rafId = requestAnimationFrame(() => {
        this.aplicarTransform();
        this.rafId = null;
      });
    }
  }

  /**
   * Aplica la matriz de transformación SVG (translate y scale) al grupo de viewport del grafo.
   */
  aplicarTransform() {
    const viewport = document.getElementById('graphViewport');
    if (viewport) {
      viewport.setAttribute('transform', `translate(${this.panX}, ${this.panY}) scale(${this.zoom})`);
    }
  }

  /**
   * Centra y calcula automáticamente el zoom óptimo para visualizar el grafo completo.
   */
  ajustarZoom() {
    const bboxGroup = document.getElementById('graphNodesGroup');
    if (!bboxGroup || !this.canvasContainer) return;
    try {
      const bbox = bboxGroup.getBBox();
      if (!bbox || bbox.width === 0 || bbox.height === 0) {
        this.zoom = 1;
        this.panX = 20;
        this.panY = 40;
        this.aplicarTransform();
        return;
      }

      const rect = this.canvasContainer.getBoundingClientRect();
      const padding = 60;
      const scaleX = (rect.width - padding * 2) / (bbox.width || 1);
      const scaleY = (rect.height - padding * 2) / (bbox.height || 1);
      const scale = Math.min(1.2, Math.max(0.4, Math.min(scaleX, scaleY)));

      this.zoom = scale;
      this.panX = (rect.width - bbox.width * scale) / 2 - bbox.x * scale;
      this.panY = (rect.height - bbox.height * scale) / 2 - bbox.y * scale;
      this.aplicarTransform();
    } catch (e) {
      this.zoom = 1;
      this.panX = 20;
      this.panY = 40;
      this.aplicarTransform();
    }
  }

  /**
   * Genera el diagrama relacional completo en formato SVG a partir del conjunto de coincidencias de software.
   *
   * @param {Object[]} coincidencias - Listado de software hallado.
   * @param {function(string): void} [onAbrirUbicacion] - Callback para abrir la carpeta de una VM.
   * @returns {void}
   */
  render(coincidencias, onAbrirUbicacion) {
    this.onAbrirUbicacionCallback = onAbrirUbicacion;
    if (!this.svg) return;

    // 1. Estructurar modelo relacional de Nodos y Enlaces (limitar a 80 relaciones principales para rendimiento óptimo)
    const MAX_ITEMS_GRAFO = 80;
    const esTruncado = coincidencias.length > MAX_ITEMS_GRAFO;
    const itemsProcesar = esTruncado ? coincidencias.slice(0, MAX_ITEMS_GRAFO) : coincidencias;

    const nodes = new Map();
    const links = [];

    // Agrupar por programas
    const appsMap = new Map();
    itemsProcesar.forEach(item => {
      if (!appsMap.has(item.nombre_programa)) {
        appsMap.set(item.nombre_programa, []);
      }
      appsMap.get(item.nombre_programa).push(item);
    });

    // Construcción de Nodos y Conexiones
    appsMap.forEach((items, appName) => {
      const appId = `app:${appName}`;
      const primerItem = items[0] || {};
      nodes.set(appId, {
        id: appId,
        type: 'app',
        title: appName,
        subtitle: primerItem.categoria ? `${primerItem.categoria} • ${items.length} VM(s)` : `${items.length} instalación(es)`,
        data: {
          nombre_programa: appName,
          total: items.length,
          categoria: primerItem.categoria,
          tags: primerItem.tags || []
        }
      });

      items.forEach((item) => {
        const vmKey = item.ruta_carpeta || item.nombre_vm;
        const vmId = `vm:${vmKey}`;

        // Deducir tipo de entidad para el nodo de asignación
        let tipoPos = (item.origen_categoria || item.tipo_posesion || 'Personas').trim();
        let tipoLower = tipoPos.toLowerCase();
        let entityType = 'owner';
        let entitySub = 'Persona Asignada';
        let elemName =
          (tipoLower.includes('persona') ? (item.asignado || item.propietario) : (item.elemento || item.elemento_asignado)) ||
          item.elemento_asignado ||
          item.propietario ||
          item.asignado ||
          item.elemento ||
          'Desconocido';

        if (tipoLower.includes('disco')) {
          entityType = 'disk_entity';
          entitySub = 'Disco Asignado';
        } else if (tipoLower.includes('servidor') || tipoLower.includes('server')) {
          entityType = 'server_entity';
          entitySub = 'Servidor / Host';
        }

        const entityId = `entity:${entityType}:${elemName}`;

        if (!nodes.has(vmId)) {
          const { disco } = extraerInfoDisco(item.ruta_carpeta);
          nodes.set(vmId, {
            id: vmId,
            type: 'vm',
            title: item.nombre_vm,
            subtitle: disco || item.sistema_operativo || 'Máquina Virtual',
            data: item
          });
        }

        const edgeAppVm = `edge:${appId}-${vmId}`;
        if (!links.some(l => l.id === edgeAppVm)) {
          links.push({ source: appId, target: vmId, id: edgeAppVm });
        }

        if (!nodes.has(entityId)) {
          nodes.set(entityId, {
            id: entityId,
            type: entityType,
            title: elemName,
            subtitle: entitySub,
            data: {
              tipo_posesion: item.tipo_posesion || tipoPos,
              elemento: elemName,
              entityType
            }
          });
        }

        const edgeVmEntity = `edge:${vmId}-${entityId}`;
        if (!links.some(l => l.id === edgeVmEntity)) {
          links.push({ source: vmId, target: entityId, id: edgeVmEntity });
        }
      });
    });

    // 2. Calcular distribución por columnas
    const appNodes = Array.from(nodes.values()).filter(n => n.type === 'app');
    const vmNodes = Array.from(nodes.values()).filter(n => n.type === 'vm');
    const attrNodes = Array.from(nodes.values()).filter(n => n.type === 'owner' || n.type === 'disk_entity' || n.type === 'server_entity');

    const colX = { app: 60, vm: 400, attr: 740 };
    const nodeWidths = { app: 240, vm: 240, attr: 220 };
    const nodeHeights = { app: 54, vm: 52, attr: 48 };

    const layoutColumn = (colNodes, x, w, h, startY = 60, gap = 24) => {
      colNodes.forEach((node, i) => {
        node.x = x;
        node.y = startY + i * (h + gap);
        node.w = w;
        node.h = h;
      });
    };

    layoutColumn(appNodes, colX.app, nodeWidths.app, nodeHeights.app, 60, 40);
    layoutColumn(vmNodes, colX.vm, nodeWidths.vm, nodeHeights.vm, 60, 26);
    layoutColumn(attrNodes, colX.attr, nodeWidths.attr, nodeHeights.attr, 60, 26);

    // 3. Renderizar marcado SVG
    let svgContent = `
      <defs>
        <linearGradient id="gradApp" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#0284c7" />
          <stop offset="100%" stop-color="#0369a1" />
        </linearGradient>
        <linearGradient id="gradVm" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#6366f1" />
          <stop offset="100%" stop-color="#4f46e5" />
        </linearGradient>
        <linearGradient id="gradOwner" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#10b981" />
          <stop offset="100%" stop-color="#059669" />
        </linearGradient>
        <linearGradient id="gradDiskEntity" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#06b6d4" />
          <stop offset="100%" stop-color="#0891b2" />
        </linearGradient>
        <linearGradient id="gradServerEntity" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#8b5cf6" />
          <stop offset="100%" stop-color="#7c3aed" />
        </linearGradient>
      </defs>
      <g id="graphViewport" transform="translate(${this.panX}, ${this.panY}) scale(${this.zoom})">
        <g id="graphLinksGroup">
    `;

    // Renderizar enlaces Bezier
    links.forEach(link => {
      const src = nodes.get(link.source);
      const tgt = nodes.get(link.target);
      if (!src || !tgt) return;

      const x1 = src.x + src.w;
      const y1 = src.y + src.h / 2;
      const x2 = tgt.x;
      const y2 = tgt.y + tgt.h / 2;
      const dx = Math.abs(x2 - x1);

      const pathD = `M ${x1} ${y1} C ${x1 + dx * 0.45} ${y1}, ${x2 - dx * 0.45} ${y2}, ${x2} ${y2}`;
      svgContent += `<path class="graph-edge" id="${link.id}" data-source="${link.source}" data-target="${link.target}" d="${pathD}" />`;
    });

    svgContent += `</g><g id="graphNodesGroup">`;

    if (esTruncado) {
      svgContent += `
        <g transform="translate(60, 20)">
          <rect width="620" height="26" rx="6" fill="rgba(2, 132, 199, 0.12)" stroke="rgba(2, 132, 199, 0.35)" stroke-width="1" />
          <text x="12" y="17" font-size="11" font-weight="600" fill="var(--primary)">
            Mostrando las primeras ${MAX_ITEMS_GRAFO} relaciones principales de ${coincidencias.length} encontradas.
          </text>
        </g>
      `;
    }

    // Renderizar Nodos
    nodes.forEach(node => {
      const icon = this.obtenerIconoNodo(node.type);
      const strokeColor = this.obtenerBordeNodo(node.type);
      const fillBg = 'var(--bg-surface)';
      const headerColor = this.obtenerHeaderColorNodo(node.type);

      svgContent += `
        <g class="graph-node node-${node.type}" id="node_${node.id.replace(/[:\\/.]/g, '_')}" data-node-id="${node.id}" transform="translate(${node.x}, ${node.y})">
          <rect width="${node.w}" height="${node.h}" rx="8" fill="${fillBg}" stroke="${strokeColor}" stroke-width="1.6" />
          <rect width="6" height="${node.h}" rx="3" fill="${headerColor}" />
          
          <g transform="translate(14, ${node.h / 2 - 9})">
            ${icon}
          </g>

          <text x="36" y="20" font-size="12" font-weight="700" fill="var(--text-primary)" style="user-select: none;">
            ${truncarTexto(node.title, 20)}
          </text>
          <text x="36" y="36" font-size="10" font-weight="500" fill="var(--text-muted)" style="user-select: none;">
            ${truncarTexto(node.subtitle, 24)}
          </text>
        </g>
      `;
    });

    svgContent += `</g></g>`;
    this.svg.innerHTML = svgContent;

    // 4. Conectar interactividad de nodos
    this.conectarEventosNodos(nodes, links);

    // Autoajustar visualización
    setTimeout(() => {
      this.ajustarZoom();
    }, 40);
  }

  /**
   * Devuelve el fragmento SVG del icono representativo según el tipo de nodo.
   *
   * @param {string} type - Tipo de nodo ('app', 'vm', 'owner', 'disk_entity', 'server_entity').
   * @returns {string} Fragmento HTML del SVG.
   */
  obtenerIconoNodo(type) {
    switch (type) {
      case 'app':
        return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0284c7" stroke-width="2.2"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>`;
      case 'vm':
        return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2.2"><rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/></svg>`;
      case 'owner':
        return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
      case 'disk_entity':
        return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" stroke-width="2.2"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="6" y1="12" x2="6.01" y2="12"/><line x1="10" y1="12" x2="10.01" y2="12"/></svg>`;
      case 'server_entity':
        return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="2.2"><rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/></svg>`;
      default:
        return `<circle cx="8" cy="8" r="4" fill="#0284c7" />`;
    }
  }

  /**
   * Obtiene el color de borde asignado a la tarjeta de nodo según su tipo.
   *
   * @param {string} type - Tipo de entidad del nodo.
   * @returns {string} Expresión de color CSS.
   */
  obtenerBordeNodo(type) {
    switch (type) {
      case 'app': return 'rgba(2, 132, 199, 0.5)';
      case 'vm': return 'rgba(99, 102, 241, 0.5)';
      case 'owner': return 'rgba(16, 185, 129, 0.5)';
      case 'disk_entity': return 'rgba(6, 182, 212, 0.5)';
      case 'server_entity': return 'rgba(139, 92, 246, 0.5)';
      default: return 'var(--border)';
    }
  }

  /**
   * Obtiene el color del acento de cabecera de la tarjeta del nodo según su tipo.
   *
   * @param {string} type - Tipo de entidad del nodo.
   * @returns {string} Código hexadecimal de color.
   */
  obtenerHeaderColorNodo(type) {
    switch (type) {
      case 'app': return '#0284c7';
      case 'vm': return '#6366f1';
      case 'owner': return '#10b981';
      case 'disk_entity': return '#06b6d4';
      case 'server_entity': return '#8b5cf6';
      default: return '#0284c7';
    }
  }

  /**
   * Conecta los listeners de resaltado, tooltip flotante y apertura del drawer a los nodos del SVG.
   *
   * @param {Map<string, GraphNode>} nodes - Mapa de nodos indexados.
   * @param {GraphLink[]} links - Lista de conexiones.
   * @private
   */
  conectarEventosNodos(nodes, links) {
    const nodeElements = Array.from(this.svg.querySelectorAll('.graph-node'));
    const edgeElements = Array.from(this.svg.querySelectorAll('.graph-edge'));

    // Precalcular grafo de adyacencias para consultas O(1) en hover
    const adjacency = new Map();
    nodes.forEach((_, id) => {
      adjacency.set(id, { nodes: new Set([id]), edges: new Set() });
    });

    links.forEach(link => {
      const srcAdj = adjacency.get(link.source);
      const tgtAdj = adjacency.get(link.target);
      if (srcAdj) {
        srcAdj.nodes.add(link.target);
        srcAdj.edges.add(link.id);
      }
      if (tgtAdj) {
        tgtAdj.nodes.add(link.source);
        tgtAdj.edges.add(link.id);
      }
    });

    nodeElements.forEach(el => {
      const nodeId = el.getAttribute('data-node-id');
      const nodeObj = nodes.get(nodeId);
      if (!nodeObj) return;

      const adj = adjacency.get(nodeId);

      // Mouse Enter (Resaltado de ruta y tooltip)
      el.addEventListener('mouseenter', () => {
        if (this.isDragging) return;

        const connectedNodeIds = adj ? adj.nodes : new Set([nodeId]);
        const connectedEdgeIds = adj ? adj.edges : new Set();

        edgeElements.forEach(edge => {
          if (connectedEdgeIds.has(edge.id)) {
            edge.classList.add('highlighted');
            edge.classList.remove('dimmed');
          } else {
            edge.classList.add('dimmed');
            edge.classList.remove('highlighted');
          }
        });

        nodeElements.forEach(nodeEl => {
          const id = nodeEl.getAttribute('data-node-id');
          if (connectedNodeIds.has(id)) {
            nodeEl.classList.add('active');
            nodeEl.classList.remove('dimmed');
          } else {
            nodeEl.classList.add('dimmed');
            nodeEl.classList.remove('active');
          }
        });

        // Posicionar tooltip mediante cálculo de coordenadas directas (evita forzar reflow con getBoundingClientRect)
        if (this.tooltip) {
          const posX = this.panX + (nodeObj.x + nodeObj.w / 2) * this.zoom;
          const posY = this.panY + nodeObj.y * this.zoom;

          this.tooltip.innerHTML = this.generarHtmlTooltip(nodeObj);
          this.tooltip.style.display = 'block';
          this.tooltip.style.left = `${posX}px`;
          this.tooltip.style.top = `${posY}px`;
        }
      });

      // Mouse Leave (Restablecer opacidad)
      el.addEventListener('mouseleave', () => {
        if (this.isDragging) return;

        edgeElements.forEach(edge => {
          edge.classList.remove('highlighted');
          edge.classList.remove('dimmed');
        });
        nodeElements.forEach(nodeEl => {
          nodeEl.classList.remove('active');
          nodeEl.classList.remove('dimmed');
        });
        if (this.tooltip) {
          this.tooltip.style.display = 'none';
        }
      });

      // Click (Mostrar detalles en Drawer lateral)
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.mostrarDetallesNodo(nodeObj);
      });
    });
  }

  /**
   * Genera el contenido HTML del tooltip flotante de previsualización para un nodo.
   *
   * @param {GraphNode} node - Nodo sobre el que está posicionado el cursor.
   * @returns {string} Marcado HTML del tooltip.
   */
  generarHtmlTooltip(node) {
    const title = escapeHtml(node.title);
    switch (node.type) {
      case 'app':
        return `
          <div class="tooltip-title">📦 Aplicación: ${title}</div>
          <div class="tooltip-row"><span>Instalaciones encontradas:</span> <strong>${node.data.total}</strong></div>
          <div style="font-size: 10px; color: var(--text-muted); margin-top: 4px;">Haz clic para ver detalles y filtrar</div>
        `;
      case 'vm': {
        const vm = node.data;
        const { disco, ubicacion } = extraerInfoDisco(vm.ruta_carpeta);
        const tipoP = vm.origen_categoria || vm.tipo_posesion || 'Persona';
        const elemAsignado =
          (tipoP.toLowerCase().includes('persona') ? (vm.asignado || vm.propietario) : (vm.elemento || vm.elemento_asignado)) ||
          vm.elemento_asignado ||
          vm.propietario ||
          vm.asignado ||
          vm.elemento ||
          'Desconocido';
        return `
          <div class="tooltip-title">🖥️ Máquina Virtual: ${title}</div>
          <div class="tooltip-row"><span>Versión soft:</span> <strong>${escapeHtml(vm.version || 'N/A')}</strong></div>
          <div class="tooltip-row"><span>Asignado:</span> <strong>${escapeHtml(elemAsignado)} (${escapeHtml(tipoP)})</strong></div>
          <div class="tooltip-row"><span>S.O.:</span> <strong>${escapeHtml(vm.sistema_operativo || 'Desconocido')}</strong></div>
          <div class="tooltip-row"><span>Almacenamiento:</span> <strong>${escapeHtml(disco)}</strong></div>
          <div class="tooltip-row"><span>Ruta:</span> <strong style="font-size: 10px; word-break: break-all;">${escapeHtml(ubicacion || vm.ruta_carpeta)}</strong></div>
          <div style="font-size: 10px; color: var(--text-muted); margin-top: 4px;">Haz clic para ver detalles y filtrar</div>
        `;
      }
      case 'owner':
        return `
          <div class="tooltip-title">👤 Persona: ${title}</div>
          <div class="tooltip-row"><span>Categoría:</span> <strong>Personas</strong></div>
          <div style="font-size: 10px; color: var(--text-muted); margin-top: 4px;">Haz clic para filtrar por este colaborador</div>
        `;
      case 'disk_entity':
        return `
          <div class="tooltip-title">💾 Disco Asignado: ${title}</div>
          <div class="tooltip-row"><span>Categoría:</span> <strong>Discos</strong></div>
          <div style="font-size: 10px; color: var(--text-muted); margin-top: 4px;">Haz clic para filtrar por este disco</div>
        `;
      case 'server_entity':
        return `
          <div class="tooltip-title">🖥️ Servidor de Infraestructura: ${title}</div>
          <div class="tooltip-row"><span>Categoría:</span> <strong>Servidores</strong></div>
          <div style="font-size: 10px; color: var(--text-muted); margin-top: 4px;">Haz clic para filtrar por este servidor</div>
        `;
      default:
        return `<div class="tooltip-title">${title}</div>`;
    }
  }

  /**
   * Despliega el panel drawer lateral con los detalles pormenorizados del nodo seleccionado.
   *
   * @param {GraphNode} node - Nodo seleccionado.
   * @returns {void}
   */
  mostrarDetallesNodo(node) {
    if (!this.drawer || !this.drawerTitle || !this.drawerBody) return;

    this.drawerTitle.innerHTML = `
      ${this.obtenerIconoNodo(node.type)}
      <span>${escapeHtml(node.title)}</span>
    `;

    let bodyHtml = '';

    if (node.type === 'vm') {
      const vm = node.data;
      const { disco, ubicacion } = extraerInfoDisco(vm.ruta_carpeta);
      const tipoP = vm.origen_categoria || vm.tipo_posesion || 'Persona';
      const elemAsignado =
        (tipoP.toLowerCase().includes('persona') ? (vm.asignado || vm.propietario) : (vm.elemento || vm.elemento_asignado)) ||
        vm.elemento_asignado ||
        vm.propietario ||
        vm.asignado ||
        vm.elemento ||
        'Desconocido';
      bodyHtml = `
        <div class="drawer-field-row">
          <span class="drawer-field-label">Máquina Virtual:</span>
          <span class="drawer-field-value"><strong>${escapeHtml(vm.nombre_vm)}</strong></span>
        </div>
        ${vm.nombre_interno && vm.nombre_interno !== vm.nombre_vm ? `
        <div class="drawer-field-row">
          <span class="drawer-field-label">Nombre Interno:</span>
          <span class="drawer-field-value">${escapeHtml(vm.nombre_interno)}</span>
        </div>` : ''}
        <div class="drawer-field-row">
          <span class="drawer-field-label">Programa:</span>
          <span class="drawer-field-value">${escapeHtml(vm.nombre_programa)} ${vm.version ? `(v${escapeHtml(vm.version)})` : ''}</span>
        </div>
        ${vm.editor ? `
        <div class="drawer-field-row">
          <span class="drawer-field-label">Editor / Fabricante:</span>
          <span class="drawer-field-value">${escapeHtml(vm.editor)}</span>
        </div>` : ''}
        <div class="drawer-field-row">
          <span class="drawer-field-label">Tipo / Categoría:</span>
          <span class="drawer-field-value">${escapeHtml(tipoP)}</span>
        </div>
        <div class="drawer-field-row">
          <span class="drawer-field-label">Asignado / Elemento:</span>
          <span class="drawer-field-value"><strong>${escapeHtml(elemAsignado)}</strong></span>
        </div>
        <div class="drawer-field-row">
          <span class="drawer-field-label">Sistema Operativo:</span>
          <span class="drawer-field-value">${escapeHtml(vm.sistema_operativo)}</span>
        </div>
        <div class="drawer-field-row">
          <span class="drawer-field-label">Ubicación / Disco:</span>
          <span class="drawer-field-value">${escapeHtml(disco)}</span>
        </div>
        <div class="drawer-field-row">
          <span class="drawer-field-label">Ruta Registrada:</span>
          <span class="drawer-field-value" style="font-family: monospace; font-size: 11px;">${escapeHtml(ubicacion || vm.ruta_carpeta)}</span>
        </div>
        <div class="drawer-field-row">
          <span class="drawer-field-label">Reporte JSON:</span>
          <span class="drawer-field-value">${escapeHtml(vm.archivo_json)} (${escapeHtml(vm.fecha_relevamiento)})</span>
        </div>

        <div class="drawer-actions">
          <button class="step-action-btn ready-to-run btn-filtrar-nodo-vm" type="button" style="flex: 1; height: 32px; font-size: 11px;" title="Filtrar solo por esta Máquina Virtual">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            Filtrar solo por esta VM
          </button>
          <button class="step-btn btn-copiar-ruta-drawer" type="button" style="height: 32px; font-size: 11px;" title="Copiar ruta al portapapeles">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
          </button>
        </div>
      `;
    } else if (node.type === 'owner' || node.type === 'disk_entity' || node.type === 'server_entity') {
      let tipoLabel = 'Persona';
      let icon = '👤';
      if (node.type === 'disk_entity') { tipoLabel = 'Disco'; icon = '💾'; }
      if (node.type === 'server_entity') { tipoLabel = 'Servidor'; icon = '🖥️'; }

      bodyHtml = `
        <div class="drawer-field-row">
          <span class="drawer-field-label">${tipoLabel}:</span>
          <span class="drawer-field-value">${icon} ${escapeHtml(node.title)}</span>
        </div>
        <div class="drawer-field-row">
          <span class="drawer-field-label">Categoría:</span>
          <span class="drawer-field-value">${escapeHtml(node.subtitle)}</span>
        </div>
        <div class="drawer-actions">
          <button class="step-action-btn ready-to-run btn-filtrar-nodo-propietario" type="button" style="flex: 1; height: 32px; font-size: 11px;" title="Filtrar solo por este ${tipoLabel}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            Filtrar solo por este Elemento
          </button>
        </div>
      `;
    } else if (node.type === 'app') {
      bodyHtml = `
        <div class="drawer-field-row">
          <span class="drawer-field-label">Programa:</span>
          <span class="drawer-field-value"><strong>${escapeHtml(node.title)}</strong></span>
        </div>
        ${node.data && node.data.categoria ? `
        <div class="drawer-field-row">
          <span class="drawer-field-label">Categoría:</span>
          <span class="drawer-field-value"><span class="consultor-category-badge">${escapeHtml(node.data.categoria)}</span></span>
        </div>` : ''}
        ${node.data && Array.isArray(node.data.tags) && node.data.tags.length > 0 ? `
        <div class="drawer-field-row">
          <span class="drawer-field-label">Etiquetas:</span>
          <span class="drawer-field-value">${node.data.tags.map(t => `<span class="consultor-tag-pill">#${escapeHtml(t)}</span>`).join(' ')}</span>
        </div>` : ''}
        <div class="drawer-field-row">
          <span class="drawer-field-label">Instalaciones:</span>
          <span class="drawer-field-value">${node.data.total} máquina(s) virtual(es)</span>
        </div>
        <div class="drawer-actions">
          <button class="step-action-btn ready-to-run btn-filtrar-nodo-app" type="button" style="flex: 1; height: 32px; font-size: 11px;" title="Filtrar solo por este Programa">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            Filtrar solo por este Programa
          </button>
        </div>
      `;
    } else {
      bodyHtml = `
        <div class="drawer-field-row">
          <span class="drawer-field-label">Elemento:</span>
          <span class="drawer-field-value">${escapeHtml(node.title)}</span>
        </div>
        <div class="drawer-field-row">
          <span class="drawer-field-label">Categoría:</span>
          <span class="drawer-field-value">${escapeHtml(node.subtitle)}</span>
        </div>
        <div class="drawer-actions">
          <button class="step-action-btn ready-to-run btn-filtrar-nodo-generico" type="button" style="flex: 1; height: 32px; font-size: 11px;" title="Filtrar solo por este Elemento">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            Filtrar solo por este Elemento
          </button>
        </div>
      `;
    }

    this.drawerBody.innerHTML = bodyHtml;
    this.drawer.style.display = 'block';

    // Conectar botón Copiar Ruta
    const btnCopiar = this.drawerBody.querySelector('.btn-copiar-ruta-drawer');
    if (btnCopiar && node.data && node.data.ruta_carpeta) {
      btnCopiar.addEventListener('click', () => {
        navigator.clipboard.writeText(node.data.ruta_carpeta);
        btnCopiar.innerHTML = `✓`;
        setTimeout(() => {
          btnCopiar.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
        }, 1500);
      });
    }

    // Conectar botones de Filtrado rápido
    const btnFiltrarVm = this.drawerBody.querySelector('.btn-filtrar-nodo-vm');
    if (btnFiltrarVm && this.onFiltrarCallback) {
      btnFiltrarVm.addEventListener('click', () => {
        this.onFiltrarCallback('vm', node.title);
      });
    }

    const btnFiltrarProp = this.drawerBody.querySelector('.btn-filtrar-nodo-propietario');
    if (btnFiltrarProp && this.onFiltrarCallback) {
      btnFiltrarProp.addEventListener('click', () => {
        this.onFiltrarCallback('propietario', node.title);
      });
    }

    const btnFiltrarApp = this.drawerBody.querySelector('.btn-filtrar-nodo-app');
    if (btnFiltrarApp && this.onFiltrarCallback) {
      btnFiltrarApp.addEventListener('click', () => {
        this.onFiltrarCallback('programa', node.title);
      });
    }

    const btnFiltrarGen = this.drawerBody.querySelector('.btn-filtrar-nodo-generico');
    if (btnFiltrarGen && this.onFiltrarCallback) {
      btnFiltrarGen.addEventListener('click', () => {
        this.onFiltrarCallback('propietario', node.title);
      });
    }
  }
}

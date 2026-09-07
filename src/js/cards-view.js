/**
 * @file cards-view.js
 * @description Renderizador optimizado y progresivo de tarjetas de resultados de software para el Consultor.
 * Implementa renderizado por fragmentos (chunking) y delegación de eventos para rendimiento 60 FPS con miles de registros.
 * @module js/cards-view
 */

import { extraerInfoDisco, escapeHtml } from './utils.js';

const TAMANO_PAGINA = 50;

/**
 * @typedef {Object} CoincidenciaSoftware
 * @property {string} nombre_programa - Nombre de la aplicación encontrada.
 * @property {string|null} [version] - Versión del software.
 * @property {string|null} [editor] - Fabricante o editor del software.
 * @property {string} nombre_vm - Nombre identificador de la VM.
 * @property {string} [nombre_interno] - Nombre interno según el archivo .vmx/.vbox.
 * @property {string} ruta_carpeta - Ruta en disco de la máquina virtual.
 * @property {string|null} [propietario] - Propietario o colaborador deducido.
 * @property {string|null} [tipo_posesion] - Categoría (Personas, Discos, Servidores).
 * @property {string|null} [elemento_asignado] - Elemento o persona asignada.
 * @property {string} sistema_operativo - Sistema operativo huésped detectado.
 * @property {number|null} [peso_gb] - Tamaño de la carpeta de la VM en GB.
 * @property {string|null} [hipervisor] - Hipervisor (VMware / VirtualBox).
 * @property {string} archivo_json - Nombre del archivo de reporte origen.
 * @property {string} fecha_relevamiento - Fecha en la que se auditó la VM.
 */

/**
 * Clase encargada del renderizado visual de resultados en formato de tarjetas estructuradas.
 */
export class CardsView {
  /**
   * Crea una instancia de CardsView.
   * @param {HTMLElement|null} container - Contenedor DOM para las tarjetas.
   */
  constructor(container) {
    this.container = container;
    this.coincidencias = [];
    this.renderedCount = 0;
    this.onAbrirUbicacion = null;
    this.observer = null;

    this.initEventDelegation();
  }

  /**
   * Conecta delegación de eventos en el contenedor para evitar crear miles de event listeners.
   * @private
   */
  initEventDelegation() {
    if (!this.container) return;

    this.container.addEventListener('click', (e) => {
      const btnAbrir = e.target.closest('.btn-abrir-ubicacion-vm');
      if (btnAbrir) {
        const ruta = btnAbrir.getAttribute('data-ruta');
        if (ruta && this.onAbrirUbicacion) {
          this.onAbrirUbicacion(ruta);
        }
        return;
      }

      const btnCargarMas = e.target.closest('.btn-cargar-mas-cards');
      if (btnCargarMas) {
        this.renderSiguienteLote();
      }
    });
  }

  /**
   * Renderiza el listado de coincidencias de software en tarjetas interactivas de forma progresiva.
   *
   * @param {CoincidenciaSoftware[]} coincidencias - Colección de hallazgos devueltos por la consulta.
   * @param {function(string): void} [onAbrirUbicacion] - Callback para abrir la carpeta de la VM en el explorador del SO.
   * @returns {void}
   */
  render(coincidencias, onAbrirUbicacion) {
    if (!this.container) return;

    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    this.coincidencias = Array.isArray(coincidencias) ? coincidencias : [];
    this.onAbrirUbicacion = onAbrirUbicacion;
    this.renderedCount = 0;
    this.container.innerHTML = '';

    if (this.coincidencias.length === 0) {
      return;
    }

    this.renderSiguienteLote();
  }

  /**
   * Renderiza el siguiente bloque de tarjetas usando DocumentFragment para cero lag de renderizado.
   * @private
   */
  renderSiguienteLote() {
    if (this.renderedCount >= this.coincidencias.length) return;

    // Eliminar botón anterior de "Cargar más" / sentinel si existe
    const sentinelPrev = this.container.querySelector('.cards-pagination-footer');
    if (sentinelPrev) {
      sentinelPrev.remove();
    }

    const fragment = document.createDocumentFragment();
    const inicio = this.renderedCount;
    const fin = Math.min(this.renderedCount + TAMANO_PAGINA, this.coincidencias.length);

    for (let i = inicio; i < fin; i++) {
      const item = this.coincidencias[i];
      const card = this.crearElementoCard(item);
      fragment.appendChild(card);
    }

    this.renderedCount = fin;
    this.container.appendChild(fragment);

    // Si aún quedan tarjetas por mostrar, añadir pie con botón y observador de scroll infinito
    if (this.renderedCount < this.coincidencias.length) {
      const restantes = this.coincidencias.length - this.renderedCount;
      const footer = document.createElement('div');
      footer.className = 'cards-pagination-footer';
      footer.style.cssText = 'display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 16px 0;';
      footer.innerHTML = `
        <div style="font-size: 12px; color: var(--text-muted);">
          Mostrando <strong>${this.renderedCount}</strong> de <strong>${this.coincidencias.length}</strong> resultados
        </div>
        <button type="button" class="step-btn btn-cargar-mas-cards" style="padding: 6px 16px; font-weight: 600;">
          Cargar más (${restantes} restantes)
        </button>
      `;
      this.container.appendChild(footer);

      // Configurar IntersectionObserver para autodesplazamiento fluido
      if ('IntersectionObserver' in window) {
        if (this.observer) this.observer.disconnect();
        this.observer = new IntersectionObserver((entries) => {
          if (entries[0].isIntersecting) {
            this.renderSiguienteLote();
          }
        }, { rootMargin: '200px' });
        this.observer.observe(footer);
      }
    }
  }

  /**
   * Crea el elemento HTML para una tarjeta individual.
   * @private
   * @param {CoincidenciaSoftware} item
   * @returns {HTMLElement}
   */
  crearElementoCard(item) {
    const { disco, ubicacion } = extraerInfoDisco(item.ruta_carpeta);
    const card = document.createElement('div');
    card.className = 'consultor-card';

    const versionBadge = item.version
      ? `<span class="consultor-version-badge">v${escapeHtml(item.version)}</span>`
      : '<span class="consultor-version-badge" style="background: var(--border); color: var(--text-muted);">Sin versión</span>';

    const editorTag = item.editor
      ? `<span class="consultor-editor-tag">• Editor: ${escapeHtml(item.editor)}</span>`
      : '';

    const categoryBadge = item.categoria
      ? `<span class="consultor-category-badge" title="Categoría funcional deducida por vminspect-rs">${escapeHtml(item.categoria)}</span>`
      : '';

    const tagsHtml = Array.isArray(item.tags) && item.tags.length > 0
      ? `<div class="consultor-tags-wrapper">${item.tags.map(t => `<span class="consultor-tag-pill">#${escapeHtml(t)}</span>`).join('')}</div>`
      : '';

    // Configurar etiqueta y estilo según Tipo de Posesión / Origen de Categoría (Persona, Disco, Servidor)
    let tagCls = 'badge-persona';
    let iconSvg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
    let tipoNombre = 'Persona';
    const tipoLower = (item.origen_categoria || item.tipo_posesion || '').toLowerCase();

    if (tipoLower.includes('disco')) {
      tagCls = 'badge-disco';
      tipoNombre = 'Disco';
      iconSvg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="6" y1="12" x2="6.01" y2="12"/><line x1="10" y1="12" x2="10.01" y2="12"/></svg>';
    } else if (tipoLower.includes('servidor') || tipoLower.includes('server')) {
      tagCls = 'badge-servidor';
      tipoNombre = 'Servidor';
      iconSvg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/></svg>';
    }

    const elementoMostrar =
      (tipoNombre === 'Persona' ? (item.asignado || item.propietario) : (item.elemento || item.elemento_asignado)) ||
      item.elemento_asignado ||
      item.propietario ||
      item.asignado ||
      item.elemento ||
      'Desconocido';
    const posesionTag = `
      <span class="consultor-possession-badge ${tagCls}" title="Ubicación y tenencia asignada">
        ${iconSvg}
        <span><strong>${escapeHtml(tipoNombre)}:</strong> ${escapeHtml(elementoMostrar)}</span>
      </span>
    `;

    const vmNombreMostrar = escapeHtml(item.nombre_vm || 'VM Desconocida');
    const vmNombreInternoTag = item.nombre_interno && item.nombre_interno !== item.nombre_vm
      ? `<span style="font-size: 11px; color: var(--text-muted); font-weight: 400;">(${escapeHtml(item.nombre_interno)})</span>`
      : '';

    card.innerHTML = `
      <div class="consultor-card-header">
        <div class="consultor-app-title">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>
          <strong>${escapeHtml(item.nombre_programa)}</strong>
          ${versionBadge}
          ${categoryBadge}
          ${editorTag}
        </div>
        ${posesionTag}
      </div>
      ${tagsHtml ? `<div class="consultor-tags-row">${tagsHtml}</div>` : ''}

      <div class="consultor-card-body">
        <div class="consultor-vm-details">
          <div class="consultor-vm-name-row">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/></svg>
            <span>VM: <strong>${vmNombreMostrar}</strong></span>
            ${vmNombreInternoTag}
            <span class="consultor-os-badge">${escapeHtml(item.sistema_operativo)}</span>
          </div>

          <div class="consultor-location-row">
            <div class="consultor-disk-badge" title="Disco duro / Unidad contenedora">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="6" y1="12" x2="6.01" y2="12"/><line x1="10" y1="12" x2="10.01" y2="12"/></svg>
              ${escapeHtml(disco)}
            </div>
            <div class="consultor-path-text" title="Ruta completa de la VM">
              ${escapeHtml(ubicacion || item.ruta_carpeta)}
            </div>
          </div>

          <div class="consultor-meta-row">
            <span>Reporte: ${escapeHtml(item.archivo_json)}</span>
            <span>• Fecha: ${escapeHtml(item.fecha_relevamiento)}</span>
          </div>
        </div>

        <div>
          <button class="step-btn btn-abrir-ubicacion-vm" type="button" data-ruta="${escapeHtml(item.ruta_carpeta || '')}" title="Abrir ubicación de la VM en el Explorador de Archivos" style="white-space: nowrap;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            Abrir Carpeta
          </button>
        </div>
      </div>
    `;

    return card;
  }
}

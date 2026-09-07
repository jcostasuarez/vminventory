/**
 * @file history-view.js
 * @description Renderizador de registros de auditoría e historial de relevamientos.
 * @module js/history-view
 */

import { escapeHtml } from './utils.js';

/**
 * @typedef {Object} RegistroHistorial
 * @property {string} id - Identificador único de la sesión.
 * @property {string} fecha - Fecha y hora de ejecución.
 * @property {string} ruta_origen - Directorio fuente inspeccionado.
 * @property {string} ruta_destino - Directorio destino del reporte.
 * @property {number} total_vms - Cantidad total de VMs halladas.
 * @property {number} exitosas - Cantidad de VMs analizadas sin errores.
 * @property {number} con_observaciones - Cantidad de VMs con advertencias.
 * @property {number} discrepantes - Cantidad de VMs con discrepancia de nombre.
 * @property {string} duracion - Tiempo total transcurrido.
 * @property {number} peso_gb - Tamaño acumulado en Gigabytes.
 */

/**
 * Renderiza la lista cronológica de sesiones de relevamiento en el modal de historial.
 *
 * @param {HTMLElement|null} container - Contenedor DOM para la lista de historial.
 * @param {RegistroHistorial[]} items - Lista de registros persistidos.
 * @param {function(string): void} [onAbrirCarpeta] - Callback para abrir la carpeta de destino en el Explorador del SO.
 * @returns {void}
 */
export function renderHistorial(container, items, onAbrirCarpeta) {
  if (!container) return;

  if (!Array.isArray(items) || items.length === 0) {
    container.innerHTML = '<div class="empty-history-text">No hay relevamientos registrados aún.</div>';
    return;
  }

  container.innerHTML = '';
  items.forEach(item => {
    const div = document.createElement('div');
    div.className = 'history-item';
    div.innerHTML = `
      <div class="history-item-details">
        <div class="history-item-date">${escapeHtml(item.fecha)} • Duración: ${escapeHtml(item.duracion)} • ${(Number(item.peso_gb) || 0).toFixed(2)} GB</div>
        <div class="history-item-path">Origen: ${escapeHtml(item.ruta_origen)}</div>
        <div class="history-item-stats">
          <span>Total VMs: <strong>${item.total_vms}</strong></span>
          <span class="history-stat-ok">✓ ${item.exitosas} exitosas</span>
          <span class="history-stat-warn">⚠ ${item.con_observaciones} con obs. (${item.discrepantes} disc.)</span>
        </div>
      </div>
      <button class="step-btn btn-abrir-dest" style="flex-shrink: 0;" data-path="${escapeHtml(item.ruta_destino)}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        Abrir Carpeta
      </button>
    `;

    const btnAbrir = div.querySelector('.btn-abrir-dest');
    if (btnAbrir) {
      btnAbrir.addEventListener('click', () => {
        if (item.ruta_destino && onAbrirCarpeta) {
          onAbrirCarpeta(item.ruta_destino);
        }
      });
    }

    container.appendChild(div);
  });
}

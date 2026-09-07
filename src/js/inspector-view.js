/**
 * @file inspector-view.js
 * @description Controlador y renderizador del Inspector de VM (vminspect-rs).
 * Permite examinar discos virtuales (.vmdk, .vdi, .vhdx, .raw, .qcow2), visualizar particiones,
 * metadatos del SO huésped, inventario de programas categorizados y estadísticas de rendimiento.
 * @module js/inspector-view
 */

import { escapeHtml, formatearBytes } from './utils.js';

export class InspectorView {
  /**
   * Crea una nueva instancia de InspectorView.
   * @param {Object} domElements
   * @param {Object} callbacks
   */
  constructor(domElements, callbacks = {}) {
    this.dom = domElements;
    this.callbacks = callbacks;
    this.ultimoInforme = null;
    this.filtroTextoSoftware = '';
    this.filtroCategoriaSoftware = 'todas';

    this.initEvents();
  }

  /**
   * Inicializa los listeners de eventos para la herramienta de inspección directa.
   */
  initEvents() {
    if (this.dom.btnSeleccionarDiscoInspector) {
      this.dom.btnSeleccionarDiscoInspector.addEventListener('click', () => {
        if (this.callbacks.onSeleccionarDisco) {
          this.callbacks.onSeleccionarDisco();
        }
      });
    }

    if (this.dom.btnIniciarInspeccionDisco) {
      this.dom.btnIniciarInspeccionDisco.addEventListener('click', () => {
        if (this.callbacks.onIniciarInspeccion) {
          this.callbacks.onIniciarInspeccion();
        }
      });
    }

    if (this.dom.btnExportarInformeDisco) {
      this.dom.btnExportarInformeDisco.addEventListener('click', () => {
        if (this.callbacks.onExportarInforme && this.ultimoInforme) {
          this.callbacks.onExportarInforme(this.ultimoInforme);
        }
      });
    }

    if (this.dom.inputFiltrarSoftwareInspector) {
      this.dom.inputFiltrarSoftwareInspector.addEventListener('input', (e) => {
        this.filtroTextoSoftware = e.target.value.trim().toLowerCase();
        this.renderTablaSoftware();
      });
    }

    if (this.dom.selectCategoriaSoftwareInspector) {
      this.dom.selectCategoriaSoftwareInspector.addEventListener('change', (e) => {
        this.filtroCategoriaSoftware = e.target.value;
        this.renderTablaSoftware();
      });
    }
  }

  /**
   * Actualiza la ruta del disco seleccionado en la interfaz.
   * @param {string} ruta
   */
  setDiscoSeleccionado(ruta) {
    if (this.dom.lblDiscoInspectorRuta) {
      this.dom.lblDiscoInspectorRuta.textContent = ruta || 'Ningún archivo de disco seleccionado';
      this.dom.lblDiscoInspectorRuta.title = ruta || '';
    }
    if (this.dom.cardStepDiscoInspector) {
      if (ruta) {
        this.dom.cardStepDiscoInspector.classList.add('ready');
      } else {
        this.dom.cardStepDiscoInspector.classList.remove('ready');
      }
    }
    if (this.dom.btnIniciarInspeccionDisco) {
      this.dom.btnIniciarInspeccionDisco.disabled = !ruta;
      if (ruta) {
        this.dom.btnIniciarInspeccionDisco.classList.add('ready-to-run');
      } else {
        this.dom.btnIniciarInspeccionDisco.classList.remove('ready-to-run');
      }
    }
  }

  /**
   * Actualiza el progreso visual de la inspección.
   * @param {Object} progreso - { porcentaje, etapa, detalle }
   */
  actualizarProgreso(progreso) {
    if (!progreso) return;
    const pct = Math.min(100, Math.max(0, progreso.porcentaje || 0));

    if (this.dom.barProgresoInspector) {
      this.dom.barProgresoInspector.style.width = `${pct}%`;
    }
    if (this.dom.lblPorcentajeInspector) {
      this.dom.lblPorcentajeInspector.textContent = `${pct}%`;
    }
    if (this.dom.lblEtapaInspector) {
      this.dom.lblEtapaInspector.textContent = progreso.etapa || 'Analizando...';
    }
    if (this.dom.lblDetalleInspector) {
      this.dom.lblDetalleInspector.textContent = progreso.detalle || '';
    }
  }

  /**
   * Modifica el estado de ejecución de la herramienta.
   * @param {boolean} enCurso
   */
  setEstadoEjecucion(enCurso) {
    if (this.dom.wrapperProgresoInspector) {
      this.dom.wrapperProgresoInspector.style.display = enCurso ? 'flex' : 'none';
    }
    if (this.dom.btnIniciarInspeccionDisco) {
      this.dom.btnIniciarInspeccionDisco.disabled = enCurso;
      if (enCurso) {
        this.dom.btnIniciarInspeccionDisco.classList.remove('ready-to-run');
      } else {
        this.dom.btnIniciarInspeccionDisco.classList.add('ready-to-run');
      }
    }
  }

  /**
   * Renderiza el informe completo estructurado emitido por vminspect-rs.
   * @param {Object} informe - InformeInspeccion
   */
  renderInforme(informe) {
    this.ultimoInforme = informe;
    if (!informe || !this.dom.containerResultadosInspector) return;

    this.dom.containerResultadosInspector.style.display = 'flex';
    this.dom.inspectorEmptyState.style.display = 'none';

    const esExito = informe.exito !== false && informe.exitosa !== false;
    const advertencias = [...(informe.advertencias || []), ...(informe.observaciones || [])];

    // 0. Renderizar bloque de advertencias / observaciones si existen o si falló
    if (this.dom.inspectorWarningsBox) {
      if (advertencias.length > 0 || !esExito) {
        this.dom.inspectorWarningsBox.style.display = 'block';
        this.dom.inspectorWarningsBox.innerHTML = `
          <div class="inspector-card" style="border-color: ${esExito ? 'var(--warning)' : 'var(--danger)'}; background: ${esExito ? 'var(--warning-bg)' : 'var(--danger-bg)'}; margin-bottom: 14px;">
            <div class="inspector-card-header" style="background: ${esExito ? 'rgba(245, 158, 11, 0.12)' : 'rgba(244, 63, 94, 0.12)'};">
              <div class="inspector-card-title" style="color: ${esExito ? 'var(--warning)' : 'var(--danger)'};">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                ${esExito ? 'Observaciones de la Inspección' : 'Fallo en la Inspección de Disco'}
              </div>
              <span class="status-badge ${esExito ? 'idle' : 'error'}">${esExito ? 'Con Observaciones' : 'Inspección Fallida'}</span>
            </div>
            <div style="padding: 12px 16px; font-size: 12px; display: flex; flex-direction: column; gap: 6px;">
              ${advertencias.length > 0
                ? advertencias.map(a => `<div style="display: flex; gap: 8px; align-items: flex-start; color: var(--text);"><span>⚠️</span><span>${escapeHtml(a)}</span></div>`).join('')
                : '<div style="color: var(--text);">No se pudo completar el análisis del disco virtual.</div>'
              }
            </div>
          </div>
        `;
      } else {
        this.dom.inspectorWarningsBox.style.display = 'none';
        this.dom.inspectorWarningsBox.innerHTML = '';
      }
    }

    // 1. Resumen de Imagen y Rendimiento
    const img = informe.imagen || {};
    const stats = informe.estadisticas || {};
    const vmInfo = informe.vm_info || {};
    const esquema = informe.esquema || 'Mbr';
    const particiones = informe.particiones || [];
    const programas = informe.programas || [];

    // Formato amigable de hipervisor
    let hipNombre = 'Desconocido';
    if (typeof img.hipervisor === 'string') {
      hipNombre = img.hipervisor;
    } else if (img.hipervisor && img.hipervisor.nombre) {
      hipNombre = img.hipervisor.nombre;
    }

    if (this.dom.lblInspFormato) this.dom.lblInspFormato.textContent = (img.formato || 'VMDK').toUpperCase();
    if (this.dom.lblInspHipervisor) this.dom.lblInspHipervisor.textContent = hipNombre;
    if (this.dom.lblInspTamanoVirtual) this.dom.lblInspTamanoVirtual.textContent = formatearBytes(img.tamano_virtual || img.tamano_real || 0);
    if (this.dom.lblInspTamanoReal) this.dom.lblInspTamanoReal.textContent = formatearBytes(img.tamano_real || 0);
    if (this.dom.lblInspAcceso) this.dom.lblInspAcceso.textContent = stats.modo_acceso || 'Nativo';
    if (this.dom.lblInspDuracion) this.dom.lblInspDuracion.textContent = `${stats.duracion_ms || 0} ms`;
    if (this.dom.lblInspBytesLeidos) this.dom.lblInspBytesLeidos.textContent = formatearBytes(stats.bytes_leidos || 0);
    if (this.dom.lblInspQemuCalls) this.dom.lblInspQemuCalls.textContent = `${stats.invocaciones_qemu || 0} llamadas`;

    // 2. Información del Sistema Operativo Huésped
    let soNombre = vmInfo.os_nombre || informe.sistema_operativo || 'Desconocido';
    if (!esExito && (soNombre === 'Desconocido' || soNombre === 'No identificado')) {
      soNombre = 'No identificado (Fallo de inspección)';
    }
    let soDetalle = [];
    if (vmInfo.os_edition_version) soDetalle.push(`Versión ${vmInfo.os_edition_version}`);
    if (vmInfo.os_build) soDetalle.push(`Build ${vmInfo.os_build}`);
    if (vmInfo.os_service_pack) soDetalle.push(vmInfo.os_service_pack);

    if (this.dom.lblInspSoNombre) this.dom.lblInspSoNombre.textContent = soNombre;
    if (this.dom.lblInspSoDetalles) {
      this.dom.lblInspSoDetalles.textContent = soDetalle.length > 0 ? soDetalle.join(' • ') : 'Sin datos adicionales de compilación';
    }
    if (this.dom.lblInspVmTools) {
      if (vmInfo.vmtools_version) {
        this.dom.lblInspVmTools.innerHTML = `<span class="metric-badge-ok">✓ ${escapeHtml(vmInfo.vmtools_version)}</span>`;
      } else {
        this.dom.lblInspVmTools.innerHTML = `<span style="color: var(--text-muted); font-size: 12px;">No detectadas</span>`;
      }
    }

    // 3. Mapa de Particiones y Sistemas de Archivos
    if (this.dom.lblInspEsquema) this.dom.lblInspEsquema.textContent = `Tabla: ${esquema}`;
    if (this.dom.listInspParticiones) {
      if (particiones.length === 0) {
        this.dom.listInspParticiones.innerHTML = `<div class="empty-history-text" style="padding: 16px;">${esExito ? 'No se detectaron particiones estructuradas.' : 'No se pudieron leer las particiones debido a errores en el disco.'}</div>`;
      } else {
        this.dom.listInspParticiones.innerHTML = particiones.map((p, idx) => {
          const fsNombre = typeof p.sistema_archivos === 'string' ? p.sistema_archivos : (p.sistema_archivos?.nombre || 'desconocido');
          let fsBadgeClass = 'fs-other';
          const fsLower = fsNombre.toLowerCase();
          if (fsLower.includes('ntfs')) fsBadgeClass = 'fs-ntfs';
          else if (fsLower.includes('ext')) fsBadgeClass = 'fs-ext';
          else if (fsLower.includes('fat')) fsBadgeClass = 'fs-fat';
          else if (fsLower.includes('xfs') || fsLower.includes('btrfs')) fsBadgeClass = 'fs-linux';

          return `
            <div class="inspector-partition-item">
              <div class="part-header-row">
                <span class="part-index">Partición #${p.indice !== undefined ? p.indice : idx + 1}</span>
                <span class="fs-badge ${fsBadgeClass}">${escapeHtml(fsNombre.toUpperCase())}</span>
              </div>
              <div class="part-info-grid">
                <div><span class="part-label">Tamaño:</span> <strong>${formatearBytes(p.tamano || 0)}</strong></div>
                <div><span class="part-label">Inicio:</span> <span style="font-family: monospace;">0x${(p.inicio || 0).toString(16).toUpperCase()}</span></div>
                <div><span class="part-label">Tipo:</span> ${escapeHtml(p.tipo || 'Desconocido')}</div>
                <div><span class="part-label">Etiqueta:</span> ${escapeHtml(p.etiqueta || '(Sin etiqueta)')}</div>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    // 4. Poblar selector de categorías en la tabla de software
    const categoriasSet = new Set();
    programas.forEach(p => {
      if (p.categoria) categoriasSet.add(p.categoria);
    });

    if (this.dom.selectCategoriaSoftwareInspector) {
      const opts = [
        '<option value="todas">🏷️ Todas las Categorías</option>',
        ...Array.from(categoriasSet).sort().map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`)
      ];
      this.dom.selectCategoriaSoftwareInspector.innerHTML = opts.join('');
      this.filtroCategoriaSoftware = 'todas';
    }

    if (this.dom.inputFiltrarSoftwareInspector) {
      this.dom.inputFiltrarSoftwareInspector.value = '';
      this.filtroTextoSoftware = '';
    }

    this.renderTablaSoftware();
  }

  /**
   * Renderiza las filas de la tabla de programas detectados según los filtros activos.
   */
  renderTablaSoftware() {
    if (!this.ultimoInforme || !this.dom.tbodySoftwareInspector) return;
    const programas = this.ultimoInforme.programas || [];

    const filtrados = programas.filter(p => {
      const matchTexto = !this.filtroTextoSoftware ||
        (p.nombre && p.nombre.toLowerCase().includes(this.filtroTextoSoftware)) ||
        (p.editor && p.editor.toLowerCase().includes(this.filtroTextoSoftware)) ||
        (p.version && p.version.toLowerCase().includes(this.filtroTextoSoftware)) ||
        (Array.isArray(p.tags) && p.tags.some(t => t.toLowerCase().includes(this.filtroTextoSoftware)));

      const matchCat = this.filtroCategoriaSoftware === 'todas' ||
        (p.categoria && p.categoria.toLowerCase() === this.filtroCategoriaSoftware.toLowerCase());

      return matchTexto && matchCat;
    });

    if (this.dom.lblTotalProgramasInspector) {
      this.dom.lblTotalProgramasInspector.textContent = `${filtrados.length} de ${programas.length} programas`;
    }

    if (filtrados.length === 0) {
      this.dom.tbodySoftwareInspector.innerHTML = `
        <tr>
          <td colspan="5" style="text-align: center; padding: 24px; color: var(--text-muted);">
            No se encontraron programas que coincidan con los filtros aplicados.
          </td>
        </tr>
      `;
      return;
    }

    this.dom.tbodySoftwareInspector.innerHTML = filtrados.map(p => {
      const catHtml = p.categoria
        ? `<span class="consultor-category-badge">${escapeHtml(p.categoria)}</span>`
        : '<span style="color: var(--text-muted); font-size: 11px;">-</span>';

      const tagsHtml = Array.isArray(p.tags) && p.tags.length > 0
        ? `<div style="display: flex; flex-wrap: wrap; gap: 4px;">${p.tags.map(t => `<span class="consultor-tag-pill">#${escapeHtml(t)}</span>`).join('')}</div>`
        : '<span style="color: var(--text-muted); font-size: 11px;">-</span>';

      return `
        <tr>
          <td><strong style="color: var(--text);">${escapeHtml(p.nombre || '')}</strong></td>
          <td>${p.version ? `<span class="consultor-version-badge">v${escapeHtml(p.version)}</span>` : '<span style="color: var(--text-muted); font-size: 11px;">Sin versión</span>'}</td>
          <td>${p.editor ? escapeHtml(p.editor) : '<span style="color: var(--text-muted); font-size: 11px;">Desconocido</span>'}</td>
          <td>${catHtml}</td>
          <td>${tagsHtml}</td>
        </tr>
      `;
    }).join('');
  }
}

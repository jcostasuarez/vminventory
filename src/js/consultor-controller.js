/**
 * @file consultor-controller.js
 * @description Controlador de búsqueda, filtros interactivos y gestión de vistas del Consultor de Software.
 * @module js/consultor-controller
 */

import { escapeHtml } from './utils.js';

/**
 * @typedef {Object} FiltrosConsultor
 * @property {string} programa - Consulta por nombre de programa.
 * @property {string} vm - Consulta por nombre de VM o ruta.
 * @property {string} version - Consulta por versión específica.
 * @property {string} tipo - Tipo/Ubicación ('todos', 'Personas', 'Discos', 'Servidores').
 * @property {string} propietario - Nombre de persona, disco o servidor asignado.
 * @property {string} so - Sistema operativo huésped ('todos', 'windows', 'linux').
 */

/**
 * Clase que coordina la interfaz de usuario del Consultor, sus filtros, datalists y conmutación de vistas.
 */
export class ConsultorController {
  /**
   * Crea una instancia de ConsultorController.
   * @param {Object} domElements - Referencias a elementos DOM del consultor.
   * @param {Object} views - Mapeo de vistas instanciadas (`cardsView`, `graphView`).
   * @param {function(): void} onEjecutarBusqueda - Callback para disparar la búsqueda en el backend.
   */
  constructor(domElements, views, onEjecutarBusqueda) {
    this.dom = domElements;
    this.cardsView = views.cardsView;
    this.graphView = views.graphView;
    this.onEjecutarBusqueda = onEjecutarBusqueda;

    this.vistaActiva = 'tarjetas';
    this.ultimoResultado = null;

    this.initEvents();
  }

  /**
   * Conecta los controladores de eventos para inputs, conmutador de vistas y botones de limpieza.
   * @private
   */
  initEvents() {
    // Conmutador de Vistas: Diagrama vs Tarjetas
    if (this.dom.btnVistaDiagrama && this.dom.btnVistaTarjetas) {
      this.dom.btnVistaDiagrama.addEventListener('click', () => {
        if (this.dom.btnVistaDiagrama.disabled) return;
        this.cambiarVista('diagrama');
      });
      this.dom.btnVistaTarjetas.addEventListener('click', () => {
        if (this.dom.btnVistaTarjetas.disabled) return;
        this.cambiarVista('tarjetas');
      });
    }

    // Botón Limpiar Todos los Filtros
    if (this.dom.btnLimpiarFiltros) {
      this.dom.btnLimpiarFiltros.addEventListener('click', () => {
        this.limpiarFiltros();
        this.onEjecutarBusqueda();
      });
    }
  }

  /**
   * Conmuta la vista activa entre 'diagrama' (Grafo SVG) y 'tarjetas' (Cards list).
   *
   * @param {'diagrama'|'tarjetas'} vista - Tipo de vista a activar.
   * @returns {void}
   */
  cambiarVista(vista) {
    const hayCoincidencias = Boolean(
      this.ultimoResultado &&
      this.ultimoResultado.coincidencias &&
      this.ultimoResultado.coincidencias.length > 0
    );
    const diagramaHabilitado = Boolean(
      this.dom.btnVistaDiagrama && !this.dom.btnVistaDiagrama.disabled
    );
    const tarjetasHabilitado = Boolean(
      this.dom.btnVistaTarjetas && !this.dom.btnVistaTarjetas.disabled
    );

    if (!hayCoincidencias || (!diagramaHabilitado && !tarjetasHabilitado)) {
      if (this.dom.consultorCardsWrapper) this.dom.consultorCardsWrapper.style.display = 'none';
      if (this.dom.consultorGraphWrapper) this.dom.consultorGraphWrapper.style.display = 'none';
      return;
    }

    if (vista === 'diagrama' && !diagramaHabilitado) {
      vista = 'tarjetas';
    }

    this.vistaActiva = vista;
    if (vista === 'diagrama') {
      if (this.dom.btnVistaDiagrama) this.dom.btnVistaDiagrama.classList.add('active');
      if (this.dom.btnVistaTarjetas) this.dom.btnVistaTarjetas.classList.remove('active');
      if (this.dom.consultorGraphWrapper) this.dom.consultorGraphWrapper.style.display = 'flex';
      if (this.dom.consultorCardsWrapper) this.dom.consultorCardsWrapper.style.display = 'none';
      this.graphView.ajustarZoom();
    } else {
      if (this.dom.btnVistaTarjetas) this.dom.btnVistaTarjetas.classList.add('active');
      if (this.dom.btnVistaDiagrama) this.dom.btnVistaDiagrama.classList.remove('active');
      if (this.dom.consultorCardsWrapper) this.dom.consultorCardsWrapper.style.display = 'flex';
      if (this.dom.consultorGraphWrapper) this.dom.consultorGraphWrapper.style.display = 'none';
    }
  }

  /**
   * Restablece los campos de búsqueda y filtros a sus valores por defecto.
   */
  limpiarFiltros() {
    if (this.dom.inputBuscarPrograma) this.dom.inputBuscarPrograma.value = '';
    if (this.dom.inputBuscarVm) this.dom.inputBuscarVm.value = '';
    if (this.dom.inputBuscarVersion) this.dom.inputBuscarVersion.value = '';
    if (this.dom.selectBuscarTipo) this.dom.selectBuscarTipo.value = 'todos';
    if (this.dom.inputBuscarPropietario) this.dom.inputBuscarPropietario.value = '';
    if (this.dom.selectBuscarSo) this.dom.selectBuscarSo.value = 'todos';
    if (this.dom.selectBuscarCategoria) this.dom.selectBuscarCategoria.value = 'todas';
    if (this.dom.btnLimpiarPrograma) this.dom.btnLimpiarPrograma.style.display = 'none';
    if (this.dom.btnLimpiarVm) this.dom.btnLimpiarVm.style.display = 'none';
  }

  /**
   * Limpia todos los filtros y establece únicamente el valor del campo especificado.
   *
   * @param {'programa'|'vm'|'version'|'propietario'|'categoria'} campo - Nombre del campo a preservar.
   * @param {string} valor - Valor a asignar.
   */
  limpiarTodosFiltrosExcepto(campo, valor) {
    if (this.dom.inputBuscarPrograma) this.dom.inputBuscarPrograma.value = campo === 'programa' ? valor : '';
    if (this.dom.inputBuscarVm) this.dom.inputBuscarVm.value = campo === 'vm' ? valor : '';
    if (this.dom.inputBuscarVersion) this.dom.inputBuscarVersion.value = campo === 'version' ? valor : '';
    if (this.dom.selectBuscarTipo) this.dom.selectBuscarTipo.value = 'todos';
    if (this.dom.inputBuscarPropietario) this.dom.inputBuscarPropietario.value = campo === 'propietario' ? valor : '';
    if (this.dom.selectBuscarSo) this.dom.selectBuscarSo.value = 'todos';
    if (this.dom.selectBuscarCategoria) this.dom.selectBuscarCategoria.value = campo === 'categoria' ? valor : 'todas';
    if (this.dom.btnLimpiarPrograma) {
      this.dom.btnLimpiarPrograma.style.display = this.dom.inputBuscarPrograma && this.dom.inputBuscarPrograma.value ? 'block' : 'none';
    }
    if (this.dom.btnLimpiarVm) {
      this.dom.btnLimpiarVm.style.display = this.dom.inputBuscarVm && this.dom.inputBuscarVm.value ? 'block' : 'none';
    }
  }

  /**
   * Puebla los datalists de autocompletado y selectores de filtros.
   *
   * @param {string[]} [programas=[]] - Lista de programas disponibles.
   * @param {string[]} [vms=[]] - Lista de VMs disponibles.
   * @param {string[]} [versiones=[]] - Lista de versiones registradas.
   * @param {string[]} [propietarios=[]] - Lista de colaboradores y elementos.
   * @param {string[]} [categorias=[]] - Lista de categorías funcionales de vminspect-rs.
   * @returns {void}
   */
  poblarSugerencias(programas = [], vms = [], versiones = [], propietarios = [], categorias = []) {
    if (this.dom.datalistProgramas) {
      this.dom.datalistProgramas.innerHTML = programas
        .slice(0, 200)
        .map(p => `<option value="${escapeHtml(p)}">`)
        .join('');
    }
    if (this.dom.datalistVms) {
      this.dom.datalistVms.innerHTML = vms
        .slice(0, 200)
        .map(v => `<option value="${escapeHtml(v)}">`)
        .join('');
    }
    if (this.dom.datalistVersiones) {
      this.dom.datalistVersiones.innerHTML = versiones
        .slice(0, 100)
        .map(v => `<option value="${escapeHtml(v)}">`)
        .join('');
    }
    if (this.dom.datalistPropietarios) {
      this.dom.datalistPropietarios.innerHTML = propietarios
        .slice(0, 100)
        .map(u => `<option value="${escapeHtml(u)}">`)
        .join('');
    }
    if (this.dom.selectBuscarCategoria && categorias.length > 0) {
      const valorActual = this.dom.selectBuscarCategoria.value;
      const opts = [
        '<option value="todas">🏷️ Todas las Categorías</option>',
        ...categorias.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`)
      ];
      this.dom.selectBuscarCategoria.innerHTML = opts.join('');
      if (categorias.includes(valorActual)) {
        this.dom.selectBuscarCategoria.value = valorActual;
      }
    }
  }

  /**
   * Renderiza el resultado completo de la consulta de software, manejando estados vacíos y delegando en las vistas.
   *
   * @param {Object|null} resultado - Resultado estructurado devuelto por el backend.
   * @param {FiltrosConsultor} filtros - Filtros aplicados en la búsqueda.
   * @param {function(string): void} onAbrirUbicacion - Callback para abrir la carpeta de la VM.
   * @returns {void}
   */
  renderResultados(resultado, filtros = {}, onAbrirUbicacion) {
    this.ultimoResultado = resultado;

    const queryProg = (filtros.programa || '').trim();
    const queryVm = (filtros.vm || '').trim();
    const queryVer = (filtros.version || '').trim();
    const queryProp = (filtros.propietario || '').trim();
    const queryTipo = (filtros.tipo || 'todos');
    const querySo = (filtros.so || 'todos');
    const queryCat = (filtros.categoria || 'todas');

    const hayFiltroActivo = Boolean(
      queryProg ||
      queryVm ||
      queryProp ||
      (queryTipo && queryTipo !== 'todos') ||
      queryVer ||
      (querySo && querySo !== 'todos') ||
      (queryCat && queryCat !== 'todas')
    );

    // Caso 1: Sin base de datos configurada o sin reportes
    if (!resultado || (!resultado.total_archivos_json && !resultado.total_vms_escaneadas)) {
      if (this.dom.btnVistaDiagrama) {
        this.dom.btnVistaDiagrama.disabled = true;
        this.dom.btnVistaDiagrama.title = 'Diagrama disponible al consultar programas o VMs';
      }
      if (this.dom.btnVistaTarjetas) {
        this.dom.btnVistaTarjetas.disabled = true;
        this.dom.btnVistaTarjetas.title = 'Tarjetas disponibles al consultar programas o VMs';
      }
      if (this.dom.consultorEmptyState) {
        this.dom.consultorEmptyState.style.display = 'flex';
        this.dom.consultorEmptyState.innerHTML = `
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom: 8px; opacity: 0.6;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <div style="font-weight: 600;">No se encontró ningún reporte JSON en la carpeta configurada.</div>
          <div style="font-size: 11px; margin-top: 4px; color: var(--text-muted);">Configura el directorio de base de datos desde Ajustes para consultar las máquinas virtuales.</div>
        `;
      }
      if (this.dom.consultorGraphWrapper) this.dom.consultorGraphWrapper.style.display = 'none';
      if (this.dom.consultorCardsWrapper) this.dom.consultorCardsWrapper.style.display = 'none';
      if (this.dom.lblSoftwareMetricas) {
        this.dom.lblSoftwareMetricas.textContent = 'Sin reportes JSON encontrados. Configura la base de datos en Ajustes.';
      }
      return;
    }

    // Caso 2: Sin ningún filtro activo -> Solicitar al usuario que ingrese criterios
    if (!hayFiltroActivo) {
      if (this.dom.btnVistaDiagrama) {
        this.dom.btnVistaDiagrama.disabled = true;
        this.dom.btnVistaDiagrama.title = 'Aplica al menos un filtro para habilitar el diagrama relacional';
      }
      if (this.dom.btnVistaTarjetas) {
        this.dom.btnVistaTarjetas.disabled = true;
        this.dom.btnVistaTarjetas.title = 'Aplica al menos un filtro para ver las tarjetas';
      }
      if (this.dom.consultorGraphSvg) this.dom.consultorGraphSvg.innerHTML = '';
      if (this.dom.graphDetailDrawer) this.dom.graphDetailDrawer.style.display = 'none';
      if (this.dom.consultorCardsWrapper) {
        this.dom.consultorCardsWrapper.innerHTML = '';
        this.dom.consultorCardsWrapper.style.display = 'none';
      }
      if (this.dom.consultorGraphWrapper) this.dom.consultorGraphWrapper.style.display = 'none';
      if (this.dom.consultorEmptyState) {
        this.dom.consultorEmptyState.style.display = 'flex';
        this.dom.consultorEmptyState.innerHTML = `
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom: 8px; opacity: 0.6;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <div style="font-weight: 600;">Aplica al menos un filtro para consultar resultados.</div>
          <div style="font-size: 11px; margin-top: 4px; color: var(--text-muted);">
            Puedes buscar por Programa, Máquina Virtual, Persona, Disco o Servidor sobre ${resultado.total_vms_escaneadas} VMs indexadas (${resultado.total_programas_indexados} programas disponibles).
          </div>
        `;
      }
      if (this.dom.lblSoftwareMetricas) {
        this.dom.lblSoftwareMetricas.textContent = `${resultado.total_vms_escaneadas} VMs en base de datos (${resultado.total_programas_indexados} programas disponibles) • Aplica un filtro para ver resultados`;
      }
      return;
    }

    // Caso 3: Filtro activo pero sin coincidencias
    if (!resultado.coincidencias || resultado.coincidencias.length === 0) {
      if (this.dom.btnVistaDiagrama) {
        this.dom.btnVistaDiagrama.disabled = true;
        this.dom.btnVistaDiagrama.title = 'Sin coincidencias para los filtros aplicados';
      }
      if (this.dom.btnVistaTarjetas) {
        this.dom.btnVistaTarjetas.disabled = true;
        this.dom.btnVistaTarjetas.title = 'Sin coincidencias para los filtros aplicados';
      }
      if (this.dom.consultorGraphSvg) this.dom.consultorGraphSvg.innerHTML = '';
      if (this.dom.graphDetailDrawer) this.dom.graphDetailDrawer.style.display = 'none';
      if (this.dom.consultorCardsWrapper) {
        this.dom.consultorCardsWrapper.innerHTML = '';
        this.dom.consultorCardsWrapper.style.display = 'none';
      }
      if (this.dom.consultorGraphWrapper) this.dom.consultorGraphWrapper.style.display = 'none';
      if (this.dom.consultorEmptyState) {
        this.dom.consultorEmptyState.style.display = 'flex';
        this.dom.consultorEmptyState.innerHTML = `
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom: 8px; opacity: 0.6;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <div style="font-weight: 600;">No se encontraron resultados para los filtros ingresados.</div>
          <div style="font-size: 11px; margin-top: 4px; color: var(--text-muted);">${resultado.total_vms_escaneadas} VMs escaneadas en total.</div>
        `;
      }
      if (this.dom.lblSoftwareMetricas) {
        this.dom.lblSoftwareMetricas.textContent = `${resultado.total_vms_escaneadas} VMs en base de datos • 0 coincidencias`;
      }
      return;
    }

    // Caso 4: Coincidencias encontradas
    if (this.dom.consultorEmptyState) this.dom.consultorEmptyState.style.display = 'none';

    if (this.dom.btnVistaTarjetas) {
      this.dom.btnVistaTarjetas.disabled = false;
      this.dom.btnVistaTarjetas.title = 'Vista tradicional en tarjetas';
    }
    if (this.dom.btnVistaDiagrama) {
      this.dom.btnVistaDiagrama.disabled = false;
      this.dom.btnVistaDiagrama.title = 'Vista de diagrama relacional interactivo';
    }

    const vmsUnicas = new Set(resultado.coincidencias.map(c => c.ruta_carpeta || c.nombre_vm)).size;
    if (this.dom.lblSoftwareMetricas) {
      this.dom.lblSoftwareMetricas.innerHTML = `
        <strong>${resultado.coincidencias.length}</strong> coincidencia(s) de software en <strong>${vmsUnicas}</strong> máquina(s) virtual(es)
        <span style="opacity: 0.6; font-weight: normal; margin-left: 6px;">(${resultado.total_archivos_json} reportes escaneados)</span>
      `;
    }

    // Renderizar ambas vistas
    this.graphView.render(resultado.coincidencias, onAbrirUbicacion);
    this.cardsView.render(resultado.coincidencias, onAbrirUbicacion);

    // Activar vista seleccionada
    this.cambiarVista(this.vistaActiva);
  }
}

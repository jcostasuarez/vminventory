/**
 * @file modals.js
 * @description Gestor de ventanas modales y diálogos de configuración e historial.
 * @module js/modals
 */

/**
 * Clase encargada de inicializar y gestionar la apertura, cierre y accesibilidad de los modales en la aplicación.
 */
export class ModalsManager {
  /**
   * Crea una instancia de ModalsManager.
   * @param {Object} domElements - Mapeo de elementos DOM de los modales.
   * @param {function(): string} getHerramientaActiva - Función que retorna la herramienta seleccionada ('analizador' o 'consultor').
   */
  constructor(domElements, getHerramientaActiva) {
    this.modalHistorial = domElements.modalHistorial;
    this.modalAjustes = domElements.modalAjustes;
    this.modalConfigConsultor = domElements.modalConfigConsultor;
    this.modalSimuladorReglas = domElements.modalSimuladorReglas;

    this.btnOpenHistorial = domElements.btnOpenHistorial;
    this.btnOpenAjustes = domElements.btnOpenAjustes;
    this.btnOpenSimuladorReglas = domElements.btnOpenSimuladorReglas;
    this.btnCloseHistorial = domElements.btnCloseHistorial;
    this.btnOkHistorial = domElements.btnOkHistorial;
    this.btnCloseAjustes = domElements.btnCloseAjustes;
    this.btnCloseConfigConsultor = domElements.btnCloseConfigConsultor;
    this.btnCancelarConfigConsultor = domElements.btnCancelarConfigConsultor;
    this.btnCloseSimuladorReglas = domElements.btnCloseSimuladorReglas;
    this.btnOkSimuladorReglas = domElements.btnOkSimuladorReglas;

    this.getHerramientaActiva = getHerramientaActiva;
    this.initEvents();
  }

  /**
   * Conecta los controladores de eventos para apertura y cierre de modales.
   * @private
   */
  initEvents() {
    // Abrir Modal Historial
    if (this.btnOpenHistorial) {
      this.btnOpenHistorial.addEventListener('click', () => {
        this.abrirModal(this.modalHistorial);
      });
    }

    // Cerrar Modal Historial
    [this.btnCloseHistorial, this.btnOkHistorial].forEach(btn => {
      if (btn) {
        btn.addEventListener('click', () => {
          this.cerrarModal(this.modalHistorial);
        });
      }
    });

    // Abrir Modal Configuración según pestaña activa
    if (this.btnOpenAjustes) {
      this.btnOpenAjustes.addEventListener('click', () => {
        const activa = this.getHerramientaActiva();
        if (activa === 'consultor') {
          this.abrirModal(this.modalConfigConsultor);
        } else {
          this.abrirModal(this.modalAjustes);
        }
      });
    }

    // Cerrar Modal Analizador
    if (this.btnCloseAjustes) {
      this.btnCloseAjustes.addEventListener('click', () => {
        this.cerrarModal(this.modalAjustes);
      });
    }

    // Cerrar Modal Consultor
    [this.btnCloseConfigConsultor, this.btnCancelarConfigConsultor].forEach(btn => {
      if (btn) {
        btn.addEventListener('click', () => {
          this.cerrarModal(this.modalConfigConsultor);
        });
      }
    });

    // Abrir Modal Simulador de Reglas
    if (this.btnOpenSimuladorReglas) {
      this.btnOpenSimuladorReglas.addEventListener('click', () => {
        this.abrirModal(this.modalSimuladorReglas);
      });
    }

    // Cerrar Modal Simulador de Reglas
    [this.btnCloseSimuladorReglas, this.btnOkSimuladorReglas].forEach(btn => {
      if (btn) {
        btn.addEventListener('click', () => {
          this.cerrarModal(this.modalSimuladorReglas);
        });
      }
    });

    // Cerrar modales con clic fuera (overlay)
    [this.modalHistorial, this.modalAjustes, this.modalConfigConsultor, this.modalSimuladorReglas].forEach(modal => {
      if (!modal) return;
      modal.addEventListener('click', (e) => {
        if (e.target === modal) this.cerrarModal(modal);
      });
    });

    // Cerrar con tecla Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.cerrarTodos();
      }
    });
  }

  /**
   * Abre un modal específico.
   * @param {HTMLElement|null} modal - Elemento modal a abrir.
   */
  abrirModal(modal) {
    if (modal) {
      modal.classList.add('open');
    }
  }

  /**
   * Cierra un modal específico.
   * @param {HTMLElement|null} modal - Elemento modal a cerrar.
   */
  cerrarModal(modal) {
    if (modal) {
      modal.classList.remove('open');
    }
  }

  /**
   * Cierra todas las ventanas modales abiertas actualmente.
   */
  cerrarTodos() {
    [this.modalHistorial, this.modalAjustes, this.modalConfigConsultor, this.modalSimuladorReglas].forEach(modal => {
      if (modal) modal.classList.remove('open');
    });
  }
}

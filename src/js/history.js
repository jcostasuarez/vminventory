/**
 * @file history.js
 * @description Gestor de persistencia y almacenamiento local del historial de relevamientos ejecutados.
 * @module js/history
 */

/**
 * Clave de persistencia para el historial en localStorage.
 * @constant {string}
 */
const STORAGE_KEY_HISTORIAL = 'relevador_vms_historial_v1';

/**
 * @typedef {Object} EntradaHistorial
 * @property {string} [id] - Identificador único de la ejecución.
 * @property {string} [fecha] - Fecha y hora formateada.
 * @property {string} ruta_origen - Carpeta origen auditada.
 * @property {string} ruta_destino - Carpeta destino donde se guardó el reporte.
 * @property {string} [archivo_json] - Nombre del archivo de reporte.
 * @property {number} [total_vms] - Total de máquinas virtuales encontradas.
 * @property {number} [exitosas] - Total de máquinas analizadas con éxito.
 * @property {number} [con_observaciones] - Total de máquinas con advertencias.
 * @property {number} [discrepantes] - Total de máquinas con discrepancia de nombre.
 * @property {string} [duracion] - Duración formateada de la sesión.
 * @property {number} [peso_gb] - Volumen procesado en GB.
 */

/**
 * Clase encargada de la persistencia de las sesiones de relevamiento en el almacenamiento local.
 */
export class HistoryManager {
  /**
   * Crea una nueva instancia de HistoryManager y carga los registros previos.
   */
  constructor() {
    /** @type {EntradaHistorial[]} */
    this.historial = this.cargar();
  }

  /**
   * Carga la lista de sesiones previas guardadas en localStorage.
   *
   * @returns {EntradaHistorial[]} Lista de registros almacenados.
   */
  cargar() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_HISTORIAL);
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.warn("No se pudo cargar el historial de localStorage:", e);
      return [];
    }
  }

  /**
   * Persiste la lista de historial actual en localStorage.
   *
   * @returns {void}
   */
  guardar() {
    try {
      localStorage.setItem(STORAGE_KEY_HISTORIAL, JSON.stringify(this.historial));
    } catch (e) {
      console.error("Error al guardar historial:", e);
    }
  }

  /**
   * Agrega un nuevo registro al historial, limitando la colección a los 50 más recientes.
   *
   * @param {EntradaHistorial} entrada - Datos de la sesión finalizada.
   * @returns {EntradaHistorial} Registro normalizado guardado.
   */
  agregar(entrada) {
    const nuevoRegistro = {
      id: Date.now().toString(),
      fecha: new Date().toLocaleString(),
      ruta_origen: entrada.ruta_origen || '',
      ruta_destino: entrada.ruta_destino || '',
      archivo_json: entrada.archivo_json || '',
      total_vms: entrada.total_vms || 0,
      exitosas: entrada.exitosas || 0,
      con_observaciones: entrada.con_observaciones || 0,
      discrepantes: entrada.discrepantes || 0,
      duracion: entrada.duracion || '00:00',
      peso_gb: entrada.peso_gb || 0
    };

    this.historial.unshift(nuevoRegistro);
    if (this.historial.length > 50) {
      this.historial = this.historial.slice(0, 50);
    }
    this.guardar();
    return nuevoRegistro;
  }

  /**
   * Limpia y elimina todos los registros del historial.
   *
   * @returns {void}
   */
  limpiar() {
    this.historial = [];
    try {
      localStorage.removeItem(STORAGE_KEY_HISTORIAL);
    } catch (e) {
      console.error("Error al limpiar historial:", e);
    }
  }

  /**
   * Obtiene la totalidad de los registros históricos ordenados de forma descendente por fecha.
   *
   * @returns {EntradaHistorial[]} Lista completa de registros.
   */
  obtenerTodos() {
    return this.historial;
  }
}

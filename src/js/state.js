/**
 * @file state.js
 * @description Gestión reactiva de estado de configuración y persistencia local en el almacenamiento del navegador.
 * @module js/state
 */

/**
 * Clave de persistencia para localStorage.
 * @constant {string}
 */
export const STORAGE_KEY = 'relevador_vms_config_v4';

/**
 * @typedef {Object} AppConfig
 * @property {'light'|'dark'} tema - Tema visual seleccionado por defecto.
 * @property {number} max_hilos - Cantidad de hilos paralelos para escaneo de VMs.
 * @property {boolean} modo_dump - Habilita volcado exhaustivo de software sin filtros de ruido.
 * @property {boolean} incluir_system - Inspecciona colmena SYSTEM de Windows además de SOFTWARE.
 * @property {boolean} forzar_qemu - Fuerza el uso de qemu-nbd para todos los discos.
 * @property {string} ruta_qemu_nbd - Ruta personalizada al binario ejecutable qemu-nbd.
 * @property {string} ruta_reglas - Ruta personalizada al archivo de reglas TOML.
 * @property {number|null} tamano_chunk_kb - Tamaño de chunk para caché de bloques en KB.
 * @property {boolean} generar_discrepancias - Compara discrepancias de nombres entre carpeta y VM.
 * @property {boolean} habilitar_bitacora - Visualiza la terminal de logs en tiempo real.
 * @property {boolean} mostrar_progreso_individual - Muestra la barra de progreso individual por VM.
 * @property {string} nombre_archivo_salida - Nombre personalizado para el archivo JSON exportado.
 * @property {string} ruta_bd_json - Ruta de la base de datos de JSONs para el consultor.
 */

/**
 * Configuración predeterminada de la aplicación.
 * @type {AppConfig}
 */
export const CONFIG_DEFAULT = {
  tema: 'light',
  max_hilos: 4,
  modo_dump: false,
  incluir_system: false,
  forzar_qemu: false,
  ruta_qemu_nbd: '',
  ruta_reglas: '',
  tamano_chunk_kb: null,
  generar_discrepancias: false,
  habilitar_bitacora: false,
  mostrar_progreso_individual: false,
  nombre_archivo_salida: 'Relevamiento_VMs.json',
  ruta_bd_json: ''
};

/**
 * Clase que encapsula el estado reactivo de configuración y su persistencia.
 */
export class AppState {
  /**
   * Crea una nueva instancia de AppState cargando valores persistidos.
   */
  constructor() {
    /** @type {AppConfig} */
    this.config = { ...CONFIG_DEFAULT };
    this.cargar();
  }

  /**
   * Carga la configuración desde localStorage fusionándola con los valores por defecto.
   *
   * @returns {AppConfig} Configuración actualizada.
   */
  cargar() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Migración de ruta_qemu_img a ruta_qemu_nbd si existe
        if (parsed.ruta_qemu_img && !parsed.ruta_qemu_nbd) {
          parsed.ruta_qemu_nbd = parsed.ruta_qemu_img;
        }
        delete parsed.ruta_qemu_img;
        // Excluir nombre_archivo_salida para que nunca se persista entre sesiones y siempre use el default
        delete parsed.nombre_archivo_salida;
        this.config = { ...CONFIG_DEFAULT, ...parsed };
      }
    } catch (e) {
      console.warn("No se pudo cargar la configuración de localStorage, usando defaults:", e);
      this.config = { ...CONFIG_DEFAULT };
    }
    return this.config;
  }

  /**
   * Actualiza y persiste parcialmente los valores de configuración en localStorage.
   *
   * @param {Partial<AppConfig>} nuevosValores - Propiedades a modificar.
   * @returns {AppConfig} Configuración persistida.
   */
  guardar(nuevosValores) {
    this.config = { ...this.config, ...nuevosValores };
    try {
      const aGuardar = { ...this.config };
      // No persistir el nombre de archivo de salida en localStorage
      delete aGuardar.nombre_archivo_salida;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(aGuardar));
    } catch (e) {
      console.error("Error al persistir configuración en localStorage:", e);
    }
    return this.config;
  }

  /**
   * Restablece la configuración a los valores originales por defecto y limpia localStorage.
   *
   * @returns {AppConfig} Configuración por defecto.
   */
  restablecer() {
    this.config = { ...CONFIG_DEFAULT };
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.error("Error al limpiar configuración:", e);
    }
    return this.config;
  }

  /**
   * Genera el DTO con los tipos estrictos esperados por los comandos Tauri de Rust.
   *
   * @returns {Object} Payload serializable para el backend.
   */
  obtenerPayload() {
    return {
      max_hilos: Number(this.config.max_hilos) || 4,
      modo_dump: Boolean(this.config.modo_dump),
      incluir_system: Boolean(this.config.incluir_system),
      forzar_qemu: Boolean(this.config.forzar_qemu),
      ruta_qemu_nbd: this.config.ruta_qemu_nbd ? this.config.ruta_qemu_nbd : null,
      ruta_reglas: this.config.ruta_reglas ? this.config.ruta_reglas : null,
      tamano_chunk_kb: this.config.tamano_chunk_kb ? Number(this.config.tamano_chunk_kb) : null,
      generar_discrepancias: Boolean(this.config.generar_discrepancias),
      habilitar_bitacora: Boolean(this.config.habilitar_bitacora),
      mostrar_progreso_individual: Boolean(this.config.mostrar_progreso_individual),
      nombre_archivo_salida: this.config.nombre_archivo_salida || 'Relevamiento_VMs.json'
    };
  }
}

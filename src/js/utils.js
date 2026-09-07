/**
 * @file utils.js
 * @description Utilidades generales para manipulación de cadenas, escape de HTML y análisis de rutas de almacenamiento.
 * @module js/utils
 */

/**
 * @typedef {Object} InfoDisco
 * @property {string} disco - Etiqueta descriptiva del disco o unidad (ej: "Disco C:", "Red \\Servidor", "/mnt/data").
 * @property {string} ubicacion - Ruta original normalizada del archivo o directorio.
 */

/**
 * Extrae la información de la unidad de disco, punto de montaje o recurso compartido de red a partir de una ruta de archivo.
 * Compatible con rutas de Windows (letras de unidad y rutas UNC) y sistemas basados en Unix/Linux/macOS.
 *
 * @param {string} ruta - Ruta completa del archivo o carpeta.
 * @returns {InfoDisco} Objeto con la identificación del disco y la ubicación.
 *
 * @example
 * extraerInfoDisco("C:\\VMs\\Windows10\\Win10.vmx");
 * // Devuelve: { disco: "Disco C:", ubicacion: "C:\\VMs\\Windows10\\Win10.vmx" }
 *
 * extraerInfoDisco("\\\\NasStorage\\VMs\\Ubuntu\\Ubuntu.vmx");
 * // Devuelve: { disco: "Red \\\\NasStorage", ubicacion: "\\\\NasStorage\\VMs\\Ubuntu\\Ubuntu.vmx" }
 */
export function extraerInfoDisco(ruta) {
  if (!ruta) return { disco: 'Unidad Local', ubicacion: '' };
  const rutaNorm = String(ruta).trim();

  // Caso 1: Unidad de disco Windows (C:\ o E:/)
  const winMatch = rutaNorm.match(/^([A-Za-z]:)/);
  if (winMatch) {
    return {
      disco: `Disco ${winMatch[1].toUpperCase()}`,
      ubicacion: rutaNorm
    };
  }

  // Caso 2: Ruta de red UNC Windows (\\Servidor\Recurso)
  const uncMatch = rutaNorm.match(/^(\\\\[^\\]+)/);
  if (uncMatch) {
    return {
      disco: `Red ${uncMatch[1]}`,
      ubicacion: rutaNorm
    };
  }

  // Caso 3: Puntos de montaje Unix / Linux / macOS (/mnt/..., /media/..., /Volumes/...)
  if (rutaNorm.startsWith('/mnt/') || rutaNorm.startsWith('/media/') || rutaNorm.startsWith('/Volumes/')) {
    const parts = rutaNorm.split('/').filter(Boolean);
    const mount = parts.length >= 2 ? `/${parts[0]}/${parts[1]}` : `/${parts[0] || ''}`;
    return {
      disco: mount,
      ubicacion: rutaNorm
    };
  }

  return {
    disco: 'Unidad Local',
    ubicacion: rutaNorm
  };
}

/**
 * Sanitiza una cadena de texto para evitar inyecciones XSS al renderizar HTML dinámicamente en el DOM.
 *
 * @param {*} str - Texto a escapar.
 * @returns {string} Cadena segura con caracteres especiales convertidos a entidades HTML.
 *
 * @example
 * escapeHtml("<script>alert('xss')</script>");
 * // Devuelve: "&lt;script&gt;alert(&#039;xss&#039;)&lt;/script&gt;"
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Trunca un texto a una longitud máxima determinada agregando puntos suspensivos ("…") si excede el límite.
 *
 * @param {string} str - Texto original.
 * @param {number} [len=20] - Longitud máxima permitida.
 * @returns {string} Texto truncado o el original si no supera el límite.
 *
 * @example
 * truncarTexto("Microsoft SQL Server 2019 Developer Edition", 25);
 * // Devuelve: "Microsoft SQL Server 201…"
 */
export function truncarTexto(str, len = 20) {
  if (!str) return '';
  const text = String(str);
  return text.length > len ? text.slice(0, len - 1) + '…' : text;
}

/**
 * Convierte una cantidad de bytes en una cadena formateada y legible (B, KB, MB, GB, TB, PB).
 *
 * @param {number|bigint|string} bytes - Cantidad de bytes a formatear.
 * @param {number} [decimales=2] - Cantidad de decimales deseados (por defecto 2).
 * @returns {string} Cadena formateada con la unidad de medida correspondiente.
 *
 * @example
 * formatearBytes(1048576);
 * // Devuelve: "1.00 MB"
 *
 * formatearBytes(53687091200);
 * // Devuelve: "50.00 GB"
 */
export function formatearBytes(bytes, decimales = 2) {
  const b = Number(bytes);
  if (!Number.isFinite(b) || b <= 0) return '0 B';

  const unidades = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const k = 1024;
  const dm = decimales < 0 ? 0 : decimales;
  const i = Math.min(Math.floor(Math.log(b) / Math.log(k)), unidades.length - 1);

  if (i === 0) {
    return `${b} B`;
  }

  const valor = (b / Math.pow(k, i)).toFixed(dm);
  return `${valor} ${unidades[i]}`;
}

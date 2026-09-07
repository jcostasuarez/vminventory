/**
 * @file theme.js
 * @description Gestor de temas visuales (Claro / Oscuro) de la aplicación.
 * @module js/theme
 */

/**
 * Clase responsable de alternar y sincronizar el tema visual de la interfaz de usuario.
 */
export class ThemeManager {
  /**
   * Crea una instancia de ThemeManager.
   * @param {HTMLElement|null} btnToggleTheme - Botón disparador para conmutar el tema.
   */
  constructor(btnToggleTheme) {
    this.btnToggleTheme = btnToggleTheme;
  }

  /**
   * Aplica el tema ('dark' o 'light') actualizando el atributo del documento HTML y el icono del botón.
   *
   * @param {string} tema - Nombre del tema a aplicar ('dark' o 'light').
   * @returns {void}
   */
  aplicarTema(tema) {
    const isDark = tema === 'dark';
    if (isDark) {
      document.documentElement.setAttribute('data-theme', 'dark');
      if (this.btnToggleTheme) {
        this.btnToggleTheme.innerHTML = `
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg>
          <span id="lblThemeText">Claro</span>
        `;
        this.btnToggleTheme.title = "Cambiar a Modo Claro";
      }
    } else {
      document.documentElement.removeAttribute('data-theme');
      if (this.btnToggleTheme) {
        this.btnToggleTheme.innerHTML = `
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          <span id="lblThemeText">Oscuro</span>
        `;
        this.btnToggleTheme.title = "Cambiar a Modo Oscuro";
      }
    }
  }
}

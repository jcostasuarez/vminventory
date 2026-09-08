import type { DomElementLike, Theme } from './types';

const ICON_MOON = `
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
  </svg>
`;

const ICON_SUN = `
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <circle cx="12" cy="12" r="5"/>
    <path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>
  </svg>
`;

type ThemeButton = Pick<DomElementLike, 'innerHTML' | 'title' | 'setAttribute'>;

/**
 * Mantiene sincronizados el atributo visual del documento y el botón de tema.
 * No conoce persistencia ni Tauri: esas decisiones pertenecen al arranque.
 */
export class ThemeManager {
  constructor(private readonly button: ThemeButton | null = null) {}

  aplicarTema(theme: Theme | string = 'light'): Theme {
    const normalizedTheme: Theme = theme === 'dark' ? 'dark' : 'light';
    const root = typeof document !== 'undefined' ? document.documentElement : null;

    if (root) {
      if (normalizedTheme === 'dark') {
        root.setAttribute('data-theme', 'dark');
      } else {
        root.removeAttribute('data-theme');
      }
    }

    if (this.button) {
      const dark = normalizedTheme === 'dark';
      this.button.innerHTML = `${dark ? ICON_SUN : ICON_MOON}<span id="lblThemeText">${dark ? 'Claro' : 'Oscuro'}</span>`;
      this.button.title = dark ? 'Cambiar a Modo Claro' : 'Cambiar a Modo Oscuro';
      this.button.setAttribute('aria-label', this.button.title);
    }

    return normalizedTheme;
  }

  alternar(theme: Theme = 'light'): Theme {
    return this.aplicarTema(theme === 'dark' ? 'light' : 'dark');
  }
}

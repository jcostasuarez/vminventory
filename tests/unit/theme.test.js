import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDomEnvironment, MockElement } from '../helpers/dom-helper.js';
import { ThemeManager } from '../../src/js/theme.js';

describe('Gestor de Temas (theme.js)', () => {
  beforeEach(() => {
    setupDomEnvironment();
  });

  it('debe aplicar el tema oscuro agregando data-theme="dark" al documentElement', () => {
    const btn = new MockElement('button');
    const themeManager = new ThemeManager(btn);

    themeManager.aplicarTema('dark');

    assert.equal(document.documentElement.getAttribute('data-theme'), 'dark');
    assert.equal(btn.title, 'Cambiar a Modo Claro');
    assert.ok(btn.innerHTML.includes('Claro'));
  });

  it('debe aplicar el tema claro removiendo el atributo data-theme', () => {
    const btn = new MockElement('button');
    const themeManager = new ThemeManager(btn);

    themeManager.aplicarTema('dark');
    assert.equal(document.documentElement.getAttribute('data-theme'), 'dark');

    themeManager.aplicarTema('light');
    assert.equal(document.documentElement.getAttribute('data-theme'), null);
    assert.equal(btn.title, 'Cambiar a Modo Oscuro');
    assert.ok(btn.innerHTML.includes('Oscuro'));
  });

  it('debe funcionar correctamente si el botón es nulo', () => {
    const themeManager = new ThemeManager(null);
    assert.doesNotThrow(() => {
      themeManager.aplicarTema('dark');
      themeManager.aplicarTema('light');
    });
  });
});

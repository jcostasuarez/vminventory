/**
 * @file dom-helper.js
 * @description Entorno simulado de DOM ligero y autónomo para pruebas unitarias e integrales en Node.js.
 */

export class LocalStorageMock {
  constructor() {
    this.store = {};
  }
  getItem(key) {
    return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : null;
  }
  setItem(key, value) {
    this.store[key] = String(value);
  }
  removeItem(key) {
    delete this.store[key];
  }
  clear() {
    this.store = {};
  }
}

export class MockElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.attributes = {};
    this.style = {};
    this.children = [];
    this.parentElement = null;
    this.listeners = {};
    this._textContent = '';
    this._innerHTML = '';
    this.value = '';
    this.title = '';
    this.disabled = false;
  }

  get className() {
    return this.attributes['class'] || '';
  }

  set className(val) {
    this.attributes['class'] = val || '';
  }

  get classList() {
    const self = this;
    return {
      add(...classes) {
        const current = (self.attributes['class'] || '').split(/\s+/).filter(Boolean);
        classes.forEach(c => {
          if (!current.includes(c)) current.push(c);
        });
        self.attributes['class'] = current.join(' ');
      },
      remove(...classes) {
        const current = (self.attributes['class'] || '').split(/\s+/).filter(Boolean);
        self.attributes['class'] = current.filter(c => !classes.includes(c)).join(' ');
      },
      contains(cls) {
        const current = (self.attributes['class'] || '').split(/\s+/).filter(Boolean);
        return current.includes(cls);
      },
      toggle(cls) {
        if (this.contains(cls)) {
          this.remove(cls);
          return false;
        } else {
          this.add(cls);
          return true;
        }
      }
    };
  }

  setAttribute(name, val) {
    this.attributes[name] = String(val);
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  hasAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name);
  }

  get textContent() {
    if (this.children.length > 0) {
      return this.children.map(c => c.textContent).join('');
    }
    return this._textContent;
  }

  set textContent(val) {
    this.children = [];
    this._textContent = String(val);
    this._innerHTML = String(val);
  }

  get outerHTML() {
    const tag = this.tagName.toLowerCase();
    const attrs = Object.entries(this.attributes).map(([k, v]) => ` ${k}="${v}"`).join('');
    return `<${tag}${attrs}>${this.innerHTML}</${tag}>`;
  }

  get innerHTML() {
    if (this._rawInnerHTML !== undefined) {
      return this._rawInnerHTML;
    }
    if (this.children.length > 0) {
      return this.children.map(c => c.outerHTML).join('');
    }
    return this._innerHTML;
  }

  set innerHTML(html) {
    this._rawInnerHTML = String(html);
    this._innerHTML = String(html);
    this.children = parseHtmlToMockElements(this._innerHTML);
    this.children.forEach(c => c.parentElement = this);
  }

  appendChild(child) {
    this._rawInnerHTML = undefined;
    if (child instanceof MockDocumentFragment) {
      child.children.forEach(c => {
        c.parentElement = this;
        this.children.push(c);
      });
      child.children = [];
      return child;
    }
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentElement = null;
    }
    return child;
  }

  remove() {
    if (this.parentElement) {
      this.parentElement.removeChild(this);
    }
  }

  addEventListener(event, callback) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
  }

  removeEventListener(event, callback) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
  }

  dispatchEvent(event) {
    if (!event.target) event.target = this;
    const cbs = this.listeners[event.type] || [];
    cbs.forEach(cb => cb(event));
    if (this.parentElement && event.bubbles !== false) {
      this.parentElement.dispatchEvent(event);
    }
    return true;
  }

  click() {
    this.dispatchEvent({ type: 'click', target: this, preventDefault() {}, stopPropagation() {} });
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (matchesSelector(current, selector)) return current;
      current = current.parentElement;
    }
    return null;
  }

  querySelector(selector) {
    for (const child of this.children) {
      if (matchesSelector(child, selector)) return child;
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }

  querySelectorAll(selector) {
    const results = [];
    for (const child of this.children) {
      if (matchesSelector(child, selector)) results.push(child);
      results.push(...child.querySelectorAll(selector));
    }
    return results;
  }
}

export class MockDocumentFragment {
  constructor() {
    this.children = [];
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  querySelectorAll(selector) {
    const results = [];
    for (const child of this.children) {
      if (matchesSelector(child, selector)) results.push(child);
      results.push(...child.querySelectorAll(selector));
    }
    return results;
  }
}

function matchesSelector(element, selector) {
  if (!element || !selector) return false;
  const s = selector.trim();
  if (s.startsWith('.')) {
    const cls = s.slice(1);
    return element.classList.contains(cls);
  }
  if (s.startsWith('#')) {
    const id = s.slice(1);
    return element.getAttribute('id') === id;
  }
  if (s.startsWith('[') && s.endsWith(']')) {
    const attrExp = s.slice(1, -1);
    if (attrExp.includes('=')) {
      const [attr, val] = attrExp.split('=');
      const cleanVal = val.replace(/['"]/g, '');
      return element.getAttribute(attr.trim()) === cleanVal;
    }
    return element.hasAttribute(attrExp.trim());
  }
  return element.tagName === s.toUpperCase();
}

function parseHtmlToMockElements(html) {
  const elements = [];
  // Parseo regex simplificado de elementos HTML comunes en los tests
  const tagRegex = /<([a-zA-Z0-9\-]+)([^>]*)>([\s\S]*?)<\/\1>|<([a-zA-Z0-9\-]+)([^>]*)\/?>/g;
  let match;
  while ((match = tagRegex.exec(html)) !== null) {
    const tagName = match[1] || match[4];
    const rawAttrs = match[2] || match[5] || '';
    const inner = match[3] || '';

    const el = new MockElement(tagName);
    const attrRegex = /([a-zA-Z0-9\-]+)(?:=["']([^"']*)["'])?/g;
    let attrMatch;
    while ((attrMatch = attrRegex.exec(rawAttrs)) !== null) {
      const attrName = attrMatch[1];
      const attrVal = attrMatch[2] !== undefined ? attrMatch[2] : '';
      el.setAttribute(attrName, attrVal);
    }

    if (inner) {
      el.innerHTML = inner;
    }
    elements.push(el);
  }
  return elements;
}

export function setupDomEnvironment() {
  const localStorage = new LocalStorageMock();
  const documentElement = new MockElement('html');
  const body = new MockElement('body');
  documentElement.appendChild(body);

  const document = {
    documentElement,
    body,
    createElement(tag) {
      return new MockElement(tag);
    },
    createDocumentFragment() {
      return new MockDocumentFragment();
    },
    querySelector(selector) {
      return documentElement.querySelector(selector);
    },
    querySelectorAll(selector) {
      return documentElement.querySelectorAll(selector);
    },
    getElementById(id) {
      return documentElement.querySelector(`#${id}`);
    }
  };

  const window = {
    document,
    localStorage,
    IntersectionObserver: class {
      constructor(cb) {
        this.cb = cb;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  };

  globalThis.window = window;
  globalThis.document = document;
  globalThis.localStorage = localStorage;
  globalThis.HTMLElement = MockElement;
  globalThis.IntersectionObserver = window.IntersectionObserver;

  return { window, document, localStorage };
}

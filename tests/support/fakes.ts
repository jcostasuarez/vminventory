import type {
  DomClassList,
  DomElementLike,
  DomEvent,
  DomEventListener,
  DomStyle,
  StorageLike
} from '../../src/js/types';

export class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

class FakeClassList implements DomClassList {
  private readonly classes = new Set<string>();

  add(...classes: string[]): void {
    classes.forEach((className) => this.classes.add(className));
  }

  remove(...classes: string[]): void {
    classes.forEach((className) => this.classes.delete(className));
  }

  contains(className: string): boolean {
    return this.classes.has(className);
  }

  toggle(className: string, force?: boolean): boolean {
    const shouldAdd = force ?? !this.classes.has(className);
    if (shouldAdd) {
      this.classes.add(className);
    } else {
      this.classes.delete(className);
    }
    return shouldAdd;
  }
}

/**
 * Elemento mínimo del contrato DOM usado por los flujos, no una implementación
 * de navegador. Permite probar la frontera de UI con cualquier runtime.
 */
export class FakeElement implements DomElementLike {
  public readonly style: DomStyle = { display: '' };
  public readonly classList: DomClassList = new FakeClassList();
  public innerHTML = '';
  public textContent: string | null = '';
  public value = '';
  public title = '';
  public disabled = false;
  public checked = false;

  private readonly attributes = new Map<string, string>();
  private readonly listeners = new Map<string, DomEventListener[]>();

  addEventListener(type: string, listener: DomEventListener): void {
    const current = this.listeners.get(type) ?? [];
    current.push(listener);
    this.listeners.set(type, current);
  }

  dispatch(type: string, event: Partial<DomEvent> = {}): void {
    const domEvent: DomEvent = {
      ...event,
      type,
      target: this
    };
    for (const listener of this.listeners.get(type) ?? []) {
      listener(domEvent);
    }
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  focus(): void {}

  select(): void {}
}

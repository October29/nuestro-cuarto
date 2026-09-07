// Mock mínimo del DOM para poder instanciar ConnectMenu en tests de Node sin
// navegador. El constructor de ConnectMenu llama a document.getElementById para
// varios elementos; este helper devuelve nodos stub con las propiedades y
// métodos que ConnectMenu usa.

type Listener = (e?: unknown) => void;

export interface DomStub {
  addEventListener: (type: string, fn: Listener) => void;
  disabled: boolean;
  hidden: boolean;
  textContent: string;
  value: string;
  className: string;
  focus: () => void;
  listeners: Record<string, Listener[]>;
}

export function makeDomStub(): DomStub {
  const listeners: Record<string, Listener[]> = {};
  return {
    addEventListener: (type, fn) => {
      (listeners[type] ??= []).push(fn);
    },
    disabled: false,
    hidden: false,
    textContent: '',
    value: '',
    className: '',
    focus: () => undefined,
    listeners,
  };
}

const elements: Record<string, DomStub> = {};

export function installDomMocks(): void {
  const ids = [
    'create-room-btn',
    'room-code-display',
    'room-code-text',
    'room-code-input',
    'join-room-btn',
    'connection-status',
    'disconnect-btn',
    'connection-error',
  ];
  for (const id of ids) {
    elements[id] = makeDomStub();
  }

  // @ts-expect-error override document global en el entorno de test
  globalThis.document = {
    getElementById: (id: string) => elements[id] ?? null,
  };
}

export function getElement(id: string): DomStub {
  const el = elements[id];
  if (!el) throw new Error(`DOM stub no encontrado: ${id}`);
  return el;
}

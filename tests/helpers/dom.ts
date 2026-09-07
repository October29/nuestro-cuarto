// Mock mínimo del DOM para poder instanciar ConnectMenu y ChatPanel en tests de
// Node sin navegador. Los constructores llaman a document.getElementById para
// varios elementos; este helper devuelve nodos stub con las propiedades y
// métodos que el código usa.

type Listener = (e?: unknown) => void;

export interface DomStub {
  addEventListener: (type: string, fn: Listener) => void;
  removeEventListener: (type: string, fn: Listener) => void;
  disabled: boolean;
  hidden: boolean;
  textContent: string;
  value: string;
  className: string;
  tagName: string;
  focus: () => void;
  blur: () => void;
  maxLength: number;
  innerHTML: string;
  scrollTop: number;
  scrollHeight: number;
  appendChild: (node: unknown) => void;
  focusCount: number;
  blurCount: number;
  listeners: Record<string, Listener[]>;
}

export interface ElementStub {
  className: string;
  textContent: string;
}

export function makeDomStub(tagName: string): DomStub {
  const listeners: Record<string, Listener[]> = {};
  const update = (type: string, fn: Listener) => {
    (listeners[type] ??= []).push(fn);
  };
  const release = (type: string, fn: Listener) => {
    const arr = listeners[type];
    if (!arr) return;
    const idx = arr.indexOf(fn);
    if (idx !== -1) arr.splice(idx, 1);
  };

  const stub: DomStub = {
    listeners,
    disabled: false,
    hidden: false,
    textContent: '',
    value: '',
    className: '',
    tagName,
    maxLength: 0,
    innerHTML: '',
    scrollTop: 0,
    scrollHeight: 0,
    appendChild: () => undefined,
    focusCount: 0,
    blurCount: 0,
  };

  stub.addEventListener = update;
  stub.removeEventListener = release;
  stub.focus = () => {
    stub.focusCount += 1;
  };
  stub.blur = () => {
    stub.blurCount += 1;
  };

  return stub;
}

export function makeElementStub(): ElementStub {
  return { className: '', textContent: '' };
}

const elements: Record<string, DomStub> = {};
const documentListeners: Record<string, Listener[]> = {};

const TAG_BY_ID: Record<string, string> = {
  'create-room-btn': 'BUTTON',
  'room-code-display': 'DIV',
  'room-code-text': 'SPAN',
  'room-code-input': 'INPUT',
  'join-room-btn': 'BUTTON',
  'connection-status': 'DIV',
  'disconnect-btn': 'BUTTON',
  'connection-error': 'DIV',
  'chat-panel': 'DIV',
  'chat-messages': 'DIV',
  'chat-input': 'INPUT',
  'chat-send-btn': 'BUTTON',
  game: 'DIV',
};

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
    'chat-panel',
    'chat-messages',
    'chat-input',
    'chat-send-btn',
    'game',
  ];
  for (const id of ids) {
    elements[id] = makeDomStub(TAG_BY_ID[id]);
  }

  const listeners = documentListeners;
  for (const type of Object.keys(listeners)) {
    delete listeners[type];
  }

  // @ts-expect-error override document global en el entorno de test
  globalThis.document = {
    getElementById: (id: string) => elements[id] ?? null,
    createElement: () => makeElementStub(),
    addEventListener: (type: string, fn: Listener) => {
      (listeners[type] ??= []).push(fn);
    },
    removeEventListener: (type: string, fn: Listener) => {
      const arr = listeners[type];
      if (!arr) return;
      const idx = arr.indexOf(fn);
      if (idx !== -1) arr.splice(idx, 1);
    },
    activeElement: null,
  };
}

export function getElement(id: string): DomStub {
  const el = elements[id];
  if (!el) throw new Error(`DOM stub no encontrado: ${id}`);
  return el;
}

export function getDocumentListeners(type: string): Listener[] {
  return documentListeners[type] ?? [];
}

export function setActiveElement(el: unknown): void {
  const doc = globalThis as { document?: { activeElement?: unknown } };
  if (doc.document) {
    doc.document.activeElement = el;
  }
}
// Paso 3 Room-first: "Mis salas" como libreta local.
//
// - Wiring de la UI: crear guarda el ID, seleccionar entra con joinRoom(roomId),
//   olvidar solo quita la entrada de la libreta.
// - Integración con el servidor real: la sala olvidada sigue existiendo; entrar
//   en una sala inexistente NO la crea automáticamente.

import { describe, test, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { ConnectMenu } from '../src/ui/connectMenu';
import { RoomDirectory } from '../src/storage/roomDirectory';
import type { SessionHandlers, SessionState } from '../src/network/NetworkSession';
import { NetworkSession } from '../src/network/NetworkSession';
import type { NetworkTransport, TransportHandlers } from '../src/network/NetworkTransport';
import { installDomMocks, getElement } from './helpers/dom';
import { MemoryStorage } from './helpers/storage';
import { startTestSignaling, type TestSignalingServer } from './helpers/signaling';

class MemoryTransport implements NetworkTransport {
  constructor(private readonly handlers: TransportHandlers) {}
  connect(): Promise<void> {
    this.handlers.onOpen();
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  send(): boolean {
    return true;
  }
  close(): void {}
}

class StubSession {
  state: SessionState = 'idle';
  joinedCodes: string[] = [];
  createdAt: string[] = [];

  constructor(
    private readonly handlers: SessionHandlers,
    private readonly control: { failNextJoin: string | null },
  ) {}

  async createRoom(): Promise<string> {
    this.state = 'connecting';
    this.handlers.onRoomCreated?.('AB12CD');
    this.createdAt.push('AB12CD');
    this.state = 'connected';
    this.handlers.onOpen('AB12CD');
    return 'AB12CD';
  }

  async joinRoom(code: string): Promise<void> {
    this.joinedCodes.push(code);
    if (this.control.failNextJoin) {
      const message = this.control.failNextJoin;
      this.control.failNextJoin = null;
      this.state = 'error';
      throw new Error(message);
    }
    this.state = 'connecting';
    this.handlers.onRoomCreated?.(code);
    this.state = 'connected';
    this.handlers.onOpen(code);
  }

  close(): void {
    this.state = 'disconnected';
  }
}

interface MenuHarness {
  menu: ConnectMenu;
  directory: RoomDirectory;
  storage: MemoryStorage;
  readonly session: StubSession;
  readonly control: { failNextJoin: string | null };
}

function buildMenu(): MenuHarness {
  const storage = new MemoryStorage();
  const directory = new RoomDirectory(storage);
  const control = { failNextJoin: null as string | null };
  let session: StubSession | null = null;
  const menu = new ConnectMenu({
    roomDirectory: directory,
    createSession: (handlers) => {
      session = new StubSession(handlers as SessionHandlers, control);
      return session as unknown as NetworkSession;
    },
  });
  return {
    menu,
    directory,
    storage,
    control,
    get session(): StubSession {
      assert.ok(session, 'la sesión aún no se ha creado');
      return session as StubSession;
    },
  };
}

let server: TestSignalingServer | null = null;

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
});

beforeEach(() => {
  installDomMocks();
});

describe('UI: crear una sala la guarda en Mis salas', () => {
  test('crear con nombre guarda { roomId, name } en la libreta', async () => {
    const { menu, directory } = buildMenu();
    getElement('new-room-name-input').value = 'Nuestro Cuartito';

    await (menu as { handleCreate(): Promise<void> }).handleCreate();

    assert.deepEqual(directory.list(), [{ roomId: 'AB12CD', name: 'Nuestro Cuartito' }]);
  });

  test('crear sin nombre usa un nombre por defecto', async () => {
    const { menu, directory } = buildMenu();
    await (menu as { handleCreate(): Promise<void> }).handleCreate();
    assert.deepEqual(directory.list(), [{ roomId: 'AB12CD', name: 'Sala AB12CD' }]);
  });

  test('la lista renderizada refleja las salas guardadas con Entrar y Olvidar', async () => {
    const { menu } = buildMenu();
    getElement('new-room-name-input').value = 'Nuestro Cuartito';
    await (menu as { handleCreate(): Promise<void> }).handleCreate();

    const rows = getElement('saved-rooms-list').children;
    assert.equal(rows.length, 1);
    const li = rows[0] as { children: unknown[]; className: string };
    const texts = li.children.map((child) => {
      const c = child as { textContent?: string; className?: string };
      return `${c.className}/${c.textContent}`;
    });
    assert.ok(texts.some((t) => t.includes('room-name/Nuestro Cuartito')));
    assert.ok(texts.some((t) => t.includes('room-id/AB12CD')));
    assert.ok(texts.some((t) => t.includes('/Entrar')));
    assert.ok(texts.some((t) => t.includes('/Olvidar')));
  });

  test('crear desde "Mis salas" no guarda al UNIR (join no auto-guarda)', async () => {
    const h = buildMenu();
    getElement('room-code-input').value = 'ZZ0000';
    await (h.menu as { handleJoin(): Promise<void> }).handleJoin();

    assert.deepEqual(h.session.joinedCodes, ['ZZ0000']);
    assert.deepEqual(h.directory.list(), [], 'unirse a una sala no debe crearla en la libreta');
  });
});

describe('UI: seleccionar y olvidar', () => {
  test('seleccionar una sala guardada llama a joinRoom con su roomId', async () => {
    const h = buildMenu();
    h.directory.save('ABCDEF', 'Mi rincón');

    await (h.menu as { enterSavedRoom(id: string): Promise<void> }).enterSavedRoom('ABCDEF');

    assert.deepEqual(h.session.joinedCodes, ['ABCDEF']);
  });

  test('olvidar quita la entrada de la libreta y de la lista', async () => {
    const { menu, directory } = buildMenu();
    directory.save('ABCDEF', 'Mi rincón');
    directory.save('123456', 'Sala 2');

    (menu as { forgetSavedRoom(id: string): void }).forgetSavedRoom('ABCDEF');

    assert.deepEqual(directory.list(), [{ roomId: '123456', name: 'Sala 2' }]);
    assert.equal(getElement('saved-rooms-list').children.length, 1);
  });

  test('entrar en una sala inexistente muestra error y no guarda nada nuevo', async () => {
    const { menu, directory, control } = buildMenu();
    directory.save('ABCDEF', 'Mi rincón');
    control.failNextJoin = 'sala no encontrada';

    await (menu as { enterSavedRoom(id: string): Promise<void> }).enterSavedRoom('ZZ9999');

    assert.equal(getElement('connection-error').hidden, false);
    assert.match(getElement('connection-error').textContent, /sala no encontrada/);
    // La libreta no cambió: no se inventó una sala nueva.
    assert.deepEqual(directory.list(), [{ roomId: 'ABCDEF', name: 'Mi rincón' }]);
  });
});

describe('Integración: la libreta y el servidor real', () => {
  test('entrar en una sala guardada funciona vía joinRoom(roomId)', async () => {
    server = await startTestSignaling();
    const session = new NetworkSession({
      handlers: { onOpen: () => {}, onMessage: () => {}, onPeerLeft: () => {}, onError: () => {} },
      signalingUrl: server.url,
      makeTransport: (_signaling, transportHandlers, _role) =>
        new MemoryTransport(transportHandlers),
    });
    const roomId = await session.createRoom();

    const directory = new RoomDirectory(null);
    directory.save(roomId, 'Creada');

    // "Seleccionar una sala guardada" = joinRoom(saved.roomId).
    const reentering = new NetworkSession({
      handlers: { onOpen: () => {}, onMessage: () => {}, onPeerLeft: () => {}, onError: () => {} },
      signalingUrl: server.url,
      makeTransport: (_signaling, transportHandlers, _role) =>
        new MemoryTransport(transportHandlers),
    });
    const saved = directory.get(roomId);
    assert.ok(saved, 'la sala debe estar en la libreta');
    await reentering.joinRoom(saved!.roomId);
    assert.equal(reentering.roomCode, roomId);
    assert.equal(reentering.state, 'connected');
  });

  test('olvidar la quita de la libreta pero la sala sigue existiendo en el servidor', async () => {
    server = await startTestSignaling();
    const creator = new NetworkSession({
      handlers: { onOpen: () => {}, onMessage: () => {}, onPeerLeft: () => {}, onError: () => {} },
      signalingUrl: server.url,
      makeTransport: (_signaling, transportHandlers, _role) =>
        new MemoryTransport(transportHandlers),
    });
    const roomId = await creator.createRoom();

    const directory = new RoomDirectory(null);
    directory.save(roomId, 'Para olvidar');
    assert.equal(directory.remove(roomId), true);
    assert.deepEqual(directory.list(), []);

    // La Room del servidor sigue ahí: otro cliente entra con el MISMO código.
    const visitor = new NetworkSession({
      handlers: { onOpen: () => {}, onMessage: () => {}, onPeerLeft: () => {}, onError: () => {} },
      signalingUrl: server.url,
      makeTransport: (_signaling, transportHandlers, _role) =>
        new MemoryTransport(transportHandlers),
    });
    await visitor.joinRoom(roomId);
    assert.equal(visitor.state, 'connected');
  });

  test('entrar en una sala inexistente falla y NO la crea automáticamente', async () => {
    server = await startTestSignaling();
    const directory = new RoomDirectory(null);
    directory.save('ABCDEF', 'Única guardada');

    const session = new NetworkSession({
      handlers: { onOpen: () => {}, onMessage: () => {}, onPeerLeft: () => {}, onError: () => {} },
      signalingUrl: server.url,
      makeTransport: (_signaling, transportHandlers, _role) =>
        new MemoryTransport(transportHandlers),
    });

    await assert.rejects(() => session.joinRoom('ZZZZZZ'), /sala no encontrada/);
    assert.equal(session.state, 'error');

    // La libreta no ganó ninguna entrada.
    assert.deepEqual(directory.list(), [{ roomId: 'ABCDEF', name: 'Única guardada' }]);

    // Y el servidor no creó la sala: un segundo intento sigue fallando.
    const second = new NetworkSession({
      handlers: { onOpen: () => {}, onMessage: () => {}, onPeerLeft: () => {}, onError: () => {} },
      signalingUrl: server.url,
      makeTransport: (_signaling, transportHandlers, _role) =>
        new MemoryTransport(transportHandlers),
    });
    await assert.rejects(() => second.joinRoom('ZZZZZZ'), /sala no encontrada/);
  });
});
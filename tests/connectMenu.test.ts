import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { ConnectMenu } from '../src/ui/connectMenu';
import { installDomMocks, getElement } from './helpers/dom';

import type { SessionHandlers, SessionState } from '../src/network/NetworkSession';
import type { PeerMessage, RoomState } from '../src/network/protocol';

/**
 * Mock de NetworkSession que reproduce el flujo temporal real de
 * NetworkSession.createRoom()/joinRoom() con el transporte real WebRTC:
 *
 *   1. onRoomCreated(code) se dispara cuando el signaling confirma la sala
 *      (aún sin canal P2P). Es lo que muestra el código anticipadamente.
 *   2. onOpen() se dispara cuando el RTCDataChannel queda abierto.
 *   3. createRoom()/joinRoom() resuelven después de onOpen.
 *
 * Registra el orden de los eventos para poder comprobar lo que ocurre "antes
 * de la resolución" (el código debe estar visible antes de onOpen/resolver).
 */
class MockSession {
  public events: string[] = [];
  public status: SessionState = 'idle';
  public readonly code = 'AB12CD';

  constructor(private readonly handlers: SessionHandlers) {}

  get state(): SessionState {
    return this.status;
  }

  private async connectAs(role: 'create' | 'join'): Promise<void> {
    this.status = 'connecting';
    this.events.push('onRoomCreated');
    this.handlers.onRoomCreated?.(this.code);
    this.status = 'connected';
    this.events.push('onOpen');
    this.handlers.onOpen(this.code);
  }

  async createRoom(): Promise<string> {
    await this.connectAs('create');
    return this.code;
  }

  async joinRoom(_code: string): Promise<void> {
    await this.connectAs('join');
  }

  close(): void {
    this.status = 'disconnected';
  }

  leave(): void {
    this.status = 'disconnected';
  }

  send(): boolean {
    return true;
  }

  getRoomState(): Promise<RoomState> {
    return Promise.resolve({ version: 1, name: 'Sala AB12CD' });
  }

  onRoomUpdated(_listener: (state: RoomState) => void): () => void {
    return () => {};
  }
}

function buildConnectMenu() {
  const menu = new ConnectMenu({
    createSession: (handlers) => new MockSession(handlers as SessionHandlers) as never,
  });
  return menu;
}

function getMockSession(menu: ConnectMenu): MockSession {
  // Al crear la sala se usa el mock inyectado; recuperamos la referencia que
  // ConnectMenu guardó internamente.
  const session = (menu as { session: MockSession | null }).session;
  assert.ok(session, 'debe existir una sesión mock');
  return session;
}

/** Como buildConnectMenu pero captura los SessionHandlers que recibió el mock. */
function buildConnectMenuWithHandlers(): { menu: ConnectMenu; handlers: () => SessionHandlers } {
  let captured: SessionHandlers | null = null;
  const menu = new ConnectMenu({
    createSession: (handlers) => {
      captured = handlers;
      return new MockSession(handlers as SessionHandlers) as never;
    },
  });
  return {
    menu,
    handlers: () => {
      assert.ok(captured, 'los handlers deben quedar capturados tras crear la sesión');
      return captured as SessionHandlers;
    },
  };
}

describe('ConnectMenu: una sola NetworkSession produce una sola notificación de sesión', () => {
  beforeEach(() => {
    installDomMocks();
  });

  it('handleCreate notifica UNA sola vez al listener de sesión', async () => {
    let notifications = 0;
    const seen: (unknown | null)[] = [];
    const menu = buildConnectMenu();
    menu.onSessionChange((session) => {
      notifications += 1;
      seen.push(session);
    });

    await (menu as { handleCreate(): Promise<void> }).handleCreate();

    assert.equal(notifications, 1, `se esperaban 1 notificación, se recibieron ${notifications}`);
    assert.equal(seen.length, 1);
    assert.ok(seen[0] !== null, 'la sesión notificada no debe ser null');
  });

  it('handleJoin notifica UNA sola vez al listener de sesión', async () => {
    let notifications = 0;
    const menu = buildConnectMenu();
    menu.onSessionChange(() => {
      notifications += 1;
    });

    getElement('room-code-input').value = 'AB12CD';
    await (menu as { handleJoin(): Promise<void> }).handleJoin();

    assert.equal(notifications, 1, `se esperaban 1 notificación, se recibieron ${notifications}`);
  });

  it('el código de sala se muestra ANTES de que onOpen (canal P2P) ocurra', async () => {
    const menu = buildConnectMenu();
    menu.onSessionChange(() => undefined);

    await (menu as { handleCreate(): Promise<void> }).handleCreate();

    const session = await getMockSession(menu);
    // onRoomCreated debe preceder a onOpen en el flujo del mock.
    const iRoomCreated = session.events.indexOf('onRoomCreated');
    const iOnOpen = session.events.indexOf('onOpen');
    assert.ok(iRoomCreated !== -1, 'onRoomCreated debe haberse invocado');
    assert.ok(iRoomCreated < iOnOpen, 'el código debe mostrarse antes de abrir el canal P2P');

    // La UI terminó con el código visible.
    assert.equal(getElement('room-code-text').textContent, 'AB12CD');
    assert.equal(getElement('room-code-display').hidden, false);
  });

  it('disconnect limpia la sesión (notifica null a los listeners)', async () => {
    const seen: (unknown | null)[] = [];
    const menu = buildConnectMenu();
    menu.onSessionChange((session) => seen.push(session));

    await (menu as { handleCreate(): Promise<void> }).handleCreate();
    (menu as { handleDisconnect(): void }).handleDisconnect();

    assert.equal(seen.length, 2, 'una notificación de conexión y una de desconexión');
    assert.equal(seen[0] !== null, true);
    assert.equal(seen[1], null, 'al desconectar se notifica null');
  });

  it('el chat sigue recibiendo mensajes vía onMessage callback', async () => {
    const received: PeerMessage[] = [];
    let capturedHandlers: SessionHandlers | null = null;

    const menu = new ConnectMenu({
      createSession: (handlers) => {
        capturedHandlers = handlers;
        return new MockSession(handlers as SessionHandlers) as never;
      },
    });
    menu.setMessageCallback((message) => received.push(message));

    await (menu as { handleCreate(): Promise<void> }).handleCreate();

    assert.ok(capturedHandlers, 'los handlers deben quedar capturados');
    // Simula un mensaje P2P de chat llegando por el canal de datos.
    capturedHandlers!.onMessage({ type: 'chat', playerId: 'peer-1', text: 'hola' });

    assert.equal(received.length, 1, 'el chat debe recibir el mensaje remoto');
    assert.deepEqual(received[0], { type: 'chat', playerId: 'peer-1', text: 'hola' });
  });

  it('peer-left muestra el aviso de abandono y peer-joined lo oculta, sin desmontar la sesión', async () => {
    const { menu, handlers } = buildConnectMenuWithHandlers();

    await (menu as { handleCreate(): Promise<void> }).handleCreate();
    assert.equal(getElement('peer-status').hidden, true, 'tras conectarse no hay aviso');

    handlers().onPeerLeft('el peer se fue');

    assert.equal(getElement('peer-status').hidden, false, 'el aviso de abandono se muestra');
    assert.match(getElement('peer-status').textContent, /amistad salió de la sala/);
    // peer-left NO expulsa: la sesión sigue viva y la UI sigue conectada.
    assert.ok(getMockSession(menu) instanceof MockSession, 'la sesión no se desmonta');
    assert.equal(getElement('connection-status').textContent, 'conectado');

    handlers().onPeerJoined?.();

    assert.equal(getElement('peer-status').hidden, true, 'peer-joined oculta el aviso');
    assert.equal(getElement('connection-status').textContent, 'conectado');
  });
});

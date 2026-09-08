// Room State Step 3: integración ConnectMenu → RoomState → RoomScene.
//
// Estos tests verifican que el patrón de callbacks funciona correctamente:
// ConnectMenu obtiene RoomState y lo notifica, y un consumidor simulando
// RoomScene lo recibe y conserva.
//
// No se importa RoomScene directamente porque depende de Phaser. En su lugar,
// se simula el papel de RoomScene con un objeto simple que conserva el estado.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { ConnectMenu } from '../src/ui/connectMenu';
import { installDomMocks, getElement } from './helpers/dom';

import type { SessionHandlers, SessionState } from '../src/network/NetworkSession';
import type { RoomState } from '../src/network/protocol';

/** Simula el papel de RoomScene: conserva el RoomState recibido. */
class FakeRoomScene {
  roomState: RoomState | null = null;
  roomWidth: number = 800;
  roomHeight: number = 600;

  // Lifecycle tracking: counts how many times each persistent object was created
  playerCreateCount = 0;
  interactionSystemCreateCount = 0;
  pointerListenerCount = 0;
  geometryRebuildCount = 0;
  cameraBoundsUpdates = 0;

  // Simulated persistent references (survive geometry rebuilds)
  playerRef = { id: 'player-1' };
  interactionSystemRef = { id: 'interaction-1' };
  syncRef: unknown = null;

  setRoomState(state: RoomState): void {
    this.roomState = state;
    const dimsChanged = this.roomWidth !== state.width || this.roomHeight !== state.height;
    this.roomWidth = state.width;
    this.roomHeight = state.height;
    if (dimsChanged) {
      this.rebuildGeometry();
    }
  }

  getRoomState(): RoomState | null {
    return this.roomState;
  }

  /** Simulates create(): init persistent systems once, build geometry. */
  simulateCreate(): void {
    this.playerCreateCount += 1;
    this.interactionSystemCreateCount += 1;
    this.pointerListenerCount += 1;
    this.rebuildGeometry();
  }

  /** Simulates what setRoomState does on dimension change: rebuild geometry only. */
  private rebuildGeometry(): void {
    this.geometryRebuildCount += 1;
    this.cameraBoundsUpdates += 1;
    // Player, InteractionSystem, pointer listener are NOT recreated
  }

  /** Simulates startSync: stores reference to current player. */
  simulateStartSync(): void {
    this.syncRef = this.playerRef;
  }
}

class MockSession {
  public status: SessionState = 'idle';
  public readonly code = 'AB12CD';
  private roomState: RoomState = { version: 1, name: 'Sala AB12CD', width: 1200, height: 800 };
  private roomUpdatedListeners: Array<(state: RoomState) => void> = [];

  constructor(private readonly handlers: SessionHandlers) {}

  get state(): SessionState {
    return this.status;
  }

  private async connectAs(_role: 'create' | 'join'): Promise<void> {
    this.status = 'connecting';
    this.handlers.onRoomCreated?.(this.code);
    this.status = 'connected';
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
    return Promise.resolve({ ...this.roomState });
  }

  onRoomUpdated(listener: (state: RoomState) => void): () => void {
    this.roomUpdatedListeners.push(listener);
    return () => {
      const i = this.roomUpdatedListeners.indexOf(listener);
      if (i !== -1) this.roomUpdatedListeners.splice(i, 1);
    };
  }

  /** Simula una actualización del servidor: notifica tanto a los listeners
   *  directos de onRoomUpdated como al handler onRoomUpdated de SessionHandlers. */
  simulateServerUpdate(state: RoomState): void {
    this.roomState = state;
    // Notificar vía el handler de sesión (el camino que usa ConnectMenu)
    this.handlers.onRoomUpdated?.(state);
  }
}

function buildConnectMenu(): { menu: ConnectMenu; getSession: () => MockSession | null } {
  let lastSession: MockSession | null = null;
  const menu = new ConnectMenu({
    createSession: (handlers) => {
      lastSession = new MockSession(handlers as SessionHandlers);
      return lastSession as never;
    },
  });
  return {
    menu,
    getSession: () => lastSession,
  };
}

describe('Room State Step 3: ConnectMenu → RoomState → consumidor', () => {
  beforeEach(() => {
    installDomMocks();
  });

  it('una RoomScene simulada puede inicializarse con un RoomState válido', () => {
    const scene = new FakeRoomScene();
    const state: RoomState = { version: 1, name: 'hello', width: 1200, height: 800 };
    scene.setRoomState(state);
    assert.deepEqual(scene.getRoomState(), state);
  });

  it('la RoomScene simulada conserva el estado recibido', () => {
    const scene = new FakeRoomScene();
    scene.setRoomState({ version: 1, name: 'first', width: 1200, height: 800 });
    scene.setRoomState({ version: 1, name: 'second', width: 1200, height: 800 });
    assert.equal(scene.getRoomState()?.name, 'second');
  });

  it('ConnectMenu notifica el estado inicial de la Room', async () => {
    const { menu, getSession } = buildConnectMenu();
    const scene = new FakeRoomScene();

    menu.onRoomStateChange((state) => scene.setRoomState(state));

    await (menu as { handleCreate(): Promise<void> }).handleCreate();

    const session = getSession();
    assert.ok(session, 'debe existir una sesión');

    // El estado inicial debe haber llegado
    assert.ok(scene.getRoomState(), 'la escena debe tener un estado');
    assert.equal(scene.getRoomState()!.version, 1);
    assert.ok(scene.getRoomState()!.name.startsWith('Sala '), 'name debe comenzar con "Sala "');
  });

  it('name recibido por la escena coincide con el estado del servidor', async () => {
    const { menu, getSession } = buildConnectMenu();
    const scene = new FakeRoomScene();

    menu.onRoomStateChange((state) => scene.setRoomState(state));
    await (menu as { handleCreate(): Promise<void> }).handleCreate();

    const session = getSession();
    assert.ok(session);

    // Simula que el servidor envía un estado con name específico
    session.simulateServerUpdate({ version: 1, name: 'server-value', width: 1200, height: 800 });

    assert.equal(scene.getRoomState()?.name, 'server-value');
  });

  it('al actualizar RoomState desde NetworkSession, la escena recibe onRoomUpdated', async () => {
    const { menu, getSession } = buildConnectMenu();
    const received: RoomState[] = [];
    const scene = new FakeRoomScene();

    menu.onRoomStateChange((state) => {
      scene.setRoomState(state);
      received.push(state);
    });

    await (menu as { handleCreate(): Promise<void> }).handleCreate();

    const session = getSession();
    assert.ok(session);

    // El estado inicial ya se recibió
    assert.equal(received.length, 1, 'debe haber recibido el estado inicial');

    // Simula una actualización del servidor
    session.simulateServerUpdate({ version: 1, name: 'updated', width: 1200, height: 800 });

    assert.equal(received.length, 2, 'debe haber recibido la actualización');
    assert.equal(received[1].name, 'updated');
    assert.equal(scene.getRoomState()?.name, 'updated');
  });

  it('un segundo estado reemplaza correctamente el estado anterior', async () => {
    const { menu, getSession } = buildConnectMenu();
    const scene = new FakeRoomScene();

    menu.onRoomStateChange((state) => scene.setRoomState(state));
    await (menu as { handleCreate(): Promise<void> }).handleCreate();

    const session = getSession();
    assert.ok(session);

    session.simulateServerUpdate({ version: 1, name: 'first-update', width: 1200, height: 800 });
    assert.equal(scene.getRoomState()?.name, 'first-update');

    session.simulateServerUpdate({ version: 1, name: 'second-update', width: 1200, height: 800 });
    assert.equal(scene.getRoomState()?.name, 'second-update');
  });

  it('la escena no necesita WebRTC para recibir su estado inicial', async () => {
    // El MockSession no tiene WebRTC, pero el flujo funciona igual
    const { menu, getSession } = buildConnectMenu();
    const scene = new FakeRoomScene();

    menu.onRoomStateChange((state) => scene.setRoomState(state));
    await (menu as { handleCreate(): Promise<void> }).handleCreate();

    assert.ok(scene.getRoomState(), 'el estado debe llegar sin WebRTC');
    assert.equal(scene.getRoomState()!.version, 1);
  });

  it('la escena no accede directamente a SignalingClient', () => {
    // Verificación estructural: RoomScene (FakeRoomScene) no importa ni
    // usa SignalingClient. Solo recibe el estado vía callback.
    const scene = new FakeRoomScene();
    const sceneKeys = Object.getOwnPropertyNames(scene);
    const hasSignalingReference = sceneKeys.some(
      (k) => k.toLowerCase().includes('signaling') || k.toLowerCase().includes('client'),
    );
    assert.equal(hasSignalingReference, false, 'la escena no debe tener referencia directa a SignalingClient');
  });

  it('la escena no escribe directamente en RoomState', () => {
    // Verificación: la escena solo lee el estado, no lo muta
    const scene = new FakeRoomScene();
    const state: RoomState = { version: 1, name: 'original', width: 1200, height: 800 };
    scene.setRoomState(state);

    // La escena conserva la referencia; no la muta
    const stored = scene.getRoomState();
    assert.equal(stored?.name, 'original');

    // El objeto original no fue modificado
    assert.equal(state.name, 'original');
  });

  it('al desconectar, la escena conserva su último estado conocido', async () => {
    const { menu, getSession } = buildConnectMenu();
    const scene = new FakeRoomScene();

    menu.onRoomStateChange((state) => scene.setRoomState(state));
    await (menu as { handleCreate(): Promise<void> }).handleCreate();

    const session = getSession();
    assert.ok(session);

    // Simula una actualización antes de desconectar
    session.simulateServerUpdate({ version: 1, name: 'before-disconnect', width: 1200, height: 800 });
    assert.equal(scene.getRoomState()?.name, 'before-disconnect');

    // Desconectar
    (menu as { handleDisconnect(): void }).handleDisconnect();

    // La escena conserva el último estado conocido
    assert.equal(scene.getRoomState()?.name, 'before-disconnect',
      'la escena conserva el último estado conocido tras disconnect');
  });

  it('un join a sala existente también obtiene el estado inicial', async () => {
    const { menu, getSession } = buildConnectMenu();
    const scene = new FakeRoomScene();

    menu.onRoomStateChange((state) => scene.setRoomState(state));

    getElement('room-code-input').value = 'AB12CD';
    await (menu as { handleJoin(): Promise<void> }).handleJoin();

    assert.ok(scene.getRoomState(), 'el join también debe obtener el estado');
    assert.equal(scene.getRoomState()!.version, 1);
  });

  it('la escena consume width y height desde RoomState para su geometría', () => {
    const scene = new FakeRoomScene();
    const state: RoomState = { version: 1, name: 'test', width: 1200, height: 800 };
    scene.setRoomState(state);

    assert.equal(scene.roomWidth, 1200, 'roomWidth debe coincidir con state.width');
    assert.equal(scene.roomHeight, 800, 'roomHeight debe coincidir con state.height');
  });

  it('la escena usa dimensiones de RoomState y no las globales de config', () => {
    const scene = new FakeRoomScene();
    // Valores iniciales diferentes a los defaults
    assert.equal(scene.roomWidth, 800, 'roomWidth inicial es el default de Phaser (800)');
    assert.equal(scene.roomHeight, 600, 'roomHeight inicial es el default de Phaser (600)');

    // Al recibir RoomState, las dimensiones cambian a las del servidor
    scene.setRoomState({ version: 1, name: 'test', width: 1200, height: 800 });
    assert.equal(scene.roomWidth, 1200);
    assert.equal(scene.roomHeight, 800);
  });

  it('actualizar dimensiones reconstruye geometría y actualiza límites de cámara', () => {
    const scene = new FakeRoomScene();
    scene.simulateCreate();

    const buildsBefore = scene.geometryRebuildCount;
    const cameraBefore = scene.cameraBoundsUpdates;

    scene.setRoomState({ version: 1, name: 'test', width: 1600, height: 900 });

    assert.equal(scene.geometryRebuildCount, buildsBefore + 1, 'debe reconstruir geometría');
    assert.equal(scene.cameraBoundsUpdates, cameraBefore + 1, 'debe actualizar límites de cámara');
    assert.equal(scene.roomWidth, 1600);
    assert.equal(scene.roomHeight, 900);
  });

  it('actualizar dimensiones NO crea una segunda instancia del Player', () => {
    const scene = new FakeRoomScene();
    scene.simulateCreate();

    const playersBefore = scene.playerCreateCount;

    // Dimension change triggers geometry rebuild, NOT player recreation
    scene.setRoomState({ version: 1, name: 'test', width: 1600, height: 900 });

    assert.equal(scene.playerCreateCount, playersBefore,
      'el Player no debe recrearse por un cambio de dimensiones');
  });

  it('actualizar dimensiones NO duplica el listener de interacción', () => {
    const scene = new FakeRoomScene();
    scene.simulateCreate();

    const listenersBefore = scene.pointerListenerCount;

    scene.setRoomState({ version: 1, name: 'test', width: 1600, height: 900 });

    assert.equal(scene.pointerListenerCount, listenersBefore,
      'el listener de pointerdown no debe duplicarse');
  });

  it('la sincronización existente sigue asociada al Player actual tras cambio de dimensiones', () => {
    const scene = new FakeRoomScene();
    scene.simulateCreate();
    scene.simulateStartSync();

    const syncBefore = scene.syncRef;

    scene.setRoomState({ version: 1, name: 'test', width: 1600, height: 900 });

    assert.equal(scene.syncRef, syncBefore,
      'PlayerSync debe seguir apuntando al mismo Player');
  });

  it('el InteractionSystem no se recrea por cambio de dimensiones', () => {
    const scene = new FakeRoomScene();
    scene.simulateCreate();

    const systemsBefore = scene.interactionSystemCreateCount;

    scene.setRoomState({ version: 1, name: 'test', width: 1600, height: 900 });

    assert.equal(scene.interactionSystemCreateCount, systemsBefore,
      'InteractionSystem no debe recrearse');
  });
});

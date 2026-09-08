// Room State Step 1: el servidor mantiene un RoomState mínimo por Room y lo
// sirve vía signaling. La prueba fundamental:
//
//   crear Room → Room posee RoomState → cliente A obtiene RoomState
//   → cliente B entra → cliente B obtiene exactamente ese RoomState
//
// Se usa el servidor signaling real (en proceso) y un transporte mock.

import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { NetworkSession, type SessionHandlers } from '../src/network/NetworkSession';
import type { NetworkTransport, TransportHandlers } from '../src/network/NetworkTransport';
import type { RoomState } from '../src/network/protocol';
import { startTestSignaling, waitFor, WsTestClient, type TestSignalingServer } from './helpers/signaling';

let server: TestSignalingServer | null = null;

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
});

async function withServer(): Promise<TestSignalingServer> {
  server = await startTestSignaling();
  return server;
}

class MockTransport implements NetworkTransport {
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

function makeSession(s: TestSignalingServer): { session: NetworkSession; events: string[] } {
  const events: string[] = [];
  const handlers: SessionHandlers = {
    onOpen: () => events.push('onOpen'),
    onMessage: () => events.push('onMessage'),
    onPeerLeft: (reason) => events.push(`onPeerLeft:${reason}`),
    onError: () => events.push('onError'),
    onRoomCreated: () => events.push('onRoomCreated'),
  };
  const session = new NetworkSession({
    handlers,
    signalingUrl: s.url,
    makeTransport: (_signaling, transportHandlers) => new MockTransport(transportHandlers),
  });
  return { session, events };
}

describe('Room State: el servidor mantiene y sirve el estado de la Room', () => {
  test('una Room recién creada posee RoomState inicial con version: 1', async () => {
    const s = await withServer();
    const { session } = makeSession(s);

    const code = await session.createRoom();
    const state = await session.getRoomState();

    assert.equal(state.version, 1, 'el RoomState inicial debe tener version: 1');

    await session.close();
  });

  test('un participante puede solicitar room:get-state y recibir room:state', async () => {
    const s = await withServer();
    const { session } = makeSession(s);

    await session.createRoom();
    const state = await session.getRoomState();

    assert.ok(state, 'debe recibir un RoomState');
    assert.equal(typeof state, 'object', 'RoomState debe ser un objeto');

    await session.close();
  });

  test('el estado recibido tiene la forma correcta de RoomState', async () => {
    const s = await withServer();
    const { session } = makeSession(s);

    await session.createRoom();
    const state = await session.getRoomState();

    assert.equal(state.version, 1);
    assert.equal(state.testValue, '', 'testValue debe comenzar como string vacío');

    await session.close();
  });

  test('un segundo participante que entra a la misma Room obtiene el mismo RoomState', async () => {
    const s = await withServer();
    const creator = makeSession(s);
    const joiner = makeSession(s);

    const code = await creator.session.createRoom();
    const stateA = await creator.session.getRoomState();

    await joiner.session.joinRoom(code);
    const stateB = await joiner.session.getRoomState();

    assert.deepEqual(stateB, stateA, 'ambos participantes deben recibir el mismo RoomState');

    await joiner.session.close();
    await creator.session.close();
  });

  test('room:get-state no crea una Room nueva', async () => {
    const s = await withServer();
    // Usar WsTestClient directamente para probar el contrato del servidor
    const client = new WsTestClient(s.url);
    await client.open();

    client.send({ type: 'room:get-state' });
    const response = (await client.next()) as { type: string; message?: string };

    assert.equal(response.type, 'error', 'el servidor debe devolver error');
    assert.equal(response.message, 'no estás en ninguna sala');

    await client.close();
  });

  test('un socket que no pertenece a ninguna Room no puede obtener estado', async () => {
    const s = await withServer();
    // Usar WsTestClient directamente para probar el contrato del servidor
    const client = new WsTestClient(s.url);
    await client.open();

    client.send({ type: 'room:get-state' });
    const response = (await client.next()) as { type: string; message?: string };

    assert.equal(response.type, 'error', 'el servidor debe devolver error');
    assert.equal(response.message, 'no estás en ninguna sala');

    await client.close();
  });

  test('la operación de lectura no modifica el estado', async () => {
    const s = await withServer();
    const { session } = makeSession(s);

    await session.createRoom();
    const state1 = await session.getRoomState();
    const state2 = await session.getRoomState();
    const state3 = await session.getRoomState();

    assert.deepEqual(state1, state2, 'segunda lectura debe ser igual a la primera');
    assert.deepEqual(state2, state3, 'tercera lectura debe ser igual a la segunda');
    assert.equal(state1.version, 1);

    await session.close();
  });

  test('la existencia del RoomState es independiente de WebRTC (transport mock)', async () => {
    const s = await withServer();
    const { session } = makeSession(s);

    const code = await session.createRoom();

    // Transporte mock: no hay WebRTC real
    const state = await session.getRoomState();
    assert.equal(state.version, 1, 'RoomState funciona sin WebRTC');

    await session.close();
  });

  test('room:get-state funciona después de leave explícito de un peer', async () => {
    const s = await withServer();
    const creator = makeSession(s);
    const guest = makeSession(s);

    const code = await creator.session.createRoom();
    await guest.session.joinRoom(code);

    // Ambos presentes, ambos pueden obtener estado
    const stateCreator = await creator.session.getRoomState();
    const stateGuest = await guest.session.getRoomState();
    assert.deepEqual(stateCreator, stateGuest);

    // El guest se va
    guest.session.leave();
    await waitFor(() => creator.session.hasPeer === false);

    // El creator que permanece sigue pudiendo obtener el estado
    const stateAfter = await creator.session.getRoomState();
    assert.equal(stateAfter.version, 1, 'el estado sigue accesible después de que un peer se va');

    await creator.session.close();
  });

  test('room:get-state funciona en una Room vacía (todos los peers se fueron)', async () => {
    const s = await withServer();
    const creator = makeSession(s);
    const guest = makeSession(s);

    const code = await creator.session.createRoom();
    await guest.session.joinRoom(code);

    // Ambos se van
    creator.session.leave();
    guest.session.leave();
    await waitFor(() => creator.session.state === 'disconnected');
    await waitFor(() => guest.session.state === 'disconnected');

    // Un tercero entra en la Room vacía y puede obtener el estado
    const latecomer = makeSession(s);
    await latecomer.session.joinRoom(code);
    const state = await latecomer.session.getRoomState();

    assert.equal(state.version, 1, 'Room vacía sigue teniendo RoomState');

    await latecomer.session.close();
  });
});

describe('Room State Step 2: WRITE + BROADCAST', () => {
  test('una Room recién creada tiene testValue vacío', async () => {
    const s = await withServer();
    const { session } = makeSession(s);

    await session.createRoom();
    const state = await session.getRoomState();

    assert.equal(state.testValue, '', 'testValue debe comenzar como string vacío');

    await session.close();
  });

  test('un participante puede enviar room:update y recibir room:updated', async () => {
    const s = await withServer();
    const { session } = makeSession(s);

    await session.createRoom();
    const updated = await session.updateRoomState({ testValue: 'hello' });

    assert.equal(updated.version, 1, 'version no debe cambiar');
    assert.equal(updated.testValue, 'hello', 'testValue debe actualizarse');

    await session.close();
  });

  test('después de room:update, room:get-state devuelve el estado actualizado', async () => {
    const s = await withServer();
    const { session } = makeSession(s);

    await session.createRoom();
    await session.updateRoomState({ testValue: 'changed' });
    const state = await session.getRoomState();

    assert.equal(state.testValue, 'changed', 'getRoomState debe reflejar el update');

    await session.close();
  });

  test('el servidor aplica solamente propiedades permitidas (ignora extras)', async () => {
    const s = await withServer();
    const client = new WsTestClient(s.url);
    await client.open();

    // Crear sala
    client.send({ type: 'create' });
    const created = (await client.next()) as { type: string; roomCode: string };

    // Enviar update con una propiedad no permitida
    client.send({ type: 'room:update', patch: { testValue: 'ok', evil: 'hack' } });
    const response = (await client.next()) as { type: string; message?: string };

    assert.equal(response.type, 'error');
    assert.ok(response.message?.includes('propiedad no permitida'));

    await client.close();
  });

  test('version no puede ser modificada por el cliente', async () => {
    const s = await withServer();
    const client = new WsTestClient(s.url);
    await client.open();

    client.send({ type: 'create' });
    await client.next();

    client.send({ type: 'room:update', patch: { testValue: 'ok', version: 2 } });
    const response = (await client.next()) as { type: string; message?: string };

    assert.equal(response.type, 'error');
    assert.equal(response.message, 'no puedes modificar version');

    await client.close();
  });

  test('room:update modifica Room.state en el servidor', async () => {
    const s = await withServer();
    const creator = makeSession(s);
    const joiner = makeSession(s);

    const code = await creator.session.createRoom();
    await joiner.session.joinRoom(code);

    await creator.session.updateRoomState({ testValue: 'server-side-check' });

    // Ambos deben ver el cambio
    const stateA = await creator.session.getRoomState();
    const stateB = await joiner.session.getRoomState();

    assert.equal(stateA.testValue, 'server-side-check');
    assert.equal(stateB.testValue, 'server-side-check');

    await joiner.session.close();
    await creator.session.close();
  });

  test('el participante que hizo update recibe room:updated (vía callback)', async () => {
    const s = await withServer();
    let receivedState: RoomState | null = null;

    const session = new NetworkSession({
      handlers: {
        onOpen: () => {},
        onMessage: () => {},
        onPeerLeft: () => {},
        onError: () => {},
        onRoomUpdated: (state) => { receivedState = state; },
      },
      signalingUrl: s.url,
      makeTransport: (_signaling, transportHandlers) => new MockTransport(transportHandlers),
    });

    await session.createRoom();
    await session.updateRoomState({ testValue: 'from-me' });

    assert.ok(receivedState, 'debe recibir room:updated');
    assert.equal(receivedState!.testValue, 'from-me');

    await session.close();
  });

  test('otro participante presente recibe room:updated (broadcast)', async () => {
    const s = await withServer();
    let receivedByB: RoomState | null = null;

    const creator = new NetworkSession({
      handlers: {
        onOpen: () => {},
        onMessage: () => {},
        onPeerLeft: () => {},
        onError: () => {},
      },
      signalingUrl: s.url,
      makeTransport: (_signaling, transportHandlers) => new MockTransport(transportHandlers),
    });

    const joiner = new NetworkSession({
      handlers: {
        onOpen: () => {},
        onMessage: () => {},
        onPeerLeft: () => {},
        onError: () => {},
        onRoomUpdated: (state) => { receivedByB = state; },
      },
      signalingUrl: s.url,
      makeTransport: (_signaling, transportHandlers) => new MockTransport(transportHandlers),
    });

    const code = await creator.createRoom();
    await joiner.joinRoom(code);

    // Creator actualiza
    await creator.updateRoomState({ testValue: 'broadcast-test' });

    // Esperar a que el joiner procese el broadcast (async WebSocket)
    await waitFor(() => receivedByB !== null);

    // El joiner debe recibir la notificación
    assert.ok(receivedByB, 'el otro participante debe recibir room:updated');
    assert.equal(receivedByB!.testValue, 'broadcast-test');

    await joiner.close();
    await creator.close();
  });

  test('ambos terminan con el mismo estado tras room:update', async () => {
    const s = await withServer();
    const creator = makeSession(s);
    const joiner = makeSession(s);

    const code = await creator.session.createRoom();
    await joiner.session.joinRoom(code);

    await creator.session.updateRoomState({ testValue: 'sync-check' });

    const stateA = await creator.session.getRoomState();
    const stateB = await joiner.session.getRoomState();

    assert.deepEqual(stateA, stateB, 'ambos deben tener el mismo estado');

    await joiner.session.close();
    await creator.session.close();
  });

  test('un tercero que entra después obtiene el estado actualizado', async () => {
    const s = await withServer();
    const creator = makeSession(s);
    const first = makeSession(s);

    const code = await creator.session.createRoom();
    await first.session.joinRoom(code);

    await creator.session.updateRoomState({ testValue: 'persistent-state' });

    // El primero se va
    first.session.leave();
    await waitFor(() => creator.session.hasPeer === false);

    // Un tercero entra
    const third = makeSession(s);
    await third.session.joinRoom(code);
    const state = await third.session.getRoomState();

    assert.equal(state.testValue, 'persistent-state', 'el tercero debe ver el estado actualizado');

    await third.session.close();
    await creator.session.close();
  });

  test('el estado actualizado sobrevive a que todos abandonen la Room', async () => {
    const s = await withServer();
    const creator = makeSession(s);
    const joiner = makeSession(s);

    const code = await creator.session.createRoom();
    await joiner.session.joinRoom(code);

    await creator.session.updateRoomState({ testValue: 'survives-leave' });

    // Ambos se van
    creator.session.leave();
    joiner.session.leave();
    await waitFor(() => creator.session.state === 'disconnected');
    await waitFor(() => joiner.session.state === 'disconnected');

    // Un tercero entra y verifica
    const latecomer = makeSession(s);
    await latecomer.session.joinRoom(code);
    const state = await latecomer.session.getRoomState();

    assert.equal(state.testValue, 'survives-leave', 'el estado debe persistir tras leave de todos');

    await latecomer.session.close();
  });

  test('un socket que no pertenece a ninguna Room no puede ejecutar room:update', async () => {
    const s = await withServer();
    const client = new WsTestClient(s.url);
    await client.open();

    client.send({ type: 'room:update', patch: { testValue: 'no-room' } });
    const response = (await client.next()) as { type: string; message?: string };

    assert.equal(response.type, 'error');
    assert.equal(response.message, 'no estás en ninguna sala');

    await client.close();
  });

  test('una actualización inválida no modifica Room.state', async () => {
    const s = await withServer();
    const creator = makeSession(s);

    const code = await creator.session.createRoom();

    // Intento inválido desde un socket suelto
    const client = new WsTestClient(s.url);
    await client.open();
    client.send({ type: 'join', roomCode: code });
    await client.next(); // joined

    client.send({ type: 'room:update', patch: { version: 99 } });
    const error = (await client.next()) as { type: string; message?: string };
    assert.equal(error.type, 'error');

    // Verificar que el estado no cambió
    const state = await creator.session.getRoomState();
    assert.equal(state.testValue, '', 'el estado no debe haber cambiado');

    await client.close();
    await creator.session.close();
  });

  test('room:update funciona sin WebRTC (transport mock)', async () => {
    const s = await withServer();
    const { session } = makeSession(s);

    await session.createRoom();
    const updated = await session.updateRoomState({ testValue: 'no-webrtc' });

    assert.equal(updated.testValue, 'no-webrtc', 'room:update funciona sin WebRTC');

    await session.close();
  });
});

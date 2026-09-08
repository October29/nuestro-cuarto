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

    assert.equal(Object.keys(state).length, 1, 'RoomState solo debe tener version');
    assert.equal(state.version, 1);

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

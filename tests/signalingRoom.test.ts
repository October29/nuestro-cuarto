// Paso 1 Room-first: demuestra que la sala es una entidad server-owned,
// independiente de las conexiones (ROOM != CONNECTION).

import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestSignaling,
  WsTestClient,
  type TestSignalingServer,
} from './helpers/signaling';

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

async function createRoom(baseUrl: string): Promise<{ roomCode: string; socket: WsTestClient }> {
  const socket = new WsTestClient(baseUrl);
  await socket.open();
  socket.send({ type: 'create' });
  const created = (await socket.next()) as { type: string; roomCode?: string };
  assert.equal(created.type, 'created');
  assert.equal(typeof created.roomCode, 'string');
  assert.match(created.roomCode!, /^[A-Z2-9]{6}$/);
  return { roomCode: created.roomCode!, socket };
}

describe('room-first: la sala sobrevive a la desaparición del creador', () => {
  test('create registra una sala con id permanente y cada create genera una sala nueva', async () => {
    const s = await withServer();
    const { socket, roomCode } = await createRoom(s.url);

    const another = new WsTestClient(s.url);
    await another.open();
    another.send({ type: 'create' });
    const created = (await another.next()) as { type: string; roomCode?: string };
    assert.equal(created.type, 'created');
    assert.notEqual(created.roomCode, roomCode);

    await another.close();
    await socket.close();
  });

  test('el cierre del WebSocket NO elimina la sala: otro cliente puede unirse al mismo código', async () => {
    const s = await withServer();
    const { socket: creator, roomCode } = await createRoom(s.url);
    await creator.close();

    const visitor = new WsTestClient(s.url);
    await visitor.open();
    visitor.send({ type: 'join', roomCode });
    const joined = (await visitor.next()) as { type: string; roomCode?: string };
    assert.equal(joined.type, 'joined');
    assert.equal(joined.roomCode, roomCode);
    await visitor.close();
  });

  test('leave explícito tampoco elimina la sala', async () => {
    const s = await withServer();
    const { socket: creator, roomCode } = await createRoom(s.url);
    creator.send({ type: 'leave' });

    const visitor = new WsTestClient(s.url);
    await visitor.open();
    visitor.send({ type: 'join', roomCode });
    const joined = (await visitor.next()) as { type: string };
    assert.equal(joined.type, 'joined');
    await visitor.close();
    await creator.close();
  });

  test('el último participante abandona y la sala permanece: cualquiera puede volver', async () => {
    const s = await withServer();
    const { socket: creator, roomCode } = await createRoom(s.url);
    creator.send({ type: 'leave' });
    await creator.close();

    const visitor = new WsTestClient(s.url);
    await visitor.open();
    visitor.send({ type: 'join', roomCode });
    const joined = (await visitor.next()) as { type: string };
    assert.equal(joined.type, 'joined');

    visitor.send({ type: 'leave' });
    await visitor.close();

    const latecomer = new WsTestClient(s.url);
    await latecomer.open();
    latecomer.send({ type: 'join', roomCode });
    const rejoined = (await latecomer.next()) as { type: string };
    assert.equal(rejoined.type, 'joined');
    await latecomer.close();
  });
});

describe('room-first: presencia, peers y aforo', () => {
  test('salir con otro presente avisa al peer y libera el hueco', async () => {
    const s = await withServer();
    const { socket: host, roomCode } = await createRoom(s.url);

    const guest = new WsTestClient(s.url);
    await guest.open();
    guest.send({ type: 'join', roomCode });
    assert.equal((await guest.next()).type, 'joined');
    assert.equal((await host.next()).type, 'peer-joined');

    guest.send({ type: 'leave' });
    assert.equal((await host.next()).type, 'peer-left');

    // El host sigue dentro y el hueco queda libre para un tercero.
    const spare = new WsTestClient(s.url);
    await spare.open();
    spare.send({ type: 'join', roomCode });
    assert.equal((await spare.next()).type, 'joined');
    assert.equal((await host.next()).type, 'peer-joined');

    await spare.close();
    await guest.close();
    await host.close();
  });

  test('la desconexión de un peer despierta peer-left y no expulsa al que se queda', async () => {
    const s = await withServer();
    const { socket: host, roomCode } = await createRoom(s.url);

    const guest = new WsTestClient(s.url);
    await guest.open();
    guest.send({ type: 'join', roomCode });
    assert.equal((await guest.next()).type, 'joined');
    assert.equal((await host.next()).type, 'peer-joined');

    await guest.close();
    assert.equal((await host.next()).type, 'peer-left');

    // El host no es expulsado: puede unirse un tercero y recibe peer-joined.
    const spare = new WsTestClient(s.url);
    await spare.open();
    spare.send({ type: 'join', roomCode });
    assert.equal((await spare.next()).type, 'joined');
    assert.equal((await host.next()).type, 'peer-joined');

    await spare.close();
    await host.close();
  });

  test('unirse a una sala vacía funciona (reentrar tras quedar en cero)', async () => {
    const s = await withServer();
    const { socket: creator, roomCode } = await createRoom(s.url);
    await creator.close();

    const first = new WsTestClient(s.url);
    await first.open();
    first.send({ type: 'join', roomCode });
    assert.equal((await first.next()).type, 'joined');
    await first.close();

    const second = new WsTestClient(s.url);
    await second.open();
    second.send({ type: 'join', roomCode });
    assert.equal((await second.next()).type, 'joined');
    await second.close();
  });

  test('sala llena: un tercero es rechazado', async () => {
    const s = await withServer();
    const { socket: host, roomCode } = await createRoom(s.url);

    const guest = new WsTestClient(s.url);
    await guest.open();
    guest.send({ type: 'join', roomCode });
    assert.equal((await guest.next()).type, 'joined');
    assert.equal((await host.next()).type, 'peer-joined');

    const third = new WsTestClient(s.url);
    await third.open();
    third.send({ type: 'join', roomCode });
    const error = (await third.next()) as { type: string; message?: string };
    assert.equal(error.type, 'error');
    assert.equal(error.message, 'sala llena');

    await third.close();
    await guest.close();
    await host.close();
  });

  test('código inexistente devuelve sala no encontrada', async () => {
    const s = await withServer();
    const socket = new WsTestClient(s.url);
    await socket.open();
    socket.send({ type: 'join', roomCode: 'AAA111' });
    const error = (await socket.next()) as { type: string; message?: string };
    assert.equal(error.type, 'error');
    assert.equal(error.message, 'sala no encontrada');
    await socket.close();
  });
});

describe('room-first: signaling y ciclo de vida del proceso', () => {
  test('signal llega solo al peer presente en la sala', async () => {
    const s = await withServer();
    const { socket: host, roomCode } = await createRoom(s.url);

    const guest = new WsTestClient(s.url);
    await guest.open();
    guest.send({ type: 'join', roomCode });
    assert.equal((await guest.next()).type, 'joined');
    assert.equal((await host.next()).type, 'peer-joined');

    host.send({ type: 'signal', data: { kind: 'offer', sdp: 'prueba' } });
    assert.deepEqual(await guest.next(), { type: 'signal', data: { kind: 'offer', sdp: 'prueba' } });

    await guest.close();
    await host.close();
  });

  test('la sala muere SOLO con el proceso del servidor (sin disco)', async () => {
    const s = await withServer();
    const { socket: creator, roomCode } = await createRoom(s.url);
    await creator.close();

    await s.close(); // simula que el proceso del servidor termina

    const afterDeath = new WsTestClient(s.url);
    await assert.rejects(() => afterDeath.open());
  });
});
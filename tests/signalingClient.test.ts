// Paso 2 Room-first: SignalingClient.leave() contra el servidor real.
//
// Demuestra el contrato de la capa de signaling:
//   - leave() envía el mensaje de abandono (el peer recibe peer-left).
//   - La presencia del que abandona desaparece: puede volver a entrar.
//   - La Room nunca se destruye: otros participantes entran después.
//   - leave() y close() son operaciones distintas.

import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { SignalingClient } from '../src/network/SignalingClient';
import { startTestSignaling, waitFor, type TestSignalingServer } from './helpers/signaling';

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

function client(url: string, events: string[]): SignalingClient {
  const c = new SignalingClient(url);
  c.subscribe((m) => events.push(m.type));
  return c;
}

describe('SignalingClient.leave(): abandono explícito de la sala', () => {
  test('leave retira la presencia y avisa al peer con peer-left', async () => {
    const s = await withServer();

    const hostEvents: string[] = [];
    const host = client(s.url, hostEvents);
    await host.connect();
    const code = await host.createRoom();

    const guestEvents: string[] = [];
    const guest = client(s.url, guestEvents);
    await guest.connect();
    await guest.joinRoom(code);

    // El servidor avisa al host con peer-joined al entrar el guest; el mensaje
    // puede llegar un instante después de que el join del guest resuelva.
    await waitFor(() => hostEvents.includes('peer-joined'));
    assert.ok(hostEvents.includes('peer-joined'), 'el host debe enterarse de que un peer se unió');

    host.leave();

    // El peer presente recibe peer-left y la conexión del que se va sigue abierta.
    await waitFor(() => guestEvents.includes('peer-left'));
    assert.equal(host.state, 'connected', 'leave() no cierra la conexión');
  });

  test('leave deja la Room viva: el que abandona y otro pueden entrar después', async () => {
    const s = await withServer();

    const host = client(s.url, []);
    await host.connect();
    const code = await host.createRoom();

    const guest = client(s.url, []);
    await guest.connect();
    await guest.joinRoom(code);

    host.leave();
    assert.equal(host.state, 'connected');

    // La presencia de host se retiró: puede volver a entrar en la MISMA sala.
    await host.joinRoom(code);
    assert.equal(host.state, 'connected');

    // El guest se va para dejar hueco y un tercero entra en esa misma sala
    // (Room server-owned: sigue existiendo aunque nadie pida nada).
    guest.leave();
    const latecomer = client(s.url, []);
    await latecomer.connect();
    await latecomer.joinRoom(code);

    await latecomer.close();
    await guest.close();
    await host.close();
  });
});

describe('SignalingClient: leave() vs close()', () => {
  test('close() cierra la conexión sin anunciar leave; la Room tampoco se destruye', async () => {
    const s = await withServer();

    const host = client(s.url, []);
    await host.connect();
    const code = await host.createRoom();

    host.close(); // cierra la conexión (sin leave) y el server conserva la sala
    assert.equal(host.state, 'closed');

    const visitor = client(s.url, []);
    await visitor.connect();
    await visitor.joinRoom(code);
    await visitor.close();
  });

  test('leave() sin haber conectado es un no-op y no cambia el estado', async () => {
    const c = new SignalingClient('ws://127.0.0.1:1');
    c.leave();
    assert.equal(c.state, 'idle');
  });
});
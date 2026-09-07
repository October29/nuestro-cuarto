import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { SignalingClient } from '../src/network/SignalingClient';
import { startTestSignaling, WsTestClient } from './helpers/signaling';
import type { TestSignalingServer } from './helpers/signaling';

describe('SignalingClient (contra signaling real en proceso)', () => {
  let server: TestSignalingServer;
  afterEach(async () => {
    await server?.close();
  });

  it('createRoom devuelve el código generado por el servidor', async () => {
    server = await startTestSignaling();
    const client = new SignalingClient(server.url);
    await client.connect();
    const code = await client.createRoom('participant-a');
    assert.ok(typeof code === 'string' && code.length === 6);
  });

  it('joinRoom une a una sala existente y falla si no existe', async () => {
    server = await startTestSignaling();
    const host = new SignalingClient(server.url);
    await host.connect();
    const code = await host.createRoom('participant-host');

    const visitor = new SignalingClient(server.url);
    await visitor.connect();
    await visitor.joinRoom(code, 'participant-visitor');

    const lonely = new SignalingClient(server.url);
    await lonely.connect();
    await assert.rejects(() => lonely.joinRoom('ZZZZZZ', 'participant-x'), /sala no encontrada/);
  });

  it('resume reocupa el slot y deja el estado listo para renegociar', async () => {
    server = await startTestSignaling();
    const host = new SignalingClient(server.url);
    await host.connect();
    const code = await host.createRoom('participant-host-a');

    const visitor = new WsTestClient(server.url);
    await visitor.open();
    visitor.send({ type: 'join', roomCode: code, participantId: 'participant-v' });
    await visitor.next('joined');

    // El host "desaparece" (se cierra su WebSocket) y más tarde recupera.
    host.close();
    await new Promise((r) => setTimeout(r, 80)); // deja margen para que el servidor procese el close

    const recovered = new SignalingClient(server.url);
    await recovered.connect();
    const { peerActive } = await recovered.resume(code, 'participant-host-a', 'host');
    assert.equal(peerActive, true, 'el visitor sigue en la sala');
  });

  it('leave libera la sala para que una siguiente unión falle', async () => {
    server = await startTestSignaling();
    const host = new SignalingClient(server.url);
    await host.connect();
    const code = await host.createRoom('participant-host-x');

    host.leave();
    host.close();
    await new Promise((r) => setTimeout(r, 40));

    const later = new SignalingClient(server.url);
    await later.connect();
    await assert.rejects(() => later.joinRoom(code, 'participant-late'), /sala no encontrada/);
  });
});
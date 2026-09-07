import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { NetworkSession } from '../src/network/NetworkSession';
import { SignalingClient } from '../src/network/SignalingClient';
import { startTestSignaling } from './helpers/signaling';
import type { TestSignalingServer } from './helpers/signaling';
import type { TransportHandlers, NetworkTransport } from '../src/network/NetworkTransport';
import type { SessionHandlers, SessionRole } from '../src/network/NetworkSession';

/**
 * Transporte fake que abre el canal de datos de inmediato, sin WebRTC. Permite
 * probar NetworkSession (create/join/resume, participantes, estados) contra el
 * signaling real sin depender de RTCPeerConnection (no existe en Node).
 */
class FakeTransport implements NetworkTransport {
  constructor(
    private readonly handlers: TransportHandlers,
    private readonly role: SessionRole,
  ) {}

  connect(options?: { initiate?: boolean }): Promise<void> {
    void options;
    this.handlers.onOpen();
    return Promise.resolve();
  }

  send(): boolean {
    return true;
  }

  close(): void {
    this.handlers.onClose?.('cierre local (fake)');
  }
}

function makeSessionHandlers(trace: string[] = []): SessionHandlers {
  return {
    onOpen: (code) => trace.push(`open:${code}`),
    onMessage: () => trace.push('message'),
    onPeerLeft: (reason) => trace.push(`peer-left:${reason}`),
    onError: () => trace.push('error'),
    onRoomCreated: (code) => trace.push(`room-created:${code}`),
  };
}

function makeTransport(_signaling: SignalingClient, handlers: TransportHandlers, role: SessionRole): NetworkTransport {
  return new FakeTransport(handlers, role);
}

describe('NetworkSession (contra signaling real, transporte fake)', () => {
  let server: TestSignalingServer;
  afterEach(async () => {
    await server?.close();
  });

  it('createRoom conecta, muestra la sala por onRoomCreated y llega a connected como host', async () => {
    server = await startTestSignaling();
    const trace: string[] = [];
    const session = new NetworkSession({
      handlers: makeSessionHandlers(trace),
      signalingUrl: server.url,
      participantId: 'participant-host',
      makeTransport,
    });

    const code = await session.createRoom();
    assert.ok(typeof code === 'string' && code.length === 6);
    assert.equal(session.state, 'connected');
    assert.equal(session.role, 'host');
    assert.equal(session.roomCode, code);
    assert.ok(trace.includes(`room-created:${code}`));
  });

  it('joinRoom conecta como visitor', async () => {
    server = await startTestSignaling();
    const host = new NetworkSession({
      handlers: makeSessionHandlers(),
      signalingUrl: server.url,
      participantId: 'participant-host',
      makeTransport,
    });
    const code = await host.createRoom();

    const visitor = new NetworkSession({
      handlers: makeSessionHandlers(),
      signalingUrl: server.url,
      participantId: 'participant-visitor',
      makeTransport,
    });
    await visitor.joinRoom(code);
    assert.equal(visitor.state, 'connected');
    assert.equal(visitor.role, 'visitor');
  });

  it('sala llena: un tercero no puede unirse', async () => {
    server = await startTestSignaling();
    const host = new NetworkSession({
      handlers: makeSessionHandlers(),
      signalingUrl: server.url,
      participantId: 'participant-host',
      makeTransport,
    });
    const code = await host.createRoom();

    const visitor = new NetworkSession({
      handlers: makeSessionHandlers(),
      signalingUrl: server.url,
      participantId: 'participant-visitor',
      makeTransport,
    });
    await visitor.joinRoom(code);

    const intruder = new NetworkSession({
      handlers: makeSessionHandlers(),
      signalingUrl: server.url,
      participantId: 'participant-intruso',
      makeTransport,
    });
    await assert.rejects(() => intruder.joinRoom(code), /sala llena/);
    assert.equal(intruder.state, 'error');
  });

  it('el host recupera su sala tras un corte del signaling, sin crear otra', async () => {
    server = await startTestSignaling();
    const host = new NetworkSession({
      handlers: makeSessionHandlers(),
      signalingUrl: server.url,
      participantId: 'participant-host',
      makeTransport,
    });
    const code = await host.createRoom();

    const visitor = new NetworkSession({
      handlers: makeSessionHandlers(),
      signalingUrl: server.url,
      participantId: 'participant-visitor',
      makeTransport,
    });
    await visitor.joinRoom(code);

    // Simula la suspensión del host: se tira su WebSocket de signaling (sin
    // leave, por eso el slot queda en ventana de gracia).
    const signalingOfHost = (host as unknown as { signaling: SignalingClient }).signaling;
    signalingOfHost.close();
    await new Promise((r) => setTimeout(r, 80)); // margen para que el servidor procese el close

    const recovered = new NetworkSession({
      handlers: makeSessionHandlers(),
      signalingUrl: server.url,
      participantId: 'participant-host',
      makeTransport,
    });
    await recovered.resume(code, 'host');
    assert.equal(recovered.state, 'connected');
    assert.equal(recovered.role, 'host');
    assert.equal(recovered.roomCode, code, 'conserva el mismo código de sala');
  });

  it('el visitor recupera su slot tras un corte', async () => {
    server = await startTestSignaling();
    const host = new NetworkSession({
      handlers: makeSessionHandlers(),
      signalingUrl: server.url,
      participantId: 'participant-host',
      makeTransport,
    });
    const code = await host.createRoom();

    const visitor = new NetworkSession({
      handlers: makeSessionHandlers(),
      signalingUrl: server.url,
      participantId: 'participant-visitor',
      makeTransport,
    });
    await visitor.joinRoom(code);

    const signalingOfVisitor = (visitor as unknown as { signaling: SignalingClient }).signaling;
    signalingOfVisitor.close();
    await new Promise((r) => setTimeout(r, 80)); // margen para que el servidor procese el close

    const recovered = new NetworkSession({
      handlers: makeSessionHandlers(),
      signalingUrl: server.url,
      participantId: 'participant-visitor',
      makeTransport,
    });
    await recovered.resume(code, 'visitor');
    assert.equal(recovered.state, 'connected');
    assert.equal(recovered.role, 'visitor');
  });

  it('un participante sin sesión válida no puede apropiarse de una sala', async () => {
    server = await startTestSignaling();
    const host = new NetworkSession({
      handlers: makeSessionHandlers(),
      signalingUrl: server.url,
      participantId: 'participant-host',
      makeTransport,
    });
    const code = await host.createRoom();

    const intruder = new NetworkSession({
      handlers: makeSessionHandlers(),
      signalingUrl: server.url,
      participantId: 'participant-intruso',
      makeTransport,
    });
    await assert.rejects(() => intruder.resume(code, 'visitor'), /sesión no encontrada/);
  });

  it('close() envía leave: la sala queda libre y el código deja de ser válido', async () => {
    server = await startTestSignaling();
    const host = new NetworkSession({
      handlers: makeSessionHandlers(),
      signalingUrl: server.url,
      participantId: 'participant-host',
      makeTransport,
    });
    const code = await host.createRoom();

    host.close();
    assert.equal(host.state, 'disconnected');

    const later = new NetworkSession({
      handlers: makeSessionHandlers(),
      signalingUrl: server.url,
      participantId: 'participant-late',
      makeTransport,
    });
    await assert.rejects(() => later.joinRoom(code), /sala no encontrada/);
  });
});
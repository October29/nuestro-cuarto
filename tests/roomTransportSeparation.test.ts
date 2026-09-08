// Paso 4 Room-first: separación definitiva entre el ciclo de vida de la Room
// y el ciclo de vida del transporte P2P.
//
//  - createRoom() resuelve cuando el servidor confirma la sala (roomCode
//    válido y hasPeer===false), SIN esperar peer/DataChannel.
//  - join a sala vacía resuelve igual.
//  - La negociación P2P la dispara la presencia: el que ya está presente arma
//    el transporte y emite un offer cuando llega el otro; el que llega responde.
//  - peer-left / cierre de canal no destruye la sesión de Room: status se queda
//    en 'connected' y hasPeer baja; el siguiente participante vuelve a negociar.
//  - Reentrada del creador original vía joinRoom(roomId) sin resume.
//
// Se usa el servidor signaling real (en proceso) y un transporte mock que
// replica la negociación por presencia (peer-joined -> offer; offer -> open).
// WebRTC no está disponible en Node y queda fuera del alcance de este paso.

import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { NetworkSession, type SessionHandlers } from '../src/network/NetworkSession';
import type { NetworkTransport, TransportHandlers } from '../src/network/NetworkTransport';
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

interface TestSignaling {
  subscribe: (fn: (m: unknown) => void) => () => void;
  sendSignal: (data: { kind: string; [k: string]: unknown }) => void;
}

/**
 * Transporte mock que imita el comportamiento Room-first de RtcPeerTransport:
 *  - connect() arma el transporte y resuelve de inmediato (no espera peer).
 *  - El que ya está presente recibe peer-joined y emite un offer (se abre);
 *    el que llega recibe el offer y se abre. La negociación quedaría simulada.
 *  - peer-left/cierre de canal -> onClose, dejando el transporte rearmable.
 */
class NegotiatingTransport implements NetworkTransport {
  public peerJoinedCount = 0;
  private status: 'connecting' | 'open' = 'connecting';
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly signaling: TestSignaling,
    private readonly handlers: TransportHandlers,
  ) {}

  connect(): Promise<void> {
    this.unsubscribe = this.signaling.subscribe((message) => {
      const m = message as { type?: string; data?: { kind?: string } };

      if (m.type === 'peer-joined') {
        // Soy el que ya estaba presente: arranco la negociación y emito offer.
        this.peerJoinedCount += 1;
        this.signaling.sendSignal({ kind: 'offer', sdp: 'mock-offer' });
        this.open();
      } else if (m.type === 'signal' && m.data?.kind === 'offer') {
        // Soy quien acaba de llegar: respondo (negociación arrancada).
        this.peerJoinedCount += 1;
        this.open();
      } else if (m.type === 'peer-left') {
        if (this.status === 'open') {
          this.status = 'connecting';
          this.handlers.onClose('peer se fue');
        }
      }
    });
    return Promise.resolve();
  }

  private open(): void {
    if (this.status === 'open') return;
    this.status = 'open';
    this.handlers.onOpen();
  }

  send(): boolean {
    return true;
  }

  close(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.status = 'connecting';
  }
}

/**
 * Transporte mock que simula un fallo de negociación WebRTC: el primer
 * peer-joined provoca onError (sin abrir canal); las siguientes apariciones
 * de presencia abren el canal (una nueva negociación puede tener éxito).
 * La Room y la sesión deben seguir vivas tras el fallo.
 */
class FlakyTransport implements NetworkTransport {
  public negotiationAttempts = 0;
  public closeCalls = 0;
  private firstAttemptFailed = false;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly signaling: TestSignaling,
    private readonly handlers: TransportHandlers,
  ) {}

  connect(): Promise<void> {
    this.unsubscribe = this.signaling.subscribe((message) => {
      const m = message as { type?: string };
      if (m.type === 'peer-joined') {
        this.negotiationAttempts += 1;
        if (!this.firstAttemptFailed) {
          this.firstAttemptFailed = true;
          this.handlers.onError('fallo de negociación simulado');
        } else {
          this.handlers.onOpen();
        }
      }
    });
    return Promise.resolve();
  }

  send(): boolean {
    return true;
  }

  close(): void {
    this.closeCalls += 1;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
}

interface TrackedSession {
  session: NetworkSession;
  readonly transport: NegotiatingTransport;
  events: string[];
}

function makeNegotiatingSession(s: TestSignalingServer): TrackedSession {
  let transport: NegotiatingTransport | null = null;
  const events: string[] = [];
  const handlers: SessionHandlers = {
    onOpen: () => events.push('onOpen'),
    onMessage: () => events.push('onMessage'),
    onPeerLeft: () => events.push('onPeerLeft'),
    onError: () => events.push('onError'),
    onRoomCreated: () => events.push('onRoomCreated'),
  };
  const session = new NetworkSession({
    handlers,
    signalingUrl: s.url,
    makeTransport: (signaling, transportHandlers) => {
      transport = new NegotiatingTransport(
        signaling as unknown as TestSignaling,
        transportHandlers,
      );
      return transport;
    },
  });
  return {
    session,
    events,
    get transport(): NegotiatingTransport {
      assert.ok(transport, 'el transporte aún no se ha creado');
      return transport as NegotiatingTransport;
    },
  };
}

function makeFlakySession(s: TestSignalingServer): { session: NetworkSession; transport: FlakyTransport; events: string[] } {
  let transport: FlakyTransport | null = null;
  const events: string[] = [];
  const handlers: SessionHandlers = {
    onOpen: () => events.push('onOpen'),
    onMessage: () => events.push('onMessage'),
    onPeerLeft: () => events.push('onPeerLeft'),
    onError: () => events.push('onError'),
    onRoomCreated: () => events.push('onRoomCreated'),
  };
  const session = new NetworkSession({
    handlers,
    signalingUrl: s.url,
    makeTransport: (signaling, transportHandlers) => {
      transport = new FlakyTransport(signaling as unknown as TestSignaling, transportHandlers);
      return transport;
    },
  });
  return {
    session,
    events,
    get transport(): FlakyTransport {
      assert.ok(transport, 'el transporte aún no se ha creado');
      return transport as FlakyTransport;
    },
  };
}

describe('Paso 4: Room y transporte se resuelven por separado', () => {
  test('createRoom resuelve al ack del servidor: roomCode válido y hasPeer=false sin peer', async () => {
    const s = await withServer();
    const h = makeNegotiatingSession(s);

    const code = await h.session.createRoom();

    assert.match(code, /^[A-Z0-9]{6}$/, 'debe devolver un roomCode válido');
    assert.equal(h.session.roomCode, code);
    assert.equal(h.session.state, 'connected', 'la sala queda conectada aunque no haya peer');
    assert.equal(h.session.hasPeer, false, 'sin peer, hasPeer debe ser false');
    assert.ok(h.events.includes('onRoomCreated'), 'el ack del servidor dispara onRoomCreated');
    assert.equal(h.transport.peerJoinedCount, 0, 'aún no ha llegado ningún peer: sin negociación');
    assert.ok(!h.events.includes('onOpen'), 'sin peer no debe haber onOpen');
    h.session.close();
  });

  test('joinRoom a una sala vacía resuelve también sin peer', async () => {
    const s = await withServer();
    const creator = makeNegotiatingSession(s);
    const code = await creator.session.createRoom();

    const joiner = makeNegotiatingSession(s);
    await joiner.session.joinRoom(code);

    assert.equal(joiner.session.state, 'connected');
    assert.equal(joiner.session.roomCode, code);
    assert.ok(joiner.events.includes('onRoomCreated'));
    // El creador ya está presente: al entrar, la presencia dispara la
    // negociación (offer) hacia el recién llegado.
    await waitFor(() => joiner.transport.peerJoinedCount >= 1);
    await waitFor(() => joiner.events.includes('onOpen'));

    creator.session.close();
    joiner.session.close();
  });

  test('dos participantes negocian DESPUÉS de resolver cada uno (presencia dispara)', async () => {
    const s = await withServer();
    const a = makeNegotiatingSession(s);
    const b = makeNegotiatingSession(s);

    const code = await a.session.createRoom();
    assert.equal(a.session.state, 'connected');
    assert.equal(a.session.hasPeer, false);

    await b.session.joinRoom(code);

    // El presente (a) recibe peer-joined y emite offer; b lo recibe y se abre.
    await waitFor(() => a.transport.peerJoinedCount >= 1);
    await waitFor(() => b.transport.peerJoinedCount >= 1);
    await waitFor(() => a.events.includes('onOpen') && b.events.includes('onOpen'));

    assert.equal(a.session.state, 'connected');
    assert.equal(b.session.state, 'connected');
    assert.equal(a.session.hasPeer, true);
    assert.equal(b.session.hasPeer, true);

    a.session.close();
    b.session.close();
  });

  test('peer-left no destruye la sesión de Room: status sigue connected y hasPeer baja', async () => {
    const s = await withServer();
    const host = makeNegotiatingSession(s);
    const guest = makeNegotiatingSession(s);

    const code = await host.session.createRoom();
    await guest.session.joinRoom(code);
    await waitFor(() => host.session.hasPeer === true);
    const opensBefore = host.transport.peerJoinedCount;

    guest.session.leave(); // se va el peer

    await waitFor(() => host.session.hasPeer === false);
    assert.equal(host.session.state, 'connected', 'peer-left no baja el estado de la Room');
    assert.ok(host.events.includes('onPeerLeft'), 'el abandono del peer se avisa');
    assert.equal(host.transport.peerJoinedCount, opensBefore, 'no se re-negocia por el abandono');

    host.session.close();
  });

  test('el siguiente participante provoca una nueva negociación en la misma Room', async () => {
    const s = await withServer();
    const host = makeNegotiatingSession(s);
    const first = makeNegotiatingSession(s);

    const code = await host.session.createRoom();
    await first.session.joinRoom(code);
    await waitFor(() => host.session.hasPeer === true);
    const opensAfterFirst = host.transport.peerJoinedCount;
    assert.ok(opensAfterFirst >= 1);

    first.session.leave();
    await waitFor(() => host.session.hasPeer === false);

    // Nuevo participante en la MISMA Room -> el presente vuelve a negociar.
    const second = makeNegotiatingSession(s);
    await second.session.joinRoom(code);
    await waitFor(() => host.session.hasPeer === true);
    await waitFor(() => host.events.filter((e) => e === 'onOpen').length >= 2);
    assert.ok(
      host.transport.peerJoinedCount > opensAfterFirst,
      'la presencia del nuevo peer debe volver a disparar la negociación',
    );

    host.session.close();
    second.session.close();
  });

  test('el abandono del peer no desmonta la sesión: no se refresca la UI (onPeerLeft no-op)', async () => {
    const s = await withServer();
    const host = makeNegotiatingSession(s);
    let peerLeftEvents = 0;
    const session = new NetworkSession({
      handlers: {
        onOpen: () => {},
        onMessage: () => {},
        onPeerLeft: () => {
          peerLeftEvents += 1;
        },
        onError: () => {},
      },
      signalingUrl: s.url,
      makeTransport: (signaling, transportHandlers) =>
        new NegotiatingTransport(signaling as unknown as TestSignaling, transportHandlers),
    });
    const code = await host.session.createRoom();
    await session.joinRoom(code);
    await waitFor(() => session.hasPeer === true);

    host.session.leave();
    await waitFor(() => peerLeftEvents >= 1);
    await waitFor(() => session.hasPeer === false);

    assert.equal(session.state, 'connected', 'la sesión que permanece no cambia de estado');

    session.close();
    host.session.close();
  });

  test('reentrada del creador original vía joinRoom(roomId), sin resume', async () => {
    const s = await withServer();
    const creatorFirst = makeNegotiatingSession(s);
    const other = makeNegotiatingSession(s);

    const code = await creatorFirst.session.createRoom();
    await other.session.joinRoom(code);
    await waitFor(() => creatorFirst.session.hasPeer === true);

    // El creador abandona limpiamente; la Room sigue viva en el servidor.
    creatorFirst.session.leave();
    await waitFor(() => other.session.hasPeer === false);

    // Reentra con una sesión NUEVA, por el código (joinRoom normal, sin resume).
    const creatorReenter = makeNegotiatingSession(s);
    await creatorReenter.session.joinRoom(code);

    assert.equal(creatorReenter.session.roomCode, code);
    assert.equal(creatorReenter.session.state, 'connected');
    assert.ok(creatorReenter.events.includes('onRoomCreated'));
    // other sigue ahí: al reentrar el creador ve presencia.
    await waitFor(() => creatorReenter.session.hasPeer === true);

    other.session.close();
    creatorReenter.session.close();
  });

  test('el rol deja de ser propiedad: quien está presente negocia aunque no creara la sala', async () => {
    const s = await withServer();
    const creatorB = makeNegotiatingSession(s);
    const codeB = await creatorB.session.createRoom();
    const visitorA = makeNegotiatingSession(s);
    await visitorA.session.joinRoom(codeB);
    await waitFor(() => creatorB.session.hasPeer === true);

    // El creador B se va; A (visitor) queda solo con hasPeer=false.
    creatorB.session.leave();
    await waitFor(() => visitorA.session.hasPeer === false);
    assert.equal(visitorA.session.state, 'connected', 'el visitor permanece conectado en su Room');

    // Llega un nuevo participante: A (que NO creó) es quien está presente y
    // vuelve a negociar con el recién llegado.
    const late = makeNegotiatingSession(s);
    await late.session.joinRoom(codeB);
    await waitFor(() => visitorA.session.hasPeer === true);
    await waitFor(() => visitorA.transport.peerJoinedCount >= 1);
    assert.ok(
      visitorA.transport.peerJoinedCount >= 1,
      'el presente (aunque no sea el creador) vuelve a negociar con el nuevo peer',
    );

    visitorA.session.close();
    late.session.close();
  });

  test('entrada desde "Mis salas" usa joinRoom(roomId) y resuelve igual que un join', async () => {
    const s = await withServer();
    const creator = makeNegotiatingSession(s);
    const code = await creator.session.createRoom();

    const fromSaved = makeNegotiatingSession(s);
    await fromSaved.session.joinRoom(code);

    assert.equal(fromSaved.session.state, 'connected');
    assert.equal(fromSaved.session.roomCode, code);
    assert.ok(fromSaved.events.includes('onRoomCreated'));
    assert.equal(fromSaved.session.hasPeer, false, 'entrar en una sala vacía no da peer');

    creator.session.close();
    fromSaved.session.close();
  });

  test('una negociación fallida no destruye la Room y una nueva presencia re-negocia', async () => {
    const s = await withServer();
    const host = makeFlakySession(s);
    const code = await host.session.createRoom();

    // Primer peer entra: la primera negociación falla (el transporte llama onError).
    const first = makeNegotiatingSession(s);
    await first.session.joinRoom(code);
    await waitFor(() => host.events.includes('onError'));

    // La Room y la sesión siguen vivas; el error solo se propaga.
    assert.equal(host.session.state, 'connected', 'el fallo de negociación no destruye la Room');
    assert.equal(host.session.roomCode, code, 'roomCode se conserva');
    assert.equal(host.session.hasPeer, true, 'la presencia viene del signaling, no del canal');
    assert.equal(host.transport.negotiationAttempts, 1);
    assert.equal(host.transport.closeCalls, 0, 'el transporte no se cierra: queda armado');
    assert.ok(!host.events.includes('onOpen'), 'la primera negociación no abrió canal');

    // El peer se va; llega otro: la nueva presencia vuelve a provocar negociación.
    first.session.leave();
    await waitFor(() => host.session.hasPeer === false);

    const second = makeNegotiatingSession(s);
    await second.session.joinRoom(code);
    await waitFor(() => host.events.includes('onOpen'));

    assert.equal(host.transport.negotiationAttempts, 2, 'la nueva presencia re-provocó la negociación');
    assert.equal(host.session.state, 'connected');
    assert.equal(host.session.hasPeer, true);

    host.session.close();
    second.session.close();
  });
});

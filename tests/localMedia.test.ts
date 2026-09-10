// B9: Integración técnica de media local con el transporte WebRTC.
//
// RtcPeerTransport.setLocalMediaTracks(tracks) sincroniza por identidad de
// MediaStreamTrack la lista local con la RTCPeerConnection:
//  - añade los tracks que faltan (sin duplicar RTCRtpSender);
//  - retira los senders de los tracks que desaparecen;
//  - no hace getUserMedia (MediaManager es el dueño de la captura);
//  - los cambios disparan onnegotiationneeded y usan la cola de renegociación
//    B6 existente (sin segunda cola);
//  - setLocalMediaTracks([]) retira todo sin destruir PC, DataChannel ni sesión.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { installDomMocks } from './helpers/dom';
import { RtcPeerTransport } from '../src/network/RtcPeerTransport';
import type { TransportHandlers } from '../src/network/NetworkTransport';
import type { SignalPayload } from '../src/network/protocol';

// ── fakes de media ─────────────────────────────────────────────────────────

interface FakeTrack {
  kind: 'video' | 'audio';
  readyState: 'live' | 'ended';
  stop(): void;
}

function makeTrack(kind: 'video' | 'audio'): FakeTrack {
  return { kind, readyState: 'live', stop() { this.readyState = 'ended'; } };
}

// ── Mock de RTCPeerConnection con addTrack/removeTrack ─────────────────────

class MockRTCRtpSender {
  constructor(
    readonly track: unknown,
    readonly stream: unknown,
  ) {}
}

class MockRTCPeerConnection {
  static instances: MockRTCPeerConnection[] = [];

  signalingState: 'stable' | 'have-local-offer' | 'have-remote-offer' = 'stable';
  connectionState: 'new' | 'connected' | 'closed' = 'new';
  closed = false;

  onicecandidate: ((event: { candidate: unknown }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  ondatachannel: ((event: { channel: MockRTCDataChannel }) => void) | null = null;
  onnegotiationneeded: (() => void) | null = null;

  senders: MockRTCRtpSender[] = [];
  addTrackCalls: Array<{ track: unknown; stream: unknown }> = [];
  removeTrackCalls: MockRTCRtpSender[] = [];

  constructor() {
    MockRTCPeerConnection.instances.push(this);
    setTimeout(() => {
      this.connectionState = 'connected';
      this.onconnectionstatechange?.();
    }, 0);
  }

  static reset(): void {
    MockRTCPeerConnection.instances = [];
  }

  createDataChannel(label: string): MockRTCDataChannel {
    return new MockRTCDataChannel(label);
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    this.signalingState = 'have-local-offer';
    return { type: 'offer', sdp: 'mock-offer-sdp' };
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    this.signalingState = 'stable';
    return { type: 'answer', sdp: 'mock-answer-sdp' };
  }

  async setLocalDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.signalingState = desc.type === 'offer' ? 'have-local-offer' : 'stable';
    setTimeout(() => this.onicecandidate?.({ candidate: { candidate: 'candidate:1' } }), 0);
  }

  async setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.signalingState = desc.type === 'offer' ? 'have-remote-offer' : 'stable';
  }

  async addIceCandidate(_candidate: unknown): Promise<void> {}

  addTrack(track: unknown, stream: unknown): MockRTCRtpSender {
    this.addTrackCalls.push({ track, stream });
    const sender = new MockRTCRtpSender(track, stream);
    this.senders.push(sender);
    setTimeout(() => this.onnegotiationneeded?.(), 0);
    return sender;
  }

  removeTrack(sender: MockRTCRtpSender): void {
    const idx = this.senders.indexOf(sender);
    if (idx !== -1) this.senders.splice(idx, 1);
    this.removeTrackCalls.push(sender);
    setTimeout(() => this.onnegotiationneeded?.(), 0);
  }

  close(): void {
    this.closed = true;
    this.connectionState = 'closed';
  }
}

class MockRTCDataChannel {
  readyState: 'connecting' | 'open' | 'closed' = 'connecting';
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(readonly label: string) {
    setTimeout(() => {
      this.readyState = 'open';
      this.onopen?.();
    }, 0);
  }

  send(_data: string): void {}
  close(): void {
    this.readyState = 'closed';
    this.onclose?.();
  }
}

const OriginalRTCPeerConnection = globalThis.RTCPeerConnection;
const OriginalRTCDataChannel = globalThis.RTCDataChannel;
const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

function installMockRTC(): void {
  // @ts-expect-error - mock global
  globalThis.RTCPeerConnection = MockRTCPeerConnection;
  // @ts-expect-error - mock global
  globalThis.RTCDataChannel = MockRTCDataChannel;
  MockRTCPeerConnection.reset();
}

function uninstallMockRTC(): void {
  // @ts-expect-error - restore
  globalThis.RTCPeerConnection = OriginalRTCPeerConnection;
  // @ts-expect-error - restore
  globalThis.RTCDataChannel = OriginalRTCDataChannel;
  MockRTCPeerConnection.reset();
}

/** navigator.mediaDevices.getUserMedia que falla para probar que el transporte
 *  nunca captura media por su cuenta. */
function installThrowingMediaNavigator(): void {
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      mediaDevices: {
        getUserMedia: () => {
          throw new Error('RtcPeerTransport NO debe llamar a getUserMedia');
        },
      },
    },
    configurable: true,
    writable: true,
  });
}

function restoreNavigator(): void {
  if (originalNavigatorDescriptor) {
    Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, 'navigator');
  }
}

// ── Mock SignalingClient ───────────────────────────────────────────────────

class MockSignalingClient {
  readonly url: string;
  private listeners: Set<(msg: { type: string; data?: SignalPayload }) => void> = new Set();
  sentSignals: SignalPayload[] = [];

  constructor(url: string) {
    this.url = url;
  }

  subscribe(listener: (msg: { type: string; data?: SignalPayload }) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  sendSignal(data: SignalPayload): void {
    this.sentSignals.push(data);
  }

  simulateIncomingSignal(data: SignalPayload): void {
    for (const listener of this.listeners) {
      listener({ type: 'signal', data });
    }
  }

  simulatePeerJoined(): void {
    for (const listener of this.listeners) {
      listener({ type: 'peer-joined' });
    }
  }
}

// ── helpers de tests ───────────────────────────────────────────────────────

function settle(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function offerCount(signaling: MockSignalingClient): number {
  return signaling.sentSignals.filter((s) => s.kind === 'offer').length;
}

function answerLatestOffer(signaling: MockSignalingClient): void {
  const offers = offerCount(signaling);
  assert.ok(offers > 0, 'debe existir un offer para responder');
  signaling.simulateIncomingSignal({ kind: 'answer', sdp: `answer:${offers}` });
}

describe('RtcPeerTransport: media local (B9)', () => {
  let signaling: MockSignalingClient;
  let handlers: TransportHandlers;
  let transport: RtcPeerTransport;
  let onOpenCalled = false;
  let onCloseReason: string | null = null;
  let onErrorMsg: string | null = null;

  beforeEach(() => {
    installDomMocks();
    installMockRTC();
    restoreNavigator();
    onOpenCalled = false;
    onCloseReason = null;
    onErrorMsg = null;

    signaling = new MockSignalingClient('ws://test:8787');
    handlers = {
      onOpen: () => {
        onOpenCalled = true;
      },
      onMessage: () => {},
      onClose: (reason) => {
        onCloseReason = reason;
      },
      onError: (error) => {
        onErrorMsg = error;
      },
    };
    transport = new RtcPeerTransport(signaling, handlers);
  });

  afterEach(() => {
    transport.close();
    restoreNavigator();
    uninstallMockRTC();
  });

  /** Transporte negociado y estable (channel abierto + answer aplicado). */
  async function setupOpenAndStable(): Promise<MockRTCPeerConnection> {
    await transport.connect();
    signaling.simulatePeerJoined();
    await settle(60);
    answerLatestOffer(signaling);
    await settle(60);
    const pc = MockRTCPeerConnection.instances[0];
    assert.ok(pc, 'el PC debe existir');
    assert.equal(pc.signalingState, 'stable', 'la conexión debe estar estable');
    assert.equal(transport.state, 'open', 'el canal debe estar abierto');
    return pc;
  }

  it('setLocalMediaTracks añade un track al PC y dispara la renegociación', async () => {
    const pc = await setupOpenAndStable();
    const cam = makeTrack('video');

    transport.setLocalMediaTracks([cam]);
    await settle(60);

    assert.equal(pc.addTrackCalls.length, 1, 'addTrack debe llamarse una vez');
    assert.equal(pc.addTrackCalls[0].track, cam);
    assert.equal(pc.senders.length, 1, 'exactamente un RTCRtpSender');
    assert.equal(pc.senders[0].track, cam);
    assert.equal(offerCount(signaling), 2, 'el cambio debe disparar una renegociación (offer)');
    assert.equal(onCloseReason, null, 'la renegociación no cierra la sesión');
  });

  it('no vuelve a añadir un track ya publicado (sin duplicar RTCRtpSender)', async () => {
    const pc = await setupOpenAndStable();
    const cam = makeTrack('video');

    transport.setLocalMediaTracks([cam]);
    await settle(60);
    answerLatestOffer(signaling);
    await settle(60);
    assert.equal(pc.addTrackCalls.length, 1);

    transport.setLocalMediaTracks([cam]);
    await settle(60);

    assert.equal(pc.addTrackCalls.length, 1, 'no debe re-añadir el track');
    assert.equal(pc.senders.length, 1, 'no se duplica el sender');
    assert.equal(offerCount(signaling), 2, 'una llamada redundante no genera otro offer');
  });

  it('retira el sender de un track que desaparece', async () => {
    const pc = await setupOpenAndStable();
    const cam = makeTrack('video');

    transport.setLocalMediaTracks([cam]);
    await settle(60);
    assert.equal(pc.senders.length, 1);
    const senderCam = pc.senders[0];

    transport.setLocalMediaTracks([]);
    await settle(60);

    assert.equal(pc.removeTrackCalls.length, 1, 'debe retirar el sender del track eliminado');
    assert.equal(pc.removeTrackCalls[0], senderCam);
    assert.equal(pc.senders.length, 0, 'no quedan senders locales');

    // La sesión, el PC y el DataChannel siguen vivos.
    assert.equal(pc.closed, false, 'el PC no debe cerrarse al retirar tracks');
    assert.equal(transport.state, 'open', 'el transporte sigue abierto');
    assert.equal(onCloseReason, null, 'no se notifica cierre');
    assert.equal(onErrorMsg, null, 'no hay error');
    assert.ok(
      transport.send({ type: 'chat', playerId: 'p1', text: 'hola' }),
      'el DataChannel sigue operativo tras retirar todos los tracks',
    );
  });

  it('reemplaza [camera] por [camera, mic] y luego [mic] sin duplicar ni re-añadir', async () => {
    const pc = await setupOpenAndStable();
    const cam = makeTrack('video');
    const mic = makeTrack('audio');

    transport.setLocalMediaTracks([cam]);
    await settle(60);
    assert.equal(pc.senders.length, 1);
    const senderCam = pc.senders[0];
    answerLatestOffer(signaling);
    await settle(60);

    transport.setLocalMediaTracks([cam, mic]);
    await settle(60);

    assert.equal(pc.addTrackCalls.length, 2, '[cam,mic]: cam ya estaba, solo se añade mic');
    assert.equal(pc.addTrackCalls[1].track, mic);
    assert.equal(pc.senders.length, 2);
    assert.equal(pc.removeTrackCalls.length, 0, 'no se retira nada al ampliar');
    answerLatestOffer(signaling);
    await settle(60);

    transport.setLocalMediaTracks([mic]);
    await settle(60);

    assert.equal(pc.removeTrackCalls.length, 1, '[mic]: se retira el sender de cam');
    assert.equal(pc.removeTrackCalls[0], senderCam);
    assert.equal(pc.senders.length, 1, 'solo queda el sender de mic');
    assert.equal(pc.senders[0].track, mic);
    assert.equal(pc.addTrackCalls.length, 2, 'cam no se re-añade');
  });

  it('setLocalMediaTracks([]) retira todo sin cerrar PC, DataChannel ni sesión', async () => {
    const pc = await setupOpenAndStable();
    const cam = makeTrack('video');
    const mic = makeTrack('audio');

    transport.setLocalMediaTracks([cam, mic]);
    await settle(60);
    assert.equal(pc.senders.length, 2);
    answerLatestOffer(signaling);
    await settle(60);

    transport.setLocalMediaTracks([]);
    await settle(60);

    assert.equal(pc.removeTrackCalls.length, 2, 'se retiran ambos senders');
    assert.equal(pc.senders.length, 0);
    assert.equal(pc.closed, false, 'el PC no se cierra');
    assert.equal(transport.state, 'open', 'el transporte permanece abierto');
    assert.equal(onCloseReason, null, 'la sesión no se destruye');
    assert.ok(
      transport.send({ type: 'chat', playerId: 'p1', text: 'hola' }),
      'el DataChannel sigue abierto',
    );
  });

  it('los cambios de tracks usan la cola de renegociación existente, sin crear otra', async () => {
    const pc = await setupOpenAndStable();
    const cam = makeTrack('video');
    const mic = makeTrack('audio');

    // Primer cambio: offer pendiente (have-local-offer).
    transport.setLocalMediaTracks([cam]);
    await settle(30);
    assert.equal(offerCount(signaling), 2, 'primer offer de renegociación');
    assert.equal(pc.signalingState, 'have-local-offer');

    // Segundo cambio ANTES del answer: no debe generar offer concurrente.
    transport.setLocalMediaTracks([cam, mic]);
    await settle(30);
    assert.equal(offerCount(signaling), 2, 'sin offer concurrente mientras hay uno pendiente');
    assert.equal(pc.senders.length, 2, 'el segundo track ya está publicado (pese a la cola)');

    // El answer reanuda la cola B6 y ejecuta el cambio encolado.
    answerLatestOffer(signaling);
    await settle(100);
    assert.equal(offerCount(signaling), 3, 'el offer encolado se emite tras el answer');
    assert.equal(pc.signalingState, 'have-local-offer', 'el offer encolado queda pendiente de answer');

    // Responder el offer encolado y estabilizar antes del tercer cambio.
    answerLatestOffer(signaling);
    await settle(60);
    assert.equal(pc.signalingState, 'stable');

    // Tercer cambio tras estabilizar: nueva renegociación, sin cierre.
    transport.setLocalMediaTracks([mic]);
    await settle(30);
    assert.equal(offerCount(signaling), 4, 'la retirada de cam dispara su propio offer');
    assert.equal(pc.senders.length, 1);
    assert.equal(pc.senders[0].track, mic);
    assert.equal(onCloseReason, null, 'toda la secuencia conserva la sesión');
  });

  it('tracks solicitados antes de conectar se aplican en la negociación inicial', async () => {
    const cam = makeTrack('video');

    transport.setLocalMediaTracks([cam]);
    await transport.connect();
    signaling.simulatePeerJoined();
    await settle(80);

    const pc = MockRTCPeerConnection.instances[0];
    assert.equal(pc.addTrackCalls.length, 1, 'el track se publica en el offfer inicial');
    assert.equal(pc.senders.length, 1);
    assert.equal(offerCount(signaling), 1, 'solo la negociación inicial');
    assert.equal(onCloseReason, null);
  });

  it('el transporte nunca hace getUserMedia: solo sincroniza tracks', async () => {
    installThrowingMediaNavigator();
    const pc = await setupOpenAndStable();
    const cam = makeTrack('video');

    transport.setLocalMediaTracks([cam]);
    await settle(60);

    // Si el transporte invocara getUserMedia, installThrowingMediaNavigator
    // lanzaría y este test fallaría.
    assert.equal(pc.addTrackCalls.length, 1, 'el track se publica sin capturar media');
    assert.ok(onOpenCalled, 'la sesión se abrió y el transporte sigue funcionando');
  });
});
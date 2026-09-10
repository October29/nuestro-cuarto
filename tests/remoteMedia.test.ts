// M9: Recepción de media remota.
//
// RtcPeerTransport.onRemoteTrack expone cada track remoto que llega por
// RTCPeerConnection.ontrack:
//  - se notifica exactamente una vez por evento track;
//  - se entregan los MediaStream asociados que el runtime facilite;
//  - el transporte no captura media local (nunca getUserMedia/getDisplayMedia);
//  - no se reproduce ni se pinta nada (solo se expone el track);
//  - sigue funcionando a través de renegociaciones y de cambios de media local;
//  - cerrar el transporte descarta notificaciones pendientes.

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

function makeStream(id: string): MediaStream {
  // Extremo solo de paso: el transporte no usa nada del objeto.
  return { id } as MediaStream;
}

// ── Mock de RTCPeerConnection con ontrack ──────────────────────────────────

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
  ontrack: ((event: { track: unknown; streams: unknown[] }) => void) | null = null;

  senders: MockRTCRtpSender[] = [];
  addTrackCalls: Array<{ track: unknown; stream: unknown }> = [];
  trackEvents: Array<{ track: unknown; streams: unknown[] }> = [];

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
    setTimeout(() => this.onnegotiationneeded?.(), 0);
  }

  /** Simula que el peer remoto publica un track (evento ontrack). */
  simulateRemoteTrack(track: unknown, streams: unknown[]): void {
    this.trackEvents.push({ track, streams });
    this.ontrack?.({ track, streams });
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

function installMockRTC(): void {
  // @ts-expect-error - mock global
  globalThis.RTCPeerConnection = MockRTCPeerConnection;
  MockRTCPeerConnection.reset();
}

function uninstallMockRTC(): void {
  // @ts-expect-error - restore
  globalThis.RTCPeerConnection = OriginalRTCPeerConnection;
  MockRTCPeerConnection.reset();
}

/** navigator que lanza si se intenta capturar media: el transporte jamás
 *  debe llamar a getUserMedia ni getDisplayMedia. */
function installThrowingMediaNavigator(): void {
  const fail = () => {
    throw new Error('RtcPeerTransport NO debe capturar media (getUserMedia/getDisplayMedia)');
  };
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      mediaDevices: {
        getUserMedia: fail,
        getDisplayMedia: fail,
      },
    },
    configurable: true,
    writable: true,
  });
}

const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

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

describe('RtcPeerTransport: media remota (M9)', () => {
  let signaling: MockSignalingClient;
  let handlers: TransportHandlers;
  let transport: RtcPeerTransport;
  let onCloseReason: string | null = null;
  let onErrorMsg: string | null = null;
  let received: Array<{ track: MediaStreamTrack; streams: readonly MediaStream[] }>;

  beforeEach(() => {
    installDomMocks();
    installMockRTC();
    restoreNavigator();
    onCloseReason = null;
    onErrorMsg = null;
    received = [];

    signaling = new MockSignalingClient('ws://test:8787');
    handlers = {
      onOpen: () => {},
      onMessage: () => {},
      onClose: (reason) => {
        onCloseReason = reason;
      },
      onError: (error) => {
        onErrorMsg = error;
      },
    };
    transport = new RtcPeerTransport(signaling, handlers);
    transport.onRemoteTrack = (track, streams) => {
      received.push({ track, streams });
    };
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

  it('un track remoto dispara el callback', async () => {
    const pc = await setupOpenAndStable();
    const cam = makeTrack('video');
    const stream = makeStream('stream-1');

    pc.simulateRemoteTrack(cam, [stream]);

    assert.equal(received.length, 1, 'exactamente una notificación');
    assert.equal(pc.trackEvents.length, 1, 'el evento ontrack llega una vez al PC');
  });

  it('el callback recibe el mismo MediaStreamTrack', async () => {
    const pc = await setupOpenAndStable();
    const cam = makeTrack('video');

    pc.simulateRemoteTrack(cam, []);

    assert.equal(received.length, 1);
    assert.strictEqual(received[0].track, cam, 'debe ser el mismo track (identidad)');
    assert.equal(received[0].track.kind, 'video');
  });

  it('los streams asociados se propagan correctamente', async () => {
    const pc = await setupOpenAndStable();
    const mic = makeTrack('audio');
    const streamA = makeStream('stream-a');
    const streamB = makeStream('stream-b');

    pc.simulateRemoteTrack(mic, [streamA, streamB]);

    assert.equal(received.length, 1);
    const [receivedStreams] = [received[0].streams];
    assert.equal(receivedStreams.length, 2, 'se entregan todos los streams del evento');
    assert.strictEqual(receivedStreams[0], streamA, 'misma identidad, mismo orden');
    assert.strictEqual(receivedStreams[1], streamB);
  });

  it('dos tracks remotos producen dos notificaciones independientes', async () => {
    const pc = await setupOpenAndStable();
    const cam = makeTrack('video');
    const mic = makeTrack('audio');
    const streamCam = makeStream('cam');
    const streamMic = makeStream('mic');

    pc.simulateRemoteTrack(cam, [streamCam]);
    pc.simulateRemoteTrack(mic, [streamMic]);

    assert.equal(received.length, 2, 'una notificación por track');
    assert.strictEqual(received[0].track, cam);
    assert.strictEqual(received[1].track, mic);
    assert.deepEqual([...received[0].streams], [streamCam]);
    assert.deepEqual([...received[1].streams], [streamMic]);
  });

  it('una renegociación que añade otro track remoto funciona', async () => {
    const pc = await setupOpenAndStable();
    const cam = makeTrack('video');
    const mic = makeTrack('audio');
    const streamCam = makeStream('cam');

    pc.simulateRemoteTrack(cam, [streamCam]);
    assert.equal(received.length, 1);

    // Renegociación local (B9): se añade media local, se responde el offer y la
    // sesión vuelve a quedar estable; el manejador ontrack debe seguir vivo.
    const localMic = makeTrack('audio');
    transport.setLocalMediaTracks([localMic]);
    await settle(60);
    answerLatestOffer(signaling);
    await settle(60);
    assert.equal(pc.signalingState, 'stable');
    assert.equal(transport.state, 'open');

    // El peer remoto añade otro track en/tras la renegociación.
    const streamMic = makeStream('mic');
    pc.simulateRemoteTrack(mic, [streamMic]);

    assert.equal(received.length, 2, 'la renegociación no rompe la recepción');
    assert.strictEqual(received[0].track, cam);
    assert.strictEqual(received[1].track, mic);
    assert.deepEqual([...received[1].streams], [streamMic]);
    assert.equal(onCloseReason, null, 'ninguna parte del ciclo cierra la sesión');
  });

  it('cerrar el transporte evita notificaciones posteriores', async () => {
    const pc = await setupOpenAndStable();
    const cam = makeTrack('video');

    pc.simulateRemoteTrack(cam, []);
    assert.equal(received.length, 1);

    const handler = pc.ontrack;
    assert.ok(handler, 'el transporte debe haber asignado ontrack');

    transport.close();
    assert.equal(transport.state, 'closed');

    // Reescribir el handler sobre el PC cerrado simula un evento ontrack que ya
    // estaba pendiente al cierre: debe descartarse (status === 'closed').
    pc.ontrack = handler;
    pc.simulateRemoteTrack(makeTrack('audio'), []);

    assert.equal(received.length, 1, 'tras cerrar no llegan nuevas notificaciones');
    assert.equal(pc.trackEvents.length, 2, 'el evento sí llegó al PC; el transporte lo filtró');
  });

  it('el transporte nunca captura media: ni getUserMedia ni getDisplayMedia', async () => {
    installThrowingMediaNavigator();
    const pc = await setupOpenAndStable();
    const cam = makeTrack('video');
    const stream = makeStream('stream-1');

    pc.simulateRemoteTrack(cam, [stream]);

    // Si el transporte invocara getUserMedia/getDisplayMedia, el navigator que
    // lanza habría hecho fallar el setup o la simulación.
    assert.equal(received.length, 1, 'el track remoto se expone sin capturar nada');
    assert.strictEqual(received[0].track, cam);
    assert.equal(onCloseReason, null);
    assert.equal(onErrorMsg, null);
  });
});
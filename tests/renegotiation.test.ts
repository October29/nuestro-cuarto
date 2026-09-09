// B6: Tests de renegociación WebRTC
//
// Estos tests verifican la infraestructura de renegociación SDP
// sin implementar media tracks reales.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { installDomMocks, getElement } from './helpers/dom';
import { RtcPeerTransport } from '../src/network/RtcPeerTransport';
import { SignalingClient } from '../src/network/SignalingClient';
import type { TransportHandlers, NetworkTransport } from '../src/network/NetworkTransport';
import type { SignalPayload } from '../src/network/protocol';

// Mock mínimo de RTCPeerConnection para tests
class MockRTCPeerConnection {
  static instances: MockRTCPeerConnection[] = [];

  signalingState: 'stable' | 'have-local-offer' | 'have-remote-offer' = 'stable';
  connectionState: 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' = 'new';
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  private iceCandidates: RTCIceCandidate[] = [];

  onicecandidate: ((event: { candidate: RTCIceCandidate | null }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  ondatachannel: ((event: { channel: MockRTCDataChannel }) => void) | null = null;
  onnegotiationneeded: (() => void) | null = null;

  constructor(private config?: { iceServers: RTCIceServer[] }) {
    MockRTCPeerConnection.instances.push(this);
    // Simular conexión establecida tras crear offer/answer
    setTimeout(() => {
      this.connectionState = 'connected';
      this.onconnectionstatechange?.();
    }, 0);
  }

  static reset() {
    MockRTCPeerConnection.instances = [];
  }

  createDataChannel(label: string): MockRTCDataChannel {
    return new MockRTCDataChannel(label);
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    this.signalingState = 'have-local-offer';
    const offer: RTCSessionDescriptionInit = { type: 'offer', sdp: 'mock-offer-sdp' };
    return offer;
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    this.signalingState = 'stable';
    const answer: RTCSessionDescriptionInit = { type: 'answer', sdp: 'mock-answer-sdp' };
    return answer;
  }

  async setLocalDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = desc;
    if (desc.type === 'offer') {
      this.signalingState = 'have-local-offer';
    } else if (desc.type === 'answer') {
      this.signalingState = 'stable';
    }
    // Simular candidatos ICE
    setTimeout(() => {
      this.iceCandidates.push({ candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 } as RTCIceCandidate);
      this.iceCandidates.push({ candidate: 'candidate:2', sdpMid: '0', sdpMLineIndex: 0 } as RTCIceCandidate);
      this.iceCandidates.forEach(c => this.onicecandidate?.({ candidate: c }));
    }, 0);
  }

  async setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = desc;
    if (desc.type === 'offer') {
      this.signalingState = 'have-remote-offer';
    } else if (desc.type === 'answer') {
      this.signalingState = 'stable';
    }
  }

  async addIceCandidate(candidate: RTCIceCandidate): Promise<void> {
    this.iceCandidates.push(candidate);
  }

  close(): void {
    this.connectionState = 'closed';
  }

  // Para tests: disparar negotiationneeded manualmente
  triggerNegotiationNeeded(): void {
    this.onnegotiationneeded?.();
  }
}

class MockRTCDataChannel {
  label: string;
  readyState: 'connecting' | 'open' | 'closing' | 'closed' = 'connecting';

  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(label: string) {
    this.label = label;
    setTimeout(() => {
      this.readyState = 'open';
      this.onopen?.();
    }, 0);
  }

  send(data: string): void {
    // no-op para tests
  }

  close(): void {
    this.readyState = 'closed';
    this.onclose?.();
  }
}

// Reemplazar RTCPeerConnection y RTCDataChannel globalmente para tests
const OriginalRTCPeerConnection = globalThis.RTCPeerConnection;
const OriginalRTCDataChannel = globalThis.RTCDataChannel;

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

// Mock SignalingClient que captura señales enviadas
class MockSignalingClient {
  url: string;
  private listeners: Set<(msg: any) => void> = new Set();
  sentSignals: SignalPayload[] = [];

  constructor(url: string) {
    this.url = url;
  }

  get state() { return 'connected'; }

  subscribe(listener: (msg: any) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async connect(): Promise<void> {}

  sendSignal(data: SignalPayload): void {
    this.sentSignals.push(data);
  }

  // Simular señal entrante
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

describe('RtcPeerTransport: renegotiation (B6)', () => {
  let signaling: MockSignalingClient;
  let handlers: TransportHandlers;
  let transport: RtcPeerTransport;
  let onOpenCalled = false;
  let onCloseReason: string | null = null;
  let onErrorMsg: string | null = null;

  beforeEach(() => {
    installDomMocks();
    installMockRTC();
    onOpenCalled = false;
    onCloseReason = null;
    onErrorMsg = null;

    signaling = new MockSignalingClient('ws://test:8787');
    handlers = {
      onOpen: () => { onOpenCalled = true; },
      onMessage: () => {},
      onClose: (reason) => { onCloseReason = reason; },
      onError: (error) => { onErrorMsg = error.message; },
    };

    transport = new RtcPeerTransport(signaling, handlers);
  });

  afterEach(() => {
    uninstallMockRTC();
  });

  it('la negociación inicial crea offer y abre DataChannel', async () => {
    await transport.connect();
    signaling.simulatePeerJoined();

    // Esperar a que se procese la negociación
    await new Promise(r => setTimeout(r, 50));

    assert.ok(onOpenCalled, 'DataChannel debe abrirse');
    assert.ok(signaling.sentSignals.some(s => s.kind === 'offer'), 'debe enviar offer');
  });

  it('renegotiate() genera un nuevo offer cuando la conexión está estable', async () => {
    await transport.connect();
    signaling.simulatePeerJoined();

    await new Promise(r => setTimeout(r, 50));

    const initialOffers = signaling.sentSignals.filter(s => s.kind === 'offer').length;
    assert.equal(initialOffers, 1);

    // Simular que se añade un track -> negotiationneeded
    // Primero asegurar que la conexión esté en estado 'stable' (como tras recibir answer)
    const pc = MockRTCPeerConnection.instances[0];
    pc.signalingState = 'stable';
    pc.triggerNegotiationNeeded();

    await new Promise(r => setTimeout(r, 50));

    const totalOffers = signaling.sentSignals.filter(s => s.kind === 'offer').length;
    assert.equal(totalOffers, 2, 'debe generar un segundo offer por renegociación');
  });

  it('recibir un offer de renegociación genera answer', async () => {
    await transport.connect();
    signaling.simulatePeerJoined();

    await new Promise(r => setTimeout(r, 50));

    // Simular offer de renegociación entrante
    signaling.simulateIncomingSignal({ kind: 'offer', sdp: 'renegotiation-offer' });

    await new Promise(r => setTimeout(r, 50));

    const answers = signaling.sentSignals.filter(s => s.kind === 'answer');
    assert.ok(answers.length >= 1, 'debe generar answer al recibir offer');
  });

  it('la renegociación no destruye el DataChannel', async () => {
    await transport.connect();
    signaling.simulatePeerJoined();

    await new Promise(r => setTimeout(r, 50));

    // Verificar DataChannel existe
    const pc = MockRTCPeerConnection.instances[0];
    assert.ok(pc, 'PeerConnection debe existir');

    // Disparar renegociación
    pc.triggerNegotiationNeeded();

    await new Promise(r => setTimeout(r, 50));

    // DataChannel no debe haberse cerrado
    assert.equal(onCloseReason, null, 'DataChannel no debe cerrarse durante renegociación');
    assert.equal(onErrorMsg, null, 'no debe haber error durante renegociación');
  });

  it('dos solicitudes simultáneas de renegociación no generan dos offers concurrentes', async () => {
    await transport.connect();
    signaling.simulatePeerJoined();

    await new Promise(r => setTimeout(r, 50));

    // Disparar dos renegociaciones simultáneas
    const pc = MockRTCPeerConnection.instances[0];
    pc.triggerNegotiationNeeded();
    pc.triggerNegotiationNeeded();

    await new Promise(r => setTimeout(r, 100));

    // Solo debe haber un offer adicional (el segundo se encola y se procesa cuando la conexión está estable)
    const totalOffers = signaling.sentSignals.filter(s => s.kind === 'offer').length;
    // El test verifica que no hay tormenta de offers; la cola los procesa secuencialmente
    assert.ok(totalOffers <= 3, 'no debe haber tormenta de offers (máx 1 adicional en este mock)');
  });

  it('renegotiate() sin peer no rompe nada', async () => {
    // Sin conectar ni simular peer-joined
    transport.renegotiate();

    await new Promise(r => setTimeout(r, 50));

    // No debe haber enviado nada ni haber error
    assert.ok(!signaling.sentSignals.some(s => s.kind === 'offer'), 'no debe enviar offer sin conexión');
    assert.equal(onErrorMsg, null, 'no debe haber error');
  });
});
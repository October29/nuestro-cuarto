// M10: wiring de media en NetworkSession.
//
// NetworkSession es el puente entre la UI (MediaPanel) y el transporte WebRTC:
//  - session.setLocalMediaTracks(tracks) delega en transport.setLocalMediaTracks;
//  - el transport.onRemoteTrack (M9) se propaga al onRemoteTrack público de la
//    sesión, que es donde la UI lo asigna.
//
// Se usa el servidor signaling real (en proceso) y un transporte mock con los
// miembros de media opcionales de NetworkTransport.

import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { NetworkSession, type SessionHandlers } from '../src/network/NetworkSession';
import type { NetworkTransport, TransportHandlers } from '../src/network/NetworkTransport';
import { startTestSignaling, type TestSignalingServer } from './helpers/signaling';

let server: TestSignalingServer | null = null;

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
});

interface TestSignaling {
  subscribe: (fn: (m: unknown) => void) => () => void;
}

/** Transporte mock con soporte de media (los miembros opcionales de la interfaz). */
class MediaTransport implements NetworkTransport {
  onRemoteTrack: ((track: MediaStreamTrack, streams: readonly MediaStream[]) => void) | null = null;
  receivedTracks: MediaStreamTrack[][] = [];
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly signaling: TestSignaling,
    private readonly handlers: TransportHandlers,
  ) {}

  connect(): Promise<void> {
    this.unsubscribe = this.signaling.subscribe((message) => {
      const m = message as { type?: string };
      if (m.type === 'peer-joined' || m.type === 'signal') {
        if (this.unsubscribe) this.handlers.onOpen();
      }
    });
    return Promise.resolve();
  }

  send(): boolean {
    return true;
  }

  close(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  setLocalMediaTracks(tracks: MediaStreamTrack[]): void {
    this.receivedTracks.push([...tracks]);
  }

  /** Simula un ontrack remoto del peer. */
  simulateRemote(track: MediaStreamTrack, streams: readonly MediaStream[]): void {
    this.onRemoteTrack?.(track, streams);
  }
}

describe('NetworkSession: wiring de media (M10)', () => {
  test('setLocalMediaTracks delega en el transporte y onRemoteTrack llega a la sesión', async () => {
    server = await startTestSignaling();
    let transport: MediaTransport | null = null;
    const receivedRemote: Array<[MediaStreamTrack, readonly MediaStream[]]> = [];

    const handlers: SessionHandlers = {
      onOpen: () => {},
      onMessage: () => {},
      onPeerLeft: () => {},
      onError: () => {},
    };
    const session = new NetworkSession({
      handlers,
      signalingUrl: server.url,
      makeTransport: (signaling, transportHandlers) => {
        transport = new MediaTransport(
          signaling as unknown as TestSignaling,
          transportHandlers,
        );
        return transport;
      },
    });
    session.onRemoteTrack = (track, streams) => receivedRemote.push([track, streams]);

    await session.createRoom();
    assert.ok(transport, 'el transporte se crea al crear la sala');

    // Publicar media local → delegación directa al transporte.
    const videoTrack = {} as MediaStreamTrack;
    session.setLocalMediaTracks([videoTrack]);
    assert.deepEqual(transport.receivedTracks, [[videoTrack]], 'los tracks llegan al transporte');

    // Track remoto simulado en el transporte → propagado al onRemoteTrack.
    const remoteTrack = {} as MediaStreamTrack;
    const remoteStream = {} as MediaStream;
    transport.simulateRemote(remoteTrack, [remoteStream]);
    assert.equal(receivedRemote.length, 1, 'la sesión reenvía el track remoto');
    assert.equal(receivedRemote[0][0], remoteTrack);
    assert.equal(receivedRemote[0][1][0], remoteStream);

    session.close();
  });

  test('setLocalMediaTracks antes de tener transporte no rompe y se ignora', async () => {
    server = await startTestSignaling();
    const session = new NetworkSession({
      handlers: {
        onOpen: () => {},
        onMessage: () => {},
        onPeerLeft: () => {},
        onError: () => {},
      },
      signalingUrl: server.url,
    });
    // Aún sin transporte: no-op seguro (transporte por defecto es RtcPeerTransport
    // pero sin sala todavía no existe ninguna conexión).
    session.setLocalMediaTracks([{} as MediaStreamTrack]);
    session.close();
  });
});
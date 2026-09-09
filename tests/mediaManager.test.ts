// B8: Tests de MediaManager (captura local de cámara y micrófono).
//
// Se mockea navigator.mediaDevices.getUserMedia de forma aislada por test y se
// restaura el navegador original al terminar. MediaManager no necesita DOM.

import fs from 'node:fs';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { MediaManager } from '../src/network/MediaManager';

// ── fakes de media ─────────────────────────────────────────────────────────

interface FakeTrack {
  kind: 'video' | 'audio';
  readyState: 'live' | 'ended';
  stop(): void;
}

interface FakeStream {
  getTracks(): FakeTrack[];
}

function makeTrack(kind: 'video' | 'audio'): FakeTrack {
  return {
    kind,
    readyState: 'live',
    stop() {
      this.readyState = 'ended';
    },
  };
}

function makeStream(...tracks: FakeTrack[]): FakeStream {
  return { getTracks: () => tracks };
}

// ── infraestructura del mock de navigator.mediaDevices ─────────────────────

const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

let gumCalls: Array<Record<string, unknown>>;
let gumImpl: (constraints: { video?: boolean; audio?: boolean }) => Promise<unknown>;
let manager: MediaManager;

function installFakeNavigator(): void {
  gumCalls = [];
  gumImpl = ((constraints) =>
    Promise.resolve(makeStream(makeTrack(constraints.video ? 'video' : 'audio')))) as () => Promise<unknown>;

  const mediaDevices = {
    getUserMedia: (constraints: { video?: boolean; audio?: boolean }): Promise<unknown> => {
      gumCalls.push({ ...constraints });
      return gumImpl(constraints);
    },
  };
  Object.defineProperty(globalThis, 'navigator', {
    value: { mediaDevices },
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

// ── tests ──────────────────────────────────────────────────────────────────

describe('MediaManager: captura local (B8)', () => {
  beforeEach(() => {
    installFakeNavigator();
    manager = new MediaManager();
  });

  afterEach(() => {
    manager.close();
    restoreNavigator();
  });

  it('enableCamera solicita getUserMedia({ video: true })', async () => {
    await manager.enableCamera();
    assert.deepEqual(gumCalls, [{ video: true }]);
    assert.ok(manager.isCameraEnabled());
  });

  it('enableMic solicita getUserMedia({ audio: true })', async () => {
    await manager.enableMic();
    assert.deepEqual(gumCalls, [{ audio: true }]);
    assert.ok(manager.isMicEnabled());
  });

  it('no duplica captura si se activa dos veces', async () => {
    await manager.enableCamera();
    await manager.enableCamera();
    assert.equal(gumCalls.length, 1, 'una sola llamada a getUserMedia');

    const prevCallCount = gumCalls.length;
    const [a, b] = await Promise.all([manager.enableCamera(), manager.enableCamera()]);
    assert.equal(a, undefined);
    assert.equal(b, undefined);
    assert.equal(gumCalls.length, prevCallCount, 'tampoco duplica capturas concurrentes');
    assert.ok(manager.isCameraEnabled());
  });

  it('disableCamera detiene únicamente los tracks de vídeo', async () => {
    const videoTrack = makeTrack('video');
    const audioTrack = makeTrack('audio');
    gumImpl = () => Promise.resolve(makeStream(videoTrack, audioTrack));

    await manager.enableCamera();
    manager.disableCamera();

    assert.equal(videoTrack.readyState, 'ended');
    assert.equal(audioTrack.readyState, 'live', 'no debe detener el track de audio compartido');
    assert.equal(manager.isCameraEnabled(), false);
  });

  it('disableMic detiene únicamente los tracks de audio', async () => {
    const audioTrack = makeTrack('audio');
    const videoTrack = makeTrack('video');
    gumImpl = () => Promise.resolve(makeStream(audioTrack, videoTrack));

    await manager.enableMic();
    manager.disableMic();

    assert.equal(audioTrack.readyState, 'ended');
    assert.equal(videoTrack.readyState, 'live', 'no debe detener el track de vídeo compartido');
    assert.equal(manager.isMicEnabled(), false);
  });

  it('el error de permisos/captura no deja el manager en estado activo', async () => {
    gumImpl = () => Promise.reject(new Error('Permission denied'));

    await assert.rejects(() => manager.enableCamera(), /Permission denied/);

    assert.equal(manager.isCameraEnabled(), false);
    assert.equal(manager.getCameraStream(), null);
    assert.equal(manager.getActiveTracks().length, 0);

    // Tras el fallo el estado queda consistente y se puede reintentar.
    gumImpl = () => Promise.resolve(makeStream(makeTrack('video')));
    await manager.enableCamera();
    assert.ok(manager.isCameraEnabled());
    assert.equal(gumCalls.length, 2, 'el reintento vuelve a pedir la cámara');
  });

  it('close() detiene todos los tracks y deja el manager limpio', async () => {
    await manager.enableCamera();
    await manager.enableMic();

    const active = manager.getActiveTracks();
    assert.equal(active.length, 2);

    manager.close();

    for (const { track } of active) {
      assert.equal(track.readyState, 'ended');
    }
    assert.equal(manager.isCameraEnabled(), false);
    assert.equal(manager.isMicEnabled(), false);
    assert.equal(manager.getActiveTracks().length, 0);
    assert.equal(manager.getCameraStream(), null);
    assert.equal(manager.getMicStream(), null);
  });

  it('no requiere ni crea RTCPeerConnection', async () => {
    const originalPc = Object.getOwnPropertyDescriptor(globalThis, 'RTCPeerConnection');
    try {
      Object.defineProperty(globalThis, 'RTCPeerConnection', {
        value: class MockPeerConnection {
          constructor() {
            throw new Error('RTCPeerConnection NO debe crearse');
          }
        },
        configurable: true,
      });

      await manager.enableCamera();
      assert.ok(manager.isCameraEnabled());
    } finally {
      if (originalPc) {
        Object.defineProperty(globalThis, 'RTCPeerConnection', originalPc);
      } else {
        Reflect.deleteProperty(globalThis, 'RTCPeerConnection');
      }
    }
  });

  it('no toca RoomState ni el protocolo de red', () => {
    const src = fs.readFileSync(new URL('../src/network/MediaManager.ts', import.meta.url), 'utf8');

    // Módulo aislado: sin imports de protocol/transport/signaling.
    assert.ok(!/^\s*import/m.test(src), 'MediaManager no importa nada del sistema de red');
    assert.ok(!/getDisplayMedia\s*\(/.test(src), 'sin screen sharing');
    assert.ok(!/new\s+RTCPeerConnection/.test(src), 'sin RTCPeerConnection');
    assert.ok(!/\baddTrack\b/.test(src) && !/\bremoveTrack\b/.test(src), 'sin publicación de tracks');
    assert.ok(!/getRoomState/.test(src), 'sin acceso a RoomState');
  });

  it('la captura es perezosa: construir el manager no solicita permisos', () => {
    assert.equal(gumCalls.length, 0, 'construir el manager no llama a getUserMedia');
    assert.equal(manager.isCameraEnabled(), false);
    assert.equal(manager.isMicEnabled(), false);
    assert.equal(manager.getActiveTracks().length, 0);
  });
});
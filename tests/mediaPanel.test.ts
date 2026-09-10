// M10: Panel de medios de la sala — captura, preview, publicación y playback.
//
// Cubre el flujo vertical funcional:
//   botón del usuario → getUserMedia → preview local → setLocalMediaTracks
//   (→ RtcPeerTransport)  y  onRemoteTrack → stream remoto → <video> remoto.
//
// NO se usa un navegador real: se mockean navigator.mediaDevices, MediaStream
// y el DOM (helpers/dom). RtcPeerTransport queda fuera (su integración con
// setLocalMediaTracks/onRemoteTrack ya la cubren localMedia.test/remoteMedia.test
// y networkSessionMedia.test).

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { installDomMocks, getElement, type DomStub } from './helpers/dom';
import { MediaPanel } from '../src/ui/mediaPanel';
import type { NetworkSession } from '../src/network/NetworkSession';

// ── fakes de media ─────────────────────────────────────────────────────────

interface FakeTrack {
  kind: 'video' | 'audio';
  readyState: 'live' | 'ended';
  stop(): void;
}

function makeTrack(kind: 'video' | 'audio'): FakeTrack {
  return { kind, readyState: 'live', stop() { this.readyState = 'ended'; } };
}

class FakeMediaStream {
  private readonly tracks: Array<FakeTrack | MediaStreamTrack> = [];

  getTracks(): MediaStreamTrack[] {
    return this.tracks as MediaStreamTrack[];
  }

  addTrack(track: MediaStreamTrack): void {
    if (!this.tracks.includes(track)) this.tracks.push(track);
  }

  removeTrack(track: MediaStreamTrack): void {
    const idx = this.tracks.indexOf(track);
    if (idx !== -1) this.tracks.splice(idx, 1);
  }
}

function makeStream(...tracks: MediaStreamTrack[]): MediaStream {
  const stream = new FakeMediaStream();
  for (const track of tracks) stream.addTrack(track);
  return stream as unknown as MediaStream;
}

// ── fake de la sesión de red ────────────────────────────────────────────────

class FakeSession {
  onRemoteTrack: ((track: MediaStreamTrack, streams: readonly MediaStream[]) => void) | null = null;
  published: MediaStreamTrack[][] = [];
  state = 'connected';

  setLocalMediaTracks(tracks: MediaStreamTrack[]): void {
    this.published.push([...tracks]);
  }
}

// ── infraestructura de mocks globales ───────────────────────────────────────

const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const originalMediaStream = globalThis.MediaStream;

let gumCalls: Array<Record<string, boolean>>;
let gumError: Error | null = null;

function installMediaMocks(): void {
  gumCalls = [];
  gumError = null;
  Object.defineProperty(globalThis, 'MediaStream', {
    value: FakeMediaStream,
    configurable: true,
    writable: true,
  });
  const mediaDevices = {
    getUserMedia: (constraints: { video?: boolean; audio?: boolean }): Promise<MediaStream> => {
      gumCalls.push({ ...constraints });
      if (gumError) return Promise.reject(gumError);
      const track = makeTrack(constraints.video ? 'video' : 'audio') as MediaStreamTrack;
      return Promise.resolve(makeStream(track));
    },
  };
  Object.defineProperty(globalThis, 'navigator', {
    value: { mediaDevices },
    configurable: true,
    writable: true,
  });
}

function restoreMediaMocks(): void {
  if (originalMediaStream === undefined) {
    Reflect.deleteProperty(globalThis, 'MediaStream');
  } else {
    Object.defineProperty(globalThis, 'MediaStream', originalMediaStream);
  }
  if (originalNavigatorDescriptor) {
    Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, 'navigator');
  }
}

function settle(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── helpers de asserts ──────────────────────────────────────────────────────

function remoteVideo(): DomStub {
  return getElement('remote-video');
}

function localVideo(): DomStub {
  return getElement('local-video');
}

function cameraBtn(): DomStub {
  return getElement('camera-btn');
}

function micBtn(): DomStub {
  return getElement('mic-btn');
}

function mediaStatus(): DomStub {
  return getElement('media-status');
}

function audioUnlockBtn(): DomStub {
  return getElement('audio-unlock-btn');
}

function tracksOf(stub: DomStub): MediaStreamTrack[] {
  const stream = stub.srcObject as FakeMediaStream | null;
  assert.ok(stream, 'esperaba un stream en srcObject');
  return stream.getTracks();
}

describe('MediaPanel: media de la sala (M10)', () => {
  let panel: MediaPanel;
  let session: FakeSession;

  beforeEach(() => {
    installDomMocks();
    installMediaMocks();
    session = new FakeSession();
    panel = new MediaPanel();
  });

  afterEach(() => {
    panel.bindSession(null);
    restoreMediaMocks();
  });

  async function bind(): Promise<void> {
    panel.bindSession(session as unknown as NetworkSession);
    await settle(0);
  }

  it('1. activar cámara obtiene video y crea preview local', async () => {
    await bind();
    await panel.toggleCamera();
    await settle(0);

    assert.deepEqual(gumCalls, [{ video: true }], 'getUserMedia con video');
    const local = localVideo();
    assert.notEqual(local.srcObject, null, 'la preview local recibe el stream');
    assert.equal((local.srcObject as FakeMediaStream).getTracks().length, 1);
    assert.equal(local.autoplay, true);
    assert.equal(local.playsInline, true);
    assert.equal(local.muted, true, 'la cámara local nunca reproduce su audio');
    assert.deepEqual(session.published.at(-1), [(
      local.srcObject as FakeMediaStream
    ).getTracks()[0]], 'el track de vídeo se publica hacia la sesión');
  });

  it('2. activar micrófono obtiene audio sin preview local', async () => {
    await bind();
    await panel.toggleMic();
    await settle(0);

    assert.deepEqual(gumCalls, [{ audio: true }], 'getUserMedia con audio');
    assert.equal(localVideo().srcObject, null, 'el micrófono no crea preview');
    assert.equal(session.published.at(-1)?.length, 1);
    assert.equal(session.published.at(-1)?.[0].kind, 'audio', 'el track de audio se publica');
  });

  it('3. cámara y micrófono funcionan independientemente', async () => {
    await bind();

    await panel.toggleCamera();
    await settle(0);
    assert.equal(session.published.at(-1)?.length, 1);
    assert.equal(session.published.at(-1)?.[0].kind, 'video', 'cámara sin micrófono');

    await panel.toggleMic();
    await settle(0);
    assert.equal(session.published.at(-1)?.length, 2, 'cámara + micrófono');

    await panel.toggleMic();
    await settle(0);
    assert.equal(session.published.at(-1)?.length, 1, 'solo cámara (micrófono apagado)');
    assert.equal(session.published.at(-1)?.[0].kind, 'video');

    await panel.toggleCamera();
    await settle(0);
    assert.equal(session.published.at(-1)?.length, 0, 'nada publicado al apagar la cámara');
  });

  it('4. desactivar cámara detiene su track y limpia la preview', async () => {
    await bind();
    await panel.toggleCamera();
    await settle(0);
    const liveTrack = tracksOf(localVideo())[0];
    assert.equal(liveTrack.readyState, 'live');

    await panel.toggleCamera();
    await settle(0);
    assert.equal((liveTrack as FakeTrack).readyState, 'ended', 'el track de vídeo se detiene');
    assert.equal(localVideo().srcObject, null, 'la preview se limpia');
    assert.deepEqual(session.published.at(-1), [], 'el sender se retira (via setLocalMediaTracks)');
  });

  it('5. desactivar micrófono detiene su track', async () => {
    await bind();
    await panel.toggleMic();
    await settle(0);
    const liveTrack = session.published.at(-1)![0] as FakeTrack;
    assert.equal(liveTrack.readyState, 'live');

    await panel.toggleMic();
    await settle(0);
    assert.equal(liveTrack.readyState, 'ended', 'el track de audio se detiene');
    assert.deepEqual(session.published.at(-1), [], 'el sender de audio se retira');
  });

  it('6. un track remoto de vídeo termina en el video remoto', async () => {
    await bind();
    const cam = makeTrack('video') as MediaStreamTrack;
    const peerStream = makeStream(cam);

    session.onRemoteTrack!(cam, [peerStream]);
    await settle(0);

    const remote = remoteVideo();
    assert.notEqual(remote.srcObject, null, 'el vídeo remoto recibe stream');
    assert.equal((remote.srcObject as FakeMediaStream).getTracks()[0], cam, 'el track es el mismo');
    assert.equal(remote.autoplay, true);
    assert.equal(remote.playsInline, true);
    assert.equal(remote.muted, false, 'el vídeo remoto NO está muteado');
    assert.equal(audioUnlockBtn().hidden, true, 'autoplay desbloqueado no muestra "Activar audio"');
  });

  it('7. un track remoto de audio termina en el stream remoto', async () => {
    await bind();
    const mic = makeTrack('audio') as MediaStreamTrack;

    session.onRemoteTrack!(mic, [makeStream()]);
    await settle(0);

    assert.equal(tracksOf(remoteVideo())[0], mic, 'el audio queda en el stream del vídeo remoto');
  });

  it('8. múltiples tracks remotos del mismo stream no crean múltiples videos', async () => {
    await bind();
    const cam = makeTrack('video') as MediaStreamTrack;
    const mic = makeTrack('audio') as MediaStreamTrack;
    const peerStream = makeStream(cam, mic);

    session.onRemoteTrack!(cam, [peerStream]);
    await settle(0);
    const firstSrcObject = remoteVideo().srcObject;

    session.onRemoteTrack!(mic, [peerStream]);
    await settle(0);

    assert.equal(remoteVideo().srcObject, firstSrcObject, 'el mismo <video>/stream, sin duplicar');
    assert.equal(getElement('remote-video'), remoteVideo(), 'existe un único elemento vídeo remoto');
    const all = (remoteVideo().srcObject as FakeMediaStream).getTracks();
    assert.ok(all.includes(cam));
    assert.ok(all.includes(mic));
    assert.equal(all.length, 2);
  });

  it('9. onRemoteTrack no se procesa después de cerrar el transporte', async () => {
    await bind();
    const cam = makeTrack('video') as MediaStreamTrack;
    const stale = session.onRemoteTrack!;

    stale(cam, [makeStream()]);
    await settle(0);
    assert.notEqual(remoteVideo().srcObject, null, 'en sesión activa sí se procesa');

    panel.bindSession(null);
    await settle(0);
    assert.equal(remoteVideo().srcObject, null, 'al cerrar se limpia el stream remoto');

    stale(makeTrack('audio') as MediaStreamTrack, [makeStream()]);
    await settle(0);
    assert.equal(remoteVideo().srcObject, null, 'un evento pendiente/caduco se descarta');
  });

  it('10. getUserMedia no se invoca al cargar la aplicación', async () => {
    assert.equal(gumCalls.length, 0, 'construir el panel no pide permisos');
    await bind();
    assert.equal(gumCalls.length, 0, 'vincular la sesión tampoco pide permisos');
    assert.equal(cameraBtn().disabled, false, 'con sesión los controles quedan activos');
    assert.equal(cameraBtn().textContent, '📷 Cámara desactivada');
    assert.equal(micBtn().textContent, '🎤 Micrófono desactivado');
  });

  it('11. rechazo de permisos produce un estado de error manejable', async () => {
    await bind();
    const permError = new Error('denied');
    permError.name = 'NotAllowedError';
    gumError = permError;

    await panel.toggleCamera();
    await settle(0);

    assert.match(mediaStatus().textContent, /denegado/i, 'mensaje amigable de permiso');
    assert.match(mediaStatus().className, /media-error/, 'la UI marca el error');
    assert.equal(cameraBtn().textContent, '📷 Cámara desactivada', 'la cámara no se marca activa');
    assert.equal(localVideo().srcObject, null);

    // El error no deja el panel roto: reintentar con permiso concedido funciona.
    gumError = null;
    await panel.toggleCamera();
    await settle(0);
    assert.notEqual(localVideo().srcObject, null, 'se puede reintentar tras conceder el permiso');
    assert.equal(cameraBtn().textContent, '📷 Cámara activada');
  });

  it('12. la UI refleja correctamente los estados', async () => {
    const hint =
      'Únete o crea una sala para usar cámara y micrófono.';
    assert.equal(mediaStatus().textContent, hint, 'sin sesión muestra la pista');
    assert.equal(cameraBtn().disabled, true, 'sin sesión los botones están deshabilitados');
    assert.equal(micBtn().disabled, true);

    await bind();
    assert.equal(mediaStatus().textContent, 'Cámara y micrófono desactivados.');

    await panel.toggleCamera();
    await settle(0);
    assert.equal(cameraBtn().textContent, '📷 Cámara activada');
    assert.match(cameraBtn().className, /active/);
    assert.match(micBtn().className, /(^|\s)media-btn($|\s)/);
    assert.match(mediaStatus().textContent, /Cámara activa/);
    assert.match(mediaStatus().textContent, /Micrófono inactivo/);

    await panel.toggleMic();
    await settle(0);
    assert.equal(micBtn().textContent, '🎤 Micrófono activado');
    assert.match(micBtn().className, /active/);
    assert.match(mediaStatus().textContent, /Micrófono activo/);

    await panel.toggleCamera();
    await settle(0);
    assert.equal(cameraBtn().textContent, '📷 Cámara desactivada');
    assert.doesNotMatch(cameraBtn().className, /active/);
  });

  it('bonus: autoplay con audio desbloqueable mediante gesto "Activar audio"', async () => {
    await bind();
    const video = remoteVideo() as DomStub & { play(): Promise<void> };
    video.play = () => Promise.reject(new Error('autoplay blocked'));

    session.onRemoteTrack!(makeTrack('video') as MediaStreamTrack, [makeStream()]);
    await settle(0);

    assert.equal(audioUnlockBtn().hidden, false, 'autoplay bloqueado muestra "Activar audio"');

    video.play = () => Promise.resolve();
    for (const fn of audioUnlockBtn().listeners['click'] ?? []) fn();
    await settle(0);

    assert.equal(audioUnlockBtn().hidden, true, 'tras el gesto el audio se reproduce');
  });
});
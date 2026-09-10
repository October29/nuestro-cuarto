// B8: captura local de cámara y micrófono.
//
// MediaManager es la capa que posee la captura local de media (cámara y
// micrófono) como estado efímero de sesión. Contrato según B7:
// - es dueño de los MediaStream/MediaStreamTrack de captura local;
// - NO toca RTCPeerConnection, signaling, RoomState ni escena;
// - la publicación de tracks hacia WebRTC y el renderizado son pasos
//   posteriores (B9+).
//
// La captura es perezosa: construir el manager no pide permisos. getUserMedia
// solo se invoca cuando enableCamera()/enableMic() se llaman.
//
// Modelo coherente por slots:
// - cada llamada a getUserMedia es propietaria de su stream;
// - un slot está activo si su stream posee un track vivo de su kind (cámara →
//   video, micrófono → audio), y getCameraStream()/getMicStream() devuelven
//   ese stream mientras el slot esté activo;
// - getActiveTracks() refleja los tracks vivos de los slots activos;
// - los tracks de otro kind que aparezcan en un stream compartido/fake no se
//   detienen al desactivar el slot ni se marcan como captura ajena: su stream
//   se retiene explícitamente (con el stream de origen) y close() detiene
//   absolutamente todo lo que el manager haya capturado, sin dejar nada
//   abandonado. Así no puede existir un estado en que un medio se reporte
//   activo sin stream, ni viceversa.

export type MediaSourceKind = 'camera' | 'mic';

export interface ActiveLocalTrack {
  kind: MediaSourceKind;
  track: MediaStreamTrack;
}

interface CaptureSlot {
  stream: MediaStream | null;
  request: Promise<void> | null;
  version: number;
}

export class MediaManager {
  private camera: CaptureSlot = { stream: null, request: null, version: 0 };
  private mic: CaptureSlot = { stream: null, request: null, version: 0 };
  /** Streams retenidos con tracks de otro kind (caso defensivo de stream compartido/fake). */
  private retained: MediaStream[] = [];
  private closed = false;

  isCameraEnabled(): boolean {
    return this.slotHasLive(this.camera, 'video');
  }

  isMicEnabled(): boolean {
    return this.slotHasLive(this.mic, 'audio');
  }

  /** Stream de la captura de cámara (null si la cámara no está activa). */
  getCameraStream(): MediaStream | null {
    return this.camera.stream;
  }

  /** Stream de la captura de micrófono (null si el micrófono no está activo). */
  getMicStream(): MediaStream | null {
    return this.mic.stream;
  }

  /** Tracks vivos de las capturas activas (coherente con los streams). */
  getActiveTracks(): ActiveLocalTrack[] {
    const tracks: ActiveLocalTrack[] = [];
    this.collectOwnLive(this.camera, 'video', 'camera', tracks);
    this.collectOwnLive(this.mic, 'audio', 'mic', tracks);
    return tracks;
  }

  /** Solicita la cámara. No abre una segunda captura si ya hay una activa. */
  enableCamera(): Promise<void> {
    return this.enable(this.camera, 'camera');
  }

  /** Solicita el micrófono. No abre una segunda captura si ya hay una activa. */
  enableMic(): Promise<void> {
    return this.enable(this.mic, 'mic');
  }

  /** Detiene únicamente los tracks de vídeo de la captura de cámara. */
  disableCamera(): void {
    this.disable(this.camera, 'video');
  }

  /** Detiene únicamente los tracks de audio de la captura de micrófono. */
  disableMic(): void {
    this.disable(this.mic, 'audio');
  }

  /** Detiene absolutamente todos los tracks capturados y deja el manager limpio. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.invalidate(this.camera);
    this.invalidate(this.mic);
    for (const slot of [this.camera, this.mic]) {
      if (slot.stream !== null) this.stopAllTracks(slot.stream);
      slot.stream = null;
    }
    for (const stream of this.retained) {
      this.stopAllTracks(stream);
    }
    this.retained = [];
  }

  private enable(slot: CaptureSlot, kind: MediaSourceKind): Promise<void> {
    this.ensureOpen();
    const ownKind = this.trackKindOf(kind);
    if (this.slotHasLive(slot, ownKind)) return Promise.resolve();
    if (slot.request !== null) return slot.request;

    slot.version += 1;
    const version = slot.version;

    const request: Promise<void> = (async () => {
      try {
        const stream = await this.getUserMediaFor(kind);
        if (this.closed || slot.version !== version) {
          // La captura quedó invalidada mientras llegaba (disable o close).
          this.stopAllTracks(stream);
          return;
        }
        const hasOwnLive = stream.getTracks().some(
          (track) => track.kind === ownKind && track.readyState === 'live',
        );
        if (!hasOwnLive) {
          // Caso defensivo (p. ej. un fake con puro stream del kind contrario):
          // el slot no se marca activo, pero el stream se retiene con su stream
          // de origen para que close() detenga cualquier track vivo que tenga.
          if (stream.getTracks().length > 0) this.retain(stream);
          return;
        }
        slot.stream = stream;
      } catch (error) {
        // Estado consistente: el slot sigue sin captura.
        // Solo propagar si esta solicitud sigue vigente.
        if (slot.version === version) throw error;
      }
    })();

    // Limpiar el slot de la solicitud en vuelo solo si sigue siendo esta.
    request.then(
      () => {
        if (slot.request === request) slot.request = null;
      },
      () => {
        if (slot.request === request) slot.request = null;
      },
    );
    slot.request = request;
    return request;
  }

  private disable(slot: CaptureSlot, ownKind: 'video' | 'audio'): void {
    this.invalidate(slot);
    if (slot.stream === null) return;
    for (const track of slot.stream.getTracks()) {
      if (track.kind === ownKind) track.stop();
    }
    // Si el stream todavía tiene tracks vivos de otro kind (caso compartido/
    // fake), se retiene con su stream de origen en lugar de abandonarlo,
    // para que close() lo detenga.
    if (slot.stream.getTracks().some((track) => track.kind !== ownKind && track.readyState === 'live')) {
      this.retain(slot.stream);
    }
    slot.stream = null;
  }

  private getUserMediaFor(kind: MediaSourceKind): Promise<MediaStream> {
    if (
      typeof navigator === 'undefined' ||
      typeof navigator.mediaDevices === 'undefined' ||
      typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
      return Promise.reject(new Error('media: getUserMedia no está disponible'));
    }
    const constraints: MediaStreamConstraints = kind === 'camera' ? { video: true } : { audio: true };
    return navigator.mediaDevices.getUserMedia(constraints);
  }

  private trackKindOf(kind: MediaSourceKind): 'video' | 'audio' {
    return kind === 'camera' ? 'video' : 'audio';
  }

  private slotHasLive(slot: CaptureSlot, kindOf: 'video' | 'audio'): boolean {
    return (
      slot.stream !== null &&
      slot.stream.getTracks().some((track) => track.kind === kindOf && track.readyState === 'live')
    );
  }

  private collectOwnLive(
    slot: CaptureSlot,
    kindOf: 'video' | 'audio',
    sourceKind: MediaSourceKind,
    out: ActiveLocalTrack[],
  ): void {
    if (slot.stream === null) return;
    for (const track of slot.stream.getTracks()) {
      if (track.kind === kindOf && track.readyState === 'live') {
        out.push({ kind: sourceKind, track });
      }
    }
  }

  private retain(stream: MediaStream): void {
    if (!this.retained.some((entry) => entry === stream)) {
      this.retained.push(stream);
    }
  }

  private invalidate(slot: CaptureSlot): void {
    slot.version += 1;
  }

  private stopAllTracks(stream: MediaStream): void {
    for (const track of stream.getTracks()) {
      if (track.readyState !== 'ended') track.stop();
    }
  }

  private ensureOpen(): void {
    if (this.closed) throw new Error('media: manager cerrado');
  }
}
# B5: Radiografía Técnica de Media Capture

**Proyecto**: Nuestro Cuartito
**Milestone**: milestone-08-room
**Commit base**: cd9a49b
**Fecha**: 2026-09-09

---

## 1. ¿Dónde vive actualmente RTCPeerConnection?

**Archivo**: `src/network/RtcPeerTransport.ts`

- **Línea 32**: `private connection: RTCPeerConnection | null = null;`
- **Línea 107**: Creación lazy en `ensureConnection()`:
  ```typescript
  this.connection = new RTCPeerConnection({ iceServers: this.iceServers });
  ```
- **Línea 12**: Configuración ICE actual:
  ```typescript
  const DEFAULT_ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
  ```

**Ciclo de vida**:
- Se crea solo cuando hay un peer (`onPeerJoined()` o `handleIncomingSignal('offer')`)
- Se destruye en `closeConnection()` (llamado desde `resetNegotiation()` y `close()`)
- El transporte sobrevive a renegociaciones (`resetNegotiation()` no toca signaling ni status)

---

## 2. ¿Dónde se crea el RTCDataChannel?

**Archivo**: `src/network/RtcPeerTransport.ts`

- **Línea 99** (offerer): `this.channel = this.connection!.createDataChannel(CHANNEL_LABEL);`
- **Línea 126-128** (answerer): `ondatachannel` event handler
- **Línea 190-208**: `setupChannel()` configura eventos `onopen`, `onmessage`, `onerror`, `onclose`
- **Constante**: `CHANNEL_LABEL = 'game-net'`

**Solo existe UN DataChannel** por conexión, usado para:
- Player state sync
- Chat messages
- Room object sync (vía signaling, no DataChannel)

---

## 3. ¿Dónde debería vivir conceptualmente la gestión de MediaStream/MediaStreamTrack?

**Principio de separación actual**:
- `NetworkTransport` / `RtcPeerTransport` = transporte genérico (DataChannel + signaling)
- `NetworkSession` = orquesta signaling + transporte
- `RoomState` = estado autoritativo de sala (objetos, nombre, dimensiones)
- **Media no existe aún**

**Propuesta**: La gestión de MediaStream/Tracks **NO debe ir en `RtcPeerTransport`** ni en `NetworkSession`. Razones:

1. **Responsabilidad única**: El transporte solo sabe enviar bytes y negociar ICE/SDP
2. **Media es opcional**: Un usuario puede estar en la sala sin cámara/micrófono
3. **Tracks son efímeros**: Se añaden/quitan dinámicamente, no persisten en RoomState
3. **Renderizado es preocupación de UI/Phaser**: El juego decide cómo mostrar video

**Ubicación recomendada**: Nueva capa `MediaManager` (o similar) en `src/network/` o `src/game/` que:
- Se instancia por `NetworkSession` cuando el usuario habilita cámara/mic
- Usa `RTCPeerConnection` del transporte para `addTrack()` / `ontrack`
- Emite eventos a UI para renderizado (Phaser texture, <video>, etc.)
- No toca RoomState ni signaling directamente

---

## 4. ¿Cómo añadiríamos audio/video sin mezclarlo con RoomState?

**RoomState** = estado persistente, autoritativo, sincronizado vía signaling server
- Objetos (sofá, mesa), nombre, dimensiones
- **NO** incluye tracks de media

**Session State** = estado de la conexión WebRTC
- `RTCPeerConnection`, `RTCDataChannel`, ICE, SDP
- Tracks de media (transitorios, no persisten)

**Propuesta**: Media tracks = **Session State** (per-connection, per-user)
- Se negocian vía SDP renegotiation
- No se persisten en servidor
- Si un peer se va y vuelve, renegocia sus tracks

---

## 5. ¿Conviene extender RtcPeerTransport o crear una capa separada?

**Recomendación: Capa separada (`MediaManager`)**

Razones:
- `RtcPeerTransport` ya tiene responsabilidad clara: DataChannel + ICE/SDP signaling
- Añadir `ontrack`, `addTrack`, `getUserMedia`, `getDisplayMedia` rompería SRP
- Media es **opcional** y **dinámica**; DataChannel es **requerido** y **estático**
- Permite testear/mockear transporte sin media

**Arquitectura propuesta**:
```
NetworkSession
    ├── SignalingClient (WS)
    ├── RtcPeerTransport (DataChannel + ICE/SDP)
    └── MediaManager (opcional)
            ├── getUserMedia() / getDisplayMedia()
            ├── addTrack() / removeTrack()
            ├── ontrack → UI events
            └── renegotiation trigger
```

---

## 6. ¿Cómo se añadirían tracks con addTrack()?

```typescript
// En MediaManager (nueva clase)
async enableCamera(): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  const track = stream.getVideoTracks()[0];
  
  // Añadir al RTCPeerConnection existente
  const sender = this.peerConnection.addTrack(track, stream);
  
  // Renegociar SDP
  await this.renegotiate();
}

async enableMic(): Promise<void> { ... }
async shareScreen(): Promise<void> { ... }
```

**Puntos clave**:
- `addTrack()` requiere `stream` asociado
- Retorna `RTCRtpSender` para controlar encoding (`sender.setParameters()`)
- Trigger renegotiation (`connection.createOffer()` + `setLocalDescription` + signaling)
- `negotiationneeded` event puede usarse como trigger automático

---

## 7. ¿Cómo recibiríamos tracks mediante ontrack?

```typescript
// En MediaManager
this.peerConnection.ontrack = (event) => {
  const [track] = event.track; // MediaStreamTrack
  const streams = event.streams; // MediaStream[]
  
  // Notificar a UI para renderizado
  this.handlers.onRemoteTrack?.(track, streams[0]);
};
```

**UI side (Phaser)**:
- Recibir `MediaStreamTrack` (video)
- Crear `HTMLVideoElement` o `Phaser.Texture` desde stream
- Mostrar en sprite/container sobre avatar del jugador remoto

---

## 8. ¿Necesitamos renegociación cuando un usuario activa/desactiva cámara o micrófono?

**SÍ, obligatorio**.

- `addTrack()` / `removeTrack()` marcan `negotiationneeded`
- WebRTC requiere renegociación SDP para que el peer remoto sepa de nuevos tracks
- Flujo:
  1. Usuario click "activar cámara"
  2. `getUserMedia()` → stream
  3. `pc.addTrack(track, stream)` → dispara `negotiationneeded`
  4. `pc.createOffer()` → `setLocalDescription` → signaling `offer`
  5. Peer remoto recibe `offer` → `setRemoteDescription` → `createAnswer` → `answer`
  6. Ambos `setLocalDescription`/`setRemoteDescription` completan renegociación

**Optimización**: Batch multiple track changes en una sola renegociación.

---

## 9. ¿Cómo encajaría esto con la arquitectura ROOM != CONNECTION?

**Room** (server-owned, persistente):
- Objetos, nombre, dimensiones
- **No sabe de media**

**Connection** (WebSocket signaling):
- Existe mientras WS abierto
- Transporta SDP/ICE
- **No sabe de media**

**Session** (NetworkSession):
- Orquesta signaling + transporte
- **Sabe de media** vía `MediaManager` opcional
- Media tracks son **estado de sesión**, no de sala

**Transport** (RtcPeerTransport):
- DataChannel + ICE/SDP
- **No sabe de media** (pero expone `peerConnection` para que MediaManager la use)

**MediaManager** (nuevo):
- Se crea/destruye con `NetworkSession`
- Usa `peerConnection` del transporte
- Emite eventos a UI (`onLocalTrack`, `onRemoteTrack`)

---

## 10. ¿Qué ocurre si un peer abandona y luego vuelve?

**Room-first**: La sala persiste, la conexión no.

| Evento | Media State |
|--------|-------------|
| Peer A crea sala | Sin media |
| Peer B une, activa cámara | Renegociación → track de B visible en A |
| Peer B `leave()` | `RtcPeerTransport.close()` destruye PC → tracks de B desaparecen en A |
| Peer B `joinRoom()` de nuevo | Nueva sesión, nuevo PC, nueva negociación → B debe reactivar cámara |

**Implicación**: Media no persiste en RoomState. Cada sesión = nuevos tracks. El usuario debe reactivar cámara/mic al reentrar.

---

## 11. ¿Qué permisos exige el navegador para getUserMedia()?

| API | Permiso | Contexto requerido |
|-----|---------|-------------------|
| `getUserMedia({video: true})` | Cámara | Secure context (HTTPS o localhost) |
| `getUserMedia({audio: true})` | Micrófono | Secure context |
| `getUserMedia({video: true, audio: true})` | Ambos | Secure context |

**Restricciones**:
- **HTTPS obligatorio** en producción (excepto `localhost`, `127.0.0.1`, `file://`)
- Permiso se pide **una vez por origen** (usuario puede denegar)
- `navigator.permissions.query({name: 'camera'})` para consultar estado
- En iframe: requiere `allow="camera; microphone"`

---

## 12. ¿Qué permisos/requisitos exige getDisplayMedia()?

| Aspecto | Detalle |
|---------|---------|
| Permiso | "Captura de pantalla" (diálogo propio, no igual a cámara) |
| Contexto | **HTTPS obligatorio** (no funciona en localhost HTTP en algunos navegadores) |
| Gesto de usuario | **Obligatorio** (click) - no se puede invocar automáticamente |
| Lo que captura | Pestaña, ventana, o pantalla completa (usuario elige) |
| Audio | Opcional: `getDisplayMedia({video: true, audio: true})` captura audio de pestaña (si SO/navegador lo permite) |
| Duración | Usuario puede detener desde UI del navegador (botón "Dejar de compartir") |

**Diferencias clave vs getUserMedia**:
- No persiste permisos (se pide cada vez)
- Usuario elige QUÉ compartir (pestaña/ventana/pantalla)
- `MediaStreamTrack.getSettings()` revela `displaySurface: 'monitor'|'window'|'browser'`

---

## 13. ¿Qué restricciones existen en HTTPS/secure contexts?

| Contexto | getUserMedia | getDisplayMedia |
|----------|--------------|-----------------|
| `https://dominio.com` | ✅ | ✅ |
| `https://localhost` | ✅ | ✅ |
| `http://localhost` | ✅ (especial) | ❌ (Chrome/FF) |
| `http://192.168.x.x` | ❌ | ❌ |
| `file://` | ❌ | ❌ |

**Implicación para desarrollo**:
- `npm run dev` (Vite HTTP) → `getUserMedia` funciona en localhost
- `getDisplayMedia` **puede fallar en HTTP localhost** (Chrome 107+ requiere HTTPS)
- Solución dev: `mkcert` + Vite HTTPS proxy, o túnel ngrok/Cloudflare con HTTPS

---

## 14. Diferencias relevantes escritorio vs Android/mobile browsers

| Aspecto | Desktop (Chrome/FF/Safari) | Android Chrome | iOS Safari |
|---------|---------------------------|----------------|------------|
| `getUserMedia` | ✅ Completo | ✅ Completo | ✅ (iOS 14.3+) |
| `getDisplayMedia` | ✅ Pantalla/ventana/pestaña | ❌ No soportado | ❌ No soportado (iOS 16.4+ solo `getUserMedia` con `displaySurface`) |
| `addTrack` H.264/VP8/VP9 | ✅ | ✅ (H.264/VP8/VP9) | ✅ (H.264, VP8 limitado) |
| Simulcast/SVC | ✅ | Parcial | Limitado |
| `replaceTrack()` | ✅ | ✅ | ✅ |
| Permisos persistentes | Sí | Sí | Sí |
| Background tabs | Throttling | Throttling agresivo | Suspended |

**Implicación**: Screen share **no funciona en móvil** actualmente. Cámara/mic sí.

---

## 15. Problemas a considerar para futura pantalla compartida

1. **No hay `getDisplayMedia` en móvil** → feature desktop-only
2. **Cursor**: `getDisplayMedia({video: {cursor: 'always'}})` opcional
3. **Audio de pestaña**: `getDisplayMedia({audio: true})` solo captura audio de la pestaña compartida (no micrófono)
4. **Resolución/bitrate**: Compartir 4K → satura uplink. Necesita `sender.setParameters({encodings: [{maxBitrate: ...}]})`
5. **Auto-stop**: Usuario puede cerrar desde UI del navegador → `track.onended` → limpiar sender
5. **Privacidad**: No capturar pestaña propia (bucle infinito) - detectar `track.getSettings().displaySurface === 'browser'` y `track.label` propia
6. **Simulcast**: Para múltiples calidades (thumbnail + full) → `addTransceiver()` con `sendEncodings`

---

## 16. ¿Qué parte sería estado de sesión/conexión y qué parte estado persistente de sala?

| Estado | Tipo | Persistencia | Ejemplo |
|--------|------|--------------|---------|
| **RoomState** | Persistente (servidor) | Sí (JSON en disco) | Objetos, nombre, width/height |
| **Session State** | Memoria (cliente) | No | `RTCPeerConnection`, `RTCDataChannel`, `peerPresent` |
| **WebRTC Transport State** | Memoria (cliente) | No | ICE candidates, SDP local/remote, connectionState |
| **Media State** | Memoria (cliente) | **No** | `MediaStream`, `MediaStreamTrack`, `RTCRtpSender`, `enabled/muted` |

**Media = Session State** (efímero, por conexión, no persiste)
- Si peer se va → tracks destruidos
- Si peer vuelve → nueva negociación, nuevos tracks
- RoomState **nunca** guarda tracks

---

## Arquitectura Futura Mínima Propuesta

```
Room (Server-owned, persistent)
    ↓ RoomState (objects, name, width, height)
    
NetworkSession (Client-owned, per-connection)
    ├── SignalingClient (WebSocket → Signaling Server)
    │       └── Room operations (create/join/leave/update)
    │
    ├── RtcPeerTransport (implements NetworkTransport)
    │       ├── RTCPeerConnection (ICE, SDP)
    │       ├── RTCDataChannel ("game-net") → game messages
    │       └── ICE candidates (STUN/TURN)
    │
    └── MediaManager (OPTIONAL, per-session)
            ├── peerConnection (ref from RtcPeerTransport)
            ├── getUserMedia() → local tracks
            ├── getDisplayMedia() → screen track
            ├── addTrack() / removeTrack() → triggers renegotiation
            ├── ontrack → emits to UI
            ├── onnegotiationneeded → SDP renegotiation via signaling
            └── track.onended → cleanup
    
    UI Layer (Phaser)
            ├── RoomScene (objects, players)
            ├── MediaRenderer (video elements / textures for remote tracks)
            └── MediaControls (buttons: cam on/off, mic on/off, screen share)
```

**Justificación**:
- `MediaManager` opcional → no carga si no se usa media
- `RtcPeerTransport` intacto → SRP mantenido
- `NetworkSession` orquesta pero no conoce detalles de media
- RoomState **intocable** → media nunca persiste

---

## Estrategia de Renegociación

| Acción | Trigger | Flujo SDP |
|--------|---------|-----------|
| Cámara ON | `getUserMedia` + `addTrack` | `negotiationneeded` → offer/answer |
| Cámara OFF | `removeTrack` | `negotiationneeded` → offer/answer |
| Mic ON/OFF | Igual | Igual |
| Screen Share ON | `getDisplayMedia` + `addTrack` | Igual |
| Screen Share OFF | `track.onended` o `removeTrack` | Igual |
| Peer desconectado | `peer-left` → `resetNegotiation()` | PC destruido, sin renegociación |
| Peer vuelve | Nueva sesión → nuevo PC | Nueva negociación completa |

**Optimizaciones**:
- `pc.getTransceivers()` para reutilizar `RTCRtpTransceiver` (direction: sendrecv)
- `replaceTrack()` para cambiar fuente sin renegociar (ej. cam → screen)
- `sender.setParameters({encodings: [{active: false}]})` para mute sin renegociar

---

## Riesgos Importantes Descubiertos

1. **Screen share no funciona en móvil** → Feature desktop-only, requerir fallback UI
2. **HTTPS obligatorio para getDisplayMedia** → Dev requiere mkcert/ngrok HTTPS
3. **Renegociación rompe DataChannel temporalmente** → `negotiationneeded` puede causar glitch en DataChannel (aunque WebRTC lo maneja)
3. **Simulcast/encoding params** → Para pantalla compartida + cámara simultánea, necesitar `sendEncodings` y `RTCRtpEncodingParameters`
4. **Permisos persistentes** → Usuario puede revocar en settings del navegador → manejar `track.onmute` / `onunmute`
5. **Background tabs** → Mobile suspende media tracks → `track.onmute` → UI debe reflejar estado
6. **TURN** → Para media en NAT simétrico, TURN se vuelve crítico (más ancho de banda que DataChannel)

---

*Radiografía B5 completada. Sin implementación, solo análisis arquitectónico.*
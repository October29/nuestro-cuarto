# B7: Frontera Arquitectónica del Futuro MediaManager

**Proyecto**: Nuestro Cuartito
**Milestone**: milestone-08-room
**Commit base**: c3edaa7 (B6 aprobado)
**Naturaleza**: Documento de diseño/contrato. **No implementa nada.**

Este documento define dónde vivirá la gestión de media (micrófono, cámara,
pantalla compartida) sin implementarla todavía. No se llama `getUserMedia()`,
`getDisplayMedia()`, no se modifican `RoomState`, `protocol.ts`, ni se crea
`MediaManager.ts`.

---

## 0. Estado inspeccionado (anclas del contrato)

- **`src/network/RtcPeerTransport.ts`** — dueño actual de:
  - `RTCPeerConnection` (L32, creado lazy en `ensureConnection()` L109).
  - `RTCDataChannel` `game-net` (L103, `setupChannel()` L251).
  - SDP offer/answer (L150 `makeOffer`, L207 `handleIncomingSignal`) e ICE (L112, L231).
  - Handler `onnegotiationneeded` (L134) → `renegotiate()` (L166) → `processQueue()` (L184).
  - Cola de renegociación B6 (L38) limpiada en `close()` (L85) y `resetNegotiation()` (L294).
  - Ciclo de vida del canal: `onopen` → `status='open'`; `onclose`/`onerror` → avisos.
- **`src/network/NetworkTransport.ts`** — interfaz mínima `connect/send/close`; la capa
  de juego/sesión **no conoce** `RTCPeerConnection` ni `RTCDataChannel`.
- **`src/network/NetworkSession.ts`** — orquesta `SignalingClient` + transporte; inyecta
  transporte con `makeTransport` (L34) para poder cambiar de transporte o mockear.
- **`src/network/protocol.ts`** — `RoomState` (autoritativo, persistente, servidor) y
  `SignalPayload` (offer/answer/ice). **No se toca.**
- **`src/game/scenes/RoomScene.ts`** — capa visual: muebles, jugador, interacción,
  editor, sincronización de red. Nada de media.

---

## A. Responsabilidades del futuro `MediaManager`

Cosas que **debe** poseer:

1. **Captura local de media**:
   - Cámara → futuro `getUserMedia({ video })`.
   - Micrófono → futuro `getUserMedia({ audio })`.
   - Pantalla compartida → futuro `getDisplayMedia({ video })` (desktop-only).
2. **Ciclo de vida de la captura local**: iniciar, detener (`track.stop()`), mute/unmute
   local, y reacción a eventos del navegador (`track.onended`, `track.onmute`,
   `track.onunmute`).
3. **Estado efímero de captura**: qué dispositivos están activos, qué tracks se generaron,
   permisos concedidos/denegados por el usuario para esta sesión. Este estado vive solo en
   memoria y muere al cerrar/reconectar.
4. **Publicación de tracks hacia el transporte**: entregar los tracks (y su stream) a una
   API futura de media del transporte para que este los registre en el `RTCPeerConnection`
   y renegocie.
5. **Observar media remota**: suscribirse al evento de "llegó un track remoto" y exponerlo
   a quien renderiza (UI/Phaser) **sin** tocar el `RTCPeerConnection`.
6. **API de control para UI**: primitivas conceptuales `enable/disableCamera`,
   `enable/disableMic`, `start/stopScreenShare`, `getActiveTracks`,
   `onLocalMediaChange`, `onRemoteMediaChange` (sin UI propia: *ella* solo la expone).

`MediaManager` es **opcional**: un usuario puede estar en la sala sin cámara ni micrófono.
Si no hay media, `MediaManager` no se instancia y nada de su código corre.

---

## B. NO responsabilidades (fuera de `MediaManager`)

`MediaManager` **NO** debe contener:

- **`RoomState`**: media nunca se serializa, nunca entra en `RoomState`, nunca viaja por
  `room:update` ni por `SignalPayload`.
- **Persistencia**: nada de lo capturado se guarda en disco; no toca `roomDirectory` ni
  ningún storage.
- **`RoomDirectory`**: la agenda de salas del usuario queda intacta.
- **Signaling**: no envía ni escucha mensajes de signaling; solo el transporte habla con
  `SignalingClient`. No se agregan tipos al protocolo.
- **Chat**: el chat sigue siendo PeerMessage por DataChannel; media no lo interfiere.
- **Autoridad del servidor**: el servidor no valida, media es peer-to-peer por definición.
  No introduce estado autoritativo nuevo.
- **Lógica de escena**: `RoomScene`, muebles, colisiones, edición y sincronización de
  jugadores son ajenos a media. `MediaManager` tampoco crea objetos Phaser; a lo sumo
  expone datos que la UI decide cómo renderizar.
- **`RTCPeerConnection`** (en el sentido de que no lo "agarra"): no consulta
  `pc.addTrack`/`pc.removeTrack`/`pc.ontrack` directamente como si fuera suyo. El
  transporte se mantiene dueño de la conexión (sección C).

Regla práctica: si algo toca **dos** de (servidor, sala persistente, socket de signaling,
PC de WebRTC), no pertenece a `MediaManager`.

---

## C. Frontera con RTC

### Dirección conceptual

```
MediaManager
     ↓  tracks / cambios de media (danos/quitadnos este track)
RtcPeerTransport
     ↓  addTrack / removeTrack / ontrack / negotiationneeded
RTCPeerConnection
```

`MediaManager` habla con `RtcPeerTransport`, **nunca** directamente con el
`RTCPeerConnection`. El transporte aplica los cambios al PC y resuelve la renegociación
SDP con su cola B6.

### Quién es dueño de qué

| Recurso | Dueño | Por qué |
|---|---|---|
| `RTCPeerConnection` | `RtcPeerTransport` | Se crea/destruye junto al ciclo del peer (`ensureConnection` / `resetNegotiation`) |
| `RTCDataChannel` | `RtcPeerTransport` | Canal de datos del juego, independiente de media |
| SDP offer/answer | `RtcPeerTransport` | `makeOffer` + `handleIncomingSignal` |
| ICE (STUN/TURN) | `RtcPeerTransport` | candidatos en `onicecandidate` y `addIceCandidate` |
| Signaling WebRTC | `RtcPeerTransport` | `sendSignal({kind})` solo ocurre aquí |
| Cola de renegociación (B6) | `RtcPeerTransport` | serializa offers contra answers (sección F) |
| `MediaStream`/`MediaStreamTrack` locales | `MediaManager` | los crea (captura) y los cierra (`track.stop()`) |
| Registro en el PC (`RTCRtpSender`, transceivers) | `RtcPeerTransport` | es responsabilidad de la conexión |
| Tracks remotos (evento `ontrack`) | `RtcPeerTransport` → expone | el PC es suyo; `MediaManager`/UI solo observan |

### Forma conceptual de la frontera (futura, no implementada)

- `RtcPeerTransport` expone (en el futuro) una superficie de media mínima, a través de la
  cual `MediaManager` pide *publicar* o *retirar* un track. La capa de juego continúa usando
  `NetworkTransport` (sin media), por lo que la superficie de media futura debería ser un
  contrato **separado** (p. ej. `MediaTransport`) que `RtcPeerTransport` implemente, sin
  ensuciar `NetworkTransport`.
- `MediaManager` recibe los tracks remotos por **eventos/callbacks** del transporte, no
  rebuscando en el PC.
- La renegociación es asunto del transporte: `addTrack/removeTrack` disparan
  `negotiationneeded` y la cola B6 la procesa.

---

## D. Estado efímero vs persistente

| Dato | Tipo | Persistencia | ¿Entra en `RoomState`? |
|---|---|---|---|
| `MediaStream` local/remoto | sesión | desaparece al cerrar/reconectar | NO |
| `MediaStreamTrack` (los objetos) | sesión | `track.stop()` al terminar | NO |
| Estado de captura (cámara/mic/screen activos) | sesión | memoria cliente | NO |
| Publicación de tracks (`RTCRtpSender`, transceivers) | sesión | se registra en el PC actual; se pierde al resetear | NO |
| Estado de permisos concedidos/denegados | sesión | el navegador lo consulta cada vez; no persiste en la sala | NO |
| Mute/unmute y calidad del track | sesión | memoria cliente | NO |

**Pertenece a `RoomState`** (persistente, autoritativo, servidor): `name`, `width`,
`height`, `objects`. Media es **Session State**: efímera, por conexión, se renegocia si el
peer se va y vuelve. `RoomState` **nunca** guarda tracks.

---

## E. Futura API conceptual (pseudocódigo, NO implementado)

Borrador mínimo de contrato. No es código real todavía; sirve solo para fijar la frontera.

```typescript
// Contrato conceptual futuro. No existe aún. No crear MediaManager.ts.

// Frente hacia la UI (la expondría MediaManager).
interface MediaManagerApi {
  enableCamera(): Promise<void>;
  disableCamera(): void;
  enableMic(): Promise<void>;
  disableMic(): void;
  startScreenShare(): Promise<void>;   // desktop-only
  stopScreenShare(): void;
  getActiveTracks(): { kind: 'camera' | 'mic' | 'screen'; track: MediaStreamTrack }[];
  // Eventos hacia UI (render, botones).
  onLocalMediaChange(cb: () => void): void;
  onRemoteMediaChange(cb: (streams: MediaStream[]) => void): void;
}

// Superficie futura de media del transporte (separada de NetworkTransport).
interface MediaTransportSurface {
  addMediaTrack(track: MediaStreamTrack, stream: MediaStream): unknown; // -> sender
  removeMediaTrack(sender: unknown): void;
  onRemoteTrack(cb: (track: MediaStreamTrack, streams: MediaStream[]) => void): void;
}
```

Puntos que esta propuesta fija:

- `MediaManager` → captura y regala tracks; `RtcPeerTransport` → los registra y renegocia.
- `MediaManager` no referencia al `RTCPeerConnection`.
- Media remota llega por callback (renderizado a cargo de la UI).
- Operaciones equivalentes a *iniciar/detener cámara, micrófono, pantalla, obtener tracks
  activos, reaccionar a cambios de media*.

---

## F. Renegociación

### Cómo B6 habilita media

Al futuro `addTrack/removeTrack` le basta:

1. `pc.addTrack(track, stream)` (o `pc.removeTrack(sender)`) marca `negotiationneeded`.
2. `RtcPeerTransport.onnegotiationneeded` (L134) ya encola trabajo vía `renegotiate()` (L166)
   cuando `status === 'open'`, sin importar el `signalingState`.
3. `processQueue()` (L184) re-encola internamente mientras `signalingState !== 'stable'` y
   se reanuda cuando el answer entrante vuelve a invocarla (L228).
4. Resultado: ofertas en serie, sin ofertas concurrentes (B6 lo prueba), y la sesión
   (DataChannel, jugador, sala) **no se destruye** durante la renegociación.

### Por qué la cola pertenece al transporte y no a `MediaManager`

- La renegociación depende de un **solo** `RTCPeerConnection` y de sus transiciones de
  `signalingState`; ese ciclo de vida es del transporte.
- `close()` (L85) y `resetNegotiation()` (L294) ya limpian la cola cuando el peer se va o la
  conexión falla. Si `MediaManager` tuviera la cola, ese borrado estaría desincronizado del
  ciclo de la conexión.
- La cola serializa offers contra answers **del protocolo WebRTC**; `MediaManager` solo
  produce el *motivo* (cambio de tracks), nunca el *mecanismo*.
- Mantener la cola en el transporte permite batch de varios cambios de tracks en una sola
  renegociación sin que `MediaManager` deba conocer estados SDP.

---

## G. Flujo futuro (conceptual, NO implementado)

Escenario: cámara OFF → cámara ON → track añadido → renegociación → cámara OFF → track
eliminado → renegociación.

```
1. Conexión estable (DataChannel abierto), sin tracks de media. signalingState = stable.
2. Usuario activa cámara.
      MediaManager.enableCamera()
         └─ getUserMedia({ video }) → MediaStream + MediaStreamTrack(VIDEO) [futuro]
         └─ pide al transporte: addMediaTrack(trackVideo, stream)
3. RtcPeerTransport.addMediaTrack() → pc.addTrack() → negotiationneeded
      └─ procesa con cola B6: offer → (answer remoto) → stable
      └─ el peer recibe ontrack → MediaManager.onRemoteTrack → UI muestra video remoto
4. Cámara ON. Los tracks están publicados en el PC.
5. Usuario desactiva cámara.
      MediaManager.disableCamera()
         └─ trackVideo.stop() (captura local se detiene)
         └─ pide al transporte: removeMediaTrack(senderVideo)
6. RtcPeerTransport.removeMediaTrack() → pc.removeTrack() → negotiationneeded
      └─ cola B6: offer → answer → stable
      └─ el peer recibe el cierre/remoción del track → UI limpia el video remoto
7. Cámara OFF de nuevo. Mismo estado estable inicial, nueva convivencia en B6 para
   el siguiente cambio (mic o screen).
```

En cualquier paso, si llegan dos cambios seguidos muy rápido, la cola B6 los ejecuta en
serie y no se generan offers concurrentes. Si el peer se va a mitad, `resetNegotiation()`
descarta el trabajo pendiente.

---

## H. Decisiones y riesgos

### Decisiones explicitadas

1. **¿Quién posee los `MediaStreamTrack`?**

   `MediaManager` es dueño de los tracks **locales** de captura: él los obtiene de
   `getUserMedia`/`getDisplayMedia` y decide cuándo `track.stop()`. El transporte los
   **registra** (como `RTCRtpSender`) pero no crea ni destruye la captura local. Los tracks
   **remotos** nacen en el PC (ontrack) y son información que el transporte expone; nadie
   fuera de `MediaManager`/UI debería guardarlos.

2. **¿Quién llama a `addTrack`/`removeTrack`?**

   `RtcPeerTransport`, a petición de `MediaManager` (a través de la futura superficie de
   media, sección E). El transporte conoce su PC; `MediaManager` jamás lo toca. Esto
   preserva la regla de `NetworkTransport` ("la capa de sesión no conoce RTCPeerConnection").

3. **¿Quién observa `ontrack`?**

   `RtcPeerTransport` configura el handler (el PC es suyo) y publica el evento hacia
   `MediaManager`/UI por callback. `MediaManager` no registra listeners en el PC.

4. **¿Cómo evitar mezclar media con `RoomState`?**

   - Media es **session state** (sección D): nunca entra en `RoomState`, `room:update`,
     `SignalPayload` ni la persistencia del servidor.
   - El protocolo de signaling **no cambia**; solo se reutiliza el offer/answer ya existente.
   - Un test de frontera futura debería poder capturar media y luego consultar
     `getRoomState()` y comprobar que el RoomState quedó invariante.

5. **¿Qué queda pendiente para B8?**

   - Definir e implementar la superficie media del transporte
     (`addMediaTrack`/`removeMediaTrack`/`onRemoteTrack`, separada de `NetworkTransport`).
   - Crear `MediaManager` con su API de captura (cámara/mic) y su ciclo de vida efímero.
   - `getUserMedia` en contexto seguro y manejo de permisos/`onended`/`onmute`.
   - Mocks de media para tests (sin `MediaManager` real).
   - Decidir y probar en B8 **cámara y micrófono** (sin pantalla); la compartición de
     pantalla queda fuera hasta que cámara/mic estén estables.
   - No introducir TURN/STUN nuevo ni simulcast en esta etapa.

### Riesgos

1. **Screen share no funciona en móviles** → feature desktop-only, exige UI que lo indique.
2. **`getDisplayMedia` requiere HTTPS y gesto de usuario** → contexto seguro obligatorio;
   en desarrollo local puede fallar según navegador (documentado en B5, §12-13).
3. **Renegociación con media añade latencia** → la cola B6 evita offers concurrentes, pero
   conviene batch de cambios de tracks.
4. **Permisos revocables del navegador** → `track.onended`/`onmute` deben reflejarse en UI.
5. **TURN** para media en NAT simétrico queda fuera (limitación documentada en M07);
   media sin TURN puede fallar en redes restrictivas.
6. **Riesgo de filtraciones de estado** → si alguien pone el `MediaStreamTrack` dentro de
   algún objeto de sala o del patch de `room:update`, se rompe el contrato de la sección D;
   los tests de frontera futuros deben blindarlo.

---

## Conclusión

- `MediaManager` = captura + estado efímero + media local/remota + API para UI. **Opcional.**
- `RtcPeerTransport` = dueño del PC, DataChannel, SDP, ICE, signaling WebRTC y de la cola de
  renegociación B6.
- La conexión entre ambos pasa por **tracks/cambios de media**, sin que `MediaManager`
  toque el `RTCPeerConnection` ni el protocolo de signaling.
- `RoomState` y la persistencia siguen intactos: media es **session state**.

*B7 completado. Documento de diseño únicamente; sin cambios de producción.*
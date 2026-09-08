# Reporte 09: Radiografía de Room State

**Fecha:** 2026-09-08
**Rama:** milestone-08-room
**Último commit:** 06dbbb7 (Paso 5 Room-first)

---

## 1. Arquitectura actual

```
┌─────────────────────────────────────────────────────────┐
│                    NAVEGADOR                             │
│                                                         │
│  ConnectMenu ──► NetworkSession ──► RtcPeerTransport    │
│       │              │                    │              │
│       ▼              ▼                    ▼              │
│  RoomDirectory   PlayerSync         WebRTC DataChannel  │
│  (localStorage)      │                    │              │
│                      ▼                    │              │
│               RoomScene (Phaser) ◄────────┘              │
│                      │                                   │
│                 Player + RemotePlayer                    │
│                 CollisionSystem                          │
│                 InteractionSystem                        │
│                 Sofa                                     │
└─────────────────────────────────────────────────────────┘
                          │
                   WebSocket (signaling)
                          │
              ┌───────────▼──────────────┐
              │   signaling/server.mjs    │
              │   rooms: Map<code, Room>  │
              │   Solo presencia + relay  │
              └──────────────────────────┘
```

### Componentes clave

| Archivo | Propósito |
|---------|-----------|
| `src/main.ts` | Punto de entrada: crea Phaser.Game, ConnectMenu, ChatPanel. Wiring entre sesión y escena |
| `src/game/config.ts` | Constantes: ROOM_WIDTH=1200, ROOM_HEIGHT=800, PLAYER_SPEED=260, PLAYER_STATE_INTERVAL_MS=100 |
| `src/game/scenes/RoomScene.ts` | Escena principal: dibuja cuartito, crea Player, maneja input WASD/flechas/click, vincula NetworkSession → PlayerSync |
| `src/game/entities/Player.ts` | Jugador local: Container Phaser con head+body, movimiento WASD/click, sentarse, colisiones |
| `src/game/entities/RemotePlayer.ts` | Representación visual del peer: replica x/y/sitting con lerp suave (0.25) |
| `src/network/protocol.ts` | Tipos: SignalingMessages + PeerMessages + parse/serialize |
| `src/network/SignalingClient.ts` | Cliente WebSocket del servidor de signaling |
| `src/network/NetworkTransport.ts` | Interfaz abstracta: connect/send/close + handlers |
| `src/network/RtcPeerTransport.ts` | Implementación WebRTC: RTCPeerConnection + RTCDataChannel, STUN público |
| `src/network/NetworkSession.ts` | Capa de sesión: orquesta SignalingClient + Transport, expone API tipada |
| `src/game/network/PlayerSync.ts` | Conecta NetworkSession con juego: envía player_state cada 100ms, crea/actualiza/elimina RemotePlayers |
| `src/storage/roomDirectory.ts` | "Mis salas": libreta local {roomId, name} en localStorage |
| `src/ui/connectMenu.ts` | Menú DOM: crear sala, unirse por código, "Mis salas", desconectar |
| `src/ui/chatPanel.ts` | Chat DOM: enviar/recibir mensajes P2P |
| `signaling/server.mjs` | Servidor WebSocket Node: crea salas, genera códigos 6 chars, retransmite signal, max 2 participantes |

---

## 2. Flujo del estado

### Creación de sala

1. ConnectMenu.handleCreate() → new NetworkSession()
2. session.createRoom() → SignalingClient.connect() (WebSocket ws://host:8787)
3. SignalingClient.createRoom() → servidor genera código 6 chars
4. Servidor responde `{type:"created", roomCode:"XXXXXX"}`
5. RtcPeerTransport.connect() (se suscribe a signaling)
6. NetworkSession resuelve, estado = 'connected'
7. ConnectMenu notifica onSessionChange(session)
8. main.ts llama RoomScene.setNetworkSession(session)
9. PlayerSync.start() → setInterval cada 100ms

### Segundo jugador entra

1. Servidor: addPresence(code, socket2), envía peer-joined al socket1
2. socket1 recibe peer-joined → crea RTCPeerConnection + DataChannel 'game-net'
3. socket1 crea offer SDP → signaling.sendSignal({kind:'offer'})
4. socket2 recibe offer → setRemoteDescription → createAnswer
5. Intercambio de ICE candidates
6. DataChannel se abre en ambos → onOpen()
7. NetworkSession: peerPresent = true

### Sincronización (cada 100ms)

```
Local:
  PlayerSync.sendOwnState() →
  session.send({type:'player_state', playerId, x, y, sitting}) →
  serializePeerMessage() → channel.send(json)

Remoto:
  channel.onmessage → parsePeerMessage() →
  PlayerSync.onMessage() → applyRemoteState() →
  new RemotePlayer() o remote.updateState(x, y, sitting)
  Cada frame: remote.update() → lerp hacia targetX/Y
```

---

## 3. Protocolo de mensajes

### WebSocket Signaling (cliente ↔ servidor)

**Cliente → Servidor:**
- `{type: "create"}` — Crear sala
- `{type: "join", roomCode}` — Unirse a sala
- `{type: "signal", data: SignalPayload}` — Retransmitir SDP/ICE
- `{type: "leave"}` — Abandonar sala

**Servidor → Cliente:**
- `{type: "created", roomCode}` — Sala creada
- `{type: "joined", roomCode}` — Unión exitosa
- `{type: "peer-joined"}` — Otro participante entró
- `{type: "signal", data: SignalPayload}` — Señal retransmitida
- `{type: "peer-left"}` — El otro participante se fue
- `{type: "error", message}` — Error

### WebRTC DataChannel P2P (cliente ↔ cliente)

- `{type: "player_connected", playerId, name}` — Definido pero NO se envía actualmente
- `{type: "player_state", playerId, x, y, sitting}` — ~10 Hz
- `{type: "player_disconnected", playerId}` — Definido pero NO se envía actualmente
- `{type: "chat", playerId, text}` — Chat (max 200 chars)

---

## 4. Estado: persistente vs efímero

| Estado | Ubicación | ¿Persiste? |
|--------|-----------|------------|
| Room ID + nombre | localStorage (RoomDirectory) | Sí (local, solo libreta) |
| Room existencia | servidor (memoria) | Sí (hasta morir proceso) |
| Room config | **NO EXISTE** | — |
| Muebles/furniture | **NO EXISTE** | — |
| Decoración | **NO EXISTE** | — |
| Posición jugador | Phaser Game (Player) | No |
| Posición remota | Phaser Game (RemotePlayer) | No |
| sitting | Player | No |
| Chat messages | DOM ChatPanel | No |
| playerId | PlayerSync (random por sesión) | No |
| WebRTC connection | RtcPeerTransport | No |
| Signaling presence | servidor rooms.sockets | No (temporal) |

---

## 5. Contratos protegidos por tests

| Test | Contratos |
|------|-----------|
| `signalingRoom.test.ts` | Room es server-owned, sobrevive cierre/leave, max 2 participantes, signal solo al peer, sala muere solo al terminar proceso |
| `signalingClient.test.ts` | leave() retira presencia, peer-left avisa, sala sigue viva, leave() vs close() son distintos |
| `networkSession.test.ts` | leave() anuncia abandono, NO expulsa al que permanece, Room vacía sigue existiendo, reentrada, sin semántica HOST/VISITOR |
| `roomTransportSeparation.test.ts` | Room y transporte se resuelven por separado, peer-left no destruye Room, renegotiación con nuevo peer, fallo de negociación no destruye Room |
| `roomDirectory.test.ts` | CRUD de libreta, persistencia en storage, normalización, datos corruptos ignorados |
| `misSalas.test.ts` | Crear guarda en libreta, unirse NO auto-guarda, olvidar solo quita de libreta, sala olvidada sigue en servidor |
| `connectMenu.test.ts` | Una sola notificación por create/join, código visible antes de onOpen, disconnect notifica null, chat recibe mensajes |
| `chatPanel.test.ts` | Enter sin foco enfoca chat, Enter con texto envía, whitespace/vacío blur, chat no roba foco |
| `domFocus.test.ts` | isEditableElement reconoce INPUT/TEXTAREA/SELECT/contentEditable |
| `interactionSystem.test.ts` | E no interactúa con foco editable, E sí interactúa sin foco |

---

## 6. Problemas y acoplamientos encontrados

1. **RoomScene hardcodea el mundo**: ROOM_WIDTH=1200, ROOM_HEIGHT=800, posiciones del sofá, ventana, colores — todo en código, nada viene del servidor.

2. **PlayerSync es el ÚNICO canal de datos**: cada 100ms envía {x, y, sitting} por WebRTC. No hay mensajes de "cambiar configuración", "mover mueble", "estado de sala".

3. **No hay modelo de "Room State"**: el servidor solo tiene presencia. No existe { config, furniture, state }.

4. **Player local es autoridad absoluta**: cada cliente mueve su personaje libremente. No hay validación server-side.

5. **RemotePlayer se crea/destruye por cada sesión**: si el peer sale y vuelve, se crea un nuevo playerId random. No hay identidad persistente.

6. **Chat es puramente P2P**: no pasa por el servidor, no se almacena, no se reenvía a quien entre después.

7. **Sofá y objetos son hardcodeados**: `new Sofa(scene, 600, 570)` — no hay forma de configurar muebles diferentes.

8. **Hay player_connected y player_disconnected definidos en protocol.ts pero NO se envían nunca**: solo se usa player_state.

---

## 7. Propuesta: primer Room State mínimo

### Pieza más pequeña y segura

Agregar al servidor un `state` ligero dentro de cada Room:

```javascript
// En signaling/server.mjs
rooms.set(roomCode, {
  code: roomCode,
  createdAt: Date.now(),
  sockets: [],
  state: {
    config: {
      name: 'Sala',
      width: 1200,
      height: 800
    },
    furniture: [
      { type: 'sofa', x: 600, y: 570 }
    ]
  }
});
```

### Nuevos mensajes signaling

```typescript
// Cliente → Servidor
{ type: 'room:get-state' }
{ type: 'room:update', patch: Partial<RoomState> }

// Servidor → Cliente
{ type: 'room:state', state: RoomState }
{ type: 'room:updated', state: RoomState }  // broadcast a ambos
```

### Por qué es seguro

- No rompe nada existente: es un add-on al signaling
- El servidor sigue siendo la autoridad
- Los clientes pueden ignorar estos mensajes si no los entienden
- Es incremental: se puede empezar solo con config y después agregar furniture
- No requiere WebRTC: viaja por signaling WebSocket
- El cliente puede enviar room:get-state al unirse y recibir el estado actual

---

## 8. Qué NO tocar todavía

- **Player.ts / RemotePlayer.ts**: el movimiento es efímero, no necesita server state
- **PlayerSync**: seguiría enviando posición por WebRTC
- **CollisionSystem / InteractionSystem**: son locales, no necesitan estado del servidor
- **ChatPanel**: podría beneficiarse de persistencia server-side, pero es un paso futuro
- **RoomScene**: no necesita cambiar ahora — el "mundo" viene del estado de sala que se recibe
- **WebRTC**: no tocar — la sincronización en tiempo real sigue por DataChannel
- **TURN/ICE restart/reconexión**: son mejoras futuras separadas
- **Autenticación**: no tocar
- **Base de datos/disco**: no tocar — por ahora el state vive en memoria del servidor

---

## 9. Archivos a modificar en el siguiente paso

**Servidor:**
- `signaling/server.mjs` — agregar state a Room, manejar room:get-state y room:update

**Protocolo:**
- `src/network/protocol.ts` — agregar tipos de mensajes de Room State

**Cliente (lectura):**
- `src/network/SignalingClient.ts` — agregar métodos getRoomState(), updateRoomState()
- `src/network/NetworkSession.ts` — exponer getRoomState(), updateRoomState()
- `src/main.ts` — wirear el estado de sala al recibir room:state

**Cliente (renderizado):**
- `src/game/scenes/RoomScene.ts` — recibir RoomState y usarlo para dibujar

**Tests:**
- Nuevo: `tests/roomState.test.ts`

**NO tocar:**
- Player.ts, RemotePlayer.ts, PlayerSync.ts, CollisionSystem.ts, Sofa.ts, InteractionSystem.ts, ChatPanel, domFocus.ts, RoomDirectory.ts

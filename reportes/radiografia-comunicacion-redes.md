# Radiografía Técnica: Comunicación entre Redes (Estado Actual)

**Proyecto**: Nuestro Cuartito
**Milestone**: milestone-08-room
**Commit**: 4fd3aa0
**Fecha**: 2026-09-09

---

## 1. Arquitectura Actual

### Capas y Flujo
```
Gameplay/UI (RoomScene, ChatPanel)
    ↓
NetworkSession (orquesta signaling + transporte)
    ↓
NetworkTransport (interfaz abstracta)
    ↓
RtcPeerTransport (implementación WebRTC nativa)
    ↓
RTCPeerConnection + RTCDataChannel
    ↓
SignalingClient (WebSocket → signaling server)
```

### Componentes Principales

| Componente | Responsabilidad |
|------------|-----------------|
| `SignalingClient` | WebSocket al servidor de signaling (puerto 8787). Maneja create/join/leave, room:get-state, room:update, y reenvío de señales SDP/ICE |
| `NetworkSession` | Capa de sesión: conecta signaling, crea transporte, expone API tipada (`send`, `addRoomObject`, `getRoomState`, etc.) |
| `RtcPeerTransport` | Implementa `NetworkTransport` sobre WebRTC nativo. Crea `RTCPeerConnection`, `RTCDataChannel`, negocia SDP y candidatos ICE |
| `signaling/server.mjs` | Servidor WebSocket (Node/ws). Room-first: la sala persiste independientemente de conexiones. Reenvía señales entre los 2 participantes |

---

## 2. Establecimiento de Conexión (Paso a Paso)

1. **Signaling WS**: Cliente A abre WebSocket → `ws://host:8787` (derivado de `location.hostname`)
2. **Create/Join**: A hace `create` → recibe `roomCode`; B hace `join roomCode`
3. **Peer Joined**: Servidor notifica `peer-joined` al peer existente
4. **RtcPeerTransport.connect()**: Se arma transporte, suscribe a señales
5. **Negociación** (al llegar `peer-joined`):
   - Peer existente (offerer): `createDataChannel` → `createOffer` → `setLocalDescription` → envía `offer` vía signaling
   - Peer nuevo (answerer): recibe `offer` → `setRemoteDescription` → `createAnswer` → `setLocalDescription` → envía `answer`
6. **ICE Candidates**: Cada lado emite `onicecandidate` → envía vía `signal:ice` → servidor reenvía → `addIceCandidate`
7. **DataChannel Open**: `channel.onopen` → `transport.onOpen()` → `session.onOpen()` → UI lista

---

## 3. Qué Funciona en LAN vs Internet

| Aspecto | LAN | Internet (redes NAT distintas) |
|---------|-----|--------------------------------|
| **Signaling WS** | ✅ (si servidor accesible) | ✅ (si servidor tiene IP pública / puerto abierto) |
| **Room State (create/join/update)** | ✅ | ✅ (no depende de P2P) |
| **STUN** | ✅ (ya configurado: `stun:stun.l.google.com:19302`) | ✅ (descubre reflexivas públicas) |
| **ICE Directo (host/host o host/srflx)** | ✅ | ⚠️ Solo si NATs son compatibles (cone/endpoint-independent) |
| **ICE Reflexivo (srflx/srflx)** | ✅ | ⚠️ Funciona en muchos casos |
| **ICE Relay (TURN)** | N/A | ❌ **NO HAY TURN** → falla con NATs simétricos o restrictivos |

**Conclusión**: La arquitectura **ya soporta Internet parcialmente** gracias al STUN público. Funcionará entre redes si al menos uno de los NATs permite mapping endpoint-independent. **Falla garantizada** con doble NAT simétrico / carrier-grade NAT sin TURN.

---

## 4. Configuración ICE Actual

```typescript
// RtcPeerTransport.ts:12
const DEFAULT_ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
```

- **STUN**: ✅ Ya presente (Google público)
- **TURN**: ❌ **No configurado** (comentario explícito en código: "TURN queda explícitamente fuera de M07")
- **iceTransportPolicy**: No forzado (default `all`) → usa host + srflx + relay (si hubiera TURN)

---

## 5. Servidor de Signaling: Accesibilidad

- **Actual**: Escucha en `0.0.0.0:8787` (`ws://`)
- **LAN**: Funciona directo
- **Internet**: **Requiere**:
  - IP pública en el host del servidor
  - Puerto 8787 abierto en firewall/router
  - **O** proxy inverso (nginx/traefik) con TLS → `wss://`
  - **O** túnel (Cloudflare Tunnel, ngrok, etc.)

> La arquitectura **permite** usarlo desde Internet (URL configurable en `SignalingClient`), pero la infraestructura actual no la expone públicamente.

---

## 6. Punto Exacto de Falla entre NATs Distintos

```
Candidate gathering → STUN devuelve srflx
         ↓
Intercambio ICE candidates vía signaling
         ↓
Connectivity checks (STUN binding requests)
         ↓
**FALLA AQUÍ** si:
   - Ambos peers detrás de NAT simétrico (distinto puerto por destino)
   - Carrier-grade NAT (CGNAT) sin hairpinning
   - Firewall bloquea UDP efímeros
         ↓
connectionState → "failed" → notifyClose('fallo de negociación')
         ↓
Transporte vuelve a 'connecting', reintenta al siguiente peer-joined
```

No hay **reintentos automáticos con TURN** porque no existe relay.

---

## 7. Chat

| Propiedad | Estado |
|-----------|--------|
| **Transporte** | Exclusivamente `RTCDataChannel` (`chatPanel.ts:121` → `session.send({type:'chat',...})`) |
| **Dependencia** | Requiere `session.state === 'connected'` (DataChannel open) |
| **Sobre Internet** | ✅ Funcionará **automáticamente** si WebRTC conecta (no hay protocolo separado) |
| **Persistencia** | No (solo memoria local) |

---

## 8. Qué Falta para Próximos Pasos

| Funcionalidad | Qué Requiere |
|---------------|--------------|
| **P2P entre redes (robusto)** | **TURN** (coturn/eternal/servicio cloud). Añadir a `DEFAULT_ICE_SERVERS` con credenciales rotativas |
| **Cámara (WebRTC MediaStream)** | `getUserMedia()` → `pc.addTrack()` → negociación `transceiver` / `direction: sendrecv` → render `<video>` en Phaser (texture) |
| **Compartir Pantalla** | `getDisplayMedia()` → igual que cámara pero `video: { cursor: 'always' }` → posible simulcast / encoding params |
| **Señalización segura (WSS)** | Certificados TLS en servidor signaling (Let's Encrypt + proxy) o `wss://` via túnel |

---

## 9. Puntos Exactos de Inserción

### STUN (YA HECHO)
```typescript
// RtcPeerTransport.ts:12,42
const DEFAULT_ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
constructor(..., private readonly iceServers: RTCIceServer[] = DEFAULT_ICE_SERVERS)
```
→ **Inyección**: `NetworkSession.makeTransport` o constructor `RtcPeerTransport` ya permite sobrescribir `iceServers`.

### TURN (FUTURO)
```typescript
// Mismo sitio: añadir entrada con urls: 'turn:...', username, credential
const ICE_SERVERS_WITH_TURN: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'turn:turn.example.com:3478', username: '...', credential: '...' }
];
```
→ Se pasaría al instanciar `RtcPeerTransport` (vía `makeTransport` en `NetworkSessionOptions`).

---

## 10. Riesgos / Problemas a Resolver Antes de Tocar Código

1. **Infraestructura TURN**: Necesita servidor propio o servicio (Twilio, Metered, Cloudflare Calls, etc.). Credenciales deben ser **temporales/rotativas** (no hardcodeadas).
2. **Signaling WSS**: Para producción sobre Internet, el signaling **debe** ser `wss://` (navegadores bloquean mixed content). Requiere TLS + dominio.
3. **ICE Restart / Renegotiation**: Actual `resetNegotiation()` cierra PC y reintenta. Con TURN, puede necesitar `iceRestart: true` en `createOffer`.
4. **Máximo 2 participantes**: `MAX_PARTICIPANTS = 2` en servidor. Para cámara/pantalla puede requerir SFU (media server) si >2.
5. **Ancho de banda**: DataChannel es fiable (SCTP). Video añade ~1-4 Mbps/upload por peer. Evaluar límites de red móvil.
6. **Permisos**: `getUserMedia` / `getDisplayMedia` requieren gesto de usuario (click) y HTTPS (o localhost).
7. **Mobile Safari**: WebRTC soporte OK, pero `getDisplayMedia` limitado; `playsinline` en `<video>`.

---

## Resumen Ejecutivo

| Qué | Estado |
|-----|--------|
| Arquitectura | Limpia, separada, inyectable (`makeTransport`) |
| Signaling | Funciona LAN/Internet si servidor expuesto |
| STUN | ✅ Configurado (Google) |
| TURN | ❌ **Falta** (punto crítico para NATs simétricos) |
| DataChannel / Chat | ✅ Funcionará over Internet si P2P conecta |
| Media (cámara/pantalla) | Arquitectura lista, falta implementación + TURN + WSS |
| Próximo paso real | **Añadir TURN + exponer signaling via WSS** |

---

*Informe generado automáticamente como parte de la investigación técnica. No se han realizado cambios en el código.*
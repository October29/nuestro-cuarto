# B3: Prueba de Conectividad WebRTC Cross-Network

**Proyecto**: Nuestro Cuartito
**Milestone**: milestone-08-room
**Commit base**: 98d1ada
**Fecha**: 2026-09-09

---

## 1. Estado Actual

### Arquitectura de Signaling + WebRTC

```
Cliente A (Red A)                    Cliente B (Red B)
    │                                      │
    ├── WS → Signaling Server (puerto 8787) ←──┤
    │         (Room-first, max 2 peers)       │
    │                                         │
    └── RTCPeerConnection ←── ICE/STUN ──→ RTCPeerConnection
           │                                      │
           └── RTCDataChannel ("game-net") ──────┘
```

### Componentes Clave

| Componente | Estado |
|------------|--------|
| **Signaling Server** | ✅ Funciona en LAN; escucha en `0.0.0.0:8787` (ws://) |
| **SignalingClient** | ✅ Acepta `signalingUrl` explícito (B2) |
| **STUN** | ✅ Configurado: `stun:stun.l.google.com:19302` |
| **TURN** | ❌ No configurado (intencional) |
| **ICE** | ✅ `RTCPeerConnection({ iceServers: [STUN] })` |
| **DataChannel** | ✅ "game-net", confiable (SCTP) |
| **Room-first** | ✅ Sala persiste sin peers |

---

## 2. Flujo Exacto Signaling + ICE

### Paso a Paso

1. **Cliente A (creador)**
   - `SignalingClient.connect()` → WS al signaling server
   - `createRoom()` → recibe `roomCode`
   - `NetworkSession` crea `RtcPeerTransport` → `connect()` suscribe a `signal` + `peer-joined`

2. **Cliente B (unido)**
   - `joinRoom(roomCode)` → WS al mismo signaling server
   - Servidor envía `peer-joined` a A
   - A recibe `peer-joined` → `onPeerJoined()` → `ensureConnection()` → `createDataChannel()` → `createOffer()` → `setLocalDescription()` → envía `offer` vía signaling

3. **Negociación SDP**
   - Servidor reenvía `offer` a B
   - B recibe `offer` → `setRemoteDescription()` → `createAnswer()` → `setLocalDescription()` → envía `answer` vía signaling

4. **ICE Candidates**
   - Cada `onicecandidate` → envía `signal:ice` → servidor reenvía → `addIceCandidate()`
   - STUN (`stun.l.google.com:19302`) genera candidatos `srflx` (reflexivos)

5. **DataChannel Open**
   - `channel.onopen` → `transport.onOpen()` → `session.onOpen()` → UI lista

---

## 3. Qué Ya Está Preparado

| Capacidad | Estado | Detalle |
|-----------|--------|---------|
| Signaling externo | ✅ | `signalingUrl` en `ConnectMenuOptions` (B2) |
| STUN público | ✅ | `stun:stun.l.google.com:19302` en `DEFAULT_ICE_SERVERS` |
| Signaling server accesible | ✅ | Escucha en `0.0.0.0:8787` |
| Cliente configurable | ✅ | `NetworkSessionOptions.signalingUrl` |
| ICE candidates | ✅ | Generación y envío automático vía `onicecandidate` |
| DataChannel | ✅ | "game-net", SCTP confiable |
| Room persistence | ✅ | Sala existe aunque no haya peers |

---

## 4. Qué Falta para Prueba Real Cross-Network

| Falta | Impacto |
|-------|---------|
| **Signaling Server público** | El servidor debe ser accesible desde Internet (`wss://` ideal, o `ws://` con IP pública + puerto abierto) |
| **HTTPS/WSS** | Navegadores bloquean mixed content: si la app se sirve por HTTPS, el signaling **debe** ser `wss://` |
| **TURN** | Para NATs simétricos / CGNAT, STUN solo no basta (fallo garantizado) |
| **Cliente en otra red** | Requiere segundo dispositivo/red real (móvil en 4G/5G, o túnel) |

---

## 5. Pasos Mínimos de Prueba Manual

### Preparación (Infraestructura)

```bash
# 1. Levantar signaling server con IP pública accesible
# Opción A: VPS/Cloud con IP pública + firewall puerto 8787
# Opción B: Túnel (ngrok, cloudflared, etc.)
#   ngrok tcp 8787  →  tcp://0.tcp.ngrok.io:XXXXX  →  ws://0.tcp.ngrok.io:XXXXX

# 2. Servir la app (HTTP local o HTTPS)
npm run dev  # http://localhost:5173
# O con HTTPS local (mkcert) para probar WSS
```

### Ejecución

```bash
# Cliente A (Red A - ej. WiFi casa)
# Abre http://localhost:5173 (o dominio público)
# Crea sala → anota roomCode

# Cliente B (Red B - ej. móvil en 4G/5G, o VPN distinta)
# Abre misma URL → une a roomCode
```

### Verificación

| Check | Éxito | Fallo |
|-------|-------|-------|
| Signaling WS conecta | ✅ `connected` | ❌ timeout/ECONNREFUSED |
| `peer-joined` llega | ✅ UI muestra peer | ❌ signaling no reenvía |
| SDP offer/answer | ✅ logs de negociación | ❌ timeout 15s |
| ICE candidates | ✅ `srflx` generados | ❌ solo `host` |
| `connectionState` | ✅ `connected` | ❌ `failed`/`disconnected` |
| DataChannel open | ✅ `onOpen` dispara | ❌ no abre |
| Chat/envío | ✅ mensaje llega | ❌ `send()` false |

---

## 6. Criterios de Éxito / Fallo

| Capa | Éxito | Fallo Esperado |
|------|-------|----------------|
| **Signaling** | WS conecta, `peer-joined` intercambiado | Firewall/puertos, IP no accesible, mixed content (HTTPS+WS) |
| **ICE/NAT** | Candidatos `srflx` + `host`, connectivity checks OK | NAT simétrico en ambas redes → sin TURN falla |
| **DataChannel** | `open` dispara, mensajes cruzan | ICE falla, timeout negociación 15s |

**Punto crítico**: Si ambos peers están detrás de **NAT simétrico** (común en 4G/5G, CGNAT corporativo), STUN solo **no basta**. El fallo será en capa ICE → `connectionState: "failed"`.

---

## 7. Conclusión: STUN vs TURN

### Para Esta Prueba (B3)

> **STUN suficiente para validar arquitectura, PERO se espera fallo en NATs simétricos.**

- Si la prueba usa redes "amigables" (WiFi hogareño + 4G con NAT cone), **STUN basta** y DataChannel conecta.
- Si ambas redes son NAT simétrico / CGNAT, **fallará en ICE** → necesitaría TURN.

### Decisión

> **NO implementar TURN todavía.**
> La prueba B3 sirve para validar que signaling + STUN + DataChannel funcionan end-to-end. Si falla por NAT simétrico, B4 será "añadir TURN".

---

## 8. Dependencias de Infraestructura Externa

| Componente | ¿Externo? | Nota |
|------------|-----------|------|
| Signaling Server público | Sí | VPS, túnel (ngrok/cloudflare), o IP pública + firewall |
| STUN (Google) | Sí | Ya usado, gratuito, fiable |
| TURN | No (B3) | Necesario solo si falla por NAT simétrico |
| HTTPS/WSS | Sí | Para producción real; opcional en prueba local |

---

## 9. Resumen de Cambios Necesarios (Solo Infra, No Código)

1. **Exponer signaling server** → ngrok / cloudflared / VPS
2. **(Opcional) HTTPS local** → `mkcert` + Vite proxy para probar `wss://`
3. **Segundo cliente en red distinta** → móvil en datos, 2ª WiFi, o VPN

> **No se requiere ningún cambio en el código de producción para B3.**

---

*Informe B3 completado. Listo para ejecutar prueba manual cuando haya infraestructura disponible.*
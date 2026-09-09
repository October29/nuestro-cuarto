# B4: Prueba Real Cross-Network WebRTC

**Proyecto**: Nuestro Cuartito
**Milestone**: milestone-08-room
**Commit base**: 8a945ef
**Fecha**: 2026-09-09

---

## 1. Infraestructura Elegida: ngrok (Túnel TCP)

**Por qué ngrok:**
- Exposición temporal sin IPs públicas ni configuración de firewall
- Soporta TCP (WebSocket usa WS sobre TCP)
- Gratuito para uso puntual
- No requiere cambios en el código ni credenciales en Git
- Disponible en la mayoría de entornos (incluyendo Termux)

**Alternativas consideradas:**
- cloudflared: requiere cuenta Cloudflare + dominio
- VPS/IP pública: infraestructura permanente, fuera de alcance B4
- localtunnel: solo HTTP, no TCP crudo

---

## 2. Cómo Levantar el Signaling Server

### En terminal 1 (Signaling Server):

```bash
cd /data/data/com.termux/files/home/nuestro-cuarto/signaling
npm start
# O con puerto explícito:
SIGNALING_PORT=8787 node server.mjs
```

Salida esperada:
```
signaling escuchando en ws://0.0.0.0:8787
```

### En terminal 2 (ngrok):

```bash
ngrok tcp 8787
```

Salida esperada:
```
Forwarding                    tcp://0.tcp.ngrok.io:XXXXX -> localhost:8787
```

**Endpoint externo para clientes:** `ws://0.tcp.ngrok.io:XXXXX`

---

## 3. Qué URL Usar en signalingUrl

```javascript
// En ConnectMenuOptions:
const connectMenu = new ConnectMenu({
  signalingUrl: 'ws://0.tcp.ngrok.io:XXXXX',  // Puerto dinámico de ngrok
});
```

O vía variable de entorno en Vite (si se prefiere build-time):
```bash
VITE_SIGNALING_URL=ws://0.tcp.ngrok.io:XXXXX npm run dev
```

---

## 4. Cómo Abrir los Dos Clientes

### Cliente A (Red A - ej. PC en WiFi casa):
1. Abrir `http://localhost:5173` (o IP local + puerto si se sirve en LAN)
2. Click "Crear sala"
3. Anotar `roomCode` (6 chars)

### Cliente B (Red B - ej. Móvil en 4G/5G, o 2ª WiFi distinta):
1. Abrir **la misma URL** que Cliente A (debe ser accesible desde Red B)
   - Si `localhost`: no funcionará desde móvil → usar IP LAN del PC + puerto (ej. `http://192.168.1.50:5173`)
   - O servir con `--host` en Vite: `npm run dev -- --host`
2. Introducir `roomCode` → "Unirse"

---

## 5. Qué Observar en DevTools / Logs

### Consola Navegador (F12 → Console):

| Evento | Log esperado |
|--------|--------------|
| Signaling WS conecta | `[M07A-DIAG] ... NetworkSession createRoom resolvió` |
| Sala creada | `sala creada: XXXXXX` (en server) |
| Peer B une | `participante unido: XXXXXX` (en server) |
| SDP offer | `signal` kind:offer enviado/recibido |
| ICE candidates | `signal` kind:ice (múltiples) |
| SDP answer | `signal` kind:answer |
| DataChannel open | `transport.onOpen()` → `session.onOpen()` |
| Chat | `send({type:'chat',...})` → `onMessage` en peer |

### Red (F12 → Network → WS):
- Frames `signal` con `kind: offer/answer/ice`
- `room:updated` tras cada operación

### Terminal Signaling Server:
```
sala creada: ABC123
participante unido: ABC123
```

---

## 6. Resultado Esperado por Capa

| Capa | Éxito | Fallo |
|------|-------|-------|
| **Signaling** | WS conecta, `peer-joined` intercambiado | Timeout, ECONNREFUSED, mixed content |
| **Peer Discovery** | `peer-joined` llega a A cuando B une | Server no reenvía, max 2 peers |
| **SDP** | Offer/Answer intercambiados | Timeout 15s (`NEGOTIATION_TIMEOUT_MS`) |
| **ICE** | Candidatos `host` + `srflx` (STUN) | Solo `host` = no STUN; `failed` = NAT simétrico |
| **DataChannel** | `channel.onopen` → chat funciona | `failed`/`disconnected` antes de open |
| **Chat** | Mensajes cruzan bidireccional | `send()` retorna false |

---

## 7. Diagnóstico de Conexión P2P

### En `chrome://webrtc-internals` (o `about:webrtc` en Firefox):

| Columna | Qué buscar |
|---------|------------|
| `connectionState` | `connected` = éxito |
| `iceConnectionState` | `connected` / `completed` = éxito |
| `localCandidateType` | `host` (LAN), `srflx` (STUN), `relay` (TURN) |
| `remoteCandidateType` | Igual |
| `selectedCandidatePair` | Qué candidatos se usaron |

**Conexión directa** = al menos un candidato `srflx` seleccionado (STUN funcionó)
**Solo host** = STUN no generó candidatos reflexivos (firewall/UDP bloqueado)
**Relay** = TURN usado (no configurado en B4)

---

## 7. Diagnóstico Exacto si Falla

| Síntoma | Causa probable | Acción |
|---------|----------------|--------|
| WS no conecta | ngrok caído, puerto erróneo, firewall | Verificar `ngrok tcp 8787` activo |
| `peer-joined` no llega | Server max 2 peers, roomCode erróneo | Logs server: `participante unido` |
| Timeout SDP (15s) | ICE bloqueado, UDP filtrado | Ver `iceConnectionState` = `failed` |
| Solo candidatos `host` | STUN no responde (UDP 19302 bloqueado) | Firewall saliente |
| `connectionState: failed` | NAT simétrico en ambos lados | **→ Necesita TURN (B5)** |
| DataChannel no abre | ICE falló antes | Ver capa anterior |

---

## 8. Decisión Sobre Siguiente Paso

| Resultado prueba | Decisión |
|------------------|----------|
| DataChannel conecta, chat cruza | ✅ STUN suficiente → B4 completo, pasar a features |
| ICE `failed` / solo `host` / timeout | ❌ NAT simétrico → **B5: implementar TURN** |
| Signaling falla | Revisar infra (ngrok, puertos, HTTPS) |

> **No afirmar TURN necesario sin evidencia de `iceConnectionState: failed` o `connectionState: failed` con candidatos solo `host`.**

---

## 9. Cambios Mínimos de Código (Solo si necesarios)

### Si se requiere HTTPS/WSS para mixed content:
```javascript
// vite.config.js - proxy para dev
export default defineConfig({
  server: {
    proxy: {
      '/signaling': { target: 'ws://localhost:8787', ws: true }
    }
  }
})
```
> Solo si se prueba con HTTPS local. No necesario para HTTP + WS.

### Si ngrok da URL `wss://`:
```javascript
// El cliente ya soporta wss:// (SignalingClient deriva proto de location.protocol)
signalingUrl: 'wss://0.tcp.ngrok.io:XXXXX'
```

---

## 10. Método de Exposición Usado (Para Registro)

```
ngrok tcp 8787
Forwarding: tcp://0.tcp.ngrok.io:XXXXX -> localhost:8787
signalingUrl: ws://0.tcp.ngrok.io:XXXXX
```

---

## 11. Resultado Real de la Prueba

> **PENDIENTE**: La prueba requiere dos dispositivos en redes distintas y ngrok activo.
> 
> Este documento registra el plan. La ejecución real queda para cuando se disponga de:
> 1. ngrok instalado y autenticado
> 2. Dos dispositivos en redes separadas (ej. PC WiFi + móvil 4G)
> 3. Signaling server + ngrok corriendo simultáneamente
> 
> Al ejecutar, actualizar esta sección con:
> - `ngrok` puerto asignado
> - `roomCode` usado
> - Logs de cada capa
> - Captura `chrome://webrtc-internals`
> - Resultado final (éxito/fallo + diagnóstico)

---

*Informe B4 preparado. Listo para ejecución cuando haya infraestructura disponible.*
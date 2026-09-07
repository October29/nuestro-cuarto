# Reporte 08 — Radiografía de Networking LAN (M08-B) y recuperación de sesión (M08-C)

**Estado:** Análisis (M08-B validado en LAN real) + implementación M08-C (recuperación tras suspensión/recarga).
**Milestone:** M08
**Rama de trabajo:** `milestone-08`
**Fecha:** 2026-09-07

---

## 1. Objetivo de esta fase

Preparar la rama `milestone-08` y realizar una radiografía técnica de la
arquitectura de networking actual, con especial atención a qué necesitamos para
conectar **dos dispositivos físicos** dentro de la misma red **LAN/Wi-Fi**
(PC ↔ teléfono/tablet).

Esta fase es **solo análisis**: no se implementa ningún cambio funcional. Se
rastrea el recorrido completo de una conexión, se documenta qué funciona hoy
entre dos pestañas del mismo ordenador, qué diferencia hay respecto a dos
dispositivos físicos y qué cambios mínimos se necesitan para M08-B.

---

## 2. Estado inicial

- **Commit base:** `a9fb953` (último commit de M07) contenido en `main`
  (`0123ace Merge branch 'milestone-07'`).
- **Rama creada:** `milestone-08` (parte de `main`, que ya incorpora M07).
- **Working tree:** limpio.
- **`origin/milestone-08`:** creada y publicada correctamente.
- **`main`:** sin cambios (no se toca).
- **`milestone-07`:** intacta, sin modificaciones.

---

## 3. Arquitectura actual — recorrido completo de una conexión

Ruta de datos real observada siguiendo las llamadas del código:

```
ConnectMenu (src/ui/connectMenu.ts)
  │  "Crear sala" / "Unirse"
  ▼
NetworkSession (src/network/NetworkSession.ts)
  │  createRoom() / joinRoom()
  ▼
SignalingClient (src/network/SignalingClient.ts) ──WebSocket──▶ Servidor signaling (signaling/server.mjs)
  │                                                                    │
  │   {create,join,signal}                                             │ rooms en memoria, retransmite
  ▼                                                                    ▼
RtcPeerTransport (src/network/RtcPeerTransport.ts)
  │  RTCPeerConnection + RTCDataChannel ("game-net")
  │  SDP offer/answer + ICE candidates retransmitidos por el signaling
  ▼
NetworkTransport (interfaz abstracta, src/network/NetworkTransport.ts)
  ▼
PlayerSync (src/game/network/PlayerSync.ts)  ──▶  RemotePlayer (src/game/entities/RemotePlayer.ts)
  ▼
ChatPanel (src/ui/chatPanel.ts)
```

Cada pieza, con su ubicación real:

1. **UI de conexión** — `src/ui/connectMenu.ts` (`ConnectMenu`): botones
   `#create-room-btn` y `#join-room-btn` de `index.html`. Crea una
   `NetworkSession`, llama a `createRoom()` o `joinRoom(code)` y muestra el
   código en `#room-code-text`.

2. **Creación de sala** — `NetworkSession.createRoom()` hace
   `signaling.createRoom()` → envía `{type:'create'}` al servidor. El servidor
   genera el código con `crypto.randomBytes` y alfabeto sin ambiguos
   (`signaling/server.mjs:14-21`, `generateCode`), lo guarda en `rooms` en
   memoria y responde `{type:'created', roomCode}`.

3. **Código/ID de sala** — generado **por el servidor de signaling** en memoria
   (`server.mjs`), no por el cliente. 6 caracteres.

4. **Unión a sala** — `ConnectMenu.handleJoin()` valida 6 caracteres y llama a
   `NetworkSession.joinRoom(code)` → `signaling.joinRoom(code)` → envía
   `{type:'join', roomCode}` al servidor, que responde `{type:'joined'}` si
   existe y no está llena (máx. 2 participantes), y envía `{type:'peer-joined'}`
   al host.

5. **Announcement / descubrimiento** — no existe anuncio ni descubrimiento
   automático. El host genera un código y lo comparte **fuera de banda**
   (manual, por cualquier canal). El visitor lo introduce. No hay escaneo de
   red, mDNS ni broadcast.

6. **Signaling** — servidor WebSocket mínimo Node.js en `signaling/server.mjs`
   (dependencia única: `ws`). Mantiene salas en memoria, genera códigos y
   retransmite mensajes de signaling entre los dos peers. **No conoce el estado
   de juego.**

7. **Protocolo de signaling** — WebSocket en `ws://`, mensajes JSON. Cliente↔
   servidor: `create`, `join`, `signal`; servidor→cliente: `created`, `joined`,
   `peer-joined`, `signal`, `peer-left`, `error` (tipos en
   `src/network/protocol.ts`).

8. **P2P (juego y chat)** — sobre **RTCDataChannel** ("game-net"), mensajes JSON
   tipados (`player_state`, `player_disconnected`, `chat`). El juego y el chat
   **nunca tocan WebRTC** directamente: usan `NetworkSession`/`NetworkTransport`.

---

## 4. Signaling — host, dirección, puertos, dependencias

### Mecanismo actual
Servidor WebSocket propio (Node + `ws`), ejecutado por separado
(`cd signaling && npm start`). Solo para encontrar/emparejar a los dos peers y
retransmitir SDP/ICE.

### Ubicación en el código
- Servidor: `signaling/server.mjs`.
- Cliente: `src/network/SignalingClient.ts`.
- Test de humo del protocolo: `src/network/protocol.ts`.

### Protocolo
WebSocket (`ws:`/`wss:`), mensajes JSON.

### Dirección / host — CLAVE
`SignalingClient.defaultSignalingUrl()` (`src/network/SignalingClient.ts:15-19`):

```ts
if (typeof location === 'undefined') return 'ws://localhost:8787';
const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
return `${proto}//${location.hostname}:${DEFAULT_PORT}`;
```

- En el navegador, la URL del signaling se deriva del **hostname con el que se
  cargó la página**: `location.hostname` + puerto `8787`.
- Es decir: si la página se sirve desde `192.168.1.10:5173`, el cliente intenta
  conectarse a `ws://192.168.1.10:8787`, **no** a `localhost`.
- Solo si `location` no existe (entorno no-navegador, p. ej. tests Node) cae a
  `ws://localhost:8787`.

Esto significa que **la dependencia de localhost NO está en el código cliente**
para el signaling: lo que decide es la IP/LAN desde la que se sirve la página.
El potenciador de "localhost" aparece solo en el caso fuera-de-navegador.

### Puertos
- **8787** (por defecto): WebSocket del signaling (configurable con
  `SIGNALING_PORT` o `PORT` en `signaling/server.mjs:4`; escucha en
  `0.0.0.0`).
- **5173** (por defecto): servidor Vite dev que sirve la página
  (hostname del usuario)).
- WebRTC (RTCDataChannel) usa pares UDP/DTLS dinámicos (sin puertos fijos).

---

## 5. WebRTC

- **Creación de PeerConnection:** `RtcPeerTransport.connect()`
  (`src/network/RtcPeerTransport.ts:71`):
  ```ts
  this.connection = new RTCPeerConnection({ iceServers: this.iceServers });
  ```
- **Canal de datos:** el **host** crea `createDataChannel('game-net')`
  (`:115`); el **visitor** recibe `ondatachannel` (`:92`).

### SDP (offer/answer)
- **Host** (`startHostNegotiation`, al recibir `peer-joined`): crea el `offer`
  (`createOffer`), `setLocalDescription`, envía `{kind:'offer', sdp}` por el
  signaling (`makeOffer`, `:149`). Aviso: solo negocia **una vez**
  (`negotiationStarted`) para evitar `peer-joined` duplicados.
- **Visitor** (al recibir el `offer`): `setRemoteDescription`, `createAnswer`,
  `setLocalDescription`, envía `{kind:'answer', sdp}` (`handleIncomingSignal`,
  `:161`).
- **Host** recibe el `answer`: `setRemoteDescription` (`:177`).
- Timeout de negociación: `NEGOTIATION_TIMEOUT_MS = 15000` (`:7`).

### ICE
- **Candidates:** `onicecandidate` (`:72`) envía cada candidato vía signaling
  (`{kind:'ice', candidate, sdpMid, sdpMLineIndex}`).
- **Entrada:** el peer recibe `kind:'ice'` y hace `addIceCandidate`
  (`:182`).

### Configuración ICE/STUN/TURN actual
```
src/network/RtcPeerTransport.ts:12
const DEFAULT_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
```
- **STUN:** un único STUN público de Google (`stun:stun.l.google.com:19302`)
  para descubrir la ruta por Internet.
- **TURN:** NO se usa (explicitamente fuera de M07; sin servidor TURN).

---

## 6. Estado actual — qué funciona hoy

### A) Dos pestañas en el mismo ordenador
- Página servida por Vite dev (`localhost:5173` o por la IP LAN).
- Cada pestaña ejecuta un `SignalingClient` contra el mismo servidor de
  signaling local.
- Una crea la sala, otra la une con el código. Signaling local, SDP/ICE por
  host reflect-C / mDNS de loopback. WebRTC conecta sobre el loopback o la NIC
  local. Funciona **sin Internet** para el signaling (el signaling es local),
  pero **sí consulta STUN de Google** para candidates; en loopback suele
  bastar con los candidates locales sin STUN.

### B) Dos dispositivos físicos en la misma LAN — el objetivo de M08
- Estado **desconocido / no validado**: nunca se ha probado en esta
  configuración. Es exactamente lo que M08-B debe conseguir y validar.

### C) Dos redes diferentes por Internet
- Arquitectónicamente el P2P ya está preparado (hay STUN configurado), pero
  **no implementado/validado**: el signaling actual es local al desarrollo, no
  hay un servidor accesible desde Internet y **no hay TURN** (crítico para
  NATs simétricos / transporte móvil). Fuera del alcance de esta fase.

---

## 7. Bloqueadores para LAN (PC ↔ teléfono/tablet en la misma Wi-Fi)

Análisis, pieza por pieza:

1. **El signaling se sirve desde la misma máquina que la página.**
   `SignalingClient` usa `location.hostname:8787`. Si la página se abre desde
   la IP LAN del PC (p. ej. `192.168.1.10:5173`), el teléfono intentará
   `ws://192.168.1.10:8787`, que **sí apuntará al servidor de signaling del
   PC**. Esto debería funcionar **siempre que**:
   - El signaling se ejecute en el PC y escuche en `0.0.0.0` (ya lo hace,
     `server.mjs:113`).
   - El puerto `8787` esté **abierto en el firewall del PC** para la red LAN
     local. Este es el bloqueador principal no obvio.
   - La página se abra en el teléfono usando la **IP LAN del PC y no
     `localhost`** (que apuntaría al propio teléfono y fallaría).

2. **Descubrimiento no automático.** Código de sala generado por el signaling
   y compartido manualmente. No bloquea, es solo fricción de UX (ya requerido
   también en dos pestañas).

3. **WebRTC sobre Wi-Fi doméstica.** En una misma LAN sin NATs simétricos, los
   candidates host locales (`192.168.x.x`) suelen bastar y STUN/Google no hace
   falta. Debería conectar por pares host. Posibles matices:
   - **AP isolation / cliente isolation** en el router (aísla clientes Wi-Fi
     entre sí): bloquea el tráfico P2P LAN directo. Configuración del router,
     no del código.
   - **Firewall** del PC bloqueando tráfico UDP/DTLS entrante desde la LAN.

4. **TURN ausente** (no bloquea LAN, pero sí NATs más complejos en general).

5. **Certificados/permisos del navegador en móvil.** Al servir Vite dev por
   HTTP desde una IP LAN, el navegador móvil puede bloquear **WebSockets
   mixtos / permisos de cámara no aplicables aquí**, o requerir aceptar el
   riesgo de http. También el micrófono/cámara no interviene. El dato más
   relevante: **HTTP en LAN suele permitir WebSocket**, pero conviene validar
   en el dispositivo real.

### Resumen de bloqueadores concretos para LAN
| # | Bloqueador | ¿Código o entorno? |
|---|---|---|
| 1 | Firewall del PC bloqueando el puerto 8787 (signaling) | Entorno (config) |
| 2 | Firewall del PC bloqueando UDP WebRTC desde la LAN | Entorno (config) |
| 3 | Abrir la página en el móvil con `localhost` en vez de la IP LAN | Uso/UX |
| 4 | AP/client isolation del router aislar clientes Wi-Fi | Entorno (config router) |
| 5 | Nada en el código que fuerce `localhost` en el navegador (usa `location.hostname`) | — (ya está bien) |

---

## 8. Qué NO necesitamos todavía (Internet)

Estos componentes **NO deben implementarse en esta primera fase**:

- **No introducir un servidor TURN** (requiere infraestructura, gasto,
  credenciales; innecesario para LAN).
- **No añadir servidores de signaling accesibles desde Internet** (deployment,
  dominios, TLS, autenticación).
- **No añadir descubrimiento automático de la LAN** (mDNS/broadcast): útil pero
  no necesario para M08-B (el compartir código manual ya funciona).
- **No añadir autenticación ni cuentas.**
- **No cambiar el protocolo de mensajes P2P.**
- **No añadir nuevas funcionalidades de chat.**
- **No cambiar la arquitectura de red por iniciativa propia.**

---

## 9. Plan propuesto para M08-B (mínimo)

Objetivo: "Dispositivo A en LAN ↔ Dispositivo B en LAN" sin funcionalidades
innecesarias. Lo mínimo que se plantea para la siguiente fase (no se implementa
aquí):

**A. Cambios de entorno/proceso (no de código):**
1. Ejecutar el servidor de signaling en el PC (ya escucha en `0.0.0.0:8787`).
2. Abrir en el firewall del PC el puerto **8787** (TCP, WebSocket) y permitir
   **UDP** WebRTC hacia la LAN.
3. Abrir la página en el móvil con la **IP LAN del PC** (p. ej.
   `http://192.168.1.10:5173`), no con `localhost`.
4. Desactivar/verificar el **AP isolation** del router si falla la conexión P2P.

**B. Cambios de código mínimos (a decidir en la fase de implementación):**
1. **Verificar y documentar** que `location.hostname` ya apunta al signaling
   correcto al abrir por IP LAN (no debería requerir cambios; confirmarlo en
   dispositivo real).
2. Probar la conexión LAN real (dos pestañas en distintas máquinas) y corregir
   solo lo que falle (p. ej. ajustar candidates/ICE si el browser no pickea el
   host candidate LAN).

> No se propone tocar la lógica de signaling ni de WebRTC salvo que la prueba
> real lo exija. La hipótesis es que el código actual ya soporta LAN y el
> bloqueo está en entorno (firewall / cómo se abre la página).

---

## 10. Pruebas realizadas

Sobre `milestone-08` (base idéntica a `main` tras M07):

- **`npm test`** → **26/26 PASS** (6 suites, 0 fail). Base limpia.
- **`npm run build`** → **OK** (tsc strict + Vite build). Solo warning de
  tamaño de chunk (información, no bloquea).

Ninguno falla; no hubo que arreglar nada.

---

## 11. Resumen de hallazgos clave

- El signaling **no depende de localhost en el cliente navegador**: usa
  `location.hostname:8787`, que apunta a la IP con la que se sirve la página.
  Esto ya facilita LAN.
- Los bloqueadores para LAN son **entorno, no código**: firewall (8787 y UDP
  WebRTC), abrir la página en el móvil con la IP LAN del PC, y posible AP
  isolation del router.
- La página se sirve con Vite dev en `:5173`; el signaling en `:8787`.
- WebRTC ya configura un STUN público (Google); **no hay TURN**. Para LAN los
  candidates host suelen bastar.
- **Nunca se ha validado** la conexión entre dos dispositivos físicos: ese es
  el paso de verificación pendiente de M08-B.

---

## 12. M08-B — Prueba real LAN (PASS)

Se validó la conexión entre **dos dispositivos físicos en la misma red Wi‑Fi**,
cumpliendo el objetivo de M08-B:

**Setup real probado:**
- Tablet con Termux: sirve la página con Vite (`--host 0.0.0.0`, puerto 5173) y
  ejecuta el servidor de signaling (`node signaling/server.mjs`, puerto 8787,
  escucha en `0.0.0.0`).
- Teléfono: abre `http://192.168.1.2:5173` (la IP LAN de la tablet), **no**
  `localhost`.
- Los puertos 8787 (TCP) y WebRTC (UDP) quedaron accesibles en la LAN local.

**Resultado:** un dispositivo crea la sala, el otro la une con el código y la
conexión P2P establece el canal de datos. 

**Confirmación de las hipótesis de la fase de análisis:**
- `location.hostname` apunta correctamente al signaling al abrir por IP LAN (no
  hubo que cambiar nada de código para que la LAN funcione).
- Los bloqueadores eran de **entorno/configuración** (firewall, abrir por IP
  LAN, AP isolation), no de código.
- WebRTC conectó con candidates host de la LAN; no hizo falta TURN.

---

## 13. M08-C — Recuperación de sesión tras suspensión/recarga del navegador

### 13.1 Problema detectado

Durante la prueba LAN real se detectó que, al **suspender el navegador o
recargar la página**, la sesión se perdía: el WebSocket de signaling se cierra y
el servidor **borraba la sala al instante** (pattern observado en el log del
signaling: *"sala creada → participante unido → sala cerrada"*).

Causa raíz: `handleClose()` en el servidor liberaba el slot final al cerrarse el
socket, sin dejar margen para que el participante regresara. No había identidad
persistente ni forma de reclamar el propio slot tras una recarga.

### 13.2 Diagnóstico técnico

- **Se cierra el WebSocket de signaling** (suspensión/recarga), el servidor
  hace `handleClose()` y elimina la sala (y el estado de gameplay se reinicia).
- El participante que vuelve **no tiene identidad propia**: cada carga generaba
  ids efímeros, por lo que el servidor no podía saber qué slot era suyo.
- No existía flujo de `resume`: el único camino era volver a `create`/`join`
  con un **código de sala nuevo** (se perdía la conexión previa).

### 13.3 Solución mínima implementada

Un **streak de recuperación con identidad persistente**, sin Internet, sin
TURN, sin autenticación y **sin modificar el flujo normal create/join** (el
límite de 2 participantes se mantiene):

1. **Identidad persistente del navegador** (`src/network/SessionPersistence.ts`:
   `participantId` y `playerId` estables en `localStorage`, además del código de
   la sala activa). Esto NO es autenticación: solo distingue "misma persona que
   ocupaba el slot".

2. **Ventana de gracia en el servidor** (`signaling/server.mjs`):
   - Al cerrarse el WebSocket de un participante **sin `leave` explícito**, su
     slot queda `recovering` con un `deadline` (`DEFAULT_GRACE_MS = 30_000`, un
     *sweep* cada 2 s).
   - Durante esa ventana, la identidad puede reclamar su slot (la sala no se
     cierra; el otro participante sigue en ella).
   - Si la gracia expira, el slot se libera y se envía `peer-left` al activo.

3. **Mensajes nuevos en protocolo** (`src/network/protocol.ts`):
   - Cliente→servidor: `resume {roomCode, participantId, role}`, `leave`.
   - Servidor→cliente: `resumed {roomCode, peerActive}`,
     `peer-resumed {roomCode}`.
   - `create`/`join` ahora incluyen `participantId` (para poder reclamar el
     slot; el servidor lo valida).

4. **Flujo de recuperación** (`NetworkSession.resume()`):
   - Al cargar, si hay sesión guardada se intenta `resume` automáticamente
     antes de mostrar el menú de conexión.
   - El host vuelve a su sala y **renegocia desde cero** (nueva
     `RTCPeerConnection` + offer) en cuanto el servidor confirma `peerActive`.
     Decisión: se usa renegociación fresca en lugar de `restartIce()`
     (más determinista; `restartIce` queda como subfase posterior si hiciera
     falta).
   - El visitor vuelve y espera el offer del host (`peer-resumed` del lado
     activo dispara la renegociación).
   - `RtcPeerTransport` ya **no cierra al instante** en `disconnected`/`failed`
     mientras la sesión está `open`: mantiene un *hold* de recuperación
     (`RECOVERY_HOLD_MS = 35_000`) que da margen a que el peer vuelva.

5. **Salida limpia**: `NetworkSession.close()` envía `leave` explícito para
   liberar el slot (y cerrar la sala) **al instante**, sin esperar la gracia
   (esto preserva el flujo normal "abandonar sala").

### 13.4 Tests nuevos

- `tests/helpers/signaling.ts`: servidor real en proceso (`port: 0`) + cliente
  de test (`WsTestClient`) con espera por tipo de mensaje.
- `tests/signalingServer.test.ts` (14): flujo normal create/join/signal;
  sala llena; recuperación del host y del visitor; `peerActive=false` (ambos se
  van); identidad ajena no puede reclamar el slot; rol incorrecto rechazado;
  doble recuperación simultánea (solo la primera gana); expiración de la gracia
  (+ `peer-left` al activo); el resume conserva el MISMÍSIMO código de sala;
  `leave` explícito libera al instante; mensajes inválidos.
- `tests/signalingClient.test.ts` (4): `createRoom`, `joinRoom` (+sala no
  encontrada), `resume` con `peerActive`, `leave` libera la sala.
- `tests/networkSession.test.ts` (7): `NetworkSession` contra signaling real
  con transporte fake (sin WebRTC en Node): create/join, sala llena, recuperación
  host/visitor, identidad ajena rechazada, `close()` envía `leave`.

### 13.5 Comprobaciones

- **`npm test`** → **51/51 PASS** (26 preexistentes + 25 nuevos; 11 suites).
- **`npm run build`** → **OK** (tsc estricto + Vite). Solo el warning de tamaño
  de chunk ya conocido (Phaser).
- CLI del signaling verificado (arranca y responde con el nuevo protocolo).

### 13.6 Limitaciones conocidas de M08-C

- La renegociación WebRTC ocurre en el navegador y **no se puede validar en
  Node**; necesita prueba manual en los dos dispositivos reales (suspender y
  volver). Los tests cubren signaling y sesión, no el P2P del navegador.
- Una sesión guardada **obsoleta** (abrir al día siguiente un código ya
  expirado) mostrará un error al cargar; es el comportamiento previsto y se
  limpiará la sesión guardada.
- Si el **otro participante se quedó sin conexión 35 s**, el slot expira y el
  caso cae al flujo normal (el que vuelve no reocupará su lugar).
- Sigue **sin TURN** (fuera de alcance) y `restartIce()` no se usa (decision
  documentada).
- **Operativa**: el servidor de signaling que ya estaba corriendo (proceso
  antiguo) debe **reiniciarse** para servir el nuevo protocolo.

---

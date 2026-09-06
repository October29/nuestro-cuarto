# Reporte 07 — Propuesta: Habitación P2P (prueba de concepto)

**Estado:** APROBADA con tres correcciones (v2). Aún no se ha implementado nada.
**Milestone:** M07
**Rama de trabajo prevista:** `milestone-07` (partiendo de `main`)

---

## 1. Objetivo

Demostrar con un mínimo de piezas que **dos navegadores pueden compartir la
misma habitación mediante una conexión P2P**:

1. A abre el juego y crea una habitación.
2. El juego genera un código de conexión.
3. A comparte el código con B.
4. B introduce el código.
5. Ambos navegadores establecen una conexión P2P.
6. Ambos aparecen en la misma habitación.
7. Cada usuario ve el personaje del otro.
8. El movimiento de cada personaje se sincroniza.
9. Existe una ventana de chat mínima; lo que envía A aparece en B y viceversa.

No se busca embellecer el juego ni construir una arquitectura multiplayer
completa. Es solo una prueba real entre dos personas.

---

## 2. Alcance explícito

### Dentro de M07

- Conexión P2P WebRTC para **dos** personas.
- Servidor de **signaling** mínimo (solo intercambio de SDP/ICE).
- Sincronización de posición/estado mínimo de cada jugador.
- Chat de texto mínimo por el mismo canal de datos.
- Detección de desconexión básica del peer.
- Validación mínima de mensajes recibidos.
- Modo single-player intacto: la app arranca igual sin red.
- Validación en tres etapas **M07-A** (dos pestañas en la misma máquina),
  **M07-B** (dos dispositivos en la misma LAN) y **M07-C** (dos redes por
  Internet). **El criterio de éxito real de M07 es M07-C.**

### Fuera de M07 (NO se implementa)

- Cuentas, autenticación, base de datos, persistencia.
- Matchmaking, listas de amigos, múltiples salas simultáneas.
- Servidores de juego o estado autoritativo central.
- **Reconciliación, anti-cheat y autoridad de estado**: cada cliente es
  autoridad de su propio personaje; ningún cliente valida ni corrige la
  posición del otro.
- **TURN**: si una red concreta no puede establecer P2P porque requiere relé
  (NAT simétrico, UDP bloqueado, etc.), se reporta como **limitación de
  infraestructura**, pero no se implementa TURN dentro de M07.
- Más de dos jugadores.
- Voz, vídeo, media streams.
- Reconexión avanzada, heartbeat/signalling de presencia robusto.
- Interpolación/predicción de red, rollback, anti-cheat.
- NAT traversal avanzado y sistemas de permisos.
- Inventarios, economía, decoración sincronizada.

---

## 3. Transporte elegido

**WebRTC sobre `RTCDataChannel`**, usando `RTCPeerConnection` directamente
(API del navegador, sin librería cliente externa).

Motivos:

- Es la API nativa de conexión P2P entre navegadores.
- El canal de datos sirve tanto para estado de juego como para chat.
- Todo el tráfico viaja cifrado por DTLS de forma obligatoria.
- Tras el handshake, los datos no pasan por ningún servidor.

No se utilizan media streams (solo canal de datos).

---

## 4. Signaling

### Decisión propuesta: servidor propio

Un servidor Node/WebSocket **mínimo y autohospedado** usando el paquete `ws`
(única dependencia nueva del milestone, y queda confinada en `signaling/`).

Su única responsabilidad es ayudar a que dos navegadores se encuentren y
negocien la conexión P2P:

- Crear habitaciones y generar códigos.
- Emparejar el host con el visitante.
- Retransmitir mensajes `offer` / `answer` / `ice` entre los dos peers.
- Mantener las salas en memoria (`Map` código → sockets). Sin persistencia.
- Rechazar un tercer peer por habitación.

El servidor **no** parsea SDP/ICE, **no** conoce el estado del juego y
**no** se convierte en servidor de juego. Solo mueve bytes de signaling.

### Alternativa descartada

**PeerJS** (librería con signaling alojado por terceros): reduce el código
propio pero acopla el proyecto a un servicio externo y a una dependencia más
grande. Para una PoC autónoma y documentable se prefiere el servidor propio.

### Implicaciones de STUN/TURN

- **STUN (sí, mínimo):** un servidor público
  (`stun:stun.l.google.com:19302`) para que cada peer pueda descubrir su IP/port
  público tras el NAT cuando la conexión es por Internet. No transmite datos:
  solo ayuda a descubrir la ruta.
- **TURN (no en M07):** relé de tráfico cuando no existen rutas directas
  (NAT simétrico, redes que bloquean UDP, firewalls estrictos). Implica correr/contratar un
  servidor TURN y está documentado como límite: **sin TURN, no todos los
  navegadores podrán conectarse en cualquier red.**
- Por tanto, no se asume que P2P funcione en cualquier red: en la misma
  máquina o en una LAN normal, los candidatos host/mDNS bastan; por Internet
  funciona en la mayoría de NAT "home" gracias a STUN.

---

## 5. Modelo host / visitor

**Definición M07 (sin autoridad de estado):**

- **Host** = quien crea la habitación. Únicamente inicia la negociación
  WebRTC (`createOffer`) y posee el código de conexión. **No es autoridad de
  ningún estado compartido.**
- **Visitor** = quien se une con el código. Responde con `answer`.

La conexión es **100 % P2P**. No existe servidor ni jugador autoritativo:

- Cada cliente es autoridad de **su propio** Player.
- Ningún cliente valida ni corrige la posición del otro.
- El host no recibe un rol especial de control sobre el visitante.
- No hay reconciliación, anti-cheat ni autoridad de estado en M07.

El modelo puede ampliarse o sustituirse en futuros milestones sin acoplar
Phaser al transporte.

---

## 6. Arquitectura por capas

```
Gameplay                (Phaser — escena, Player, RemotePlayer, HUD)
    │
    ▼
Networking abstraction  (NetworkSession + NetworkTransport)
    │
    ▼
P2P transport           (RtcPeerTransport + SignalingClient)
```

- **`NetworkTransport`** (interfaz conceptual):
  `connect() / disconnect() / send() / onMessage()` + estado de conexión.
- **`NetworkSession`**: orquesta signaling + transporte, serializa/deserializa
  mensajes del protocolo, mantiene la identidad del peer y emite **eventos
  tipados** al juego (playerConnected, playerState, playerDisconnected,
  chatMessage, connectionClosed).
- **`RoomScene` y `Player`** consumen eventos/datos de `NetworkSession` **sin
  conocer detalles de RTCDataChannel/WebRTC**.
- Separación de responsabilidades: conexión, identificación del peer,
  serialización/deserialización y estado de conexión quedan en la capa de red.

### Responsabilidad de la UI (corrección 3)

La UI no conoce WebRTC. `connectMenu` y `chatPanel` consumen `NetworkSession`
y emiten **acciones simples**, sin saber nada de `RTCDataChannel`, signaling,
SDP/ICE ni serialización:

```
NetworkSession
    ├── Connection UI     (solicitar crear/unirse, mostrar código/estado)
    ├── Chat UI           (enviar texto, mostrar mensajes)
    └── RoomScene / RemotePlayer
```

La UI puede:

- solicitar crear habitación;
- solicitar unirse con código;
- mostrar código y estado de conexión;
- enviar/mostrar texto de chat.

La gestión de signaling, WebRTC, serialización y eventos permanece en
`src/network/`.

### Estructura de archivos propuesta

```
signaling/
  package.json          (dependencia única: ws)
  server.mjs            (servidor WebSocket de signaling)
  README.md             (cómo ejecutarlo localmente)

src/network/
  protocol.ts           (tipos de mensaje + validación + límites)
  NetworkTransport.ts   (interfaz de transporte)
  SignalingClient.ts    (cliente WebSocket al signaling)
  RtcPeerTransport.ts   (implementación WebRTC de NetworkTransport)
  NetworkSession.ts     (orquestador + eventos tipados)
  session.ts            (instancia compartida por la app)

src/ui/
  connectMenu.ts        (menú DOM: crear/unirse, código, nombre)
  chatPanel.ts          (panel DOM de chat)

src/game/entities/
  RemotePlayer.ts       (visual minimalista del player remoto)

src/game/scenes/
  RoomScene.ts          (se integra con NetworkSession, sin WebRTC)
```

---

## 7. Protocolo de mensajes

Protocolo mínimo y tipado sobre el `RTCDataChannel` (`game-net`). Los mensajes
son JSON con un campo `type`. **Nunca** se serializan objetos Phaser ni
instancias de Player; solo datos planos.

| Tipo | Contenido |
| --- | --- |
| `player_connected` | `playerId`, `name` (anuncio al conectar) |
| `player_state` | `playerId`, `x`, `y`, `sitting` |
| `player_disconnected` | `playerId` (despedida explícita, best-effort) |
| `chat` | `playerId`, `text` |

Validación al recibir (no se confía en el peer):

- Tipo conocido y estructura esperada.
- Tipos de datos correctos.
- Números finitos y dentro de rangos razonables (coordenadas del mundo,
  etc.).
- Longitudes máximas: nombre ≤ 16 caracteres, mensaje de chat ≤ 200.
- `JSON.parse` en `try/catch`. **Sin `eval`**, sin ejecutar código recibido.

---

## 8. Sincronización de jugadores

### Representación mínima por jugador

```ts
{ playerId, x, y, sitting }
```

- `x`, `y`: centro del collider del jugador (mismas coordenadas del mundo).
- `sitting`: estado sentado/de pie para mostrar el remoto correctamente.

### Frecuencia

- **10 Hz** (un envío cada ~100 ms), constante en `config`/`protocol` y
  documentada. Ajustable fácilmente. No se optimiza prematuramente.

### Rendimiento del remoto

- El remoto se representa con un `RemotePlayer` (Container) sencillo, sin
  colisiones ni input.
- Leve **lerp** (suavizado visual hacia la última posición recibida). No es
  interpolación de red ni predicción.

---

## 9. Chat

- Overlay **HTML/DOM** (no objetos Phaser): lista de mensajes + campo de texto
  + botón de envío.
- Envío con **Enter**; foco del campo con clic; `Escape` devuelve el foco al
  juego (mientras el campo está enfocado, el juego ignora teclas de
  movimiento/interacción).
- Límite de 200 caracteres por mensaje y etiqueta mínima del remitente
  (nombre del peer, o "Tú").
- Viaja por el **mismo `RTCDataChannel`** (tipo `chat`).
- Sin base de datos ni persistencia de conversaciones.
- `chatPanel` solo se comunica con `NetworkSession` (enviar texto y recibir
  mensajes); no toca transporte ni WebRTC (ver §6, corrección 3).

---

## 10. Desconexión

- Se detecta vía eventos `close`/`error` del canal de datos y estados de
  `RTCPeerConnection`.
- **Visitante desaparece / host termina** → el otro lado elimina el
  `RemotePlayer`, muestra "Conexión terminada" y la UI de conexión vuelve a
  estar disponible. El estado visual nunca finge que el otro sigue conectado.
- Sin reconexión compleja ni heartbeat en M07 (documentado como límite: una
  caída silenciosa de red sin cierre del canal podría no detectarse).

---

## 11. Seguridad

- No se confía en los mensajes P2P.
- Validación mínima descrita en §7.
- Límites de longitud para texto.
- Sin `eval`, sin ejecutar código del peer.
- Todo el tráfico P2P va cifrado por DTLS (obligatorio en WebRTC).
- El signaling no recibe ni almacena contenido de chat ni estado de juego.

---

## 12. Build y retrocompatibilidad

- La app debe seguir compilando y funcionando **exactamente igual** sin red
  (single-player por defecto).
- Multiplayer se habilita mediante la UI de conexión.
- `RoomScene` no depende de una conexión activa para arrancar.
- Al final de cada etapa: `npm run build` (TypeScript strict + Vite),
  comprobación de que el single-player sigue funcionando, actualización de
  documentación y commit/push en `milestone-07` únicamente.

---

## 13. Dependencias nuevas

Única dependencia: **`ws`** (npm) — solo dentro de `signaling/package.json`,
para el servidor de signaling. No se toca el bundle del juego ni se añade nada
a `dependencies`/`devDependencies` del proyecto principal.

---

## 14. Plan de validación en tres etapas

M07 se planifica y documenta como tres etapas de validación crecientes:

### M07-A — Dos pestañas/navegadores en la misma máquina

1. Arrancar signaling: `cd signaling && npm i && npm run start` (puerto 8787).
2. Servir el juego: `npm run dev` (Vite, `localhost`).
3. Pestaña A: crear habitación → anotar código.
4. Pestaña B: unirse con el código.
5. Verificar: ambos personajes aparecen juntos, el movimiento se sincroniza y
   el chat funciona en ambos sentidos.

Esta etapa valida la arquitectura y el flujo, pero **no es la validación
final del milestone**: si A y B están en la misma máquina, la "conexión" no
atraviesa ninguna red y no demuestra P2P real.

### M07-B — Dos dispositivos en la misma LAN

1. Dos dispositivos (p. ej. un ordenador y un móvil) en la misma red.
2. Signaling alcanzable desde ambos (IP LAN del equipo que lo ejecuta),
   p. ej. `ws://192.168.1.x:8787`.
3. El juego servido debe alcanzarse desde el segundo dispositivo
   (IP LAN del host de Vite en lugar de `localhost`).
4. Mismo flujo: A crea, B se une con el código.
5. Verificar movimiento sincronizado y chat.

Esta etapa ya usa ICE real sobre la red local (candidatos host/mDNS);
confirma el flujo entre procesos/tiempos de ejecución distintos. Posibles
problemas: mDNS / AP-isolation (documentados en §16).

### M07-C — Dos redes diferentes por Internet (criterio de éxito real)

1. El signaling debe ser alcanzable desde Internet (IP pública/dominio, o túnel
   como alternativa de prueba).
2. El juego servido debe alcanzarse desde ambos dispositivos (idealmente en
   HTTPS; ver §16).
3. STUN público configurado (`stun:stun.l.google.com:19302`) para descubrir los
   puntos de acceso públicos tras el NAT.
4. A crea la habitación y Comparte el código con B por cualquier canal
   (aplicación de mensajería, etc.).
5. B introduce el código y ambos intentan entrar a la misma habitación.

**El criterio de éxito real de M07 es M07-C**: dos personas reales deben poder
intentar entrar a la misma habitación desde redes distintas. Si **una red
concreta** no puede establecer P2P porque requiere TURN, eso se reporta como
**limitación de infraestructura** y **no se implementa TURN** dentro de M07
(cada red sin relé directo funciona, las restantes se documentan).

---

## 15. Decisiones confirmadas

La propuesta se aprueba con estas elecciones cerradas:

1. **Signaling propio con `ws`** (rechazada la alternativa PeerJS/hosting).
2. **UI en HTML/CSS superpuesta** consumiendo `NetworkSession` (sin WebRTC).
3. **Lerp simple** para el remoto (sin interpolación/predicción).
4. **10 Hz** de sincronización de estado.
5. **Host sin autoridad de estado** (corrección 1).
6. **Validación en tres etapas M07-A/B/C** con éxito real en M07-C
   (corrección 2).
7. **UI desacoplada del transporte** (corrección 3).

---

## 16. Problemas conocidos / límites previstos para M07

- Sin TURN: NAT simétricos y redes con UDP bloqueado impedirán la conexión;
  se reporta como limitación de infraestructura, no se implementa TURN.
- Cámara sigue al jugador local: el remoto puede quedar fuera de pantalla
  hasta encontrarse.
- Sin heartbeat: caídas silenciosas pueden no detectarse al momento.
- En LAN, mDNS / AP-isolation / aislamiento de multicast pueden romper la
  negociación entre dispositivos.
- La prueba en dos pestañas localhost valida el flujo pero **no** el P2P real;
  el éxito del milestone se evalúa en M07-C.
- Contexto seguro: WebRTC se comporta mejor en HTTPS; para Internet real se
  recomienda HTTPS (o al menos `localhost` en desarrollo). Es posible que
  algunos navegadores exijan contexto seguro para ciertas APIs.
- El sistema es para un único par host/visitor.

---

## 17. Estado del documento

Propuesta aprobada con las tres correcciones (modelo host/visitor sin
autoridad, validación en tres etapas M07-A/B/C, UI desacoplada del
transporte). Pendiente: revisión del plan de implementación por etapas antes
de comenzar a programar. Una vez aprobado, se implementará incrementalmente en
`milestone-07` con commits pequeños, comprobando build + single-player +
documentación en cada etapa. No se tocará `main` ni se iniciará M08.
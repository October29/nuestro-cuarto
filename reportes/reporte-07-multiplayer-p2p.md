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
transporte). Implementación de Etapas 1–5 **completada** en `milestone-07`.
Tres bugs de integración detectados en M07-A real y corregidos (ver §20).
Quedan pendientes las validaciones M07-A/B/C en entorno real. No se tocará
`main` ni se iniciará M08.

---

## 18. Avance de implementación

### Etapa 1 — Servidor de signaling (terminada, commit `7fed4fb`)

Servidor mínimo de signaling en `signaling/server.mjs` (única dependencia:
`ws`). Empareja un máximo de 2 participantes por sala, genera códigos de 6
caracteres y retransmite señales arbitrarias (SDP/ICE) de forma opaca. El
servidor no conoce el estado de juego.

Validación: prueba extremo a extremo con dos clientes WebSocket reales
(8 comprobaciones PASS): crear sala, unirse, rechazo de tercer participante,
retransmisión de oferta/respuesta/ICE en ambos sentidos, aviso de salida y
limpieza de la sala al desconectarse.

### Etapa 2 — Capa de protocolo y transporte WebRTC (terminada)

Nueva carpeta `src/network/` con cuatro archivos (`protocol.ts`,
`NetworkTransport.ts`, `SignalingClient.ts`, `RtcPeerTransport.ts`).

- **protocol.ts**: serialización y validación. Distingue los mensajes de
  *signaling* (`create`, `join`, `signal`, `created`, `joined`, `peer-joined`,
  `peer-left`, `error`) de los mensajes P2P (`player_connected`,
  `player_state`, `player_disconnected`, `chat`). Los mensajes recibidos se
  validan antes de usarse (tipos conocidos, ids no vacíos, número de
  coordenadas acotado, nombres/chat dentro de longitud máxima). El peer no se
  considera de fiar.
- **NetworkTransport.ts**: interfaz que la capa de sesión/gameplay usará
  (`connect()`, `send()`, `close()` + eventos `onOpen/onMessage/onClose/
  onError`). Oculta por completo WebRTC: la UI y la sesión no verán jamás un
  `RTCPeerConnection` o un `RTCDataChannel`.
- **SignalingClient.ts**: cliente del servidor de la Etapa 1. Conecta, crea
  sala (`createRoom()`), se une (`joinRoom(code)`) y reenvía señales. La URL
  por defecto se deriva del host servidor (`ws(s)://hostname:8787`) y es
  configurable por constructor. Estados: idle/connecting/connected/closed.
- **RtcPeerTransport.ts**: implementa la interfaz usando solo las APIs WebRTC
  del navegador, sin librerías externas. El host crea el `offer` y el
  `RTCDataChannel`; el visitor responde con `answer`. El canal de datos se
  llama `game-net`. STUN público configurado; TURN explícitamente fuera de M07.
  Maneja errores básicos: servidor inaccesible, sala no encontrada, negociación
  fallida (timeout 15 s), peer desconectado. El cierre local no dispara `onClose`.

Validación en Node (harness temporal, ya eliminado): el servidor real de la
Etapa 1 + dos instancias de `RtcPeerTransport` con un mock fiel de las APIs
WebRTC del navegador. 12 comprobaciones PASS: `connect()` rechaza con servidor
inaccesible; crear y unirse a sala reales; rechazo de sala inexistente;
negociación completa host/visitor; `RTCDataChannel` abierto en ambos lados;
recepción de `player_state` en un sentido y de `chat` en el otro; mensaje
inválido ignorado; cierre del visitor detectado por el host; estados correctos;
arranque del servidor. **Advertencia honesta**: al no disponer de navegador en
este entorno, la negociación se verificó con mocks; la validación en navegador
real forma parte de M07-A/B/C.

También comprobado: `npm run build` (TypeScript strict + Vite) sin errores. El
single-player no depende de la red (`src/network/` no se importa desde ninguna
escena todavía).

### Etapa 3 — NetworkSession (terminada)

Nuevo archivo `src/network/NetworkSession.ts`: capa de sesión que orquesta
signaling + transporte y expone un punto único de entrada a la red.

```
Gameplay/UI
    ↓
NetworkSession
    ↓
NetworkTransport
    ↓
RtcPeerTransport / futuro transporte alternativo
```

- `createRoom(): Promise<string>` — ruta host: conecta el signaling (Etapa 1),
  crea sala, construye el transporte y negocia el canal P2P. Devuelve el
  código de sala.
- `joinRoom(code): Promise<void>` — ruta visitor: conecta, se une y negocia.
- `send(message: PeerMessage): boolean` — envío tipado; `false` si no hay
  sesión activa.
- `close(): void` — cierre local (no dispara `onPeerLeft`).
- Estado expuesto: `state` (`idle | connecting | connected | disconnected |
  error`), `roomCode`, `role` (`host | visitor`).
- Eventos a la capa superior: `onOpen(roomCode)`, `onMessage(PeerMessage)`,
  `onPeerLeft(reason)`, `onError(error)`. Errores básicos manejados: signaling
  inaccesible, sala no encontrada/llena, negociación fallida (timeout en el
  transporte). Tras un error se permite reintentar.
- `makeTransport` inyectable (opciones del constructor): por defecto usa
  `RtcPeerTransport`, y en pruebas se inyecta un transporte mock. Permite un
  futuro transporte alternativo sin tocar la sesión.
- Restricciones cumplidas: no conoce Phaser, no renderiza, no mueve jugadores,
  no toca el DOM, no tiene lógica de chat/interpolación/posiciones y no accede
  a `RTCPeerConnection` ni a `RTCDataChannel` (solo usa `NetworkTransport` y
  `SignalingClient`). Reutiliza los tipos y la interfaz de la Etapa 2; no
  duplica protocolo.
- Modelo de dos peers intacto: el rol solo sirve para establecer la conexión
  (el host crea oferta/canal; ninguno es autoridad global).

Validación en Node (harness temporal con transporte mock sobre el servidor de
signaling real; ya eliminado). 20 comprobaciones PASS: creación de sesión con
sala real (código válido, `connected`, `onOpen`, `roomCode`, rol host);
unión del visitor (`connected`, `onOpen`, rol visitor); envío y recepción
tipados en ambos sentidos; `send` devuelve `false` sin conexión; cierre del
visitor detectado por el host (`onPeerLeft`, ambos en `disconnected`);
negociación fallida (rechazo, estado `error`, `onError`); reintento tras error
funcional; comprobación estática de que `NetworkSession.ts` no usa APIs
WebRTC/Phaser directamente. También `npm run build` (strict + Vite) sin errores.

El single-player sigue funcionando exactamente igual: `NetworkSession` todavía
no se importa desde ninguna escena.

### Etapa 4 — UI de conexión + chat (terminada)

Nueva carpeta `src/ui/` con `connectMenu.ts` y `chatPanel.ts`, más los
elementos DOM en `index.html` y estilos en `style.css`. La UI se inicializa
desde `src/main.ts` (`ConnectMenu` + `ChatPanel`), sin afectar al arranque del
juego.

Arquitectura respetada:

```
UI (ConnectMenu + ChatPanel)
    ↓
NetworkSession
    ↓
NetworkTransport
    ↓
WebRTC (RtcPeerTransport)
```

**ConnectMenu** (botón "Crear sala", campo + botón "Unirse", indicador de
estado, código de sala visible, botón "Salir de la sala" y zona de error):
- `createRoom()` / `joinRoom(code)` delegan en `NetworkSession`.
- El código de sala se muestra al crearla para poder compartirlo.
- Estado visible: desconectado / conectando / conectado / desconectado / error.
- Errores mostrados: servidor inaccesible, sala no encontrada/llena, peer
  desconectado, fallo de negociación.
- Cierra la sesión con "Salir de la sala" (sin reconexión automática).
- Acepta un fabricador de sesiones inyectable (`createSession`) para pruebas;
  por defecto crea `NetworkSession` real con la URL de signaling configurable.

**ChatPanel** (lista de mensajes, campo de texto, botón Enviar):
- Envía y recibe solo a través de `NetworkSession` y el tipo
  `PeerMessage`/`chat` ya definido (no hay un segundo formato de mensaje).
- Enter envía; Escape quita el foco del campo y devuelve el foco al juego.
- Máximo 200 caracteres por mensaje (constante `MAX_CHAT_LENGTH` del
  protocolo, aplicada vía `maxlength`).
- Mensajes locales y remotos visualmente distintos por alineación y color
  (clases `chat-msg-local` / `chat-msg-remote`).
- Sin persistencia, sin cuentas, sin moderación, sin multimedia.

**Restricciones cumplidas**: la UI no importa `SignalingClient`,
`RtcPeerTransport`, ni las APIs WebRTC (comprobado estáticamente), y solo
depende de `NetworkSession` + `protocol`. El single-player sigue igual: la red
es opt-in (no se conecta nada al arrancar) y `RoomScene`/`Player` no han sido
modificados.

**Preparada para M07-A/B/C**: al arrancar el signaling (Etapa 1) y el juego, el
mismo flujo (Crear sala en un dispositivo → código → el otro se une) vale para
dos pestañas en la misma máquina, dos dispositivos en LAN o dos redes distintas
(según disponibilidad de STUN/red). M07-C seguirá siendo el criterio de éxito.

Validación en Node (harness temporal con DOM falso y sesión mock; ya
eliminado). 27 comprobaciones PASS: la UI no crea sesión sin interacción
(red opt-in); creación de sala desde la UI (código visible, estado conectado,
chip deshabilitado, Salir visible, chat enlazado); unión desde la UI (estado
conectado, código reflejado); chat bidireccional (host→visitor y
visitor→host); distinción visual local/remoto; límite de 200 caracteres
aplicado y funcional; Enter envía; Escape devuelve el foco al juego; salida del
visitor detectada por el host (aviso y vuelta a desconectado); la UI no importa
WebRTC directamente; y error de sala inexistente mostrado. También
`npm run build` (strict + Vite) sin errores.

### Etapa 5 — Integración de red con el juego + RemotePlayer (terminada)

Nuevos archivos `src/game/entities/RemotePlayer.ts` y `src/game/network/PlayerSync.ts`;
`RoomScene` y `src/main.ts` integran la sesión. Esta es la última etapa de
implementación de M07: a partir de aquí solo quedan las validaciones reales
M07-A/B/C (ver al final de esta sección).

Arquitectura de la integración:

```
RoomScene
 ├── Player              ← jugador local (autoridad local, colisiones M06 intactas)
 ├── RemotePlayer        ← reflejo visual del peer (sin input ni colisiones)
 └── PlayerSync          ← orquesta la sincronización
          ↓
     NetworkSession      (solo consume mensajes tipados y estado)
          ↓
     NetworkTransport
          ↓
     RtcPeerTransport
          ↓
       WebRTC P2P
```

**RemotePlayer** (`src/game/entities/RemotePlayer.ts`):
- Container mínimo con cuerpos sentado/de pie en una paleta azul suave,
  distinta del jugador local. `updateState(x, y, sitting)` fija el destino y el
  estado; `update()` aplica un lerp simple por fotograma
  (`REMOTE_LERP_ALPHA = 0.25`, sin física, sin predicción, sin extrapolación).
- Sin teclado, sin click, sin `CollisionSystem`, sin participación en la
  resolución de movimiento ni en colisiones. No importa nada de la capa de red.
- El `playerId` recibido se verifica en `PlayerSync`; coordenadas no finitas o
  fuera de la habitación se ignoran/recortan al interior (clamp).

**PlayerSync** (`src/game/network/PlayerSync.ts`):
- Identidad: cada cliente genera un `playerId` local estable al iniciar la
  sesión (`player-<aleatorio>`); sin cuentas ni autenticación.
- Envío: a `PLAYER_STATE_INTERVAL_MS = 100` (10 Hz, constante en `config.ts`),
  con un envío inmediato al arrancar. Solo con `session.state === 'connected'`.
  El mensaje usa el `PlayerMessage`/`player_state` ya definido en el protocolo
  (sin formato duplicado): `{ playerId, x, y, sitting }` tomado del Player local.
- Recepción: los mensajes llegan ya tipados y validados por la capa de red; aquí
  se filtra por tipo (solo `player_state`/`player_disconnected`), se ignoran los
  inválidos y se descarta el propio id. El `RemotePlayer` se crea si no existe,
  se actualiza si ya existe y se elimina con `player_disconnected` o al
  detener la sincronización.
- Desconexión/salida: `stop()` corta el envío y destruye todos los `RemotePlayer`
  (el jugador local sigue funcionando igual).
- No conoce WebRTC (solo consume `NetworkSession` + tipos del protocolo) y no
  toca el `CollisionSystem` del jugador local.

**Integración en `RoomScene` y `main.ts`:**
- `RoomScene.setNetworkSession(session | null)`: vincula/desvincula la sesión;
  al pasar `null` (Salir de la sala o perder la conexión) se detiene la
  sincronización y se elimina el remoto. Soporta una sesión recibida antes de
  que el `Player` exista (`pendingSession` aplicada en `create()`).
- `RoomScene.handleNetworkMessage(message)`: reenvía los mensajes P2P a
  `PlayerSync`. `update()` avanza el lerp del remoto.
- `src/main.ts`: el evento de cambio de sesión de `ConnectMenu` enruta a la
  escena (`setNetworkSession`) además del chat; el callback de mensajes invoca
  `handleNetworkMessage` además de `ChatPanel`. El single-player sigue intacto:
  sin sesión no se crea `PlayerSync`, no se envía nada y no hay `RemotePlayer`,
  la red es opt-in.
- La cámara sigue solo al Player local (sin cambios); profundidad mínima
  existente: `RemotePlayer` usa `setDepth(1)` igual que el Player local.

**Colisiones M06 intactas (confirmado):** `CollisionSystem`, `Obstacle`,
`Player.ts` y `Sofa.ts` no se modificaron en esta etapa. El Player local sigue
resolviendo su movimiento y colisiones exactamente igual; el `RemotePlayer` no
participa en colisiones y no hay colisiones entre jugadores. Sin cambios en la
mecánica del sofá M04/M06: `sitting` solo se replica remotamente cuando cambia.

**Restricciones de autoridad cumplidas:** no hay autoridad global; cada cliente
es autoridad de su propio Player, solo se replica el estado remoto, no se envían
comandos de movimiento y ningún cliente corrige la posición del otro. No hay
predicción, rollback, reconciliación ni snapshots.

Validación en Node (harness temporal, ya eliminado). 29 comprobaciones PASS:
dos clientes generan `playerId`s distintos; `start()` envía el estado inmediato
y a 10 Hz; ambos reciben `player_state` y crean un `RemotePlayer` para el otro;
mover el Player local cambia el estado enviado y el `RemotePlayer` del peer se
acerca al destino por lerp; `sitting` se envía y el remoto cambia de cuerpo;
mensajes no relacionados/malformados se ignoran (incluido el propio id);
coordenadas fuera del mundo se recortan; `player_disconnected` elimina el
remoto; `stop()` corta el envío y limpia; sin sesión conectada no se envía nada;
comprobación estática de que `RemotePlayer` y `RoomScene` no mencionan
`RTCPeerConnection`/`RTCDataChannel`/`SignalingClient`/`RtcPeerTransport`/
`WebRTC`, que `RemotePlayer` no importa la capa de red ni input, que la UI sigue
enrutando al chat y que el protocolo `player_state` se reutiliza. También
`npm run build` (TypeScript strict + Vite) sin errores.

**Limitaciones reales de esta etapa (documentadas):**
- Suavizado por lerp de fotograma: suficiente para el PoC, no es interpolación
  de red ni robusto ante latencia.
- Un solo peer remoto máximo (el protocolo admite N peers, la UI empareja 2).
- `player_disconnected` se procesa si llega, pero nadie lo envía hoy: la salida
  se detecta por cierre del canal y la limpieza se hace vía `setNetworkSession`.
- El chat etiqueta ambos extremos como `playerId 'local'` (comportamiento de
  Etapa 4, sin cambios): la distinción visual no depende del id.
- La validación de la negociación se hizo con mocks (sin navegador en el
  entorno); el P2P real se comprueba en M07-A/B/C.

**Pendiente real (M07 NO está aprobado):** quedan las validaciones en entorno
real, que son el criterio del milestone:

- **M07-A** — dos pestañas/navegadores en la misma máquina (localhost).
- **M07-B** — dos dispositivos en la misma LAN (ICE host/mDNS real).
- **M07-C** — dos dispositivos en redes distintas por Internet, con STUN
  público. **Este es el criterio final del PoC.** Si por la red concreta no se
  puede establecer P2P porque exigiría TURN (NAT simétrico, UDP bloqueado), se
  documentará el fallo exacto y esa limitación; no se implementa TURN dentro de
  M07.

Tras la Etapa 5 no se implementarán nuevas funcionalidades de M07 hasta
completar y aprobar esas validaciones.

---

## 20. Corrección de integración M07-A (post-Etapa 5)

Tras la implementación de la Etapa 5, la validación M07-A real (dos pestañas en la
misma máquina) reveló tres bugs de integración que impedían la conexión P2P:

### 20.1 Causa A — Oferta WebRTC perdida antes de que exista el peer

**Síntoma:** El host creaba la sala, el servidor registraba "sala creada:
MT266S", pero la UI nunca mostraba el código y la negociación terminaba en
"negociación agotada (timeout)" a los 15 s.

**Causa raíz:** `RtcPeerTransport.connect()` (rol host) creaba y enviaba el
`offer` **inmediatamente** al crear la sala, pero en ese momento el visitor
todavía no se había unido. El servidor de signaling solo retransmite señales si
existe otro peer (`otherPeer`), así que el `offer` se descartaba silenciosamente.
El host nunca re-enviaba el `offer` al llegar el visitor → el visitor nunca
recibía offer → no respondía answer → canal nunca se abría → timeout.

**Corrección en `src/network/RtcPeerTransport.ts`:**
- El host ya **no** envía el `offer` dentro de `connect()`.
- Se suscribe al evento `peer-joined` del signaling (que ya llega al
  `SignalingClient`).
- Solo al recibir `peer-joined` (y si `negotiationStarted === false`) llama a
  `startHostNegotiation()`, que crea el `DataChannel`, genera el `offer` y
  arranca el timeout de negociación.
- El visitor arranca su timeout al recibir el `offer` (antes era al conectar).
- Guarda contra `peer-joined` duplicados: `negotiationStarted` evita ofertas
  repetidas.
- El timeout de negociación (`NEGOTIATION_TIMEOUT_MS = 15000`) ahora arranca
  **cuando empieza la negociación real**, no mientras el host espera a que alguien
  se una.

### 20.2 Causa B — Botón "Unirse" nunca se habilita al escribir

**Síntoma:** En la segunda pestaña, al introducir el código manualmente, el botón
"Unirse" permanecía deshabilitado.

**Causa raíz:** No existía ningún listener sobre el input del código que
recalculara `joinBtn.disabled`. Ese flag solo se recalculaba dentro de
`setUIState()`, que solo se invocaba por cambios de sesión.

**Corrección en `src/ui/connectMenu.ts`:**
- Añadido listener `input` sobre `room-code-input` que llama a
  `updateJoinButton()`.
- Centralizada la regla en un método privado `updateJoinButton()`:
  `joinBtn.disabled = !(state === 'idle' || state === 'disconnected') || value.trim().length < 6`.
- `setUIState()` y `resetUI()` ahora delegan en ese método. No hay duplicación de
  la lógica.

### 20.3 Causa C — Código de sala no se muestra hasta que el canal se abre

**Síntoma:** "Al pulsar 'Crear sala', el servidor registra correctamente 'sala
creada: MT266S'. Sin embargo, la UI NO muestra el código de sala."

**Causa raíz:** `ConnectMenu.handleCreate()` hacía `await
this.session.createRoom()` y solo entonces pintaba el código. Pero
`NetworkSession.createRoom()` no resuelve hasta que `transport.connect()` abre
el canal de datos (o falla tras 15 s). La sala ya existía en el signaling, pero
la UI esperaba a la negociación P2P completa.

**Corrección en `src/network/NetworkSession.ts` + `src/ui/connectMenu.ts`:**
- Nuevo handler opcional en `SessionHandlers`: `onRoomCreated?(roomCode)`.
- `NetworkSession.createRoom()` y `joinRoom()` invocan
  `handlers.onRoomCreated?.(code)` **inmediatamente después** de que el
  signaling confirma `created`/`joined`, **antes** de `transport.connect()`.
- `ConnectMenu.buildHandlers()` implementa `onRoomCreated`: pinta el código,
  muestra `codeDisplay`, deshabilita `codeInput`.
- La UI muestra el código **mientras la negociación WebRTC está en curso**;
  `createRoom()` mantiene su semántica original (resuelve al abrir el canal).

### Archivos modificados
- `src/network/RtcPeerTransport.ts` — negociación diferida a `peer-joined`, timeout al iniciar negociación, guarda contra ofertas duplicadas.
- `src/network/NetworkSession.ts` — handler `onRoomCreated` disparado tras `created`/`joined`.
- `src/ui/connectMenu.ts` — listener `input` en código, `updateJoinButton()` centralizado, muestra código vía `onRoomCreated`.

### Validación
- `npm run build` (TypeScript strict + Vite): **OK**.
- Comprobaciones estáticas: `src/game/` no importa WebRTC; `RemotePlayer`/`RoomScene` sin `RTCPeerConnection`/`RTCDataChannel`/`SignalingClient`/`RtcPeerTransport`.
- Regresiones: single-player intacto (`Player.ts`, `CollisionSystem.ts`, `Sofa.ts` sin cambios); chat y `PlayerSync`/`RemotePlayer` sin tocar.
- Harness de regresión (Node, WebRTC mock + servidor real): flujo host→visitor con offer tras `peer-joined`, `onRoomCreated` antes de canal, peer-joined duplicado no duplica oferta, host no timeout mientras espera peer — **todas las aserciones pasan**.
- M07-A real (dos pestañas navegador): **no ejecutable en este entorno** (sin navegador). Pasos para validar manualmente: arrancar signaling (`ws://0.0.0.0:8787`), servir juego (`npm run dev`), pestaña A crea sala → código aparece antes de "conectado", pestaña B escribe código → botón "Unirse" se habilita al completar 6 chars → B se une → ambos conectados → movimiento bidireccional + sofá + chat → desconexión limpia.

---

## 21. Estado actual de M07
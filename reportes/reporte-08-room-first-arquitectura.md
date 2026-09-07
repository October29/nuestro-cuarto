# Reporte 08 — Arquitectura Room-first (radiografía y propuesta mínima)

**Estado:** Análisis. Sin cambios funcionales (0 líneas de código de producto).
**Rama:** `milestone-08-room` (creada desde `main` @ `0123ace`).
**Fecha:** 2026-09-07

---

## 0. Resumen ejecutivo

El problema de fondo del modelo actual es:

> **ROOM == CONNECTION** en `signaling/server.mjs`: una sala nace con un
> WebSocket (`create`), vive mientras ese socket vive y **muere cuando
> cualquier socket de la sala se cierra** (`handleClose` borra la sala). La
> sala no tiene identidad propia: es un subproducto de una conexión.

M08-C (`3194db4`, en `milestone-08`) intentó hacer sobrevivir la sala a la
recarga con un "kit de emergencia" (identidad + ventana de gracia + `resume` +
`peer-resumed` + hold de recuperación). Funciona pero **a costa de tratar la
recarga como un accidente**: el estado aún pertenece a la conexión/navegador y
la sala sigue muriendo cuando no hay nadie. Ampliar ese modelo añade más
maquinaria de rescate, no cambia el supuesto de fondo.

Propuesta mínima para la bifurcación Room-first:

1. **El servidor es propietario de las salas.** `Room` = entidad con `id`
   permanente y ciclo de vida propio. La sala existe con 0, 1 o 2 personas.
   Cuando el navegador se va, solo se quita su **presencia**; la sala queda.
2. **El código de sala (¿o pequeño token?) es suficiente para volver.**
   `localStorage` sigue existiendo pero como **libreta de direcciones**
   (nombre → código), nunca como dueño del estado.
3. **WebRTC se mantiene intacto como transporte P2P.** `host`/`visitor` deja de
   ser propiedad de la sala y pasa a ser un detalle de negociación del
   transporte (offerer/answerer), decidido en cada emparejamiento.
4. **Presencia y registro de salas:** server-owned desde el primer paso.
   **Estado de juego (mobiliario, pizarra, posiciones):** se mantiene P2P por
   ahora; su migración a servidor es una fase posterior, no parte de este paso.
5. **El único caso en que una sala desaparece** (de momento) es que **muera el
   proceso del servidor**, nunca porque los navegadores se hayan ido.

---

## 1. Arquitectura actual (estado de `main` @ `0123ace`)

```
ConnectMenu ──▶ NetworkSession ──▶ SignalingClient ──WS──▶ signaling/server.mjs
                     │                  │                        │ rooms: Map
                     │                  │                        │  code ─▶ { sockets[] }
                     └────▶ RtcPeerTransport ──WebRTC/DataChannel (P2P)
                                │
PlayerSync ──▶ RemotePlayer / ChatPanel (mensajes P2P player_state, chat)
RoomScene ──▶ PlayerSync / CollisionSystem
```

`main.ts` → `connectMenu.onSessionChange` → `getRoomScene().setNetworkSession`.
`NetworkSession` se instancia **solo** en `connectMenu.ts:36`. No existe ninguna
persistencia en el cliente (`localStorage` no aparece en `src`).

### Qué está servido hoy (es decir, qué "es" del servidor)

| Dato | Dónde vive hoy | Ciclo de vida |
|---|---|---|
| Código de sala | `rooms` del servidor | Nace en `create`, **muere en cualquier `close`** |
| Sala (entidad) | NO existe: es `{ sockets[] }` | Atado a los sockets |
| Participantes (presencia) | `room.sockets[]` (los sockets, sin identidad) | Igual que la sala |
| Máximo participantes | `MAX_PARTICIPANTS = 2`, servidor | Constante |
| SDP/ICE relay | Sin estado: retransmisión `signal` | Por mensaje |

### Qué vive hoy en el navegador

- `NetworkSession.{status, code, role}` (host/visitor).
- `RtcPeerTransport.{connection, channel, negotiationStarted}`.
- `PlayerSync.localPlayerId` (id **efímero, regenerado en cada carga**).
- `RemotePlayer` (caché del estado del peer), historial de chat en el panel.
- Rol host/visitor: **se decide en el cliente** (create ⇒ host; join ⇒ visitor)
  y es de doble naturaleza: negotiating role (necesario) y de facto
  "poseedor de la sala" (problema).

### Qué solamente existe durante una conexión

- WS de signaling, RTCPeerConnection, RTCDataChannel, `pending` del
  SignalingClient, `openResolve/openReject` del transporte, timer de
  negociación.
- La **presencia** del participante (equivale a "socket presente").

### Flujo completo actual (create → join → leave → reconnect)

1. `create` → servidor: `rooms.set(code, { sockets:[ws] })`. Sala efímera.
2. `join` → añade socket; avisa al host `peer-joined`; el host ofrece (host
   authority). Visitor responde. Canal abierto ⇒ `onOpen`.
3. `close` de **cualquier** socket → servidor envía `peer-left` al otro y
   **borra la sala**. Si es el host el que se va, todo muere.
4. Reconectar = volver a `create` (código nuevo) o `join` del mismo código
   (probablemente "sala no encontrada" porque ya se cerró).

---

## 2. Problema arquitectónico de M08-C

M08-C fue el experimento correcto para un síntoma, pero refuerza el modelo
equivocado:

- **El estado sigue viviendo en la conexión/navegador.** La sala es todavía una
  función de un socket; "no perder la sesión" se resuelve rescatando el slot
  antes de que expire.
- **Nueva maquinaria** para un caso que en Room-first es trivial:
  `participantId`/`playerId` de rescate, `resume`, `peer-resumed`,
  renegociación desde cero, hold de recuperación, ventana de gracia con sweep.
- **El rol host sigue siendo propietario de facto**: el creador "reclama su
  sala" con su identidad (slot locking). Es exactamente la autoridad que el
  modelo deseado pide eliminar.
- **localStorage se convierte en "dueño de la sesión"**, cuando solo debería
  ser memoria de la dirección de la sala.
- **La recarga se trata como emergencia** (¿habrá tiempo de volver antes de que
  expire la gracia?) en lugar de como un caso de uso normal y permanente
  (volver cuando quiero, sin reloj).

Conclusión: M08-C queda como **experimento descartable**. La bifurcación
Room-first debe tomar del checkbox únicamente lo que es bueno en sí mismo
(servidor testeable en proceso, protocolo explícito) y **rescatar nada del
modelo resume**.

---

## 3. Arquitectura propuesta Room-first

```
MiniServer
├── Room ABC123              ← entidad server-owned, id permanente
│   ├── id / createdAt
│   ├── metadata (fase 2: nombre, configuración)
│   ├── roomState (fase 2+): muebles, decoración, pizarra, mundo
│   └── presence  {participanteA "conectado", participanteB "ausente"}

Browser (cliente, sin autoridad sobre la sala)
├── Libreta local "Mis salas"  [nombre → código]   (only pointer)
├── Renderiza estado / captura input / emite interacciones
├── Conexión y transporte (WS + WebRTC P2P)
└── Estado de juego del jugador local (autoridad de su propio Player)
```

**Regla de oro:** el ciclo de vida de `Room` depende del **proceso del
servidor**, nunca de un WebSocket ni de una pestaña. La presencia (quién está
ahora) sí depende de las conexiones; el resto de la sala, no.

### Tres capas de almacenamiento (distinguidas explícitamente)

| Capa | Qué contiene | Dónde vive | Propietario |
|---|---|---|---|
| 1. Estado de la sala | id, presencia, (fase 2+: metadata, mundo, pizarra) | Servidor (memoria; fase 2: disco) | **Servidor** |
| 2. Estado temporal de una conexión | WS, PC, DataChannel, negociación, cache del peer | Cliente en memoria | Cliente/conexión |
| 3. Recordatorio de sala | `ABC123 → Nuestro Cuartito` | `localStorage` | Cliente (solo dirección) |

`localStorage` **nunca** contiene muebles, decoración, posiciones
persistentes, configuración de sala ni pizarra.

### Punto A/B/C de "volver a una sala"

- **Decisión (fase actual): A — el `roomId` es suficiente.**
- B (roomId + token) se reserva para cuando salgamos de la LAN hacia
  Internet (evita que cualquiera con el id entre a salas de terceros).
  Es una evolución natural: añadir un `token` opcional al mensaje `join`.
- C (descubrimiento/scan) queda descartado (fricción ritual, no norma).

La libreta local puede guardar también un "último roomId" para re-entrar con
un clic; sigue siendo capa 3, no fuente de verdad.

---

## 4. Qué es una sala ahora (roomId = 6 caracteres, permanente)

- **Creación:** un solo `create` genera el id y lo registra para siempre (vida
  del proceso). Réplica del mismo `create` de la misma persona **reutiliza** la
  misma sala (idempotente) si la libreta ya la conoce → mejor: la UI ya no
  ofrece "crear de nuevo" para una sala existente; ofrece **entrar**.
- **Capacidad:** sigue `MAX_PARTICIPANTS = 2` (esta fase no lo cambia). La sala
  puede tener 0, 1 o 2 presencias.
- **Creador:** se **guarda como dato informativo** (`createdBy`) pero **no
  otorga derechos**. Si "Nuestro Cuartito" fue creada por A, B puede entrar
  aunque A esté ausente, y nada impide que B entre primero.

## 5. Qué debería ser server-owned desde el primer paso (checklist del usuario)

Sí (esta fase):
- Registro de salas (id estable, existencia independiente de conexiones).
- Presencia por sala (quién está conectado ahora).
- Capacidad/validación de entrada (2 máx), constantes de sala.
- Confirmación explícita de "sala existe / no existe" para que el cliente
  distinga "entrar" de "sala perdida".

No (fases posteriores):
- Muebles, decoración, posiciones persistentes, pizarra, configuración de
  sala, "mundo". Hoy son P2P/cliente y **no se migran en este paso**.

## 6. Qué sigue viviendo en el cliente

- Estado de la conexión y del transporte (WS/PC/DataChannel, negociación).
- Estado del jugador local (autoridad de su propio Player) y caché del peer.
- Chat (historial de la sesión actual), preferencias de UI.
- Libreta "Mis salas" (capa 3) y último roomId.

---

## 7. Cambios mínimos al protocolo

Estado: `src/network/protocol.ts` (cliente↔servidor) actual = `create`, `join`,
`signal` → `created`, `joined`, `peer-joined`, `peer-left`, `error`.

Cambios (mínimo, sin rediseñar SDP/ICE):

| Mensaje | Cambio | Por qué |
|---|---|---|
| `create` | Sin cambio funcional (id permanente; idempotente si la sala ya existe) | Crear una vez |
| `join` | Permite unirse a una sala **vacía**; respuesta incluye info de sala (presencia) | Volver sin que haya nadie |
| `leave` | **Nuevo** (explícito) | Quitar presencia sin matar la sala; equivalente hoy a cerrar socket |
| (cierre de socket) | Server quita presencia, **conserva** la sala | ROOM != CONNECTION |
| `room-info` o respuesta de `join` | (opcional fase 2) nombre/metadata | — |
| `signal` / `peer-joined` / `peer-left` | Sin cambio de formato | Relay P2P igual |

Server→cliente necesario como nuevo: **informar de sala sin peer**
(p. ej. `joined {roomCode}` con presencia actual) para que la UI muestre
"en la sala, esperando a tu amistad" en vez de error cuando nadie está.

No se añade: `resume`, `peer-resumed`, grace, token (fase Internet).

---

## 8. Cómo sería create (target)

1. Cliente (`ConnectMenu` → new `create`): `signaling.createRoom()`.
2. Servidor: genera id estable, registra `Room`, añade presencia del creador.
3. Responde `created {roomCode}`. El cliente guarda `roomCode` en **su
   libreta** (capa 3) y lo muestra.
4. Nadie más está: la UI queda "en la sala, esperando al otro".
5. Cuando la amiga hace `join(roomCode)`, `peer-joined` llega y el P2P se
   negocia (ver §16).

## 9. Cómo sería join (target)

1. `join {roomCode}` (id vacío o con alguien).
2. Servidor: si la sala no existe → error "sala no encontrada"; si hay
   capacidad → añade presencia; responde `joined {roomCode}` + info de
   presencia; avisa a quien ya esté con `peer-joined`.
3. El P2P negocia con quien esté presente. Si nadie había, el que acaba de
   entrar queda esperando (y será el offerer cuando llegue alguien).

## 10. Cómo sería leave (target)

1. `leave` (botón "Salir") o cierre del socket (equivalentes en el servidor).
2. Servidor: quita la presencia, **conserva la sala e id**; si alguien quedaba,
   `peer-left` → el que queda no es expulsado de la sala, solo pierde el peer
   (se queda "en la sala, esperando").
3. Cliente que se va: cierra transporte; NO borra su libreta (la sala sigue
   existiendo y podrá volver).

## 11. Volver tras cerrar/reload (target = flujo normal, no "resume")

1. El navegador carga; la libreta tiene `ABC123` (= "Nuestro Cuartito").
2. Cliente: `connect()` + `join(ABC123)`. **La misma operación del primer
   join.** Sin reloj, sin gracia, sin identidad de rescate, sin renegociación
   especial: si un peer está presente, `peer-joined` y P2P normal; si no,
   esperando.
3. Opcional (fuerte UX): auto-join automático del último roomId activo.

## 12. Qué ocurre si ambos abandonan la sala

- Presencia 0, pero `Room` **sigue registrada** con su id. Es exactamente el
  escenario "todos fuera, cuartito sigue existiendo".

## 13. Qué ocurre si el servidor sigue vivo

- Todo lo anterior es trivial y gratis: cualquiera vuelve por `join(id)`.
- (Fase 2: persistencia en disco del registro para sobrevivir a `node
  server.mjs` reiniciado; el objetivo de "permanente" de verdad.)

## 14. Qué ocurre si el servidor muere

- Se pierden las salas en memoria (todavía sin disco). El cliente al intentar
  `join` recibe "sala no encontrada" y **puede distinguirlo** de "no hay nadie"
  (por eso la capa 1 del servidor responde "no existe"). La sala muere **porque
  murió el servidor**, no porque se fueron los navegadores.
- Fase 2: persistencia en disco; fase futura: otra base de datos, si el
  proyecto lo requiere.

## 15. Cómo encaja WebRTC

- P2P se **mantiene** sin cambios conceptuales: los mensajes de juego/chat
  siguen viajando por RTCDataChannel; el signaling sigue retransmitiendo
  SDP/ICE.
- `host`/`visitor` pasa a ser **puramente de transporte**: alguien tiene que
  hacer de offerer al construir el canal. En Room-first eso se decide **por
  emparejamiento**, no por la sala:
  - Regla mínima recomendada: **el que ya está presente cuando llega el otro
    hace de offerer**; el recién llegado responde. (Equivale al comportamiento
    actual "host espera a peer-joined", pero sin autoridad.)
  - Alternativa: determinista por id de conexión (fase posterior).
- `NetworkTransport`/`RtcPeerTransport` **no cambian su interfaz**
  (`connect/send/close`). El cambio es dónde se decide el rol y que un
  "peer se fue" no desvincule al cliente de la sala.

## 16. Qué hay que cambiar para la fase actual (mínimo imprescindible)

1. **Servidor (`signaling/server.mjs`)**: `Room` como entidad
   (`{id, createdAt, presence[]}`). `create` id estable; `join` en sala vacía;
   `leave` nuevo; `handleClose` quita presencia pero **no borra** la sala;
   notificaciones de presencia igual que hoy (`peer-joined`/`peer-left`).
2. **Protocolo (`src/network/protocol.ts`)**: tipos `leave`, e info de sala en
   `joined`/`created` (p. ej. `presence`). Nada más.
3. **Cliente (`SignalingClient` + `NetworkSession`)**: `leave()`; `join`
   idempotente/repetible; separar estados "en la sala" vs "peer conectado".
4. **Cliente libreta (`new RoomBook`)**: `localStorage` `nuestro-cuarto:rooms`
   `[{name, code}]` + `lastRoom`. Capa 3.
5. **UI (`connectMenu.ts`, `index.html`)**: lista "Mis salas" → botón entrar;
   estado "en la sala, esperando a [peer]" tanto para 0 como para 1 presencia;
   al recibir `peer-left`, **no** salir a menú: quitar solo el peer (hoy
   `onPeerLeft` anula la sesión — cambiar).
6. **Rol**: `SessionRole` pasa de `host/visitor` de sala a oferta emparejamiento
   (offerer/answerer) calculado al conectar el transporte.
7. **Tests**: extender `tests/connectMenu.test.ts` (libreta + rejoin +
   peer-left no expulsa); nuevo test del servidor con helper en proceso
   (patrón del helper WsTestClient ya diseñado para M08, válido aquí):
   create→join→leave→join con el mismo id, sala viva con 0 presencias, etc.
8. **Nada de M08-C**: no se portan `participantId` de rescate, `resume`,
   `peer-resumed`, grace, hold ni SessionPersistence-como-sesión. (La libreta
   es un archivo nuevo pequeño, no la sesión.)

Fuera de esta fase (explicitamente): autenticación, cuentas, TURN, signaling
público/Internet, token de sala, migración del mundo a servidor, editor de
salas, pizarra server-side, permisos, chat nuevo.

---

## 17. Riesgos y decisiones pendientes

1. **Rolling offerer/answerer race**: si dos personas entran "a la vez",
   ¿quién ofrece? (Resuelto para esta fase: presencia determinada por el
   servidor; quien entra cuando ya hay alguien responde. Requiere que el
   servidor notifique `peer-joined` antes/después de `joined` de forma
   coherente → decidir orden).
2. **`peer-left` del cliente**: hoy echa de la sala; en Room-first debe
   mantener "en la sala" y limpiar solo RemotePlayer. Cambia flujo de
   `ConnectMenu.onPeerLeft` y de `RoomScene.setNetworkSession`.
3. **Chapulín de la negociación**: renegociar cuando el peer vuelve es el
   "resume" disfrazado de P2P. En la fase 1 basta con: al volver, `join`
   + negociación nueva del transporte (nada de reutilizar la PC vieja).
4. **`create` vs `join` para volver**: UI debe ofrecer "entrar" (join) sobre
   libreta; "crear" solo la primera vez (`idempotente` en el servidor para
   cubrir el doble click / doble pestaña).
5. **Capacidad 2**: mantener. Al generalizar a más participantes habrá cola /
   rejoin, pero no es necesario ahora.
6. **Creador**: mantener como dato informativo `createdBy` sin privilegios, o
   eliminarlo del protocolo. Decisión menor; recomiendo informativo.
7. **Docs/instrumentación M07-A por limpiar**: decidir cuándo.
8. **Persistencia en disco (fase 2)**: formato JSON simple del registro de
   salas; sin base de datos compleja todavía.

---

## 18. Plan de implementación (pasos pequeños, cada uno verificable)

- **Paso 1 — Servidor Room-first (solo `server.mjs`).**
  Refactor a entidad `Room`; `leave`; `join` en sala vacía; `handleClose`
  quita presencia y conserva sala; presencia en respuestas. Tests del servidor
  (en proceso, patrón helper) cubriendo: create/join/leave/rejoin mismo id;
  sala viva con 0 presencias; id estable entre reconexiones; 2 máx; mensajes
  inválidos. `npm test` + `npm run build` verdes.
- **Paso 2 — Protocolo y cliente de red.** Tipos `leave`/presencia;
  `SignalingClient.leave()`; `NetworkSession` separa "en sala"
  (room membership) de "peer online" (P2P); close() envía leave. Tests de
  NetworkSession con transporte fake contra servidor real.
- **Paso 3 — Libreta local + UI.** `RoomBook` (localStorage, capa 3);
  lista "Mis salas"; entrar por join; estado de espera en 0/1 presencia;
  `peer-left` no expulsa. Tests de ConnectMenu extendidos.
- **Paso 4 — Rol como detalle de transporte.** `SessionRole` →
  offerer/answerer por emparejamiento; revisar `RtcPeerTransport` y tests
  existentes (26/26 se mantienen; ajustes si cambia la inyección de rol).
- **Paso 5 — End-to-end + limpieza.** Verificación manual LAN (dos
  dispositivos): crear→guardar→salir ambos→reabrir→volver sin recrear;
  apagar servidor→"sala no encontrada" distinguible. Actualización del
  reporte con resultados; limpieza opcional de `[M07A-DIAG]`.
- **(Fase 2, NO ahora)** persistencia en disco; metadata/nombre de sala;
  luego mundo/pizarra server-side.
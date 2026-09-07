ARCHITECTURE.md

Nuestro Cuartito

Visión

Nuestro Cuartito es un espacio virtual 2D donde una o varias personas pueden compartir una habitación, café u otros espacios pequeños.

La experiencia busca combinar:

- Exploración 2D.
- Decoración.
- Personajes.
- Interacción con objetos.
- Chat.
- Voz.
- Vídeo.
- Actividades compartidas.
- Una estética acogedora y personal.

La arquitectura debe permitir que estas características aparezcan progresivamente sin obligar al proyecto a implementar todo desde el principio.

---

Estado actual

El proyecto se encuentra en fase de prototipo.

Actualmente existe una habitación web estática implementada con:

- HTML
- CSS
- JavaScript

La habitación contiene elementos visuales como:

- Ventana.
- Luna y estrellas.
- Cuadro.
- Estantería.
- Televisor.
- Sofá.
- Planta.
- Alfombra.
- Controles sociales.

Esta versión sirve como prototipo visual y punto de partida.

---

Dirección prevista

La dirección técnica prevista es:

Navegador
   │
   ▼
Juego 2D
   │
   ├── Renderizado
   ├── Input
   ├── Personaje
   ├── Objetos
   ├── Escenas
   ├── UI
   └── Audio

La tecnología candidata para la capa de juego es:

Phaser
TypeScript
Vite

Esta decisión puede revisarse si las necesidades del proyecto cambian.

---

Evolución prevista

Fase 1: Prototipo

Objetivo:

Convertir la habitación estática en una escena interactiva.

Elementos:

- Escena 2D.
- Personaje controlable.
- Movimiento.
- Colisiones básicas.
- Cámara.
- Objetos interactivos.

---

Fase 2: Mundo pequeño

Añadir:

- Varias habitaciones.
- Transiciones entre espacios.
- Decoración.
- Objetos reutilizables.
- Sistema básico de interacción.

---

Fase 3: Identidad

Añadir:

- Personaje configurable.
- Nombre.
- Apariencia.
- Animaciones.
- Inventario o elementos decorativos.

---

Fase 4: Multijugador

Separar claramente:

Cliente
   │
   │ conexión
   ▼
Servidor
   │
   ├── Usuarios
   ├── Posiciones
   ├── Salas
   └── Estado compartido

El cliente será responsable principalmente de representar el mundo.

El servidor será responsable de la información compartida y del estado que deba sincronizarse.

---

Fase 5: Comunicación

Añadir progresivamente:

- Chat de texto.
- Voz.
- Vídeo.
- Indicadores de presencia.
- Estados de usuario.

Las tecnologías concretas para estas funciones se decidirán cuando lleguemos a esa fase.

---

Fase 6: Actividades compartidas

El televisor u otros objetos podrían permitir:

- Ver contenido juntos.
- Escuchar música.
- Jugar pequeñas actividades.
- Compartir experiencias.

Estas funcionalidades deberán diseñarse teniendo en cuenta sincronización entre usuarios.

---

Principios arquitectónicos

Simplicidad

No construir sistemas complejos antes de necesitarlos.

Modularidad

Las funcionalidades deben poder evolucionar sin obligar a modificar todo el proyecto.

Separación

Mantener separadas las responsabilidades del juego, interfaz, red y servicios externos.

Mobile-first

El proyecto debe considerar desde el principio dispositivos móviles.

Rendimiento

El juego debe poder funcionar razonablemente bien en hardware móvil.

Evolución incremental

Cada etapa debe producir una versión funcional.

---

Estructura futura orientativa

No es obligatorio implementar esta estructura inmediatamente.

src/
├── game/
│   ├── scenes/
│   ├── entities/
│   ├── objects/
│   ├── systems/
│   └── config/
│
├── ui/
│
├── network/
│
├── audio/
│
├── assets/
│
└── main.ts

Esta estructura es una referencia y puede cambiar cuando las necesidades reales del proyecto lo justifiquen.

---

Espacio físico (colisiones)

Cada obstáculo implementa la interfaz `Obstacle` (`getCollisionRect(): Phaser.Geom.Rectangle`).

El `CollisionSystem` almacena esos rectángulos y resuelve cada paso de movimiento
con separación de ejes (X luego Y), conservando la componente libre cuando un
movimiento diagonal choca parcialmente. El límite de la habitación se mantiene
mediante `clampInsideRoom` (no se duplica como cuatro obstáculos).

El collider del Player es configurable y es más pequeño que su dibujo visual, para
que la navegación se sienta cercana y natural.

Este sistema es estático y puramente local: no busca rutas, no calcula
pathfinding, no hay gravedad ni simulación de físicas.

---

Networking (M07 — prueba de concepto P2P)

M07 introduce networking como prueba de concepto: dos navegadores comparten la
misma habitación mediante una conexión P2P (WebRTC `RTCDataChannel`). No es una
arquitectura multiplayer completa.

Capas

Gameplay                (RoomScene + Player + RemotePlayer + HUD)
    │
    ▼
Networking abstraction  (NetworkSession + NetworkTransport)
    │
    ▼
P2P transport           (RtcPeerTransport + SignalingClient)

- `NetworkTransport`: interfaz `connect() / disconnect() / send() /
  onMessage()` y estado de conexión.
- `NetworkSession`: orquesta signaling + transporte, serializa/deserializa
  los mensajes del protocolo y emite eventos tipados al juego
  (playerConnected, playerState, playerDisconnected, chatMessage,
  connectionClosed).
- El juego y la UI consumen `NetworkSession` sin conocer detalles de WebRTC.
  La gestión de signaling, WebRTC, serialización y eventos queda en la capa de
  red.

Modelo host/visitor (sin autoridad)

- Host: crea la habitación e inicia la negociación WebRTC (`createOffer`).
  No es autoridad de ningún estado compartido.
- Visitor: se une con el código de conexión y responde con `answer`.
- Cada cliente es autoridad de su propio Player. Ningún cliente valida ni
  corrige la posición del otro. No hay servidor autoritativo ni reconcilia-
  ción/anti-cheat en M07.

Responsabilidad de la UI

La UI (menú de conexión y chat, en HTML/DOM) se comunica únicamente con
`NetworkSession`: solicitar crear/unirse, mostrar código y estado, enviar y
mostrar texto. No contiene lógica de WebRTC ni conoce `RTCDataChannel`.

Signaling

Servidor Node/WebSocket mínimo en `signaling/` (dependencia única: `ws`).
Solo empareja dos peers por código y retransmite SDP/ICE. No es servidor de
juego ni guarda estado de juego.

Single-player

El modo single-player sigue siendo el flujo por defecto: la escena arranca y
funciona exactamente igual sin conexión. El networking se habilita mediante la
UI de conexión.

Validación

M07 se valida en tres etapas: M07-A (dos pestañas en la misma máquina),
M07-B (dos dispositivos en la misma LAN) y M07-C (dos redes por Internet). El
criterio de éxito real es M07-C. Las redes que requieran TURN se reportan como
limitación de infraestructura; TURN queda fuera de M07.

Esta capa es incremental: en un futuro la Fase 4 (servidor y estado
compartido autoritativo) podrá sustituir o ampliar esta estructura sin acoplar
Phaser al transporte.

---

Regla de arquitectura

La arquitectura debe responder a las necesidades reales del proyecto.

No añadir abstracciones solamente porque parezcan profesionales.

Un sistema pequeño y comprensible es preferible a un sistema sofisticado que todavía no necesitamos.

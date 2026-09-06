CHANGELOG

Todos los cambios importantes del proyecto se documentarán aquí.

El historial detallado de código se encuentra en Git.

---

[Unreleased]

Added

- Documento "AGENTS.md" con las instrucciones para agentes de IA.
- Documento "ARCHITECTURE.md" con la dirección técnica del proyecto.
- Documento "TODO.md" con la planificación inicial.

Changed

- Milestone 06 (colisiones y deslizamiento): se introduce el espacio físico básico del cuarto mediante áreas bloqueantes AABB y resolución local de colisiones, sin pathfinding.
  - Nuevo `Obstacle` (interfaz): cualquier objeto que defina un `getCollisionRect(): Phaser.Geom.Rectangle` puede bloquear el paso del Player.
  - Nuevo `CollisionSystem`: almacena rectángulos bloqueantes; resuelve un paso de movimiento con separación de ejes (X primero, luego Y) conservando la componente libre (deslizamiento por borde). Cuando la dirección cardinal queda completamente bloqueada, el deslizamiento lateral elige el lado del obstáculo con menor distancia local desde la posición actual del collider (incluye el tamaño del collider para quedar fuera del AABB); en empate conserva el desempate determinista previo (derecha/+X para primaria vertical, abajo/+Y para primaria horizontal), y si el lado preferido está ocupado prueba el contrario. Esto solo aplica al movimiento por teclado (`slideOnBlock`), no al de clic.
  - `CollisionSystem.findSafePosition`: ajuste local (máx. 8 pasos en línea recta hacia la posición anterior) para que el punto de salida nunca coloque al Player dentro de un obstáculo; determinista, coste O(1) constante, no es pathfinding.
  - Config: `PLAYER_COLLIDER_HALF_WIDTH=10`, `PLAYER_COLLIDER_HALF_HEIGHT=14` (más pequeño que el dibujo visual para navegación natural); `SOFA_BLOCK_HALF_WIDTH=60`, `SOFA_BLOCK_HALF_HEIGHT=30`, `SOFA_EXIT_GAP=40` (espacio físico del sofá y hueco de salida).
  - `Sofa` implementa `Obstacle`: `getCollisionRect()` devuelve el área física (120×60, ligeramente mayor que el asiento visual para cubrir la zona trasera). El punto de salida ahora usa el bloque físico + gap (y ≈ 640, con margen de 26 px sobre el borde inferior del bloque).
  - `Player` recibe `CollisionSystem` en el constructor; `moveByKeyboard` y `moveTowardTarget` rutas el paso de movimiento por `resolveStep`.
  - `Player.update` acepta `seatExitPoint`: cuando el jugador está sentado y recibe un movimiento, se levanta primero en el punto de salida validado y después se mueve. Si el exitPoint proporcionado por `Interactable.getExitPoint()` está bloqueado, `findSafePosition` lo ajusta hacia la posición anterior sin teletransportar dentro de un obstáculo.
  - `Player.standUpAt` valida la posición contra el sistema de colisiones y limpia el destino de clic (el jugador no camina solo tras levantarse).
  - Las paredes/límites de la habitación siguen resolviéndose mediante `clampInsideRoom` (no se duplican como 4 obstáculos).
  - `InteractionSystem.getSeatedExitPoint` expone el punto de salida del interactuable en el que el jugador está sentado.
  - En `RoomScene`, `player.update` recibe el `seatExitPoint` del sistema de interacción. Se crea `CollisionSystem` y se registra el obstáculo del sofá.
  - Mantenimiento de profundidad mínima: `player.setDepth(1)` (encima del sofá, debajo del HUD), `promptText.setDepth(10)` (encima de todo).
- Milestone 05 (movimiento e interacción por click): el jugador puede moverse hasta la posición del suelo que se toca con el ratón/pantalla, y la interacción también puede ejecutarse pulsando sobre la indicación que se muestra en pantalla.
  - `Player.moveToPoint(x, y)`: nueva API del Player para fijar un destino de movimiento.
  - En `Player.update()`, si hay entrada de teclado (WASD/flechas) se cancela el destino por click y manda el teclado; si no hay teclado y existe un destino, el Player camina hacia él con la misma `PLAYER_SPEED` y se detiene al llegar.
  - `InteractionSystem.performInteract()`: la lógica de interacción se unifica en un único método, compartido por la tecla `E` y por el click sobre la indicación (se elimina la duplicación que había en el flujo de `E`).
  - `InteractionSystem.tryInteractFromPointer(pointer)`: resuelve si el click cae dentro de la indicación visible y, en tal caso, ejecuta la interacción (mismo comportamiento que `E`).
  - En `RoomScene`, el evento `pointerdown` se enruta: primero prueba la interacción por click sobre la indicación y, si no aplica, convierte las coordenadas de pantalla a mundo con `cameras.main.getWorldPoint()` y fija `player.moveToPoint()`.
  - No se implementaron colisiones, pathfinding ni controles táctiles (quedan fuera del alcance del milestone).
- Milestone 04 (interacción): corrección arquitectónica de los contratos de interacción.
  - Nuevo contrato `InteractionActor` (`setSitting`) que desacopla `Sofa` de `Player`.
  - `Interactable.onInteract(actor)` ahora depende de `InteractionActor` (elimina el cast en `Sofa`).
  - El estado sitting/standing pasa a ser responsabilidad exclusiva de `Player`; `InteractionSystem` ya no controla el levantamiento al detectar movimiento.
- Milestone 04 (interacción): levantarse con `E` y punto de salida.
  - Nuevo contrato `Interactable.getExitPoint()` para que cada interactuable defina su propia posición de salida.
  - `Player.standUpAt(x, y)`: se mueve a la posición indicada y restaura el estado de pie.
  - `InteractionSystem` recuerda el interactuable sobre el que el Player está sentado y, al pulsar `E` estando sentado, lo levanta en el punto de salida.
  - `Sofa` sigue dependiendo solo de los contratos generales (no de `Player`); no se implementaron colisiones ni movimiento por click (M05/M06 quedan fuera).

Planned

- Transformar el prototipo estático en una escena 2D interactiva.
- Introducir un personaje controlable.
- Evaluar e implementar Phaser + TypeScript + Vite.
- Crear sistemas básicos de interacción y colisiones.

---

[0.1.0] - Initial Prototype

Added

- Primera habitación de Nuestro Cuartito.
- Ventana.
- Luna y estrellas.
- Cuadro.
- Estantería.
- Televisor.
- Sofá.
- Planta.
- Alfombra.
- Controles visuales.
- JavaScript inicial.
- Configuración inicial de npm.

Technical

- HTML.
- CSS.
- JavaScript.
- Proyecto ejecutable mediante servidor HTTP local.

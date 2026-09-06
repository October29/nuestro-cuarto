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

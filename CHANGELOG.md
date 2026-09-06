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

- Milestone 04 (interacción): corrección arquitectónica de los contratos de interacción.
  - Nuevo contrato `InteractionActor` (`setSitting`) que desacopla `Sofa` de `Player`.
  - `Interactable.onInteract(actor)` ahora depende de `InteractionActor` (elimina el cast en `Sofa`).
  - El estado sitting/standing pasa a ser responsabilidad exclusiva de `Player`; `InteractionSystem` ya no controla el levantamiento al detectar movimiento.

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

# Reporte 04: Sistema básico de interacción + primer objeto interactuable

Fecha: 2026-09-06

## 1. Qué se implementó

Primera base modular de interacción del proyecto usando un **sillón** como objeto de prueba. El sistema está diseñado para ser general: el sillón es solo el primer objeto que lo utiliza, y eliminar el sillón de `RoomScene` no rompe nada.

- Se creó una abstracción base `Interactable` (interfaz) independiente de cualquier mueble concreto.
- Se creó el **Sillón** como entidad propia que define su acción ("Sentarse") y su comportamiento.
- Se creó un **Sistema de Interacción** (proximidad + tecla `E` + selección del objetivo más cercano + indicador visual).
- El jugador ya distingue los estados **`standing`** y **`sitting`**, y su placeholder cambia visualmente al sentarse.
- El jugador puede levantarse de nuevo moviéndose (WASD o flechas).

## 2. Arquitectura utilizada

La escena solo orquesta; cada responsabilidad vive en su propio módulo:

```
src/game/
├── config.ts                  → constantes del mundo y del radio de interacción
├── entities/Player.ts         → jugador con estados standing/sitting (no conoce al sillón)
├── objects/InteractionActor.ts → contrato de capacidades que un objeto necesita del actor
├── objects/Interactable.ts    → interfaz base general de objetos interactuables
├── objects/Sofa.ts            → primer objeto interactuable (implementa Interactable)
├── systems/InteractionSystem.ts → detección de proximidad, selección y tecla E
└── scenes/RoomScene.ts        → crea el jugador, el sillón y conecta el sistema
```

Relación conceptual:

```
InteractionActor      (capacidad: setSitting)
      ↑
     Player

Interactable          (contrato general de un objeto interactuable)
      ↑
     Sofa
```

Reglas de acoplamiento cumplidas:

- `Player` **no** conoce al `Sofa`.
- `Sofa` **no** conoce a `Player`: depende solo del contrato `InteractionActor`.
- `InteractionSystem` **no** contiene lógica del sillón (trabaja con la interfaz `Interactable`) **ni** controla el estado interno del Player.
- `RoomScene` **no** sabe cómo funciona internamente el sillón ni contiene lógica de `sitting`; solo crea las piezas, registra interactuables y conecta.
- No hay condiciones del tipo `if (playerNearSofa) { ... }`. El sistema funciona con cero, uno o muchos objetos interactuables.
- No se crearon `Furniture`, `Chair`, `Bed`, `Table`, etc. Las únicas abstracciones son `Interactable` e `InteractionActor`.

## 3. Archivos creados

- `src/game/objects/InteractionActor.ts` — contrato mínimo de las capacidades que un objeto interactuable necesita del actor: `setSitting(sitting: boolean): void`.
- `src/game/objects/Interactable.ts` — interfaz con `getGameObject()`, `getPosition()`, `getActionLabel()` y `onInteract(actor: InteractionActor)`.
- `src/game/objects/Sofa.ts` — entidad que implementa `Interactable`. Dibuja un sillón con shapes de Phaser (respaldo, asiento y brazos) y define la acción "Sentarse". Al interactuar, solicita al actor que se siente mediante `actor.setSitting(true)`, sin depender de la clase `Player`.
- `src/game/systems/InteractionSystem.ts` — sistema de interacción:
  - registra objeto `Interactable` (`addInteractable`);
  - detecta el objetivo más cercano por proximidad;
  - escucha la tecla `E` (`Phaser.Input.Keyboard.KeyCodes.E`);
  - muestra/oculta la indicación `[E] <acción>`;
  - al pulsar `E` invoca `onInteract` del objetivo, pasándole al actor.
  - **No** recibe información de movimiento ni cambia el estado sitting/standing del Player.

## 4. Archivos modificados

- `src/game/entities/Player.ts` — implementa `InteractionActor`; nuevo estado interno `sitting`; métodos `setSitting()` e `isSitting()`; cuerpo sentado distinto; y `clampInsideRoom()` ajustado según posición sentado/de pie. Es el responsable de levantarse al detectar movimiento estando sentado.
- `src/game/config.ts` — se añadió `INTERACTION_RADIUS = 80` (radio de interacción configurable en un solo sitio).
- `src/game/scenes/RoomScene.ts` — crea el `Sofa`, instancia el `InteractionSystem`, lo registra y conecta las piezas. Ya **no** calcula una señal `isMoving` para levantar al Player.

## 4a. Corrección arquitectónica (revisión posterior)

Tras una revisión arquitectónica de la primera versión de Milestone 04 se detectaron dos problemas y se corrigieron:

**Problema 1 — contrato de `Interactable` incorrecto.** `Interactable.onInteract` recibía un `Phaser.GameObjects.Container` genérico, y `Sofa` lo convertía con `player as unknown as { setSitting(...) }` para ocultar el contrato. Esto hacía que el objeto interactuable dependiera de una suposición no declarada (`duck-typing` con un cast).

*Solución:* se creó el contrato `InteractionActor` con `setSitting(sitting: boolean): void`. `Interactable.onInteract(actor: InteractionActor)` y `Sofa` ahora dependen únicamente de esa capacidad. El cast `as unknown as` se eliminó. `Player` implementa `InteractionActor`, de modo que `RoomScene`/`InteractionSystem` pueden pasarlo a `onInteract` sin casts ni dependencias de la clase concreta.

- **Qué responsabilidad tiene `InteractionActor`:** declara las capacidades que un objeto interactuable necesita del actor, de forma mínima y explícita. Hoy solo expone `setSitting`, pero puede crecer (p. ej. `playAnimation`, `teleport`) sin que `Sofa` dependa de `Player`.
- **Por qué `Sofa` ya no depende de `Player`:** cumple `Interactable` y solo invoca `actor.setSitting(true)`. No importa ni conoce la clase `Player`; depende únicamente del contrato `InteractionActor`.

**Problema 2 — `InteractionSystem` controlaba el estado sitting/standing.** `InteractionSystem.update()` recibía una señal `isMoving` de `RoomScene` y, si el Player estaba sentado, llamaba a `setSitting(false)` para levantarlo. Eso violaba la responsabilidad del estado del Player.

*Solución:* se eliminó esa responsabilidad. `InteractionSystem.update()` ya no recibe ni `delta` ni `isMoving` y no toca el estado del Player. El flujo ahora es:

```
input de movimiento
        ↓
Player
        ↓
si está sentado → se levanta (setSitting(false))
        ↓
movimiento normal
```

- **Por qué el estado sitting/standing pertenece a `Player`:** el Player es el dueño de su propio movimiento y su propio estado. En `Player.update()`, si está sentado y recibe entrada de movimiento, se levanta (`setSitting(false)`, que reconstruye el visual de pie) y el movimiento continúa en esa misma actualización; si está sentado y no hay movimiento, no se desplaza.
- **Qué cambió en `InteractionSystem`:** eliminó el bloque de `sitting`, `isMoving`, `delta`, la lectura de estado del Player (`playerObj`) y el método `clearTarget()` (que solo se usaba desde ese bloque). Ahora solo hace detección por proximidad, actualiza el prompt y ejecuta la interacción con la tecla `E`.
- **Qué cambió en `RoomScene`:** dejó de calcular `isMoving` y dejó de pasarlo a `InteractionSystem`; ahora llama a `interactionSystem.update()` y `player.update(delta, input)` por separado.

Además, `Interactable.getGameObject()` pasó a devolver `Phaser.GameObjects.Container` (en lugar de `GameObject`), lo que permite leer `displayWidth`/`displayHeight` sin el cast intermedio `as unknown as { displayWidth: number }` en `detectNearest()`.

## 5. Cómo se detecta el objeto más cercano

Cada frame, `InteractionSystem.update()` ejecuta `detectNearest()`:

1. Toma la posición del jugador (`px`, `py`).
2. Para cada `Interactable`, calcula el **punto del bounding box del objeto más cercano al jugador**:
   - `cx = clamp(px, x - ancho/2, x + ancho/2)`
   - `cy = clamp(py, y - alto/2, y + alto/2)`
3. Calcula la distancia entre el jugador y ese punto con `Phaser.Math.Distance.Between`.
4. Si la distancia es **menor que `INTERACTION_RADIUS`** **y** menor que la mejor distancia encontrada, ese objeto pasa a ser el candidato.

El resultado es determinista: con varios objetos dentro del radio se elige siempre el más cercano a la cámara del jugador (distancia a la caja más próxima, no al centro). La comparación es `< INTERACTION_RADIUS`, así que en el borde exacto no se selecciona nada. Con cero objetos no hay objetivo y no ocurre nada.

## 6. Cómo funciona la interacción

1. El jugador se mueve con WASD/flechas (sin cambios respecto al milestone anterior).
2. Si hay un objetivo cercano, se muestra la indicación.
3. Al pulsar `E`, `InteractionSystem` detecta `Phaser.Input.Keyboard.JustDown(interactKey)` y llama a `currentTarget.onInteract(this.player)`.
4. En el sillón, `onInteract(actor)` llama a `actor.setSitting(true)` (el `actor` es el `Player`, que implementa `InteractionActor`).
5. El jugador queda sentado: no se desplaza mientras no haya movimiento.
6. `InteractionSystem` no interviene en el estado: simplemente sigue mostrando la indicación mientras haya un objetivo dentro del radio (pulsar `E` estando ya sentado es un no-op porque `setSitting(true)` está protegido por `if (this.sitting === sitting) return`).

## 7. Cómo funciona el estado standing/sitting

- `Player` mantiene un booleano privado `sitting` (sin un sistema enorme de estados) y es el único responsable de ese estado.
- `standing`: el jugador se mueve, `update()` aplica velocidad + normalización diagonal + límites de habitación.
- `sitting` sin movimiento: `update()` retorna de inmediato (no se desplaza).
- `sitting` con movimiento: `update()` detecta la entrada, llama a `setSitting(false)` (reconstruye el visual de pie) y continúa con el movimiento en esa misma actualización.
- El `sittingHalfWidth`/`sittingHalfHeight` son ligeramente distintos para que el clamp de límites siga siendo correcto en ambos estados.

## 8. Cómo se representa visualmente el estado

- De pie: cabeza + cuerpo (placeholder original del milestone 03).
- Sentado: la cabeza baja (de `y = -14` a `y = -6`) y el cuerpo se vuelve más corto y compacto (`34` → `22` de alto, un poco más ancho), sugiriendo a una persona sentada. Usa el mismo patrón de shapes de Phaser, sin animaciones ni arte definitivo.
- `setSitting()` elimina las piezas anteriores (`removeAll(true)`) y reconstruye el cuerpo correspondiente; es un cambio de forma/posición sencillo, como pedía el milestone.

## 9. Cómo se muestra/oculta la indicación

- Al construirse, `InteractionSystem` crea un `Phaser.GameObjects.Text` anclado a la pantalla (`setScrollFactor(0)`) en `(400, 560)` del viewport (parte inferior).
- `updatePrompt()` se ejecuta cada frame:
  - si hay objetivo → `setText('[E] ' + getActionLabel())` y `setVisible(true)`;
  - si no hay objetivo → `setVisible(false)`.
- La indicación se actualiza automáticamente con la acción del objeto actual y desaparece en cuanto el jugador sale del radio, sin depender del estado sitting/standing del Player.

## 10. Qué pruebas se ejecutaron

- `npm run build` completado: **TypeScript sin errores** (`tsc` estricto) y build de Vite correcto (11 módulos transformados). El warning de >500 kB por incluir Phaser es el habitual y no es nuevo.
- Revisión estática confirmando que no quedan casts `as unknown` relacionados con `Player`, `Sofa` o `Interactable`; que `InteractionSystem` ya no recibe `isMoving`; que `RoomScene` ya no calcula una señal de movimiento para levantar al Player; y que `Player` levanta por sí mismo al recibir movimiento estando sentado.
- `npm run dev`: el servidor de desarrollo arranca correctamente (comprobado en la primera versión del Milestone 04).
- Prueba de lógica de `detectNearest()` reimplementada y ejecutada en Node (2 objetos, radios y distancias reales):
  - en la posición de aparición del jugador no hay objetivo (distancia 95 px > radio 80);
  - acercándose por delante detecta el sillón correcto;
  - con dos objetos dentro del radio selecciona siempre el más cercano;
  - lejos de todo no hay objetivo;
  - en el borde exacto del radio no selecciona nada (comparación estricta con `<`).

## 11. Qué quedó pendiente

- Verificación visual en Android/escritorio (no se ha comprobado en navegador real desde CLI). Todo lo anterior es compilación + revisión de arquitectura; la experiencia visual (aparición de la indicación, sentarse y levantarse) debe confirmarse a mano.
- No se marcan tareas de `TODO.md` como completadas ("Crear sistema básico de interacción", "Convertir algunos elementos de la habitación en objetos interactivos", "Interfaz de interacción", "Indicador de objeto interactivo") hasta la verificación visual.
- El jugador se "sienta en su sitio actual" al pulsar `E`, no se ancla aún a la posición del sillón (snapping opcional futuro).
- No se muestra resaltado del objeto objetivo (solo el texto `[E] Sentarse`); se puede añadir en una iteración posterior.
- La indicación de interacción está fija en pantalla; en móvil habrá que reposicionarla (controles táctiles y UI quedan para más adelante).
- Como efecto de la corrección, mientras el jugador está sentado junto al sillón la indicación `[E] Sentarse` sigue mostrándose (el sistema funciona por proximidad y no controla el estado del Player). Pulsar `E` en ese caso es un no-op. Validar en la revisión visual si este comportamiento es el deseado.

## 12. Cómo verificarlo visualmente en Android

1. En Termux, ejecuta `npm run dev` (si accedes desde el móvil: `npm run dev -- --host 0.0.0.0`).
2. Abre en el navegador del móvil/escritorio la URL del servidor (p. ej. `http://localhost:5173` o `http://<ip-del-terminal>:5173`).
3. Deberías ver la habitación nocturna con el sillón (marrón, al centro de la habitación) y al personaje más abajo, cerca de la alfombra.
4. Comprueba:
   - Al aparecer, el jugador está lejos del sillón y **no** hay indicación.
   - Acércate caminando al sillón: cuando estés a menos de 80 px aparece el texto **`[E] Sentarse`**.
   - Aléjate: la indicación desaparece.
   - Pulsa `E` cerca del sillón: el jugador cambia a la pose sentada (cabeza baja, cuerpo compacto).
   - Pulsa cualquier dirección (WASD o flechas): el jugador vuelve a la pose de pie y se mueve en esa dirección en el mismo instante.
   - El movimiento y los límites de la habitación siguen funcionando igual que en el milestone 03.
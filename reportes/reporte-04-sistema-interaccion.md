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
├── objects/Interactable.ts    → interfaz base general de objetos interactuables
├── objects/Sofa.ts            → primer objeto interactuable (implementa Interactable)
├── systems/InteractionSystem.ts → detección de proximidad, selección y tecla E
└── scenes/RoomScene.ts        → crea el jugador, el sillón y conecta el sistema
```

Relación conceptual:

```
Interactable        (interfaz general, sin lógica de muebles)
    ↑
   Sofa              (define su propia acción y comportamiento)
```

Reglas de acoplamiento cumplidas:

- `Player` **no** conoce al `Sofa`.
- `InteractionSystem` **no** contiene lógica del sillón: trabaja solo con la interfaz `Interactable`.
- `RoomScene` **no** sabe cómo funciona internamente el sillón; solo lo registra en el sistema.
- No hay condiciones del tipo `if (playerNearSofa) { ... }`. El sistema funciona con cero, uno o muchos objetos interactuables.
- No se crearon `Furniture`, `Chair`, `Bed`, `Table`, etc. La interfaz `Interactable` es la única abstracción.

## 3. Archivos creados

- `src/game/objects/Interactable.ts` — interfaz con `getGameObject()`, `getPosition()`, `getActionLabel()` y `onInteract(player)`.
- `src/game/objects/Sofa.ts` — entidad que implementa `Interactable`. Dibuja un sillón con shapes de Phaser (respaldo, asiento y brazos) y define la acción "Sentarse". Al interactuar, pone al jugador en estado sentado mediante duck-typing (`setSitting`), sin depender de la clase `Player`.
- `src/game/systems/InteractionSystem.ts` — sistema de interacción:
  - registra objectos `Interactable` (`addInteractable`);
  - detecta el objetivo más cercano por proximidad;
  - escucha la tecla `E` (`Phaser.Input.Keyboard.KeyCodes.E`);
  - muestra/oculta la indicación `[E] <acción>`;
  - al pulsar `E` invoca `onInteract` del objetivo.

## 4. Archivos modificados

- `src/game/entities/Player.ts` — nuevo estado interno `sitting`, métodos `setSitting()`, `isSitting()`, cuerpo sentado distinto (cabeza más baja y cuerpo más corto/compacto), y `clampInsideRoom()` ajustado según posición sentado/de pie.
- `src/game/config.ts` — se añadió `INTERACTION_RADIUS = 80` (radio de interacción configurable en un solo sitio).
- `src/game/scenes/RoomScene.ts` — crea el `Sofa`, instancia el `InteractionSystem`, lo registra y aporta la señal `isMoving` al sistema cada frame.

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
3. Al pulsar `E`, `InteractionSystem` detecta `Phaser.Input.Keyboard.JustDown(interactKey)` y llama a `currentTarget.onInteract(player)`.
4. En el sillón, `onInteract` llama a `player.setSitting(true)`.
5. El jugador queda sentado: no puede moverse, la indicación desaparece y no se re-dispara la interacción mientras esté sentado.
6. Cuando el jugador pulsa cualquier dirección (movimiento), el sistema detecta `isMoving`, llama a `player.setSitting(false)` y el jugador vuelve al estado de pie. El siguiente frame el movimiento normal ya se aplica.

## 7. Cómo funciona el estado standing/sitting

- `Player` mantiene un booleano privado `sitting` (sin un sistema enorme de estados).
- `standing`: el jugador se mueve, `update()` aplica velocidad + normalización diagonal + límites de habitación.
- `sitting`: `update()` retorna de inmediato (no se puede mover mientras está sentado). El sistema de interacción se encarga de levantarlo en cuanto detecta movimiento.
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
- Mientras el jugador está sentado se oculta la indicación (`clearTarget()`), además de `updatePrompt()`.
- El texto siempre está desactivado salvo cuando existe un objetivo válido; se actualiza automáticamente con la acción del objeto actual.

## 10. Qué pruebas se ejecutaron

- `npm run build` completado: **TypeScript sin errores** (`tsc` estricto) y build de Vite correcto (11 módulos transformados). El warning de >500 kB por incluir Phaser es el habitual y no es nuevo.
- `npm run dev` (puerto 5199): el servidor de desarrollo arranca y responde `HTTP 200` en `/`, en `src/game/objects/Sofa.ts` y en `src/game/systems/InteractionSystem.ts` (módulos transformados correctamente por Vite).
- Prueba de lógica de `detectNearest()` reimplementada y ejecutada en Node (2 objetos, radios y distancias reales):
  - en la posición de aparición del jugador no hay objetivo (distancia 95 px > radio 80);
  - acercándose por delante detecta el sillón correcto;
  - con dos objetos dentro del radio selecciona siempre el más cercano;
  - lejos de todo no hay objetivo;
  - en el borde exacto del radio no selecciona nada (comparación estricta con `<`).

## 11. Qué quedó pendiente

- Verificación visual en Android/escritorio (no se ha comprobado en navegador real desde CLI). Todo lo anterior es compilación + lógica; la experiencia visual (aparición de la indicación, sentarse y levantarse) debe confirmarse a mano.
- No se marcan tareas de `TODO.md` como completadas ("Crear sistema básico de interacción", "Convertir algunos elementos de la habitación en objetos interactivos", "Interfaz de interacción", "Indicador de objeto interactivo") hasta la verificación visual.
- El jugador se "sienta en su sitio actual" al pulsar `E`, no se ancla aún a la posición del sillón (snapping opcional futuro).
- No se muestra resaltado del objeto objetivo (solo el texto `[E] Sentarse`); se puede añadir en una iteración posterior.
- La indicación de interacción está fija en pantalla; en móvil habrá que reposicionarla (controles táctiles y UI quedan para más adelante).

## 12. Cómo verificarlo visualmente en Android

1. En Termux, ejecuta `npm run dev` (si accedes desde el móvil: `npm run dev -- --host 0.0.0.0`).
2. Abre en el navegador del móvil/escritorio la URL del servidor (p. ej. `http://localhost:5173` o `http://<ip-del-terminal>:5173`).
3. Deberías ver la habitación nocturna con el sillón (marrón, al centro de la habitación) y al personaje más abajo, cerca de la alfombra.
4. Comprueba:
   - Al aparecer, el jugador está lejos del sillón y **no** hay indicación.
   - Acércate caminando al sillón: cuando estés a menos de 80 px aparece el texto **`[E] Sentarse`**.
   - Aléjate: la indicación desaparece.
   - Pulsa `E` cerca del sillón: el jugador cambia a la pose sentada (cabeza baja, cuerpo compacto) y la indicación se oculta.
   - Pulsa cualquier dirección (WASD o flechas): el jugador vuelve a la pose de pie y se puede mover con normalidad.
   - El movimiento y los límites de la habitación siguen funcionando igual que en el milestone 03.
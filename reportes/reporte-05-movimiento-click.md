# Reporte 05: Movimiento por click + interacción por click sobre la indicación

Fecha: 2026-09-06

## 1. Qué se implementó

Dos mejoras de control sobre la base del Milestone 04, sin cambiar el comportamiento existente:

1. **Movimiento por click**: al hacer clic (o toque) sobre cualquier punto del suelo, el jugador camina hasta ese punto de forma suave (delta-time) y se detiene al llegar.
2. **Interacción por click**: si la indicación `[E] <acción>` está visible, pulsar sobre ella ejecuta exactamente la misma interacción que la tecla `E` (sentarse, levantarse, etc.). Pulsar sobre el objeto **no** activa la interacción por sí mismo.

Todo el sistema previo (WASD/flechas, movimiento diagonal, límites de habitación, cámara, proximidad, estado sentado, punto de salida) se conserva intacto.

## 2. Controles finales (teclado + ratón)

| Entrada | Efecto |
| --- | --- |
| WASD / flechas | Movimiento clásico (cancela cualquier destino por click) |
| Click en el suelo | El jugador camina hasta ese punto y se detiene |
| `E` | Interacción actual (sentarse, levantarse) |
| Click sobre la indicación `[E] <acción>` | Misma interacción que `E` |

Si estando sentado se pulsa `E` o se hace click sobre la indicación, el jugador se levanta en el punto de salida (igual que antes del milestone 05). Pulsar una dirección también le levanta, como ya hacía el Milestone 04.

## 3. Arquitectura utilizada

No se introdujo ninguna dependencia nueva ni sistema complejo. La lógica se repartió según las responsabilidades ya existentes:

```
src/game/
├── entities/Player.ts         → destino por click (moveToPoint) y caminar hacia él
├── systems/InteractionSystem.ts → performInteract() unificado + hit-test de la indicación
└── scenes/RoomScene.ts        → enrutado del pointerdown (indicación o suelo)
```

Relación conceptual del flujo de entrada:

```
pointerdown
    ↓ (RoomScene)
    ├─ InteractionSystem.tryInteractFromPointer(pointer)
    │      └─ ¿click dentro de la indicación visible? → performInteract()  [se consume]
    │
    └─ cameras.main.getWorldPoint(pointer.x, pointer.y)
           └─ Player.moveToPoint(worldX, worldY) → camina en update()
```

Decisiones de responsabilidad:

- **`RoomScene`** decide **qué** se hace con un click (interacción o movimiento), pero no sabe **cómo** se interacciona ni **cómo** se camina: delega en `InteractionSystem` y en `Player`.
- **`InteractionSystem`** sabe si un click cae sobre la indicación y ejecuta la interacción; la tecla `E` y el click comparten el mismo `performInteract()`, así que no existe lógica duplicada.
- **`Player`** es el único dueño de su movimiento: guarda un destino opcional (`moveToTarget`) y lo alcanza con la misma `PLAYER_SPEED` y el mismo estilo de movimiento del teclado.
- El **teclado tiene prioridad**: en `Player.update()`, si hay entrada de teclado se descarta el destino por click y el movimiento sale por `moveByKeyboard()`; en caso contrario, si existe destino, se camina hacia él.

## 4. Archivos modificados

- `src/game/entities/Player.ts`:
  - Nuevo campo `moveToTarget: { x: number; y: number } | null` (destino opcional).
  - Nuevo método público `moveToPoint(x: number, y: number)`: fija el destino. (No se usó el nombre `moveTo` porque `Phaser.GameObjects.Container` ya define un `moveTo` propio del sistema de transformaciones; se evitó el choque de firma.)
  - Nuevo método privado `moveTowardTarget(delta)`: avanza en línea recta hacia el destino con paso `(speed * delta) / 1000`, y al llegar (`dist <= step`) se coloca exactamente en el destino y borra `moveToTarget`.
  - Se extrajo el movimiento por teclado a `moveByKeyboard(delta, input)` (sin cambio de comportamiento) para mantener `update()` limpio.
  - En `update()`: `if (hasMovement) { moveToTarget = null; moveByKeyboard(...) } else if (moveToTarget) { moveTowardTarget(delta) }`. La prioridad del teclado y el comportamiento sentado (retorno temprano, levantarse con movimiento) no cambian.
- `src/game/systems/InteractionSystem.ts`:
  - Nuevo método privado `performInteract()`: contiene **todo** el flujo previo de la tecla `E` (levantarse si está sentado con `seatedInteractable.getExitPoint()` + `player.standUpAt()`; en caso contrario `currentTarget.onInteract(player)` y registrar `seatedInteractable` si pasa a sentado).
  - `update()` ahora simplemente detecta `JustDown(interactKey)` y llama a `performInteract()`.
  - Nuevo método `tryInteractFromPointer(pointer): boolean`: si `promptText.visible` y el click cae dentro de `promptText.getBounds()` (`Phaser.Geom.Rectangle.Contains`), ejecuta `performInteract()` y devuelve `true`; si no, devuelve `false`.
- `src/game/scenes/RoomScene.ts`:
  - Nuevo manejador de `pointerdown`: primero `tryInteractFromPointer(pointer)`; si consume el evento, no se hace nada más. Si no, convierte pantalla→mundo con `this.cameras.main.getWorldPoint(pointer.x, pointer.y)` y llama a `player.moveToPoint(world.x, world.y)`.
  - No se tocó la creación del resto de la escena (jugador, sillón, suelo, cámara, carpetas).

## 5. Conversión pantalla → mundo

El click del ratón llega en coordenadas de **pantalla** (espacio de resolución del juego, tras el escalado `FIT`). El mundo de la habitación tiene su propio sistema de coordenadas y la cámara puede estar desplazada (sigue al jugador). Por eso **no** se asumió `screenX === worldX`:

```
pointer.x, pointer.y  (pantalla)
        ↓  this.cameras.main.getWorldPoint(x, y)
world.x, world.y      (mundo de la habitación)
        ↓  player.moveToPoint(world.x, world.y)
```

`getWorldPoint` aplica la transformación inversa de la cámara (scroll + zoom), así que el destino es correcto aunque la cámara se haya movido. Es la API estándar de Phaser 4 (`Camera.getWorldPoint(x, y, output?)`, verificada en los tipos del proyecto en `node_modules/phaser/types/phaser.d.ts`).

## 6. Comportamiento del movimiento por click

- Se reutiliza `PLAYER_SPEED` y el mismo cálculo de paso `(speed * delta) / 1000` que el teclado; la velocidad percibida es idéntica.
- Se camina en línea recta hacia el punto; el destino de la habitación se limita después con `clampInsideRoom()`, igual que con el teclado.
- Al llegar (cuando la distancia restante es menor o igual que el paso de ese frame) el jugador se sitúa **exactamente** en el destino y el destino se limpia; no tiene inercia ni vuelve a moverse solo.
- Un click nuevo reemplaza el destino anterior; si el jugador está quieto en el destino y se hace click sobre el mismo punto, no ocurre nada (target ya null → la rama no entra).
- Si se pulsa una tecla de dirección, el destino por click se cancela y el teclado toma el control desde ese mismo frame.

## 7. Comportamiento de la interacción por click

- Solo se activa cuando la indicación está **visible** (el jugador está dentro del `INTERACTION_RADIUS` del objetivo).
- El hit-test usa `promptText.getBounds()` + `Phaser.Geom.Rectangle.Contains(bounds, x, y)`; los bounds del texto están en el mismo espacio de pantalla que `pointer.x/y`.
- Click sobre la indicación estando **de pie** → se ejecuta la interacción actual (`onInteract`), p. ej. sentarse en el sillón.
- Click sobre la indicación estando **sentado** → se levanta en el punto de salida (mismo camino que `E`).
- Click sobre el **objeto** en sí (fuera del rectángulo de la indicación) → no interactúa; se interpreta como click de movimiento (el jugador camina hacia ese punto del mundo).

## 8. Por qué `moveToPoint` y no `moveTo`

`Phaser.GameObjects.Container` ya expone un método `moveTo<T>(child, index)` del sistema de transformación de contenedores. Definir un `moveTo(x, y)` propio en `Player` chocaba con la firma de la clase base (error `TS2416` detectado en la primera compilación). Se renombró a `moveToPoint(x, y)` para mantener la intención (un punto de destino del jugador) sin colisionar con la API de Phaser.

## 9. Qué NO se implementó (explícitamente fuera de alcance)

- **No** colisiones, hitboxes, física ni obstáculos (ese es el próximo milestone según la planificación).
- **No** pathfinding ni navegación.
- **No** movimiento táctil de joystick ni UI táctil (los toques de pantalla sí funcionan como "click" gracias a Phaser, pero el sistema de controles táctiles específico es de otro milestone).
- **No** profundidad / z-sorting (queda para el mundo).
- **No** interacción automática al hacer click directamente sobre el objeto (solo la indicación dispara interacción, como pide el milestone).

## 10. Qué pruebas se ejecutaron

- `npm run build` completado: **TypeScript sin errores** (`tsc` estricto) y build de Vite correcto (11 módulos transformados). El warning de >500 kB por incluir Phaser es el habitual y no es nuevo.
- Simulación en Node de la lógica de movimiento desacoplada de Phaser:
  - destino en línea recta: llegada exacta al punto en 44 frames (0,73 s para 190 px, coherente con `PLAYER_SPEED = 260` px/s);
  - interrupción con teclado mid-movimiento: el destino se limpia y el teclado toma el control.
- Comprobación estática de la documentación/contratos: no se tocaron `Interactable`, `InteractionActor` ni `Sofa`; la API pública de interacción del Milestone 04 se conserva.

## 11. Qué quedó pendiente

- Verificación visual en navegador real (Android/escritorio): mover por click, cancelar con teclado, click sobre la indicación para sentarse y levantarse, y que click sobre el objeto no interactúe. No se ha podido comprobar desde CLI.
- No se marcan las tareas nuevas de `TODO.md` ("Movimiento por click a una posición del suelo", "Interacción por click sobre la indicación") ni las pendientes del Milestone 04 como completadas hasta la verificación visual.
- El movimiento por click camina en línea recta hacia el punto; como no hay colisiones ni obstáculos todavía, eso es suficiente.

## 12. Cómo verificarlo visualmente en Android

1. En Termux: `npm run dev -- --host 0.0.0.0` y abre la URL desde el móvil/escritorio.
2. Comprueba:
   - **Click en el suelo**: haz clic (o toca) en una zona vacía de la habitación → el jugador camina hasta allí y se detiene justo en el punto.
   - **Reasignar destino**: haz click en otro lugar antes de llegar → el jugador cambia de rumbo hacia el nuevo punto.
   - **Cancelar con teclado**: empieza un click-move y a mitad de camino pulsa una dirección → el jugador responde al teclado inmediatamente.
   - **Cámara y click**: aléjate de la esquina superior, haz click cerca del borde de la pantalla con la cámara desplazada → el destino respeta el mundo, no la pantalla.
   - **Click en la indicación**: acércate al sillón y, cuando aparezca `[E] Sentarse`, haz click **sobre el texto** → el jugador se sienta. Haz click sobre el texto de nuevo → se levanta delante del sillón.
   - **Click sobre el objeto**: haz click sobre el sillón **fuera** del texto de la indicación → el jugador camina hacia ese punto (no se sienta).
   - **Límites de la habitación**: haz click fuera de los bordes del mundo → el jugador se detiene en el límite (igual que con teclado).
   - El resto de controles (WASD, flechas, sentarse/levantarse con `E`, límites) debe seguir igual que en el Milestone 04.
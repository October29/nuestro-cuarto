# Reporte 03: Primer personaje jugable

Fecha: 2026-09-06

## 1. Qué se implementó

La escena `room` ya no es solo un fondo: ahora contiene un primer personaje controlable por el usuario.

- El personaje se representa con un placeholder gráfico sencillo (cabeza + cuerpo dibujados con shapes de Phaser), diseñado dentro de una entidad propia y fácil de sustituir después por un sprite real.
- Se mueve con `WASD` y con las teclas de dirección (flechas).
- El movimiento usa delta time, por lo que la velocidad es independiente de los FPS.
- La velocidad es configurable desde `src/game/config.ts`.
- El personaje se mantiene dentro de los límites de la habitación.
- La cámara sigue al personaje de forma suave.
- La habitación se amplió de 800×600 a 1200×800 para que el seguimiento de cámara sea observable (la habitación sigue siendo pequeña, pero es más grande que el viewport).

## 2. Archivos creados

- `src/game/entities/Player.ts` — nueva entidad `Player` (extiende `Phaser.GameObjects.Container`) con:
  - `buildBody()`: crea el placeholder visual (cabeza y cuerpo).
  - `update(delta, input)`: movimiento con delta time y límites.
  - `clampInsideRoom()`: mantiene al personaje dentro de la habitación.
  - Interfaz `PlayerInput` exportada (estado booleano de las 4 direcciones).

## 3. Archivos modificados

- `src/game/config.ts` — se añadieron las constantes:
  - `ROOM_WIDTH = 1200` y `ROOM_HEIGHT = 800` (tamaño del mundo/habitación).
  - `PLAYER_SPEED = 260` (píxeles por segundo, configurable).
- `src/game/scenes/RoomScene.ts` — se adaptó al nuevo tamaño del mundo y se conectó: input (`createCursorKeys` + WASD), creación del `Player`, límites de cámara y `startFollow`.

## 4. Archivos intactos

- `index.html`, `style.css`, `app.js`, `assets/`, `src/main.ts` y toda la documentación no se tocaron. No se necesitó ningún cambio de HTML/CSS para este avance.

## 5. Decisiones técnicas

1. **Lógica del jugador separada de la escena**: el `Player` vive en `src/game/entities/Player.ts`, siguiendo la estructura orientativa de ARCHITECTURE.md (§ `entities/`). La escena solo se encarga de crear el input, instanciar el personaje y orquestar la cámara.
2. **`Container` como entidad**: el personaje es un `Phaser.GameObjects.Container`. Esto permite agrupar varias piezas visuales hoy (cabeza + cuerpo) y sustituirlas luego por un sprite/atlas sin tocar la lógica de movimiento.
3. **Movimiento manual con delta time**: no se usó Arcade Physics todavía (evita colisiones/física avanzada). Se calcula velocidad normalizada (las diagonales no son más rápidas) y se multiplica por `velocidad × delta/1000`.
4. **Config centralizada**: los valores del mundo (1200×800) y la velocidad (260 px/s) viven en `config.ts`, de modo que solo hay que cambiar un sitio para ajustarlos.
5. **Input agnóstico**: la escena compone las flechas + WASD en un `PlayerInput` booleano y `Player` no conoce las teclas concretas, lo que facilita añadir después controles táctiles sin tocar la entidad.
6. **Cámara con seguimiento suave**: `startFollow(player, true, 0.1, 0.1)` con límites fijados al tamaño de la habitación.

## 6. Cómo funciona el movimiento

1. En cada frame, `RoomScene.update()` llama a `Player.update(delta, input)`.
2. `delta` es el tiempo entre frames en milisegundos (lo entrega Phaser), por eso la velocidad no depende de los FPS.
3. Se calcula la dirección deseada con valores `-1/0/+1` en X e Y.
4. Si se mueve en diagonal, se normaliza por `1/√2` para que no aumente la velocidad.
5. El desplazamiento por frame es `dirección × velocidad × delta / 1000`.
6. Después se ajusta el resultado con `Phaser.Math.Clamp` para que el personaje no salga de `[0, ROOM_WIDTH] × [0, ROOM_HEIGHT]`.

## 7. Qué pruebas se ejecutaron

- `npm run build`: typecheck de TypeScript sin errores y build de Vite correcto (9 módulos transformados). El warning de tamaño del bundle (>500 kB) es el habitual por incluir Phaser y no es un problema nuevo.
- `npm run dev`: el servidor de desarrollo arranca correctamente.
- HTTP 200 desde el servidor de desarrollo para `/`, `/src/game/entities/Player.ts`, `/src/game/scenes/RoomScene.ts` y `/src/game/config.ts`.
- Inspección del módulo `Player.ts` transformado por Vite: se confirma que el código servido incluye la normalización diagonal, el uso de delta time, el clamp y la construcción del cuerpo.

## 8. Verificación visual en Android

Verificación realizada por el usuario en Android (2026-09-06). Resultado correcto:

- El personaje es visible y controlable.
- WASD funciona.
- Las flechas funcionan.
- Las diagonales funcionan correctamente.
- El personaje no sale de los límites de la habitación.
- El movimiento no se queda pegado.
- La cámara sigue correctamente al personaje.
- El movimiento se percibe estable.

Observaciones dejadas para iteraciones posteriores (no corregidas en esta milestone a propósito):

- El personaje puede desplazarse sobre la zona visual de la pared además del suelo; falta definir las zonas transitables y el sistema de colisiones del escenario.
- El personaje se percibe algo pequeño y la velocidad de 260 px/s puede sentirse algo lenta; son ajustes visuales/de gameplay para una iteración posterior.

## 9. Qué quedó pendiente

- Definir zonas transitables y un sistema de colisiones del escenario (actualmente el personaje puede cruzar visualmente la pared; no se corrige en esta milestone a propósito).
- Ajustar el tamaño del personaje y la velocidad de movimiento (260 px/s se percibe algo lenta) en una iteración posterior.
- TODO.md: se marcaron como completadas únicamente las tareas verificadas en esta milestone ("Crear el primer personaje", "Añadir movimiento del personaje", "Añadir cámara", "Crear límites de la habitación"). Las tareas de colisiones, sprites, animaciones y controles táctiles siguen pendientes.
- Sustituir el placeholder por un sprite/animaciones (fase "Personaje" del TODO).
- Añadir controles táctiles (futuro planeado, no implementado).

## 10. Cómo verificarlo visualmente en Android

1. En Termux, ejecuta `npm run dev` (si no tienes ya el servidor corriendo con `--host`, úsalo para acceder desde el móvil).
2. Abre en el navegador del móvil/escritorio la URL del servidor (p. ej. `http://localhost:5173` o `http://<ip-del-terminal>:5173` con `--host 0.0.0.0`).
3. Deberías ver la habitación nocturna con luna en la ventana y al personaje encima de la alfombra.
4. Comprueba:
   - `W/A/S/D` y flechas mueven al personaje.
   - En las esquinas, la cámara "se desplaza" siguiendo al personaje (revela que la habitación es más ancha que la pantalla).
   - El personaje nunca sale por los bordes de la habitación.
   - El movimiento se siente suave e independiente de la velocidad de refresco.
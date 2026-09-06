# Reporte 06: Colisiones y deslizamiento sobre obstáculos

Fecha: 2026-09-06

## 1. Resumen de implementación

M06 introduce el espacio físico básico del cuarto: el Player ya no puede atravesar los objetos. Se crearon un par de abstracciones nuevas (Interfaz `Obstacle`, `CollisionSystem`) y se integraron con el sistema existente de movimiento por teclado y por clic, con deslizamiento por borde y validación del punto de salida al levantarse.

No se implementó pathfinding. No se agregaron dependencias. Las paredes siguen siendo el `clampInsideRoom` preexistente.

## 2. Arquitectura utilizada

```
src/game/
├── config.ts                     → constantes de mundo + collider + bloque + exit gap
├── physics/
│   ├── Obstacle.ts               → interfaz: getCollisionRect(): Rectangle
│   └── CollisionSystem.ts        → resolución de colisiones AABB (resolveStep, findSafePosition)
├── entities/Player.ts            → movement via resolveStep; standUpAt valida posición
├── objects/Interactable.ts       → contrato (sin cambios)
├── objects/InteractionActor.ts   → contrato (sin cambios)
├── objects/Sofa.ts               → implementa Interactable + Obstacle; su área física
├── systems/InteractionSystem.ts  → expone getSeatedExitPoint; prompt depth=10
└── scenes/RoomScene.ts           → crea CollisionSystem, registra obstáculo, pas seatExitPoint
```

Responsabilidades (sin cambios en el espíritu de M04–M05):

- **`Obstacle`** solo declara la forma colisionable.
- **`CollisionSystem`** solo resuelve pasos de movimiento contra rectángulos; no conoce al Player, al sofá, a la interacción ni al estado.
- **`Sofa`** define su área física independiente de su dibujo y de su área de interacción.
- **`Player`** es el dueño de su movimiento y su estado; consulta al `CollisionSystem` en cada paso.
- **`InteractionSystem`** solo interacciona con el mundo; el punto de salida proviene de `Interactable.getExitPoint()`; la validación la hace `Player.standUpAt`.
- **`RoomScene`** orquesta: crea el sistema, registra obstáculos, pasa datos (exitPoint) a Player. No contiene lógica de colisión.

## 3. Áreas bloqueantes

Cada obstáculo implementa la interfaz `Obstacle` con `getCollisionRect(): Phaser.Geom.Rectangle`, devolviendo un rectángulo AABB en coordenadas del mundo.

`CollisionSystem` almacena estos rectángulos. Al no existir dinámica (obstáculos estáticos), los registros se capturan una sola vez.

El sofá es el primer obstáculo. Su área física (`120 × 60`) es ligeramente mayor que el asiento visual para cubrir la zona trasera (respaldo). Centro: `(600, 570)`, rango x `[540, 660]`, rango y `[540, 600]`.

## 4. Collider del Player

El collider del Player es un rectángulo centrado en `(player.x, player.y)` con semianchos configurables en `config.ts`:

- **De pie**: `10 × 14` (vs visual `14 × 26`). El collider representa los pies, no toda la figura: permite navegar pegándose a los obstáculos sin que la cabeza se perciba atravesándolos.
- **Sentado**: se mantiene `10 × 14` (ya no hay movimiento durante el estado sentado, así que el tamaño es irrelevante; se conserva para consistencia con la validación de salida).

La habitación se mantiene con `clampInsideRoom` usando las dimensiones visuales (`standingHalfWidth=14`, `standingHalfHeight=26`): el borde de la cámara no es un obstáculo AABB sino un límite explícito, más sencillo que representar cuatro paredes y duplicar la lógica de límite.

## 5. Resolución de colisiones

`CollisionSystem.resolveStep(x, y, dx, dy, halfW, halfH, slideOnBlock)`:

1. Prueba X: si `(x + dx, y)` está libre → aplica `x = x + dx`.
2. Prueba Y: si `(nx, y + dy)` está libre → aplica `y = y + dy` (usa `nx` para corregir diagonalmente).

Resultado natural: un movimiento diagonal conserva la componente que está libre y se desliza por el borde. Cuando ambos están bloqueados (esquina, cardinal perfecto sin componente lateral), se detiene.

Con `slideOnBlock` (teclado), si la dirección cardinal queda completamente bloqueada (primaria bloqueada + 0 componente perpendicular), se desliza un paso determinista por el borde: **hacia +X si la primaria es vertical, hacia +Y si la primaria es horizontal**. El desplazamiento de deslizamiento es la misma magnitud que el paso (`Math.max(|dx|, |dy|)`). Se re-evalúa cada frame: cuando la primaria se desbloquea al pasar la esquina, se retoma la dirección original.

Con `slideOnBlock = false` (clic), no hay desplazamiento por desempate: se conservan solo las componentes libres. Si ambos ejes quedan bloqueados, se descarta el destino.

### Por qué el collider es más pequeño que el dibujo

El collider representa los pies/centro de la caja del suelo (10 × 14). El dibujo se extiende más arriba (cabeza) y hacia los lados (brazos, hombros). Usar el tamaño visual completo produciría colisiones percibidas como exageradas: el jugador no podría acercarse al sofá si su cabeza invisible choca con el respaldo. Un collider más pequeño (pies) produce una navegación cercana y natural.

## 6. Deslizamiento por borde (slide)

El deslizamiento por borde es una de las partes centrales de M06.

Ejemplo concreto de lo que ocurre manteniendo ↑ debajo del sofá:

```
            ░░░░░░░░░░░░░░
            ░░  SOFÁ       ░░
            ░░░░░░░░░░░░░░
       ┌──────────────────────
       │ (Player aprieta ↑, golpea el borde inferior)
       │ ↑
       └──────────────────────
                           └───────────→
                           (se desliza a la derecha por el borde,
                            deterministamente +X, hasta pasar la
                            esquina derecha)
                                   │
                                   │ (después de pasar la esquina,
                                   │  el ↑ vuelve a ser libre)
                                   ↓
```

El Player mantiene la intención ↑. El desplazamiento lateral (+X) es consecuencia local de la geometría del obstáculo, no de una ruta calculada.

### Comportamiento diagonal

Un movimiento diagonal ∗ que alcanza un borde conserva la componente libre. Si Y está bloqueada, X sigue aplicándose, produciendo deslizamiento natural a lo largo del borde sin necesitar la lógica de desempate.

### Deslizamiento por clic (sin desempate)

El movimiento por clic usa `slideOnBlock=false`: conserva la componente libre (component conservation), pero no busca desplazamiento lateral adicional. Si un paso queda completamente bloqueado, se descarta el destino y el Player se detiene.

## 7. Criterio de desempate

Cuando la dirección cardinal queda bloqueada sin componente perpendicular:

- **Primaria vertical (↑ o ↓)**: deslizamiento hacia **+X** (derecha).
- **Primaria horizontal (← o →)**: deslizamiento hacia **+Y** (abajo).

Es un criterio fijo, determinista, O(1), sin aleatoriedad ni búsqueda. No se prueban ambos lados; el lado se decide por la regla y se aplica si está libre. Si el lado de desempate también está bloqueado, el Player se detiene (no hay exploración de alternativas).

La elección de **derecha** y **abajo** como lados fijos coincide con la convención de los ejes positivos del mundo de juego (→ +X, ↓ +Y), y produce traces de navegación predecibles alrededor de muebles.

## 8. Integración con movimiento por teclado

`moveByKeyboard` calcula `(vx, vy)` normalizado diagonal, multiplica por `step`, llama a `resolveStep(..., true)`. El deslizamiento por desempate está habilitado. Si se presiona una tecla mientras el Player está sentado, la escena pasa el exitPoint, el Player se levanta en una posición válida y la tecla sigue activa → el mismo frame se aplica el movimiento desde la posición de salida.

**Prioridad del teclado sobre clic**: se mantiene. Si `hasMovement` es true, se limpia `moveToTarget`.

## 9. Integración con movimiento por clic

`moveTowardTarget` calcula la dirección hacia el destino, normaliza y llama a `resolveStep(..., false)`. Si el paso completo queda bloqueado (ambos ejes cero), se cancela `moveToTarget`. Si el destino está a menos de un paso y se bloquea, también se cancela. El Player se detiene sin auto-ruta.

## 10. Integración con Sofa / getExitPoint()

El punto de salida ahora se calcula desde el **bloque físico**, no desde la altura visual:

```ts
exitPoint.y = sofa.y + SOFA_BLOCK_HALF_HEIGHT + SOFA_EXIT_GAP
            = 570 + 30 + 40 = 640
```

El bloque termina en y=600; el Player de pie en 640 tiene su borde inferior (640+14=654) 54 px por debajo del bloque → holgadamente fuera del área física. 

**Al pulsar E estando sentado**: `InteractionSystem.performInteract()` llama a `player.standUpAt(exit.x, exit.y)`. `standUpAt` valida contra `CollisionSystem.findSafePosition`, que mueve en línea recta hacia la posición sentada si hay una colisión (safety net, no pathfinding).

**Al pulsar una dirección estando sentado**: la escena pasa `seatExitPoint` a `player.update`, que ejecuta `standUpAt(exit)` y después la misma frame aplica el movimiento con colisiones. El resultado es que el jugador sale del sofá en la posición válida y comienza a caminar/deslizarse en la dirección solicitada.

**ExitPoint bloqueado**: `findSafePosition` prueba pasos en línea recta hacia la posición sentada (la posición anterior al levantarse, garantizada libre porque el Player estaba ahí). Con un máximo de 8 pasos determinista, converge a la posición sentada como fallback. Nunca teletransporta dentro de un obstáculo.

## 11. Qué NO es pathfinding

El deslizamiento por borde es una resolución **local** e **inmediata** de una colisión en curso: "¿qué componente de este paso todavía puedo aplicar?" No existe:

- Búsqueda de caminos
- A* / BFS / Dijkstra
- Grafos de navegación
- Navmeshes
- Waypoints
- Cálculo de rutas
- Predicción de movimiento
- Búsqueda de esquinas
- Evaluación de alternativas
- Evitación de obstáculos con lookahead

Cada paso se evalúa de forma aislada (posición actual + paso deseado). No hay memoria de pasos anteriores ni proyección de pasos futuros.

## 12. Qué quedó fuera de M06

- Pathfinding, navegación automática, A*, BFS, navmesh.
- Gravedad, masa, aceleración, rebotes, fuerzas, impulsos, física real.
- Contacto entre múltiples objetos (colisión solo Player ↔ obstáculo; no entre obstáculos).
- Movimiento táctil, joystick, controles táctiles.
- Animaciones, sprites, arte definitivo.
- Sistema completo de depth sorting por Y (pendiente para un milestone futuro; M06 solo ajusta profundidades mínimas para que el Player esté encima del sofá).
- Otras habitaciones, puertas, transiciones.
- Chat, voz, vídeo, multijugador.

## 13. Pruebas realizadas

### Compilación

`npm run build` completado correctamente: TypeScript sin errores (`tsc` estricto), build de Vite correcto (12 módulos transformados). El warning de >500 kB es el habitual por incluir Phaser.

### Simulación Node (lógica desacoplada de Phaser)

Se reimplementó el algoritmo `resolveStep` y `isBlocked` en un script Node con los datos reales del sofá (bloque `[540,660]×[540,600]`, collider 10×14, paso 4.33 px/frame) y se ejecutaron los siguientes escenarios:

**A — Mantener ↑ debajo del sofá:**
El Player llega flush contra el borde inferior (y ≈ 615), luego se desliza a la derecha (+X) mientras ↑ sigue bloqueado verticalmente, hasta pasar la esquina derecha (x ≈ 673), donde ↑ vuelve a ser libre y el Player continúa subiendo. Comportamiento exacto del §8.

**B — Mantener ← contra el lado derecho:**
El Player golpea la pared del sofá desde la derecha, se desliza hacia abajo (+Y, desempate) hasta limpiar el borde inferior (y ≈ 614), y continua moviéndose a la izquierda debajo del sofá. Trace-around completo.

**C — Mantener ↓ desde arriba:**
El Player golpea el borde superior, se desliza a la derecha (+X) hasta pasar la esquina superior derecha, y continúa descendiendo. Trace-around completo.

**D — Diagonal ↗ hacia la esquina superior derecha:**
La componente Y bloqueada al golpear el borde inferior; la componente X libre se conserva (deslizamiento natural por la geometría, sin desempate). Llega a un punto superior-derecha del cuarto. Component conservation funciona correctamente.

**E — Clic directamente hacia arriba detrás del sofá (target 600→300):**
El Player se detiene al golpear la pared inferior (y ≈ 615) en 8 frames. El destino se cancela. No hay envoltura ni auto-ruta. Comportamiento correcto: detención local ante obstáculo.

**F — Clic diagonal ↗ hacia un destino detrás del sofá (target 720, 350 desde 520, 660):**
El Player se desliza a lo largo del borde inferior hacia la derecha (component conservation), cruza la esquina, y llega al destino en 154 frames. Esto es resolución local reactiva (el vector de movimiento apunta siempre al destino; cuando Y está bloqueado, X se aplica), no pathfinding. Comportamiento documentado.

**G — Punto de salida bloqueado por otro obstáculo ficticio:**
`findSafePosition(600,640, from=(600,614))` → converge a la posición sentada (600,614) tras los 8 pasos, porque el obstáculo ficticio bloquea el exitPoint y todos los puntos intermedios. Nunca se teletransporta al obstáculo.

**H — Punto de salida dentro del bloque del sofá (centro):**
`findSafePosition(600,570, from=(600,614))` → converge a la posición sentada (600,614) porque el centro del sofá (570) está bloqueado por el propio obstáculo del sofá.

### Dev server

`npm run dev --port 5199` ejecutado: Vite responde HTTP 200, entrega `index.html` y módulos TypeScript correctamente. El servidor de desarrollo funciona sin errores.

### Verificación visual pendiente

Las pruebas visuales en navegador real (Android/escritorio) quedan pendientes: deslizamiento continuo, comportamiento de cámara, interacción E/click tras colisión, etc. Las tareas de `TODO.md` no se marcan completadas hasta esa verificación.

## 14. Pendientes conocidos

- Verificación visual completa en Android/escritorio.
- Depth sorting por Y para que el Personaje se renderice correctamente detrás y delante de muebles según su posición vertical: en M06 se hizo un ajuste mínimo (`player.setDepth(1)`, `promptText.setDepth(10)`) para que el jugador esté encima del sofá, pero no se implementa un sistema completo de ordenación por profundidad.
- Anclaje del Player al sofá al sentarse (snapping a una posición relativa al sillón en lugar de quedarse donde estaba): es un comportamiento futuro, no M06.
- Cambio del texto del prompt durante el estado sentado (p. ej. `[E] Levantarse`): documentado como pendiente en M04.
- Obstáculos estáticos vs dinámicos: el `CollisionSystem` actual solo maneja estáticos; si en el futuro se necesita mutabilidad (objetos que se mueven o aparecen/desaparecen), será un incremento natural.
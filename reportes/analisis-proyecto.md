# Análisis del proyecto Nuestro Cuartito

Fecha: 2026-09-06

## 1. Qué existe actualmente

- **Documentación**: `AGENTS.md`, `ARCHITECTURE.md`, `TODO.md`, `CHANGELOG.md` (bien desarrolladas: visión, fases, reglas).
- **Aplicación prototipo** (`index.html`, `style.css`, `app.js`): una habitación 2D estática dibujada en CSS + emojis.
- **`package.json`**: solo tiene `typescript` como devDependency (instalado en `node_modules`). No hay framework ni bundler. No hay scripts útiles (`test` es un placeholder que falla).
- **`assets/`**: carpetas vacías (`images`, `sounds`, `ui`) — preparadas pero sin contenido.
- **Git**: 2 commits, rama `main`, tree limpio. `.gitignore` ya contempla `node_modules/`, `dist/`, `.vite/`.

## 2. Qué hace actualmente la aplicación

- Renderiza una habitación estática con: ventana, luna/estrellas, cuadro, estantería, televisor, sofá, planta y alfombra, más una barra de controles sociales (micrófono, cámara, pantalla, chat) — **solo visual, sin funcionalidad**.
- `app.js` define 5 objetos interactivos; al hacer *hover* con el ratón muestra un mensaje contextual y al hacer click solo hace `console.log`. **No hay personaje ni movimiento**.

## 3. Qué es solo prototipo

**Todo** es prototipo:
- Los objetos se dibujan con emojis y divs posicionados en CSS (no hay sprites ni motores reales).
- La "interacción" (hover + mensaje) es decorativa; el `click` no hace nada útil.
- Los botones de control social son meros placeholders sin eventos.
- `assets/` están vacíos; no hay audio, imágenes ni UI reales.
- No hay build system, no hay bundler, no hay servidor de dev configurado, no hay pruebas.

## 4. Arquitectura actual

No hay una arquitectura de juego. Es una **página web estática monocapa**:
- `index.html` = estructura (DOM)
- `style.css` = renderizado (CSS absoluto + emojis)
- `app.js` = lógica mínima (eventos del DOM directamente acoplados al HTML)
- Todo acoplado en un solo documento/archivo; renderizado, estado, input e interacción mezclados.
- La documentación describe una arquitectura objetivo (Phaser + TS + Vite, estructura `src/`) pero aún **no implementada**.

## 5. Arquitectura propuesta (transición a juego 2D)

Recomiendo una migración **incremental**, respetando AGENTS.md (no migrar sin tarea que lo justifique). El paso 1 jugable es esa tarea que sí la justifica:

**Capas (según separación de ARCHITECTURE.md §5):**
- **Capa de juego (Phaser)**: escenas, entidades/personaje, objetos, física/colisiones, cámara.
- **Capa de UI**: overlay HTML/CSS encima del canvas (menú, mensajes, controles táctiles).
- **Capa de estado**: separar estado del juego de la entrada y el renderizado.
- **Capa de entrada**: teclado/ratón ahora, táctil después.
- **Capa de red/social/audio**: pospuesta a fases posteriores (no construir antes de necesitarlas).

La transición clave: el **canvas de Phaser reemplaza al `main.room` de CSS** como mundo. La estructura `src/` de ARCHITECTURE.md (scenes, entities, objects, systems, config) es una buena referencia, empezando pequeño.

## 6. Pasos concretos para la primera implementación jugable

1. **Configurar el toolchain**: inicializar Vite + TypeScript + Phaser (proyecto base).
2. **Crear una escena mínima** que cargue y muestre un fondo de habitación.
3. **Añadir el personaje** controlable (sprite, incluso un placeholder simple).
4. **Añadir movimiento** por teclado (flechas/WASD) y cámara que siga al personaje.
5. **Añadir límites y colisiones básicas** (muros de la habitación).
6. **Convertir algunos objetos** del prototipo (televisor, sofá, planta) en objetos interactivos con hitbox.
7. **Sistema básico de interacción**: tecla cerca del objeto → muestra mensaje (reutilizando el contenido actual de `app.js`).
8. **Verificar en escritorio y Android** cada paso.

Cada paso debe producir una versión funcional (regla incremental §11).

## 7. Dependencias necesarias y para qué

- **`phaser`** (runtime): motor 2D — escenas, sprites, física, cámara, animaciones. Es la pieza central.
- **`vite`** (dev): bundler y servidor de desarrollo local, compilación para producción. Requerido para usar Phaser como módulo y para trabajar con TypeScript.
- **`typescript`** (dev): ya está instalado; tipos y organización del código. (Nota: hay que añadir `tsconfig.json`, que aún no existe).

El resto (audio, red, etc.) **no debe instalarse todavía** — se decidirá cuando se necesiten (regla §6).

## 8. Riesgos técnicos (especialmente Android / móvil)

1. **Rendimiento del renderizado CSS/emojis**: el prototipo actual no escalará; Phaser con canvas es más adecuado, pero hay que vigilar tamaño del canvas y limitar efectos.
2. **Entrada táctil**: no hay controles táctiles diseñados; habrá que añadir joystick/botones para móvil (prioridad baja ahora, planeado).
3. **Viewport y escalado móvil**: los tamaños de pantalla varían mucho; hay que usar `Scale` de Phaser y respetar `meta viewport`. Riesgo de UI cortada o mal posicionada.
4. **Consumo de memoria y tiempos de carga**: Phaser + assets añaden peso; las carpetas `assets/` vacías deben llenarse con sprites ligeros (atlas, no muchos PNG grandes).
5. **`package.json` actual**: `"type": "commonjs"` y ausencia de scripts dificultan el arranque con Vite; habrá que ajustarlo en la migración.
6. **Termux / entorno Android**: los permisos de almacenamiento y el servidor de dev local pueden ser limitados; verificar que el pipeline funcione en este entorno antes de avanzar.
7. **Audio en móvil**: requiere gesto del usuario para desbloquear el contexto de audio; pospuesto pero relevante para fases sociales.
# Reporte 02: Primera etapa jugable — Migración a Phaser + TypeScript + Vite

Fecha: 2026-09-06

## 1. Objetivo

Migrar el prototipo estático (HTML/CSS/JS) a una base mínima de juego con Phaser + TypeScript + Vite, preparando el entorno y creando una escena Phaser que pueda ejecutarse en el navegador.

## 2. Resultado

El proyecto ahora arranca mediante `npm run dev` y abre una escena 2D con Phaser (versión 4.2.1) que reproduce de forma mínima la estética nocturna del prototipo: pared, suelo, ventana con luna y estrellas, alfombra y título.

## 3. Archivos creados

- `src/main.ts` — punto de entrada, crea la instancia de `Phaser.Game`.
- `src/game/config.ts` — configuración del juego (render AUTO, escala FIT 800×600, escena `room`, fondo nocturno).
- `src/game/scenes/RoomScene.ts` — escena mínima: pared, suelo, ventana, luna/estrellas, alfombra y título.
- `tsconfig.json` — TypeScript estricto, `moduleResolution: "bundler"`, `noEmit`.
- `vite.config.ts` — configuración mínima de Vite con `base: './'`.

## 4. Archivos modificados

- `package.json` — `"type": "module"`, scripts `dev`/`build`/`preview`, dependencias `phaser` y `vite` (TypeScript ya estaba instalado). Se eliminó el script de prueba roto y el campo `main`.
- `index.html` — ahora es el contenedor `#game` del canvas de Phaser (conserva el fondo oscuro y el título "Nuestro cuartito 🌙").
- `package-lock.json` — actualizado por `npm install`.

## 5. Archivos intactos

- `app.js`, `style.css`, `assets/` y toda la documentación se conservaron. El prototipo original queda como referencia en el repositorio y en git.

## 6. Decisiones tomadas

1. `index.html` pasa a ser el contenedor del juego (el prototipo queda intacto en git). Confirmada con el usuario.
2. Se usa **Phaser 4.2.1** (la última versión, instalada por defecto) en lugar de Phaser 3. Confirmada con el usuario porque es un cambio significativo para el futuro del proyecto.

## 7. Problemas encontrados y soluciones

1. **`tsc: not found` al ejecutar `npm run build`** — El binario `tsc` existía en `node_modules/.bin`, pero los ejecutables de las dependencias (`tsc`, `vite`) usan el shebang `#!/usr/bin/env node`, y en Termux no existe la ruta `/usr/bin/env`. Por eso el shell no conseguía ejecutarlos. *Solución*: en los scripts de `package.json` se invocan los bins directamente con `node` (`node node_modules/typescript/bin/tsc`, `node node_modules/vite/bin/vite.js`), evitando el shebang. Es un workaround del entorno y también funciona en escritorio.
2. **Errores de tipos en TypeScript** — El escena usaba `frame.centerX` y `frame.bottom`, propiedades que no existen en el tipo `Rectangle` de Phaser 4. *Solución*: calcular las coordenadas a partir de `x`, `y`, `width` y `height` del rectángulo.

## 8. Comprobaciones realizadas

- `npm run build`: typecheck de TypeScript y build de Vite correctos.
- `npm run dev`: servidor de desarrollo iniciado correctamente.
- HTTP 200 en `/`, `/src/main.ts`, `/src/game/config.ts` y `/src/game/scenes/RoomScene.ts`, con Phaser resuelto correctamente por Vite.
- Sin vulnerabilidades en `npm install`.

## 9. Pendientes

- Verificar visualmente la escena en un navegador real (no pude hacerlo desde la CLI): abrir `http://localhost:5173` con `npm run dev`.
- Si se desea, documentar en AGENTS.md el workaround de los scripts por el tema de `/usr/bin/env` en Termux.
- Alinear la versión de `package.json` con el CHANGELOG si se considera necesario.
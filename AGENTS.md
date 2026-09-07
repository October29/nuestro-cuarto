AGENTS.md

Nuestro Cuartito

Este archivo contiene las instrucciones de trabajo para los agentes de IA que modifiquen este proyecto.

Nuestro Cuartito es un espacio virtual social y acogedor. La visión inicial es un pequeño mundo 2D inspirado en habitaciones y cafés virtuales, donde las personas puedan entrar, mover un personaje, interactuar con objetos y, progresivamente, comunicarse entre ellas.

El proyecto se encuentra en una etapa temprana. La prioridad es construir una base sencilla, mantenible y fácil de evolucionar.

---

1. Reglas generales

- Lee este archivo antes de modificar el proyecto.
- Lee "ARCHITECTURE.md" y "TODO.md" cuando la tarea esté relacionada con arquitectura o planificación.
- Antes de realizar cambios importantes, inspecciona el código existente.
- No reescribas partes del proyecto innecesariamente.
- No introduzcas dependencias sin una razón clara.
- Prefiere soluciones simples antes que sistemas complejos.
- Mantén el código modular y fácil de entender.
- No elimines funcionalidad existente sin comprobar primero para qué sirve.
- No cambies la dirección general del proyecto por iniciativa propia.
- Si una decisión técnica puede afectar considerablemente al futuro del proyecto, explícalo antes de implementarla.
- No inventes APIs, archivos, funciones o recursos que no existan.
- Respeta los nombres y convenciones existentes.

---

2. Estado actual

El proyecto actualmente contiene una primera versión experimental de una habitación web.

Archivos principales:

- "index.html"
- "style.css"
- "app.js"
- "package.json"
- "package-lock.json"

La implementación actual es deliberadamente sencilla y sirve como prototipo visual.

No asumas que la implementación actual representa la arquitectura definitiva.

---

3. Dirección tecnológica

La dirección prevista es evolucionar progresivamente desde el prototipo web hacia un juego 2D interactivo.

La tecnología candidata principal para la capa de juego es Phaser + TypeScript + Vite.

Sin embargo, no debes migrar automáticamente el proyecto a Phaser, TypeScript o Vite solamente porque estén mencionados aquí.

La migración debe hacerse cuando exista una tarea específica que la justifique.

---

4. Diseño del juego

La experiencia debe priorizar:

- Una estética acogedora.
- Una sensación de espacio pequeño y personal.
- Interacción sencilla.
- Personajes 2D.
- Objetos interactivos.
- Animaciones suaves.
- Una interfaz discreta.
- Compatibilidad con dispositivos móviles y escritorio.
- Buen funcionamiento con teclado y ratón.
- Posteriormente, controles táctiles.

La estética y la experiencia son importantes. Evita convertir el proyecto en una interfaz genérica de aplicación web.

---

5. Arquitectura

A medida que el proyecto crezca, intenta separar claramente:

- Renderizado.
- Estado del juego.
- Entrada del usuario.
- Entidades/personajes.
- Objetos interactivos.
- Interfaz.
- Audio.
- Comunicación de red.
- Funcionalidades sociales.

No construyas toda la aplicación en un único archivo cuando el crecimiento del proyecto haga que esa estructura deje de ser razonable.

---

6. Dependencias

Antes de instalar una dependencia nueva:

1. Comprueba si ya existe una solución con las herramientas actuales.
2. Comprueba si la dependencia es realmente necesaria.
3. Considera el impacto en dispositivos móviles.
4. Considera el tamaño y rendimiento.
5. Evita dependencias duplicadas.

Si una dependencia es importante para la arquitectura, documenta su propósito.

---

7. Código

Prioriza:

- Código legible.
- Funciones pequeñas.
- Nombres descriptivos.
- Responsabilidades bien separadas.
- Evitar duplicación.
- Comentarios solamente cuando aporten contexto útil.

No sobreingenierices funcionalidades que todavía son prototipos.

---

8. Cambios

Antes de modificar código:

- Comprende primero cómo funciona.
- Identifica los archivos afectados.
- Haz el cambio más pequeño que resuelva el problema.

Después de modificar código:

- Comprueba que no haya errores de sintaxis.
- Ejecuta las comprobaciones disponibles (`npm test` para los tests de regresión y `npm run build` para el typecheck estricto + build de Vite).
- Si existe un servidor de desarrollo, comprueba que la aplicación siga iniciándose.
- Informa de cualquier problema que no hayas podido verificar.

No afirmes que algo funciona si no lo has comprobado.

---

9. Git

No hagas "git push" automáticamente.

El usuario controla el repositorio y decide cuándo publicar cambios.

No hagas commits automáticamente salvo que el usuario lo solicite explícitamente.

Antes de realizar cambios destructivos o difíciles de revertir, advierte al usuario.

---

10. Comunicación

Cuando termines una tarea, informa brevemente:

1. Qué cambiaste.
2. Qué archivos modificaste.
3. Qué comprobaciones ejecutaste.
4. Si quedó algún problema pendiente.

Si encuentras un problema que requiere una decisión de diseño, detente y pregunta en lugar de tomar una decisión importante por tu cuenta.

---

11. Regla fundamental

Nuestro Cuartito debe crecer de forma incremental.

No intentes construir todo el juego de una vez.

Primero debe funcionar una pequeña pieza.

Después se mejora.

Después se conecta con la siguiente.

La estabilidad y la capacidad de evolucionar son más importantes que añadir muchas funcionalidades rápidamente.

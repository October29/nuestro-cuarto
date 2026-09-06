ARCHITECTURE.md

Nuestro Cuartito

Visión

Nuestro Cuartito es un espacio virtual 2D donde una o varias personas pueden compartir una habitación, café u otros espacios pequeños.

La experiencia busca combinar:

- Exploración 2D.
- Decoración.
- Personajes.
- Interacción con objetos.
- Chat.
- Voz.
- Vídeo.
- Actividades compartidas.
- Una estética acogedora y personal.

La arquitectura debe permitir que estas características aparezcan progresivamente sin obligar al proyecto a implementar todo desde el principio.

---

Estado actual

El proyecto se encuentra en fase de prototipo.

Actualmente existe una habitación web estática implementada con:

- HTML
- CSS
- JavaScript

La habitación contiene elementos visuales como:

- Ventana.
- Luna y estrellas.
- Cuadro.
- Estantería.
- Televisor.
- Sofá.
- Planta.
- Alfombra.
- Controles sociales.

Esta versión sirve como prototipo visual y punto de partida.

---

Dirección prevista

La dirección técnica prevista es:

Navegador
   │
   ▼
Juego 2D
   │
   ├── Renderizado
   ├── Input
   ├── Personaje
   ├── Objetos
   ├── Escenas
   ├── UI
   └── Audio

La tecnología candidata para la capa de juego es:

Phaser
TypeScript
Vite

Esta decisión puede revisarse si las necesidades del proyecto cambian.

---

Evolución prevista

Fase 1: Prototipo

Objetivo:

Convertir la habitación estática en una escena interactiva.

Elementos:

- Escena 2D.
- Personaje controlable.
- Movimiento.
- Colisiones básicas.
- Cámara.
- Objetos interactivos.

---

Fase 2: Mundo pequeño

Añadir:

- Varias habitaciones.
- Transiciones entre espacios.
- Decoración.
- Objetos reutilizables.
- Sistema básico de interacción.

---

Fase 3: Identidad

Añadir:

- Personaje configurable.
- Nombre.
- Apariencia.
- Animaciones.
- Inventario o elementos decorativos.

---

Fase 4: Multijugador

Separar claramente:

Cliente
   │
   │ conexión
   ▼
Servidor
   │
   ├── Usuarios
   ├── Posiciones
   ├── Salas
   └── Estado compartido

El cliente será responsable principalmente de representar el mundo.

El servidor será responsable de la información compartida y del estado que deba sincronizarse.

---

Fase 5: Comunicación

Añadir progresivamente:

- Chat de texto.
- Voz.
- Vídeo.
- Indicadores de presencia.
- Estados de usuario.

Las tecnologías concretas para estas funciones se decidirán cuando lleguemos a esa fase.

---

Fase 6: Actividades compartidas

El televisor u otros objetos podrían permitir:

- Ver contenido juntos.
- Escuchar música.
- Jugar pequeñas actividades.
- Compartir experiencias.

Estas funcionalidades deberán diseñarse teniendo en cuenta sincronización entre usuarios.

---

Principios arquitectónicos

Simplicidad

No construir sistemas complejos antes de necesitarlos.

Modularidad

Las funcionalidades deben poder evolucionar sin obligar a modificar todo el proyecto.

Separación

Mantener separadas las responsabilidades del juego, interfaz, red y servicios externos.

Mobile-first

El proyecto debe considerar desde el principio dispositivos móviles.

Rendimiento

El juego debe poder funcionar razonablemente bien en hardware móvil.

Evolución incremental

Cada etapa debe producir una versión funcional.

---

Estructura futura orientativa

No es obligatorio implementar esta estructura inmediatamente.

src/
├── game/
│   ├── scenes/
│   ├── entities/
│   ├── objects/
│   ├── systems/
│   └── config/
│
├── ui/
│
├── network/
│
├── audio/
│
├── assets/
│
└── main.ts

Esta estructura es una referencia y puede cambiar cuando las necesidades reales del proyecto lo justifiquen.

---

Regla de arquitectura

La arquitectura debe responder a las necesidades reales del proyecto.

No añadir abstracciones solamente porque parezcan profesionales.

Un sistema pequeño y comprensible es preferible a un sistema sofisticado que todavía no necesitamos.

# Signaling server

Servidor mínimo de signaling para Nuestro Cuartito (M07).

Su única responsabilidad es ayudar a que **dos** navegadores se encuentren y
negocien una conexión P2P (WebRTC): mantiene salas en memoria, genera códigos
y retransmite mensajes de signaling (`offer` / `answer` / ICE entre los dos
peers).

El servidor **no** conoce el estado de juego, **no** es autoridad de nada y
**no** guarda datos en disco.

## Instalar

```sh
cd signaling
npm install
```

## Ejecutar

```sh
cd signaling
npm start
```

Por defecto escucha en el puerto `8787`. Se puede cambiar con la variable de
entorno `SIGNALING_PORT` (o `PORT`):

```sh
SIGNALING_PORT=9000 npm start
```

El servidor imprime en consola los eventos básicos (sala creada, participante
unido, sala cerrada).

## Protocolo

Los clientes se conectan por WebSocket a `ws://HOST:8787`.

### Cliente → servidor

| Mensaje | Descripción |
| --- | --- |
| `{ "type": "create" }` | El cliente crea una sala (es el primer participante). |
| `{ "type": "join", "roomCode": "XXXXXX" }` | El cliente se une a una sala existente (segundo participante). |
| `{ "type": "signal", "data": ... }` | Payload de signaling (SDP offer, SDP answer, ICE candidate) que el servidor retransmite tal cual al otro participante. |

### Servidor → cliente

| Mensaje | Descripción |
| --- | --- |
| `{ "type": "created", "roomCode": "XXXXXX" }` | Sala creada. |
| `{ "type": "joined", "roomCode": "XXXXXX" }` | Unión correcta a la sala. |
| `{ "type": "peer-joined" }` | Se envió al primer participante cuando el segundo entra. |
| `{ "type": "signal", "data": ... }` | Mensaje de signaling recibido del otro participante. |
| `{ "type": "peer-left" }` | Se envió al participante que queda cuando el otro sale. |
| `{ "type": "error", "message": "..." }` | Error (mensaje inválido, sala no encontrada, sala llena, tipo desconocido). |

### Reglas

- Máximo **2 participantes** por sala. Un tercero recibe
  `{ "type": "error", "message": "sala llena" }` y se cierra su conexión.
- Los códigos tienen **6 caracteres** (alfabeto sin caracteres ambiguos).
- Las salas viven **solo en memoria**: al cerrar la conexión de un
  participante se avisa al otro (`peer-left`) y la sala se elimina.
- STUN/TURN no son responsabilidad de este servidor: la configuración de STUN
  pertenece al cliente (etapas posteriores). No se implementa TURN.
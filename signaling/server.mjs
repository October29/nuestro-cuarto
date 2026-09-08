import { WebSocket, WebSocketServer } from 'ws';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const PORT = Number(process.env.SIGNALING_PORT ?? process.env.PORT ?? 8787);
const CODE_LENGTH = 6;
// Alfabeto sin caracteres ambiguos (sin I/O/0/1).
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_PARTICIPANTS = 2;

// ---------------------------------------------------------------------------
// Room-first (Paso 1): ROOM != CONNECTION.
//
// La sala es una entidad server-owned con ciclo de vida propio, independiente
// de los WebSockets. Existe mientras viva el proceso del servidor; las
// conexiones son únicamente PRESENCIA momentánea dentro de la sala.
//
// roomCode -> { code, createdAt, sockets: [] }   (presencia = sockets vivos)
//
// Ciclo de vida de una sala:
//   - create: genera un id permanente y registra la sala, añadiendo la
//     presencia del creador.
//   - join:  añade presencia. Se permite entrar aunque la sala esté vacía
//     (es como se "vuelve a una sala" sin que haya nadie).
//   - leave / cierre del WebSocket: solo quitan PRESENCIA. La sala y su id
//     permanecen, ocurra lo que ocurra con los participantes: si queda alguien
//     recibe peer-left y sigue dentro; si se va el último, la sala queda viva.
//   - proceso del servidor terminando: las salas (memoria, aún sin disco) se
//     pierden. La pérdida es del SERVIDOR, no de los clientes.
//
// leave vs disconnect:
//   - "leave" (mensaje explícito del cliente) y desconexión del WebSocket
//     producen el MISMO efecto sobre la sala: se retira la presencia y el
//     resto queda igual. La diferencia es intencionalidad a nivel de cliente
//     (botón "Salir" vs navegador cerrado), no de ciclo de vida de Room.
//     No se introduce aquí ninguna política compleja de reconexión: en una
//     fase posterior la distinción puede servir para marcar "presencia
//     transitoria" frente a "ausencia intencional".
// ---------------------------------------------------------------------------

export function createSignalingServer(options = {}) {
  const { port = PORT } = options;
  const rooms = new Map();
  const connected = new Set();

  const wss = new WebSocketServer({ port });

  function generateCode(usedCodes) {
    let code;
    do {
      const bytes = crypto.randomBytes(CODE_LENGTH);
      code = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
    } while (usedCodes.has(code));
    return code;
  }

  /** Estado inicial de una Room recién creada. */
  function createInitialState(roomCode) {
    return {
      version: 1,
      name: `Sala ${roomCode}`,
      width: 1200,
      height: 800,
      objects: [
        { id: 'sofa-1', type: 'sofa', x: 600, y: 570 },
      ],
    };
  }

  function send(socket, data) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(data));
    }
  }

  function roomBySocket(socket) {
    const code = socket.roomCode;
    return code ? rooms.get(code) : undefined;
  }

  function otherPresentPeer(room, socket) {
    return room.sockets.find((s) => s !== socket && s.readyState === WebSocket.OPEN);
  }

  /** Envía un mensaje a todos los sockets presentes en una Room. */
  function broadcastToRoom(room, message) {
    for (const s of room.sockets) {
      if (s.readyState === WebSocket.OPEN) send(s, message);
    }
  }

  function addPresence(code, socket) {
    const room = rooms.get(code);
    room.sockets.push(socket);
    socket.roomCode = code;
  }

  // Retira la presencia (leave explícito o cierre del socket) sin tocar la
  // sala. Si queda alguien, se le avisa con peer-left.
  function removePresence(room, socket) {
    const index = room.sockets.indexOf(socket);
    if (index === -1) return;
    room.sockets.splice(index, 1);
    const peer = room.sockets.find((s) => s.readyState === WebSocket.OPEN);
    if (peer) send(peer, { type: 'peer-left' });
  }

  function handleClose(socket) {
    const room = roomBySocket(socket);
    if (room) {
      removePresence(room, socket);
      console.log(`presencia retirada (socket cerrado): ${room.code}`);
    }
    socket.roomCode = undefined;
  }

  wss.on('connection', (socket) => {
    connected.add(socket);

    socket.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        send(socket, { type: 'error', message: 'mensaje inválido' });
        return;
      }

      switch (msg && msg.type) {
        case 'create': {
          if (socket.roomCode) return;
          const roomCode = generateCode(new Set(rooms.keys()));
          rooms.set(roomCode, { code: roomCode, createdAt: Date.now(), sockets: [], state: createInitialState(roomCode) });
          addPresence(roomCode, socket);
          send(socket, { type: 'created', roomCode });
          console.log(`sala creada: ${roomCode}`);
          break;
        }

        case 'join': {
          if (socket.roomCode) return;
          const code = typeof msg.roomCode === 'string' ? msg.roomCode.toUpperCase() : '';
          const room = rooms.get(code);
          if (!room) {
            send(socket, { type: 'error', message: 'sala no encontrada' });
            return;
          }
          if (room.sockets.length >= MAX_PARTICIPANTS) {
            send(socket, { type: 'error', message: 'sala llena' });
            socket.close();
            return;
          }
          addPresence(code, socket);
          send(socket, { type: 'joined', roomCode: code });
          const peer = otherPresentPeer(room, socket);
          if (peer) send(peer, { type: 'peer-joined' });
          console.log(`participante unido: ${code}`);
          break;
        }

        case 'leave': {
          const room = roomBySocket(socket);
          if (room) {
            removePresence(room, socket);
            console.log(`participante salió (leave): ${room.code}`);
          }
          socket.roomCode = undefined;
          break;
        }

        case 'signal': {
          const room = roomBySocket(socket);
          const peer = room ? otherPresentPeer(room, socket) : undefined;
          if (peer) {
            send(peer, { type: 'signal', data: msg.data });
          }
          break;
        }

        case 'room:get-state': {
          const room = roomBySocket(socket);
          if (!room) {
            send(socket, { type: 'error', message: 'no estás en ninguna sala' });
            return;
          }
          send(socket, { type: 'room:state', state: room.state });
          break;
        }

        case 'room:update': {
          const room = roomBySocket(socket);
          if (!room) {
            send(socket, { type: 'error', message: 'no estás en ninguna sala' });
            return;
          }
          if (!msg.patch || typeof msg.patch !== 'object') {
            send(socket, { type: 'error', message: 'patch inválido' });
            return;
          }
          const patch = msg.patch;
          // Solo se permite modificar propiedades explícitamente permitidas.
          // Solo aceptamos name como propiedad modificable.
          if ('version' in patch) {
            send(socket, { type: 'error', message: 'no puedes modificar version' });
            return;
          }
          if ('width' in patch) {
            send(socket, { type: 'error', message: 'no puedes modificar width' });
            return;
          }
          if ('height' in patch) {
            send(socket, { type: 'error', message: 'no puedes modificar height' });
            return;
          }
          if ('objects' in patch) {
            send(socket, { type: 'error', message: 'no puedes modificar objects' });
            return;
          }
          const allowedKeys = new Set(['name']);
          for (const key of Object.keys(patch)) {
            if (!allowedKeys.has(key)) {
              send(socket, { type: 'error', message: `propiedad no permitida: ${key}` });
              return;
            }
          }
          if (typeof patch.name !== 'string' || patch.name.trim().length === 0) {
            send(socket, { type: 'error', message: 'name debe ser un string no vacío' });
            return;
          }
          room.state = { ...room.state, name: patch.name.trim() };
          broadcastToRoom(room, { type: 'room:updated', state: room.state });
          console.log(`room:update aceptado en ${room.code}`);
          break;
        }

        default:
          send(socket, { type: 'error', message: 'tipo de mensaje desconocido' });
      }
    });

    socket.on('close', () => {
      connected.delete(socket);
      handleClose(socket);
    });
    socket.on('error', () => socket.close());
  });

  function close() {
    for (const socket of connected) {
      if (socket.readyState === WebSocket.OPEN) socket.close();
    }
    connected.clear();
    rooms.clear();
    wss.close();
  }

  return { wss, close };
}

function startFromCLI() {
  const { wss } = createSignalingServer({ port: PORT });
  wss.on('listening', () => {
    console.log(`signaling escuchando en ws://0.0.0.0:${PORT}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startFromCLI();
}
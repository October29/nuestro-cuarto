import { WebSocket, WebSocketServer } from 'ws';
import crypto from 'node:crypto';

const PORT = Number(process.env.SIGNALING_PORT ?? process.env.PORT ?? 8787);
const CODE_LENGTH = 6;
// Alfabeto sin caracteres ambiguos (sin I/O/0/1).
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_PARTICIPANTS = 2;

// Salas en memoria: roomCode -> { sockets: WebSocket[] }
// El servidor solo empareja y retransmite; no conoce el estado de juego.
const rooms = new Map();

function generateCode(usedCodes) {
  let code;
  do {
    const bytes = crypto.randomBytes(CODE_LENGTH);
    code = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
  } while (usedCodes.has(code));
  return code;
}

function send(socket, data) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(data));
  }
}

function otherPeer(room, socket) {
  return room.sockets.find((s) => s !== socket);
}

function handleClose(socket) {
  const roomCode = socket.roomCode;
  if (!roomCode) return;

  const room = rooms.get(roomCode);
  if (room) {
    const peer = otherPeer(room, socket);
    if (peer) {
      send(peer, { type: 'peer-left' });
    }
    rooms.delete(roomCode);
    console.log(`sala cerrada: ${roomCode}`);
  }

  socket.roomCode = undefined;
}

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (socket) => {
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
        rooms.set(roomCode, { sockets: [socket] });
        socket.roomCode = roomCode;
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
        room.sockets.push(socket);
        socket.roomCode = code;
        send(socket, { type: 'joined', roomCode: code });
        send(otherPeer(room, socket), { type: 'peer-joined' });
        console.log(`participante unido: ${code}`);
        break;
      }

      case 'signal': {
        const room = socket.roomCode ? rooms.get(socket.roomCode) : undefined;
        const peer = room && otherPeer(room, socket);
        if (peer) {
          send(peer, { type: 'signal', data: msg.data });
        }
        break;
      }

      default:
        send(socket, { type: 'error', message: 'tipo de mensaje desconocido' });
    }
  });

  socket.on('close', () => handleClose(socket));
  socket.on('error', () => socket.close());
});

wss.on('listening', () => {
  console.log(`signaling escuchando en ws://0.0.0.0:${PORT}`);
});
import { WebSocket, WebSocketServer } from 'ws';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const PORT = Number(process.env.SIGNALING_PORT ?? process.env.PORT ?? 8787);
const CODE_LENGTH = 6;
// Alfabeto sin caracteres ambiguos (sin I/O/0/1).
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_PARTICIPANTS = 2;
// Ventana de recuperación M08-C: tras el cierre del WebSocket de un
// participante (suspensión del navegador), su slot queda "recovering" durante
// este período para permitir que la misma persona regrese y reocupe su lugar.
const DEFAULT_GRACE_MS = 30_000;
const SWEEP_INTERVAL_MS = 2_000;

// roomCode -> { code, slots: [{ participantId, role, socket, recovering, deadline }] }
// El servidor solo empareja y retransmite; no conoce el estado de juego.
// Los slots identifican al participante para poder reclamar su lugar tras una
// recarga (M08-C). Como máximo hay 2 slots por sala.
export function createSignalingServer(options = {}) {
  const { port = PORT, graceMs = DEFAULT_GRACE_MS } = options;
  const rooms = new Map();

  const wss = new WebSocketServer({ port });
  const connected = new Set();

  function generateCode(usedCodes) {
    let code;
    do {
      const bytes = crypto.randomBytes(CODE_LENGTH);
      code = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
    } while (usedCodes.has(code));
    return code;
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

  function slotBySocket(room, socket) {
    return room.slots.find((s) => s.socket === socket);
  }

  function findProtocolError(msg) {
    if (typeof msg !== 'object' || msg === null) return 'mensaje inválido';
    return null;
  }

  function error(socket, message) {
    send(socket, { type: 'error', message });
  }

  // Cierre definitivo de un slot (leave explícito o gracia expirada): se
  // libera el hueco y, si el otro participante sigue conectado, se le avisa.
  function releaseSlot(room, slot, notifyPeer) {
    const index = room.slots.indexOf(slot);
    if (index === -1) return;
    room.slots.splice(index, 1);
    if (notifyPeer) {
      const peer = room.slots.find((s) => s.socket && s.socket.readyState === WebSocket.OPEN);
      if (peer) send(peer.socket, { type: 'peer-left' });
    }
  }

  function sweepExpired() {
    const now = Date.now();
    for (const room of [...rooms.values()]) {
      for (const slot of [...room.slots]) {
        if (slot.deadline && now >= slot.deadline) {
          console.log(`slot expirado: ${room.code} -> ${slot.participantId}`);
          releaseSlot(room, slot, true);
        }
      }
      if (room.slots.length === 0) {
        rooms.delete(room.code);
        console.log(`sala cerrada por expiración: ${room.code}`);
      }
    }
  }

  const sweepTimer = setInterval(sweepExpired, SWEEP_INTERVAL_MS);
  sweepTimer.unref();

  function handleClose(socket) {
    const room = roomBySocket(socket);
    if (!room) return;
    const slot = slotBySocket(room, socket);
    if (!slot) return;
    // Cierre sin "leave" explícito: suspensión/recarga provisional. El slot se
    // conserva durante la ventana de gracia para permitir el "resume".
    slot.socket = null;
    slot.recovering = true;
    slot.deadline = Date.now() + graceMs;
    console.log(`sala en recuperación: ${room.code} (${slot.participantId})`);
    socket.roomCode = undefined;
  }

  wss.on('connection', (socket) => {
    connected.add(socket);
    socket.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        error(socket, 'mensaje inválido');
        return;
      }
      if (findProtocolError(msg)) {
        error(socket, 'mensaje inválido');
        return;
      }

      switch (msg.type) {
        case 'create': {
          if (socket.roomCode) return;
          if (typeof msg.participantId !== 'string' || msg.participantId.length === 0) {
            error(socket, 'participantId requerido');
            return;
          }
          const roomCode = generateCode(new Set(rooms.keys()));
          rooms.set(roomCode, {
            code: roomCode,
            slots: [
              { participantId: msg.participantId, role: 'host', socket, recovering: false, deadline: null },
            ],
          });
          socket.roomCode = roomCode;
          send(socket, { type: 'created', roomCode });
          console.log(`sala creada: ${roomCode}`);
          break;
        }

        case 'join': {
          if (socket.roomCode) return;
          if (typeof msg.participantId !== 'string' || msg.participantId.length === 0) {
            error(socket, 'participantId requerido');
            return;
          }
          const code = typeof msg.roomCode === 'string' ? msg.roomCode.toUpperCase() : '';
          const room = rooms.get(code);
          if (!room) {
            error(socket, 'sala no encontrada');
            return;
          }
          if (room.slots.length >= MAX_PARTICIPANTS) {
            error(socket, 'sala llena');
            socket.close();
            return;
          }
          // Un slot en recuperación sigue ocupando hueco: la identidad de quien
          // lo dejará libre ya está reservada (evita que alguien lo usurpe).
          room.slots.push({ participantId: msg.participantId, role: 'visitor', socket, recovering: false, deadline: null });
          socket.roomCode = code;
          send(socket, { type: 'joined', roomCode: code });
          const host = room.slots.find((s) => s.role === 'host' && s.socket && s.socket.readyState === WebSocket.OPEN);
          if (host) send(host.socket, { type: 'peer-joined' });
          console.log(`participante unido: ${code}`);
          break;
        }

        case 'resume': {
          if (socket.roomCode) return;
          const code = typeof msg.roomCode === 'string' ? msg.roomCode.toUpperCase() : '';
          const participantId = typeof msg.participantId === 'string' ? msg.participantId : '';
          const role = msg.role;
          const room = rooms.get(code);
          if (!room) {
            error(socket, 'sala no encontrada (posiblemente expirada)');
            return;
          }
          const slot = room.slots.find((s) => s.participantId === participantId);
          if (!slot) {
            error(socket, 'sesión no encontrada: identidad no coincide con la sala');
            return;
          }
          if (slot.role !== role) {
            error(socket, 'rol de sesión incorrecto');
            return;
          }
          if (slot.socket) {
            error(socket, 'sesión ya reclamada por otra conexión');
            return;
          }
          slot.socket = socket;
          slot.recovering = false;
          slot.deadline = null;
          socket.roomCode = code;
          const peer = room.slots.find((s) => s !== slot && s.socket && s.socket.readyState === WebSocket.OPEN);
          send(socket, { type: 'resumed', roomCode: code, peerActive: Boolean(peer) });
          // El que resume (host en 'connecting') necesita el trigger para
          // volver a negociar; el peer activo necesita renegociar desde cero.
          send(socket, { type: 'peer-resumed' });
          if (peer) send(peer.socket, { type: 'peer-resumed' });
          console.log(`participante recuperado: ${code} (${role})`);
          break;
        }

        case 'leave': {
          const room = roomBySocket(socket);
          if (room) {
            const slot = slotBySocket(room, socket);
            if (slot) releaseSlot(room, slot, true);
            if (room.slots.length === 0) {
              rooms.delete(room.code);
              console.log(`sala cerrada: ${room.code}`);
            }
          }
          socket.roomCode = undefined;
          break;
        }

        case 'signal': {
          const room = roomBySocket(socket);
          const slot = room && slotBySocket(room, socket);
          const peer = slot && room.slots.find((s) => s !== slot && s.socket && s.socket.readyState === WebSocket.OPEN);
          if (peer) {
            send(peer.socket, { type: 'signal', data: msg.data });
          }
          break;
        }

        default:
          error(socket, 'tipo de mensaje desconocido');
      }
    });

    socket.on('close', () => {
      connected.delete(socket);
      handleClose(socket);
    });
    socket.on('error', () => socket.close());
  });

  function close() {
    clearInterval(sweepTimer);
    for (const room of rooms.values()) {
      for (const slot of room.slots) {
        if (slot.socket && slot.socket.readyState === WebSocket.OPEN) {
          slot.socket.close();
        }
      }
    }
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
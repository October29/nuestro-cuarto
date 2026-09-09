import { WebSocket, WebSocketServer } from 'ws';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.SIGNALING_PORT ?? process.env.PORT ?? 8787);
const CODE_LENGTH = 6;
// Alfabeto sin caracteres ambiguos (sin I/O/0/1).
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_PARTICIPANTS = 2;

// Directorio de datos para persistencia (configurable via variable de entorno).
function getDataDir(env) {
  return env.SIGNALING_DATA_DIR ?? path.join(process.cwd(), 'data', 'rooms');
}

// ---------------------------------------------------------------------------
// Persistencia de RoomState en disco.

/** Asegura que el directorio de datos exista. */
function ensureDataDir(env) {
  const dir = getDataDir(env);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** Ruta del archivo de persistencia para una sala. */
function roomFilePath(roomCode, env) {
  return path.join(getDataDir(env), `${roomCode}.json`);
}

/** Valida que un estado tenga la forma esperada de RoomState. */
function validateRoomState(state) {
  if (!state || typeof state !== 'object') return false;
  if (typeof state.version !== 'number') return false;
  if (typeof state.name !== 'string') return false;
  if (typeof state.width !== 'number') return false;
  if (typeof state.height !== 'number') return false;
  if (!Array.isArray(state.objects)) return false;
  for (const obj of state.objects) {
    if (!obj || typeof obj !== 'object') return false;
    if (typeof obj.id !== 'string' || obj.id.length === 0) return false;
    if (obj.type !== 'sofa' && obj.type !== 'table') return false;
    if (typeof obj.x !== 'number' || !Number.isFinite(obj.x)) return false;
    if (typeof obj.y !== 'number' || !Number.isFinite(obj.y)) return false;
  }
  return true;
}

/** Carga todas las salas persistidas desde el disco. */
function loadPersistedRooms(env) {
  ensureDataDir(env);
  const rooms = new Map();
  try {
    const files = fs.readdirSync(getDataDir(env));
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const roomCode = file.slice(0, -5);
      const filePath = roomFilePath(roomCode, env);
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const state = JSON.parse(content);
        if (!validateRoomState(state)) {
          console.warn(`Estado inválido en ${file}, ignorando`);
          continue;
        }
        rooms.set(roomCode, {
          code: roomCode,
          createdAt: Date.now(),
          sockets: [],
          state,
        });
        console.log(`Sala persistida cargada: ${roomCode}`);
      } catch (e) {
        console.warn(`Error al cargar ${file}: ${e.message}`);
      }
    }
  } catch (e) {
    console.warn(`Error al leer directorio de datos: ${e.message}`);
  }
  return rooms;
}

/** Escribe el estado de una sala en disco de forma atómica. */
function persistRoomState(roomCode, state, env) {
  ensureDataDir(env);
  const filePath = roomFilePath(roomCode, env);
  const tempPath = `${filePath}.tmp`;
  try {
    const content = JSON.stringify(state, null, 2);
    fs.writeFileSync(tempPath, content, 'utf8');
    fs.renameSync(tempPath, filePath);
  } catch (e) {
    // Limpieza en caso de error
    try {
      fs.unlinkSync(tempPath);
    } catch (_) {}
    throw e;
  }
}
 
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
  const { port = PORT, env = process.env } = options;
  const rooms = loadPersistedRooms(env);
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
        { id: 'table-1', type: 'table', x: 900, y: 400 },
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
          const initialState = createInitialState(roomCode);
          rooms.set(roomCode, { code: roomCode, createdAt: Date.now(), sockets: [], state: initialState });
          persistRoomState(roomCode, initialState, env);
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

          // Distinguir por tipo de operación (op)
          if (patch.op === 'create') {
            // Crear un nuevo objeto
            const createPatch = patch;
            if (typeof createPatch.id !== 'string' || createPatch.id.length === 0) {
              send(socket, { type: 'error', message: 'id debe ser un string no vacío' });
              return;
            }
            if (createPatch.type !== 'sofa' && createPatch.type !== 'table') {
              send(socket, { type: 'error', message: 'type debe ser "sofa" o "table"' });
              return;
            }
            if (typeof createPatch.x !== 'number' || !Number.isFinite(createPatch.x)) {
              send(socket, { type: 'error', message: 'x debe ser un número finito' });
              return;
            }
            if (typeof createPatch.y !== 'number' || !Number.isFinite(createPatch.y)) {
              send(socket, { type: 'error', message: 'y debe ser un número finito' });
              return;
            }

            // Verificar que no exista ya un objeto con ese ID
            if (room.state.objects.some((o) => o.id === createPatch.id)) {
              send(socket, { type: 'error', message: 'ya existe un objeto con ese ID' });
              return;
            }

            // Crear el objeto
            room.state = {
              ...room.state,
              objects: [...room.state.objects, { id: createPatch.id, type: createPatch.type, x: createPatch.x, y: createPatch.y }],
            };
            broadcastToRoom(room, { type: 'room:updated', state: room.state });
            persistRoomState(room.code, room.state, env);
            console.log(`room:update (create object) aceptado en ${room.code}`);
            return;
          }

          if (patch.op === 'remove') {
            // Eliminar un objeto
            const removePatch = patch;
            if (typeof removePatch.objectId !== 'string' || removePatch.objectId.length === 0) {
              send(socket, { type: 'error', message: 'objectId debe ser un string no vacío' });
              return;
            }

            // Verificar que el objeto existe
            const objIndex = room.state.objects.findIndex((o) => o.id === removePatch.objectId);
            if (objIndex === -1) {
              send(socket, { type: 'error', message: 'objeto no encontrado' });
              return;
            }

            // Eliminar el objeto
            room.state = {
              ...room.state,
              objects: room.state.objects.filter((o) => o.id !== removePatch.objectId),
            };
            broadcastToRoom(room, { type: 'room:updated', state: room.state });
            persistRoomState(room.code, room.state, env);
            console.log(`room:update (remove object) aceptado en ${room.code}`);
            return;
          }

          // Distinguir entre patch de nombre y patch de posición de objeto
          if ('objectId' in patch && 'x' in patch && 'y' in patch) {
            // Patch de posición de objeto (formato legacy)
            const objectPatch = patch;
            if (typeof objectPatch.objectId !== 'string' || objectPatch.objectId.length === 0) {
              send(socket, { type: 'error', message: 'objectId debe ser un string no vacío' });
              return;
            }
            if (typeof objectPatch.x !== 'number' || !Number.isFinite(objectPatch.x)) {
              send(socket, { type: 'error', message: 'x debe ser un número finito' });
              return;
            }
            if (typeof objectPatch.y !== 'number' || !Number.isFinite(objectPatch.y)) {
              send(socket, { type: 'error', message: 'y debe ser un número finito' });
              return;
            }

            // Buscar el objeto en el estado de la sala
            const objIndex = room.state.objects.findIndex((obj) => obj.id === objectPatch.objectId);
            if (objIndex === -1) {
              send(socket, { type: 'error', message: 'objeto no encontrado' });
              return;
            }

            // No permitir cambiar id ni type
            const obj = room.state.objects[objIndex];
            if (obj.type !== 'sofa' && obj.type !== 'table') {
              send(socket, { type: 'error', message: 'tipo de objeto no soportado' });
              return;
            }

            // Actualizar la posición
            room.state = {
              ...room.state,
              objects: room.state.objects.map((o, i) =>
                i === objIndex ? { ...o, x: objectPatch.x, y: objectPatch.y } : o
              ),
            };
            broadcastToRoom(room, { type: 'room:updated', state: room.state });
            persistRoomState(room.code, room.state, env);
            console.log(`room:update (object position) aceptado en ${room.code}`);
            return;
          }

          // Patch de nombre (comportamiento existente)
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
            persistRoomState(room.code, room.state, env);
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
// Protocolo mínimo de mensajes de M07.
//
// Dos planos:
// 1. Signaling (cliente ↔ servidor de signaling, Etapa 1): crear/unirse a una
//    sala y retransmitir SDP/ICE entre los dos peers.
// 2. P2P: mensajes que viajarán por RTCDataChannel entre los dos clientes
//    (identificación, estado de jugador y chat) tras la Etapa 2.

// --- Signaling: cliente → servidor ---

export interface SignalingCreateMessage {
  type: 'create';
}

export interface SignalingJoinMessage {
  type: 'join';
  roomCode: string;
}

export interface SignalingRelayMessage {
  type: 'signal';
  data: SignalPayload;
}

// Abandono explícito de la sala (Paso 1 Room-first). En el servidor quita la
// presencia sin eliminar la sala; el peer restante recibe peer-left.
export interface SignalingLeaveMessage {
  type: 'leave';
}

export type ClientSignalingMessage =
  | SignalingCreateMessage
  | SignalingJoinMessage
  | SignalingRelayMessage
  | SignalingLeaveMessage
  | SignalingRoomGetStateMessage
  | SignalingRoomUpdateMessage;

// --- Signaling: servidor → cliente ---

export interface SignalingCreatedMessage {
  type: 'created';
  roomCode: string;
}

export interface SignalingJoinedMessage {
  type: 'joined';
  roomCode: string;
}

export interface SignalingPeerJoinedMessage {
  type: 'peer-joined';
}

export interface SignalingRelayedMessage {
  type: 'signal';
  data: SignalPayload;
}

export interface SignalingPeerLeftMessage {
  type: 'peer-left';
}

export interface SignalingErrorMessage {
  type: 'error';
  message: string;
}

export type ServerSignalingMessage =
  | SignalingCreatedMessage
  | SignalingJoinedMessage
  | SignalingPeerJoinedMessage
  | SignalingRelayedMessage
  | SignalingPeerLeftMessage
  | SignalingErrorMessage
  | SignalingRoomStateMessage
  | SignalingRoomUpdatedMessage;

// --- Room State ---

/**
 * Representación mínima de un objeto persistente dentro de una Room.
 *
 * Cada objeto tiene un id estable (para poder referenciarlo en el futuro),
 * un type que determina la factory Phaser en el cliente, y posición (x, y).
 *
 * RoomObjectState es el estado AUTORITATIVO: el dato que vive en el servidor.
 * La representación visual (Sofa, Table, etc.) se crea a partir de estos datos.
 */
export interface RoomObjectState {
  /** Identificador estable del objeto. Generado por el servidor. */
  id: string;
  /** Tipo del objeto. Determina qué factory Phaser crear. */
  type: 'sofa' | 'table';
  /** Posición X del centro del objeto en la sala (px). */
  x: number;
  /** Posición Y del centro del objeto en la sala (px). */
  y: number;
}

/**
 * Estado compartido de una Room. Vive en el servidor y se consulta vía signaling.
 *
 * RoomState es el estado AUTORITATIVO de la sala. Todos los participantes
 * ven el mismo estado. El servidor es la única fuente de verdad.
 *
 *RoomDirectory (nombre local del usuario) es un concepto distinto:
 * sirve para que cada usuario organice sus salas en la agenda personal.
 * RoomState.name es el nombre real de la Room para todos los participantes.
 */
export interface RoomState {
  /** Versión del contrato de RoomState. Incremental, no implica migración automática. */
  version: 1;
  /**
   * Nombre de la Room. Compartido por todos los participantes.
   * - Creador: puede establecerlo al crear la sala.
   - Cualquier participante: puede modificarlo vía room:update.
   * - Valor inicial: "Sala <roomCode>".
   * - Persiste mientras la Room viva en el servidor.
   */
  name: string;
  /** Ancho de la sala en píxeles. Dimensión autoritativa del servidor. */
  width: number;
  /** Alto de la sala en píxeles. Dimensión autoritativa del servidor. */
  height: number;
  /**
   * Objetos persistentes de la sala (muebles, etc.).
   * Se crean una vez y no cambian en este paso. En el futuro se podrán
   * agregar, mover o eliminar mediante un editor.
   */
  objects: RoomObjectState[];
}

/** Propiedades de RoomState que el cliente puede modificar vía room:update. */
export type RoomStatePatch = Pick<RoomState, 'name'>;

/** Patch para actualizar la posición de un objeto existente en la Room.
 *  No permite modificar id ni type, solo x e y. */
export interface RoomObjectPositionPatch {
  /** Identificador del objeto a mover. */
  objectId: string;
  /** Nueva posición X del centro del objeto (px). */
  x: number;
  /** Nueva posición Y del centro del objeto (px). */
  y: number;
}

/** Patch para crear un nuevo objeto en la Room. */
export interface RoomObjectCreatePatch {
  /** Tipo de operación: crear objeto. */
  op: 'create';
  /** Identificador único del objeto. Generado por el cliente, validado por el servidor. */
  id: string;
  /** Tipo del objeto. Determina qué factory Phaser crear. */
  type: 'sofa' | 'table';
  /** Posición X inicial del centro del objeto (px). */
  x: number;
  /** Posición Y inicial del centro del objeto (px). */
  y: number;
}

/** Patch para eliminar un objeto existente de la Room. */
export interface RoomObjectRemovePatch {
  /** Tipo de operación: eliminar objeto. */
  op: 'remove';
  /** Identificador del objeto a eliminar. */
  objectId: string;
}

/** Unión de todos los patches permitidos en room:update. */
export type RoomUpdatePatch = RoomStatePatch | RoomObjectPositionPatch | RoomObjectCreatePatch | RoomObjectRemovePatch;

// --- Mensajes de Room State: cliente → servidor ---

export interface SignalingRoomGetStateMessage {
  type: 'room:get-state';
}

export interface SignalingRoomUpdateMessage {
  type: 'room:update';
  patch: RoomUpdatePatch;
}

// --- Mensajes de Room State: servidor → cliente ---

export interface SignalingRoomStateMessage {
  type: 'room:state';
  state: RoomState;
}

export interface SignalingRoomUpdatedMessage {
  type: 'room:updated';
  state: RoomState;
}

// --- Payload de signaling (SDP offer/answer e ICE candidate) ---

export interface SignalPayloadOffer {
  kind: 'offer';
  sdp: string;
}

export interface SignalPayloadAnswer {
  kind: 'answer';
  sdp: string;
}

export interface SignalPayloadIce {
  kind: 'ice';
  candidate: string;
  sdpMid?: string;
  sdpMLineIndex?: number;
}

export type SignalPayload = SignalPayloadOffer | SignalPayloadAnswer | SignalPayloadIce;

// --- Mensajes P2P (futuro canal de datos) ---

export const MAX_NAME_LENGTH = 16;
export const MAX_CHAT_LENGTH = 200;

export interface PeerPlayerConnectedMessage {
  type: 'player_connected';
  playerId: string;
  name: string;
}

export interface PeerPlayerStateMessage {
  type: 'player_state';
  playerId: string;
  x: number;
  y: number;
  sitting: boolean;
}

export interface PeerPlayerDisconnectedMessage {
  type: 'player_disconnected';
  playerId: string;
}

export interface PeerChatMessage {
  type: 'chat';
  playerId: string;
  text: string;
}

export type PeerMessage =
  | PeerPlayerConnectedMessage
  | PeerPlayerStateMessage
  | PeerPlayerDisconnectedMessage
  | PeerChatMessage;

// --- Serialización / deserialización (sin confiar en el peer) ---

export function serializePeerMessage(message: PeerMessage): string {
  return JSON.stringify(message);
}

/** Parse y valida un mensaje P2P. Devuelve null si no es seguro usarlo. */
export function parsePeerMessage(raw: string): PeerMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof value !== 'object' || value === null) return null;
  const m = value as Record<string, unknown>;

  switch (m.type) {
    case 'player_connected': {
      if (!isNonEmptyString(m.playerId)) return null;
      if (!isWritableName(m.name)) return null;
      return { type: 'player_connected', playerId: m.playerId, name: m.name };
    }
    case 'player_state': {
      if (!isNonEmptyString(m.playerId)) return null;
      if (typeof m.x !== 'number' || !Number.isFinite(m.x)) return null;
      if (typeof m.y !== 'number' || !Number.isFinite(m.y)) return null;
      if (typeof m.sitting !== 'boolean') return null;
      return { type: 'player_state', playerId: m.playerId, x: m.x, y: m.y, sitting: m.sitting };
    }
    case 'player_disconnected': {
      if (!isNonEmptyString(m.playerId)) return null;
      return { type: 'player_disconnected', playerId: m.playerId };
    }
    case 'chat': {
      if (!isNonEmptyString(m.playerId)) return null;
      if (typeof m.text !== 'string' || m.text.length === 0 || m.text.length > MAX_CHAT_LENGTH) {
        return null;
      }
      return { type: 'chat', playerId: m.playerId, text: m.text };
    }
    default:
      return null;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isWritableName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_NAME_LENGTH;
}
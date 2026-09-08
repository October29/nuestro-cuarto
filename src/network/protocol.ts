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

/** Estado persistente de una Room. Vive en el servidor y se consulta vía signaling. */
export interface RoomState {
  /** Versión del contrato de RoomState. Incremental, no implica migración automática. */
  version: 1;
  /** Campo experimental para validar el mecanismo de escritura. Será reemplazado. */
  testValue: string;
}

/** Propiedades de RoomState que el cliente puede modificar vía room:update. */
export type RoomStatePatch = Pick<RoomState, 'testValue'>;

// --- Mensajes de Room State: cliente → servidor ---

export interface SignalingRoomGetStateMessage {
  type: 'room:get-state';
}

export interface SignalingRoomUpdateMessage {
  type: 'room:update';
  patch: RoomStatePatch;
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
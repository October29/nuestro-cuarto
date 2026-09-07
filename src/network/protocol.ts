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
  participantId: string;
}

export interface SignalingJoinMessage {
  type: 'join';
  roomCode: string;
  participantId: string;
}

export interface SignalingResumeMessage {
  type: 'resume';
  roomCode: string;
  participantId: string;
  role: 'host' | 'visitor';
}

export interface SignalingLeaveMessage {
  type: 'leave';
}

export interface SignalingRelayMessage {
  type: 'signal';
  data: SignalPayload;
}

export type ClientSignalingMessage =
  | SignalingCreateMessage
  | SignalingJoinMessage
  | SignalingResumeMessage
  | SignalingLeaveMessage
  | SignalingRelayMessage;

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

// Avisa al participante que su peer volvió a estar activo y que debe
// renegociar la conexión WebRTC desde cero (M08-C).
export interface SignalingPeerResumedMessage {
  type: 'peer-resumed';
}

// Confirmación de un resume: la sala fue reocupada. peerActive indica si el
// otro participante está conectado en este momento.
export interface SignalingResumedMessage {
  type: 'resumed';
  roomCode: string;
  peerActive: boolean;
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
  | SignalingPeerResumedMessage
  | SignalingResumedMessage
  | SignalingErrorMessage;

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
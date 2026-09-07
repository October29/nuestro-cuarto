// Persistencia mínima de sesión para la recuperación tras recarga (M08-C).
//
// Dos capas:
// 1. Identidades estables (participantId / playerId): se generan una vez y no
//    se borran. El servidor usa participantId para reclamar el slot; playerId
//    evita que el peer cree un RemotePlayer duplicado tras la recarga.
// 2. Sesión activa ({roomCode, role}): se guarda al crear/unir/recuperar una
//    sala y se borra al salir o cuando la sala desaparece.

const SESSION_KEY = 'nuestro-cuarto:session';
const PARTICIPANT_KEY = 'nuestro-cuarto:participantId';
const PLAYER_KEY = 'nuestro-cuarto:playerId';

export interface SavedSession {
  roomCode: string;
  role: 'host' | 'visitor';
  participantId: string;
  playerId: string;
}

function storage(): Storage | null {
  try {
    const s = (globalThis as { localStorage?: Storage }).localStorage;
    return s && typeof s.getItem === 'function' ? s : null;
  } catch {
    return null;
  }
}

function generateId(prefix: string): string {
  const random = (Math.random() + 1).toString(36).slice(2, 12);
  return `${prefix}-${random}`;
}

/** Identidad estable del participante para reclamar su slot en el servidor. */
export function getOrCreateParticipantId(): string {
  const s = storage();
  if (s) {
    const existing = s.getItem(PARTICIPANT_KEY);
    if (existing) return existing;
  }
  const id = generateId('participant');
  s?.setItem(PARTICIPANT_KEY, id);
  return id;
}

/** Identidad estable del jugador local para que el peer actualice el mismo RemotePlayer. */
export function getOrCreatePlayerId(): string {
  const s = storage();
  if (s) {
    const existing = s.getItem(PLAYER_KEY);
    if (existing) return existing;
  }
  const id = generateId('player');
  s?.setItem(PLAYER_KEY, id);
  return id;
}

export function loadSavedSession(): SavedSession | null {
  const s = storage();
  if (!s) return null;
  const raw = s.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<SavedSession>;
    if (
      typeof value.roomCode === 'string' &&
      value.roomCode.length > 0 &&
      (value.role === 'host' || value.role === 'visitor') &&
      typeof value.participantId === 'string' &&
      typeof value.playerId === 'string'
    ) {
      return value as SavedSession;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveSession(
  session: Pick<SavedSession, 'roomCode' | 'role' | 'participantId'> & Partial<Pick<SavedSession, 'playerId'>>,
): void {
  const s = storage();
  if (!s) return;
  const current = loadSavedSession();
  const next: SavedSession = {
    playerId: session.playerId ?? getOrCreatePlayerId(),
    ...current,
    ...session,
  };
  s.setItem(SESSION_KEY, JSON.stringify(next));
}

export function clearSavedSession(): void {
  const s = storage();
  if (!s) return;
  s.removeItem(SESSION_KEY);
}
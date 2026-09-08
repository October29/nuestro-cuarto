// Libreta local de direcciones ("Mis salas").
//
// La Room y todo su estado pertenecen al SERVIDOR. El cliente solo recuerda
// cómo ENCONTRAR una sala: cada entrada es únicamente { roomId, name }.
//
// NO guarda posiciones, muebles, pizarra, configuración del mundo, estado de
// participantes, estado de conexión/WebRTC, participantId, playerId ni ningún
// snapshot de la Room. NO es un mecanismo de sesión ni de "resume": volver a
// una sala es siempre joinRoom(roomId).
//
// Se puede respaldar en localStorage, tratado exclusivamente como libreta de
// direcciones. Sin storage disponible (tests, modos privados) funciona en
// memoria: persiste el comportamiento, no la permanencia.

const STORAGE_KEY = 'nuestro-cuarto:mis-salas:v1';

export interface SavedRoom {
  roomId: string;
  name: string;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
      return globalThis.localStorage as StorageLike;
    }
  } catch {
    // localStorage puede no estar disponible (privacidad, entornos sin navegador).
  }
  return null;
}

export class RoomDirectory {
  private rooms = new Map<string, SavedRoom>();
  private readonly storage: StorageLike | null;

  constructor(storage: StorageLike | null = defaultStorage()) {
    this.storage = storage;
    this.load();
  }

  /** Guarda (o actualiza) una sala en la libreta. Devuelve la entrada final. */
  save(roomId: string, name: string): SavedRoom {
    const id = normalizeRoomId(roomId);
    const entry: SavedRoom = { roomId: id, name: normalizedName(name, id) };
    this.rooms.set(id, entry);
    this.persist();
    return entry;
  }

  /** Salas guardadas, en orden de inserción. */
  list(): SavedRoom[] {
    return [...this.rooms.values()].map((room) => ({ ...room }));
  }

  /** Busca por roomId. Devuelve null si no está guardada. */
  get(roomId: string): SavedRoom | null {
    const found = this.rooms.get(normalizeRoomId(roomId));
    return found ? { ...found } : null;
  }

  /** Olvida la sala de la libreta. Solo afecta a ESTA libreta, nunca a la
   * Room del servidor. Devuelve true si existía y se quitó. */
  remove(roomId: string): boolean {
    const deleted = this.rooms.delete(normalizeRoomId(roomId));
    if (deleted) this.persist();
    return deleted;
  }

  private load(): void {
    if (!this.storage) return;
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(STORAGE_KEY);
    } catch {
      return;
    }
    if (!raw) return;

    try {
      const entries: unknown = JSON.parse(raw);
      if (!Array.isArray(entries)) return;
      for (const entry of entries) {
        if (typeof entry !== 'object' || entry === null) continue;
        const candidate = entry as Record<string, unknown>;
        if (typeof candidate.roomId !== 'string' || candidate.roomId.length === 0) continue;
        const roomId = normalizeRoomId(candidate.roomId);
        const name =
          typeof candidate.name === 'string' && candidate.name.length > 0
            ? candidate.name
            : `Sala ${roomId}`;
        this.rooms.set(roomId, { roomId, name });
      }
    } catch {
      // Datos corruptos: se ignora y la libreta arranca vacía.
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.list()));
    } catch {
      // Cuota/permisos: la libreta sigue en memoria; no se lanza.
    }
  }
}

function normalizeRoomId(roomId: string): string {
  return roomId.trim().toUpperCase();
}

function normalizedName(name: string, roomId: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : `Sala ${roomId}`;
}
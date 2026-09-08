// Almacenamiento de memoria para tests, con la misma forma que localStorage.
// Permite probar la persistencia de la libreta (varios módulos sobre la misma
// storage) sin un navegador.

export class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}
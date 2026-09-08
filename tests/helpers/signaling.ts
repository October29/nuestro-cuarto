// Helper de tests para signaling: servidor real en proceso + cliente WS.
//
// Usa el WebSocket global de Node (undici), así que los tests no dependen de
// la librería 'ws' del paquete signaling.

import { createSignalingServer } from '../../signaling/server.mjs';

export interface TestSignalingServer {
  url: string;
  close: () => Promise<void>;
}

export async function startTestSignaling(): Promise<TestSignalingServer> {
  // Puerto 0: el SO asigna un puerto libre, evitando colisiones entre los
  // múltiples servidores que arrancan en paralelo (los tests se ejecutan
  // concurrentemente). El puerto real se lee una vez que escucha.
  const server = createSignalingServer({ port: 0 });
  const port = await new Promise<number>((resolve, reject) => {
    server.wss.on('listening', () => {
      const address = server.wss.address();
      const p = typeof address === 'object' && address ? address.port : 0;
      if (p) resolve(p);
      else reject(new Error('no se pudo determinar el puerto del signaling de test'));
    });
    server.wss.on('error', reject);
  });
  return {
    url: `ws://127.0.0.1:${port}`,
    async close() {
      server.close();
      await new Promise((resolve) => setTimeout(resolve, 40));
    },
  };
}

export type SignalPayload = {
  kind?: string;
  [key: string]: unknown;
};

export class WsTestClient {
  private socket: WebSocket | null = null;
  private ready: Promise<void>;
  private messages: unknown[] = [];
  private waiters: Array<(value: unknown) => void> = [];
  readonly closed: Promise<void>;

  constructor(private url: string) {
    this.socket = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      const onOpen = () => {
        this.socket!.removeEventListener('open', onOpen);
        resolve();
      };
      const onError = () => {
        const message = 'fallo al conectar con el servidor de signaling';
        this.socket!.removeEventListener('error', onError);
        reject(new Error(message));
      };
      this.socket!.addEventListener('open', onOpen);
      this.socket!.addEventListener('error', onError);
    });
    this.closed = new Promise((resolve) => {
      this.socket!.addEventListener('close', () => resolve());
    });
    this.socket!.addEventListener('message', (event: MessageEvent) => {
      let value: unknown;
      try {
        value = JSON.parse(String(event.data));
      } catch {
        value = { raw: String(event.data) };
      }
      const waiter = this.waiters.shift();
      if (waiter) waiter(value);
      else this.messages.push(value);
    });
  }

  open(): Promise<void> {
    return this.ready;
  }

  send(message: unknown): void {
    this.socket!.send(JSON.stringify(message));
  }

  async next(): Promise<unknown> {
    const queued = this.messages.shift();
    if (queued !== undefined) return queued;
    if (this.socket!.readyState !== WebSocket.OPEN) {
      throw new Error('socket cerrado');
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  async close(): Promise<void> {
    if (this.socket) {
      this.socket.close();
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
  }
}

/** Espera hasta que la condición se cumpla (mensajes asíncronos del servidor). */
export async function waitFor(
  condition: () => boolean,
  timeoutMs = 2000,
  stepMs = 20,
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor: la condición no se cumplió en el tiempo esperado');
    }
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
}
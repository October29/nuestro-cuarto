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
  const port = 9800 + Math.floor(Math.random() * 500);
  const server = createSignalingServer({ port });
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
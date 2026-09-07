// Ayuda para probar el signaling con un servidor real en proceso (M08-C).
// Node (v26) expone WebSocket global; `ws` se resuelve desde signaling/.
import { createSignalingServer } from '../../signaling/server.mjs';

export interface TestSignalingServer {
  url: string;
  close(): Promise<void>;
  wss: Awaited<ReturnType<typeof createSignalingServer>>['wss'];
}

export async function startTestSignaling(options: { graceMs?: number } = {}): Promise<TestSignalingServer> {
  const { wss, close } = createSignalingServer({ port: 0, graceMs: options.graceMs });
  await new Promise<void>((resolve) => wss.once('listening', resolve));
  const port = (wss.address() as { port: number }).port;
  return {
    url: `ws://127.0.0.1:${port}`,
    wss,
    close: () => {
      close();
      return Promise.resolve();
    },
  };
}

export type TestServerMessage = {
  type: string;
  [key: string]: unknown;
};

/**
 * Cliente WebSocket de test que acumula los mensajes recibidos y permite
 * esperar el siguiente de un tipo concreto (independiente del orden).
 */
export class WsTestClient {
  readonly ws: WebSocket;
  private pending: TestServerMessage[] = [];
  private waiters: { type: string; resolve: (m: TestServerMessage) => void; timeout: ReturnType<typeof setTimeout>; done: boolean }[] = [];
  private closed = false;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.onmessage = (event) => {
      const raw = String(event.data);
      let msg: unknown = null;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      const typed = msg as TestServerMessage;
      const waiter = this.waiters.find((w) => w.type === typed.type && !w.done);
      if (waiter) {
        waiter.done = true;
        clearTimeout(waiter.timeout);
        waiter.resolve(typed);
      } else {
        this.pending.push(typed);
      }
    };
    this.ws.onclose = () => {
      this.closed = true;
    };
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error('fallo al abrir el WebSocket de test'));
    });
  }

  /** Cierra el socket y espera un poco para que el servidor procese el 'close'. */
  async close(): Promise<void> {
    this.ws.close();
    await new Promise((r) => setTimeout(r, 80));
  }

  send(obj: unknown): void {
    this.ws.send(JSON.stringify(obj));
  }

  /** Espera el siguiente mensaje de `type`; si ya llegó antes, lo devuelve. */
  next(type: string, timeoutMs = 2000): Promise<TestServerMessage> {
    const existing = this.pending.findIndex((m) => m.type === type);
    if (existing !== -1) {
      const [msg] = this.pending.splice(existing, 1);
      return Promise.resolve(msg);
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`timeout esperando mensaje ${type}`)), timeoutMs);
      this.waiters.push({ type, resolve, timeout, done: false });
    });
  }
}
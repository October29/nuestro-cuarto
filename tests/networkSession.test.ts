// Paso 2 Room-first: NetworkSession.leave() y comportamiento de peer-left.
//
// Se usa el servidor signaling real (en proceso) y un transporte mock:
// WebRTC queda fuera del alcance de este paso. Los tests demuestran:
//   1. leave() anuncia el abandono al servidor.
//   2. El que hace leave desaparece de la presencia.
//   3. La Room continúa existiendo.
//   4. Otro participante puede entrar después en esa misma Room.
//   5. peer-left NO expulsa al participante que permanece.
//   6. Una Room puede quedar con cero participantes y seguir existiendo.

import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { NetworkSession, type SessionHandlers } from '../src/network/NetworkSession';
import type { NetworkTransport, TransportHandlers } from '../src/network/NetworkTransport';
import { startTestSignaling, waitFor, type TestSignalingServer } from './helpers/signaling';

let server: TestSignalingServer | null = null;

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
});

async function withServer(): Promise<TestSignalingServer> {
  server = await startTestSignaling();
  return server;
}

class MockTransport implements NetworkTransport {
  public closeCalls = 0;
  constructor(private readonly handlers: TransportHandlers) {}
  connect(): Promise<void> {
    this.handlers.onOpen();
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  send(): boolean {
    return true;
  }
  close(): void {
    this.closeCalls += 1;
  }
}

interface TrackedSession {
  session: NetworkSession;
  /** Disponible una vez que la sesión crea/une su transporte (createRoom/joinRoom). */
  readonly transport: MockTransport;
  events: string[];
}

function makeSession(s: TestSignalingServer, events: string[]): TrackedSession {
  let transport: MockTransport | null = null;
  const handlers: SessionHandlers = {
    onOpen: () => events.push('onOpen'),
    onMessage: () => events.push('onMessage'),
    onPeerLeft: (reason) => events.push(`onPeerLeft:${reason}`),
    onError: () => events.push('onError'),
    onRoomCreated: () => events.push('onRoomCreated'),
  };
  const session = new NetworkSession({
    handlers,
    signalingUrl: s.url,
    makeTransport: (_signaling, transportHandlers, _role) => {
      transport = new MockTransport(transportHandlers);
      return transport;
    },
  });
  return {
    session,
    events,
    get transport(): MockTransport {
      assert.ok(transport, 'el transporte mock aún no se ha creado');
      return transport as MockTransport;
    },
  };
}

describe('NetworkSession.leave(): abandono explícito de la sala', () => {
  test('leave anuncia, retira al que abandona y NO expulsa al que permanece', async () => {
    const s = await withServer();

    const host = makeSession(s, []);
    const guest = makeSession(s, []);

    const code = await host.session.createRoom();
    await guest.session.joinRoom(code); // el host se entera vía peer-joined
    assert.equal(host.session.hasPeer, true, 'el host debe ver presencia de peer');
    assert.equal(guest.session.state, 'connected');

    guest.session.leave();

    // El host recibe peer-left (signaling): baja hasPeer pero NADA más.
    await waitFor(() => host.session.hasPeer === false);
    assert.equal(host.session.state, 'connected', 'peer-left no es terminal para el host');
    assert.ok(!host.events.includes('onPeerLeft'), 'el signaling peer-left no cierra la sesión');
    assert.ok(!host.events.includes('onError'));
    assert.ok(host.session.roomCode === code, 'la sesión que permanece conserva su sala');
    assert.equal(guest.session.state, 'disconnected', 'el que abandona termina desconectado');
    assert.equal(guest.transport.closeCalls, 1, 'leave() cierra el transporte del que se va');
    assert.equal(host.transport.closeCalls, 0, 'el transporte del que permanece no se cierra');

    // La Room sigue existiendo: otro participante entra y el host lo ve.
    const latecomer = makeSession(s, []);
    await latecomer.session.joinRoom(code);
    await waitFor(() => host.session.hasPeer === true);
    assert.equal(host.session.state, 'connected');

    await latecomer.session.close();
    await guest.session.close();
    await host.session.close();
  });

  test('la desconexión (close sin leave) del peer tampoco expulsa al host', async () => {
    const s = await withServer();

    const host = makeSession(s, []);
    const guest = makeSession(s, []);
    const code = await host.session.createRoom();
    await guest.session.joinRoom(code);
    assert.equal(host.session.hasPeer, true);

    guest.session.close(); // desconexión brusca: sin leave anunciado

    await waitFor(() => host.session.hasPeer === false);
    assert.equal(host.session.state, 'connected', 'el host no se cierra por el cierre del peer');
    assert.ok(!host.events.includes('onPeerLeft'));
    assert.ok(host.session.roomCode === code);

    const latecomer = makeSession(s, []);
    await latecomer.session.joinRoom(code);

    await latecomer.session.close();
    await host.session.close();
  });

  test('una Room puede quedar con cero participantes y seguir existiendo (API)', async () => {
    const s = await withServer();

    const host = makeSession(s, []);
    const guest = makeSession(s, []);
    const code = await host.session.createRoom();
    await guest.session.joinRoom(code);

    host.session.leave(); // el host se va, el guest queda solo
    await waitFor(() => guest.session.hasPeer === false);
    assert.equal(guest.session.state, 'connected');

    guest.session.close(); // cero participantes en la sala

    const latecomer = makeSession(s, []);
    await latecomer.session.joinRoom(code); // reentra en la misma Room vacía
    assert.equal(latecomer.session.state, 'connected');
    assert.equal(latecomer.session.roomCode, code);

    await latecomer.session.close();
  });
});

describe('Paso 5: el contrato público no expone semántica HOST/VISITOR', () => {
  test('NetworkSession no ofrece getter role ni etiquetas host/visitor', () => {
    const handlers: SessionHandlers = {
      onOpen: () => {},
      onMessage: () => {},
      onPeerLeft: () => {},
      onError: () => {},
    };
    const session = new NetworkSession({ handlers });
    const api = session as unknown as Record<string, unknown>;

    assert.equal('role' in api, false, 'no debe existir role en el contrato público');
    assert.equal(api.role, undefined);

    // El resto del contrato público orientado a la Room sí está presente.
    assert.equal('roomCode' in api, true, 'roomCode sigue existiendo');
    assert.equal('hasPeer' in api, true, 'hasPeer sigue existiendo');
    assert.equal('state' in api, true, 'state sigue existiendo');
    assert.equal('send' in api, true, 'send sigue existiendo');
    assert.equal('leave' in api, true, 'leave sigue existiendo');
    assert.equal('close' in api, true, 'close sigue existiendo');
    assert.equal('createRoom' in api, true, 'createRoom sigue existiendo');
    assert.equal('joinRoom' in api, true, 'joinRoom sigue existiendo');
  });
});

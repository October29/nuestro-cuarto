import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { startTestSignaling, WsTestClient } from './helpers/signaling';
import type { TestSignalingServer } from './helpers/signaling';

const HOST_ID = 'participant-host';
const VISITOR_ID = 'participant-visitor';
const OUTSIDER_ID = 'participant-intruso';

describe('signaling/server.mjs — flujo normal', () => {
  let server: TestSignalingServer;
  afterEach(async () => {
    await server?.close();
  });

  it('create + join funciona y el servidor retransmite signal', async () => {
    server = await startTestSignaling();
    const host = new WsTestClient(server.url);
    await host.open();

    host.send({ type: 'create', participantId: HOST_ID });
    const created = await host.next('created');
    const code = created.roomCode as string;
    assert.equal(created.type, 'created');
    assert.ok(typeof code === 'string' && code.length === 6);

    const visitor = new WsTestClient(server.url);
    await visitor.open();
    visitor.send({ type: 'join', roomCode: code, participantId: VISITOR_ID });
    const joined = await visitor.next('joined');
    assert.equal(joined.roomCode, code);

    const peerJoined = await host.next('peer-joined');
    assert.equal(peerJoined.type, 'peer-joined');

    host.send({ type: 'signal', data: { kind: 'ice', candidate: 'candidate-a' } });
    const relayed = await visitor.next('signal');
    assert.deepEqual(relayed.data, { kind: 'ice', candidate: 'candidate-a' });

    await host.close();
    await visitor.close();
  });

  it('la sala está llena a partir del segundo participante', async () => {
    server = await startTestSignaling();
    const host = new WsTestClient(server.url);
    await host.open();
    host.send({ type: 'create', participantId: HOST_ID });
    const code = (await host.next('created')).roomCode as string;

    const visitor = new WsTestClient(server.url);
    await visitor.open();
    visitor.send({ type: 'join', roomCode: code, participantId: VISITOR_ID });
    await visitor.next('joined');

    const intruder = new WsTestClient(server.url);
    await intruder.open();
    intruder.send({ type: 'join', roomCode: code, participantId: OUTSIDER_ID });
    const err = await intruder.next('error');
    assert.match(err.message as string, /sala llena/);
  });

  it('el signaling retransmite el signal SOLO al otro participante', async () => {
    server = await startTestSignaling();
    const host = new WsTestClient(server.url);
    await host.open();
    host.send({ type: 'create', participantId: HOST_ID });
    const code = (await host.next('created')).roomCode as string;

    const visitorA = new WsTestClient(server.url);
    await visitorA.open();
    visitorA.send({ type: 'join', roomCode: code, participantId: VISITOR_ID });
    await visitorA.next('joined');

    host.send({ type: 'signal', data: { kind: 'offer', sdp: 'sdp-host' } });
    const offer = await visitorA.next('signal');
    assert.equal((offer.data as { sdp: string }).sdp, 'sdp-host');

    visitorA.send({ type: 'signal', data: { kind: 'answer', sdp: 'sdp-visitor' } });
    const answer = await host.next('signal');
    assert.equal((answer.data as { sdp: string }).sdp, 'sdp-visitor');
  });
});

describe('signaling/server.mjs — recuperación (M08-C)', () => {
  let server: TestSignalingServer;
  afterEach(async () => {
    await server?.close();
  });

  async function hostInRoom() {
    const host = new WsTestClient(server.url);
    await host.open();
    host.send({ type: 'create', participantId: HOST_ID });
    const code = (await host.next('created')).roomCode as string;
    const visitor = new WsTestClient(server.url);
    await visitor.open();
    visitor.send({ type: 'join', roomCode: code, participantId: VISITOR_ID });
    await visitor.next('joined');
    await host.next('peer-joined');
    return { code, host, visitor };
  }

  it('el host puede recuperar su sala con su identidad (el visitor recibe peer-resumed)', async () => {
    server = await startTestSignaling();
    const { code, host, visitor } = await hostInRoom();

    await host.close();
    // El slot del host queda "recovering" durante la gracia; el visitor sigue en la sala.

    const recoveredHost = new WsTestClient(server.url);
    await recoveredHost.open();
    recoveredHost.send({ type: 'resume', roomCode: code, participantId: HOST_ID, role: 'host' });
    const resumed = await recoveredHost.next('resumed');
    assert.equal(resumed.roomCode, code);
    assert.equal(resumed.peerActive, true, 'el visitor sigue conectado');

    const peerResumed = await visitor.next('peer-resumed');
    assert.equal(peerResumed.type, 'peer-resumed');
  });

  it('el visitor puede recuperar su slot (el host activo recibe peer-resumed)', async () => {
    server = await startTestSignaling();
    const { code, host, visitor } = await hostInRoom();

    await visitor.close();
    const recoveredVisitor = new WsTestClient(server.url);
    await recoveredVisitor.open();
    recoveredVisitor.send({ type: 'resume', roomCode: code, participantId: VISITOR_ID, role: 'visitor' });
    const resumed = await recoveredVisitor.next('resumed');
    assert.equal(resumed.peerActive, true);

    const peerResumed = await host.next('peer-resumed');
    assert.equal(peerResumed.type, 'peer-resumed');
  });

  it('un participante recupera aunque su peer aún no haya vuelto (peerActive=false)', async () => {
    server = await startTestSignaling();
    const { code, host, visitor } = await hostInRoom();

    // Ambos se van (suspensión simultánea).
    await host.close();
    await visitor.close();

    const recoveredHost = new WsTestClient(server.url);
    await recoveredHost.open();
    recoveredHost.send({ type: 'resume', roomCode: code, participantId: HOST_ID, role: 'host' });
    const resumed = await recoveredHost.next('resumed');
    assert.equal(resumed.peerActive, false);

    const recoveredVisitor = new WsTestClient(server.url);
    await recoveredVisitor.open();
    recoveredVisitor.send({ type: 'resume', roomCode: code, participantId: VISITOR_ID, role: 'visitor' });
    const resumedVisitor = await recoveredVisitor.next('resumed');
    assert.equal(resumedVisitor.peerActive, true, 'el host ya regresó');
    // El host recuperado recibe el trigger para arrancar la negociación.
    const hostTrigger = await recoveredHost.next('peer-resumed');
    assert.equal(hostTrigger.type, 'peer-resumed');
  });

  it('un visitante no recuperado no puede ocupar el slot de otro participante', async () => {
    server = await startTestSignaling();
    const { code, host, visitor } = await hostInRoom();
    await host.close();
    await visitor.close();

    const intruder = new WsTestClient(server.url);
    await intruder.open();
    intruder.send({ type: 'resume', roomCode: code, participantId: OUTSIDER_ID, role: 'visitor' });
    const err = await intruder.next('error');
    assert.match(err.message as string, /sesión no encontrada/);
  });

  it('resume con el rol equivocado se rechaza', async () => {
    server = await startTestSignaling();
    const { code, host, visitor } = await hostInRoom();
    await host.close();
    await visitor.close();

    const wrongRole = new WsTestClient(server.url);
    await wrongRole.open();
    wrongRole.send({ type: 'resume', roomCode: code, participantId: HOST_ID, role: 'visitor' });
    const err = await wrongRole.next('error');
    assert.match(err.message as string, /rol de sesión incorrecto/);
  });

  it('dos recuperaciones simultáneas del mismo slot: solo la primera gana', async () => {
    server = await startTestSignaling();
    const { code, host, visitor } = await hostInRoom();
    await host.close();
    await visitor.close();

    const first = new WsTestClient(server.url);
    await first.open();
    first.send({ type: 'resume', roomCode: code, participantId: HOST_ID, role: 'host' });
    await first.next('resumed');

    const second = new WsTestClient(server.url);
    await second.open();
    second.send({ type: 'resume', roomCode: code, participantId: HOST_ID, role: 'host' });
    const err = await second.next('error');
    assert.match(err.message as string, /ya reclamada/);
  });

  it('la ventana de recuperación expira y el slot se libera (peer-left al activo)', async () => {
    server = await startTestSignaling({ graceMs: 60 });
    const { code, host, visitor } = await hostInRoom();

    await host.close();
    // El visitor activo recibe peer-left cuando la gracia expira. El sweep
    // corre cada 2s, por eso el timeout de espera se amplía.
    const peerLeft = await visitor.next('peer-left', 5000);
    assert.equal(peerLeft.type, 'peer-left');

    const tooLate = new WsTestClient(server.url);
    await tooLate.open();
    tooLate.send({ type: 'resume', roomCode: code, participantId: HOST_ID, role: 'host' });
    const err = await tooLate.next('error');
    // El slot del host ya se liberó: la identidad ya no calza (o, si la sala se
    // cerró del todo, da "sala no encontrada").
    assert.match(err.message as string, /sala no encontrada|identidad no coincide/);
  });

  it('la ventana de gracia del host permite reocupar la MISMÍSIMA sala sin duplicarla', async () => {
    server = await startTestSignaling();
    const host = new WsTestClient(server.url);
    await host.open();
    host.send({ type: 'create', participantId: HOST_ID });
    const code = (await host.next('created')).roomCode as string;

    await host.close();
    const recovered = new WsTestClient(server.url);
    await recovered.open();
    recovered.send({ type: 'resume', roomCode: code, participantId: HOST_ID, role: 'host' });
    const resumed = await recovered.next('resumed');
    assert.equal(resumed.roomCode, code, 'el resume conserva el mismo código de sala');

    // Un visitor puede unirse al código original: la sala no se duplicó.
    const visitor = new WsTestClient(server.url);
    await visitor.open();
    visitor.send({ type: 'join', roomCode: code, participantId: VISITOR_ID });
    await visitor.next('joined');
  });
});

describe('signaling/server.mjs — cierre explícito y mensajes inválidos', () => {
  let server: TestSignalingServer;
  afterEach(async () => {
    await server?.close();
  });

  it('leave explícito libera el slot al instante (peer-left inmediato al otro)', async () => {
    server = await startTestSignaling();
    const host = new WsTestClient(server.url);
    await host.open();
    host.send({ type: 'create', participantId: HOST_ID });
    const code = (await host.next('created')).roomCode as string;

    const visitor = new WsTestClient(server.url);
    await visitor.open();
    visitor.send({ type: 'join', roomCode: code, participantId: VISITOR_ID });
    await visitor.next('joined');
    await host.next('peer-joined');

    visitor.send({ type: 'leave' });
    const peerLeft = await host.next('peer-left');
    assert.equal(peerLeft.type, 'peer-left');

    // El hueco del visitor queda libre: un visitante nuevo puede unirse.
    const newcomer = new WsTestClient(server.url);
    await newcomer.open();
    newcomer.send({ type: 'join', roomCode: code, participantId: OUTSIDER_ID });
    await newcomer.next('joined');
  });

  it('al abandonar la sala el host, ya no se puede unir ese código', async () => {
    server = await startTestSignaling();
    const host = new WsTestClient(server.url);
    await host.open();
    host.send({ type: 'create', participantId: HOST_ID });
    const code = (await host.next('created')).roomCode as string;

    host.send({ type: 'leave' });
    await new Promise((r) => setTimeout(r, 30));

    const late = new WsTestClient(server.url);
    await late.open();
    late.send({ type: 'join', roomCode: code, participantId: VISITOR_ID });
    const err = await late.next('error');
    assert.match(err.message as string, /sala no encontrada/);
  });

  it('los mensajes inválidos siguen siendo rechazados', async () => {
    server = await startTestSignaling();
    const client = new WsTestClient(server.url);
    await client.open();

    client.ws.send('esto-no-es-json');
    const invalid = await client.next('error');
    assert.match(invalid.message as string, /mensaje inválido/);

    client.send({ type: 'tipo-desconocido' });
    const unknown = await client.next('error');
    assert.match(unknown.message as string, /tipo de mensaje desconocido/);

    client.send({ type: 'create' });
    const noId = await client.next('error');
    assert.match(noId.message as string, /participantId requerido/);
  });
});
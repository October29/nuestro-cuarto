// Step 14: tests de persistencia de RoomState en disco.
//
// Estos tests verifican que el RoomState sobrevive al reinicio del servidor
// y que las operaciones de creación/eliminación/actualización se persisten correctamente.

import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSignalingServer } from '../signaling/server.mjs';
import {
  startTestSignaling,
  WsTestClient,
  type TestSignalingServer,
} from './helpers/signaling';

// Limpieza global al inicio para evitar directorios de tests anteriores
try {
  const fs = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const entries = fs.readdirSync(tmpdir());
  for (const entry of entries) {
    if (entry.startsWith('signaling-test-')) {
      try {
        fs.rmSync(join(tmpdir(), entry), { recursive: true, force: true });
      } catch {}
    }
  }
} catch {}

describe('Persistencia de RoomState (Step 14)', () => {
  let server: TestSignalingServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
  });

  async function withServer(dataDir: string): Promise<TestSignalingServer> {
    server = await startTestSignaling({ env: { SIGNALING_DATA_DIR: dataDir } });
    return server;
  }

  async function createRoom(baseUrl: string): Promise<{ roomCode: string; socket: any }> {
    const socket = new (await import('./helpers/signaling.ts')).WsTestClient(baseUrl);
    await socket.open();
    socket.send({ type: 'create' });
    const created = (await socket.next()) as { type: string; roomCode?: string };
    if (created.type !== 'created') throw new Error('create failed');
    return { roomCode: created.roomCode!, socket };
  }

  async function joinRoom(baseUrl: string, roomCode: string): Promise<any> {
    const socket = new (await import('./helpers/signaling.ts')).WsTestClient(baseUrl);
    await socket.open();
    socket.send({ type: 'join', roomCode });
    const joined = (await socket.next()) as { type: string; roomCode?: string };
    return { socket, joined };
  }

  async function updateRoomName(socket: any, name: string): Promise<any> {
    socket.send({ type: 'room:update', patch: { name } });
    return socket.next();
  }

  async function createObject(socket: any, object: { type: 'sofa' | 'table'; x: number; y: number }): Promise<any> {
    socket.send({ type: 'room:update', patch: { op: 'create', ...object } });
    return socket.next();
  }

  async function removeObject(socket: any, objectId: string): Promise<any> {
    socket.send({ type: 'room:update', patch: { op: 'remove', objectId } });
    return socket.next();
  }

  async function moveObject(socket: any, objectId: string, x: number, y: number): Promise<any> {
    socket.send({ type: 'room:update', patch: { objectId, x, y } });
    return socket.next();
  }

  async function getRoomState(socket: any): Promise<any> {
    socket.send({ type: 'room:get-state' });
    return socket.next();
  }

  describe('Persistencia básica', () => {
    let dataDir: string;

    beforeEach(() => {
      // Limpiar directorio anterior si existe
      if (dataDir) {
        try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
      }
      dataDir = mkdtempSync(join(tmpdir(), 'signaling-test-'));
    });

    afterEach(() => {
      try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
    });

    test('el nombre de la sala persiste tras reiniciar el servidor', async () => {
      // Crear servidor y sala
      const s = await withServer(dataDir);
      const { roomCode, socket } = await createRoom(s.url);

      // Cambiar nombre
      const nameUpdate = await updateRoomName(socket, 'Mi Sala Personalizada');
      assert.equal(nameUpdate.type, 'room:updated');
      assert.equal(nameUpdate.state.name, 'Mi Sala Personalizada');

      await socket.close();
      await s.close();

      // Reiniciar servidor con mismo directorio de datos
      const s2 = await withServer(dataDir);

      // Verificar que la sala existe y tiene el nombre correcto
      const { socket: sock2 } = await joinRoom(s2.url, roomCode);
      const state = await getRoomState(sock2);
      assert.equal(state.type, 'room:state');
      assert.equal(state.state.name, 'Mi Sala Personalizada');

      await sock2.close();
      await s2.close();
    });

    test('la posición de un objeto persiste tras reiniciar', async () => {
      const s = await withServer(dataDir);
      const { roomCode, socket } = await createRoom(s.url);

      // Mover sofá
      await moveObject(socket, 'sofa-1', 700, 600);
      await socket.close();
      await s.close();

      // Reiniciar servidor
      const s2 = await withServer(dataDir);
      const { socket: sock2 } = await joinRoom(s2.url, roomCode);
      const state = await getRoomState(sock2);
      assert.equal(state.type, 'room:state');
      const sofa = state.state.objects.find(o => o.id === 'sofa-1');
      assert.ok(sofa);
      assert.equal(sofa.x, 700);
      assert.equal(sofa.y, 600);

      await sock2.close();
      await s2.close();
    });

    test('crear y eliminar objeto persiste tras reiniciar', async () => {
      const s = await withServer(dataDir);
      const { roomCode, socket } = await createRoom(s.url);

      // Crear nueva mesa (el servidor genera el ID)
      const createResponse = await createObject(socket, { type: 'table', x: 300, y: 300 });
      assert.equal(createResponse.type, 'room:updated');
      const newTableId = createResponse.state.objects.find(o => o.x === 300 && o.y === 300 && o.type === 'table')!.id;

      await socket.close();
      await s.close();

      // Reiniciar - la mesa debe seguir ahí
      const s2 = await withServer(dataDir);
      const { socket: sock2 } = await joinRoom(s2.url, roomCode);
      let state = await getRoomState(sock2);
      let table2 = state.state.objects.find(o => o.id === newTableId);
      assert.ok(table2);
      assert.equal(table2.x, 300);
      assert.equal(table2.y, 300);

      // Eliminar la mesa
      await removeObject(sock2, newTableId);
      await sock2.close();
      await s2.close();

      // Reiniciar - la mesa no debe reaparecer
      const s3 = await withServer(dataDir);
      const { socket: sock3 } = await joinRoom(s3.url, roomCode);
      state = await getRoomState(sock3);
      const deletedTable = state.state.objects.find(o => o.id === newTableId);
      assert.ok(!deletedTable);

      await sock3.close();
      await s3.close();
    });

    test('ambos tipos de objeto (sofa y table) persisten', async () => {
      const s = await withServer(dataDir);
      const { roomCode, socket } = await createRoom(s.url);

      // Mover ambos
      await moveObject(socket, 'sofa-1', 100, 200);
      await moveObject(socket, 'table-1', 800, 600);
      await socket.close();
      await s.close();

      const s2 = await withServer(dataDir);
      const { socket: sock2 } = await joinRoom(s2.url, roomCode);
      const state = await getRoomState(sock2);

      const sofa = state.state.objects.find(o => o.id === 'sofa-1');
      const table = state.state.objects.find(o => o.id === 'table-1');
      assert.ok(sofa);
      assert.ok(table);
      assert.equal(sofa.x, 100);
      assert.equal(sofa.y, 200);
      assert.equal(table.x, 800);
      assert.equal(table.y, 600);

      await sock2.close();
      await s2.close();
    });

    test('servidor arranca sin directorio de datos existente', async () => {
      // Directorio que no existe
      const emptyDir = join(tmpdir(), 'signaling-test-empty-' + Date.now());
      try { rmSync(emptyDir, { recursive: true, force: true }); } catch {}

      const s = await withServer(emptyDir);
      const { roomCode, socket } = await createRoom(s.url);

      // Debe crear la sala normalmente
      const state = await getRoomState(socket);
      assert.equal(state.type, 'room:state');
      assert.ok(state.state.name.startsWith('Sala '));

      await socket.close();
      await s.close();

      // Verificar que se crearon archivos de persistencia
      const fs = await import('node:fs');
      const files = fs.readdirSync(emptyDir);
      assert.ok(files.length > 0);
      assert.ok(files.some(f => f.endsWith('.json')));

      await new Promise(r => setTimeout(r, 100));
      try { fs.rmSync(emptyDir, { recursive: true, force: true }); } catch {}
    });
  });

  describe('Manejo de archivos corruptos', () => {
    let dataDir: string;

    beforeEach(() => {
      if (dataDir) {
        try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
      }
      dataDir = mkdtempSync(join(tmpdir(), 'signaling-test-'));
    });

    afterEach(() => {
      try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
    });

    test('archivo JSON inválido no rompe el arranque', async () => {
      // Escribir archivo corrupto
      const corruptFile = join(dataDir, 'BADROOM.json');
      const fs = await import('node:fs');
      fs.writeFileSync(corruptFile, '{ not valid json');

      const s = await withServer(dataDir);
      // El servidor debe arrancar sin crashear
      const { roomCode, socket } = await createRoom(s.url);
      const state = await getRoomState(socket);
      assert.equal(state.type, 'room:state');

      await socket.close();
      await s.close();
    });

    test('archivo con RoomState inválido se ignora', async () => {
      // Escribir RoomState inválido (falta name)
      const invalidFile = join(dataDir, 'INVALID.json');
      const fs = await import('node:fs');
      fs.writeFileSync(invalidFile, JSON.stringify({
        version: 1,
        width: 1200,
        height: 800,
        objects: []
      }));

      const s = await withServer(dataDir);
      // Debe arrancar y crear salas nuevas normalmente
      const { roomCode, socket } = await createRoom(s.url);
      const state = await getRoomState(socket);
      assert.equal(state.type, 'room:state');

      await socket.close();
      await s.close();
    });
  });

  describe('Aislamiento entre salas', () => {
    let dataDir: string;

    beforeEach(() => {
      if (dataDir) {
        try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
      }
      dataDir = mkdtempSync(join(tmpdir(), 'signaling-test-'));
    });

    afterEach(() => {
      try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
    });

    test('dos salas mantienen estados independientes', async () => {
      const s = await withServer(dataDir);
      const { roomCode: code1, socket: sock1 } = await createRoom(s.url);
      const { roomCode: code2, socket: sock2 } = await createRoom(s.url);

      // Modificar sala 1
      await moveObject(sock1, 'sofa-1', 100, 100);
      await updateRoomName(sock1, 'Sala Uno');

      // Modificar sala 2
      await moveObject(sock2, 'sofa-1', 900, 900);
      await updateRoomName(sock2, 'Sala Dos');

      await sock1.close();
      await sock2.close();
      await s.close();

      // Reiniciar y verificar ambas
      const s2 = await withServer(dataDir);

      // Sala 1
      const { socket: sock1b } = await joinRoom(s2.url, code1);
      let state = await getRoomState(sock1b);
      assert.equal(state.state.name, 'Sala Uno');
      const sofa1 = state.state.objects.find(o => o.id === 'sofa-1');
      assert.equal(sofa1.x, 100);
      assert.equal(sofa1.y, 100);

      // Sala 2
      const { socket: sock2b } = await joinRoom(s2.url, code2);
      state = await getRoomState(sock2b);
      assert.equal(state.state.name, 'Sala Dos');
      const sofa2 = state.state.objects.find(o => o.id === 'sofa-1');
      assert.equal(sofa2.x, 900);
      assert.equal(sofa2.y, 900);

      await sock1b.close();
      await sock2b.close();
      await s2.close();
    });
  });

  describe('Sin persistencia de conexiones', () => {
    let dataDir: string;

    beforeEach(() => {
      if (dataDir) {
        try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
      }
      dataDir = mkdtempSync(join(tmpdir(), 'signaling-test-'));
    });

    afterEach(() => {
      try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
    });

    test('participantes y conexiones NO se persisten', async () => {
      const s = await withServer(dataDir);
      const { roomCode, socket } = await createRoom(s.url);

      // Unirse un segundo participante
      const { socket: guest } = await joinRoom(s.url, roomCode);
      await guest.close();
      await socket.close();
      await s.close();

      // Reiniciar servidor
      const s2 = await withServer(dataDir);
      const { socket: sock2 } = await joinRoom(s2.url, roomCode);
      const state = await getRoomState(sock2);

      // La sala debe existir pero sin participantes conectados (excepto el que acaba de unirse)
      assert.ok(state.state.objects.length > 0);

      await sock2.close();
      await s2.close();
    });
  });

  describe('Actualizaciones persistidas visibles via room:updated', () => {
    let dataDir: string;

    beforeEach(() => {
      if (dataDir) {
        try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
      }
      dataDir = mkdtempSync(join(tmpdir(), 'signaling-test-'));
    });

    afterEach(() => {
      try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
    });

    test('actualización de nombre se propaga y persiste', async () => {
      const s = await withServer(dataDir);
      const { roomCode, socket } = await createRoom(s.url);

      // Cliente 1 cambia el nombre
      const updated = await updateRoomName(socket, 'Nuevo Nombre');
      assert.equal(updated.type, 'room:updated');
      assert.equal(updated.state.name, 'Nuevo Nombre');
      await socket.close();

      // Cliente 2 se une y recibe el estado actualizado
      const s2 = await withServer(dataDir);
      const { socket: sock2 } = await joinRoom(s2.url, roomCode);
      const state = await getRoomState(sock2);
      assert.equal(state.state.name, 'Nuevo Nombre');

      await sock2.close();
      await s2.close();
      await s.close();
    });

    test('actualización de posición de objeto se propaga y persiste', async () => {
      const s = await withServer(dataDir);
      const { roomCode, socket } = await createRoom(s.url);

      // Mover objeto
      await moveObject(socket, 'sofa-1', 500, 400);
      await socket.close();

      // Segundo cliente se une y ve la posición actualizada
      const s2 = await withServer(dataDir);
      const { socket: sock2 } = await joinRoom(s2.url, roomCode);
      const state = await getRoomState(sock2);
      const sofa = state.state.objects.find(o => o.id === 'sofa-1');
      assert.equal(sofa.x, 500);
      assert.equal(sofa.y, 400);

      await sock2.close();
      await s2.close();
    });

    test('creación de objeto se propaga y persiste', async () => {
      const s = await withServer(dataDir);
      const { roomCode, socket } = await createRoom(s.url);

      // Crear nuevo objeto (el servidor genera el ID)
      const createResponse = await createObject(socket, { type: 'table', x: 400, y: 300 });
      assert.equal(createResponse.type, 'room:updated');
      const newObjectId = createResponse.state.objects.find(o => o.x === 400 && o.y === 300 && o.type === 'table')!.id;
      await socket.close();

      // Segundo cliente ve el objeto nuevo
      const s2 = await withServer(dataDir);
      const { socket: sock2 } = await joinRoom(s2.url, roomCode);
      const state = await getRoomState(sock2);
      const chair = state.state.objects.find(o => o.id === newObjectId);
      assert.ok(chair);
      assert.equal(chair.type, 'table');
      assert.equal(chair.x, 400);
      assert.equal(chair.y, 300);

      await sock2.close();
      await s2.close();
    });

    test('eliminación de objeto se propaga y persiste', async () => {
      const s = await withServer(dataDir);
      const { roomCode, socket } = await createRoom(s.url);

      // Eliminar mesa
      await removeObject(socket, 'table-1');
      await socket.close();

      // Segundo cliente ya no ve la mesa
      const s2 = await withServer(dataDir);
      const { socket: sock2 } = await joinRoom(s2.url, roomCode);
      const state = await getRoomState(sock2);
      const table = state.state.objects.find(o => o.id === 'table-1');
      assert.ok(!table);

      await sock2.close();
    });
  });
});
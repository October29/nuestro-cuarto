// Paso 3 Room-first: RoomDirectory, la libreta local de "Mis salas".
//
// Solo recuerda cómo ENCONTRAR una Room ({ roomId, name }): nunca guarda
// estado de la sala. Backup en localStorage tratado como libreta de
// direcciones; sin storage, libreta en memoria.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { RoomDirectory } from '../src/storage/roomDirectory';
import { MemoryStorage } from './helpers/storage';

const memory = (): MemoryStorage => new MemoryStorage();

describe('RoomDirectory: operaciones básicas de la libreta', () => {
  test('guardar una Room y recuperarla por roomId', () => {
    const storage = memory();
    const directory = new RoomDirectory(storage);

    directory.save('ABC123', 'Nuestro Cuartito');

    assert.deepEqual(directory.get('ABC123'), { roomId: 'ABC123', name: 'Nuestro Cuartito' });
  });

  test('listar las Rooms guardadas en orden de inserción', () => {
    const directory = new RoomDirectory(memory());
    directory.save('ABC123', 'Nuestro Cuartito');
    directory.save('XYZ789', 'Sala de pruebas');

    assert.deepEqual(directory.list(), [
      { roomId: 'ABC123', name: 'Nuestro Cuartito' },
      { roomId: 'XYZ789', name: 'Sala de pruebas' },
    ]);
  });

  test('eliminar una entrada de la libreta (y solo de la libreta)', () => {
    const directory = new RoomDirectory(memory());
    directory.save('ABC123', 'Nuestro Cuartito');
    directory.save('XYZ789', 'Sala de pruebas');

    assert.equal(directory.remove('ABC123'), true);
    assert.deepEqual(directory.list(), [{ roomId: 'XYZ789', name: 'Sala de pruebas' }]);
    assert.equal(directory.get('ABC123'), null);
    // Eliminar algo inexistente es no-op que devuelve false.
    assert.equal(directory.remove('ABC123'), false);
  });

  test('recuperar una Room guardada tras reconstruir el módulo (misma storage)', () => {
    const storage = memory();
    const first = new RoomDirectory(storage);
    first.save('ABC123', 'Nuestro Cuartito');
    first.save('XYZ789', 'Sala de pruebas');

    const rebuilt = new RoomDirectory(storage);
    assert.deepEqual(rebuilt.list(), [
      { roomId: 'ABC123', name: 'Nuestro Cuartito' },
      { roomId: 'XYZ789', name: 'Sala de pruebas' },
    ]);
  });

  test('funciona en memoria cuando no hay storage (entorno sin navegador)', () => {
    const directory = new RoomDirectory(null);
    directory.save('ABC123', 'Nuestro Cuartito');
    assert.deepEqual(directory.list(), [{ roomId: 'ABC123', name: 'Nuestro Cuartito' }]);
  });

  test('normaliza el roomId y aplica un nombre por defecto', () => {
    const directory = new RoomDirectory(null);
    directory.save(' abc123 ', '');
    assert.deepEqual(directory.list(), [{ roomId: 'ABC123', name: 'Sala ABC123' }]);
  });

  test('guardar el mismo roomId actualiza su nombre', () => {
    const directory = new RoomDirectory(null);
    directory.save('ABC123', 'Viejo');
    directory.save('abc123', 'Nuevo');
    assert.deepEqual(directory.list(), [{ roomId: 'ABC123', name: 'Nuevo' }]);
  });

  test('datos corruptos en la storage se ignoran y la libreta arranca vacía', () => {
    const corrupted = {
      getItem: () => 'no-json-{',
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    const directory = new RoomDirectory(corrupted);
    assert.deepEqual(directory.list(), []);
  });

  test('una entrada guardada contiene SOLO roomId y name (nada de estado)', () => {
    const storage = memory();
    const directory = new RoomDirectory(storage);
    directory.save('ABC123', 'Nuestro Cuartito');

    const raw = storage.getItem('nuestro-cuarto:mis-salas:v1');
    assert.ok(raw, 'la libreta debe escribirse en la storage');
    assert.deepEqual(JSON.parse(raw!), [{ roomId: 'ABC123', name: 'Nuestro Cuartito' }]);
  });
});
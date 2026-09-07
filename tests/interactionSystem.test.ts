import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import type Phaser from 'phaser';

import { InteractionSystem, type InteractionPhaserApi } from '../src/game/systems/InteractionSystem';
import { installDomMocks, setActiveElement } from './helpers/dom';

import type { Player } from '../src/game/entities/Player';
import type { Interactable } from '../src/game/objects/Interactable';

// phaser no se puede importar en Node (accede a `window` al evaluarse), así
// que InteractionSystem recibe una API Phaser inyectada. Aquí se usa un
// sustituto mínimo que registra cuándo se pulsa E de forma "recién bajada".
function buildSystem() {
  const interactions: string[] = [];
  const state = { justDown: false };

  const fakeKey = {};
  const promptText = {
    setOrigin: () => promptText,
    setVisible: () => promptText,
    setScrollFactor: () => promptText,
    setDepth: () => promptText,
    setPosition: () => promptText,
    setText: () => promptText,
    visible: false,
    getBounds: () => ({}),
  };

  const scene = {
    input: { keyboard: { addKey: () => fakeKey } },
    add: { text: () => promptText },
  } as unknown as Phaser.Scene;

  const player = { x: 0, y: 0, isSitting: () => false, standUpAt: () => undefined } as unknown as Player;

  const interactable = {
    getPosition: () => ({ x: 0, y: 0 }),
    getGameObject: () => ({ displayWidth: 10, displayHeight: 10 }),
    getActionLabel: () => 'usar',
    getExitPoint: () => ({ x: 0, y: 0 }),
    onInteract: () => interactions.push('interact'),
  } as unknown as Interactable;

  const phaser: InteractionPhaserApi = {
    Input: {
      Keyboard: {
        KeyCodes: { E: 69 },
        JustDown: () => state.justDown,
      },
    },
    Geom: { Rectangle: { Contains: () => false } },
    Math: {
      Clamp: (value: number) => value,
      Distance: { Between: () => 0 },
    },
  };

  const system = new InteractionSystem(scene, player, phaser);
  system.addInteractable(interactable);

  return { system, interactions, setJustDown: (value: boolean) => (state.justDown = value) };
}

describe('InteractionSystem: tecla E respeta el foco editable (fix chat)', () => {
  beforeEach(() => {
    installDomMocks();
  });

  it('E NO dispara interacción cuando isEditableFocused() es true', () => {
    const { system, interactions, setJustDown } = buildSystem();
    setJustDown(true);
    setActiveElement({ tagName: 'INPUT' });

    system.update();

    assert.equal(interactions.length, 0, 'con foco en un input, E no debe interactuar');
  });

  it('E SÍ dispara interacción cuando ningún editable tiene el foco', () => {
    const { system, interactions, setJustDown } = buildSystem();
    setJustDown(true);
    setActiveElement({ tagName: 'BODY' });

    system.update();

    assert.equal(interactions.length, 1, 'sin foco editable, E debe interactuar');
  });

  it('E NO dispara interacción si la tecla no está recién bajada (JustDown false)', () => {
    const { system, interactions, setJustDown } = buildSystem();
    setJustDown(false);
    setActiveElement(null);

    system.update();

    assert.equal(interactions.length, 0);
  });

  it('E se registra SIN captura del navegador (addKey con enableCapture=false)', () => {
    let captureValue: unknown = 'undefined';
    const fakeKey = {};
    const scene = {
      input: {
        keyboard: {
          addKey: (_key: unknown, enableCapture: unknown) => {
            captureValue = enableCapture;
            return fakeKey;
          },
        },
      },
      add: { text: () => ({ setOrigin: () => undefined, setVisible: () => undefined, setScrollFactor: () => undefined, setDepth: () => undefined, setPosition: () => undefined }) },
    } as unknown as Phaser.Scene;
    const player = {} as unknown as Player;
    const phaser = {
      Input: { Keyboard: { KeyCodes: { E: 69 }, JustDown: () => false } },
      Geom: { Rectangle: { Contains: () => false } },
      Math: { Clamp: (v: number) => v, Distance: { Between: () => 0 } },
    } as unknown as InteractionPhaserApi;

    new InteractionSystem(scene, player, phaser);

    assert.equal(captureValue, false, 'Phaser no debe capturar E para no bloquear el input DOM');
  });
});
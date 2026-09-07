import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { ChatPanel } from '../src/ui/chatPanel';
import { installDomMocks, getElement, getDocumentListeners, setActiveElement } from './helpers/dom';

import type { NetworkSession } from '../src/network/NetworkSession';
import type { PeerMessage } from '../src/network/protocol';

// Sesión mock mínima suficiente para ChatPanel.handleSend.
function makeSession() {
  const sent: PeerMessage[] = [];
  return {
    state: 'connected',
    send: (message: PeerMessage) => {
      sent.push(message);
      return true;
    },
    sent,
  };
}

function buildChat() {
  const session = makeSession();
  const chat = new ChatPanel();
  chat.bindSession(session as unknown as NetworkSession);
  return { chat, session, input: getElement('chat-input') };
}

function pressEnterOn(target = getElement('chat-input')): void {
  for (const fn of target.listeners['keydown'] ?? []) {
    (fn as unknown as (e: unknown) => void)({ key: 'Enter', preventDefault: () => undefined });
  }
}

function pressDocumentEnter(): void {
  for (const fn of getDocumentListeners('keydown')) {
    (fn as unknown as (e: unknown) => void)({ key: 'Enter', preventDefault: () => undefined });
  }
}

describe('ChatPanel: comportamiento definitivo de Enter (fix chat)', () => {
  beforeEach(() => {
    installDomMocks();
    setActiveElement({ tagName: 'BODY' });
  });

  afterEach(() => {
    setActiveElement(null);
  });

  it('se registra UN SOLO listener global de Enter aunque ChatPanel se cree varias veces', () => {
    new ChatPanel();
    new ChatPanel();

    assert.equal(getDocumentListeners('keydown').length, 1, 'no deben acumularse listeners globales');
  });

  it('Enter sin foco editable enfoca el chat', () => {
    const { input } = buildChat();
    const before = input.focusCount;
    setActiveElement({ tagName: 'BODY' });

    pressDocumentEnter();

    assert.equal(input.focusCount, before + 1, 'Enter global debe enfocar el input del chat');
  });

  it('Enter sin foco editable NO enfoca si no hay sesión activa', () => {
    new ChatPanel();
    setActiveElement({ tagName: 'BODY' });

    pressDocumentEnter();

    assert.equal(getElement('chat-input').focusCount, 0, 'sin sesión el chat está oculto y no se enfoca');
  });

  it('Enter con texto envía el mensaje y mantiene el foco', () => {
    const { session, input } = buildChat();
    setActiveElement(input);
    input.value = 'hola';
    const focusBefore = input.focusCount;

    pressEnterOn(input);

    assert.equal(session.sent.length, 1, 'debe enviarse 1 mensaje');
    assert.equal(session.sent[0].type, 'chat');
    assert.equal(input.value, '', 'el input debe quedar limpio tras enviar');
    assert.equal(input.blurCount, 0, 'con texto no debe hacerse blur');
    assert.equal(input.focusCount, focusBefore, 'el foco se conserva (ni blur ni doble focus)');
  });

  it('Enter con texto envía SOLO el texto sin whitespace', () => {
    const { session, input } = buildChat();
    setActiveElement(input);
    input.value = '  hola mundo  ';

    pressEnterOn(input);

    assert.equal(session.sent.length, 1);
    const msg = session.sent[0] as PeerMessage & { text: string };
    assert.equal(msg.text, 'hola mundo');
    assert.equal(input.value, '');
  });

  it('Enter con solo whitespace NO envía y hace blur', () => {
    const { session, input } = buildChat();
    setActiveElement(input);
    input.value = '   ';

    pressEnterOn(input);

    assert.equal(session.sent.length, 0, 'whitespace solo no debe enviarse');
    assert.equal(input.blurCount, 1, 'con whitespace debe hacerse blur');
  });

  it('Enter vacío NO envía y hace blur', () => {
    const { session, input } = buildChat();
    setActiveElement(input);
    input.value = '';

    pressEnterOn(input);

    assert.equal(session.sent.length, 0, 'vacío no debe enviarse');
    assert.equal(input.blurCount, 1, 'con vacío debe hacerse blur');
  });

  it('NUNCA envía mensajes que sean solo whitespace (camino del botón Enviar)', () => {
    const { session, input } = buildChat();
    setActiveElement(input);
    input.value = '   \t  ';

    for (const fn of getElement('chat-send-btn').listeners['click'] ?? []) {
      (fn as unknown as (e?: unknown) => void)();
    }

    assert.equal(session.sent.length, 0, 'el botón con whitespace no debe enviar');
  });

  it('Enter en otro campo editable NO roba el foco ni fuerza el chat', () => {
    const { chat, input } = buildChat();
    void chat;
    const roomInput = getElement('room-code-input');
    setActiveElement(roomInput);
    const before = input.focusCount;

    // El campo ajeno conserva su propio comportamiento de Enter...
    for (const fn of roomInput.listeners['keydown'] ?? []) {
      (fn as unknown as (e: unknown) => void)({ key: 'Enter', preventDefault: () => undefined });
    }
    // ...y el listener global del chat tampoco debe reenfocar.
    pressDocumentEnter();

    assert.equal(input.focusCount, before, 'el chat no debe enfocarse con otro editable enfocado');
  });
});
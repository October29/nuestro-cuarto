import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { isEditableElement, isEditableFocused } from '../src/ui/domFocus';

type ElementStub = { tagName: string; isContentEditable?: boolean };

describe('domFocus: distinción de campos editables (fix WASD + chat)', () => {
  beforeEach(() => {
    // La ayuda debe ser null-safe: sin `document` global devuelve false.
    delete (globalThis as { document?: unknown }).document;
  });

  afterEach(() => {
    delete (globalThis as { document?: unknown }).document;
  });

  describe('isEditableElement', () => {
    it('reconoce INPUT, TEXTAREA y SELECT', () => {
      assert.equal(isEditableElement({ tagName: 'INPUT' }), true);
      assert.equal(isEditableElement({ tagName: 'textArea' }), true);
      assert.equal(isEditableElement({ tagName: 'Select' }), true);
      assert.equal(isEditableElement({ tagName: 'input' }), true);
    });

    it('reconoce elementos contentEditable', () => {
      assert.equal(isEditableElement({ tagName: 'DIV', isContentEditable: true }), true);
    });

    it('no considera editables DIV/canvas normales (moverse debe seguir activo)', () => {
      assert.equal(isEditableElement({ tagName: 'DIV' }), false);
      assert.equal(isEditableElement({ tagName: 'CANVAS' }), false);
      assert.equal(isEditableElement({ tagName: 'BUTTON' }), false);
    });

    it('es seguro con valores no-DOM o nulos (scripts y tests)', () => {
      assert.equal(isEditableElement(null), false);
      assert.equal(isEditableElement(undefined), false);
      assert.equal(isEditableElement(42), false);
      assert.equal(isEditableElement('INPUT'), false);
      assert.equal(isEditableElement({}), false);
    });
  });

  describe('isEditableFocused', () => {
    it('detecta el foco sobre el chat (input de texto)', () => {
      (globalThis as { document?: { activeElement?: ElementStub } }).document = {
        activeElement: { tagName: 'INPUT' },
      };
      assert.equal(isEditableFocused(), true);
    });

    it('detecta el foco sobre un contentEditable', () => {
      (globalThis as { document?: { activeElement?: ElementStub } }).document = {
        activeElement: { tagName: 'DIV', isContentEditable: true },
      };
      assert.equal(isEditableFocused(), true);
    });

    it('permite el juego cuando el foco no es un campo de texto', () => {
      (globalThis as { document?: { activeElement?: ElementStub } }).document = {
        activeElement: { tagName: 'BODY' },
      };
      assert.equal(isEditableFocused(), false);
    });

    it('permite el juego con foco en body o sin document (navegador/Node)', () => {
      (globalThis as { document?: { activeElement?: ElementStub } }).document = {
        activeElement: { tagName: 'BODY' },
      };
      assert.equal(isEditableFocused(), false);

      delete (globalThis as { document?: unknown }).document;
      assert.equal(isEditableFocused(), false);
    });
  });
});
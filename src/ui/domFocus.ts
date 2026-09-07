// Diferencia si el foco del navegador está sobre un campo de texto editable.
// Phaser captura teclas de forma global a nivel de ventana y no mira el foco
// del DOM; este módulo permite que el juego se repliegue mientras se escribe.

type NodeLike = { tagName?: unknown; isContentEditable?: unknown };

/** ¿Es un elemento HTML en el que se escribe/selecciona texto? */
export function isEditableElement(element: unknown): boolean {
  if (element === null || typeof element !== 'object') return false;
  const el = element as NodeLike;
  if (typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return el.isContentEditable === true;
}

/** ¿El navegador tiene el foco en un campo editable? (seguro en Node/tests). */
export function isEditableFocused(): boolean {
  const doc = (globalThis as { document?: { activeElement?: unknown } }).document;
  return isEditableElement(doc?.activeElement);
}
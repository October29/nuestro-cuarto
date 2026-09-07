import { isEditableElement } from './domFocus';
import { MAX_CHAT_LENGTH } from '../network/protocol';
import type { PeerMessage } from '../network/protocol';
import type { NetworkSession } from '../network/NetworkSession';

// Listener global único de Enter para enfocar el chat. Si ChatPanel se
// construye más de una vez, se retira el listener anterior antes de registrar
// el nuevo (nunca se acumulan) y este siempre actúa sobre la instancia más
// reciente (`activeChat`).
let activeChat: ChatPanel | null = null;
let boundEnterListener: ((event: KeyboardEvent) => void) | null = null;

function handleDocumentEnter(event: KeyboardEvent): void {
  if (event.key !== 'Enter') return;

  // Si hay foco en un campo editable, ese campo es el dueño de Enter: el chat
  // no debe robarlo (ej. room-code-input).
  const active = document.activeElement;
  if (isEditableElement(active)) return;

  // Los controles con Enter propio tampoco deben ser interferidos.
  const tag = typeof active?.tagName === 'string' ? active.tagName.toUpperCase() : '';
  if (tag === 'BUTTON' || tag === 'A') return;

  activeChat?.focusChatInput();
}

function ensureGlobalEnterListener(): void {
  if (boundEnterListener) {
    document.removeEventListener('keydown', boundEnterListener);
  }
  boundEnterListener = handleDocumentEnter;
  document.addEventListener('keydown', boundEnterListener);
}

export class ChatPanel {
  private readonly container: HTMLDivElement;
  private readonly messagesDiv: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly sendBtn: HTMLButtonElement;

  private session: NetworkSession | null = null;
  private readonly playerId: string;

  constructor() {
    this.container = document.getElementById('chat-panel') as HTMLDivElement;
    this.messagesDiv = document.getElementById('chat-messages') as HTMLDivElement;
    this.input = document.getElementById('chat-input') as HTMLInputElement;
    this.sendBtn = document.getElementById('chat-send-btn') as HTMLButtonElement;

    this.playerId = 'local';
    this.input.maxLength = MAX_CHAT_LENGTH;

    this.sendBtn.addEventListener('click', () => this.handleSend());
    this.input.addEventListener('keydown', (e) => this.handleInputKeydown(e));

    this.hide();

    activeChat = this;
    ensureGlobalEnterListener();
  }

  /** Enfoca el input del chat. Solo actúa con una sesión activa (chat visible). */
  focusChatInput(): void {
    if (!this.session) return;
    this.input.focus();
  }

  /** Libera la referencia del listener global (ciclo de vida seguro). */
  destroy(): void {
    if (activeChat === this) {
      activeChat = null;
    }
  }

  /** Vincula el chat a una sesión activa. */
  bindSession(session: NetworkSession): void {
    this.session = session;
    this.show();
    this.input.focus();
  }

  /** Desvincula la sesión y oculta el chat. */
  unbindSession(): void {
    this.session = null;
    this.hide();
    this.clearMessages();
  }

  /** Llama esto desde el callback de mensajes de ConnectMenu para recibir mensajes remotos. */
  onRemoteMessage(message: PeerMessage): void {
    if (message.type !== 'chat') return;
    this.appendMessage(message.text, 'remote');
  }

  private handleInputKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      // Con texto → enviar y conservar el foco. Sin texto útil → blur.
      if (this.input.value.trim().length > 0) {
        this.handleSend();
      } else {
        this.input.blur();
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.input.blur();
      document.getElementById('game')?.focus();
    }
  }

  private handleSend(): void {
    if (!this.session || this.session.state !== 'connected') return;
    const text = this.input.value.trim();
    if (text.length === 0) return;

    const ok = this.session.send({
      type: 'chat',
      playerId: this.playerId,
      text,
    });
    if (!ok) return;

    this.appendMessage(text, 'local');
    this.input.value = '';
  }

  private appendMessage(text: string, kind: 'local' | 'remote'): void {
    const el = document.createElement('div');
    el.className = `chat-msg chat-msg-${kind}`;
    el.textContent = text;
    this.messagesDiv.appendChild(el);
    this.messagesDiv.scrollTop = this.messagesDiv.scrollHeight;
  }

  private clearMessages(): void {
    this.messagesDiv.innerHTML = '';
  }

  private show(): void {
    this.container.hidden = false;
  }

  private hide(): void {
    this.container.hidden = true;
  }
}
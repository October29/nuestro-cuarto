import { MAX_CHAT_LENGTH } from '../network/protocol';
import type { PeerMessage } from '../network/protocol';
import type { NetworkSession } from '../network/NetworkSession';

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
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.handleSend();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.input.blur();
        document.getElementById('game')?.focus();
      }
    });

    this.hide();
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
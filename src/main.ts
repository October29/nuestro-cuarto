import Phaser from 'phaser';

import { gameConfig } from './game/config';
import { RoomScene } from './game/scenes/RoomScene';
import { ConnectMenu } from './ui/connectMenu';
import { ChatPanel } from './ui/chatPanel';
import '../style.css';

const game = new Phaser.Game(gameConfig);

const chatPanel = new ChatPanel();
const connectMenu = new ConnectMenu();

connectMenu.setMessageCallback((message) => {
  chatPanel.onRemoteMessage(message);
  getRoomScene()?.handleNetworkMessage(message);
});

connectMenu.onSessionChange((session) => {
  const sessionId = (session as { diagId?: number } | null)?.diagId ?? null;
  console.log(
    `[M07A-DIAG] [${new Date().toISOString()}] [onSessionChange]`,
    JSON.stringify({ session: sessionId }),
  );
  if (session) {
    chatPanel.bindSession(session);
  } else {
    chatPanel.unbindSession();
  }
  getRoomScene()?.setNetworkSession(session);
});

function getRoomScene(): RoomScene | null {
  const scene = game.scene.getScene('room') as RoomScene | null;
  return scene ?? null;
}

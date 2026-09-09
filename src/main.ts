import Phaser from 'phaser';

import { gameConfig } from './game/config';
import { RoomScene } from './game/scenes/RoomScene';
import { ConnectMenu } from './ui/connectMenu';
import { ChatPanel } from './ui/chatPanel';
import { RoomNamePanel } from './ui/roomNamePanel';
import { RoomEditPanel } from './ui/roomEditPanel';
import type { RoomState } from './network/protocol';
import '../style.css';

const game = new Phaser.Game(gameConfig);

const chatPanel = new ChatPanel();
const roomNamePanel = new RoomNamePanel();
const roomEditPanel = new RoomEditPanel();
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
    roomNamePanel.bindSession(session);
  } else {
    chatPanel.unbindSession();
    roomNamePanel.bindSession(null);
  }
  getRoomScene()?.setNetworkSession(session);
});

connectMenu.onRoomStateChange((state: RoomState) => {
  getRoomScene()?.setRoomState(state);
  roomNamePanel.setRoomName(state.name);
});

function getRoomScene(): RoomScene | null {
  const scene = game.scene.getScene('room') as RoomScene | null;
  if (scene) {
    roomEditPanel.bindRoomScene(scene);
  } else {
    roomEditPanel.bindRoomScene(null);
  }
  return scene ?? null;
}

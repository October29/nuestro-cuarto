import Phaser from 'phaser';

import { gameConfig } from './game/config';
import { ConnectMenu } from './ui/connectMenu';
import { ChatPanel } from './ui/chatPanel';
import '../style.css';

new Phaser.Game(gameConfig);

const chatPanel = new ChatPanel();
const connectMenu = new ConnectMenu();
connectMenu.setMessageCallback((message) => chatPanel.onRemoteMessage(message));

connectMenu.onSessionChange((session) => {
  if (session) {
    chatPanel.bindSession(session);
  } else {
    chatPanel.unbindSession();
  }
});

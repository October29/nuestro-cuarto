import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    // host: true  ==  "0.0.0.0": el dev server escucha en localhost y en la
    // interfaz LAN, permitiendo abrir la app desde otro dispositivo en la red.
    host: true,
  },
});
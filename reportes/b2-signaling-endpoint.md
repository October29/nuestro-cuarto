# Radiografía Técnica B2: Configuración Explícita del Endpoint de Signaling

**Proyecto**: Nuestro Cuartito
**Milestone**: milestone-08-room
**Commit base**: eea79de
**Fecha**: 2026-09-09

---

## 1. Cómo se Construye Actualmente la URL del WebSocket

### Código Actual (`SignalingClient.ts:17-21`)

```typescript
function defaultSignalingUrl(): string {
  if (typeof location === 'undefined') return 'ws://localhost:8787';
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.hostname}:${DEFAULT_PORT}`;
}
```

### Flujo de Construcción

1. **`SignalingClient` constructor** (línea 44-46):
   ```typescript
   constructor(url?: string) {
     this.url = url ?? defaultSignalingUrl();
   }
   ```

2. **`NetworkSession`** (línea 68):
   ```typescript
   this.signaling = new SignalingClient(options.signalingUrl);
   ```
   - Recibe `signalingUrl` opcional desde `NetworkSessionOptions`

3. **`ConnectMenu`** (línea 50):
   ```typescript
   this.createSession = options.createSession ?? ((handlers) => new NetworkSession({ handlers }));
   ```
   - No pasa `signalingUrl` → usa el default de `SignalingClient`

---

## 2. Qué Parte Está Acoplada al Host de la Página

| Componente | Acoplamiento |
|------------|--------------|
| `defaultSignalingUrl()` | **Total**: usa `location.hostname` y `location.protocol` |
| `SignalingClient` | **Parcial**: acepta URL explícita, pero default usa host de la página |
| `NetworkSession` | **Ninguno**: solo reenvía `options.signalingUrl` |
| `ConnectMenu` | **Ninguno directo**: no expone forma de configurar endpoint |

**Problema**: Si la app se sirve desde `https://mi-dominio.com` pero el signaling está en `ws://192.168.1.50:8787`, la conexión falla porque el default asume mismo host.

---

## 3. API/Configuración Mínima Propuesta

### Opción Elegida: Parámetro en `ConnectMenuOptions`

```typescript
// connectMenu.ts - agregar a ConnectMenuOptions
export interface ConnectMenuOptions {
  createSession?: (handlers: SessionHandlers) => NetworkSession;
  roomDirectory?: RoomDirectory;
  /** URL completa del servidor de signaling (ej: "wss://signaling.midominio.com:8787").
   *  Si no se proporciona, usa location.hostname + puerto 8787 (comportamiento actual). */
  signalingUrl?: string;
}
```

### Propagación

1. `ConnectMenu` recibe `signalingUrl` en constructor
2. Al crear sesión: `new NetworkSession({ handlers, signalingUrl: this.signalingUrl })`
3. `NetworkSession` pasa a `SignalingClient`
4. `SignalingClient` usa URL explícita en lugar de `defaultSignalingUrl()`

---

## 4. Cómo Conservar Comportamiento Actual por Defecto

- **Sin cambios** en `SignalingClient.defaultSignalingUrl()`
- **Sin cambios** si no se pasa `signalingUrl` en `ConnectMenuOptions`
- **Backward compatible**: `createSession` factory existente sigue funcionando

---

## 5. Cómo Permitir `ws://...` o `wss://...` Explícitamente

El usuario pasa la URL completa:

```typescript
const connectMenu = new ConnectMenu({
  signalingUrl: 'wss://signaling.midominio.com:8787',  // o ws://192.168.1.50:8787
});
```

- `SignalingClient` usa tal cual: `this.url = url ?? defaultSignalingUrl()`
- No hay validación de protocolo (WebSocket nativo maneja ws:// y wss://)

---

## 6. Qué NO Debe Resolverse en B2

| Tema | Queda Fuera de B2 |
|------|-------------------|
| TURN / STUN adicional | B3+ |
| Credenciales / autenticación | B3+ |
| Proxy inverso / TLS termination | Infraestructura |
| Config por variable de entorno / build-time | Puede añadirse después |
| Descubrimiento automático del signaling | No necesario |
| Múltiples endpoints / fallback | Sobre-ingeniería |
| Refactor de `SignalingClient` | Innecesario (ya soporta URL explícita) |

---

## 7. Resumen de Cambios Mínimos

| Archivo | Cambio |
|---------|--------|
| `src/ui/connectMenu.ts` | Añadir `signalingUrl` a `ConnectMenuOptions` y pasarlo al crear `NetworkSession` |
| Tests | Añadir test que verifique URL explícita vs default |

---

*Radiografía B2 completada. Implementación a continuación.*
# B6: Renegociación WebRTC

**Proyecto**: Nuestro Cuartito
**Milestone**: milestone-08-room
**Commit**: feat: prepare WebRTC renegotiation

---

## Flujo de Renegociación

### Negociación Inicial (existente)
1. `peer-joined` → `onPeerJoined()` → `ensureConnection()` → `createDataChannel()` → `makeOffer()`
2. Offer via signaling → peer remoto → Answer via signaling
3. `setRemoteDescription(answer)` → `channel.onopen` → `status = 'open'`

### Renegociación (nueva)
1. **Trigger**: `addTrack()`, `removeTrack()` → `negotiationneeded` event
2. `onnegotiationneeded` → `renegotiate()` → encola trabajo
3. `processQueue()` → `makeOffer()` → nuevo Offer via signaling
3. Peer remoto → Answer → `setRemoteDescription(answer)`
4. `signalingState` vuelve a `'stable'` → cola procesa siguiente trabajo

---

## Control de Concurrencia

- **Cola** (`renegotiationQueue`): array de funciones async
- **Bandera** (`processingQueue`): evita procesamiento paralelo
- **Guarda**: solo procesa si `signalingState === 'stable'`
- **Re-encola**: si estado no estable, vuelve a encolar y espera

```typescript
renegotiate(): void {
  // ... encola trabajo
  this.processQueue();
}

private async processQueue(): Promise<void> {
  if (this.processingQueue || this.renegotiationQueue.length === 0) return;
  this.processingQueue = true;
  while (this.renegotiationQueue.length > 0) {
    if (this.connection?.signalingState !== 'stable') break; // re-encolar
    await work();
  }
  this.processingQueue = false;
}
```

---

## Relación con Negociación Inicial

| Aspecto | Inicial | Renegociación |
|---------|---------|---------------|
| Trigger | `peer-joined` | `negotiationneeded` (addTrack/removeTrack) |
| DataChannel | Se crea (`createDataChannel`) | **Se mantiene** (no se toca) |
| `status` | `connecting` → `open` | Se mantiene `open` |
| `resetNegotiation()` | No | **NO se llama** |
| DataChannel | Nuevo | Existente reutilizado |

---

## Por Qué No Afecta RoomState

- RoomState = objetos, nombre, dimensiones (persistente en servidor)
- Renegociación = SDP/ICE/Tracks (memoria cliente, efímero)
- Tracks de media = Session State (por conexión, no persiste)
- RoomState **nunca** contiene tracks de media

---

## Tests Añadidos (6 tests)

1. Negociación inicial crea offer y abre DataChannel
2. `renegotiate()` genera nuevo offer cuando conexión estable
3. Recibir offer de renegociación genera answer
2. Renegociación no destruye DataChannel
3. Dos solicitudes simultáneas → no offers concurrentes
4. `renegotiate()` sin peer no rompe nada

---

## Limitaciones / Deuda Técnica

1. **Mock tests**: Usan `MockRTCPeerConnection` simplificado; no prueba comportamiento real de ICE/NAT
2. **Timeout renegociación**: No hay timeout específico para renegociación (usa el de 15s inicial)
3. **Rollback en fallo**: Si `setRemoteDescription` falla en renegociación, no hay rollback automático del track añadido
4. **Simulcast/encoding**: No hay infraestructura para `sendEncodings` / `RTCRtpEncodingParameters` (necesario para media real)
5. **Rollback tracks**: Si renegociación falla tras `addTrack()`, el track queda en limbo (no hay `removeTrack` automático)

---

## Próximos Pasos (B7+)

- B7: MediaManager (getUserMedia, addTrack, ontrack)
- B8: Cámara
- B9: Micrófono
- B10: Screen share
- B11: TURN para media en NAT simétrico
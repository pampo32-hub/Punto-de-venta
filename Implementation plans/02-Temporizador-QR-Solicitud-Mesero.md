# Plan de Implementación: Temporizador QR de Solicitud de Mesero (Cooldown de 2 Minutos)

**Estado:** ✅ Implementado y Verificado  
**Commit:** `d835559`  
**Fecha:** Septiembre 2026  

---

## 🎯 Objetivo
Evitar solicitudes repetitivas o spam por parte de clientes al escanear el código QR de su mesa: al pulsar *"Solicitar la Cuenta al Mesero / Pedir Factura"*, el botón debe bloquearse de inmediato en modo *gray out*, iniciar un temporizador regresivo de 2 minutos (120 segundos), y reactivarse cíclicamente si la mesa aún no ha sido cobrada o liberada al término del tiempo.

---

## ⚙️ Reglas de Negocio Implementadas

1. **Desactivación Inmediata ("Gray Out")**:
   - `disabled = true`, clase visual `.disabled`.
   - Estilos: `opacity: 0.65`, `filter: grayscale(0.85)` y `cursor: not-allowed`.
2. **Contador Regresivo en Vivo**:
   - Texto dinámico cada segundo: `⏳ Mesero Solicitado (Reintentar en MM:SS)`.
3. **Reactivación Cíclica tras 120s**:
   - Si transcurren los 2 minutos y la mesa sigue abierta o en cuenta (`estado !== 'libre'`), el botón vuelve a su estado interactivo original (`🙋 Solicitar la Cuenta al Mesero / Pedir Factura`).
   - El ciclo puede repetirse indefinidamente mientras la cuenta permanezca impaga.
4. **Finalización por Cobro en Caja**:
   - Al cobrar y liberar la mesa en caja, Socket.io emite `mesa_actualizada` con `estado: 'libre'`.
   - Se limpia el temporizador y el botón pasa a `✅ Cuenta Cerrada` / `✅ Mesa Libre`.
5. **Persistencia ante Recargas de Página**:
   - La hora de solicitud se guarda en el servidor (`Mesas.hora_pidio_cuenta`) y en `localStorage` (`solicitar_mesero_ts_{mesaId}`). Si el cliente recarga la página, el temporizador retoma exactamente los segundos restantes.

---

## 📁 Archivos Modificados

### 1. `server.js` & `database.js`
- Migración SQLite: `ALTER TABLE Mesas ADD COLUMN hora_pidio_cuenta TEXT`.
- Endpoint `POST /api/cliente/mesa/:id/pedir-cuenta`:
  - Guarda la marca de tiempo ISO en `hora_pidio_cuenta`.
  - Emite `cliente_pidio_cuenta` y `mesa_actualizada` con el timestamp.
- Endpoints de cobro y liberación (`/api/ordenes/:id/cobrar`, `/api/mesas/mover`):
  - Limpian `pidio_cuenta_qr = 0` y `hora_pidio_cuenta = NULL`.

### 2. `public/cliente.html` (Vista Móvil del Cliente)
- Estilos para botón deshabilitado con filtros y opacidad reducida.
- Función `iniciarTemporizadorSolicitarMesero(segundosRestantes)` con interval de 1s.
- Restauración del temporizador en `cargarDatosCliente()` al detectar `hora_pidio_cuenta`.

### 3. `public/app.js` & `public/styles.css` (Simulador de Celular en POS)
- Sincronización en el modal `#modalQrCliente` y botón `#btnClientePideCuentaWeb`.
- Función `iniciarTemporizadorPhoneMockup(mesaId, segundosRestantes)`.

---

## 🧪 Pruebas Automatizadas
Ubicación: `test/e2e/tier1-features.test.js`
- `T1.22`: `POST /api/cliente/mesa/:id/pedir-cuenta` asigna `hora_pidio_cuenta` y `pidio_cuenta_qr`.
- `T1.23`: Cooldown mantiene botón inactivo (<120s) y lo reactiva (>=120s) si la cuenta sigue abierta.
- `T1.24`: El cobro de orden libera la mesa y resetea `hora_pidio_cuenta` a NULL.


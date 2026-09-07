# 🖨️ GUÍA PASO A PASO: CONEXIÓN Y CONFIGURACIÓN DE IMPRESORA TÉRMICA REAL

Esta guía te explica detalladamente cómo conectar, configurar y dejar 100% lista tu impresora térmica física (de 80 mm o 58 mm) para usarla con el sistema de Punto de Venta (GastroBar POS).

---

## 📌 TABLA DE CONTENIDOS
1. [Preparación Física y Conexión](#1-preparación-física-y-conexión)
2. [MÉTODO 1: Impresora Térmica USB en Windows (Recomendado y más común)](#2-método-1-impresora-térmica-usb-en-windows)
3. [MÉTODO 2: Impresión Silenciosa Automática al Cobrar (Kiosk Printing)](#3-método-2-impresión-silenciosa-automática-al-cobrar-kiosk-printing)
4. [MÉTODO 3: Impresora Térmica por Red / Ethernet / Wi-Fi (ESC/POS TCP 9100)](#4-método-3-impresora-térmica-por-red--ethernet--wi-fi)
5. [MÉTODO 4: Impresora Térmica desde Tablet o Celular Android](#5-método-4-impresora-térmica-desde-tablet-o-celular-android)
6. [Pruebas de Fuego en Vivo](#6-pruebas-de-fuego-en-vivo)
7. [Solución de Problemas Frecuentes](#7-solución-de-problemas-frecuentes)

---

## 1. PREPARACIÓN FÍSICA Y CONEXIÓN

1. **Colocación del Rollo de Papel:**
   - Abre la tapa superior de la impresora térmica.
   - Coloca el rollo de papel térmico (80 mm o 58 mm) asegurándote de que el papel salga desde la parte inferior hacia el frente (la cara térmica sensible debe mirar hacia el cabezal).
   - Deja salir 2 o 3 centímetros de papel y cierra la tapa firmemente hasta escuchar un "clic".
2. **Conexión de Cables:**
   - **Alimentación:** Conecta el adaptador de corriente a la impresora y al enchufe de pared.
   - **Datos:** Conecta el cable USB al puerto USB de la computadora (o el cable de red RJ45 al router si es de red).
   - **Gaveta de Dinero (Opcional):** Si tienes cajón monedero, conecta su cable RJ11 al puerto trasero de la impresora con el icono de gaveta.
3. **Encendido y Auto-Test (Self-Test):**
   - Con la impresora apagada, mantén presionado el botón **FEED** (Avance) y enciende la impresora con el interruptor.
   - Suelta el botón **FEED** después de 2 segundos.
   - La impresora imprimirá automáticamente un tiquete de diagnóstico con su velocidad, puerto y dirección IP. Esto confirma que el mecanismo de impresión y el corte funcionan bien.

---

## 2. MÉTODO 1: IMPRESORA TÉRMICA USB EN WINDOWS

Este es el método estándar para terminales de caja y computadoras principales:

### Paso 1: Instalar el controlador (Driver) de tu marca
- Conecta el cable USB a la PC.
- Instala el driver del fabricante según tu modelo:
  - **Xprinter / POS-80 / POS-58:** Ejecuta el instalador `POS Printer Driver Setup` y selecciona `POS-80` (USB).
  - **Epson (TM-T20, TM-T88):** Instala el software `Epson Advanced Printer Driver (APD)`.
  - **Bixolon / Star Micronics / 3nStar:** Instala el driver oficial correspondiente.

### Paso 2: Configurar el tamaño de papel en Windows
1. Abre el **Panel de Control** de Windows > **Dispositivos e Impresoras** (o escribe `Impresoras` en el menú Inicio).
2. Haz clic derecho sobre tu impresora térmica (ej. *POS-80* o *EPSON TM-T20*) y entra a **Preferencias de Impresión**.
3. En la pestaña **Diseño / Papel / Opciones Avanzadas**:
   - Selecciona tamaño de papel: `80 x 297 mm` (o `72 x 297 mm` / `Roll Paper 80x297mm`).
   - En **Opciones de Corte (Cutter)**: Selecciona `Cut at end of document` (Cortar al final del documento) si tu impresora tiene guillotina automática.
   - En **Cajón de Dinero (Cash Drawer)**: Si tienes gaveta, selecciona `Open before print` o `Open after print` en el Pin 2 / Pin 5.
4. Haz clic en **Aplicar** y **Aceptar**.
5. Haz clic derecho de nuevo sobre la impresora y selecciona **Establecer como impresora predeterminada**.

### Paso 3: Configurar el navegador (Google Chrome / Microsoft Edge)
1. Abre el sistema POS en el navegador (`http://localhost:4000`).
2. Haz una prueba imprimiendo cualquier tiquete o presiona `Ctrl + P`.
3. En la ventana de impresión del navegador:
   - **Destino:** Selecciona tu impresora térmica (ej. *POS-80*).
   - **Páginas:** Todo.
   - **Márgenes:** Selecciona **Ninguno** (None).
   - **Opciones:** Desmarca la casilla **"Encabezados y pies de página"** (Headers and Footers) para que no salga la fecha ni la URL arriba o abajo del tiquete.
   - **Gráficos en segundo plano:** Marca la casilla para que se vean logos, líneas y bordes.
4. Presiona **Imprimir**. ¡Listo! El navegador guardará estos ajustes para todas las impresiones posteriores.

---

## 3. MÉTODO 2: IMPRESIÓN SILENCIOSA AUTOMÁTICA AL COBRAR (KIOSK PRINTING)

Si deseas que al presionar **"Cobrar y Liquidar"** el tiquete salga **al instante en 1 segundo** sin que se abra la ventana de confirmación de Windows:

1. Cierra todas las ventanas de Google Chrome.
2. Haz clic derecho sobre el acceso directo de Google Chrome en tu Escritorio y selecciona **Propiedades**.
3. En la pestaña **Acceso directo**, busca el campo **Destino** (Target).
4. Al final de la ruta (después de `chrome.exe"`), agrega un espacio y el siguiente parámetro:
   ```text
   --kiosk-printing --app=http://localhost:4000
   ```
   *Ejemplo completo del campo Destino:*
   `"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing --app=http://localhost:4000`
5. Haz clic en **Aplicar** y **Aceptar**.
6. Abre el sistema usando ese acceso directo: ¡ahora todas las comandas y tiquetes se imprimirán automáticamente de forma instantánea y silenciosa!

---

## 4. MÉTODO 3: IMPRESORA TÉRMICA POR RED / ETHERNET / WI-FI

Si tienes una impresora de cocina o barra conectada mediante cable de red RJ45 al router:

### Paso 1: Conocer la IP de la impresora
- Realiza el **Self-Test** (enciende la impresora manteniendo presionado **FEED**).
- El tiquete mostrará la línea: `IP Address: 192.168.1.XXX` (ej. `192.168.1.200`).

### Paso 2: Probar la comunicación de red
1. Abre la consola PowerShell o CMD en la computadora y escribe:
   ```powershell
   ping 192.168.1.200
   ```
2. Si responde `Respuesta desde 192.168.1.200...`, la impresora ya está enlazada a tu red.

### Paso 3: Configurar en el backend del POS
El sistema incluye el servicio nativo ESC/POS en `printerService.js` que se comunica directamente por sockets TCP (Puerto 9100 estándar para Epson/Xprinter/Star).

Para activar el envío directo por red en `printerService.js`:
```javascript
let printerConfig = {
  caja:   { nombre: 'Impresora Caja',   tipo: 'red', ip: '192.168.1.200', puerto: 9100, activa: true },
  cocina: { nombre: 'Impresora Cocina', tipo: 'red', ip: '192.168.1.201', puerto: 9100, activa: true },
  barra:  { nombre: 'Impresora Barra',  tipo: 'red', ip: '192.168.1.202', puerto: 9100, activa: true },
};
```

---

## 5. MÉTODO 4: IMPRESORA TÉRMICA DESDE TABLET O CELULAR ANDROID

Si los saloneros o cajeros operan desde una tablet o smartphone Android:

1. **Conexión Bluetooth o Wi-Fi:**
   - Enciende la impresora térmica Bluetooth/Wi-Fi y emparéjala en los Ajustes de Bluetooth de la tablet (PIN usualmente `0000` o `1234`).
2. **Instalar App RawBT (Recomendado):**
   - Descarga **RawBT Print Service** gratis desde Google Play Store.
   - Abre RawBT, selecciona tu modelo de impresora térmica y haz una prueba de conexión.
   - Activa el servicio en segundo plano de RawBT.
3. **Impresión desde el navegador móvil:**
   - Al abrir el sistema POS en Chrome móvil (`http://IP-DE-TU-PC:4000`), cuando presiones ver o imprimir tiquete, selecciona compartir/imprimir con **RawBT** para impresión térmica directa e instantánea.

---

## 6. PRUEBAS DE FUEGO EN VIVO

Para comprobar que todo funciona a la perfección, realiza estas 3 pruebas:

### ✅ Prueba 1: Comanda de Cocina (Solo Alimentos)
1. Abre una mesa (ej. Mesa 1).
2. Agrega 1 Casado con Carne Mechada, 1 Chifrijo y 2 Cervezas Imperial.
3. Presiona **"🔥 Enviar Comanda a Cocina"**.
4. **Resultado esperado:**
   - En la impresora de cocina se imprime la comanda **únicamente con los alimentos** (Casado y Chifrijo).
   - Las 2 cervezas quedan excluidas de cocina.
   - La impresora emite un pitido y corta el papel.

### ✅ Prueba 2: Cobro y Liquidación de Mesa (Tiquete de Cliente)
1. Con la Mesa 1 abierta con consumos, haz clic en **"💵 Cobrar / Liquidar"**.
2. Selecciona método de pago (Efectivo o Tarjeta) e ingresa el monto recibido.
3. Presiona **"✅ Liquidar, Imprimir & Liberar Mesa"**.
4. **Resultado esperado:**
   - Se abre el visor térmico y se envía a la impresora.
   - Se imprime el tiquete con el encabezado de GastroBar, desglose de IVA (13%), Servicio de Salón (10%), vuelto calculado y código QR tributario.
   - Si tienes gaveta conectada, se abre automáticamente al cobrar.

### ✅ Prueba 3: Corte X (Parcial) y Cierre Z (Final)
1. Ve al menú superior > **Caja**.
2. Presiona **"📑 Corte X"**.
3. Digita el PIN de Administrador (`1234`).
4. **Resultado esperado:**
   - Se imprime el arqueo parcial de caja con las ventas del turno, desglose de pagos y efectivo en gaveta.
5. Presiona **"🔒 Cierre Z"**, digita el PIN y el conteo físico de dinero.
6. **Resultado esperado:**
   - Se imprime el tiquete oficial de Cierre Definitivo de Turno con el cuadre de caja (sobrante/faltante) y resumen de propinas.

---

## 7. SOLUCIÓN DE PROBLEMAS FRECUENTES

| Problema | Causa más probable | Solución rápida |
| :--- | :--- | :--- |
| **El papel sale pero completamente en blanco** | El rollo de papel está colocado al revés. | Da la vuelta al rollo de papel para que la cara térmica quede hacia el cabezal. |
| **El texto sale cortado del lado derecho** | Tamaño de papel configurado en 58 mm cuando la impresora es de 80 mm (o viceversa). | En Preferencias de Impresión del driver, selecciona `80 x 297 mm` y en el navegador pon márgenes en `Ninguno`. |
| **Aparecen letras raras o símbolos extraños** | Velocidad de baudios (Baudrate) o driver incorrecto. | Reinstala el driver oficial seleccionando el modelo exacto (ej. POS-80C con codificación UTF-8 / PC850). |
| **No corta el papel automáticamente** | Opción de corte deshabilitada en el driver. | En Preferencias de Impresión > Opciones de dispositivo > Cambiar `Cutter` a `Document Cut / Partial Cut`. |
| **La gaveta de dinero no salta al cobrar** | Cable RJ11 desconectado o comando de apertura desactivado. | Revisa que el cable RJ11 esté firme entre la gaveta y la impresora, y en las propiedades del driver activa `Cash Drawer: Open before print`. |

---

> **¿Listo para probar?**
> Conecta el cable USB o de red a tu impresora, enciende el equipo, abre el sistema en `http://localhost:4000` y haz clic en **Caja > 📑 Corte X** para lanzar tu primer tiquete de prueba.

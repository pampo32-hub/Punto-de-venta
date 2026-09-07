# 🌐 GUÍA: CÓMO IMPRIMIR EN IMPRESORAS TÉRMICAS CUANDO EL POS ESTÁ EN LA WEB / NUBE

Cuando tu sistema de Punto de Venta está subido en un **servidor web en Internet** (por ejemplo: `https://mi-restaurante-pos.com`, Render, Railway, DigitalOcean, VPS o AWS), el servidor remoto no tiene acceso físico directo a los cables USB o a las IPs privadas de tu restaurante (`192.168.1.xxx`).

Para solucionar esto de manera profesional, tienes **3 formas estándar** de imprimir según cómo trabaje tu restaurante:

---

## 🚀 OPCIÓN 1: Impresión Directa desde el Navegador Web (Recomendada para Caja)
**Ideal para:** Cobrar mesas, emitir facturas y tiquetes de cliente desde cualquier PC o laptop en la caja.  
**Instalación requerida:** **Cero programas extra.**

### ¿Cómo funciona?
1. La cajera abre el navegador (Chrome, Edge) y entra a la web de tu sistema: `https://mi-pos-restaurante.com`.
2. La impresora térmica de caja está conectada por **cable USB** a esa computadora.
3. Cuando la cajera presiona **"Cobrar y Liquidar"**, el sistema genera el tiquete y abre la ventana de impresión nativa del navegador (`window.print()`).
4. La computadora local envía el trabajo a la impresora USB seleccionada como predeterminada.

### ⚡ Truco Pro: Impresión Silenciosa en 1 Clic (Modo Kiosk)
Para que no aparezca el cuadro de diálogo de Windows y el tiquete se imprima **automáticamente en 0.5 segundos al presionar cobrar**:
1. Crea un acceso directo en el escritorio de Chrome con este destino:
   ```text
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing --app=https://mi-pos-restaurante.com
   ```
2. Al abrir el sistema desde ese acceso directo, cada cobro saldrá directo por la impresora sin pedir confirmación.

---

## 🍳 OPCIÓN 2: Agente de Impresión Local Automático (Recomendada para Cocina y Barra)
**Ideal para:** Comandas automáticas. Si un mesero está atendiendo con una tablet/celular en una mesa y presiona *"Enviar a Cocina"*, la comanda debe salir **sola en la impresora física de la cocina**, sin que nadie toque la computadora.  
**Instalación requerida:** Ejecutar un pequeño script en segundo plano en la PC de la caja.

### ¿Cómo funciona?
El sistema incluye el script [`agente-impresion-local.js`](file:///C:/Users/Juan/Desktop/agente-impresion-local.js).
1. En la PC del restaurante donde están conectadas las impresoras térmicas (o en la misma red Wi-Fi/Ethernet), abres una consola y ejecutas:
   ```bash
   node agente-impresion-local.js
   ```
2. Este agente se conecta por **WebSockets (Socket.IO)** a tu servidor web en la nube en tiempo real.
3. **El flujo es instantáneo:**
   - Salonero pide comida desde su celular en la mesa 4 (en `https://mi-pos-restaurante.com`).
   - El servidor en la nube genera la comanda ESC/POS y emite el evento al restaurante.
   - El agente local recibe los datos y los despacha por cable o red local al puerto `9100` / `9101` de la impresora de cocina física.
   - La impresora pita y corta el papel de forma 100% desatendida.

### Configuración del Agente:
Dentro de `agente-impresion-local.js`, solo defines la URL de tu web:
```javascript
const CONFIG = {
  servidorWebUrl: 'https://mi-pos-restaurante.com', // Tu dominio en la nube
  impresoras: {
    caja:   { ip: '127.0.0.1',     puerto: 9100 },
    cocina: { ip: '192.168.1.201', puerto: 9100 }, // IP local de la impresora de cocina
    barra:  { ip: '192.168.1.202', puerto: 9100 }, // IP local de la impresora de barra
  }
};
```

---

## 📱 OPCIÓN 3: Impresión desde Celulares / Tablets (App RawBT)
**Ideal para:** Saloneros que llevan una impresora térmica móvil portátil (Bluetooth o Wi-Fi) colgada al cinturón.

1. Instala la app gratuita **RawBT Print Service** desde Google Play Store en el celular o tablet.
2. Vincula la impresora térmica por Bluetooth.
3. Al entrar al sistema POS web desde el celular, cuando el salonero presione imprimir precuenta o tiquete, RawBT se encargará de enviarlo directamente por Bluetooth.

---

## 📊 COMPARATIVA RÁPIDA: ¿CUÁL DEBO USAR?

| Escenario | Solución recomendada | ¿Cómo se configura? |
| :--- | :--- | :--- |
| **Caja cobra desde la PC** | **Opción 1:** Navegador + Kiosk Printing | Conectar USB + Driver en Windows |
| **Meseros piden en tablets y cocina imprime sola** | **Opción 2:** Agente Local (`agente-impresion-local.js`) | Dejar corriendo el agente en la PC de caja |
| **Salonero cobra en la mesa con impresora portátil** | **Opción 3:** App RawBT (Bluetooth) | Vincular Bluetooth en la tablet |

---

## 🛠️ PASOS PARA PROBAR HOY MISMO:
1. Si vas a probar en tu computadora actual como si fuera la caja, el navegador imprimirá directamente con la **Opción 1** al hacer clic en **Imprimir**.
2. Si quieres probar el envío automático remoto a cocina por red, ejecuta `node agente-impresion-local.js`.

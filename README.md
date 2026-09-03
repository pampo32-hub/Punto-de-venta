# 🍔🍻 Punto de Venta (Restaurante & Bar POS)

Sistema moderno, táctil y en tiempo real para Restaurantes, Bares, Cafeterías y Pizzerías.

## 🚀 Características Principales

1. **🗺️ Mapa de Mesas y Áreas Interactivo**:
   - Salón Principal, Barra, Terraza, VIP.
   - Estados en tiempo real: Libre (verde), Ocupada (rojo), Cuenta Pedida (amarillo).
2. **📱 Comandero Táctil**:
   - Diseñado para pantallas táctiles, tablets de meseros y celulares.
   - Categorías con iconos (Cervezas, Tragos, Entradas, Platos Fuertes, etc.).
   - Modificadores y notas de cocina.
   - Cálculo automático del 10% de Servicio y 13% de IVA.
3. **🍳 Pantalla de Cocina (KDS) y Barra en Vivo**:
   - Conexión instantánea mediante WebSockets (Socket.IO).
   - Cronómetro de pedidos y botón para marcar platillos listos.
4. **💵 Cobro y Caja**:
   - Efectivo (con cálculo de vuelto), Tarjetas y SINPE Móvil.
   - Control de fondos de caja y Cierre de Turno (Corte Z).
5. **📊 Base de Datos Local Ultra Rápida**:
   - SQLite portátil: no requiere instalar servidores pesados.

## 🛠️ Cómo Iniciar

```bash
cd C:\Users\Juan\punto-de-venta
npm start
```

Abre en tu navegador:
- Desde la PC principal: `http://localhost:4000`
- Desde tablets o celulares de meseros: `http://<IP-DE-TU-PC>:4000`

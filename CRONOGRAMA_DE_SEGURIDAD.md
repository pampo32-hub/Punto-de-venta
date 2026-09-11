# 🛡️ Cronograma y Arquitectura de Seguridad - GastroBar POS

Este documento describe el flujo completo de validación de accesos, protección contra accesos remotos no autorizados, control de dispositivos autorizados y prevención de clonación de cuentas en el sistema GastroBar POS.

---

## 📊 Diagrama de Flujo de Acceso y Validación de Seguridad

`mermaid
flowchart TD
    Inicio(["👤 Intento de Inicio de Sesión"]) --> EvalRol{"¿Es Administrador o Developer?"}

    %% Rama de Exención
    EvalRol -- "Sí (admin / developer)" --> Bypass["🔓 Acceso Directo Concedido<br/>(Permitido desde cualquier red o dispositivo)"]

    %% Rama de Validación para Roles Operativos
    EvalRol -- "No (salonero / cajero / cocinero)" --> CheckIP{"¿Restricción por IP Activa en el Local?"}

    %% Capa 1: Filtro de IP
    CheckIP -- "Sí y la IP no coincide" --> BloqueoIP["⛔ BLOQUEO POR RED EXTERNA<br/>HTTP 403: Acceso solo permitido desde la red del bar"]
    CheckIP -- "No / IP Coincide con el Bar" --> CheckDevice{"¿Restricción de Dispositivos Activa?"}

    %% Capa 2: Lista Blanca de Dispositivos
    CheckDevice -- "Dispositivo NO Autorizado" --> BloqueoDevice["📱 MODAL DE BLOQUEO DE DISPOSITIVO<br/>Acceso restringido a terminales autorizadas.<br/>Permite solicitar autorización a un Administrador con PIN"]
    CheckDevice -- "Dispositivo Autorizado / Inactiva" --> CheckSession{"¿Sesión Única Activa?"}

    %% Capa 3: Sesión Única
    CheckSession -- "Usuario activo en otro equipo" --> KillPrev["⚡ CIERRE DE SESIÓN REMOTO (WebSockets)<br/>Expulsa inmediatamente la sesión previa en la otra terminal"]
    CheckSession -- "Sin conflicto de sesión" --> LoginOK
    KillPrev --> LoginOK["✅ SESIÓN INICIADA EXITOSAMENTE<br/>Carga pantalla operativa del POS"]
`

---

## 🛡️ Las 3 Capas de Protección Explicadas

### 1️⃣ Capa 1: Restricción de Red por IP Pública del Bar
* **Objetivo:** Impedir que los empleados ingresen al sistema desde sus casas, datos móviles fuera del local o conexiones remotas.
* **Mecanismo:** El servidor compara la IP pública de la petición HTTP contra la IP configurada en la base de datos para el negocio.
* **Roles Exentos:** dmin, superadmin, developer pueden entrar desde cualquier ubicación para tareas de gestión o soporte.

### 2️⃣ Capa 2: Lista Blanca de Dispositivos Autorizados (Device Whitelisting)
* **Objetivo:** Evitar que un empleado le dé sus credenciales a un cliente conectado al WiFi del bar o use un teléfono personal no registrado.
* **Mecanismo:**
  * Cada terminal autorizada posee un token criptográfico único (pos_device_token) guardado en almacenamiento local seguro.
  * Al iniciar sesión con un rol operativo, el servidor verifica que el token esté registrado en la tabla DispositivosAutorizados y en estado ctivo = 1.
  * Si el equipo no está registrado, el sistema bloquea el acceso y muestra una ventana emergente.
* **Autorización Rápida:** Un administrador puede ingresar su PIN o credenciales en esa misma ventana emergente para registrar y nombrar la nueva terminal (ej. *"Tablet Terraza 1"*, *"PC Caja Principal"*).

### 3️⃣ Capa 3: Sesión Única Activa (Anti-Clonación)
* **Objetivo:** Impedir que una misma cuenta de empleado sea utilizada en dos dispositivos simultáneamente.
* **Mecanismo:**
  * Cada inicio de sesión genera un identificador de sesión único (sessionId).
  * Si se inicia sesión con la misma cuenta en un segundo equipo, el servidor emite una notificación en tiempo real vía **WebSockets** (usuario_sesion_iniciada).
  * El primer equipo detecta la discrepancia, destruye el token local y redirige de inmediato a la pantalla de login con una alerta informativa.

---

## 📋 Matriz de Roles y Niveles de Restricción

| Rol | Restricción por IP | Restricción de Dispositivo | Sesión Única | Puede Autorizar / Revocar |
| :--- | :---: | :---: | :---: | :---: |
| **Developer / Soporte** | ❌ Exento | ❌ Exento | ❌ Desactivado | ✅ Sí |
| **Super Administrador / Admin** | ❌ Exento | ❌ Exento | ❌ Desactivado | ✅ Sí |
| **Cajero** | ✅ Aplica | ✅ Aplica | ✅ Aplica | ❌ No |
| **Salonero / Mesero / Bartender** | ✅ Aplica | ✅ Aplica | ✅ Aplica | ❌ No |
| **Cocinero / Cocina** | ✅ Aplica | ✅ Aplica | ✅ Aplica | ❌ No |

---

## ⚙️ Guía de Uso Rápida para el Administrador

1. **Acceder a la Configuración:**
   * Entra al sistema como Administrador.
   * Ve a **⚙️ Menú Administración** ➔ **🌐 Seguridad & Red del Local**.
2. **Activar las Protecciones:**
   * Activa el interruptor **"Restringir a Dispositivos Autorizados"**.
   * Activa el interruptor **"Sesión Única Activa"**.
   * *(Opcional)* Si el bar tiene IP fija, ingresa la IP en **"Restricción por IP Pública"**.
3. **Gestionar Terminales:**
   * En la tabla inferior puedes ver el nombre, tipo de equipo, navegador y fecha de cada dispositivo registrado.
   * Puedes revocar el acceso de cualquier dispositivo en cualquier momento haciendo clic en el botón de eliminar 🗑️.
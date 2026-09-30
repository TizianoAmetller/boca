# ⚽ Boca Entradas Bot

Bot automatizado para monitorear y reservar entradas en bocasocios.bocajuniors.com.ar

## 🎯 Funcionalidades

- ✅ Monitoreo automático de la página de entradas
- ✅ Refresco constante hasta encontrar entradas disponibles
- ✅ Reserva automática cuando detecta disponibilidad
- ✅ Interfaz simple y fácil de usar
- ✅ Configuración de intervalo de recarga
- ✅ Filtro opcional por sección

## 📦 Instalación

1. **Descarga o clona este repositorio**

2. **Abre Chrome y ve a:**
   ```
   chrome://extensions/
   ```

3. **Habilita el "Modo de desarrollador"** (toggle en la esquina superior derecha)

4. **Haz clic en "Cargar extensión sin empaquetar"**

5. **Selecciona la carpeta `extension/` del proyecto**

6. **¡Listo!** Verás el ícono de la extensión en la barra de herramientas

## 🚀 Uso

1. **Abre la página de entradas de Boca:**
   ```
   https://bocasocios.bocajuniors.com.ar/matches/[ID]/plateas
   ```

2. **Inicia sesión** en tu cuenta de Boca Socios

3. **Haz clic en el ícono de la extensión** en la barra de herramientas

4. **Configura los parámetros:**
   - Intervalo de recarga (segundos)
   - Sección deseada (opcional)

5. **Haz clic en "Iniciar Monitor"**

6. **El bot comenzará a monitorear** y te notificará cuando encuentre entradas

7. **Cuando encuentre una entrada disponible**, intentará reservarla automáticamente

8. **Completa el pago manualmente** cuando el bot haya reservado la entrada

## ⚙️ Configuración

- **Chequeo de la página:** Fijo en 0.1 segundos. Solo revisa la página ya cargada, no hace pedidos al servidor
- **Filtrar por sección:** Opcional, para buscar solo en una sección específica (ej: "Platea Alta", "TS 1")
- **Refrescar página automáticamente:** Si está marcado, la página se recarga para obtener nuevos datos del servidor
- **Intervalo de recarga:** Cada cuántos segundos se recarga la página (por defecto 1, mínimo 0.3). Cada recarga es un pedido completo al servidor y cuenta para el rate limit
- **Aviso de fila:** Si la pestaña pasó por la sala de espera de Queue-it, al volver a Boca Socios la ventana se trae al frente, muestra una notificación y el título pasa a "✅ ADENTRO"

## ⚠️ Notas Importantes

- Debes estar **logueado** en tu cuenta de Boca Socios
- El bot solo **reserva** la entrada, **NO completa el pago**
- Usa con responsabilidad y respeta los términos de servicio
- El bot funciona mejor si la pestaña está activa

## 🔧 Solución de Problemas

### El bot no detecta entradas
- Verifica que estés en la página correcta
- Revisa la consola del navegador (F12) para ver logs
- Ajusta el intervalo de recarga

### No se reserva automáticamente
- Verifica que estés logueado
- Revisa si hay captcha o verificaciones adicionales
- La estructura de la página puede haber cambiado

## 🪟 Varias ventanas en la fila (launcher)

`launcher/launch.py` abre N ventanas de Chrome para ocupar N lugares en cualquier sala de
espera de Queue-it (Boca Socios, Deportick, etc.). Cada ventana es un Chrome con su propio
perfil y trae esta extensión cargada. Las tabs no sirven para esto: todas las tabs de un perfil
comparten las cookies, así que ocupan un solo lugar. **No compra nada**: comprás a mano en la
ventana que pase primero.

Requisitos: Google Chrome y Python 3 (macOS o Windows, sin dependencias extra).

```bash
# 1. Antes de la venta: loguearte una vez. Después cerrá Chrome del todo (en Mac: Cmd+Q)
python3 launcher/launch.py --setup

# 2. Unos 5 minutos antes: abrir las ventanas (en Windows: python en vez de python3)
python3 launcher/launch.py -u "<url>" -n 9

# Borrar los perfiles y el login guardado
python3 launcher/launch.py --reset
```

- `-u`: la URL. `<ID>` es el número del partido: entrá al partido en Boca Socios y copiá la URL
  entera. Sin `-u` abre la página principal de Boca Socios. Para otro sitio (por ejemplo
  Deportick) pasale su URL, también en `--setup`.
- `-n`: cuántas ventanas. Sin `-n` abre 9.

- **Login:** te logueás una vez en `profile-0`. Cada ventana extra recibe una copia de sus
  cookies y su localStorage.
- **Lugar propio:** antes de abrir se borran las cookies de Queue-it de todos los perfiles, así
  cada ventana recibe un QueueId nuevo.
- **Posición en el título:** en la sala de espera, la extensión pone en el título de la pestaña
  cuánta gente hay adelante (o tu número) y la espera estimada, por ejemplo
  `👥 1234 adelante · ⏱ 6 minutes · a1b2`. Los 4 caracteres del final son el QueueId: tienen
  que ser distintos en cada ventana.
- **Grilla:** las ventanas se acomodan en columnas de ~500px (el mínimo de Chrome), hasta 4 filas.
  En Windows la grilla ocupa todos los monitores; en Mac, solo la pantalla principal.
- **Podés cerrar la terminal:** las ventanas siguen abiertas. No relances el script con las
  ventanas en la fila: empieza de cero y perdés los lugares (el script avisa y no te deja).
- Los perfiles quedan en `launcher/profiles/` (está en `.gitignore`). Tienen tu token de login:
  no los compartas.

Cuántas ventanas: con 9 (3 × 3) la página se lee bien; con 12 (3 × 4) solo se ve la barra de
tabs, pero alcanza para ver cuál pasó. Cada ventana es un Chrome entero: si empiezan a cargar
lento, abriste demasiadas. Queue-it suele sortear a todos los que llegan *antes* de que abra la
venta, así que conviene abrir las ventanas unos minutos antes.

Carga de la extensión: Chrome 137+ ignora `--load-extension`, así que el script la carga por el
protocolo de DevTools (`--remote-debugging-pipe` + `Extensions.loadUnpacked`). Probado en macOS
con Chrome 154. **En Windows todavía no se probó.**

Abrir varios lugares en la fila probablemente va contra los términos de servicio del sitio.

## 🔍 Cómo funciona

1. **Paso 1 - SECTOR:** El bot detecta sectores disponibles en el mapa del estadio (elementos verdes, clickeables) y hace click inmediatamente
2. **Paso 2 - PÁGINA DE ASIENTOS:** Automáticamente busca y hace click en el botón amarillo **"BUSCAR ASIENTO DISPONIBLE"** (más rápido que buscar asientos individuales)
3. **Paso 3 - MODAL DE CONFIRMACIÓN:** Cuando aparece el modal con la ubicación seleccionada, hace click en el botón blanco **"+ AGREGAR PLATEA"**
4. **Paso 4 - RESERVA:** Continúa con el proceso de reserva
5. **Velocidad máxima:** Verifica la página cada 0.1 segundos
6. **Refresco automático:** Opcionalmente refresca la página cada 10 segundos para obtener datos actualizados

**El bot maneja automáticamente todo el flujo optimizado:** SECTOR → BUSCAR ASIENTO → AGREGAR PLATEA → RESERVA, todo sin intervención manual.

## 📝 Desarrollo

Para modificar los selectores y lógica de detección, edita `content.js`:
- Función `findAvailableTickets()`: detecta entradas disponibles
- Función `reserveTicket()`: realiza la reserva

**Nota:** Si la página cambia su estructura HTML, puede ser necesario actualizar los selectores en `findAvailableTickets()`.

## 📄 Licencia

Uso personal solamente. Usa con responsabilidad.

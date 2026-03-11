# ⚽ Boca Entradas Bot

Bot automatizado para monitorear y reservar entradas en bocasocios.bocajuniors.com.ar

## 🎯 Funcionalidades

- ✅ Monitoreo automático de la página de entradas
- ✅ Refresco constante hasta encontrar entradas disponibles
- ✅ Reserva automática cuando detecta disponibilidad
- ✅ Interfaz simple y fácil de usar
- ✅ Configuración de intervalo de refresco
- ✅ Filtro opcional por sección

## 📦 Instalación

1. **Descarga o clona este repositorio**

2. **Abre Chrome y ve a:**
   ```
   chrome://extensions/
   ```

3. **Habilita el "Modo de desarrollador"** (toggle en la esquina superior derecha)

4. **Haz clic en "Cargar extensión sin empaquetar"**

5. **Selecciona la carpeta del proyecto**

6. **¡Listo!** Verás el ícono de la extensión en la barra de herramientas

## 🚀 Uso

1. **Abre la página de entradas de Boca:**
   ```
   https://bocasocios.bocajuniors.com.ar/matches/[ID]/plateas
   ```

2. **Inicia sesión** en tu cuenta de Boca Socios

3. **Haz clic en el ícono de la extensión** en la barra de herramientas

4. **Configura los parámetros:**
   - Intervalo de refresco (segundos)
   - Sección deseada (opcional)

5. **Haz clic en "Iniciar Monitor"**

6. **El bot comenzará a monitorear** y te notificará cuando encuentre entradas

7. **Cuando encuentre una entrada disponible**, intentará reservarla automáticamente

8. **Completa el pago manualmente** cuando el bot haya reservado la entrada

## ⚙️ Configuración

- **Intervalo de refresco:** Tiempo entre cada verificación del DOM (por defecto: 0.5 segundos para máxima velocidad, mínimo: 0.1 segundos)
- **Filtrar por sección:** Opcional, para buscar solo en una sección específica (ej: "Platea Alta", "TS 1")
- **Refrescar página automáticamente:** Si está marcado, la página se refrescará cada 10 segundos para obtener nuevos datos del servidor

## ⚠️ Notas Importantes

- Debes estar **logueado** en tu cuenta de Boca Socios
- El bot solo **reserva** la entrada, **NO completa el pago**
- Usa con responsabilidad y respeta los términos de servicio
- El bot funciona mejor si la pestaña está activa

## 🔧 Solución de Problemas

### El bot no detecta entradas
- Verifica que estés en la página correcta
- Revisa la consola del navegador (F12) para ver logs
- Ajusta el intervalo de refresco

### No se reserva automáticamente
- Verifica que estés logueado
- Revisa si hay captcha o verificaciones adicionales
- La estructura de la página puede haber cambiado

## 🔍 Cómo funciona

1. **Paso 1 - SECTOR:** El bot detecta sectores disponibles en el mapa del estadio (elementos verdes, clickeables) y hace click inmediatamente
2. **Paso 2 - PÁGINA DE ASIENTOS:** Automáticamente busca y hace click en el botón amarillo **"BUSCAR ASIENTO DISPONIBLE"** (más rápido que buscar asientos individuales)
3. **Paso 3 - MODAL DE CONFIRMACIÓN:** Cuando aparece el modal con la ubicación seleccionada, hace click en el botón blanco **"+ AGREGAR PLATEA"**
4. **Paso 4 - RESERVA:** Continúa con el proceso de reserva
5. **Velocidad máxima:** Verifica cada 0.5 segundos (configurable hasta 0.1 segundos)
6. **Refresco automático:** Opcionalmente refresca la página cada 10 segundos para obtener datos actualizados

**El bot maneja automáticamente todo el flujo optimizado:** SECTOR → BUSCAR ASIENTO → AGREGAR PLATEA → RESERVA, todo sin intervención manual.

## 📝 Desarrollo

Para modificar los selectores y lógica de detección, edita `content.js`:
- Función `findAvailableTickets()`: detecta entradas disponibles
- Función `reserveTicket()`: realiza la reserva

**Nota:** Si la página cambia su estructura HTML, puede ser necesario actualizar los selectores en `findAvailableTickets()`.

## 📄 Licencia

Uso personal solamente. Usa con responsabilidad.

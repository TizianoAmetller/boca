# 🚀 Versiones del Bot - Comparativa

## 📊 Versiones Disponibles

### 1️⃣ **content.js** - Versión Optimizada
- **Velocidad**: 1ms interval = ~1000 checks/segundo en asientos
- **Método**: `setInterval(checkForTickets, 1)`
- **Búsqueda**: Regex `/[+\s]*agregar\s+platea/i`
- **CPU**: Uso moderado-alto
- **Ventajas**: 
  - ✅ Estable y predecible
  - ✅ MutationObserver para modales
  - ✅ Regex mejorado para variaciones de espacios
- **Desventajas**: 
  - ⚠️ Búsqueda estricta (solo regex)
  - ⚠️ Puede fallar si el botón tiene texto diferente
- **Estado**: Funcional pero puede fallar en detección de botón final

### 2️⃣ **content-hybrid.js** - Versión Híbrida ⭐ **RECOMENDADA**
- **Velocidad**: 1ms interval + MutationObserver instantáneo
- **Método**: `setInterval(1ms)` + `MutationObserver`
- **Búsqueda**: Búsqueda flexible con `.includes()`
- **CPU**: Uso moderado-alto
- **Ventajas**: 
  - ⚡ Máxima velocidad (1ms interval)
  - 🎯 Búsqueda MUY flexible (agregar, añadir, reservar, confirmar, platea)
  - 📊 **Captura automática de botones** en sessionStorage
  - 🔍 Función `verBotonesCapturados()` para debugging
  - 🔄 Busca en modales Y en toda la página
  - 📝 Logs cada 20 checks
- **Desventajas**: 
  - Uso de CPU alto en página de asientos
- **Estado**: ⭐ **MEJOR OPCIÓN** - Con sistema de debugging integrado

---

## 🏆 Recomendación

**Usa `content-hybrid.js`** porque:

1. ✅ **Velocidad máxima**: 1ms = 1000 checks/segundo
2. ✅ **Búsqueda flexible**: Detecta múltiples variaciones del botón
3. ✅ **Sistema de debugging**: Captura automáticamente qué botones encuentra
4. ✅ **Análisis post-ejecución**: `verBotonesCapturados()` en consola

---

## 📝 Cómo Cambiar de Versión

Edita `manifest.json`:

```json
// Versión híbrida (recomendada)
"js": ["content-hybrid.js"]

// Versión original optimizada
"js": ["content.js"]
```

Luego: `chrome://extensions` > **Recargar extensión**

---

## 🔍 Debugging con content-hybrid.js

### Después de que el bot intente reservar:

1. **Abre Console** (F12)
2. **Ejecuta**:
   ```javascript
   verBotonesCapturados()
   ```
3. **Revisa el output** - Verás TODOS los botones que el bot encontró
4. **Busca el botón correcto** - Identifica el texto exacto
5. **Reporta** - Si el bot no lo detectó, podemos ajustar el código

### Qué información captura:

```
[1] 2025-11-13T...
Source: interval / MutationObserver
Step: agregar-platea
URL: https://bocasocios.bocajuniors.com.ar/...
Botones (15):
  1. "Cancelar"
  2. "Volver"
  3. "+ AGREGAR PLATEA"  ← Este es el que necesitamos
  ...
```

---

## 🎯 Palabras Clave que Detecta (content-hybrid.js)

El bot hace click en botones que contengan:
- `agregar`
- `añadir`
- `reservar`
- `confirmar`
- `platea`

**Modo**: Case-insensitive, busca en cualquier parte del texto

---

## 📊 Métricas Esperadas

Con **content-hybrid.js**:
- **Sector verde → Click**: <5ms
- **Página asientos → Buscar**: <50ms
- **Modal aparece → Agregar**: <10ms
- **Total**: ~100-200ms desde sector verde hasta reserva 🚀

---

## ⚙️ Archivos del Proyecto

```
content.js          - Versión optimizada original
content-hybrid.js   - Versión híbrida con debugging ⭐
manifest.json       - Configuración (apunta a hybrid)
popup.js/html       - Interfaz de usuario
background.js       - Service worker
```


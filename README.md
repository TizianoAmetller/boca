# ⚽ Boca Entradas Bot

Extensión de Chrome que busca y reserva entradas en [Boca Socios](https://bocasocios.bocajuniors.com.ar),
más un launcher que abre varias ventanas para ocupar más de un lugar en la fila de Queue-it.
Solo **reserva**: el pago lo completás a mano.

## Requisitos

- Google Chrome
- Una cuenta de Boca Socios
- Python 3, solo para el launcher (macOS o Windows, sin dependencias extra)

## Instalación

1. Cloná el repo:
   ```bash
   git clone https://github.com/TizianoAmetller/boca.git
   ```
   o descarga el zip
2. Cargá la extensión en Chrome:
   1. Abrí `chrome://extensions`.
   2. Activá **Modo de desarrollador** (arriba a la derecha).
   3. Hacé click en **Cargar extensión sin empaquetar**.
   4. Elegí la carpeta **`extension/`** del repo (no la raíz).
   5. Fijá la extensión en la barra: ícono de rompecabezas 🧩 → 📌 al lado de *Boca Entradas Bot*.

Si actualizás el repo, volvé a `chrome://extensions` y apretá ↻ en la extensión.

El launcher no se instala: ya carga la extensión solo en cada ventana que abre.

## Uso

### Extensión (una ventana)

1. Logueate en Boca Socios y abrí la página del partido
   (`https://bocasocios.bocajuniors.com.ar/matches/<ID>/plateas`).
2. Hacé click en el ícono de la extensión.
3. Opcional: elegí **Sectores** y activá **Recargar cada (s)**.
4. Apretá **Iniciar**. El bot elige un sector libre, busca asiento y agrega la platea.
5. Cuando reserve, completá el pago a mano.

Para frenarlo: **Detener** en el popup o `Alt+Shift+S`.

### Launcher (varias ventanas en la fila)

Cada ventana es un Chrome con su propio perfil, así que ocupa su propio lugar en la fila.
En Windows usá `python` en vez de `python3`.

**1. Antes de la venta, logueate una vez:**
```bash
python3 launcher/launch.py --setup
```
Se abre una ventana: logueate y cerrá Chrome del todo (en Mac: `Cmd+Q`). El script termina solo.

**2. Unos 5 minutos antes, abrí las ventanas:**
```bash
python3 launcher/launch.py -u "<url>" -n 9
```

Si no pasamos los parametros:
- url default: `https://bocasocios.bocajuniors.com.ar`
- cantidad default de ventanas: 3

**3. En la fila:**
- El título de cada pestaña muestra el tiempo de espera estimado
- El queue-id tiene que ser distinto por cada ventana
- No recargues, no cierres ventanas y no vuelvas a correr el script: perdés los lugares.
  Cerrar la terminal sí se puede.
- La ventana que pasa se trae al frente y su título pasa a `✅ ADENTRO`. Ahí usá la extensión
  como siempre.
- Comprá en **una sola** ventana: todas usan la misma cuenta.

Con 9 ventanas (3 × 3) la página se lee bien. Cada ventana es un Chrome entero: si cargan lento,
abriste demasiadas.

### Panel local de filas

Al abrir las ventanas con el launcher también se inicia un panel local en
`http://127.0.0.1:8765/`. Cada segundo muestra los últimos datos recibidos y
reordena las filas por espera estimada; en empate, por personas delante y
orden de llegada de los datos. No necesita esperar a todas las ventanas.
Si una baja de «más de una hora» a 15 minutos, su valor y posición cambian.
Las estimaciones precisas se muestran antes que cotas como «más de una hora»;
si todas muestran esa cota, no puede distinguir cuál entrará primero.

Los datos proceden del texto visible de Queue-it, sin peticiones adicionales
al sitio. La actualización cada segundo del panel no acelera el refresh propio
de Queue-it. Las ventanas que dejan de informar por 15 segundos salen del panel;
una ventana oculta o minimizada puede desaparecer si Chrome limita sus timers.
El panel no cierra ni selecciona ventanas automáticamente.
«Enfocar ventana» restaura y pide primer plano para la ventana elegida. En
Windows comprueba el foco real y avisa si no pudo obtenerlo.

Para omitir el panel, agregá `--no-dashboard`:

```powershell
python launcher/launch.py -n 10 --no-dashboard
```

Este flag no cambia el uso de una cuenta, ni detiene un servidor ya iniciado.
Los datos se mantienen en la computadora local. Para actualizar un panel ya
abierto hay que reiniciar solo su servidor y recargar su pestaña; no recargar
las ventanas que están en la fila. Reiniciar el servidor reinicia los datos del
panel, que volverán a llegar desde las ventanas.

## Notas

- Los perfiles quedan en `launcher/profiles/` (ignorado por git). Tienen tu login: no los compartas.
- El launcher sirve para cualquier sitio con Queue-it (por ejemplo Deportick): pasale su URL con `-u`, también en `--setup`.
- Probado en macOS con Chrome 154. En Windows se verificaron carga de extensión, enfoque y cierre del launcher; esto no valida reservas nuevas.
- Abrir varios lugares en la fila probablemente va contra los términos de servicio del sitio.

## Problemas comunes

- **La extensión no aparece:** revisá que cargaste la carpeta `extension/` y no la raíz del repo.
- **El bot no hace nada:** tenés que estar logueado y en una página de Boca Socios. Mirá la consola (F12).
- **"Estos perfiles siguen abiertos":** cerrá las ventanas del launcher (en Mac: `Cmd+Q`) y volvé a correrlo.
- **Ventanas deslogueadas:** si Boca Socios no permite varias sesiones a la vez, logueate de nuevo en la ventana que pasó.

## Verificación del launcher y panel

```powershell
python -m unittest discover -s launcher -p "test_*.py"
```

Pruebas stdlib: ranking y datos en vivo, cotas de espera, desempates,
expiración de filas, API local, foco Win32 simulado, pipes y compatibilidad
con `--setup`/`-n` de una cuenta. Chrome se inicia con
`--disable-background-mode` para terminar al cerrar su última ventana.
Las carpetas de perfiles persisten normalmente y no significan que Chrome
siga abierto. Los errores de pipes se informan sin abortar la tanda.

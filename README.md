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
`http://127.0.0.1:8765/`. El panel recibe los datos de cada ventana, ordena las
filas por menor tiempo estimado cuando todas entran a la cola y conserva ese
orden como una captura fija. También permite enfocar la ventana correspondiente.
Antes de completar la captura descarta ventanas que dejan de informar durante
15 segundos; una vez capturado el orden, lo conserva hasta la próxima ejecución.
Los datos se mantienen en la computadora local.

Con el orden capturado, el botón **Cerrar todas menos las 3 primeras** cierra el
resto de las ventanas (cada una se cierra en su próximo reporte al panel). No se
puede deshacer: una ventana cerrada pierde su lugar en la fila.

## Notas

- Los perfiles quedan en `launcher/profiles/` (ignorado por git). Tienen tu login: no los compartas.
- El launcher sirve para cualquier sitio con Queue-it (por ejemplo Deportick): pasale su URL con `-u`, también en `--setup`.
- Probado en macOS con Chrome 154. **En Windows todavía no se probó.**
- Abrir varios lugares en la fila probablemente va contra los términos de servicio del sitio.

## Problemas comunes

- **La extensión no aparece:** revisá que cargaste la carpeta `extension/` y no la raíz del repo.
- **El bot no hace nada:** tenés que estar logueado y en una página de Boca Socios. Mirá la consola (F12).
- **"Estos perfiles siguen abiertos":** cerrá las ventanas del launcher (en Mac: `Cmd+Q`) y volvé a correrlo.
- **Ventanas deslogueadas:** si Boca Socios no permite varias sesiones a la vez, logueate de nuevo en la ventana que pasó.

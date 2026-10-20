---
name: probar-y-publicar
description: Comprueba un cambio del Planificador Radiante en el navegador (pruebas automáticas de tests/run.js, prueba manual de lo tocado, capturas antes/después) y, si todo está bien, lo publica en main para GitHub Pages. Úsala al terminar cualquier cambio en index.html, antes de dar el trabajo por hecho.
---

# Probar y publicar

El dueño quiere los cambios publicados al momento, pero **solo si funcionan**. Sigue estos pasos en orden; si uno falla, arregla y vuelve a empezar desde el paso 2. No publiques nunca algo que no hayas podido comprobar: explica qué falta.

## 1. Antes de tocar nada (si el cambio es visual)

Saca capturas del estado actual para poder comparar:

```bash
node tests/run.js --shots <scratchpad>/antes
```

Guarda `plano-general.png` (vista completa) y `plano-zoom.png` (zoom ×4) del ejemplo de techo con la tubería visible. Si el cambio afecta a otra pantalla o a un caso que el ejemplo no tiene (pasos de tubos, estancias en L, suelo radiante…), haz tu propia captura con Playwright de ese caso concreto.

## 2. Pruebas automáticas

```bash
node tests/run.js
```

Abre la web en Chromium con una copia de `index.html` que expone el estado interno (`window.__dbg`) y no pide inicio de sesión. Comprueba:

- **Carga:** portada, techo y suelo (con el ejemplo) sin errores de JavaScript.
- **Ejemplo de techo:** paneles, circuitos, salidas y PEX por estancia iguales a `tests/baseline.json`.
- **Uniones y tubos:** en 240 estancias de prueba (rectangulares y en L, tamaños al azar con semilla fija):
  - los extremos de cada unión quedan dentro de sus paneles;
  - no hay uniones en diagonal ni montadas unas sobre otras;
  - los tubos van siempre en ángulo recto.
- **Paso de tubos:**
  - solo lo usa su estancia;
  - se cruza en recto;
  - los tubos de las demás estancias no se desvían.
- **Deshacer y rehacer:** funcionan con los botones y con Ctrl+Z / Ctrl+Y.
- **Tutorial:** se recorre entero en techo y suelo; cada paso con acción tiene su animación (vídeo en `tutorial/`) y se reproduce.
- **Material de control:** cabezales, termostatos y centralita aparecen en techo y suelo con la cantidad a mano, y el importe se calcula bien.

Si falla:
- **Una cifra del ejemplo que cambia a propósito** (has cambiado el cálculo): revisa que el cambio tiene sentido, ejecuta `node tests/run.js --update` y **díselo al usuario** con la tabla de antes y después.
- **Cualquier otra cosa:** es un fallo. Arréglalo; no cambies la prueba para que pase.
- **«index.html ha cambiado: actualiza INIT o AUTH»:** se ha movido la línea de arranque o la de `AUTH_HOSTS`. Ajusta las constantes al principio de `tests/run.js`.

Cuando añadas una función nueva o arregles un fallo, **añade su comprobación a `tests/run.js`** y verifica que falla con la versión anterior (`git show <commit>:index.html > index.html`, ejecuta, y después restaura el archivo).

Si el cambio altera el aspecto de algo que sale en las animaciones del tutorial, vuelve a grabarlas (`node tutorial/grabar.js <paso>`, o sin argumentos todas; tarda unos minutos) y mira algunos fotogramas antes de publicar.

## 3. Prueba manual de lo que has tocado

Las pruebas automáticas no lo cubren todo. Prueba en el navegador lo que has cambiado, en techo y suelo si afecta a los dos:

- Para usar la web sin cuenta, sírvela (`python3 -m http.server 8000 --bind 0.0.0.0` en segundo plano) y ábrela con la IP de la máquina (`hostname -I`), no con `localhost`.
- Para leer datos internos, usa la misma copia con `window.__dbg` que prepara `tests/run.js`.
- Si es visual, saca las capturas de después y míralas tú antes de enseñarlas.
- Si cambia el material, el PDF o el cálculo, mira las tablas.

El entorno tiene acceso completo a internet, así que jsPDF, pdf.js y Supabase cargan desde sus CDN y `tests/run.js` genera el informe PDF. Si el cambio toca el informe, ábrelo y míralo tú (el Read de PDF muestra las páginas). Si alguna vez el CDN no responde (las pruebas avisan «sin acceso a internet»), dile al usuario qué no has podido comprobar.

## 4. Publicar

```bash
git add <archivos> && git commit -m "<mensaje en español: qué cambia para el usuario>"
git push -u origin <rama de trabajo>
git fetch origin main && git checkout main && git merge --ff-only origin/main
git merge <rama de trabajo>     # si no es fast-forward y hay conflictos: resuélvelos solo si no se pierde nada; si dudas, pregunta
node tests/run.js               # otra vez, sobre el resultado de la fusión, si main traía cambios nuevos
git push origin main
git checkout <rama de trabajo>
```

Después comprueba el despliegue «pages build and deployment» con `mcp__github__actions_list` (`list_workflow_runs`). Suele tardar un minuto. Si falla, investígalo.

## 5. Contárselo al usuario

En español y sin jerga:
- qué ha cambiado y por qué pasaba;
- qué has comprobado, en concreto y con cifras;
- qué no has podido comprobar (por ejemplo, el PDF);
- capturas de antes y después si es visual.

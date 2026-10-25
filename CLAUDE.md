# Planificador Radiante

Web y herramienta para planificar instalaciones de **techo radiante** (paneles) y **suelo radiante** (tubo sobre plancha de tetones): se dibujan las estancias de cada planta y la herramienta calcula paneles o circuitos, colectores, tubería PEX, estructura de pladur, cálculo térmico, lista de materiales con precios e informe PDF. Público: instaladores y empresas de climatización en España. Toda la interfaz, los textos y los mensajes de commit están en **español**.

## Estructura

- `index.html`: **todo el producto en un solo archivo** (unas 5000 líneas), sin build ni dependencias locales. Se publica con GitHub Pages.
- `tests/run.js` + `tests/baseline.json`: pruebas automáticas en Chromium (ver «Probar»).
- `tutorial/`: animaciones del tutorial (`techo-<paso>.mp4/.webm`, `suelo-<paso>.mp4/.webm`) grabadas con la herramienta de verdad por `tutorial/grabar.js` (Playwright + ffmpeg). Cada paso del tutorial que pide hacer algo lleva `anim:"<paso>"` en `tourPlan`; los solo informativos, no.
- `.claude/skills/probar-y-publicar/`: el procedimiento para comprobar y publicar cada cambio.
- `README.md`: descripción breve.

Librerías por CDN (en `<head>`): jsPDF + jspdf-autotable (PDF) y supabase-js v2 (cuentas). Fuente: Archivo en todo (web, app y textos del plano), con su eje de anchura: titulares en ancho expandido y cifras tabulares.

Dentro de `index.html`:
1. `<style>`: paleta como variables en `:root` (tema claro único por ahora; el modo oscuro vendrá más adelante). Estilo de hoja de proyecto en web y app: marcos de tinta, hojas sin redondeo ni sombra, etiquetas en minúscula normal (nada de mayúsculas espaciadas), botones de tinta y colores de ida/retorno solo donde significan algo. El bloque final del estilo de la app («planner on the project-sheet look») sobrescribe las reglas base. `body.mode-suelo` y las clases `.only-techo` / `.only-suelo` muestran u ocultan elementos según el sistema.
2. HTML de las vistas, que se alternan con `hidden` desde `showView()`:
   - `#siteView`: web comercial (portada con plano de ejemplo, funciones, cómo funciona, precios, preguntas).
   - `#pricingView`: página de precios y planes.
   - `#authView`: acceso (Google o correo/contraseña).
   - `#chooseView`: elección de sistema (techo o suelo).
   - `#appView`: el planificador (plano SVG, tarjetas de configuración, detalle de estancia, tablas, modales de empresa, forma de estancia, proyectos y finalizar).
   - Navegación: atributos `data-go="site|pricing|choose|app-techo|app-suelo"`; los hashes `#planificador` y `#suelo` abren la app directamente.
3. Un único `<script>` en una IIFE con `"use strict"`, dividido en secciones con comentarios `// ---------------- nombre ----------------`. En orden:
   - **geometry**: vectores `V/add/sub/...`, polígonos, lados curvos (`bulge`), `toW`/`toL` (coordenadas locales de la estancia ↔ mundo con `tx/ty/rot`).
   - **state**: objeto global `S` (catálogo de paneles, reglas, `floors[]` con `rooms[]` y `collectors[]`, `fi` = planta actual, `mode` = `"techo"|"suelo"`, `uf` = reglas de suelo, `th` = parámetros térmicos). `S.rooms` y `S.collectors` son getters de la planta actual. `S.store` guarda el proyecto del otro modo al cambiar con `setMode()`.
   - **panel brands** (techo): `BRANDS` con los datos de la ficha de cada fabricante (Sunthalpy sunthaldress, Uponor Renovis, Zehnder NIC, Giacomini GKC Classic y Super Classic; datos de las fichas oficiales, con su fuente en `src`): modelos, paneles máximos en serie por modelo (`seriesOf`; Sunthalpy limitado a 2 aunque la ficha permita 3 del A; los sistemas en paralelo se planifican con un panel por circuito), caudal fijo (`flow`) o por panel (`fl`, `circFlow`), pérdida de carga por panel, caudal de diseño por circuito, emisión como curva W/m²K frente a la diferencia agua–sala (`kc`) o `K·ΔT^n` (`brandK`/`brandQ`/`brandDH`), temperatura máxima según el acabado (`S.finish`, `brandTmax`). `S.brand`, `S.finish` y `S.panels` (modelos de la marca con `on`) van en el proyecto; `brandFix` pasa los proyectos antiguos a la marca. Tarjeta «Marca de los paneles» (`renderBrand`, `setBrand`). Para añadir otra marca basta con otra entrada en `BRANDS`.
   - **placement**: estancias pegadas por un lado a otra.
   - **panel layout engine** (techo): `gridLayout`, `calcRoom`: reparto de paneles por estancia, franjas de luz, obstáculos, puntos de luz a medida; los circuitos son tramos de paneles seguidos en serie, tan largos como permita la marca (menos circuitos primero y luego uniones más cortas; `joinRun` une 3 o más).
   - **pladur ceiling structure**: perfiles TC primarios/secundarios, cuelgues, angular, placas.
   - **computation over all floors**: `computeAll()` → `results[roomId]`; salidas del colector (dos circuitos de una estancia en una salida con te; con Sunthalpy, `brand().te`: PEX 16 en los 7 primeros metros desde el colector (que va en un registro del techo: no hay subida) y el resto en 20 con manguito reducido, y un colector con tes es como máximo de 6 salidas: `computeFloor` prueba cada colector con y sin tes y, si con tes no le caben todos sus circuitos, va con una salida por circuito, `c._te`), paso de tubos (`r.via`: un agujero en un muro, sin dirección; el muro es el lado recto donde se marca unido al lado de la estancia de detrás del agujero, aunque dé a varias estancias; en `pipeField` cruzar ese muro por otro sitio cuesta 80, así que todo tubo que lo cruce, en cualquier sentido y venga de la estancia que venga, pasa por el agujero, y a los demás no les afecta; da igual desde qué estancia se marque; en `pipeLayout` los tubos que lo cruzan se colocan centrados, carril a carril, y el hueco se dibuja de 0,44 m o más ancho si pasan más tubos, `HOLE_W`, con 10 cm de margen a cada lado), `computeFloor`.
   - **piping sketch**: trazado de tubos de techo (rejilla dentro de la casa, carriles, ida continua / retorno discontinuo).
   - **suelo radiante** (`uf*`): ráster de la planta, zonas (interior / franja de ventana / muro exterior), puertas, escaleras, `ufPlan` (árbol desde colectores, asignación de estancias a colectores, cintas de circuitos), `computeFloorUF`, dibujo.
   - **obstacles**: rectángulos que se tocan forman una figura (`obstGroups`, `obstUnion`).
   - **plan rendering** (`planSvg`, `renderPlan`), **room detail** (`renderDetailSvg`, `buildEditor`), **tables & report** (`renderTables`, `reportRows`, costes).
   - **company profile** (datos de empresa y logo), **PDF** (`buildPdf`, `planPng`).
   - **shape editor**: modal para dibujar una estancia nueva (forma → curvas → medidas → pegar).
   - **floors**, **catalog & collectors**, **plan interactions** (arrastrar, marcar ventana/muro exterior/escalera/acceso, puertas, paso de tubos, obstáculos, zoom).
   - **background plan** (`fl.bg`, `BGC`, `bgTool`, `traceSnap`): por planta, un PDF (pdf.js desde cdnjs, se carga al usarlo) o una imagen de fondo; se calibra con una medida real y se calcan las estancias por el centro de las paredes (se ajustan a 90° y a esquinas/paredes existentes). Solo se usan las estancias calcadas: lo demás del plano (muebles, textos, m²) se queda en la imagen. La imagen va en el proyecto como JPEG (~350 KB) y no se copia en cada paso de deshacer (`projSnapshot(true)`). No sale en el PDF. En la misma barra, «Marcar borde curvo» (`curveFit`, `curveSet`): se elige una pared y se dibuja a mano alzada; se ajusta por mínimos cuadrados la curva del mismo tipo que los lados curvos del editor (arco cuadrático, `bulge {u,v}`) y se aplica también a la estancia vecina que comparte esa pared.
   - **thermal calculation**: pérdidas por estancia (zonas climáticas CTE, U de cerramientos, ventilación), impulsión de diseño, emisión UNE-EN 1264, caudales. Está en **beta** (`BETA.th`, se guarda en `localStorage["pr_beta"]`): triángulo amarillo con la nota al pasar el ratón y casilla «Activar»; desactivado se ocultan sus tarjetas (`.beta-off`), la parte térmica de la ficha de la estancia y su sección y nota del PDF. Para marcar otra función como beta, reutiliza el mismo marcado (`.beta`, `data-beta`).
   - **recommended collector position** (suelo): búsqueda asíncrona de la mejor pared (`REC`, `recRun`).
   - **plans**: `TEST_PHASE=true` (todo gratis). Plan "proyecto" oculta las cifras hasta finalizar y luego queda en solo lectura; planes de empresa mensual/trimestral/anual. La simulación de plan va en `localStorage["pr_plan_sim"]`. La ocultación es solo en el cliente.
   - **product site**: `showView`, vista previa de la portada (`heroPreview`: el plano de ejemplo de techo y de suelo con su cajetín, y los recortes del plano de cada función, `data-crop`). Estilo de la web: una hoja de proyecto (marco, cajetín, colores de ida y retorno), sin etiquetas en mayúsculas en píldora, degradados, tarjetas con sombra ni flechas en los botones; sus variables (`--paper`, `--s-ink`…) van en `.site, #chooseView, #authView`.
   - **accounts (Supabase)**: `SUPA_URL`/`SUPA_KEY` (clave publicable, protegida por RLS). El acceso solo se exige en los hosts de `AUTH_HOSTS` (github.io, localhost). Tablas: `proyectos` (id, modo, nombre, datos JSON, actualizado), `empresas` (user_id, datos), `suscripciones` (plan, estado, fin). Guardado automático en la nube con `projSnapshot()`/`projApply()`; `window.__SUPA_MOCK` permite simular Supabase.
   - **guided tutorial**: misiones paso a paso sobre un proyecto de práctica (`tourPlan`, `TOUR`).
   - Bucle principal: `update(rebuild)` = `computeAll` → `renderPlan` → (`buildEditor`) → detalle → tablas → térmico → recomendación → plan.

## Convenciones

- JavaScript ES5 (`var`, `function`, sin módulos, sin frameworks), muy compacto: muchas funciones en una línea. Mantén ese estilo.
- Unidades internas en **metros** (los campos de la interfaz pueden ir en cm o mm y se convierten). Números con `fmt()` en formato `es-ES`; escapa el HTML con `esc()`.
- Comentarios de código en inglés; textos visibles para el usuario en español.
- Las propiedades que empiezan por `_` no se guardan en el proyecto (las filtra `projSnapshot`).
- Cualquier cambio en el modelo de datos debe seguir cargando proyectos guardados antes (`projApply`).
- Cuando cambie una función visible, revisa también el tutorial (`tourPlan`) y la web comercial si la mencionan. Si cambia el aspecto de algo que sale en una animación del tutorial, vuelve a grabarla: `node tutorial/grabar.js <paso>` (sin argumentos, todas). Un paso nuevo que pida una acción necesita su escena en `grabar.js` y su `anim` (la prueba del tutorial falla si falta).

## Probar

`node tests/run.js` ejecuta las pruebas automáticas (carga sin errores, cifras del ejemplo frente a `tests/baseline.json`, uniones entre paneles, tubos en ángulo recto, paso de tubos, deshacer/rehacer, material de control); `--update` acepta nuevas cifras de referencia y `--shots DIR` guarda capturas del plano. Para probar a mano, sirve la carpeta (`python3 -m http.server`) y abre `http://localhost:8000/#planificador` o `#suelo`. En `localhost` y `127.0.0.1` se pide inicio de sesión (están en `AUTH_HOSTS`); para probar sin cuenta abre la página con otro nombre de host (p. ej. la IP de la máquina) o define `window.__SUPA_MOCK`. Chromium/Playwright sirven para comprobar visualmente y capturar pantallas.

## Publicar (por defecto, sin preguntar)

El dueño quiere que los cambios se publiquen al momento. Al terminar cada cambio sigue la skill **probar-y-publicar** (`.claude/skills/probar-y-publicar/SKILL.md`). En resumen:
1. Comprueba que funciona: `node tests/run.js` sin fallos, prueba a mano la función tocada (techo y suelo si afecta a ambos) y haz capturas antes/después si es visual. Si arreglas un fallo o añades una función, añade su comprobación a `tests/run.js`.
2. Haz commit en la rama de trabajo y súbela.
3. Trae `origin/main` y fusiona la rama en `main`. Si hay conflictos, resuélvelos solo cuando no se pierda nada; si no está claro, pregunta antes de publicar.
4. Si todo está bien, sube `main` (`git push origin main`): GitHub Pages publica la web en uno o dos minutos. Comprueba que el despliegue «pages build and deployment» termina bien.
5. Si algo falla o no se ha podido comprobar, no publiques: explica qué pasa.

No hace falta abrir pull requests.

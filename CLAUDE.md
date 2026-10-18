# Planificador Radiante

Web y herramienta para planificar instalaciones de **techo radiante** (paneles) y **suelo radiante** (tubo sobre plancha de tetones): se dibujan las estancias de cada planta y la herramienta calcula paneles o circuitos, colectores, tubería PEX, estructura de pladur, cálculo térmico, lista de materiales con precios e informe PDF. Público: instaladores y empresas de climatización en España. Toda la interfaz, los textos y los mensajes de commit están en **español**.

## Estructura

- `index.html`: **todo el producto en un solo archivo** (unas 5000 líneas), sin build, sin dependencias locales y sin tests. Se publica con GitHub Pages.
- `README.md`: descripción breve.

Librerías por CDN (en `<head>`): jsPDF + jspdf-autotable (PDF) y supabase-js v2 (cuentas). Fuentes: IBM Plex Sans/Mono.

Dentro de `index.html`:
1. `<style>`: paleta como variables en `:root` (tema claro único, a propósito). `body.mode-suelo` y las clases `.only-techo` / `.only-suelo` muestran u ocultan elementos según el sistema.
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
   - **placement**: estancias pegadas por un lado a otra.
   - **panel layout engine** (techo): `gridLayout`, `calcRoom`: reparto de paneles por estancia, franjas de luz, obstáculos, puntos de luz a medida.
   - **pladur ceiling structure**: perfiles TC primarios/secundarios, cuelgues, angular, placas.
   - **computation over all floors**: `computeAll()` → `results[roomId]`; salidas del colector (agrupación con tubo de 20), paso de tubos (`r.via`), `computeFloor`.
   - **piping sketch**: trazado de tubos de techo (rejilla dentro de la casa, carriles, ida continua / retorno discontinuo).
   - **suelo radiante** (`uf*`): ráster de la planta, zonas (interior / franja de ventana / muro exterior), puertas, escaleras, `ufPlan` (árbol desde colectores, asignación de estancias a colectores, cintas de circuitos), `computeFloorUF`, dibujo.
   - **obstacles**: rectángulos que se tocan forman una figura (`obstGroups`, `obstUnion`).
   - **plan rendering** (`planSvg`, `renderPlan`), **room detail** (`renderDetailSvg`, `buildEditor`), **tables & report** (`renderTables`, `reportRows`, costes).
   - **company profile** (datos de empresa y logo), **PDF** (`buildPdf`, `planPng`).
   - **shape editor**: modal para dibujar una estancia nueva (forma → curvas → medidas → pegar).
   - **floors**, **catalog & collectors**, **plan interactions** (arrastrar, marcar ventana/muro exterior/escalera/acceso, puertas, paso de tubos, obstáculos, zoom).
   - **thermal calculation**: pérdidas por estancia (zonas climáticas CTE, U de cerramientos, ventilación), impulsión de diseño, emisión UNE-EN 1264, caudales.
   - **recommended collector position** (suelo): búsqueda asíncrona de la mejor pared (`REC`, `recRun`).
   - **plans**: `TEST_PHASE=true` (todo gratis). Plan "proyecto" oculta las cifras hasta finalizar y luego queda en solo lectura; planes de empresa mensual/trimestral/anual. La simulación de plan va en `localStorage["pr_plan_sim"]`. La ocultación es solo en el cliente.
   - **product site**: `showView`, vista previa de la portada.
   - **accounts (Supabase)**: `SUPA_URL`/`SUPA_KEY` (clave publicable, protegida por RLS). El acceso solo se exige en los hosts de `AUTH_HOSTS` (github.io, localhost). Tablas: `proyectos` (id, modo, nombre, datos JSON, actualizado), `empresas` (user_id, datos), `suscripciones` (plan, estado, fin). Guardado automático en la nube con `projSnapshot()`/`projApply()`; `window.__SUPA_MOCK` permite simular Supabase.
   - **guided tutorial**: misiones paso a paso sobre un proyecto de práctica (`tourPlan`, `TOUR`).
   - Bucle principal: `update(rebuild)` = `computeAll` → `renderPlan` → (`buildEditor`) → detalle → tablas → térmico → recomendación → plan.

## Convenciones

- JavaScript ES5 (`var`, `function`, sin módulos, sin frameworks), muy compacto: muchas funciones en una línea. Mantén ese estilo.
- Unidades internas en **metros** (los campos de la interfaz pueden ir en cm o mm y se convierten). Números con `fmt()` en formato `es-ES`; escapa el HTML con `esc()`.
- Comentarios de código en inglés; textos visibles para el usuario en español.
- Las propiedades que empiezan por `_` no se guardan en el proyecto (las filtra `projSnapshot`).
- Cualquier cambio en el modelo de datos debe seguir cargando proyectos guardados antes (`projApply`).
- Cuando cambie una función visible, revisa también el tutorial (`tourPlan`) y la web comercial si la mencionan.

## Probar

No hay build ni tests. Sirve la carpeta (`python3 -m http.server`) y abre `http://localhost:8000/#planificador` o `#suelo`. En `localhost` y `127.0.0.1` se pide inicio de sesión (están en `AUTH_HOSTS`); para probar sin cuenta abre la página con otro nombre de host (p. ej. la IP de la máquina) o define `window.__SUPA_MOCK`. Chromium/Playwright sirven para comprobar visualmente y capturar pantallas.

## Publicar (por defecto, sin preguntar)

El dueño quiere que los cambios se publiquen al momento. Al terminar cada cambio:
1. Comprueba que funciona: abre la página en Chromium/Playwright, prueba la función tocada (techo y suelo si afecta a ambos), mira que no haya errores de JavaScript en consola y haz capturas antes/después si es visual.
2. Haz commit en la rama de trabajo y súbela.
3. Trae `origin/main` y fusiona la rama en `main`. Si hay conflictos, resuélvelos solo cuando no se pierda nada; si no está claro, pregunta antes de publicar.
4. Si todo está bien, sube `main` (`git push origin main`): GitHub Pages publica la web en uno o dos minutos. Comprueba que el despliegue «pages build and deployment» termina bien.
5. Si algo falla o no se ha podido comprobar, no publiques: explica qué pasa.

No hace falta abrir pull requests.

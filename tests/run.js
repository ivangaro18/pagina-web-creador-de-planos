#!/usr/bin/env node
// Comprobaciones automáticas del planificador (techo y suelo) en un navegador real.
//
//   node tests/run.js              todas las pruebas
//   node tests/run.js --update     acepta las cifras actuales del ejemplo como nuevas de referencia (tests/baseline.json)
//   node tests/run.js --shots DIR  además guarda capturas del plano del ejemplo (general y con zoom) en DIR
//
// Sirve una copia de index.html con dos retoques solo para la prueba: expone el estado interno en window.__dbg
// y no pide inicio de sesión. Necesita Playwright y Chromium (en la nube ya están instalados).
"use strict";
const fs = require("fs"), path = require("path"), http = require("http"), os = require("os");

const ROOT = path.resolve(__dirname, ".."), BASE = path.join(__dirname, "baseline.json");
const args = process.argv.slice(2), UPDATE = args.includes("--update"), SHOTS = args.includes("--shots") ? args[args.indexOf("--shots") + 1] : null;

function loadPlaywright() {
  for (const p of ["playwright", "/opt/node-tools/node_modules/playwright", "@playwright/test"]) { try { return require(p); } catch (e) {} }
  console.error("No encuentro Playwright. Instálalo con «npm i -D playwright» o usa la sesión en la nube."); process.exit(2);
}
const { chromium } = loadPlaywright();

// ---- copia de prueba de la página
const INIT = "  renderCatalog(); renderCollectors(); renderFloorBar(); syncProjectInputs(); update(true);";
const AUTH = "var AUTH_HOSTS = /(^|\\.)github\\.io$|^localhost$|^127\\.0\\.0\\.1$/;";
let html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
if (!html.includes(INIT) || !html.includes(AUTH)) { console.error("index.html ha cambiado: actualiza INIT o AUTH en tests/run.js para poder preparar la copia de prueba."); process.exit(2); }
html = html.replace(INIT, "  window.__dbg={S:S,get results(){ return results; },update:update,rectRoom:rectRoom,nid:nid,curFloor:curFloor,toW:toW,V:V,pipeLayout:pipeLayout,viaGeom:viaGeom};\n" + INIT)
           .replace(AUTH, "var AUTH_HOSTS = /^$/;");
const server = http.createServer((q, r) => { if (q.url.split("?")[0].split("#")[0] === "/" ) { r.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); r.end(html); } else { r.writeHead(404); r.end(); } });

// ---- resultados
let fails = 0; const out = [];
function ok(name, cond, detail) { out.push((cond ? "  ✔ " : "  ✘ ") + name + (cond || !detail ? "" : "\n      " + detail)); if (!cond) fails++; }

(async () => {
  await new Promise(res => server.listen(0, "127.0.0.1", res));
  const URL = "http://127.0.0.1:" + server.address().port + "/";
  const exe = fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined;
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const errors = [];
  const open = async (hash, vp) => { const p = await browser.newPage({ viewport: vp || { width: 1400, height: 1000 } }); p.on("pageerror", e => errors.push((hash || "/") + ": " + e.message)); await p.goto(URL + (hash || "")); await p.waitForTimeout(700); return p; };

  // 1. carga sin errores (portada, techo y suelo con el ejemplo)
  out.push("Carga de la página");
  for (const h of ["", "#planificador", "#suelo"]) { const p = await open(h); if (h) { await p.click("#loadExample"); await p.waitForTimeout(1500); } await p.close(); }
  ok("sin errores de JavaScript en portada, techo y suelo", errors.length === 0, errors.join(" | "));

  // 2. cifras del ejemplo de techo frente a la referencia
  out.push("Ejemplo de techo radiante");
  let p = await open("#planificador");
  await p.click("#loadExample"); await p.waitForTimeout(900);
  const ex = await p.evaluate(() => { const D = window.__dbg, o = {}; D.S.rooms.forEach(r => { const x = D.results[r.id]; o[r.name] = { paneles: x.panels.length, circuitos: x.circuits, salidas: (x.outs || []).length, pex: Math.round((x.pex || 0) * 10) / 10 }; }); return o; });
  if (UPDATE || !fs.existsSync(BASE)) { fs.writeFileSync(BASE, JSON.stringify(ex, null, 2) + "\n"); ok("referencia guardada en tests/baseline.json", true); }
  else {
    const base = JSON.parse(fs.readFileSync(BASE, "utf8")), diff = [];
    Object.keys(Object.assign({}, base, ex)).forEach(k => { const a = base[k], b = ex[k];
      if (!a || !b) { diff.push(k + ": " + (a ? "ya no está" : "nueva")); return; }
      ["paneles", "circuitos", "salidas"].forEach(f => { if (a[f] !== b[f]) diff.push(k + " " + f + " " + a[f] + " → " + b[f]); });
      if (Math.abs(a.pex - b.pex) > 0.15) diff.push(k + " PEX " + a.pex + " → " + b.pex + " m"); });
    ok("paneles, circuitos, salidas y PEX iguales a la referencia", diff.length === 0, diff.join("; ") + "  (si el cambio es intencionado: node tests/run.js --update)");
  }
  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    const sp = await p.$("#showPipes"); if (!(await sp.isChecked())) await sp.check(); await p.waitForTimeout(400);
    const el = await p.$("#planWrap"); await el.screenshot({ path: path.join(SHOTS, "plano-general.png") });
    const bb = await el.boundingBox(); await p.mouse.move(bb.x + bb.width * 0.5, bb.y + bb.height * 0.45);
    for (let i = 0; i < 8; i++) { await p.mouse.wheel(0, -100); await p.waitForTimeout(80); }
    await p.waitForTimeout(400); await el.screenshot({ path: path.join(SHOTS, "plano-zoom.png") });
    out.push("  · capturas en " + SHOTS);
  }

  // 3. uniones entre paneles y tubos en estancias de prueba (rectangulares y en L, tamaños al azar con semilla fija)
  out.push("Uniones entre paneles y tubos");
  const geo = await p.evaluate(() => {
    const D = window.__dbg, S = D.S, R = D.rectRoom, V = D.V; let seed = 12345; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const L = (n, x, y) => ({ id: D.nid(), name: n, pts: [V(0,0),V(6,0),V(6,2.5),V(3,2.5),V(3,6),V(0,6)], bulge: [0,0,0,0,0,0], tx: x, ty: y, rot: 0, attach: null, active: true, override: false, minPct: 30, maxPct: 60, lc: "puntos", lp: "ninguna" });
    const bad = { fuera: [], diagonal: [], solape: [], tuboDiagonal: [] }; let nC = 0;
    const inP = (r, pt, q) => { const a = D.toW(r, V(q.x, q.y)), b = D.toW(r, V(q.x + q.w, q.y + q.h)); return pt.x >= Math.min(a.x, b.x) - 1e-6 && pt.x <= Math.max(a.x, b.x) + 1e-6 && pt.y >= Math.min(a.y, b.y) - 1e-6 && pt.y <= Math.max(a.y, b.y) + 1e-6; };
    const check = r => { const res = D.results[r.id]; (res.cs || []).forEach(c => { nC++;
        const ps = res.panels.filter(q => q.circuit === c.i);
        if (!inP(r, c.na, ps[0]) || !inP(r, c.nb, ps[ps.length - 1])) bad.fuera.push(r.name);
        for (let i = 1; i < c.join.length; i++) { const a = c.join[i - 1], e = c.join[i]; if (Math.abs(a.x - e.x) > 1e-6 && Math.abs(a.y - e.y) > 1e-6) bad.diagonal.push(r.name); } });
      const sg = (res.cs || []).filter(c => c.join.length === 2).map(c => c.join), h = s => Math.abs(s[0].y - s[1].y) < 1e-6;
      for (let i = 0; i < sg.length; i++) for (let j = i + 1; j < sg.length; j++) { const A = sg[i], B = sg[j];
        if (h(A) && h(B) && Math.abs(A[0].y - B[0].y) < 1e-3 && Math.min(Math.max(A[0].x, A[1].x), Math.max(B[0].x, B[1].x)) - Math.max(Math.min(A[0].x, A[1].x), Math.min(B[0].x, B[1].x)) > 1e-3) bad.solape.push(r.name); } };
    const tubes = () => D.pipeLayout(D.curFloor()).tubes.forEach(t => { for (let i = 1; i < t.pts.length; i++) if (Math.abs(t.pts[i].x - t.pts[i - 1].x) > 1e-3 && Math.abs(t.pts[i].y - t.pts[i - 1].y) > 1e-3) { bad.tuboDiagonal.push(t.room.name); break; } });
    for (let t = 0; t < 120; t++) { const w = 2 + rnd() * 8, hh = 2 + rnd() * 7;
      S.floors = [{ id: D.nid(), name: "x", rooms: [R("R" + t, 0, 0, w, hh, { lc: ["ninguna", "puntos", "tira"][t % 3], lp: ["ninguna", "puntos"][t % 2] }), L("L" + t, w, 0)], collectors: [{ id: D.nid(), name: "C", x: w, y: 0.3, cap: 16 }] }]; S.fi = 0; D.update(false);
      S.floors[0].rooms.forEach(check); tubes(); }
    const u = a => [...new Set(a)].slice(0, 6).join(", ");
    return { nC, fuera: bad.fuera.length, diagonal: bad.diagonal.length, solape: bad.solape.length, tuboDiagonal: bad.tuboDiagonal.length, ej: { fuera: u(bad.fuera), diagonal: u(bad.diagonal), solape: u(bad.solape), tuboDiagonal: u(bad.tuboDiagonal) } };
  });
  ok("extremos de cada unión dentro de su panel (" + geo.nC + " circuitos)", geo.fuera === 0, "en " + geo.ej.fuera);
  ok("uniones sin diagonales", geo.diagonal === 0, "en " + geo.ej.diagonal);
  ok("uniones que no se montan unas encima de otras", geo.solape === 0, "en " + geo.ej.solape);
  ok("tubos siempre en ángulo recto", geo.tuboDiagonal === 0, "en " + geo.ej.tuboDiagonal);

  // 4. paso de tubos: solo lo usa su estancia, y se cruza en recto
  out.push("Paso de tubos");
  const via = await p.evaluate(() => {
    const D = window.__dbg, S = D.S, R = D.rectRoom;
    const rooms = [R("Salon", 0, 0, 4, 4), R("D", 4, 0, 4, 3), R("Pasillo", 4, 3, 4, 1.2, { lc: "ninguna" }), R("Estancia 3", 0, 4, 4, 2.5), R("C", 4, 4.2, 4, 2.3)];
    S.floors = [{ id: D.nid(), name: "P", rooms, collectors: [{ id: D.nid(), name: "Colector 1", x: 7, y: 3.6, cap: 16 }] }]; S.fi = 0; D.update(true);
    // metres per tube of each room, without and with the passage: the rooms that do not use it should hardly change
    const perTube = () => { const o = {}; D.pipeLayout(D.curFloor()).tubes.forEach(t => { let l = 0; for (let i = 1; i < t.pts.length; i++) l += Math.hypot(t.pts[i].x - t.pts[i - 1].x, t.pts[i].y - t.pts[i - 1].y); const k = t.room.name; o[k] = o[k] || { l: 0, n: 0 }; o[k].l += l; o[k].n++; }); return o; };
    const sin = perTube(); rooms[0].via = { edge: 2, t: 3.5 }; D.update(true); const con = perTube(), largos = [];
    ["D", "C", "Pasillo"].forEach(k => { const d = con[k].l / con[k].n - sin[k].l / sin[k].n; if (d > 1.0) largos.push(k + " +" + d.toFixed(1) + " m por tubo"); });
    const g = D.viaGeom(rooms[0]), ajenos = [], diag = [];
    D.pipeLayout(D.curFloor()).tubes.forEach(t => { let m = 1e9;
      for (let i = 1; i < t.pts.length; i++) { const a = t.pts[i - 1], c = t.pts[i], dx = c.x - a.x, dy = c.y - a.y, l2 = dx * dx + dy * dy || 1; let u = ((g.P.x - a.x) * dx + (g.P.y - a.y) * dy) / l2; u = Math.max(0, Math.min(1, u)); m = Math.min(m, Math.hypot(a.x + u * dx - g.P.x, a.y + u * dy - g.P.y));
        if (Math.abs(dx) > 1e-3 && Math.abs(dy) > 1e-3) diag.push(t.room.name); }
      if (t.room !== rooms[0] && m < 0.5) ajenos.push(t.room.name); });
    return { ajenos: [...new Set(ajenos)], diag: [...new Set(diag)], largos };
  });
  ok("ningún tubo de otra estancia pasa por el paso", via.ajenos.length === 0, "pasan: " + via.ajenos.join(", "));
  ok("sin diagonales al cruzar el paso", via.diag.length === 0, "en " + via.diag.join(", "));
  ok("los tubos de las demás estancias no se desvían (≤ 1 m más por tubo)", via.largos.length === 0, via.largos.join("; "));
  await p.close();

  // 5. deshacer / rehacer y material de control
  out.push("Deshacer, rehacer y material de control");
  p = await open("#planificador");
  await p.click("#loadExample"); await p.waitForTimeout(900);
  const st = () => p.evaluate(() => ({ u: !document.querySelector("#undoBtn").disabled, r: !document.querySelector("#redoBtn").disabled, g: document.querySelector("#gMax").value }));
  const s0 = await st(); ok("al abrir el ejemplo no hay nada que deshacer", !s0.u && !s0.r);
  await p.fill("#gMax", "40"); await p.dispatchEvent("#gMax", "change"); await p.waitForTimeout(700);
  ok("un cambio activa «Deshacer»", (await st()).u);
  await p.click("#undoBtn"); await p.waitForTimeout(400); const s1 = await st();
  ok("deshacer vuelve al valor anterior y activa «Rehacer»", s1.g === "60" && s1.r, JSON.stringify(s1));
  await p.click("body", { position: { x: 5, y: 5 } }); await p.keyboard.press("Control+y"); await p.waitForTimeout(400);
  ok("Ctrl+Y rehace", (await st()).g === "40");
  await p.keyboard.press("Control+z"); await p.waitForTimeout(400);
  ok("Ctrl+Z deshace", (await st()).g === "60");
  const ctl = await p.evaluate(() => ["ctl_cab", "ctl_term", "ctl_cent"].map(k => !!document.querySelector('[data-qty="' + k + '"]')));
  ok("cabezales, termostatos y centralita en el material de techo, con cantidad a mano", ctl.every(Boolean));
  await p.fill('[data-qty="ctl_cab"]', "6"); await p.fill('[data-key="ctl_cab"]', "25"); await p.waitForTimeout(300);
  const imp = await p.evaluate(() => document.querySelector("#imp_ctl_cab").textContent.replace(/\s/g, ""));
  ok("importe = cantidad × precio (6 × 25 € = 150 €)", /^150,00€$/.test(imp), imp);
  await p.close();
  p = await open("#suelo"); await p.click("#loadExample"); await p.waitForTimeout(1500);
  ok("y también en el material de suelo", await p.evaluate(() => !!document.querySelector('[data-qty="ctl_cab"]')));
  await p.close();

  ok("sin errores de JavaScript durante las pruebas", errors.length === 0, errors.join(" | "));
  await browser.close(); server.close();
  console.log(out.join("\n"));
  console.log(fails ? "\n" + fails + " comprobación(es) fallida(s)." : "\nTodo correcto.");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(2); });

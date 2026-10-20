#!/usr/bin/env node
// Comprobaciones automáticas del planificador (techo y suelo) en un navegador real.
// (La importación de PDF usa pdf.js desde un CDN; aquí se prueba con una imagen, que sigue el mismo camino después.)
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

  // 4. paso de tubos: un agujero en una pared, sin dirección. Un tubo que no cruza esa pared no pasa por él
  out.push("Paso de tubos");
  const via = await p.evaluate(() => {
    const D = window.__dbg, S = D.S, R = D.rectRoom;
    const rooms = [R("Salon", 0, 0, 4, 4), R("D", 4, 0, 4, 3), R("Pasillo", 4, 3, 4, 1, { lc: "ninguna" }), R("Estancia 3", 0, 4, 4, 2.5), R("C", 4, 4, 4, 2.5)];
    S.floors = [{ id: D.nid(), name: "P", rooms, collectors: [{ id: D.nid(), name: "Colector 1", x: 7, y: 3.5, cap: 16 }] }]; S.fi = 0; D.update(true);
    // metres per tube of each room, without and with the passage: the rooms that do not use it should hardly change
    const perTube = () => { const o = {}; D.pipeLayout(D.curFloor()).tubes.forEach(t => { let l = 0; for (let i = 1; i < t.pts.length; i++) l += Math.hypot(t.pts[i].x - t.pts[i - 1].x, t.pts[i].y - t.pts[i - 1].y); const k = t.room.name; o[k] = o[k] || { l: 0, n: 0 }; o[k].l += l; o[k].n++; }); return o; };
    const sin = perTube(); rooms[0].via = { edge: 2, t: 3.5 }; D.update(true); const con = perTube(), largos = [];
    ["D", "C", "Pasillo"].forEach(k => { const d = con[k].l / con[k].n - sin[k].l / sin[k].n; if (d > 1.0) largos.push(k + " +" + d.toFixed(1) + " m por tubo"); });
    const g = D.viaGeom(rooms[0]), ajenos = [], diag = [];
    D.pipeLayout(D.curFloor()).tubes.forEach(t => { let m = 1e9;
      for (let i = 1; i < t.pts.length; i++) { const a = t.pts[i - 1], c = t.pts[i], dx = c.x - a.x, dy = c.y - a.y, l2 = dx * dx + dy * dy || 1; let u = ((g.P.x - a.x) * dx + (g.P.y - a.y) * dy) / l2; u = Math.max(0, Math.min(1, u)); m = Math.min(m, Math.hypot(a.x + u * dx - g.P.x, a.y + u * dy - g.P.y));
        if (Math.abs(dx) > 1e-3 && Math.abs(dy) > 1e-3) diag.push(t.room.name); }
      // crossing the wall between Salon and Estancia 3 (y = 4, 0 < x < 4) anywhere but at the hole (x = 0,5)
      for (let i = 1; i < t.pts.length; i++) { const a = t.pts[i - 1], c = t.pts[i]; if ((a.y - 4) * (c.y - 4) < 0 && a.x > 0 && a.x < 4 && Math.abs(a.x - 0.5) > 0.35) ajenos.push(t.room.name); } });
    return { ajenos: [...new Set(ajenos)], diag: [...new Set(diag)], largos };
  });
  ok("ningún tubo cruza la pared del paso fuera del agujero", via.ajenos.length === 0, "cruzan fuera: " + [...new Set(via.ajenos)].join(", "));
  ok("sin diagonales al cruzar el paso", via.diag.length === 0, "en " + via.diag.join(", "));
  ok("los tubos de las demás estancias no se desvían (≤ 1 m más por tubo)", via.largos.length === 0, via.largos.join("; "));
  // the tubes that do cross that wall go through the hole, whichever side it was marked from; the others are not touched
  const via2 = await p.evaluate(() => {
    const D = window.__dbg, S = D.S, R = D.rectRoom, run = (owner) => {
      const A = R("A", 0, 0, 4, 3), B = R("B", 4, 0, 4, 3), Pa = R("Pasillo", 0, 3, 4, 1, { lc: "ninguna" });
      if (owner === "A") A.via = { edge: 1, t: 0.4 }; else B.via = { edge: 3, t: 2.6 };
      S.floors = [{ id: D.nid(), name: "P", rooms: [A, B, Pa], collectors: [{ id: D.nid(), name: "C1", x: 1, y: 3.5, cap: 16 }] }]; S.fi = 0; D.update(true);
      const hole = { x: 4, y: 0.4 }, d = t => { let m = 1e9; for (let i = 1; i < t.pts.length; i++) { const a = t.pts[i - 1], c = t.pts[i], dx = c.x - a.x, dy = c.y - a.y, l2 = dx * dx + dy * dy || 1; let u = ((hole.x - a.x) * dx + (hole.y - a.y) * dy) / l2; u = Math.max(0, Math.min(1, u)); m = Math.min(m, Math.hypot(a.x + u * dx - hole.x, a.y + u * dy - hole.y)); } return m; };
      const T = D.pipeLayout(D.curFloor()).tubes;
      // where each tube of B crosses x = 4 (the wall between A and B)
      const cross = T.filter(t => t.room.name === "B").map(t => { for (let i = 1; i < t.pts.length; i++) { const a = t.pts[i - 1], c = t.pts[i]; if ((a.x - 4) * (c.x - 4) < 0 || (Math.abs(a.x - 4) < 1e-6 && Math.abs(c.x - 4) > 1e-6)) return +(a.y).toFixed(2); } return null; });
      return { cross, aNear: T.filter(t => t.room.name === "A").some(t => d(t) < 0.3), sig: JSON.stringify(T.map(t => t.pts.map(q => [+q.x.toFixed(2), +q.y.toFixed(2)]))) }; };
    const a = run("A"), b = run("B"); return { a, b, same: a.sig === b.sig };
  });
  ok("los tubos que cruzan esa pared lo hacen por el agujero", via2.a.cross.length > 0 && via2.a.cross.every(y => y != null && Math.abs(y - 0.4) < 0.35), JSON.stringify(via2.a.cross));
  ok("a los tubos que no cruzan esa pared no les afecta (la estancia del paso no se ve obligada a entrar por él)", !via2.a.aNear && !via2.b.aNear);
  ok("da igual desde qué estancia se marque el paso: mismo trazado", via2.same);
  // a hole on a wall that faces two rooms (Estancia 10 and the small room with the collector): the tubes crossing ANY stretch of
  // that wall go through the hole, also those coming from the room that is not the one behind the hole
  const via3 = await p.evaluate(() => {
    const D = window.__dbg, S = D.S, R = D.rectRoom, run = (side) => {
      const E7 = R("Estancia 7", 0, 0, 8.5, 4.2), E10 = R("Estancia 10", 1.9, 4.2, 4.7, 3), Sm = R("Cuarto", 6.6, 4.2, 1.6, 2.5, { lc: "ninguna" });
      if (side === "E7") E7.via = { edge: 2, t: 3.2 }; else E10.via = { edge: 0, t: 3.4 };
      S.floors = [{ id: D.nid(), name: "P", rooms: [E7, E10, Sm], collectors: [{ id: D.nid(), name: "C2", x: 7.6, y: 5.0, cap: 12 }] }]; S.fi = 0; D.update(true);
      const bad = [];
      D.pipeLayout(D.curFloor()).tubes.forEach(t => { for (let i = 1; i < t.pts.length; i++) { const a = t.pts[i - 1], c = t.pts[i]; if ((a.y - 4.2) * (c.y - 4.2) < 0 && Math.abs(a.x - 5.3) > 0.6) bad.push(t.room.name + "@" + a.x.toFixed(2)); } });
      return bad; };
    return { e7: run("E7"), e10: run("E10") };
  });
  ok("agujero en un muro que da a varias estancias: todo tubo que lo cruza pasa por el agujero (marcado desde un lado)", !via3.e7.length, via3.e7.join(", "));
  ok("  y marcado desde el otro lado", !via3.e10.length, via3.e10.join(", "));
  // through the hole the tubes go centred, side by side, and the hole is as wide as they need (minimum 0,44 m), same margin both sides
  const via4 = await p.evaluate(() => {
    const D = window.__dbg, S = D.S, R = D.rectRoom, out = {};
    for (const [name, cap] of [["muchos", 12], ["pocos", 2]]) {
      const E7 = R("Estancia 7", 0, 0, 8.5, 4.2), E10 = R("Estancia 10", 1.9, 4.2, 4.7, 3), Sm = R("Cuarto", 6.6, 4.2, 1.6, 2.5, { lc: "ninguna" }); E7.via = { edge: 2, t: 3.2 };
      if (name === "pocos") { E7.pts = [D.V(0, 0), D.V(3, 0), D.V(3, 2), D.V(0, 2)].map(q => D.V(q.x + 4.6, q.y + 2.2)); E7.pts = [D.V(0, 0), D.V(1.6, 0), D.V(1.6, 2), D.V(0, 2)]; E7.tx = 4.5; E7.ty = 2.2; E7.via = { edge: 2, t: 0.8 }; }
      S.floors = [{ id: D.nid(), name: "P", rooms: [E7, E10, Sm], collectors: [{ id: D.nid(), name: "C", x: 7.6, y: 5.0, cap }] }]; S.fi = 0; S.showPipes = true; D.update(true);
      const P = 5.3, xs = []; D.pipeLayout(D.curFloor()).tubes.forEach(t => { for (let i = 1; i < t.pts.length; i++) { const a = t.pts[i - 1], c = t.pts[i]; if ((a.y - 4.2) * (c.y - 4.2) < 0 && Math.abs(a.x - P) < 0.8) xs.push(a.x); } });
      xs.sort((a, b) => a - b); const j = [...document.querySelectorAll("#planWrap .p-via-j")].map(l => +l.getAttribute("x1")).sort((a, b) => a - b);
      out[name] = { n: xs.length, mid: (xs[0] + xs[xs.length - 1]) / 2, w: j[1] - j[0], mL: xs[0] - j[0], mR: j[1] - xs[xs.length - 1] }; }
    return out; });
  const vm = via4.muchos, vp = via4.pocos;
  ok("los tubos cruzan el agujero centrados (" + vm.n + " tubos)", vm.n > 2 && Math.abs(vm.mid - 5.3) < 0.02, JSON.stringify(vm));
  ok("el hueco se ensancha con muchos tubos y deja el mismo margen a cada lado", vm.w > 0.44 + 1e-6 && Math.abs(vm.mL - vm.mR) < 0.01, JSON.stringify(vm));
  ok("con pocos tubos el hueco tiene el tamaño mínimo (0,44 m) y van centrados", vp.n > 0 && Math.abs(vp.w - 0.44) < 0.005 && Math.abs(vp.mL - vp.mR) < 0.01, JSON.stringify(vp));
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

  // 5b. informe PDF (necesita jsPDF desde el CDN: si no hay acceso a internet, se avisa y se salta)
  p = await browser.newPage({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true }); p.on("pageerror", e => errors.push("informe: " + e.message));
  await p.goto(URL + "#planificador"); await p.waitForTimeout(1500);
  if (await p.evaluate(() => !!(window.jspdf && window.jspdf.jsPDF))) {
    await p.click("#loadExample"); await p.waitForTimeout(900);
    await p.fill('[data-qty="ctl_cab"]', "6"); await p.fill('[data-key="ctl_cab"]', "25"); await p.waitForTimeout(300);
    const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 30000 }), p.click("#downloadReport")]);
    const f = path.join(os.tmpdir(), "informe-prueba.pdf"); await dl.saveAs(f); const kb = Math.round(fs.statSync(f).size / 1024), txt = fs.readFileSync(f, "latin1");
    ok("el informe PDF se genera y pesa menos de 2 MB (" + kb + " KB)", kb > 20 && kb < 2048, kb + " KB");
    ok("en el informe sale el cabezal (6 ud.) y no las filas de control a 0", txt.includes("Cabezal electrot") && !txt.includes("Termostato de zona") && !txt.includes("Centralita de zonas"));
  } else out.push("  · informe PDF sin probar: no se ha podido descargar jsPDF del CDN (sin acceso a internet)");
  await p.close();

  // 6. plano de fondo: importar una imagen, calibrar con una medida y calcar dos estancias que se pegan solas
  out.push("Plano de fondo");
  p = await open("#planificador");
  const png = await p.evaluate(() => { const c = document.createElement("canvas"); c.width = 1000; c.height = 800; const x = c.getContext("2d");
    x.fillStyle = "#fff"; x.fillRect(0, 0, 1000, 800); x.strokeStyle = "#000"; x.lineWidth = 12; x.strokeRect(100, 100, 800, 500); x.beginPath(); x.moveTo(500, 100); x.lineTo(500, 600); x.stroke();
    x.font = "40px sans-serif"; x.fillStyle = "#c00"; x.fillText("Salón 20 m2", 160, 300); return c.toDataURL("image/png").split(",")[1]; });
  await p.setInputFiles("#bgFile", { name: "plano.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") }); await p.waitForTimeout(800);
  const scr = (px, py) => p.evaluate(([px, py]) => { const g = window.__dbg.curFloor().bg, svg = document.querySelector("#planWrap svg"), q = new DOMPoint(g.x + px * g.s, g.y + py * g.s).matrixTransform(svg.getScreenCTM()); return [q.x, q.y]; }, [px, py]);
  const clk = async (px, py) => { const [x, y] = await scr(px, py); await p.mouse.move(x, y); await p.waitForTimeout(40); await p.mouse.click(x, y); await p.waitForTimeout(100); };
  const g0 = await p.evaluate(() => { const g = window.__dbg.curFloor().bg; return g && { tool: window.__dbg.S.bgTool, cal: g.cal, img: !!document.querySelector("#planWrap image") }; });
  ok("la imagen se importa como fondo y se abre «Calibrar escala»", !!g0 && g0.img && g0.tool === "cal" && !g0.cal, JSON.stringify(g0));
  await clk(100, 100); await clk(500, 104); await p.fill("#bgCalLen", "4,00"); await p.press("#bgCalLen", "Enter"); await p.waitForTimeout(400);
  const g1 = await p.evaluate(() => { const g = window.__dbg.curFloor().bg; return { s: g.s, cal: g.cal, tool: window.__dbg.S.bgTool }; });
  ok("calibrar: 400 px = 4,00 m (con coma) deja 1 cm por píxel (±1 %) y pasa a «Calcar»", g1.cal && Math.abs(g1.s - 0.01) < 1e-4 && g1.tool === "trace", JSON.stringify(g1));
  for (const c of [[100, 100], [500, 100], [500, 600], [100, 600], [100, 100]]) await clk(c[0], c[1]);
  await p.waitForTimeout(300);
  // the second room: clicks a few pixels off the first room's corners, they snap onto them
  for (const c of [[504, 97], [900, 100], [900, 600], [497, 603], [504, 97]]) await clk(c[0], c[1]);
  await p.waitForTimeout(400);
  const rs = await p.evaluate(() => { const D = window.__dbg; return D.S.rooms.map(r => { const w = r.pts.map(q => D.toW(r, q)), xs = w.map(q => q.x), ys = w.map(q => q.y); return { n: r.pts.length, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), area: D.results[r.id].area, paneles: D.results[r.id].panels.length }; }); });
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  ok("dos estancias rectangulares de 4,00 × 5,00 m", rs.length === 2 && rs.every(r => r.n === 4 && Math.abs(r.x1 - r.x0 - 4) < 0.011 && Math.abs(r.y1 - r.y0 - 5) < 0.011), JSON.stringify(rs));
  ok("la segunda se engancha a las esquinas de la primera (pared compartida exacta)", rs.length === 2 && near(rs[1].x0, rs[0].x1) && near(rs[1].y0, rs[0].y0) && near(rs[1].y1, rs[0].y1), JSON.stringify(rs));
  ok("las estancias calcadas llevan paneles", rs.length === 2 && rs.every(r => r.paneles > 0));
  await p.keyboard.press("Escape"); await p.waitForTimeout(500);
  await p.click("#undoBtn"); await p.waitForTimeout(400);
  const u1 = await p.evaluate(() => ({ n: window.__dbg.S.rooms.length, img: !!document.querySelector("#planWrap image") }));
  ok("deshacer quita la última estancia y deja el plano de fondo", u1.n === 1 && u1.img, JSON.stringify(u1));
  await p.click("#bgShow"); await p.waitForTimeout(300);
  ok("«Ocultar» quita el fondo del plano", await p.evaluate(() => !document.querySelector("#planWrap image")));
  await p.close();

  // 7. borde curvo: se elige una pared y se dibuja a mano alzada; queda una curva lisa, también en la estancia vecina
  out.push("Borde curvo");
  p = await open("#planificador");
  await p.evaluate(() => { const D = window.__dbg, S = D.S; S.floors = [{ id: D.nid(), name: "P", rooms: [D.rectRoom("Salón", 0, 0, 4, 3), D.rectRoom("Cocina", 0, 3, 4, 3)], collectors: [] }]; S.fi = 0; D.update(true); });
  const w2s = (x, y) => p.evaluate(([x, y]) => { const svg = document.querySelector("#planWrap svg"), q = new DOMPoint(x, y).matrixTransform(svg.getScreenCTM()); return [q.x, q.y]; }, [x, y]);
  await p.click('#bgBar [data-bg="curve"]'); await p.waitForTimeout(200);
  let [cx, cy] = await w2s(2, 3.02); await p.mouse.move(cx, cy); await p.waitForTimeout(80); await p.mouse.click(cx, cy); await p.waitForTimeout(200);
  ok("al pinchar la pared se pasa a dibujar la curva", await p.evaluate(() => window.__dbg.S.curve.stage === "draw"));
  // a hand-drawn arc from (0,3) to (4,3), 0,5 m deep into the kitchen, with ±3 cm of shake
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.06;
  [cx, cy] = await w2s(0, 3); await p.mouse.move(cx, cy); await p.mouse.down();
  for (let i = 1; i <= 40; i++) { const t = i / 40, x = 4 * t, y = 3 + 4 * 0.5 * t * (1 - t) + (i < 40 ? rnd() : 0); [cx, cy] = await w2s(x, y); await p.mouse.move(cx, cy); }
  await p.mouse.up(); await p.waitForTimeout(500);
  const cv = await p.evaluate(() => { const D = window.__dbg, R = D.S.rooms, sag = (r, e) => { const b = r.bulge[e]; return b ? b.v * 4 : 0; };
    const ie = r => r.pts.findIndex((q, i) => { const a = D.toW(r, q), b = D.toW(r, r.pts[(i + 1) % r.pts.length]); return Math.abs(a.y - 3) < 1e-6 && Math.abs(b.y - 3) < 1e-6; });
    const e0 = ie(R[0]), e1 = ie(R[1]);
    return { s0: sag(R[0], e0), s1: sag(R[1], e1), u0: R[0].bulge[e0] && R[0].bulge[e0].u, a0: D.results[R[0].id].area, a1: D.results[R[1].id].area }; });
  ok("la pared queda curva con la flecha dibujada (0,50 m ± 3 cm) y lisa", Math.abs(Math.abs(cv.s0) - 0.5) < 0.03 && Math.abs(cv.u0) < 0.03, JSON.stringify(cv));
  ok("la estancia vecina recibe la misma curva", Math.abs(cv.s0 + cv.s1) < 1e-6 && Math.abs(cv.s1) > 0.4, JSON.stringify(cv));
  ok("las superficies cambian a la par (lo que gana una lo pierde la otra)", Math.abs(cv.a0 + cv.a1 - 24) < 0.05 && Math.abs(cv.a0 - 12) > 1, JSON.stringify(cv));
  await p.keyboard.press("Escape"); await p.waitForTimeout(500);
  await p.click("#undoBtn"); await p.waitForTimeout(400);
  ok("deshacer deja la pared recta otra vez", await p.evaluate(() => window.__dbg.S.rooms.every(r => r.bulge.every(b => !b))));
  await p.close();

  // 7b. suelo radiante en una vivienda real (reconstruida de un plano de un usuario): una estancia pequeña con el colector en su
  // pared y otra estrecha entre otras deben llevar su circuito, sin el aviso de «ocupada por tubos que pasan» si no pasa ninguno
  out.push("Suelo radiante en una vivienda real");
  for (const e8top of [5.31, 5.42]) {
    p = await open("#suelo");
    const r = await p.evaluate((e8top) => { const D = window.__dbg, S = D.S, V = D.V;
      const P = (name, W) => { const mx = Math.min(...W.map(q => q[0])), my = Math.min(...W.map(q => q[1])); return { id: D.nid(), name, pts: W.map(q => V(+(q[0] - mx).toFixed(3), +(q[1] - my).toFixed(3))), bulge: W.map(() => 0), tx: mx, ty: my, rot: 0, attach: null, active: true, override: false, minPct: 30, maxPct: 60, lc: "puntos", lp: "ninguna" }; };
      const B = (n, x0, y0, x1, y1) => P(n, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
      const E3 = B("Estancia 3", 4.70, 3.13, 7.68, 11.29), E9 = B("Estancia 9", 10.53, 2.55, 11.67, 4.34);
      const rooms = [B("Estancia 1", 0, 3.13, 4.70, 11.29), P("Estancia 2", [[4.07, 0], [8.96, 0], [8.96, 2.38], [7.68, 2.38], [7.68, 3.13], [4.07, 3.13]]), E3, B("Estancia 4", 7.68, 2.38, 10.04, 5.31),
        B("Estancia 5", 7.68, 8.04, 11.96, 11.29), B("Estancia 6", 11.96, 8.04, 13.13, 10.70), P("Estancia 7", [[10.04, 4.34], [13.03, 4.34], [13.03, 6.99], [11.06, 6.99], [11.06, 6.43], [10.04, 6.43]]),
        P("Estancia 8", [[7.68, e8top], [10.04, e8top], [10.04, 6.40], [7.68, 6.33]]), E9];
      S.floors = [{ id: D.nid(), name: "Planta baja", rooms, collectors: [{ id: D.nid(), name: "Colector 1", cap: 12, room: E3.id, edge: 3, off: 7.0 }, { id: D.nid(), name: "Colector 2", cap: 3, room: E9.id, edge: 2, off: 0.85 }] }]; S.fi = 0; D.update(true);
      return rooms.map(q => { const x = D.results[q.id]; return { n: q.name, c: x.circuits, col: x.col ? x.col.name : null, busy: (x.dmsgs || []).some(m => /ocupada por los tubos/.test(m.x)) }; }); }, e8top);
    const sin = r.filter(q => !q.col || !q.c).map(q => q.n), e9 = r.find(q => q.n === "Estancia 9");
    ok("vivienda real (" + (e8top > 5.31 ? "Estancia 8 sin tocar la 4" : "Estancia 8 pegada a la 4") + "): las 9 estancias llevan circuito", !sin.length, "sin circuito: " + sin.join(", "));
    ok("  y la Estancia 9 (colector en su pared) no dice que la ocupen tubos ajenos", !e9.busy && e9.col === "Colector 2", JSON.stringify(e9));
    await p.close();
  }

  // 7c. cálculo térmico en beta: aviso con su nota al pasar el ratón y casilla para activarlo o no (se recuerda en el navegador)
  out.push("Cálculo térmico en beta");
  p = await browser.newPage({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true }); p.on("pageerror", e => errors.push("beta: " + e.message));
  await p.goto(URL + "#planificador"); await p.waitForTimeout(800); await p.click("#loadExample"); await p.waitForTimeout(900);
  const bico = p.locator("#thermCard .beta").first(); await bico.scrollIntoViewIfNeeded(); await bico.hover(); await p.waitForTimeout(150);
  ok("aviso amarillo con la nota de beta al pasar el ratón", await p.evaluate(() => { const t = document.querySelector("#thermCard .beta-tip"); return !!t && getComputedStyle(t).display !== "none" && /beta/i.test(t.textContent) && /informativa/.test(t.textContent); }));
  const vis = () => p.evaluate(() => ({ card: !!document.querySelector("#thGrid,#thZone") && document.querySelector("#thZone").offsetParent !== null, res: document.querySelector("#thBody").offsetParent !== null, ficha: /cálculo térmico/i.test(document.querySelector("#detailCard").innerText) }));
  const on1 = await vis(); ok("activado (por defecto): ajustes, resultados y ficha de la estancia a la vista", on1.card && on1.res && on1.ficha, JSON.stringify(on1));
  await p.locator('#thermCard [data-beta="th"]').uncheck(); await p.waitForTimeout(400);
  const off1 = await vis(); ok("desactivado: se ocultan ajustes, resultados y la parte térmica de la ficha", !off1.card && !off1.res && !off1.ficha, JSON.stringify(off1));
  ok("  y la casilla sigue a la vista para volver a activarlo", await p.evaluate(() => [...document.querySelectorAll('[data-beta="th"]')].every(c => c.offsetParent !== null && !c.checked)));
  if (await p.evaluate(() => !!(window.jspdf && window.jspdf.jsPDF))) {
    const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 30000 }), p.click("#downloadReport")]); const f = path.join(os.tmpdir(), "informe-beta.pdf"); await dl.saveAs(f);
    ok("  y no sale en el informe PDF", !fs.readFileSync(f, "latin1").includes("lculo t"));
  }
  await p.reload(); await p.waitForTimeout(800); await p.click("#loadExample"); await p.waitForTimeout(900);
  ok("la elección se recuerda al volver a abrir", !(await vis()).res);
  await p.locator('#thermRes [data-beta="th"]').check(); await p.waitForTimeout(400);
  ok("se vuelve a activar desde la otra tarjeta", (await vis()).res && (await vis()).card);
  await p.close();

  // 8. tutorial: se recorre entero en techo y suelo (saltando las misiones) y salen los pasos de lo nuevo
  out.push("Tutorial");
  for (const [h, nm] of [["#planificador", "techo"], ["#suelo", "suelo"]]) {
    p = await open(h); await p.click("#tourBtn"); await p.waitForTimeout(500);
    const seen = [];
    for (let i = 0; i < 60; i++) {
      const st = await p.evaluate(() => { const tp = document.querySelector(".tour-tip"); if (!tp) return null; return { t: (tp.querySelector(".tt-title,h3") || {}).innerText || "", b: [...tp.querySelectorAll("button[data-t]")].map(x => x.getAttribute("data-t")) }; });
      if (!st) break; seen.push(st.t);
      const a = st.b.includes("next") ? "next" : st.b.includes("skip") ? "skip" : null; if (!a) break;
      await p.click('.tour-tip button[data-t="' + a + '"]'); await p.waitForTimeout(300);
    }
    const need = ["¿Tienes un plano de la vivienda?", "Deshacer y rehacer", "Paredes curvas", "Control por zonas"], miss = need.filter(t => !seen.includes(t));
    ok("tutorial de " + nm + ": llega al final (" + seen.length + " pasos) con los pasos nuevos", /Fin/.test(seen[seen.length - 1] || "") && !miss.length, "faltan: " + miss.join(", ") + " · último: " + seen[seen.length - 1]);
    await p.close();
  }

  ok("sin errores de JavaScript durante las pruebas", errors.length === 0, errors.join(" | "));
  await browser.close(); server.close();
  console.log(out.join("\n"));
  console.log(fails ? "\n" + fails + " comprobación(es) fallida(s)." : "\nTodo correcto.");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(2); });

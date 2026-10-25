#!/usr/bin/env node
// Graba las animaciones del tutorial con la herramienta de verdad: abre el planificador, hace un ejemplo con un cursor
// visible y guarda un vídeo corto en bucle (MP4 y WebM, sin sonido) por paso y por sistema en tutorial/<sistema>-<paso>.mp4/.webm.
//
//   node tutorial/grabar.js                 graba todas
//   node tutorial/grabar.js estancia ventana graba solo esas (para techo y suelo)
//   SISTEMA=techo node tutorial/grabar.js    solo las de techo (o suelo)
//
// Hay que volver a grabarlas cuando cambie el aspecto de la herramienta. Necesita Playwright, Chromium y ffmpeg.
"use strict";
const fs = require("fs"), path = require("path"), http = require("http"), os = require("os"), { execFileSync } = require("child_process");
const ROOT = path.resolve(__dirname, ".."), OUT = __dirname, FPS = 15;

function loadPlaywright() { for (const p of ["playwright", "/opt/node-tools/node_modules/playwright", "@playwright/test"]) { try { return require(p); } catch (e) {} } throw new Error("Falta Playwright"); }
const { chromium } = loadPlaywright();

// the same test copy as tests/run.js: internal state reachable and no sign-in
const INIT = "  renderCatalog(); renderCollectors(); renderFloorBar(); syncProjectInputs(); update(true);";
const AUTH = "var AUTH_HOSTS = /(^|\\.)github\\.io$|^localhost$|^127\\.0\\.0\\.1$/;";
let html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
if (!html.includes(INIT) || !html.includes(AUTH)) throw new Error("index.html ha cambiado: actualiza INIT o AUTH en tutorial/grabar.js");
html = html.replace(INIT, "  window.__dbg={S:S,get results(){ return results; },update:update,rectRoom:rectRoom,nid:nid,curFloor:curFloor,toW:toW,V:V,renderFloorBar:renderFloorBar,renderCollectors:renderCollectors,syncProjectInputs:syncProjectInputs,histReset:histReset};\n" + INIT)
           .replace(AUTH, "var AUTH_HOSTS = /^$/;");
const server = http.createServer((q, r) => { r.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); r.end(html); });

// ---- the cursor drawn over the page (screenshots do not show the real one) and the circle of a click
const CURSOR = `(() => { if (document.getElementById("fakeCur")) return; const d = document.createElement("div"); d.id = "fakeCur";
  d.innerHTML = '<svg width="26" height="30" viewBox="0 0 26 30"><path d="M3 2 L3 24 L9 18.5 L13 27.5 L17 25.8 L13 17 L21 17 Z" fill="#111" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/></svg>';
  d.style.cssText = "position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transform:translate(-3px,-2px);";
  const c = document.createElement("div"); c.id = "fakeClick"; c.style.cssText = "position:fixed;z-index:2147483646;pointer-events:none;border-radius:50%;border:3px solid rgba(217,69,47,.95);background:rgba(217,69,47,.18);display:none;";
  document.body.appendChild(c); document.body.appendChild(d); })()`;

class Rec {
  constructor(page, dir) { this.p = page; this.dir = dir; this.n = 0; this.x = 600; this.y = 400; this.clip = null; this.ripple = 0; }
  async cursor() { await this.p.evaluate(([x, y, r]) => { const d = document.getElementById("fakeCur"); d.style.left = x + "px"; d.style.top = y + "px";
      const c = document.getElementById("fakeClick"); if (r > 0) { const s = 10 + r * 26; c.style.display = "block"; c.style.width = c.style.height = s + "px"; c.style.left = (x - s / 2) + "px"; c.style.top = (y - s / 2) + "px"; c.style.opacity = String(1 - r * 0.7); } else c.style.display = "none"; }, [this.x, this.y, this.ripple]); }
  async frame(k = 1) { await this.cursor(); const f = path.join(this.dir, "f" + String(this.n).padStart(5, "0") + ".png"); await this.p.screenshot({ path: f, clip: this.clip }); this.n++;
    for (let i = 1; i < k; i++) { fs.copyFileSync(f, path.join(this.dir, "f" + String(this.n).padStart(5, "0") + ".png")); this.n++; } }
  async hold(s) { await this.frame(Math.max(1, Math.round(s * FPS))); }
  async move(x, y, s = 0.6) { const x0 = this.x, y0 = this.y, k = Math.max(2, Math.round(s * FPS));
    for (let i = 1; i <= k; i++) { const t = i / k, e = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; this.x = x0 + (x - x0) * e; this.y = y0 + (y - y0) * e; await this.p.mouse.move(this.x, this.y); await this.frame(); } }
  async to(sel, dx = 0, dy = 0, s) { const b = await this.p.locator(sel).first().boundingBox(); await this.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, s); }
  // a click on a <select>: only the circle (a real click opens the native list, which screenshots cannot show)
  async pick(sel, index) { await this.to(sel); for (const k of [0.01, 0.35, 0.7, 1]) { this.ripple = k; await this.frame(); } this.ripple = 0; await this.p.selectOption(sel, { index }); await this.p.waitForTimeout(300); await this.frame(2); }
  async press() { this.ripple = 0.01; await this.p.mouse.down(); await this.frame(); await this.p.mouse.up();
    for (const r of [0.35, 0.7, 1]) { this.ripple = r; await this.frame(); } this.ripple = 0; await this.p.waitForTimeout(120); await this.frame(); }
  async click(sel, dx, dy) { await this.to(sel, dx, dy); await this.press(); }
  async drag(x, y, s = 0.8) { this.ripple = 0.01; await this.p.mouse.down(); await this.frame(); this.ripple = 0; await this.move(x, y, s); await this.p.mouse.up(); await this.p.waitForTimeout(150); await this.frame(2); }
  async type(text, per = 2) { for (const ch of text) { await this.p.keyboard.type(ch); await this.p.waitForTimeout(20); await this.frame(per); } }
  async key(k) { await this.p.keyboard.press(k); await this.p.waitForTimeout(150); await this.frame(2); }
  // world point (m) of the plan -> screen
  async w2s(x, y) { return this.p.evaluate(([x, y]) => { const svg = document.querySelector("#planWrap svg"), q = new DOMPoint(x, y).matrixTransform(svg.getScreenCTM()); return [q.x, q.y]; }, [x, y]); }
  // a dot of the grid in the new-room dialog -> screen
  async gp(x, y) { return this.p.evaluate(([x, y]) => { const q = new DOMPoint(x, y).matrixTransform(document.getElementById("shapeSvg").getScreenCTM()); return [q.x, q.y]; }, [x, y]); }
  async dots(pts, s = 0.45) { for (const [x, y] of pts) { const [a, b] = await this.gp(x, y); await this.move(a, b, s); await this.hold(0.1); await this.press(); } }
  async moveW(x, y, s) { const [sx, sy] = await this.w2s(x, y); await this.move(sx, sy, s); }
  // the part of the screen that is recorded: a 16:10 box around these elements, clamped to the window
  // the whole width, from the top of the window (for the dialogs, which open at the top)
  full() { const vp = this.p.viewportSize(); this.clip = { x: 0, y: 0, width: vp.width, height: Math.round(vp.width / 1.6) }; }
  async frameOn(sels, W = 760, pad = 24) { const vp = this.p.viewportSize(); let b = null;
    for (const s of sels) { const r = await this.p.locator(s).first().boundingBox(); if (!r) continue; b = b ? { x0: Math.min(b.x0, r.x), y0: Math.min(b.y0, r.y), x1: Math.max(b.x1, r.x + r.width), y1: Math.max(b.y1, r.y + r.height) } : { x0: r.x, y0: r.y, x1: r.x + r.width, y1: r.y + r.height }; }
    let w = Math.max(W, b.x1 - b.x0 + 2 * pad), h = Math.round(w / 1.6); if (h < b.y1 - b.y0 + 2 * pad) { h = b.y1 - b.y0 + 2 * pad; w = Math.round(h * 1.6); }
    w = Math.min(w, vp.width); h = Math.min(Math.round(w / 1.6), vp.height);
    const cx = (b.x0 + b.x1) / 2, cy = b.y1 - b.y0 + 2 * pad > h ? b.y0 - pad + h / 2 : (b.y0 + b.y1) / 2; // too tall: keep the top
    this.clip = { x: Math.round(Math.max(0, Math.min(vp.width - w, cx - w / 2))), y: Math.round(Math.max(0, Math.min(vp.height - h, cy - h / 2))), width: Math.round(w), height: Math.round(h) }; }
}

// ---- starting points
async function setFloor(p, mode, rooms, colls, o = {}) {
  await p.evaluate(([mode, rooms, colls, o]) => { const D = window.__dbg, S = D.S;
    const rs = rooms.map(q => { const r = D.rectRoom(q.n, q.x, q.y, q.w, q.l, q.o || {}); if (q.marks) r.marks = q.marks; if (q.lights) { r.customL = true; r.lights = q.lights; } return r; });
    const cs = (colls || []).map(c => Object.assign({ id: D.nid(), name: "Colector 1", cap: c.cap || 12 }, mode === "suelo" ? { room: rs[c.room].id, edge: c.edge, off: c.off } : { x: c.x, y: c.y }));
    S.floors = [{ id: D.nid(), name: "Planta baja", rooms: rs, collectors: cs }]; S.fi = 0; S.sel = rs.length ? rs[o.sel || 0].id : null; S.zoom = null; S.title = "Casa García";
    const pc = document.getElementById("showPipes"); if (pc && pc.checked !== !!o.pipes) { pc.checked = !!o.pipes; pc.dispatchEvent(new Event("change")); }
    D.syncProjectInputs(); D.renderFloorBar(); D.renderCollectors(); D.update(true); D.histReset(); }, [mode, rooms, colls, o]);
  await p.waitForTimeout(400);
}
const SALON = { n: "Salón", x: 0, y: 0, w: 5, l: 4 }, DORM = { n: "Dormitorio", x: 5, y: 0, w: 3, l: 4 }, TWO = [SALON, DORM];
const COLL = mode => mode === "suelo" ? [{ room: 0, edge: 2, off: 1.2, cap: 8 }] : [{ x: 1, y: 3.4 }];
// scroll so that this element sits near the top, frame the recording on these elements and park the cursor
async function view(r, p, sel, frames, W = 1000, up = 60, cur = [0.6, 0.78]) {
  await p.evaluate(([s, up]) => { document.querySelector(s).scrollIntoView({ block: "start" });
    const h = Array.from(document.querySelectorAll("#appView .topbar")).find(e => getComputedStyle(e).position === "sticky"); window.scrollBy(0, -up - (h ? h.getBoundingClientRect().height : 0)); }, [sel, up]); await p.waitForTimeout(200);
  await r.frameOn(frames, W); r.x = r.clip.x + r.clip.width * cur[0]; r.y = r.clip.y + r.clip.height * cur[1]; await r.hold(0.5);
}
async function field(r, sel, text) { await r.click(sel); await r.key("Control+a"); await r.type(text, 3); await r.key("Tab"); }
// a simple house plan, like a scanned PDF: two rooms with thick walls, furniture and texts (100 px = 1 m)
async function planImage(browser) {
  const q = await browser.newPage({ viewport: { width: 1000, height: 600 } });
  await q.setContent(`<body style="margin:0;background:#fff"><svg width="1000" height="600" font-family="Arial" font-size="18" fill="none" stroke="#222">
    <path d="M100 100H900V500H100Z" stroke-width="14"/><path d="M600 100V500" stroke-width="10"/>
    <path d="M250 93H450" stroke="#fff" stroke-width="16"/><path d="M250 100H450M250 94H450M250 106H450" stroke-width="2"/>
    <path d="M600 330V410" stroke="#fff" stroke-width="12"/><path d="M600 330A80 80 0 0 1 680 410" stroke-width="1.5"/>
    <rect x="140" y="380" width="200" height="80" rx="10" stroke-width="2"/><rect x="380" y="220" width="120" height="120" rx="60" stroke-width="2"/>
    <rect x="680" y="160" width="160" height="200" stroke-width="2"/><path d="M680 200H840" stroke-width="2"/>
    <g fill="#222" stroke="none"><text x="300" y="290">SALÓN</text><text x="300" y="312" font-size="15">20,00 m²</text><text x="700" y="440">DORMITORIO</text><text x="720" y="462" font-size="15">12,00 m²</text>
    <text x="330" y="60" font-size="16">5,00</text></g><path d="M100 70H600M100 62V78M600 62V78" stroke-width="1.5"/></svg></body>`);
  const b = await q.screenshot({ type: "png" }); await q.close(); return b;
}
// screen point of a pixel of the background image
async function bgPx(r, px, py) { const [x, y] = await r.p.evaluate(([px, py]) => { const b = window.__dbg.curFloor().bg; return [b.x + px * b.s, b.y + py * b.s]; }, [px, py]); return r.w2s(x, y); }

// ---- the examples: one per tutorial step that asks to do something
const SCENES = {
  async nombre(r, p, mode) {
    await setFloor(p, mode, []); await p.evaluate(() => { const S = window.__dbg.S; S.title = "Nuevo proyecto"; window.__dbg.syncProjectInputs(); window.__dbg.update(true); });
    await p.evaluate(() => window.scrollTo(0, 0)); await r.frameOn(["#projTitle", "#chips"], 640);
    r.x = r.clip.x + r.clip.width * 0.7; r.y = r.clip.y + r.clip.height * 0.75; await r.hold(0.6);
    await r.click("#projName"); await r.key("Control+a"); await r.type("Casa García"); await r.key("Enter"); await r.hold(1.8);
  },
  async plano(r, p, mode, browser) {
    const img = await planImage(browser);
    await setFloor(p, mode, []); await view(r, p, "#planTools", ["#bgBar", "#planWrap"]);
    await r.to("#bgImport"); await r.press(); await r.hold(0.3);
    await p.setInputFiles("#bgFile", { name: "plano-casa.png", mimeType: "image/png", buffer: img });
    await p.waitForFunction(() => window.__dbg.curFloor().bg, null, { timeout: 15000 }); await p.waitForTimeout(500); await r.hold(1);
    if (await p.evaluate(() => window.__dbg.S.bgTool) !== "cal") await r.click('#bgBar [data-bg="cal"]'); // importing already starts the calibration
    await r.hold(0.3);
    let [x, y] = await bgPx(r, 100, 70); await r.move(x, y); await r.press(); [x, y] = await bgPx(r, 600, 70); await r.move(x, y, 0.9); await r.press(); await r.hold(0.3);
    await r.click("#bgCalLen"); await r.type("5", 4); await r.key("Enter"); await p.waitForTimeout(300); await r.hold(0.8);
    if (await p.evaluate(() => window.__dbg.S.bgTool) !== "trace") await r.click('#bgBar [data-bg="trace"]'); // calibrating goes on to tracing by itself
    await r.hold(0.3);
    for (const [a, b] of [[100, 100], [600, 100], [600, 500], [100, 500], [100, 100], [600, 100], [900, 100], [900, 500], [600, 500], [600, 100]]) { [x, y] = await bgPx(r, a, b); await r.move(x, y, 0.45); await r.press(); }
    await r.key("Escape"); await r.hold(2);
  },
  async estancia(r, p, mode) {
    await setFloor(p, mode, []); await view(r, p, "#planTools", ["#planTools"], 1000, 50); r.full(); r.x = 640; r.y = 520; await r.hold(0.5);
    await r.click("#addRoom"); await p.waitForTimeout(300); await r.hold(0.4);
    await r.dots([[4, 4], [14, 4], [14, 12], [4, 12], [4, 4]]); await r.hold(0.6); // corner by corner (50 cm squares), closing on the first one
    await r.click("#shSkip"); await r.hold(0.3);
    await r.click("#shName"); await r.key("Control+a"); await r.type("Salón");
    for (const [i, v] of [[0, "5"], [1, "4"], [2, "5"], [3, "4"]]) { await r.click('[data-len="' + i + '"]'); await r.key("Control+a"); await r.type(v, 3); }
    await r.hold(0.5); await r.click("#shCreate"); await p.waitForTimeout(500); await r.hold(2);
  },
  async forma(r, p, mode) {
    await setFloor(p, mode, []); await view(r, p, "#planTools", ["#planTools"], 1000, 50); r.full(); r.x = 640; r.y = 520; await r.hold(0.5);
    await r.click("#addRoom"); await p.waitForTimeout(300); await r.hold(0.3);
    await r.dots([[4, 3], [18, 3], [18, 9], [12, 9], [12, 15], [4, 15], [4, 3]], 0.4); await r.hold(0.6);
    await r.click('#shapeCanvas [data-edge="1"]'); await r.hold(0.4); await r.click("#shNext"); await p.waitForTimeout(200); await r.hold(0.3);
    await r.to('#shapeCanvas [data-h="1"]'); const [x, y] = await r.gp(20.2, 6); await r.drag(x, y, 0.9); await r.hold(0.5);
    await r.click("#shNext"); await p.waitForTimeout(200); await r.hold(0.3);
    await r.click("#shName"); await r.key("Control+a"); await r.type("Salón-comedor", 1);
    await r.hold(0.8);
    await r.click("#shCreate"); await p.waitForTimeout(600); await r.hold(2.2);
  },
  async segunda(r, p, mode) {
    await setFloor(p, mode, [SALON]); await view(r, p, "#planTools", ["#planTools"], 1000, 50); r.full(); r.x = 640; r.y = 520; await r.hold(0.5);
    await r.click("#addRoom"); await p.waitForTimeout(300); await r.hold(0.3);
    await r.click("#shRect"); await r.hold(0.3); await r.click("#shSkip"); await r.hold(0.2);
    await r.click("#shName"); await r.key("Control+a"); await r.type("Dormitorio");
    for (const [i, v] of [[0, "3"], [1, "4"], [2, "3"], [3, "4"]]) { await r.click('[data-len="' + i + '"]'); await r.key("Control+a"); await r.type(v, 3); }
    await r.hold(0.4); await r.click("#shCreate"); await p.waitForTimeout(500); await r.hold(0.6);
    await r.moveW(2.5, 2); await r.press(); await p.waitForTimeout(400); await r.hold(0.6);
    await r.click('#shapeCanvas [data-pick="1"]'); await p.waitForTimeout(300); await r.hold(0.6);
    await r.click('#shapeCanvas [data-pick="3"]'); await p.waitForTimeout(600); await r.hold(2);
  },
  async mover(r, p, mode) {
    await setFloor(p, mode, [SALON, Object.assign({}, DORM, { x: 6.4, y: 0.5 })]); await view(r, p, "#planTools", ["#planWrap"], 1000, 10, [0.5, 0.8]);
    await r.moveW(2.5, 2.5); await r.hold(0.2); await r.drag(r.x - 140, r.y + 30, 0.9); await r.hold(0.3);
    for (let i = 0; i < 4; i++) { await p.mouse.wheel(0, -160); await p.waitForTimeout(120); await r.frame(4); }
    await r.hold(0.4); for (let i = 0; i < 4; i++) { await p.mouse.wheel(0, 160); await p.waitForTimeout(120); await r.frame(4); }
    await r.click('[data-zoom="fit"]'); await p.waitForTimeout(300); await r.hold(0.5);
    await r.moveW(7.9, 2.5); await p.mouse.dblclick(r.x, r.y); for (const k of [0.35, 0.7, 1]) { r.ripple = k; await r.frame(); } r.ripple = 0; await p.waitForTimeout(150); await r.hold(0.4);
    const [x, y] = await r.w2s(6.5, 2); await r.drag(x, y, 1.1); await p.waitForTimeout(400); await r.hold(2);
  },
  async deshacer(r, p, mode) {
    await setFloor(p, mode, TWO); await view(r, p, "#planTools", ["#undoBtn", "#planWrap"], 1000, 10, [0.6, 0.8]);
    await r.click('#markBar [data-mark="ventana"]'); await r.moveW(2.5, 0.06); await r.press(); await r.moveW(6.5, 0.06, 0.5); await r.press(); await r.click('#markBar [data-mark="ventana"]');
    await p.waitForTimeout(600); await r.hold(0.4);
    await r.click("#undoBtn"); await p.waitForTimeout(300); await r.hold(0.6); await r.press(); await p.waitForTimeout(300); await r.hold(0.8);
    await r.click("#redoBtn"); await p.waitForTimeout(300); await r.hold(2);
  },
  async curvo(r, p, mode) {
    await setFloor(p, mode, TWO); await view(r, p, "#markBar", ["#bgBar", "#planWrap"], 1000, 10, [0.6, 0.85]);
    await r.click('#bgBar [data-bg="curve"]'); await r.hold(0.3); await r.moveW(5, 2.6); await r.press(); await r.hold(0.4);
    const pts = []; for (let i = 0; i <= 14; i++) { const t = i / 14, y = 0.4 + 3.2 * t, x = 5 + 1.0 * Math.sin(Math.PI * t) + (i % 3 - 1) * 0.04; pts.push(await r.w2s(x, y)); }
    await r.move(pts[0][0], pts[0][1], 0.5); r.ripple = 0.01; await p.mouse.down(); await r.frame(); r.ripple = 0;
    for (const [x, y] of pts.slice(1)) await r.move(x, y, 0.12);
    await p.mouse.up(); await p.waitForTimeout(400); await r.hold(0.6); await r.click('#bgBar [data-bg="curve"]'); await r.hold(2);
  },
  async ventana(r, p, mode) {
    await setFloor(p, mode, TWO); await view(r, p, "#markBar", ["#markBar", "#planWrap"], 1000, 10);
    await r.click('#markBar [data-mark="ventana"]'); await r.hold(0.3);
    const [x, y] = await r.w2s(2.5, 0.06); await r.move(x, y, 0.8); await r.hold(0.3); await r.press(); await r.hold(0.4);
    await r.click('#markBar [data-mark="ventana"]'); await r.move(r.clip.x + r.clip.width * 0.6, r.clip.y + r.clip.height * 0.8, 0.5); await r.hold(1.8);
  },
  async puerta(r, p, mode) {
    await setFloor(p, mode, TWO, COLL(mode)); await view(r, p, "#markBar", ["#markBar", "#planWrap"], 1000, 10);
    await r.click("#doorBtn"); await p.waitForTimeout(200); await r.hold(0.6); await r.click("#doorGo"); await r.hold(0.3);
    await r.moveW(4.98, 2.2, 0.8); await r.press(); await r.hold(0.5); await r.click("#doorOk"); await p.waitForTimeout(500); await r.hold(2);
  },
  async obstaculo(r, p, mode) {
    await setFloor(p, mode, TWO); await view(r, p, "#markBar", ["#markBar", "#planWrap"], 1000, 10);
    await r.click("#obstBtn"); await r.hold(0.3); await r.moveW(5.15, 0.15, 0.8); const [x, y] = await r.w2s(6.4, 0.75); await r.drag(x, y, 0.9); await p.waitForTimeout(400); await r.hold(0.5);
    await r.click("#obstBtn"); await r.hold(2);
  },
  async acceso(r, p, mode) {
    await setFloor(p, mode, TWO); await view(r, p, "#markBar", ["#markBar", "#planWrap"], 1000, 10);
    await r.click('#markBar [data-mark="acceso"]'); await r.moveW(2.5, 3.95, 0.8); await r.press(); await p.waitForTimeout(300); await r.hold(0.4);
    await r.click('#markBar [data-mark="acceso"]'); await r.hold(2);
  },
  async paso(r, p, mode) {
    await setFloor(p, mode, TWO, COLL(mode), { pipes: true }); await view(r, p, "#markBar", ["#markBar", "#planWrap"], 1000, 10);
    await r.hold(0.4); await r.click("#viaBtn"); await r.moveW(4.97, 0.7, 0.8); await r.press(); await p.waitForTimeout(400); await r.hold(0.4);
    await r.click("#viaBtn"); await r.hold(2);
  },
  async tuberia(r, p, mode) {
    await setFloor(p, mode, TWO, COLL(mode)); await view(r, p, "#planTools", ["#planTools", "#planWrap"], 1000, 10);
    await r.click("#showPipes"); await p.waitForTimeout(400); await r.hold(1); await r.click("#colorByCircuit"); await p.waitForTimeout(300); await r.hold(2);
  },
  async colector(r, p, mode) {
    await setFloor(p, mode, TWO); await view(r, p, "#planTools", ["#collChip", "#planWrap"], 1000, 10);
    await r.to("#collChip"); const [x, y] = await r.w2s(mode === "suelo" ? 2.5 : 1.2, mode === "suelo" ? 3.75 : 3.3); await r.drag(x, y, 1.1); await p.waitForTimeout(600); await r.hold(2.2);
  },
  async recomendada(r, p, mode) {
    await setFloor(p, mode, TWO, [{ room: 1, edge: 1, off: 2, cap: 8 }]); await p.waitForSelector("#collRec:not([hidden])", { timeout: 30000 });
    await view(r, p, "#planTools", ["#collRec", "#planWrap"], 1000, 10); await p.evaluate(() => { document.getElementById("planWrap").scrollIntoView = function () {}; }); await r.hold(0.6); // the plan is already in view
    await r.click("#collRec"); await p.waitForTimeout(400); await r.hold(1); await r.click("#recOk"); await p.waitForTimeout(500); await r.hold(2);
  },
  async ficha(r, p, mode) {
    await setFloor(p, mode, TWO, COLL(mode), { sel: 1 }); await view(r, p, "#planTools", ["#planWrap"], 1000, 10, [0.6, 0.85]);
    await r.moveW(2.5, 2); await r.press(); await p.waitForTimeout(500); await r.hold(0.5);
    await view(r, p, "#detailCard", ["#detailCard"], 1000, 10, [0.3, 0.3]); await r.hold(2);
  },
  async luz(r, p, mode) {
    await setFloor(p, mode, TWO); await view(r, p, "#detailCard", ["#detailCard"], 1000, 10, [0.5, 0.5]);
    await p.locator("#rCustL").scrollIntoViewIfNeeded(); await r.frameOn(["#rCustL", "#detailSvg"], 1000);
    await r.click("#rCustL"); await p.waitForTimeout(700); await r.hold(0.3); // with no points yet, ticking it already starts adding
    const b = await p.locator("#detailSvg svg").boundingBox(); await r.move(b.x + b.width * 0.42, b.y + b.height * 0.4, 0.8); await r.press(); await p.waitForTimeout(400); await r.hold(0.4);
    await r.click("#lightAdd"); await r.hold(2);
  },
  async cotas(r, p, mode) {
    await setFloor(p, mode, TWO.map((q, i) => i ? q : Object.assign({}, q, { lights: [{ x: 2, y: 1.6, s: 30 }] }))); await view(r, p, "#detailCard", ["#detailCard"], 1000, 10, [0.5, 0.5]);
    await p.locator("#lightBox").scrollIntoViewIfNeeded(); await r.frameOn(["#lightBox", "#detailSvg"], 1000);
    const ins = await p.locator("#lightBox [data-ld]").count(); await r.hold(0.3);
    await field(r, "#lightBox [data-ld] >> nth=0", "150"); await p.waitForTimeout(300); await r.hold(0.4);
    if (ins > 1) { await field(r, "#lightBox [data-ld] >> nth=1", "200"); await p.waitForTimeout(300); }
    await r.hold(2);
  },
  async reglas(r, p, mode) {
    await setFloor(p, mode, TWO, COLL(mode)); await view(r, p, "#ufRulesCard", ["#ufRulesCard", "#detailSvg"], 1000, 20);
    await field(r, "#uSep", "10"); await p.waitForTimeout(500); await r.hold(0.8); await field(r, "#uSepWin", "5"); await p.waitForTimeout(500); await r.hold(2);
  },
  async salidas(r, p, mode) {
    await setFloor(p, mode, TWO, COLL(mode)); await view(r, p, "#collCard", ["#collCard", "#tablesCard"], 1000, 20);
    await field(r, "#collList .coll-row input[type=number]", "6"); await p.waitForTimeout(500); await r.hold(2);
  },
  async marca(r, p, mode) {
    await setFloor(p, mode, TWO); await view(r, p, "#brandCard", ["#brandCard", "#catalogCard"], 900, 20);
    await r.pick("#sBrand", 2); await r.hold(1.6); await r.pick("#sBrand", 1); await r.hold(1.6); await r.pick("#sBrand", 0); await r.hold(0.8);
    await r.pick("#sFinish", 1); await r.hold(1.2); await r.pick("#sFinish", 0); await r.hold(1.8);
  },
  async paneles(r, p, mode) {
    await setFloor(p, mode, TWO); await view(r, p, "#detailCard", ["#catalogCard", "#detailSvg"], 1000, 20);
    await r.click("#catalogBody tr:nth-child(3) input"); await p.waitForTimeout(400); await r.hold(1.4);
    await r.click("#catalogBody tr:nth-child(2) input"); await p.waitForTimeout(400); await r.hold(1.4);
    await r.click("#catalogBody tr:nth-child(3) input"); await r.click("#catalogBody tr:nth-child(2) input"); await p.waitForTimeout(400); await r.hold(1.8);
  },
  async cobertura(r, p, mode) {
    await setFloor(p, mode, TWO); await view(r, p, "#coverCard", ["#coverCard", "#detailSvg"], 1000, 20);
    await field(r, "#gMin", "50"); await p.waitForTimeout(300); await field(r, "#gMax", "60"); await p.waitForTimeout(400); await r.hold(2);
  },
  async pladur(r, p, mode) {
    await setFloor(p, mode, TWO); await p.evaluate(() => { const c = document.getElementById("showStruct"); if (!c.checked) { c.checked = true; c.dispatchEvent(new Event("change")); } });
    await view(r, p, "#pladurCard", ["#pladurCard", "#detailSvg"], 1000, 20);
    await r.pick("#sBoard", 2); await r.hold(0.6); await field(r, "#sPrim", "60"); await p.waitForTimeout(400); await r.hold(2);
  },
  async termico(r, p, mode) {
    await setFloor(p, mode, TWO.map((q, i) => Object.assign({}, q, { marks: i ? { 1: "exterior" } : { 0: "ventana" } })), COLL(mode)); await view(r, p, "#thermCard", ["#thermCard"], 900, 20);
    await r.pick("#thZone", 5); await r.hold(0.6);
    await r.pick("#thBuild", 1); await r.hold(0.6); await field(r, "#thTi", "21"); await r.hold(2);
  },
  async material(r, p, mode) {
    await setFloor(p, mode, TWO, COLL(mode)); await view(r, p, "#report", ["#report"], 1000, 10, [0.5, 0.6]);
    await field(r, "#pClient", "Juan García"); await field(r, "#pAddr", "C/ Mayor 12, Toledo");
    await field(r, "#reportBody input[data-key] >> nth=0", "95"); await field(r, "#reportBody input[data-key] >> nth=1", "2"); await p.waitForTimeout(300); await r.hold(0.4);
    await r.to("#downloadReport"); await r.press(); await p.waitForTimeout(1500); await r.hold(2);
  },
  async control(r, p, mode) {
    await setFloor(p, mode, TWO, COLL(mode)); await view(r, p, '[data-qty="ctl_cab"]', ['[data-qty="ctl_cab"]', '[data-qty="ctl_cent"]'], 900, 200, [0.5, 0.8]);
    await field(r, '[data-qty="ctl_cab"]', "4"); await field(r, '[data-qty="ctl_term"]', "2"); await field(r, '[data-qty="ctl_cent"]', "1"); await p.waitForTimeout(300); await r.hold(2);
  },
  async empresa(r, p, mode) {
    await setFloor(p, mode, TWO); await p.evaluate(() => window.scrollTo(0, 0)); await r.frameOn(["#openCompany"], 1280); r.x = 700; r.y = 500; await r.hold(0.5);
    await r.click("#openCompany"); await p.waitForTimeout(300); await r.frameOn(["#companyModal .modal-card"], 900); await r.hold(0.5);
    await r.type("Climatización Ruiz S.L.", 1); await field(r, "#cNif", "B12345678"); await p.waitForTimeout(200);
    await r.click("#companySave"); await p.waitForTimeout(500); await r.hold(2);
  },
  async plan(r, p, mode) {
    await setFloor(p, mode, TWO); await p.evaluate(() => window.scrollTo(0, 0)); await r.frameOn(["#planBtn"], 1280); r.x = 700; r.y = 500; await r.hold(0.5);
    await r.click("#planBtn"); await p.waitForTimeout(700); await r.hold(2.5);
  },
};
// steps that only exist in one system
const ONLY = { marca: "techo", puerta: "suelo", recomendada: "suelo", reglas: "suelo", obstaculo: "techo", acceso: "techo", paso: "techo", tuberia: "techo", luz: "techo", cotas: "techo", paneles: "techo", cobertura: "techo", pladur: "techo" };

(async () => {
  const want = process.argv.slice(2), names = want.length ? want : Object.keys(SCENES);
  await new Promise(res => server.listen(0, "127.0.0.1", res));
  const URL = "http://127.0.0.1:" + server.address().port + "/";
  const exe = fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined;
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  for (const name of names) for (const mode of ["techo", "suelo"]) { if ((ONLY[name] && ONLY[name] !== mode) || (process.env.SISTEMA && process.env.SISTEMA !== mode)) continue;
    const p = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await p.goto(URL + (mode === "suelo" ? "#suelo" : "#planificador")); await p.waitForTimeout(900); await p.evaluate(CURSOR);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grab-")), r = new Rec(p, dir);
    try { await SCENES[name](r, p, mode, browser); } catch (e) { if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT }); throw e; }
    const out = path.join(OUT, mode + "-" + name + ".mp4");
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", path.join(dir, "f%05d.png"), "-vf", "scale=960:-2:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-crf", "27", "-preset", "slow", "-movflags", "+faststart", "-an", out]);
    // and WebM (VP9) for browsers without H.264 (the tutorial offers both, each browser takes what it plays)
    const outW = out.replace(/\.mp4$/, ".webm");
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", path.join(dir, "f%05d.png"), "-vf", "scale=960:-2:flags=lanczos,format=yuv420p", "-c:v", "libvpx-vp9", "-crf", "36", "-b:v", "0", "-row-mt", "1", "-deadline", "good", "-an", outW]);
    fs.rmSync(dir, { recursive: true, force: true }); await p.close();
    console.log(mode + "-" + name + "  mp4 " + Math.round(fs.statSync(out).size / 1024) + " KB · webm " + Math.round(fs.statSync(outW).size / 1024) + " KB · " + (r.n / FPS).toFixed(1) + " s");
  }
  await browser.close(); server.close();
})().catch(e => { console.error(e); process.exit(1); });

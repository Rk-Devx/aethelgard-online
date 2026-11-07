'use strict';
// ============================================================
//  CLIENTE: desenha o mundo no canvas, lê teclado/toque e fala com o servidor
// ============================================================
const $ = (s) => document.querySelector(s);
const cv = $('#cv'), ctx = cv.getContext('2d');
const T = { GRASS: 0, WATER: 1, TREE: 2, SAND: 3, TOWN: 4, WALL: 5, DARK: 6 };

let ws, CFG, MAP, W, H, myId = 0, me = null, TS = 40, offX = 0, offY = 0, mini = null, started = false;
const ents = new Map(), floats = [], fxs = [];
const pad = { dx: 0, dy: 0 };
let keys = [], curDir = '0,0', chatFocus = false, shopSig = '', time = 0;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const send = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
const tile = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? T.WATER : MAP.charCodeAt(y * W + x) - 48);
const hsh = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

function resize() {
  const dpr = window.devicePixelRatio || 1;
  cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
  cv.style.width = innerWidth + 'px'; cv.style.height = innerHeight + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false; // pixel art nítida (sem borrar)
  TS = Math.round(Math.max(30, Math.min(48, innerWidth / 16)));
}
addEventListener('resize', resize); resize();

// ---------------- rede ----------------
function connect() {
  const name = $('#inName').value.trim(), pass = $('#inPass').value;
  $('#loginErr').textContent = '';
  if (ws) ws.close();
  ws = new WebSocket(window.SERVER_URL || ((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host));
  ws.onopen = () => send({ t: 'login', name, pass });
  ws.onmessage = (e) => handle(JSON.parse(e.data));
  ws.onclose = () => { if (started) { addLog('<i>Conexão perdida. Recarregue a página.</i>'); } };
}
$('#btnLogin').onclick = connect;
$('#inPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') connect(); });

function handle(m) {
  switch (m.t) {
    case 'w':
      CFG = m.cfg; W = m.W; H = m.H; MAP = m.map; myId = m.id;
      buildMini();
      $('#login').classList.add('hidden'); $('#hud').classList.remove('hidden');
      buildActionBar();
      if (!started) { started = true; requestAnimationFrame(loop); }
      break;
    case 'err': $('#loginErr').textContent = m.m; break;
    case 's': onState(m); break;
    case 'chat': addLog(`<b class="${m.mk ? 'mk' : ''}">${esc(m.n)}:</b> ${esc(m.m)}`); break;
    case 'sys': addLog(`<i>${esc(m.m)}</i>`); break;
  }
}

function onState(m) {
  const seen = new Set();
  for (const e of m.e) {
    seen.add(e.id);
    const o = ents.get(e.id);
    if (!o) ents.set(e.id, { ...e, rx: e.x, ry: e.y, dir: 0, mv: 0 });
    else {
      if (e.x !== o.x || e.y !== o.y) { // direção: 0 baixo, 1 esquerda, 2 direita, 3 cima
        o.dir = e.x < o.x ? 1 : e.x > o.x ? 2 : e.y < o.y ? 3 : 0;
        o.mv = performance.now() + 250;
      }
      Object.assign(o, e);
    }
  }
  for (const id of [...ents.keys()]) if (!seen.has(id)) ents.delete(id);
  me = m.me;
  const now = performance.now();
  for (const ev of m.ev) {
    if (ev.k === 'dmg') floats.push({ x: ev.x, y: ev.y, txt: ev.v + (ev.cr ? '!' : ''), c: ev.c === 'p' ? '#ff6b6b' : ev.cr ? '#ffd24a' : '#fff', t: now });
    else if (ev.k === 'heal') floats.push({ x: ev.x, y: ev.y, txt: ev.c === 'hp' ? '+HP' : '+MP', c: ev.c === 'hp' ? '#6bff8a' : '#6bb4ff', t: now });
    else if (ev.k === 'lvl') floats.push({ x: ev.x, y: ev.y, txt: 'LEVEL UP!', c: '#ffd24a', t: now, big: 1 });
    else fxs.push({ ...ev, t: now });
  }
  updateHud();
  drawMini();
}

// ---------------- HUD ----------------
function zoneName() {
  const d = Math.hypot(me.x - W / 2, me.y - H / 2);
  return me.town ? 'Vila de Aethel (zona segura)' : d < 30 ? 'Planícies Verdes' : d < 40 ? 'Deserto Seco' : 'Terras Sombrias';
}

function updateHud() {
  $('#hName').textContent = $('#inName').value || 'Herói';
  $('#hLv').textContent = 'Nv ' + me.lv;
  $('#hGold').textContent = '🪙 ' + me.gold;
  $('#hZone').textContent = zoneName() + (me.mk > 0 ? ' — MARCADO' : '');
  $('#bHp').style.width = (100 * me.hp / me.mhp) + '%'; $('#tHp').textContent = `${me.hp}/${me.mhp}`;
  $('#bMp').style.width = (100 * me.mp / me.mmp) + '%'; $('#tMp').textContent = `${me.mp}/${me.mmp}`;
  $('#bXp').style.width = (100 * me.xp / me.xpn) + '%'; $('#tXp').textContent = `XP ${me.xp}/${me.xpn}`;
  $('#nHp').textContent = me.pots.hp; $('#nMp').textContent = me.pots.mp;
  document.querySelectorAll('.sty').forEach((b) => b.classList.toggle('act', b.dataset.s === me.st));
  const pv = $('#btnPvp'); pv.textContent = '☠ PvP: ' + (me.pv ? 'on' : 'off'); pv.classList.toggle('on', !!me.pv);
  const cd = $('#spCd'); cd.style.display = me.cd > 0 ? 'block' : 'none'; cd.textContent = (me.cd / 1000).toFixed(1);
  if (!$('#skills').classList.contains('hidden')) renderSkills();
  if (!$('#shop').classList.contains('hidden')) renderShop();
}

function addLog(html) {
  const log = $('#log'), d = document.createElement('div');
  d.innerHTML = html; log.appendChild(d);
  while (log.children.length > 40) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;
}

function buildActionBar() {
  document.querySelectorAll('.sty').forEach((b) => (b.title = CFG.styles[b.dataset.s].n + ' — Especial: ' + CFG.styles[b.dataset.s].special));
}

document.querySelectorAll('.sty').forEach((b) => (b.onclick = () => send({ t: 'st', s: b.dataset.s })));
$('#btnSp').onclick = () => send({ t: 'sp' });
$('#potHp').onclick = () => send({ t: 'pot', kind: 'hp' });
$('#potMp').onclick = () => send({ t: 'pot', kind: 'mp' });
$('#btnPvp').onclick = () => send({ t: 'pvp', on: me && !me.pv });
$('#btnSkills').onclick = () => { $('#skills').classList.toggle('hidden'); renderSkills(); };
$('#btnShop').onclick = () => { $('#shop').classList.toggle('hidden'); shopSig = ''; renderShop(); };
document.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => $('#' + b.dataset.close).classList.add('hidden')));

function renderSkills() {
  if (!me) return;
  const names = { sword: '⚔️ Espada', bow: '🏹 Arco', magic: '🔮 Magia', def: '🛡️ Defesa' };
  let h = `<div class="row"><span>Armadura</span><span>${CFG.armors[me.ar].n}</span></div>`;
  for (const s of ['sword', 'bow', 'staff']) h += `<div class="row"><span>${CFG.styles[s].icon} Arma</span><span>${CFG.weapons[s][me.wp[s]].n}</span></div>`;
  for (const k of Object.keys(names)) {
    const [lvl, xp, need] = me.sk[k];
    h += `<div class="sk">${names[k]} — nível ${lvl}<div class="bar"><i style="width:${100 * xp / need}%"></i></div></div>`;
  }
  h += `<p class="row"><small>Treine uma habilidade usando o estilo dela. A defesa sobe ao apanhar.</small></p>`;
  $('#skBody').innerHTML = h;
}

function renderShop() {
  if (!me) return;
  const sig = JSON.stringify([me.gold, me.wp, me.ar, me.town]);
  if (sig === shopSig) return; shopSig = sig;
  const btn = (attrs, owned, price) => `<button ${attrs} ${owned || me.gold < price ? 'disabled' : ''}>${owned ? 'Possui' : price + ' 🪙'}</button>`;
  let h = me.town ? '' : '<p class="row"><small>⚠ Vá até a vila (centro do mapa) para comprar.</small></p>';
  h += '<h4>Poções</h4>';
  h += `<div class="row"><span>❤️ Poção de Vida <small>cura 40%</small></span><button data-k="hp" ${me.gold < CFG.prices.hp ? 'disabled' : ''}>${CFG.prices.hp} 🪙</button></div>`;
  h += `<div class="row"><span>💧 Poção de Mana <small>+50% mana</small></span><button data-k="mp" ${me.gold < CFG.prices.mp ? 'disabled' : ''}>${CFG.prices.mp} 🪙</button></div>`;
  for (const s of ['sword', 'bow', 'staff']) {
    h += `<h4>${CFG.styles[s].icon} ${CFG.styles[s].n}</h4>`;
    CFG.weapons[s].forEach((w, i) => {
      h += `<div class="row"><span>${w.n} <small>+${w.atk} ataque</small></span>${btn(`data-k="weapon" data-s="${s}" data-i="${i}"`, i <= me.wp[s], w.price)}</div>`;
    });
  }
  h += '<h4>🛡️ Armaduras</h4>';
  CFG.armors.forEach((a, i) => {
    h += `<div class="row"><span>${a.n} <small>+${a.def} defesa</small></span>${btn(`data-k="armor" data-i="${i}"`, i <= me.ar, a.price)}</div>`;
  });
  $('#shopBody').innerHTML = h;
}
$('#shopBody').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b || b.disabled) return;
  send({ t: 'buy', kind: b.dataset.k, style: b.dataset.s, tier: +b.dataset.i });
});

// ---------------- minimapa ----------------
function buildMini() {
  mini = document.createElement('canvas'); mini.width = W; mini.height = H;
  const c = mini.getContext('2d');
  const col = ['#4a7c3a', '#2d5f9a', '#2f5a2a', '#d8c58a', '#a39a8c', '#5a5560', '#3a3347'];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { c.fillStyle = col[tile(x, y)]; c.fillRect(x, y, 1, 1); }
}
function drawMini() {
  const c = $('#mm').getContext('2d'), s = $('#mm').width / W;
  c.imageSmoothingEnabled = false;
  c.drawImage(mini, 0, 0, $('#mm').width, $('#mm').height);
  for (const o of ents.values()) {
    if (o.k !== 'p') continue;
    c.fillStyle = o.id === myId ? '#ffe14a' : '#fff';
    c.fillRect(o.x * s - 1, o.y * s - 1, 3, 3);
  }
}

// ---------------- entrada ----------------
const KEYMAP = { ArrowLeft: [-1, 0], a: [-1, 0], A: [-1, 0], ArrowRight: [1, 0], d: [1, 0], D: [1, 0], ArrowUp: [0, -1], w: [0, -1], W: [0, -1], ArrowDown: [0, 1], s: [0, 1], S: [0, 1] };
function updateDir() {
  let dx = 0, dy = 0;
  if (pad.dx || pad.dy) { dx = pad.dx; dy = pad.dy; }
  else if (keys.length) { [dx, dy] = keys[keys.length - 1].v; }
  const s = dx + ',' + dy;
  if (s !== curDir) { curDir = s; send({ t: 'mv', dx, dy }); }
}
addEventListener('keydown', (e) => {
  if (chatFocus) {
    if (e.key === 'Enter') { const v = $('#chatIn').value.trim(); if (v) send({ t: 'chat', m: v }); $('#chatIn').value = ''; $('#chatIn').blur(); }
    else if (e.key === 'Escape') $('#chatIn').blur();
    return;
  }
  if (!me) return;
  if (e.key === 'Enter') { e.preventDefault(); $('#chatIn').focus(); return; }
  if (KEYMAP[e.key]) {
    e.preventDefault();
    if (!keys.some((k) => k.code === e.key)) keys.push({ code: e.key, v: KEYMAP[e.key] });
    updateDir();
  } else if (e.key === '1') send({ t: 'st', s: 'sword' });
  else if (e.key === '2') send({ t: 'st', s: 'bow' });
  else if (e.key === '3') send({ t: 'st', s: 'staff' });
  else if (e.key === ' ') { e.preventDefault(); send({ t: 'sp' }); }
  else if (e.key === 'q' || e.key === 'Q') send({ t: 'pot', kind: 'hp' });
  else if (e.key === 'e' || e.key === 'E') send({ t: 'pot', kind: 'mp' });
});
addEventListener('keyup', (e) => { keys = keys.filter((k) => k.code !== e.key); updateDir(); });
addEventListener('blur', () => { keys = []; pad.dx = pad.dy = 0; updateDir(); });
$('#chatIn').addEventListener('focus', () => { chatFocus = true; keys = []; updateDir(); });
$('#chatIn').addEventListener('blur', () => { chatFocus = false; });

document.querySelectorAll('#pad button').forEach((b) => {
  const down = (e) => { e.preventDefault(); pad.dx = +b.dataset.dx; pad.dy = +b.dataset.dy; updateDir(); };
  const up = (e) => { e.preventDefault(); pad.dx = pad.dy = 0; updateDir(); };
  b.addEventListener('pointerdown', down); b.addEventListener('pointerup', up);
  b.addEventListener('pointerleave', up); b.addEventListener('pointercancel', up);
});

// clique/toque: escolhe alvo (monstro ou jogador); toque no vazio limpa o alvo
cv.addEventListener('pointerdown', (e) => {
  if (!me) return;
  const wx = (e.clientX - offX) / TS - 0.5, wy = (e.clientY - offY) / TS - 0.5;
  let best = null, bd = 0.9;
  for (const o of ents.values()) {
    if (o.id === myId) continue;
    const d = Math.hypot(o.rx - wx, o.ry - wy);
    if (d < bd) { bd = d; best = o; }
  }
  send({ t: 'tg', id: best ? best.id : 0 });
});

// ---------------- desenho ----------------
// ---------------- SPRITES (pixel art) ----------------
// Coloque seus PNGs em public/sprites/. Se um arquivo não existir, o jogo desenha a versão padrão.
const IMGS = {};
function img(name) {
  if (name in IMGS) return IMGS[name];
  IMGS[name] = null;
  const i = new Image();
  i.onload = () => { IMGS[name] = i; };
  i.src = 'sprites/' + name + '.png';
  return null;
}
// desenha um quadro de uma folha de sprites, com os pés alinhados ao fim do tile. Retorna o Y do topo.
function drawActor(im, rows, row, col, cols, px, py, scale) {
  const fw = im.width / cols, fh = im.height / rows;
  const dw = TS * scale, dh = dw * fh / fw;
  const top = py + TS - dh + TS * 0.08;
  ctx.drawImage(im, col * fw, row * fh, fw, fh, Math.round(px + TS / 2 - dw / 2), Math.round(top), Math.round(dw), Math.round(dh));
  return top;
}
function shadow(cx, py, w) { ctx.fillStyle = '#0005'; ctx.beginPath(); ctx.ellipse(cx, py + TS * 0.9, w, w * 0.33, 0, 0, 7); ctx.fill(); }
const TILE_FILES = ['grass', 'water', 'tree', 'sand', 'town', 'wall', 'dark'];

function drawTile(t, x, y, px, py) {
  if (t === T.TREE) {
    const ti = img('tiles/tree');
    if (!ti) return drawTileProc(t, x, y, px, py);
    const gi = img('tiles/grass');
    if (gi) ctx.drawImage(gi, px, py, TS, TS); else drawTileProc(T.GRASS, x, y, px, py);
    ctx.drawImage(ti, px, py, TS, TS);
    return;
  }
  const im = img('tiles/' + TILE_FILES[t]);
  if (im) ctx.drawImage(im, px, py, TS, TS); else drawTileProc(t, x, y, px, py);
}

function drawTileProc(t, x, y, px, py) {
  const h = hsh(x, y);
  switch (t) {
    case T.GRASS: case T.TREE:
      ctx.fillStyle = h < 0.5 ? '#4a7c3a' : '#4f8340'; ctx.fillRect(px, py, TS, TS);
      if (h > 0.8) { ctx.fillStyle = '#5f9a4a'; ctx.fillRect(px + TS * 0.3, py + TS * 0.4, 3, 6); ctx.fillRect(px + TS * 0.35, py + TS * 0.38, 3, 8); }
      if (t === T.TREE) {
        ctx.fillStyle = '#5b3d22'; ctx.fillRect(px + TS * 0.43, py + TS * 0.55, TS * 0.14, TS * 0.4);
        ctx.fillStyle = '#2a6a2a'; ctx.beginPath(); ctx.arc(px + TS / 2, py + TS * 0.4, TS * 0.38, 0, 7); ctx.fill();
        ctx.fillStyle = '#35823a'; ctx.beginPath(); ctx.arc(px + TS * 0.42, py + TS * 0.34, TS * 0.2, 0, 7); ctx.fill();
      }
      break;
    case T.WATER: {
      const w = Math.sin(time / 600 + x + y) * 0.5 + 0.5;
      ctx.fillStyle = `rgb(${40 + w * 10},${90 + w * 15},${150 + w * 20})`; ctx.fillRect(px, py, TS, TS); break;
    }
    case T.SAND:
      ctx.fillStyle = h < 0.5 ? '#d8c58a' : '#d2bf82'; ctx.fillRect(px, py, TS, TS);
      if (h > 0.85) { ctx.fillStyle = '#b8a56a'; ctx.fillRect(px + TS * 0.5, py + TS * 0.5, 4, 3); } break;
    case T.TOWN:
      ctx.fillStyle = '#a39a8c'; ctx.fillRect(px, py, TS, TS);
      ctx.strokeStyle = '#8c8376'; ctx.strokeRect(px + 0.5, py + 0.5, TS, TS); break;
    case T.WALL:
      ctx.fillStyle = '#5a5560'; ctx.fillRect(px, py, TS, TS);
      ctx.fillStyle = '#6c6674'; ctx.fillRect(px, py, TS, TS * 0.12);
      ctx.strokeStyle = '#44404a'; ctx.strokeRect(px + 0.5, py + 0.5, TS - 1, TS / 2); ctx.strokeRect(px + TS / 4, py + TS / 2, TS / 2, TS / 2 - 1); break;
    default:
      ctx.fillStyle = h < 0.5 ? '#3a3347' : '#352e42'; ctx.fillRect(px, py, TS, TS);
      if (h > 0.82) { ctx.fillStyle = '#524868'; ctx.fillRect(px + TS * 0.3, py + TS * 0.6, 4, 4); }
  }
}

function bar(cx, y, w, frac, col) {
  ctx.fillStyle = '#000a'; ctx.fillRect(cx - w / 2, y, w, 5);
  ctx.fillStyle = col; ctx.fillRect(cx - w / 2 + 1, y + 1, Math.max(0, (w - 2) * frac), 3);
}

function label(txt, cx, y, col) {
  ctx.font = 'bold 11px system-ui, sans-serif'; ctx.textAlign = 'center';
  ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeText(txt, cx, y);
  ctx.fillStyle = col; ctx.fillText(txt, cx, y);
}

function drawMonster(o, px, py) {
  const d = CFG.mon[o.mt], s = TS * d.size, cx = px + TS / 2, bob = Math.sin(time / 200 + o.id) * 1.5;
  const im = img('monsters/' + d.key);
  if (im) { // folha horizontal de quadros quadrados; todos os quadros viram a animação
    const cols = Math.max(1, Math.round(im.width / im.height));
    shadow(cx, py, TS * 0.3 * Math.max(1, d.size));
    const top = drawActor(im, 1, 0, cols > 1 ? Math.floor(time / 250 + o.id) % cols : 0, cols, px, py, Math.max(1, d.size));
    if (o.hp < o.mhp || me.tg === o.id) bar(cx, top - 2, TS * 0.8, o.hp / o.mhp, '#d63c3c');
    label(d.name, cx, top - 6, '#ffb3b3');
    return;
  }
  const cy = py + TS * 0.55 - (s - TS * 0.6) * 0.3 + bob;
  ctx.fillStyle = '#0005'; ctx.beginPath(); ctx.ellipse(cx, py + TS * 0.88, s * 0.4, s * 0.14, 0, 0, 7); ctx.fill();
  ctx.fillStyle = d.color; ctx.beginPath(); ctx.ellipse(cx, cy, s * 0.46, s * 0.42, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#0003'; ctx.beginPath(); ctx.ellipse(cx, cy + s * 0.2, s * 0.44, s * 0.2, 0, 0, Math.PI); ctx.fill();
  const ex = s * 0.16;
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx - ex, cy - s * 0.08, s * 0.1, 0, 7); ctx.arc(cx + ex, cy - s * 0.08, s * 0.1, 0, 7); ctx.fill();
  ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(cx - ex, cy - s * 0.06, s * 0.05, 0, 7); ctx.arc(cx + ex, cy - s * 0.06, s * 0.05, 0, 7); ctx.fill();
  if (d.size >= 1.1) { ctx.fillStyle = '#eee'; ctx.fillRect(cx - s * 0.32, cy - s * 0.5, s * 0.1, s * 0.16); ctx.fillRect(cx + s * 0.22, cy - s * 0.5, s * 0.1, s * 0.16); }
  if (o.hp < o.mhp || me.tg === o.id) bar(cx, py - 2, TS * 0.8, o.hp / o.mhp, '#d63c3c');
  label(d.name, cx, py - 6, '#ffb3b3');
}

function drawPlayer(o, px, py) {
  const cx = px + TS / 2, isMe = o.id === myId, bob = Math.sin(time / 260 + o.id) * 1;
  const im = img('player_' + o.st) || img('player');
  if (im) { // 4 linhas (baixo, esquerda, direita, cima) x N colunas (0 = parado, 1.. = andando)
    const cols = Math.max(1, Math.round(im.width / (im.height / 4)));
    const walking = performance.now() < o.mv && cols > 1;
    shadow(cx, py, TS * 0.3);
    const top = drawActor(im, 4, o.dir, walking ? 1 + Math.floor(time / 120) % (cols - 1) : 0, cols, px, py, 1);
    if (o.hp < o.mhp || isMe) bar(cx, top - 2, TS * 0.8, o.hp / o.mhp, '#3fbf5a');
    label((o.pv ? '☠ ' : '') + o.n + ' ' + o.lv, cx, top - 6, o.mk ? '#ff5050' : isMe ? '#9dffb0' : '#fff');
    return;
  }
  ctx.fillStyle = '#0005'; ctx.beginPath(); ctx.ellipse(cx, py + TS * 0.9, TS * 0.3, TS * 0.1, 0, 0, 7); ctx.fill();
  ctx.fillStyle = `hsl(${o.col},55%,${40 + o.ar * 3}%)`; ctx.fillRect(cx - TS * 0.22, py + TS * 0.42 + bob, TS * 0.44, TS * 0.42);
  if (o.ar > 0) { ctx.fillStyle = ['', '#8a5a2b', '#aab', '#dde', '#6ef'][Math.min(o.ar, 4)]; ctx.fillRect(cx - TS * 0.22, py + TS * 0.62 + bob, TS * 0.44, TS * 0.07); }
  ctx.fillStyle = '#f1c9a0'; ctx.beginPath(); ctx.arc(cx, py + TS * 0.32 + bob, TS * 0.18, 0, 7); ctx.fill();
  ctx.fillStyle = `hsl(${(o.col + 40) % 360},45%,28%)`; ctx.beginPath(); ctx.arc(cx, py + TS * 0.27 + bob, TS * 0.18, Math.PI, 0); ctx.fill();
  ctx.font = `${Math.round(TS * 0.42)}px system-ui`; ctx.textAlign = 'center';
  ctx.fillText(CFG.styles[o.st].icon, cx + TS * 0.3, py + TS * 0.68 + bob);
  if (o.hp < o.mhp || isMe) bar(cx, py - 2, TS * 0.8, o.hp / o.mhp, '#3fbf5a');
  label((o.pv ? '☠ ' : '') + o.n + ' ' + o.lv, cx, py - 6, o.mk ? '#ff5050' : isMe ? '#9dffb0' : '#fff');
}

function loop(ts) {
  const dt = Math.min(0.1, (ts - time) / 1000 || 0.016); time = ts;
  requestAnimationFrame(loop);
  if (!me) return;
  for (const o of ents.values()) {
    const k = Math.min(1, dt * (o.k === 'p' ? 16 : 12));
    o.rx += (o.x - o.rx) * k; o.ry += (o.y - o.ry) * k;
  }
  const my = ents.get(myId) || { rx: me.x, ry: me.y };
  offX = innerWidth / 2 - (my.rx + 0.5) * TS; offY = innerHeight / 2 - (my.ry + 0.5) * TS;
  ctx.fillStyle = '#0d0f14'; ctx.fillRect(0, 0, innerWidth, innerHeight);

  const x0 = Math.floor(-offX / TS) - 1, x1 = Math.ceil((innerWidth - offX) / TS) + 1;
  const y0 = Math.floor(-offY / TS) - 1, y1 = Math.ceil((innerHeight - offY) / TS) + 1;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const px = Math.round(x * TS + offX), py = Math.round(y * TS + offY);
    drawTile(tile(x, y), x, y, px, py);
  }

  // anel do alvo
  const tg = me.tg && ents.get(me.tg);
  if (tg) {
    const px = tg.rx * TS + offX, py = tg.ry * TS + offY, p = 2 + Math.sin(time / 150) * 1.5;
    ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 2; ctx.strokeRect(px + p, py + p, TS - p * 2, TS - p * 2);
  }

  const list = [...ents.values()].sort((a, b) => a.ry - b.ry);
  for (const o of list) {
    const px = o.rx * TS + offX, py = o.ry * TS + offY;
    if (o.k === 'm') drawMonster(o, px, py); else drawPlayer(o, px, py);
  }

  // efeitos (flechas, magias, golpes, explosões)
  for (let i = fxs.length - 1; i >= 0; i--) {
    const f = fxs[i], a = (time - f.t) / 260;
    if (a >= 1) { fxs.splice(i, 1); continue; }
    ctx.lineWidth = 2;
    if (f.k === 'arrow' || f.k === 'bolt') {
      const x = (f.x1 + (f.x2 - f.x1) * a + 0.5) * TS + offX, y = (f.y1 + (f.y2 - f.y1) * a + 0.5) * TS + offY;
      if (f.k === 'arrow') {
        const ang = Math.atan2(f.y2 - f.y1, f.x2 - f.x1);
        ctx.strokeStyle = '#e8d8a8'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - Math.cos(ang) * 12, y - Math.sin(ang) * 12); ctx.stroke();
      } else { ctx.fillStyle = '#b07cff'; ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.fill(); ctx.fillStyle = '#fff8'; ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill(); }
    } else if (f.k === 'slash') {
      const x = (f.x + 0.5) * TS + offX, y = (f.y + 0.5) * TS + offY;
      ctx.strokeStyle = `rgba(255,255,255,${1 - a})`; ctx.beginPath(); ctx.arc(x, y, TS * 0.4, -1 + a * 2, 0.6 + a * 2); ctx.stroke();
    } else if (f.k === 'nova') {
      const x = (f.x + 0.5) * TS + offX, y = (f.y + 0.5) * TS + offY;
      ctx.strokeStyle = f.c; ctx.globalAlpha = 1 - a; ctx.beginPath(); ctx.arc(x, y, (f.r + 0.5) * TS * a, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
    }
  }

  // números de dano
  for (let i = floats.length - 1; i >= 0; i--) {
    const f = floats[i], a = (time - f.t) / 900;
    if (a >= 1) { floats.splice(i, 1); continue; }
    const x = (f.x + 0.5) * TS + offX, y = (f.y) * TS + offY - a * 28;
    ctx.globalAlpha = 1 - a * a; ctx.font = `bold ${f.big ? 16 : 14}px system-ui`; ctx.textAlign = 'center';
    ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeText(f.txt, x, y); ctx.fillStyle = f.c; ctx.fillText(f.txt, x, y); ctx.globalAlpha = 1;
  }
}

'use strict';
// ============================================================
//  SERVIDOR: HTTP (arquivos estáticos) + WebSocket + contas/salvamento
//  Rodar:  npm install  &&  npm start   ->  http://localhost:3000
// ============================================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const D = require('./data');
const { Game, defaultRecord } = require('./game');

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, '..', 'public');
const DB_FILE = path.join(__dirname, '..', 'data', 'players.json');

// ---------- "banco de dados" em JSON (troque por SQLite/Postgres depois) ----------
let DB = {};
try { DB = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { DB = {}; }
let dirty = false;
function saveDB() {
  if (!dirty) return;
  dirty = false;
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(DB));
}
setInterval(saveDB, 15000);

const hashPass = (pass, salt) => crypto.scryptSync(pass, salt, 32).toString('hex');

// ---------- servidor de arquivos estáticos ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/') url = '/index.html';
  const file = path.normalize(path.join(PUB, url));
  if (!file.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---------- jogo + websocket ----------
const game = new Game();
setInterval(() => game.tick(), 50); // 20 ticks por segundo

const wss = new WebSocketServer({ server, maxPayload: 4096 });
const mapString = Array.from(D.tiles).join('');

wss.on('connection', (ws) => {
  let p = null;

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;

    if (!p) {
      if (m.t !== 'login') return;
      const name = String(m.name || '').trim();
      const pass = String(m.pass || '');
      if (!/^[A-Za-z0-9_]{3,14}$/.test(name)) return ws.send(JSON.stringify({ t: 'err', m: 'Nome: 3 a 14 letras, números ou _' }));
      if (pass.length < 3 || pass.length > 40) return ws.send(JSON.stringify({ t: 'err', m: 'Senha: 3 a 40 caracteres' }));
      const key = name.toLowerCase();
      let rec = DB[key];
      if (rec) {
        const ok = crypto.timingSafeEqual(Buffer.from(hashPass(pass, rec.salt)), Buffer.from(rec.hash));
        if (!ok) return ws.send(JSON.stringify({ t: 'err', m: 'Senha incorreta.' }));
      } else {
        const salt = crypto.randomBytes(16).toString('hex');
        rec = { ...defaultRecord(name), salt, hash: hashPass(pass, salt) };
        DB[key] = rec; dirty = true;
      }
      for (const q of game.players.values()) {
        if (q.name.toLowerCase() === key) return ws.send(JSON.stringify({ t: 'err', m: 'Esta conta já está online.' }));
      }
      p = game.createPlayer(rec, ws);
      ws.send(JSON.stringify({ t: 'w', id: p.id, W: D.W, H: D.H, map: mapString, cfg: D.publicConfig() }));
      game.sys(p, `Bem-vindo a Aethelgard, ${p.name}! Clique em um monstro para atacar.`);
      return;
    }
    game.handle(p, m);
  });

  ws.on('close', () => {
    if (!p) return;
    const key = p.name.toLowerCase();
    if (DB[key]) { DB[key] = { ...DB[key], ...game.serialize(p) }; dirty = true; }
    game.removePlayer(p);
    saveDB();
  });
  ws.on('error', () => {});
});

function shutdown() {
  for (const p of game.players.values()) {
    const key = p.name.toLowerCase();
    if (DB[key]) DB[key] = { ...DB[key], ...game.serialize(p) };
  }
  dirty = true; saveDB();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// salva progresso dos jogadores online periodicamente
setInterval(() => {
  for (const p of game.players.values()) {
    const key = p.name.toLowerCase();
    if (DB[key]) { DB[key] = { ...DB[key], ...game.serialize(p) }; dirty = true; }
  }
}, 10000);

server.listen(PORT, () => console.log(`Aethelgard Online rodando em http://localhost:${PORT}`));

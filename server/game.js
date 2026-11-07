'use strict';
// ============================================================
//  LÓGICA DO JOGO (servidor autoritativo)
//  O cliente só envia intenções (andar, alvo, estilo...).
//  O servidor decide tudo: movimento, dano, XP, loot.
// ============================================================
const D = require('./data');
const { W, H, CX, CY, MONSTERS, WEAPONS, ARMORS, STYLES, PRICES, walkable, inTown } = D;

const rnd = (a, b) => a + Math.random() * (b - a);
const ri = (a, b) => Math.floor(rnd(a, b + 1));
const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const xpNeed = (l) => Math.floor(40 * Math.pow(l, 1.7));
const skillNeed = (l) => Math.floor(25 * Math.pow(l, 1.5));

const SPECIAL_MP = 12, SPECIAL_CD = 3500;
const MOVE_DELAY = 170;           // ms por passo do jogador
const VIEW_X = 16, VIEW_Y = 11;   // área enviada a cada jogador

function defaultRecord(name) {
  const sk = () => ({ lvl: 1, xp: 0 });
  return {
    name, level: 1, xp: 0, gold: 50, style: 'sword',
    wp: { sword: 0, bow: 0, staff: 0 }, armor: 0,
    skills: { sword: sk(), bow: sk(), magic: sk(), def: sk() },
    pots: { hp: 3, mp: 2 }, col: ri(0, 359),
  };
}

class Game {
  constructor() {
    this.players = new Map();
    this.monsters = new Map();
    this.nextId = 1;
    this.ev = [];
    this.n = 0;
    for (const def of MONSTERS) {
      for (let i = 0; i < def.count; i++) {
        const sp = this.randomSpawn(def.minD, def.maxD);
        if (!sp) continue;
        const id = this.nextId++;
        this.monsters.set(id, {
          id, k: 'm', def, mt: MONSTERS.indexOf(def), x: sp.x, y: sp.y, sx: sp.x, sy: sp.y,
          hp: def.hp, mhp: def.hp, target: 0, nextMove: 0, nextAtk: 0, dead: false, respawnAt: 0,
        });
      }
    }
  }

  // ---------------- utilidades ----------------
  occupied(x, y) {
    for (const m of this.monsters.values()) if (!m.dead && m.x === x && m.y === y) return true;
    for (const p of this.players.values()) if (p.x === x && p.y === y) return true;
    return false;
  }

  randomSpawn(minD, maxD) {
    for (let i = 0; i < 300; i++) {
      const x = ri(2, W - 3), y = ri(2, H - 3);
      const d = Math.hypot(x - CX, y - CY);
      if (d < minD || d > maxD) continue;
      if (!walkable(x, y) || inTown(x, y) || this.occupied(x, y)) continue;
      return { x, y };
    }
    return null;
  }

  place(p) {
    for (let i = 0; i < 50; i++) {
      const x = CX + ri(-3, 3), y = CY + ri(-3, 3);
      if (walkable(x, y) && !this.occupied(x, y)) { p.x = x; p.y = y; return; }
    }
    p.x = CX; p.y = CY;
  }

  send(p, msg) { if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(msg)); }
  sys(p, m) { this.send(p, { t: 'sys', m }); }
  recalc(p) { p.mhp = 80 + p.level * 12; p.mmp = 40 + p.level * 6; }

  // ---------------- jogadores ----------------
  createPlayer(rec, ws) {
    rec = Object.assign(defaultRecord(rec.name), rec);
    const p = {
      id: this.nextId++, k: 'p', ws, name: rec.name, level: rec.level, xp: rec.xp, gold: rec.gold,
      style: rec.style, wp: { ...rec.wp }, armor: rec.armor, skills: JSON.parse(JSON.stringify(rec.skills)),
      pots: { ...rec.pots }, col: rec.col,
      x: CX, y: CY, dx: 0, dy: 0, target: 0, pvp: false, mark: 0,
      nextMove: 0, nextAtk: 0, nextSp: 0, nextPot: 0, nextRegen: 0, nextChat: 0,
    };
    this.recalc(p);
    p.hp = p.mhp; p.mp = p.mmp;
    this.place(p);
    this.players.set(p.id, p);
    return p;
  }

  serialize(p) {
    return {
      name: p.name, level: p.level, xp: p.xp, gold: p.gold, style: p.style, wp: p.wp,
      armor: p.armor, skills: p.skills, pots: p.pots, col: p.col,
    };
  }

  removePlayer(p) { this.players.delete(p.id); }

  // ---------------- mensagens do cliente ----------------
  handle(p, m) {
    const t = Date.now();
    switch (m.t) {
      case 'mv': {
        let dx = Math.sign(m.dx | 0), dy = Math.sign(m.dy | 0);
        if (dx && dy) dy = 0;
        p.dx = dx; p.dy = dy;
        break;
      }
      case 'tg': {
        const id = m.id | 0;
        const e = this.monsters.get(id) || this.players.get(id);
        p.target = e && e !== p ? id : 0;
        break;
      }
      case 'st':
        if (STYLES[m.s] && m.s !== p.style) { p.style = m.s; p.nextAtk = Math.max(p.nextAtk, t + 300); }
        break;
      case 'sp': this.special(p, t); break;
      case 'pot': this.potion(p, m.kind, t); break;
      case 'buy': this.buy(p, m); break;
      case 'pvp':
        p.pvp = !!m.on;
        this.sys(p, p.pvp ? 'Modo PvP ATIVADO: você pode atacar outros jogadores fora da vila.' : 'Modo PvP desativado.');
        break;
      case 'chat': {
        if (t < p.nextChat) return;
        const text = String(m.m || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 100);
        if (!text) return;
        p.nextChat = t + 800;
        const msg = { t: 'chat', n: p.name, m: text, mk: p.mark > t ? 1 : 0 };
        for (const q of this.players.values()) this.send(q, msg);
        break;
      }
    }
  }

  buy(p, m) {
    if (!inTown(p.x, p.y)) return this.sys(p, 'Vá até a vila para comprar.');
    if (m.kind === 'weapon') {
      const arr = WEAPONS[m.style], i = m.tier | 0;
      if (!arr || !arr[i]) return;
      if (i <= p.wp[m.style]) return this.sys(p, 'Você já possui este item (ou um melhor).');
      if (p.gold < arr[i].price) return this.sys(p, 'Ouro insuficiente.');
      p.gold -= arr[i].price; p.wp[m.style] = i;
      this.sys(p, `Você comprou: ${arr[i].n}`);
    } else if (m.kind === 'armor') {
      const i = m.tier | 0;
      if (!ARMORS[i]) return;
      if (i <= p.armor) return this.sys(p, 'Você já possui esta armadura (ou melhor).');
      if (p.gold < ARMORS[i].price) return this.sys(p, 'Ouro insuficiente.');
      p.gold -= ARMORS[i].price; p.armor = i;
      this.sys(p, `Você comprou: ${ARMORS[i].n}`);
    } else if (m.kind === 'hp' || m.kind === 'mp') {
      if (p.pots[m.kind] >= 99) return this.sys(p, 'Limite de 99 poções.');
      if (p.gold < PRICES[m.kind]) return this.sys(p, 'Ouro insuficiente.');
      p.gold -= PRICES[m.kind]; p.pots[m.kind]++;
    }
  }

  potion(p, kind, t) {
    if (t < p.nextPot || (kind !== 'hp' && kind !== 'mp')) return;
    if (p.pots[kind] <= 0) return this.sys(p, 'Você não tem essa poção. Compre na vila!');
    p.pots[kind]--; p.nextPot = t + 700;
    if (kind === 'hp') p.hp = Math.min(p.mhp, p.hp + Math.max(80, Math.round(p.mhp * 0.4)));
    else p.mp = Math.min(p.mmp, p.mp + Math.round(p.mmp * 0.5));
    this.ev.push({ k: 'heal', x: p.x, y: p.y, c: kind });
  }

  // ---------------- progressão ----------------
  gainXp(p, xp) {
    p.xp += xp;
    while (p.xp >= xpNeed(p.level)) {
      p.xp -= xpNeed(p.level);
      p.level++;
      this.recalc(p);
      p.hp = p.mhp; p.mp = p.mmp;
      this.ev.push({ k: 'lvl', x: p.x, y: p.y });
      this.sys(p, `Você subiu para o nível ${p.level}!`);
    }
  }

  train(p, skill, pts) {
    const s = p.skills[skill];
    s.xp += pts;
    while (s.xp >= skillNeed(s.lvl)) {
      s.xp -= skillNeed(s.lvl);
      s.lvl++;
      this.sys(p, `Habilidade ${skillLabel(skill)} subiu para ${s.lvl}!`);
    }
  }

  // ---------------- combate ----------------
  rollDmg(p) {
    const st = STYLES[p.style];
    const w = WEAPONS[p.style][p.wp[p.style]];
    let v = w.atk * (0.6 + Math.random() * 0.4) + p.skills[st.skill].lvl * 0.9 + p.level * 0.3;
    v *= st.mult;
    const crit = Math.random() < 0.08;
    if (crit) v *= 1.5;
    return { v: Math.max(1, Math.round(v)), crit };
  }

  getTarget(p) {
    if (!p.target) return null;
    const e = this.monsters.get(p.target) || this.players.get(p.target);
    if (!e || e.dead || e === p || cheb(p, e) > 12 || inTown(e.x, e.y)) { p.target = 0; return null; }
    return e;
  }

  enemiesNear(p, cx, cy, r) {
    const out = [];
    const near = (e) => Math.max(Math.abs(e.x - cx), Math.abs(e.y - cy)) <= r;
    for (const m of this.monsters.values()) if (!m.dead && near(m)) out.push(m);
    if (p.pvp) for (const q of this.players.values()) if (q !== p && !inTown(q.x, q.y) && near(q)) out.push(q);
    return out;
  }

  // aplica dano de um jogador em um alvo (monstro ou jogador)
  hit(p, e, v, crit) {
    if (e.k === 'm') {
      e.hp -= v;
      if (!e.target) e.target = p.id;
      this.ev.push({ k: 'dmg', x: e.x, y: e.y, v, c: 'm', cr: crit ? 1 : 0 });
      if (e.hp <= 0) this.killMonster(e, p);
    } else {
      if (!(e.mark > Date.now())) p.mark = Date.now() + 60000; // atacou inocente => marcado
      this.hurtPlayer(e, v, p);
    }
  }

  attack(p, e, t) {
    const st = STYLES[p.style];
    if (st.mp && p.mp < st.mp) { p.nextAtk = t + 1000; return this.sys(p, 'Sem mana! Use uma poção (E) ou descanse.'); }
    p.mp -= st.mp;
    const d = this.rollDmg(p);
    if (p.style === 'sword') this.ev.push({ k: 'slash', x: e.x, y: e.y });
    else this.ev.push({ k: p.style === 'bow' ? 'arrow' : 'bolt', x1: p.x, y1: p.y, x2: e.x, y2: e.y });
    this.hit(p, e, d.v, d.crit);
    this.train(p, st.skill, 1);
    p.nextAtk = t + st.speed;
  }

  special(p, t) {
    if (inTown(p.x, p.y)) return this.sys(p, 'Ataques não são permitidos na vila.');
    if (t < p.nextSp) return;
    if (p.mp < SPECIAL_MP) return this.sys(p, `Mana insuficiente (${SPECIAL_MP}).`);
    const st = STYLES[p.style], tg = this.getTarget(p);
    let targets = [], mult = 1, fx = [];
    if (p.style === 'sword') {
      targets = this.enemiesNear(p, p.x, p.y, 1); mult = 1.3;
      fx.push({ k: 'nova', x: p.x, y: p.y, r: 1, c: '#ffffff' });
    } else if (p.style === 'bow') {
      targets = this.enemiesNear(p, p.x, p.y, st.range)
        .sort((a, b) => (a === tg ? -1 : b === tg ? 1 : cheb(p, a) - cheb(p, b))).slice(0, 5);
      for (const e of targets) fx.push({ k: 'arrow', x1: p.x, y1: p.y, x2: e.x, y2: e.y });
    } else {
      const c = tg && cheb(p, tg) <= st.range ? tg : p;
      targets = this.enemiesNear(p, c.x, c.y, 2);
      fx.push({ k: 'nova', x: c.x, y: c.y, r: 2, c: '#b07cff' });
    }
    if (!targets.length) return this.sys(p, 'Nenhum alvo ao alcance.');
    p.mp -= SPECIAL_MP; p.nextSp = t + SPECIAL_CD;
    this.ev.push(...fx);
    for (const e of targets) {
      const d = this.rollDmg(p);
      this.hit(p, e, Math.max(1, Math.round(d.v * mult)), d.crit);
    }
    this.train(p, st.skill, 2);
  }

  killMonster(m, killer) {
    m.dead = true;
    m.respawnAt = Date.now() + (m.def.respawn || 10000);
    m.target = 0;
    const gold = ri(m.def.gold[0], m.def.gold[1]);
    killer.gold += gold;
    this.gainXp(killer, m.def.xp);
    let extra = '';
    if (Math.random() < 0.12) { killer.pots.hp = Math.min(99, killer.pots.hp + 1); extra = ' + poção de vida'; }
    else if (Math.random() < 0.08) { killer.pots.mp = Math.min(99, killer.pots.mp + 1); extra = ' + poção de mana'; }
    this.sys(killer, `${m.def.name} derrotado: +${m.def.xp} XP, +${gold} ouro${extra}`);
    for (const p of this.players.values()) if (p.target === m.id) p.target = 0;
  }

  hurtPlayer(p, raw, src) {
    if (inTown(p.x, p.y)) return;
    const mit = ARMORS[p.armor].def + p.skills.def.lvl * 0.35;
    const v = Math.max(1, Math.round(raw - mit * (0.5 + Math.random() * 0.5)));
    p.hp -= v;
    this.ev.push({ k: 'dmg', x: p.x, y: p.y, v, c: 'p' });
    this.train(p, 'def', 1);
    if (p.hp <= 0) this.die(p, src);
  }

  die(p, src) {
    const t = Date.now();
    const lose = Math.floor(p.gold * 0.05);
    p.gold -= lose;
    if (src && src.k === 'p') {
      src.gold += lose;
      if (!(p.mark > t)) src.mark = Math.max(src.mark, t + 120000); // matou inocente => marcado por 2 min
      this.sys(src, `Você derrotou ${p.name}${lose ? ` e pegou ${lose} ouro` : ''}.`);
    }
    p.hp = p.mhp; p.mp = p.mmp; p.target = 0; p.dx = p.dy = 0;
    this.place(p);
    this.sys(p, `Você morreu${lose ? ` e perdeu ${lose} ouro` : ''}. Voltou para a vila.`);
  }

  // ---------------- loop ----------------
  tick() {
    const t = Date.now();
    for (const m of this.monsters.values()) this.tickMonster(m, t);
    for (const p of this.players.values()) this.tickPlayer(p, t);
    if (++this.n % 2 === 0) this.broadcast(t);
  }

  tickPlayer(p, t) {
    if ((p.dx || p.dy) && t >= p.nextMove) {
      const nx = p.x + p.dx, ny = p.y + p.dy;
      if (walkable(nx, ny) && !this.occupied(nx, ny)) { p.x = nx; p.y = ny; }
      p.nextMove = t + MOVE_DELAY;
    }
    const tg = this.getTarget(p);
    if (tg && !inTown(p.x, p.y)) {
      if (tg.k === 'p' && !p.pvp) { p.target = 0; this.sys(p, 'Ative o modo PvP (☠) para atacar jogadores.'); }
      else if (t >= p.nextAtk && cheb(p, tg) <= STYLES[p.style].range) this.attack(p, tg, t);
    }
    if (t >= p.nextRegen) {
      p.nextRegen = t + 2000;
      const town = inTown(p.x, p.y);
      p.hp = Math.min(p.mhp, p.hp + Math.ceil(p.mhp * (town ? 0.08 : 0.01)));
      p.mp = Math.min(p.mmp, p.mp + 2 + Math.floor(p.level / 10) + (town ? 4 : 0));
    }
  }

  stepDir(m, dx, dy) {
    if (!dx && !dy) return false;
    const nx = m.x + dx, ny = m.y + dy;
    if (!walkable(nx, ny) || inTown(nx, ny) || this.occupied(nx, ny)) return false;
    m.x = nx; m.y = ny;
    return true;
  }

  stepToward(m, tx, ty) {
    const dx = Math.sign(tx - m.x), dy = Math.sign(ty - m.y);
    const horizFirst = Math.abs(tx - m.x) >= Math.abs(ty - m.y);
    if (horizFirst) { if (!this.stepDir(m, dx, 0)) this.stepDir(m, 0, dy); }
    else if (!this.stepDir(m, 0, dy)) this.stepDir(m, dx, 0);
  }

  tickMonster(m, t) {
    if (m.dead) {
      if (t >= m.respawnAt) {
        const sp = this.randomSpawn(m.def.minD, m.def.maxD) || { x: m.sx, y: m.sy };
        m.x = m.sx = sp.x; m.y = m.sy = sp.y; m.hp = m.mhp; m.dead = false; m.target = 0;
      }
      return;
    }
    if (t < m.nextMove) return;
    let tg = m.target ? this.players.get(m.target) : null;
    if (tg && (inTown(tg.x, tg.y) || cheb(m, tg) > m.def.aggro * 2 + 4)) { tg = null; m.target = 0; }
    if (!tg) {
      let best = null, bd = 1e9;
      for (const p of this.players.values()) {
        if (inTown(p.x, p.y)) continue;
        const d = cheb(m, p);
        if (d <= m.def.aggro && d < bd) { best = p; bd = d; }
      }
      if (best) { tg = best; m.target = best.id; }
    }
    if (tg) {
      if (cheb(m, tg) <= 1) {
        if (t >= m.nextAtk) {
          m.nextAtk = t + m.def.as;
          this.hurtPlayer(tg, ri(Math.ceil(m.def.atk * 0.5), m.def.atk), m);
        }
        m.nextMove = t + 100;
      } else {
        this.stepToward(m, tg.x, tg.y);
        m.nextMove = t + m.def.mv;
      }
    } else {
      if (cheb(m, { x: m.sx, y: m.sy }) > 8) this.stepToward(m, m.sx, m.sy);
      else if (Math.random() < 0.35) {
        const r = Math.random();
        this.stepDir(m, r < 0.25 ? 1 : r < 0.5 ? -1 : 0, r >= 0.5 && r < 0.75 ? 1 : r >= 0.75 ? -1 : 0);
      }
      m.nextMove = t + rnd(900, 1800);
    }
  }

  // ---------------- rede: estado enviado aos clientes (10x por segundo) ----------------
  broadcast(t) {
    for (const p of this.players.values()) {
      if (!p.ws || p.ws.readyState !== 1) continue;
      const vis = (e) => Math.abs(e.x - p.x) <= VIEW_X && Math.abs(e.y - p.y) <= VIEW_Y;
      const list = [];
      for (const m of this.monsters.values()) {
        if (!m.dead && vis(m)) list.push({ id: m.id, k: 'm', mt: m.mt, x: m.x, y: m.y, hp: m.hp, mhp: m.mhp });
      }
      for (const q of this.players.values()) {
        if (vis(q)) list.push({
          id: q.id, k: 'p', n: q.name, x: q.x, y: q.y, hp: q.hp, mhp: q.mhp, lv: q.level,
          st: q.style, col: q.col, mk: q.mark > t ? 1 : 0, pv: q.pvp ? 1 : 0, ar: q.armor,
        });
      }
      const ev = this.ev.filter((e) => {
        const ex = e.x !== undefined ? e.x : e.x1, ey = e.y !== undefined ? e.y : e.y1;
        return Math.abs(ex - p.x) <= VIEW_X + 2 && Math.abs(ey - p.y) <= VIEW_Y + 2;
      });
      this.send(p, { t: 's', e: list, ev, me: this.meOf(p, t) });
    }
    this.ev = [];
  }

  meOf(p, t) {
    const sk = {};
    for (const k of Object.keys(p.skills)) sk[k] = [p.skills[k].lvl, p.skills[k].xp, skillNeed(p.skills[k].lvl)];
    return {
      x: p.x, y: p.y, hp: p.hp, mhp: p.mhp, mp: p.mp, mmp: p.mmp, lv: p.level, xp: p.xp, xpn: xpNeed(p.level),
      gold: p.gold, st: p.style, wp: p.wp, ar: p.armor, pots: p.pots, sk, tg: p.target,
      cd: Math.max(0, p.nextSp - t), pv: p.pvp ? 1 : 0, mk: Math.max(0, p.mark - t),
      town: inTown(p.x, p.y) ? 1 : 0,
    };
  }
}

function skillLabel(k) {
  return { sword: 'Espada', bow: 'Arco', magic: 'Magia', def: 'Defesa' }[k] || k;
}

module.exports = { Game, defaultRecord };

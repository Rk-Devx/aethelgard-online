'use strict';
// ============================================================
//  DADOS DO MUNDO: mapa, monstros, armas, armaduras, estilos
//  Mexa aqui para balancear o jogo e criar conteúdo novo.
// ============================================================

const W = 80, H = 80, CX = 40, CY = 40, TOWN_R = 7;
const T = { GRASS: 0, WATER: 1, TREE: 2, SAND: 3, TOWN: 4, WALL: 5, DARK: 6 };
const BLOCKED = new Set([T.WATER, T.TREE, T.WALL]);

// ---------- gerador de mapa procedural (determinístico) ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function valueNoise(seed, scale) {
  const r = mulberry32(seed);
  const gw = Math.ceil(W / scale) + 2, gh = Math.ceil(H / scale) + 2;
  const g = Array.from({ length: gh }, () => Array.from({ length: gw }, () => r()));
  const sm = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const gx = x / scale, gy = y / scale;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const fx = sm(gx - x0), fy = sm(gy - y0);
    const a = g[y0][x0], b = g[y0][x0 + 1], c = g[y0 + 1][x0], d = g[y0 + 1][x0 + 1];
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
  };
}

function generateMap(seed) {
  const n1 = valueNoise(seed, 9), n2 = valueNoise(seed + 7, 4);
  const r = mulberry32(seed + 99);
  const tiles = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - CX, y - CY);
      let t;
      if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) t = T.WATER;
      else {
        t = d < 30 ? T.GRASS : d < 40 ? T.SAND : T.DARK;
        if (d > TOWN_R + 6) {
          if (n1(x, y) > 0.74) t = T.WATER;
          else if (n2(x, y) > 0.66 && r() < 0.6) t = T.TREE;
        }
      }
      tiles[y * W + x] = t;
    }
  }
  // vila central murada, com 4 portões
  for (let y = CY - TOWN_R; y <= CY + TOWN_R; y++) {
    for (let x = CX - TOWN_R; x <= CX + TOWN_R; x++) {
      const edge = Math.abs(x - CX) === TOWN_R || Math.abs(y - CY) === TOWN_R;
      const gate = Math.abs(x - CX) <= 1 || Math.abs(y - CY) <= 1;
      tiles[y * W + x] = edge && !gate ? T.WALL : T.TOWN;
    }
  }
  return tiles;
}

const tiles = generateMap(1337);
const inBounds = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
const walkable = (x, y) => inBounds(x, y) && !BLOCKED.has(tiles[y * W + x]);
const inTown = (x, y) => Math.abs(x - CX) <= TOWN_R && Math.abs(y - CY) <= TOWN_R; // zona segura

// ---------- monstros (do mais fácil ao mais difícil, em anéis a partir da vila) ----------
// minD/maxD = distância da vila onde nascem | mv = ms entre passos | as = ms entre ataques
const MONSTERS = [
  { key: 'slime',    name: 'Gosma',      hp: 18,   atk: 3,  xp: 8,   gold: [2, 6],     minD: 9,  maxD: 18, count: 14, color: '#6fcf5a', size: 0.7,  aggro: 3, mv: 650, as: 1400 },
  { key: 'rat',      name: 'Rato Gigante', hp: 30, atk: 5,  xp: 14,  gold: [4, 10],    minD: 12, maxD: 22, count: 14, color: '#9a8a7a', size: 0.6,  aggro: 4, mv: 500, as: 1200 },
  { key: 'wolf',     name: 'Lobo Cinzento', hp: 60, atk: 9, xp: 30,  gold: [8, 18],    minD: 20, maxD: 30, count: 12, color: '#8d94a0', size: 0.85, aggro: 5, mv: 420, as: 1100 },
  { key: 'goblin',   name: 'Goblin',     hp: 110,  atk: 15, xp: 60,  gold: [16, 36],   minD: 24, maxD: 34, count: 12, color: '#4fa86a', size: 0.85, aggro: 5, mv: 500, as: 1100 },
  { key: 'scorpion', name: 'Escorpião',  hp: 180,  atk: 22, xp: 100, gold: [28, 60],   minD: 30, maxD: 40, count: 10, color: '#c9722f', size: 0.8,  aggro: 5, mv: 480, as: 1000 },
  { key: 'skeleton', name: 'Esqueleto',  hp: 300,  atk: 32, xp: 170, gold: [50, 100],  minD: 34, maxD: 46, count: 10, color: '#e8e4d0', size: 0.9,  aggro: 6, mv: 520, as: 1000 },
  { key: 'ogre',     name: 'Ogro',       hp: 550,  atk: 48, xp: 320, gold: [100, 200], minD: 42, maxD: 60, count: 8,  color: '#a0603a', size: 1.15, aggro: 6, mv: 600, as: 1200 },
  { key: 'drake',    name: 'Draco Menor', hp: 1300, atk: 85, xp: 900, gold: [400, 800], minD: 50, maxD: 60, count: 3,  color: '#c0392b', size: 1.5,  aggro: 7, mv: 550, as: 1300, respawn: 40000 },
];

// ---------- estilos de combate (troque de arma = troque de estilo, a qualquer hora) ----------
const STYLES = {
  sword: { n: 'Espada', range: 1, speed: 850,  mp: 0, skill: 'sword', mult: 1.0,  icon: '⚔️', special: 'Giro (atinge todos ao redor)' },
  bow:   { n: 'Arco',   range: 5, speed: 1050, mp: 0, skill: 'bow',   mult: 1.0,  icon: '🏹', special: 'Chuva de Flechas (até 5 alvos)' },
  staff: { n: 'Cajado', range: 4, speed: 1200, mp: 2, skill: 'magic', mult: 1.35, icon: '🔮', special: 'Nova Arcana (explosão em área)' },
};

const WEAPONS = {
  sword: [
    { n: 'Espada de Madeira', atk: 4,  price: 0 },
    { n: 'Espada de Ferro',   atk: 12, price: 300 },
    { n: 'Espada de Aço',     atk: 28, price: 1500 },
    { n: 'Lâmina Rúnica',     atk: 55, price: 7000 },
  ],
  bow: [
    { n: 'Arco Curto',     atk: 4,  price: 0 },
    { n: 'Arco Longo',     atk: 12, price: 300 },
    { n: 'Arco Composto',  atk: 28, price: 1500 },
    { n: 'Arco Élfico',    atk: 55, price: 7000 },
  ],
  staff: [
    { n: 'Cajado de Galho',   atk: 4,  price: 0 },
    { n: 'Cajado de Cristal', atk: 12, price: 300 },
    { n: 'Cajado Arcano',     atk: 28, price: 1500 },
    { n: 'Cajado Estelar',    atk: 55, price: 7000 },
  ],
};

const ARMORS = [
  { n: 'Túnica de Pano',     def: 0,  price: 0 },
  { n: 'Armadura de Couro',  def: 3,  price: 250 },
  { n: 'Cota de Malha',      def: 8,  price: 1300 },
  { n: 'Armadura de Placas', def: 16, price: 6500 },
  { n: 'Armadura Rúnica',    def: 28, price: 25000 },
];

const PRICES = { hp: 40, mp: 30 };

// configuração enviada ao cliente (somente dados visuais/loja)
function publicConfig() {
  return {
    weapons: WEAPONS, armors: ARMORS, styles: STYLES, prices: PRICES,
    mon: MONSTERS.map((m) => ({ key: m.key, name: m.name, color: m.color, size: m.size })),
  };
}

module.exports = {
  W, H, CX, CY, TOWN_R, T, tiles, walkable, inTown,
  MONSTERS, STYLES, WEAPONS, ARMORS, PRICES, publicConfig,
};

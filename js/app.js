import { encodeGIF } from './gif-encoder.js';
import { PhotoEditor, FILTERS } from './photo.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'gif-sticker:v1';

// ---------- 定義 ----------
const FONTS = [
  ['Dela Gothic One', 400, 'デラゴシ'],
  ['Mochiy Pop One', 400, 'もちポップ'],
  ['M PLUS Rounded 1c', 800, 'まるゴシ'],
  ['Rampart One', 400, 'たちたい'],
  ['Reggae One', 400, 'レゲエ'],
  ['RocknRoll One', 400, 'ロックン'],
  ['Hachi Maru Pop', 400, 'はちまる'],
  ['Yusei Magic', 400, 'マジック'],
  ['Kaisei Decol', 700, '明朝'],
  ['DotGothic16', 400, 'ドット'],
];
const MOTIONS = [
  ['none', 'なし'], ['bounce', 'ぴょんぴょん'], ['hop', 'ぴょこぴょこ'], ['wave', 'ウェーブ'],
  ['shake', 'ぶるぶる'], ['pulse', 'どくどく'], ['jelly', 'ぷるぷる'], ['float', 'ふわふわ'],
  ['swing', 'ゆらゆら'], ['spin', 'くるくる'], ['flip', 'ぺらぺら'], ['zoom', 'ドーン'], ['typing', 'タイピング'],
];
const COLOR_FX = [['solid', '単色'], ['gradient', 'グラデ'], ['rainbow', '🌈 虹色'], ['blink', '⚡ チカチカ']];
const STYLES = [
  ['ピンク', { fill: '#ffffff', stroke: '#ff4f8b', outer: '#ffffff', fill2: '#ffd1e3' }],
  ['元気', { fill: '#ffe14d', stroke: '#ff5a1f', outer: '#ffffff', fill2: '#ff9d2e' }],
  ['さわやか', { fill: '#ffffff', stroke: '#1f9dff', outer: '#ffffff', fill2: '#a6ecff' }],
  ['ネオン', { fill: '#ffffff', stroke: '#b14dff', outer: '#19e6ff', fill2: '#ff4df0' }],
  ['黒ふち', { fill: '#ffffff', stroke: '#111111', outer: '#ffffff', fill2: '#dddddd' }],
  ['和', { fill: '#c8102e', stroke: '#ffffff', outer: '#1a1a1a', fill2: '#7a0718' }],
  ['ゆる', { fill: '#7a5230', stroke: '#fff3d6', outer: '#7a5230', fill2: '#b07a4a' }],
];
const PHRASES = ['了解！', 'ありがとう', 'おつかれさま', 'おはよう', 'おやすみ', 'よろしく\nお願いします', '草', 'えらい！', '神', '🎉おめでとう', 'ｗｗｗ', 'むり…'];
const SIZES = [[128, '128'], [240, '240'], [320, '320'], [480, '480']];
const FPS = [[10, '軽い'], [15, 'ふつう'], [20, 'なめらか'], [25, 'ぬるぬる']];
const BGS = [['transparent', '透明'], ['color', '色つき']];
const TEXT_POS = [['bottom', '下'], ['top', '上'], ['center', '重ねる']];
const TOOLS = [['wand', '👆 タップで消す'], ['erase', '🧽 消しゴム'], ['restore', '🖌 復元']];
const TOOL_HINTS = {
  wand: '消したい背景をタップすると、つながった似た色の部分が消えます。',
  erase: '指やマウスでなぞった部分を消します。',
  restore: 'なぞった部分を元に戻します。',
};
// 動きごとに、はみ出さないよう中身を少し小さくする
const MOTION_SHRINK = { bounce: 0.84, pulse: 0.86, jelly: 0.9, zoom: 0.9, shake: 0.9, float: 0.9, swing: 0.88, hop: 0.88, wave: 0.9 };

const DEFAULTS = {
  text: '了解！', font: 'Dela Gothic One', motion: 'bounce', dur: 1,
  colorFx: 'solid', fill: '#ffffff', fill2: '#ffd1e3', stroke: '#ff4f8b', outer: '#ffffff',
  strokeW: 0.12, outer2: true, shadow: false,
  size: 320, fps: 20, bg: 'transparent', bgColor: '#ffffff',
  filter: 'none', border: 10, borderColor: '#ffffff', photoScale: 1, textPos: 'bottom',
};

let S = { ...DEFAULTS };
try { Object.assign(S, JSON.parse(localStorage.getItem(STORE_KEY) || '{}')); } catch {}
const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch {} };

// ---------- 描画 ----------
const LH = 1.2;
const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('ja', { granularity: 'grapheme' }) : null;
const graphemes = (s) => seg ? [...seg.segment(s)].map((x) => x.segment) : Array.from(s);
const fontWeight = () => (FONTS.find((f) => f[0] === S.font) || FONTS[0])[1];
const fontStr = (px) => `${fontWeight()} ${px}px "${S.font}", sans-serif`;

let layout = null;
const photo = new PhotoEditor($('photoEdit'), () => { layout = null; });
Object.assign(photo.fx, { filter: S.filter, border: S.border, borderColor: S.borderColor });

function strokeExtra() { return S.strokeW + (S.outer2 ? 0.08 : 0) + (S.shadow ? 0.04 : 0); }

function computeLayout(ctx) {
  const W = S.size;
  const hasText = S.text.trim().length > 0;
  const art = photo.art;
  const k = MOTION_SHRINK[S.motion] || 1;
  const area = (cx, cy, w, h) => ({ cx: cx * W, cy: cy * W, w: w * W * k, h: h * W * k });

  let tA = null, pA = null;
  if (art && hasText) {
    if (S.textPos === 'center') { pA = area(0.5, 0.5, 0.9, 0.9); tA = area(0.5, 0.5, 0.92, 0.45); }
    else if (S.textPos === 'top') { pA = area(0.5, 0.57, 0.86, 0.76); tA = area(0.5, 0.18, 0.94, 0.3); }
    else { pA = area(0.5, 0.43, 0.86, 0.76); tA = area(0.5, 0.82, 0.94, 0.3); }
  } else if (art) pA = area(0.5, 0.5, 0.9, 0.9);
  else tA = area(0.5, 0.5, 0.88, 0.88);

  const L = { W, lines: [], fs: 0, photoRect: null, bounds: null };
  const rects = [];

  if (pA) {
    const s = Math.min(pA.w / art.width, pA.h / art.height) * S.photoScale;
    const w = art.width * s, h = art.height * s;
    L.photoRect = { x: pA.cx - w / 2, y: pA.cy - h / 2, w, h };
    rects.push(L.photoRect);
  }
  if (tA && hasText) {
    ctx.font = fontStr(100);
    const lines = S.text.replace(/\r/g, '').split('\n').map((l) => graphemes(l).map((g) => ({ g, w: ctx.measureText(g).width })));
    const maxW = Math.max(1, ...lines.map((l) => l.reduce((a, c) => a + c.w, 0)));
    const ex = strokeExtra() * 2;
    const perCharRoom = ['wave', 'hop'].includes(S.motion) ? 0.35 : 0;
    const fs = Math.min(tA.w / (maxW / 100 + ex), tA.h / (lines.length * LH + ex + perCharRoom), W * 0.7);
    let idx = 0;
    L.fs = fs;
    L.lines = lines.map((l, li) => {
      const lw = l.reduce((a, c) => a + c.w, 0) * fs / 100;
      let x = tA.cx - lw / 2;
      const y = tA.cy + (li - (lines.length - 1) / 2) * LH * fs;
      return l.map((c) => {
        const cw = c.w * fs / 100;
        const o = { g: c.g, x: x + cw / 2, y, i: idx++ };
        x += cw;
        return o;
      });
    });
    L.count = idx;
    const tw = maxW * fs / 100 + ex * fs, th = lines.length * LH * fs + ex * fs;
    L.textRect = { x: tA.cx - tw / 2, y: tA.cy - th / 2, w: tw, h: th };
    rects.push(L.textRect);
  }
  if (rects.length) {
    const x0 = Math.min(...rects.map((r) => r.x)), y0 = Math.min(...rects.map((r) => r.y));
    const x1 = Math.max(...rects.map((r) => r.x + r.w)), y1 = Math.max(...rects.map((r) => r.y + r.h));
    L.bounds = { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
    // 回転してもはみ出さない倍率
    const r = Math.max(...[[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => Math.hypot(x - W / 2, y - W / 2)));
    L.spinFit = Math.min(1, (W * 0.49) / r);
  }
  return L;
}

const TAU = Math.PI * 2;
const easeOutBack = (x) => { const c = 1.9; return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2; };

function groupMotion(t) {
  const m = { tx: 0, ty: 0, rot: 0, sx: 1, sy: 1, pivot: 'center' };
  switch (S.motion) {
    case 'bounce': {
      const h = Math.sin(Math.PI * t);
      const sq = Math.max(0, 1 - h * 4) ** 2;
      m.ty = -h * 0.12; m.sx = 1 + 0.12 * sq; m.sy = 1 - 0.12 * sq; m.pivot = 'bottom';
      break;
    }
    case 'shake':
      m.tx = Math.sin(TAU * 5 * t) * 0.03; m.ty = Math.sin(TAU * 7 * t + 1) * 0.02; m.rot = Math.sin(TAU * 6 * t) * 0.06;
      break;
    case 'pulse': {
      const b = t < 0.14 ? Math.sin(Math.PI * t / 0.14) : t >= 0.22 && t < 0.36 ? 0.6 * Math.sin(Math.PI * (t - 0.22) / 0.14) : 0;
      m.sx = m.sy = 1 + 0.16 * b;
      break;
    }
    case 'jelly': {
      const v = Math.sin(TAU * 2 * t);
      m.sx = 1 + 0.1 * v; m.sy = 1 - 0.1 * v; m.pivot = 'bottom';
      break;
    }
    case 'float': m.ty = Math.sin(TAU * t) * 0.05; m.rot = Math.sin(TAU * t + 1) * 0.04; break;
    case 'swing': m.rot = Math.sin(TAU * t) * 0.2; m.pivot = 'bottom'; break;
    case 'spin': m.rot = TAU * t; break;
    case 'flip': m.sx = Math.cos(TAU * t); break;
    case 'zoom': {
      const s = t < 0.25 ? easeOutBack(t / 0.25) : t < 0.85 ? 1 : 1 - ((t - 0.85) / 0.15) ** 2;
      m.sx = m.sy = Math.max(0.001, s);
      break;
    }
  }
  return m;
}

function charMotion(t, i, n) {
  switch (S.motion) {
    case 'wave': return { dy: Math.sin(TAU * t - i * 0.7) * 0.14, vis: true };
    case 'hop': {
      const ph = (((t - i / Math.max(n, 1)) % 1) + 1) % 1;
      return { dy: ph < 0.3 ? -Math.sin(ph / 0.3 * Math.PI) * 0.3 : 0, vis: true };
    }
    case 'typing': return { dy: 0, vis: i < Math.floor(Math.min(1, t / 0.75) * (n + 1)) };
  }
  return { dy: 0, vis: true };
}

function render(ctx, t) {
  const W = S.size;
  if (!layout) layout = computeLayout(ctx);
  const L = layout;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, W);
  if (S.bg === 'color') { ctx.fillStyle = S.bgColor; ctx.fillRect(0, 0, W, W); }
  if (!L.bounds) return;

  const m = groupMotion(t);
  const fit = S.motion === 'spin' ? L.spinFit : 1;
  const px = L.bounds.cx, py = m.pivot === 'bottom' ? L.bounds.y1 : L.bounds.cy;
  ctx.save();
  ctx.translate(px + m.tx * W, py + m.ty * W);
  ctx.rotate(m.rot);
  ctx.scale(m.sx * fit, m.sy * fit);
  ctx.translate(-px, -py);

  if (L.photoRect) {
    const r = L.photoRect;
    ctx.imageSmoothingEnabled = S.filter !== 'pixel';
    ctx.drawImage(photo.art, r.x, r.y, r.w, r.h);
    ctx.imageSmoothingEnabled = true;
  }
  if (L.lines.length) drawText(ctx, t, L);
  ctx.restore();
}

function drawText(ctx, t, L) {
  const fs = L.fs, n = L.count;
  ctx.font = fontStr(fs);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

  let fill = S.fill, stroke = S.stroke;
  if (S.colorFx === 'blink' && Math.floor(t * 4) % 2) [fill, stroke] = [S.stroke, S.fill];
  let grad = null;
  if (S.colorFx === 'gradient') {
    const r = L.textRect;
    grad = ctx.createLinearGradient(0, r.y + r.h * 0.2, 0, r.y + r.h * 0.8);
    grad.addColorStop(0, S.fill); grad.addColorStop(1, S.fill2);
  }
  const chars = L.lines.flat().map((c) => ({ ...c, ...charMotion(t, c.i, n) })).filter((c) => c.vis);
  const each = (fn) => chars.forEach((c) => fn(c.g, c.x, c.y + c.dy * fs, c.i));

  const sw = S.strokeW * fs * 2;
  const ow = sw + 0.16 * fs;
  if (S.shadow) {
    ctx.fillStyle = ctx.strokeStyle = 'rgba(40,20,40,0.75)';
    ctx.lineWidth = S.outer2 ? ow : sw;
    const d = fs * 0.06;
    each((g, x, y) => { if (ctx.lineWidth > 0) ctx.strokeText(g, x + d, y + d); ctx.fillText(g, x + d, y + d); });
  }
  if (S.outer2) {
    ctx.strokeStyle = S.outer; ctx.lineWidth = ow;
    each((g, x, y) => ctx.strokeText(g, x, y));
  }
  if (sw > 0) {
    ctx.strokeStyle = stroke; ctx.lineWidth = sw;
    each((g, x, y) => ctx.strokeText(g, x, y));
  }
  each((g, x, y, i) => {
    ctx.fillStyle = S.colorFx === 'rainbow'
      ? `hsl(${(((i * 40 - t * 360) % 360) + 360) % 360}, 95%, 60%)`
      : grad || fill;
    ctx.fillText(g, x, y);
  });
}

// ---------- プレビュー ----------
const pv = $('preview');
const pctx = pv.getContext('2d');
let startTime = performance.now();
function tick(now) {
  if (pv.width !== S.size) { pv.width = pv.height = S.size; layout = null; }
  const t = (((now - startTime) / 1000) / S.dur) % 1;
  render(pctx, t);
  requestAnimationFrame(tick);
}

async function ensureFont() {
  try { await document.fonts.load(fontStr(40), S.text || 'あ'); } catch {}
  layout = null;
}

// ---------- GIF 作成 ----------
const isAnimated = () => S.motion !== 'none' || S.colorFx === 'rainbow' || S.colorFx === 'blink';
let resultUrl = null, resultBlob = null;

async function makeGif() {
  const btn = $('makeBtn'), bar = $('progress');
  btn.disabled = true; btn.textContent = '作成中…';
  bar.hidden = false;
  const setP = (p) => { bar.firstElementChild.style.width = `${Math.round(p * 100)}%`; };
  setP(0);
  try {
    await ensureFont();
    const W = S.size;
    const c = document.createElement('canvas');
    c.width = c.height = W;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const n = isAnimated() ? Math.min(60, Math.max(2, Math.round(S.dur * S.fps))) : 1;
    layout = null;
    const frames = [];
    for (let i = 0; i < n; i++) {
      render(ctx, i / n);
      frames.push(ctx.getImageData(0, 0, W, W));
      setP((i + 1) / n * 0.25);
      if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0));
    }
    layout = null;
    const total = S.dur * 100;
    const delays = frames.map((_, i) => Math.max(2, Math.round((i + 1) * total / n) - Math.round(i * total / n)));
    const blob = await encodeGIF(frames, {
      delays, transparent: S.bg === 'transparent', onProgress: (p) => setP(0.25 + p * 0.75),
    });
    showResult(blob, n);
  } catch (e) {
    console.error(e);
    toast('作成に失敗しました: ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = 'GIFを作る';
    setTimeout(() => { bar.hidden = true; }, 400);
  }
}

function showResult(blob, n) {
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  resultBlob = blob;
  resultUrl = URL.createObjectURL(blob);
  $('resultImg').src = resultUrl;
  $('dlBtn').href = resultUrl;
  $('dlBtn').download = fileName();
  const kb = blob.size / 1024;
  $('resultInfo').textContent = `${S.size}×${S.size}px · ${n}コマ · ${kb < 1000 ? kb.toFixed(0) + 'KB' : (kb / 1024).toFixed(1) + 'MB'}`
    + (kb > 256 ? '（Discordの絵文字は256KBまで。小さいサイズを選ぶと軽くなります）' : '');
  const panel = $('resultPanel');
  panel.hidden = false;
  panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function fileName() {
  const base = S.text.trim().replace(/[\\/:*?"<>|\s]+/g, '').slice(0, 12) || 'sticker';
  return `${base}.gif`;
}

async function share() {
  if (!resultBlob) return;
  const file = new File([resultBlob], fileName(), { type: 'image/gif' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); } catch (e) { if (e.name !== 'AbortError') toast('共有できませんでした'); }
  } else {
    toast('このブラウザは共有に非対応です。「保存」を使ってください');
  }
}

async function copy() {
  if (!resultBlob) return;
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/gif': resultBlob })]);
    toast('GIFをコピーしました！');
  } catch {
    toast('このブラウザはGIFのコピーに非対応です。画像を長押し（右クリック）→コピーしてね');
  }
}

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

// ---------- UI ----------
function changed(key) {
  save();
  if (key === 'font' || key === 'text') ensureFont();
  if (key === 'dur' || key === 'motion') startTime = performance.now();
  layout = null;
  syncVisibility();
}

function chips(container, items, key, { label, onPick, cls } = {}) {
  const el = $(container);
  const draw = () => {
    el.replaceChildren(...items.map(([v, text, extra]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (cls ? ' ' + cls : '');
      b.setAttribute('aria-pressed', String(key && S[key] === v));
      if (label) label(b, v, text, extra); else b.textContent = text;
      b.onclick = () => {
        if (key) { S[key] = v; draw(); }
        onPick?.(v, extra);
        if (key) changed(key);
      };
      return b;
    }));
  };
  draw();
  return draw;
}

function bindInput(id, key, { num, onInput } = {}) {
  const el = $(id);
  const read = () => el.type === 'checkbox' ? el.checked : num ? Number(el.value) : el.value;
  const write = () => { if (el.type === 'checkbox') el.checked = S[key]; else el.value = S[key]; };
  write();
  el.addEventListener('input', () => { S[key] = read(); changed(key); onInput?.(); });
  return write;
}

const redraws = [];
function refreshAll() { redraws.forEach((f) => f()); syncVisibility(); }

redraws.push(bindInput('text', 'text'));
chips('phraseChips', PHRASES.map((p) => [p, p.replace('\n', ' ')]), null, {
  onPick: (v) => { S.text = v; $('text').value = v; changed('text'); },
});
redraws.push(chips('fontChips', FONTS.map(([f, w, name]) => [f, name, w]), 'font', {
  label: (b, v, text, w) => { b.textContent = text; b.style.fontFamily = `"${v}"`; b.style.fontWeight = w; },
}));
redraws.push(chips('motionChips', MOTIONS, 'motion'));
const durLabel = () => { $('durLabel').textContent = `${S.dur.toFixed(1)}秒で1周`; };
redraws.push(bindInput('dur', 'dur', { num: true, onInput: durLabel }), durLabel);

redraws.push(chips('styleChips', STYLES.map(([name, st]) => [name, name, st]), null, {
  label: (b, v, text, st) => {
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = st.fill; sw.style.boxShadow = `0 0 0 3px ${st.stroke}`;
    b.append(sw, text);
  },
  onPick: (v, st) => { Object.assign(S, st); refreshAll(); changed('style'); },
}));
redraws.push(chips('colorFxChips', COLOR_FX, 'colorFx'));
for (const k of ['fill', 'fill2', 'stroke', 'outer', 'bgColor']) redraws.push(bindInput(k, k));
redraws.push(bindInput('strokeW', 'strokeW', { num: true }));
redraws.push(bindInput('outer2', 'outer2'));
redraws.push(bindInput('shadow', 'shadow'));

redraws.push(chips('sizeChips', SIZES, 'size'));
redraws.push(chips('fpsChips', FPS, 'fps'));
redraws.push(chips('bgChips', BGS, 'bg'));
redraws.push(chips('textPosChips', TEXT_POS, 'textPos'));

// 写真
const syncPhotoFx = () => {
  Object.assign(photo.fx, { filter: S.filter, border: S.border, borderColor: S.borderColor });
  photo.rebuild();
};
redraws.push(chips('filterChips', FILTERS, 'filter', { onPick: syncPhotoFx }));
redraws.push(bindInput('border', 'border', { num: true, onInput: syncPhotoFx }));
redraws.push(bindInput('borderColor', 'borderColor', { onInput: syncPhotoFx }));
redraws.push(bindInput('photoScale', 'photoScale', { num: true }));

const drawTools = chips('toolChips', TOOLS, null, {
  onPick: (v) => { photo.tool = v; drawTools(); syncVisibility(); },
  label: (b, v, text) => { b.textContent = text; b.setAttribute('aria-pressed', String(photo.tool === v)); },
});
photo.tolerance = 40; photo.brush = 24;
$('tolerance').value = photo.tolerance;
$('brush').value = photo.brush;
$('tolerance').addEventListener('input', (e) => { photo.tolerance = Number(e.target.value); });
$('brush').addEventListener('input', (e) => { photo.brush = Number(e.target.value); });

$('photoFile').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    await photo.load(file);
    $('aiStatus').textContent = '';
    syncVisibility();
    $('photoTools').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    console.error(err);
    toast('写真を読み込めませんでした');
  }
});
$('aiBtn').addEventListener('click', async () => {
  const btn = $('aiBtn'), st = $('aiStatus');
  btn.disabled = true;
  try {
    await photo.removeWithAI((m) => { st.textContent = m; });
    st.textContent = '切り抜き完了！はみ出しは消しゴム/復元で直せます。';
  } catch (err) {
    console.error(err);
    st.textContent = 'AI切り抜きに失敗しました（通信環境をご確認ください）。「タップで消す」も使えます。';
  } finally {
    btn.disabled = false;
  }
});
$('cornerBtn').addEventListener('click', () => photo.removeFromCorners());
$('undoBtn').addEventListener('click', () => photo.undo());
$('invertBtn').addEventListener('click', () => photo.invertMask());
$('resetMaskBtn').addEventListener('click', () => photo.resetMask());
$('removePhotoBtn').addEventListener('click', () => { photo.clear(); syncVisibility(); });

function syncVisibility() {
  $('photoTools').hidden = !photo.loaded;
  $('toolHint').textContent = TOOL_HINTS[photo.tool];
  $('tolWrap').hidden = photo.tool !== 'wand';
  $('brushWrap').hidden = photo.tool === 'wand';
  $('fill2Wrap').hidden = S.colorFx !== 'gradient';
  $('bgColor').hidden = S.bg !== 'color';
  $('textPosChips').parentElement && ($('textPosChips').hidden = !S.text.trim());
}

$('makeBtn').addEventListener('click', makeGif);
$('shareBtn').addEventListener('click', share);
$('copyBtn').addEventListener('click', copy);
$('resetAll').addEventListener('click', () => {
  S = { ...DEFAULTS };
  save();
  refreshAll();
  syncPhotoFx();
  ensureFont();
});
if (!navigator.share) $('shareBtn').hidden = true;

syncVisibility();
ensureFont();
document.fonts?.addEventListener?.('loadingdone', () => { layout = null; });
requestAnimationFrame(tick);

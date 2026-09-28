// 写真素材：読み込み・切り抜き（AI / タップ / 消しゴム）・フィルタ・ふち付け

const MAX_SIDE = 512;
const AI_LIB = 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm';

export class PhotoEditor {
  constructor(canvas, onChange) {
    this.view = canvas;
    this.vctx = canvas.getContext('2d');
    this.onChange = onChange; // 素材が変わったら呼ぶ
    this.src = null;          // 元画像 ImageData
    this.mask = null;         // Uint8Array（0..255）
    this.undoStack = [];
    this.tool = 'wand';
    this.tolerance = 40;
    this.brush = 24;
    this.art = null;          // 加工済みキャンバス（描画用）
    this.fx = { filter: 'none', border: 10, borderColor: '#ffffff' };
    this._bindPointer();
  }

  get loaded() { return !!this.src; }

  async load(file) {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null)
      || await loadViaImg(file);
    const s = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
    const c = makeCanvas(w, h), x = c.getContext('2d');
    x.drawImage(bmp, 0, 0, w, h);
    this.src = x.getImageData(0, 0, w, h);
    this.mask = new Uint8Array(w * h).fill(255);
    this.undoStack = [];
    this.view.width = w; this.view.height = h;
    this.rebuild();
  }

  clear() {
    this.src = null; this.mask = null; this.art = null; this.undoStack = [];
    this.onChange();
  }

  pushUndo() {
    this.undoStack.push(this.mask.slice());
    if (this.undoStack.length > 30) this.undoStack.shift();
  }
  undo() {
    if (!this.undoStack.length) return;
    this.mask = this.undoStack.pop();
    this.rebuild();
  }
  resetMask() {
    if (!this.src) return;
    this.pushUndo();
    this.mask.fill(255);
    this.rebuild();
  }
  invertMask() {
    if (!this.src) return;
    this.pushUndo();
    for (let i = 0; i < this.mask.length; i++) this.mask[i] = 255 - this.mask[i];
    this.rebuild();
  }

  // タップした場所と似た色の連続領域を消す
  wand(px, py, record = true) {
    const { width: w, height: h, data } = this.src;
    px = Math.floor(px); py = Math.floor(py);
    if (px < 0 || py < 0 || px >= w || py >= h) return;
    if (record) this.pushUndo();
    const si = (py * w + px) * 4;
    const r0 = data[si], g0 = data[si + 1], b0 = data[si + 2];
    const tol = (this.tolerance * 2.2) ** 2;
    const seen = new Uint8Array(w * h);
    const stack = new Int32Array(w * h);
    let sp = 0;
    stack[sp++] = py * w + px; seen[py * w + px] = 1;
    while (sp) {
      const p = stack[--sp];
      this.mask[p] = 0;
      const x = p % w, y = (p / w) | 0;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of nb) {
        if (q < 0 || seen[q]) continue;
        seen[q] = 1;
        const i = q * 4;
        const d = (data[i] - r0) ** 2 + (data[i + 1] - g0) ** 2 + (data[i + 2] - b0) ** 2;
        if (d <= tol) stack[sp++] = q;
      }
    }
    if (record) this.rebuild();
  }

  // 四隅から背景を消す（無地の背景向け）
  removeFromCorners() {
    if (!this.src) return;
    const { width: w, height: h } = this.src;
    this.pushUndo();
    for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1], [w >> 1, 0], [w >> 1, h - 1], [0, h >> 1], [w - 1, h >> 1]]) {
      this.wand(x, y, false);
    }
    this.rebuild();
  }

  async removeWithAI(onStatus) {
    if (!this.src) return;
    onStatus('AIモデルを読み込み中…（初回は数十MBダウンロード）');
    const lib = await import(AI_LIB);
    const input = await new Promise(res => imageDataCanvas(this.src).toBlob(res, 'image/png'));
    const out = await lib.removeBackground(input, {
      progress: (key, cur, total) => {
        if (total) onStatus(`AIモデルを読み込み中… ${Math.round(cur / total * 100)}%`);
      },
    });
    onStatus('切り抜き中…');
    const bmp = await createImageBitmap(out);
    const { width: w, height: h } = this.src;
    const c = makeCanvas(w, h), x = c.getContext('2d');
    x.drawImage(bmp, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data;
    this.pushUndo();
    for (let i = 0; i < this.mask.length; i++) this.mask[i] = d[i * 4 + 3];
    this.rebuild();
  }

  _paint(px, py) {
    const { width: w, height: h } = this.src;
    const r = this.brush / 2, v = this.tool === 'erase' ? 0 : 255;
    const x0 = Math.max(0, Math.floor(px - r)), x1 = Math.min(w - 1, Math.ceil(px + r));
    const y0 = Math.max(0, Math.floor(py - r)), y1 = Math.min(h - 1, Math.ceil(py + r));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if ((x - px) ** 2 + (y - py) ** 2 <= r * r) this.mask[y * w + x] = v;
    }
  }

  _bindPointer() {
    let drawing = false, last = null;
    const pos = (e) => {
      const rect = this.view.getBoundingClientRect();
      return [(e.clientX - rect.left) * this.view.width / rect.width,
              (e.clientY - rect.top) * this.view.height / rect.height];
    };
    this.view.addEventListener('pointerdown', (e) => {
      if (!this.src) return;
      e.preventDefault();
      const [x, y] = pos(e);
      if (this.tool === 'wand') { this.wand(x, y); return; }
      this.view.setPointerCapture(e.pointerId);
      drawing = true; last = [x, y];
      this.pushUndo();
      this._paint(x, y); this.drawView();
    });
    this.view.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const [x, y] = pos(e);
      const steps = Math.ceil(Math.hypot(x - last[0], y - last[1]) / (this.brush / 4)) || 1;
      for (let i = 1; i <= steps; i++) {
        this._paint(last[0] + (x - last[0]) * i / steps, last[1] + (y - last[1]) * i / steps);
      }
      last = [x, y];
      this.drawView();
    });
    const end = () => { if (drawing) { drawing = false; this.rebuild(); } };
    this.view.addEventListener('pointerup', end);
    this.view.addEventListener('pointercancel', end);
  }

  // 編集キャンバス：消した部分は薄く表示
  drawView() {
    if (!this.src) return;
    const { width: w, height: h } = this.src;
    const x = this.vctx;
    x.clearRect(0, 0, w, h);
    x.globalAlpha = 0.18;
    x.drawImage(imageDataCanvas(this.src), 0, 0);
    x.globalAlpha = 1;
    x.drawImage(this._cutCanvas(false), 0, 0);
  }

  _cutCanvas(withFilter) {
    const { width: w, height: h, data } = this.src;
    const img = new ImageData(new Uint8ClampedArray(data), w, h);
    const d = img.data;
    for (let i = 0; i < this.mask.length; i++) d[i * 4 + 3] = Math.min(d[i * 4 + 3], this.mask[i]);
    if (withFilter) applyFilter(img, this.fx.filter);
    return imageDataCanvas(img);
  }

  rebuild() {
    if (!this.src) { this.art = null; this.onChange(); return; }
    this.drawView();
    let cut = this._cutCanvas(true);
    if (this.fx.filter === 'pixel') cut = pixelate(cut, 10);
    const box = alphaBounds(cut);
    if (!box) { this.art = null; this.onChange(); return; }
    const r = this.fx.border;
    const out = makeCanvas(box.w + r * 2 + 2, box.h + r * 2 + 2);
    const o = out.getContext('2d');
    if (r > 0) {
      // 輪郭を太らせた白ふち（シール風）
      const sil = makeCanvas(box.w, box.h), s = sil.getContext('2d');
      s.drawImage(cut, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
      s.globalCompositeOperation = 'source-in';
      s.fillStyle = this.fx.borderColor;
      s.fillRect(0, 0, box.w, box.h);
      const steps = Math.max(16, Math.round(r * 3));
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        o.drawImage(sil, r + 1 + Math.cos(a) * r, r + 1 + Math.sin(a) * r);
      }
      o.drawImage(sil, r + 1, r + 1);
    }
    o.drawImage(cut, box.x, box.y, box.w, box.h, r + 1, r + 1, box.w, box.h);
    this.art = out;
    this.onChange();
  }
}

// ---------- ヘルパ ----------
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function imageDataCanvas(img) {
  const c = makeCanvas(img.width, img.height);
  c.getContext('2d').putImageData(img, 0, 0);
  return c;
}
function loadViaImg(file) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = URL.createObjectURL(file);
  });
}
function alphaBounds(c) {
  const { width: w, height: h } = c;
  const d = c.getContext('2d').getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (d[(y * w + x) * 4 + 3] > 40) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
function pixelate(c, block) {
  const sw = Math.max(1, Math.round(c.width / block)), sh = Math.max(1, Math.round(c.height / block));
  const small = makeCanvas(sw, sh), s = small.getContext('2d');
  s.drawImage(c, 0, 0, sw, sh);
  const d = s.getImageData(0, 0, sw, sh);
  for (let i = 3; i < d.data.length; i += 4) d.data[i] = d.data[i] > 110 ? 255 : 0;
  s.putImageData(d, 0, 0);
  const out = makeCanvas(c.width, c.height), o = out.getContext('2d');
  o.imageSmoothingEnabled = false;
  o.drawImage(small, 0, 0, c.width, c.height);
  return out;
}

const clamp = (v) => v < 0 ? 0 : v > 255 ? 255 : v;
const post = (v, n) => Math.round(Math.round(v / 255 * (n - 1)) * 255 / (n - 1));

export const FILTERS = [
  ['none', 'そのまま'], ['pop', 'ポップ'], ['manga', 'マンガ'], ['mono', 'モノクロ'],
  ['sepia', 'セピア'], ['retro', 'レトロ'], ['neon', 'ネオン'], ['nega', 'ネガ'], ['pixel', 'ドット絵'],
];

function applyFilter(img, f) {
  if (f === 'none') return;
  const d = img.data, w = img.width;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    let r = d[i], g = d[i + 1], b = d[i + 2];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    switch (f) {
      case 'pop': {
        const s = 1.8, c = 1.25;
        r = (l + (r - l) * s - 128) * c + 138; g = (l + (g - l) * s - 128) * c + 138; b = (l + (b - l) * s - 128) * c + 138;
        r = post(clamp(r), 5); g = post(clamp(g), 5); b = post(clamp(b), 5);
        break;
      }
      case 'manga': {
        const x = p % w, y = (p / w) | 0;
        const v = l > 165 ? 255 : l > 95 ? (((x >> 1) + (y >> 1)) % 2 ? 255 : 40) : 20;
        r = g = b = v;
        break;
      }
      case 'mono': r = g = b = l; break;
      case 'sepia':
        r = clamp(l * 1.07 + 30); g = clamp(l * 0.95 + 12); b = clamp(l * 0.75);
        break;
      case 'retro':
        r = post(clamp(r * 1.1 + 15), 4); g = post(clamp(g * 1.0 + 5), 4); b = post(clamp(b * 0.85), 4);
        break;
      case 'neon': {
        const h = (l / 255) * 300 + 180;
        [r, g, b] = hsl(h % 360, 1, 0.35 + (l / 255) * 0.35);
        break;
      }
      case 'nega': r = 255 - r; g = 255 - g; b = 255 - b; break;
    }
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
}
function hsl(h, s, l) {
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

// 依存なしの GIF エンコーダ（グローバルパレット + メディアンカット減色 + LZW）
// frames: ImageData[]（全て同サイズ）
// opts: { delays: number[] (1/100秒単位), transparent: boolean, onProgress?: (0..1)=>void }

const yieldUI = () => new Promise(r => setTimeout(r, 0));

// ---------- 減色 ----------
// 15bit (RGB 各5bit) ヒストグラムを作り、メディアンカットでパレットを作る
function buildPalette(frames, transparent, maxColors) {
  const count = new Uint32Array(32768);
  const sr = new Float64Array(32768), sg = new Float64Array(32768), sb = new Float64Array(32768);
  for (const f of frames) {
    const d = f.data;
    for (let i = 0; i < d.length; i += 4) {
      if (transparent && d[i + 3] < 128) continue;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      count[k]++; sr[k] += r; sg[k] += g; sb[k] += b;
    }
  }
  const keys = [];
  for (let k = 0; k < 32768; k++) if (count[k]) keys.push(k);

  const boxStats = (ks) => {
    let rmin = 31, rmax = 0, gmin = 31, gmax = 0, bmin = 31, bmax = 0, n = 0;
    for (const k of ks) {
      const r = k >> 10, g = (k >> 5) & 31, b = k & 31;
      if (r < rmin) rmin = r; if (r > rmax) rmax = r;
      if (g < gmin) gmin = g; if (g > gmax) gmax = g;
      if (b < bmin) bmin = b; if (b > bmax) bmax = b;
      n += count[k];
    }
    return { ks, n, rr: rmax - rmin, gr: gmax - gmin, br: bmax - bmin };
  };

  const boxes = keys.length ? [boxStats(keys)] : [];
  while (boxes.length < maxColors) {
    // 「画素数 × 色幅」が最大の箱を分割
    let best = -1, bestScore = 0;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.ks.length < 2) continue;
      const score = b.n * Math.max(b.rr, b.gr, b.br);
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best < 0) break;
    const b = boxes[best];
    const shift = b.rr >= b.gr && b.rr >= b.br ? 10 : b.gr >= b.br ? 5 : 0;
    b.ks.sort((x, y) => ((x >> shift) & 31) - ((y >> shift) & 31));
    let acc = 0, cut = 1;
    for (let i = 0; i < b.ks.length; i++) {
      acc += count[b.ks[i]];
      if (acc >= b.n / 2) { cut = Math.min(Math.max(i + 1, 1), b.ks.length - 1); break; }
    }
    boxes.splice(best, 1, boxStats(b.ks.slice(0, cut)), boxStats(b.ks.slice(cut)));
  }

  const palette = [];
  for (const b of boxes) {
    let r = 0, g = 0, bl = 0, n = 0;
    for (const k of b.ks) { r += sr[k]; g += sg[k]; bl += sb[k]; n += count[k]; }
    palette.push([Math.round(r / n), Math.round(g / n), Math.round(bl / n)]);
  }
  // 各ビン → 最も近いパレット番号
  const offset = transparent ? 1 : 0;
  const lut = new Uint8Array(32768);
  for (const k of keys) {
    const r = ((k >> 10) << 3) | 4, g = (((k >> 5) & 31) << 3) | 4, b = ((k & 31) << 3) | 4;
    let bi = 0, bd = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const p = palette[i];
      const d = (p[0] - r) ** 2 * 3 + (p[1] - g) ** 2 * 4 + (p[2] - b) ** 2 * 2;
      if (d < bd) { bd = d; bi = i; }
    }
    lut[k] = bi + offset;
  }
  if (transparent) palette.unshift([0, 0, 0]);
  return { palette, lut };
}

function indexFrame(img, lut, transparent) {
  const d = img.data, out = new Uint8Array(img.width * img.height);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    if (transparent && d[i + 3] < 128) { out[p] = 0; continue; }
    out[p] = lut[((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3)];
  }
  return out;
}

// ---------- バイト列 ----------
class ByteWriter {
  constructor() { this.buf = new Uint8Array(1 << 16); this.len = 0; }
  grow(n) {
    if (this.len + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.len + n) size *= 2;
    const nb = new Uint8Array(size); nb.set(this.buf.subarray(0, this.len)); this.buf = nb;
  }
  byte(b) { this.grow(1); this.buf[this.len++] = b; }
  u16(v) { this.byte(v & 255); this.byte((v >> 8) & 255); }
  bytes(arr) { this.grow(arr.length); this.buf.set(arr, this.len); this.len += arr.length; }
  str(s) { for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i)); }
  result() { return this.buf.subarray(0, this.len); }
}

// ---------- LZW ----------
function lzw(indices, minCodeSize, w) {
  const clearCode = 1 << minCodeSize, eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1, maxCode = (1 << codeSize) - 1, next = eoiCode + 1;
  let clearFlag = false;
  const dict = new Map();
  const block = new Uint8Array(255); let blen = 0;
  let cur = 0, curBits = 0;

  const pushByte = (b) => {
    block[blen++] = b;
    if (blen === 255) { w.byte(255); w.bytes(block); blen = 0; }
  };
  const emit = (code) => {
    cur |= code << curBits; curBits += codeSize;
    while (curBits >= 8) { pushByte(cur & 255); cur >>>= 8; curBits -= 8; }
    if (clearFlag) {
      codeSize = minCodeSize + 1; maxCode = (1 << codeSize) - 1; clearFlag = false;
    } else if (next > maxCode) {
      codeSize++;
      maxCode = codeSize === 12 ? 4096 : (1 << codeSize) - 1;
    }
  };

  w.byte(minCodeSize);
  emit(clearCode);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const v = dict.get(key);
    if (v !== undefined) { prefix = v; continue; }
    emit(prefix);
    if (next < 4096) {
      dict.set(key, next++);
    } else {
      dict.clear(); next = eoiCode + 1; clearFlag = true;
      emit(clearCode);
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoiCode);
  if (curBits > 0) pushByte(cur & 255);
  if (blen) { w.byte(blen); w.bytes(block.subarray(0, blen)); }
  w.byte(0);
}

export async function encodeGIF(frames, { delays, transparent, onProgress }) {
  const width = frames[0].width, height = frames[0].height;
  const { palette, lut } = buildPalette(frames, transparent, transparent ? 255 : 256);
  await yieldUI();

  const w = new ByteWriter();
  w.str('GIF89a');
  w.u16(width); w.u16(height);
  w.byte(0xF7); // グローバルカラーテーブルあり、256色
  w.byte(0); w.byte(0);
  for (let i = 0; i < 256; i++) {
    const c = palette[i] || [0, 0, 0];
    w.byte(c[0]); w.byte(c[1]); w.byte(c[2]);
  }
  if (frames.length > 1) {
    // 無限ループ
    w.byte(0x21); w.byte(0xFF); w.byte(11); w.str('NETSCAPE2.0');
    w.byte(3); w.byte(1); w.u16(0); w.byte(0);
  }
  for (let f = 0; f < frames.length; f++) {
    w.byte(0x21); w.byte(0xF9); w.byte(4);
    w.byte(transparent ? 0x09 : 0x04); // 透過時は「背景に戻す」で前フレームを消す
    w.u16(delays[f] || 10);
    w.byte(0); w.byte(0);
    w.byte(0x2C); w.u16(0); w.u16(0); w.u16(width); w.u16(height); w.byte(0);
    lzw(indexFrame(frames[f], lut, transparent), 8, w);
    onProgress?.((f + 1) / frames.length);
    await yieldUI();
  }
  w.byte(0x3B);
  return new Blob([w.result()], { type: 'image/gif' });
}

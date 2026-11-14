/* Reads a photo or scan of a filled sheet.
   Pipeline: find the 4 black corner squares -> work out which way up the page is from the code
   strip -> flatten the page -> nudge each bubble group onto its printed circles -> measure ink. */
(function () {
  const OMR = (window.OMR = window.OMR || {});
  const PPM = 6; // pixels per mm of the flattened page
  OMR.PPM = PPM;

  // ---------- small maths ----------
  function solveH(src, dst) {
    // homography taking src[i] -> dst[i], 4 point pairs
    const A = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = src[i], [u, v] = dst[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
    }
    for (let c = 0; c < 8; c++) {
      let p = c;
      for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      if (Math.abs(A[p][c]) < 1e-12) return null;
      [A[c], A[p]] = [A[p], A[c]];
      for (let r = 0; r < 8; r++) {
        if (r === c) continue;
        const f = A[r][c] / A[c][c];
        for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
      }
    }
    const h = A.map((row, i) => row[8] / row[i]);
    h.push(1);
    return h;
  }
  function applyH(h, x, y) {
    const w = h[6] * x + h[7] * y + 1;
    return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
  }
  OMR._solveH = solveH;
  OMR._applyH = applyH;

  // ---------- image loading ----------
  async function toCanvas(source, maxDim) {
    let img = source, w, h;
    if (source instanceof Blob) img = await createImageBitmap(source);
    w = img.width; h = img.height;
    const s = Math.min(1, maxDim / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * s); c.height = Math.round(h * s);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    if (img.close) img.close();
    return c;
  }

  // ---------- corner squares ----------
  function findCandidates(gray, w, h) {
    // adaptive threshold against the local mean (integral image)
    const integ = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        row += gray[y * w + x];
        integ[(y + 1) * (w + 1) + x + 1] = integ[y * (w + 1) + x + 1] + row;
      }
    }
    const half = Math.max(20, Math.round(Math.min(w, h) / 16));
    const bin = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - half), y1 = Math.min(h, y + half + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - half), x1 = Math.min(w, x + half + 1);
        const sum = integ[y1 * (w + 1) + x1] - integ[y0 * (w + 1) + x1] - integ[y1 * (w + 1) + x0] + integ[y0 * (w + 1) + x0];
        if (gray[y * w + x] < (sum / ((x1 - x0) * (y1 - y0))) * 0.62) bin[y * w + x] = 1;
      }
    }
    // connected components
    const stack = new Int32Array(w * h);
    const out = [];
    const minSide = 5, maxSide = Math.min(w, h) * 0.09;
    for (let i = 0; i < w * h; i++) {
      if (bin[i] !== 1) continue;
      let sp = 0, area = 0, sx = 0, sy = 0, minx = w, maxx = 0, miny = h, maxy = 0;
      stack[sp++] = i; bin[i] = 2;
      while (sp) {
        const p = stack[--sp], x = p % w, y = (p - x) / w;
        area++; sx += x; sy += y;
        if (x < minx) minx = x; if (x > maxx) maxx = x;
        if (y < miny) miny = y; if (y > maxy) maxy = y;
        if (x > 0 && bin[p - 1] === 1) { bin[p - 1] = 2; stack[sp++] = p - 1; }
        if (x < w - 1 && bin[p + 1] === 1) { bin[p + 1] = 2; stack[sp++] = p + 1; }
        if (y > 0 && bin[p - w] === 1) { bin[p - w] = 2; stack[sp++] = p - w; }
        if (y < h - 1 && bin[p + w] === 1) { bin[p + w] = 2; stack[sp++] = p + w; }
      }
      const bw = maxx - minx + 1, bh = maxy - miny + 1;
      if (bw < minSide || bh < minSide || bw > maxSide || bh > maxSide) continue;
      const asp = bw / bh;
      if (asp < 0.5 || asp > 2 || area / (bw * bh) < 0.5) continue;
      out.push({ x: sx / area, y: sy / area, area, side: Math.sqrt(area) });
    }
    return out;
  }

  function quadFrom(set) {
    // extreme blobs in the four diagonal directions, ordered clockwise from image top-left
    const pick = (f) => set.reduce((a, b) => (f(b) < f(a) ? b : a));
    const q = [pick((c) => c.x + c.y), pick((c) => c.y - c.x), pick((c) => -c.x - c.y), pick((c) => c.x - c.y)];
    if (new Set(q).size < 4) return null;
    const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const s = [d(q[0], q[1]), d(q[1], q[2]), d(q[2], q[3]), d(q[3], q[0])];
    const a = (s[0] + s[2]) / 2, b = (s[1] + s[3]) / 2;
    const long = Math.max(a, b), short = Math.min(a, b);
    if (short < 60) return null;
    const ratio = long / short; // true value 275/188 = 1.46
    if (ratio < 1.15 || ratio > 1.9) return null;
    if (Math.max(s[0], s[2]) / Math.min(s[0], s[2]) > 1.5 || Math.max(s[1], s[3]) / Math.min(s[1], s[3]) > 1.5) return null;
    const side = q.reduce((t, c) => t + c.side, 0) / 4;
    const rel = side / short; // true value 7/188 = 0.037
    if (rel < 0.02 || rel > 0.065) return null;
    return { q, size: a * b };
  }

  function findCorners(cands) {
    let best = null;
    const tried = new Set();
    cands.sort((a, b) => b.area - a.area);
    for (const ref of cands) {
      const key = Math.round(Math.log(ref.area) * 4);
      if (tried.has(key)) continue;
      tried.add(key);
      const set = cands.filter((c) => c.area > ref.area * 0.45 && c.area < ref.area * 2.2);
      if (set.length < 4) continue;
      const r = quadFrom(set);
      if (r && (!best || r.size > best.size)) best = r;
    }
    return best && best.q;
  }

  // ---------- pixel access on the source photo ----------
  function meanAt(gray, w, h, h2src, cx, cy, half) {
    // mean grey of a (2*half) mm square centred on page position (cx, cy)
    let s = 0, n = 0;
    for (let dy = -half; dy <= half; dy += half / 2)
      for (let dx = -half; dx <= half; dx += half / 2) {
        const [x, y] = applyH(h2src, cx + dx, cy + dy);
        const xi = Math.round(x), yi = Math.round(y);
        if (xi < 0 || yi < 0 || xi >= w || yi >= h) continue;
        s += gray[yi * w + xi]; n++;
      }
    return n ? s / n : 255;
  }

  function warp(srcData, sw, sh, H, dw, dh) {
    // H maps destination pixel -> source pixel; bilinear sampling
    const out = new ImageData(dw, dh), o = out.data, s = srcData;
    for (let v = 0; v < dh; v++) {
      for (let u = 0; u < dw; u++) {
        const den = H[6] * u + H[7] * v + 1;
        const x = (H[0] * u + H[1] * v + H[2]) / den, y = (H[3] * u + H[4] * v + H[5]) / den;
        const i = (v * dw + u) * 4;
        if (x < 0 || y < 0 || x >= sw - 1 || y >= sh - 1) { o[i] = o[i + 1] = o[i + 2] = 255; o[i + 3] = 255; continue; }
        const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
        const p = (y0 * sw + x0) * 4, q = p + sw * 4;
        for (let k = 0; k < 3; k++) {
          o[i + k] = (s[p + k] * (1 - fx) + s[p + 4 + k] * fx) * (1 - fy) + (s[q + k] * (1 - fx) + s[q + 4 + k] * fx) * fy;
        }
        o[i + 3] = 255;
      }
    }
    return out;
  }
  OMR._warp = warp;

  // ---------- bubble reading on the flattened page ----------
  const RING = [];
  for (let i = 0; i < 16; i++) RING.push([Math.cos((i * Math.PI) / 8), Math.sin((i * Math.PI) / 8)]);

  function refineGroup(G, W, Hh, group) {
    // slide the whole group by up to 1.6 mm to sit on the printed circles (green channel sees pink print)
    const r = group.r * PPM, ro = r * 1.3;
    let best = -Infinity, bx = 0, by = 0;
    const px = (x, y) => {
      const xi = Math.round(x), yi = Math.round(y);
      return xi < 0 || yi < 0 || xi >= W || yi >= Hh ? 255 : G[yi * W + xi];
    };
    for (let dy = -1.6; dy <= 1.601; dy += 0.2) {
      for (let dx = -1.6; dx <= 1.601; dx += 0.2) {
        let score = 0;
        for (const p of group.pts) {
          const cx = (p.x + dx) * PPM, cy = (p.y + dy) * PPM;
          for (const [c, s] of RING) score += px(cx + c * ro, cy + s * ro) - px(cx + c * r, cy + s * r);
        }
        score -= (dx * dx + dy * dy) * group.pts.length * 2; // mild preference for staying put
        if (score > best) { best = score; bx = dx; by = dy; }
      }
    }
    return [bx, by];
  }

  function darkness(R, W, Hh, cx, cy, r) {
    // ink inside the bubble (red channel: pink print vanishes, blue and black pen stay dark),
    // relative to the paper brightness just around it
    const ri = r * 0.72, box = Math.round(r * 1.9);
    const x0 = Math.round(cx), y0 = Math.round(cy);
    const hist = new Uint32Array(256);
    let n = 0, sum = 0, m = 0;
    for (let y = y0 - box; y <= y0 + box; y++) {
      if (y < 0 || y >= Hh) continue;
      for (let x = x0 - box; x <= x0 + box; x++) {
        if (x < 0 || x >= W) continue;
        const v = R[y * W + x];
        hist[v]++; n++;
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy <= ri * ri) { sum += v; m++; }
      }
    }
    let acc = 0, white = 255;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= n * 0.1) { white = v; break; } }
    if (!m || white < 20) return 0;
    return Math.max(0, 1 - sum / m / white);
  }

  function median(a) {
    const s = Array.from(a).sort((x, y) => x - y);
    return s.length ? s[s.length >> 1] : 0;
  }

  /* Returns { ok, error } or
     { ok, cfg, cls, roll, set, answers[], flags[], review:{q: reason}, image (JPEG data URL of flat page),
       nameCrop (data URL), pos:{...bubble centres in px} } */
  OMR.scan = async function (source) {
    const work = await toCanvas(source, 2200);
    const sw = work.width, sh = work.height;
    const sdata = work.getContext('2d').getImageData(0, 0, sw, sh).data;

    // detection copy, about 1100 px on the long side
    const ds = Math.min(1, 1100 / Math.max(sw, sh));
    const dw = Math.round(sw * ds), dh = Math.round(sh * ds);
    const det = await toCanvas(work, 1100);
    const dd = det.getContext('2d').getImageData(0, 0, dw, dh).data;
    const dgray = new Uint8Array(dw * dh);
    for (let i = 0; i < dw * dh; i++) dgray[i] = (dd[i * 4] * 77 + dd[i * 4 + 1] * 150 + dd[i * 4 + 2] * 29) >> 8;

    const corners = findCorners(findCandidates(dgray, dw, dh));
    if (!corners) return { ok: false, error: 'Could not find the four black corner squares. Make sure the whole sheet is in the photo, flat and well lit.' };

    // try the four possible rotations; the code strip is only valid the right way up
    let cfg = null, h2det = null;
    for (let k = 0; k < 4 && !cfg; k++) {
      const pts = [0, 1, 2, 3].map((i) => [corners[(i + k) % 4].x, corners[(i + k) % 4].y]);
      const H = solveH(OMR.MARKERS, pts);
      if (!H) continue;
      const S = OMR.STRIP;
      const black = meanAt(dgray, dw, dh, H, OMR.MARKERS[0][0], OMR.MARKERS[0][1], 1.5);
      const paper = meanAt(dgray, dw, dh, H, S.paperRef[0], S.paperRef[1], 1);
      if (paper - black < 40) continue;
      const bits = [];
      for (let i = 0; i < S.n; i++) bits.push(meanAt(dgray, dw, dh, H, S.x0 + i * S.pitch, S.y, 1) < (black + paper) / 2 ? 1 : 0);
      cfg = OMR.cfgFromBits(bits);
      if (cfg) h2det = H;
    }
    if (!cfg) return { ok: false, error: 'Found a page but could not read its code strip. Is this one of our OMR sheets, and is the top edge visible?' };

    // flatten the page
    const W = OMR.PAGE.W * PPM, Hh = OMR.PAGE.H * PPM;
    const dstPts = OMR.MARKERS.map(([x, y]) => [x * PPM, y * PPM]);
    const srcPts = OMR.MARKERS.map(([x, y]) => applyH(h2det, x, y).map((v) => v / ds));
    const flat = warp(sdata, sw, sh, solveH(dstPts, srcPts), W, Hh);
    const R = new Uint8Array(W * Hh), G = new Uint8Array(W * Hh);
    for (let i = 0; i < W * Hh; i++) { R[i] = flat.data[i * 4]; G[i] = flat.data[i * 4 + 1]; }

    const L = OMR.layout(cfg);
    const off = new Map();
    L.alignGroups.forEach((g) => {
      const o = refineGroup(G, W, Hh, g);
      g.pts.forEach((p) => off.set(p, o));
    });
    const read = (p, r) => {
      const o = off.get(p);
      const cx = (p.x + o[0]) * PPM, cy = (p.y + o[1]) * PPM;
      return { v: p.v, x: cx, y: cy, r: r * PPM, d: darkness(R, W, Hh, cx, cy, r * PPM) };
    };
    const ans = L.answers.map((row) => row.map((p) => read(p, L.r.ans)));
    const cls = L.cls.map((p) => read(p, L.r.cls));
    const set = L.set.map((p) => read(p, L.r.set));
    const roll = L.roll.map((col) => col.map((p) => read(p, L.r.roll)));

    // empty-bubble baseline for this sheet, then "filled" and "faint" cut-offs above it
    const base = median(ans.flat().map((b) => b.d));
    const FILL = base + 0.24, FAINT = base + 0.12;
    const choose = (bubbles) => {
      const marked = bubbles.filter((b) => b.d >= FILL).map((b) => b.v);
      const faint = bubbles.some((b) => b.d >= FAINT && b.d < FILL);
      return { marked, faint };
    };

    const flags = [], review = {};
    const one = (bubbles, label) => {
      const c = choose(bubbles);
      if (c.marked.length !== 1) flags.push(label + (c.marked.length ? ': more than one bubble' : ': not marked'));
      else if (c.faint) flags.push(label + ': faint extra mark');
      return c.marked.length === 1 ? c.marked[0] : null;
    };
    const res = { ok: true, cfg, flags, review };
    res.cls = one(cls, 'Class');
    res.set = cfg.hasSet ? one(set, 'Set') : null;
    let rollBad = false;
    res.roll = roll.map((col) => {
      const c = choose(col);
      if (c.marked.length !== 1) { rollBad = true; return '?'; }
      return c.marked[0];
    }).join('');
    if (rollBad) flags.push('Roll No.: check digits');
    res.answers = ans.map((row, q) => {
      const c = choose(row);
      if (c.marked.length > 1) review[q + 1] = 'more than one bubble';
      else if (c.faint) review[q + 1] = 'faint mark';
      return c.marked.join('');
    });

    // keep the flattened page (JPEG) and the hand-written name for review
    const fc = document.createElement('canvas');
    fc.width = W; fc.height = Hh;
    fc.getContext('2d').putImageData(flat, 0, 0);
    res.image = fc.toDataURL('image/jpeg', 0.8);
    const nb = L.name, nc = document.createElement('canvas');
    nc.width = nb.w * 3; nc.height = nb.h * 3;
    nc.getContext('2d').drawImage(fc, nb.x * PPM, nb.y * PPM, nb.w * PPM, nb.h * PPM, 0, 0, nc.width, nc.height);
    res.nameCrop = nc.toDataURL('image/jpeg', 0.7);
    res.pos = ans.map((row) => row.map((b) => [Math.round(b.x), Math.round(b.y), Math.round(b.r)]));
    res._debug = { base, ans, cls, set, roll };
    return res;
  };
})();

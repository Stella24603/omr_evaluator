/* Reads a photo or scan of a filled sheet.
   Pipeline: find the 4 black corner squares (confirmed by the code strip, which also says which
   way up the page is) -> flatten the page -> nudge each bubble group onto its printed circles -> measure ink. */
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
    const half = Math.max(20, Math.round(Math.min(w, h) / 14));
    const bin = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - half), y1 = Math.min(h, y + half + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - half), x1 = Math.min(w, x + half + 1);
        const sum = integ[y1 * (w + 1) + x1] - integ[y0 * (w + 1) + x1] - integ[y1 * (w + 1) + x0] + integ[y0 * (w + 1) + x0];
        if (gray[y * w + x] < (sum / ((x1 - x0) * (y1 - y0))) * 0.65) bin[y * w + x] = 1;
      }
    }
    // connected components; keep the solid, compact ones (a filled square seen from any angle)
    const stack = new Int32Array(w * h);
    const out = [];
    const maxSide = Math.min(w, h) * 0.12;
    for (let i = 0; i < w * h; i++) {
      if (bin[i] !== 1) continue;
      let sp = 0, area = 0, gs = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, minx = w, maxx = 0, miny = h, maxy = 0;
      stack[sp++] = i; bin[i] = 2;
      while (sp) {
        const p = stack[--sp], x = p % w, y = (p - x) / w;
        area++; gs += gray[p]; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
        if (x < minx) minx = x; if (x > maxx) maxx = x;
        if (y < miny) miny = y; if (y > maxy) maxy = y;
        if (x > 0 && bin[p - 1] === 1) { bin[p - 1] = 2; stack[sp++] = p - 1; }
        if (x < w - 1 && bin[p + 1] === 1) { bin[p + 1] = 2; stack[sp++] = p + 1; }
        if (y > 0 && bin[p - w] === 1) { bin[p - w] = 2; stack[sp++] = p - w; }
        if (y < h - 1 && bin[p + w] === 1) { bin[p + w] = 2; stack[sp++] = p + w; }
      }
      const bw = maxx - minx + 1, bh = maxy - miny + 1;
      if (bw < 3 || bh < 3 || bw > maxSide || bh > maxSide || area < 9) continue;
      const mx = sx / area, my = sy / area;
      const cxx = sxx / area - mx * mx + 1 / 12, cyy = syy / area - my * my + 1 / 12, cxy = sxy / area - mx * my;
      const det = cxx * cyy - cxy * cxy;
      if (det <= 0) continue;
      const solid = area / (12 * Math.sqrt(det)); // 1 for any solid parallelogram, lower for text, rings, L-shapes
      const tr = (cxx + cyy) / 2, disc = Math.sqrt(Math.max(0, tr * tr - det));
      if (solid < 0.82 || solid > 1.15 || (tr + disc) / Math.max(1e-6, tr - disc) > 9) continue;
      // a corner square sits alone on white paper: the band just outside it must be clearly brighter
      const ex = Math.max(2, Math.round(bw * 0.35)), ey = Math.max(2, Math.round(bh * 0.35));
      let ring = 0, rn = 0, dark = 0;
      for (let k = 0; k < 24; k++) {
        const t = (k % 6) / 5, side = (k / 6) | 0;
        const px = Math.round(side === 0 || side === 2 ? minx - ex + t * (bw + 2 * ex) : side === 1 ? maxx + ex : minx - ex);
        const py = Math.round(side === 1 || side === 3 ? miny - ey + t * (bh + 2 * ey) : side === 0 ? miny - ey : maxy + ey);
        if (px < 0 || py < 0 || px >= w || py >= h) { dark++; continue; }
        ring += gray[py * w + px]; rn++;
        if (bin[py * w + px]) dark++;
      }
      if (dark > 4 || !rn || ring / rn < (gs / area) * 1.6 + 20) continue;
      out.push({ x: mx, y: my, area, solid, g: gs / area });
    }
    return out;
  }

  const polyArea = (p) => {
    let a = 0;
    for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; }
    return Math.abs(a) / 2;
  };

  /* Find the page among the blobs. The top-left corner square is the one with the code strip beside
     it: a smaller square close by and at least one more further along the same line. That line points
     at the top-right square; the two bottom squares hang below those. `verify` has the final say,
     and the largest page that passes wins. */
  function findPage(cands, gray, w, h, verify) {
    cands.sort((a, b) => b.area - a.area);
    let best = null;
    const t0 = Date.now();
    const similar = (p, q) => p.area < q.area * 6 && q.area < p.area * 6;
    // the page margin between two corner squares is blank paper (from fraction t0 of the way)
    const clear = (p, q, t0) => {
      let bad = 0;
      for (let i = 0; i < 12; i++) {
        const t = t0 + ((0.9 - t0) * i) / 11;
        const x = Math.round(p.x + (q.x - p.x) * t), y = Math.round(p.y + (q.y - p.y) * t);
        if (x < 0 || y < 0 || x >= w || y >= h || gray[y * w + x] < p.g * 1.5 + 25) bad++;
      }
      return bad <= 1;
    };
    for (const a of cands) {
      const side = Math.sqrt(a.area);
      let checks = 0; // per corner candidate, so a busy background cannot use up the whole search
      for (const c of cands) {
        if (c === a || c.area > a.area * 1.2 || c.area < a.area * 0.08) continue;
        const dac = Math.hypot(c.x - a.x, c.y - a.y);
        if (dac < side * 1.2 || dac > side * 3.4) continue;
        const ux = (c.x - a.x) / dac, uy = (c.y - a.y) / dac;
        const along = (p) => (p.x - a.x) * ux + (p.y - a.y) * uy, across = (p) => (p.x - a.x) * -uy + (p.y - a.y) * ux;
        // the strip's last square sits 49 mm (first sheets) or 55 mm from the corner square, the first one 13 mm;
        // after it the top margin is empty until the far corner
        let stop = false, stray = false;
        for (const e of cands) {
          if (e === a || e === c || Math.abs(across(e)) > side * 0.7) continue;
          const t = along(e) / dac;
          if (t > 3.3 && t < 4.8 && e.area < c.area * 3 && e.area > c.area / 3) stop = true;
          else if (t > 5.3 && t < 8 && e.area < a.area * 0.6) stray = true;
        }
        if (!stop || stray) continue;
        for (const b of cands) {
          if (b === a || !similar(a, b)) continue;
          const ab = along(b);
          if (ab < dac * 8.5 || ab > dac * 23 || Math.abs(across(b)) > ab * 0.1 || !clear(a, b, 0.45)) continue;
          for (const d of cands) {
            if (d === a || d === b || !similar(a, d)) continue;
            const ad = Math.hypot(d.x - a.x, d.y - a.y);
            if (ad < ab * 0.8 || ad > ab * 2.5 || across(d) < ad * 0.75 || along(d) > ab * 0.5 || !clear(a, d, 0.1)) continue; // bottom-left: below the top edge
            for (const e of cands) {
              if (e === a || e === b || e === d || !similar(b, e)) continue;
              const be = Math.hypot(e.x - b.x, e.y - b.y), de = Math.hypot(e.x - d.x, e.y - d.y);
              if (be < ab * 0.8 || be > ab * 2.5 || de < ab * 0.4 || de > ab * 2.5 || across(e) - across(b) < be * 0.75 || along(e) < ab * 0.5 || !clear(b, e, 0.1) || !clear(d, e, 0.1)) continue;
              if (++checks > 3000) continue;
              if (Date.now() - t0 > 4000) return best && best.r;
              const r = verify([a, b, e, d]);
              if (r && (!best || r.score > best.r.score)) best = { r }; // the clearest set of printed circles wins
              if (r && r.score >= 20) return r; // unmistakable: stop looking
            }
          }
        }
      }
    }
    return best && best.r;
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

  function refine(G, W, Hh, pts, rmm, cx, cy, range, step, anchor) {
    // slide these bubbles (around a starting offset cx, cy in mm) to sit on their printed circles.
    // G = darkest colour channel, which shows any print colour.
    const r = rmm * PPM, ro = r * 1.3;
    let best = -Infinity, bx = cx, by = cy;
    const px = (x, y) => {
      const xi = Math.round(x), yi = Math.round(y);
      return xi < 0 || yi < 0 || xi >= W || yi >= Hh ? 255 : G[yi * W + xi];
    };
    for (let dy = -range; dy <= range + 1e-6; dy += step) {
      for (let dx = -range; dx <= range + 1e-6; dx += step) {
        let score = 0;
        for (const p of pts) {
          const x = (p.x + cx + dx) * PPM, y = (p.y + cy + dy) * PPM;
          for (const [c, s] of RING) score += px(x + c * ro, y + s * ro) - px(x + c * r, y + s * r);
        }
        if (anchor) score += anchor(px, cx + dx, cy + dy);
        score -= (dx * dx + dy * dy) * pts.length * 2; // mild preference for staying put
        if (score > best) { best = score; bx = cx + dx; by = cy + dy; }
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
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= n * 0.4) { white = v; break; } }
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

    // detection copy, about 1200 px on the long side
    const ds = Math.min(1, 1200 / Math.max(sw, sh));
    const dw = Math.round(sw * ds), dh = Math.round(sh * ds);
    const det = await toCanvas(work, 1200);
    const dd = det.getContext('2d').getImageData(0, 0, dw, dh).data;
    const dgray = new Uint8Array(dw * dh);
    for (let i = 0; i < dw * dh; i++) dgray[i] = dd[i * 4]; // red channel: coloured print fades, black stays black

    // checks are sampled on the full-size photo, where the small squares are still crisp
    const sred = new Uint8Array(sw * sh);
    for (let i = 0; i < sw * sh; i++) sred[i] = sdata[i * 4];
    const at = (H, x, y, half) => meanAt(sred, sw, sh, H, x, y, half);
    const smin = new Uint8Array(sw * sh);
    for (let i = 0; i < sw * sh; i++) smin[i] = Math.min(sdata[i * 4], sdata[i * 4 + 1], sdata[i * 4 + 2]);
    // Last check, the one a patterned background cannot fake: where the first answer block should be,
    // are there 40 printed circles? Slide a template of rings around and look for a clear best fit.
    const sheetLike = (H, cfg) => {
      const L = OMR.layout(cfg), pts = L.answers.slice(0, 10).flat(), r = L.r.ans;
      const px = (x, y) => { const [u, v] = applyH(H, x, y), xi = Math.round(u), yi = Math.round(v); return xi < 0 || yi < 0 || xi >= sw || yi >= sh ? 255 : smin[yi * sw + xi]; };
      const scores = [];
      for (let dy = -4; dy <= 4.01; dy += 0.5) for (let dx = -4; dx <= 4.01; dx += 0.5) {
        let sc = 0;
        for (const p of pts) for (let i = 0; i < 16; i += 2) sc += px(p.x + dx + RING[i][0] * r * 1.3, p.y + dy + RING[i][1] * r * 1.3) - px(p.x + dx + RING[i][0] * r, p.y + dy + RING[i][1] * r);
        scores.push(sc / (pts.length * 8));
      }
      scores.sort((a, b) => a - b);
      return { peak: scores[scores.length - 1], typical: scores[scores.length >> 1] };
    };
    const S = OMR.STRIP, m = OMR.MARKER / 2;
    const D = (OMR._dbg = { log: [] });
    const cands0 = findCandidates(dgray, dw, dh); D.cands = cands0.map((c) => [Math.round(c.x / ds), Math.round(c.y / ds), c.area]);
    const found = findPage(cands0, dgray, dw, dh, (q) => {
      const note = (k, why) => { if (D.log.length < 12) D.log.push(q.map((c) => Math.round(c.x / ds) + ',' + Math.round(c.y / ds)).join(' ') + ' k' + k + ' ' + why); };
      // q = top-left, top-right, bottom-right, bottom-left
      for (let k = 0; k < 1; k++) {
        const H = solveH(OMR.MARKERS, [0, 1, 2, 3].map((i) => [q[(i + k) % 4].x / ds, q[(i + k) % 4].y / ds]));
        if (!H) continue;
        // each blob must be the size a 7 mm square would appear at that corner, all four to the same degree
        let lo = Infinity, hi = 0;
        OMR.MARKERS.forEach(([x, y], i) => {
          const want = polyArea([[x - m, y - m], [x + m, y - m], [x + m, y + m], [x - m, y + m]].map(([u, v]) => applyH(H, u, v)));
          const ratio = q[(i + k) % 4].area / (want * ds * ds);
          lo = Math.min(lo, ratio); hi = Math.max(hi, ratio);
        });
        const sizeOk = lo > 0.45 && hi < 2 && hi / lo < 1.5;
        if (!sizeOk) { note(k, 'size'); continue; }
        // white paper on all four sides of every corner square, and along the page margins
        let black = 0;
        const quiet = OMR.MARKERS.every(([x, y]) => {
          const c = at(H, x, y, 1.5);
          black = Math.max(black, c);
          return [[6.5, 0], [-6.5, 0], [0, 6.5], [0, -6.5]].every(([dx, dy]) => at(H, x + dx, y + dy, 0.8) > c * 1.5 + 25);
        });
        if (!quiet) { note(k, 'quiet'); continue; }
        let margin = 0;
        for (let t = 0; t < 9; t++) {
          if (at(H, 7, 30 + t * 30, 0.8) > black * 1.5 + 25) margin++;      // left
          if (at(H, 203, 30 + t * 30, 0.8) > black * 1.5 + 25) margin++;    // right
          if (at(H, 80 + t * 13, 11, 0.8) > black * 1.5 + 25) margin++;     // top, right of the strip
          if (at(H, 25 + t * 5 + (t > 4 ? 120 : 0), 291, 0.8) > black * 1.5 + 25) margin++; // bottom
        }
        if (margin < 30) { note(k, 'margin' + margin); continue; } // of 36; a few may be hidden by a thumb or a shadow edge
        black = at(H, OMR.MARKERS[0][0], OMR.MARKERS[0][1], 1.5);
        // the strip may sit a little off where a flat page would put it, so look around
        for (const dy of [0, -1, 1, -2, 2, -3, 3]) for (const dx of [0, -1, 1, -2, 2]) {
          const paper = at(H, S.paperRef[0] + dx, S.paperRef[1] + dy, 0.8);
          if (paper - black < 40) continue;
          const mid = (black + paper) / 2, bits = [];
          let gaps = true;
          for (let i = 0; i < S.n; i++) {
            bits.push(at(H, S.x0 + i * S.pitch + dx, S.y + dy, 0.8) < mid ? 1 : 0);
            if (at(H, S.x0 + (i + 0.5) * S.pitch + dx, S.y + dy, 0.4) < mid) gaps = false; // white between cells
          }
          const cfg = gaps && OMR.cfgFromBits(bits);
          if (!cfg) continue;
          const like = sheetLike(H, cfg);
          D.like = like;
          if (like.peak < 8 || like.peak - like.typical < 7) { note(k, 'rings' + like.peak.toFixed(1) + '/' + like.typical.toFixed(1)); return null; }
          return { cfg, H, score: like.peak };
        }
        note(k, 'strip');
      }
      return null;
    });
    if (!found) return { ok: false, error: 'Could not find the sheet in this photo. Keep all four black corner squares and the small squares on the top edge visible, and avoid strong glare or shadow.' };
    const cfg = found.cfg, h2src = found.H;

    // flatten the page
    const W = OMR.PAGE.W * PPM, Hh = OMR.PAGE.H * PPM;
    const dstPts = OMR.MARKERS.map(([x, y]) => [x * PPM, y * PPM]);
    const srcPts = OMR.MARKERS.map(([x, y]) => applyH(h2src, x, y));
    const flat = warp(sdata, sw, sh, solveH(dstPts, srcPts), W, Hh);
    const R = new Uint8Array(W * Hh), G = new Uint8Array(W * Hh);
    for (let i = 0; i < W * Hh; i++) { R[i] = flat.data[i * 4]; G[i] = Math.min(R[i], flat.data[i * 4 + 1], flat.data[i * 4 + 2]); }

    const L = OMR.layout(cfg);
    const off = new Map();
    // Paper is rarely flat: place each block coarsely, then each row / column finely.
    const place = (pts, r, range, parts, seed, anchor) => {
      const o = refine(G, W, Hh, pts, r, seed ? seed[0] : 0, seed ? seed[1] : 0, range, range > 3 ? 0.4 : 0.3, anchor);
      parts.forEach((part) => { const f = refine(G, W, Hh, part, r, o[0], o[1], 1, 0.2); part.forEach((p) => off.set(p, f)); });
      return o;
    };
    // Roll bubbles repeat every 5 mm, so a one-row slip would look almost as good. The row of
    // hand-writing boxes above them does not repeat: its top and bottom edges pin the block down.
    const wb = L.rollWrite, wx0 = wb[0].x, wx1 = wb[wb.length - 1].x + wb[0].w;
    const rollAnchor = (px, ox, oy) => {
      let sc = 0;
      for (let x = wx0 + 0.5; x < wx1; x += 0.5) for (const y of [wb[0].y, wb[0].y + wb[0].h]) {
        sc += (px((x + ox) * PPM, (y + oy - 1.2) * PPM) + px((x + ox) * PPM, (y + oy + 1.2) * PPM)) / 2 - px((x + ox) * PPM, (y + oy) * PPM);
      }
      return sc * 6;
    };
    const rollOff = place(L.roll.flat(), L.r.roll, 3.6, L.roll, null, rollAnchor);
    place(L.cls, L.r.cls, 2.4, [L.cls], rollOff);
    if (L.set.length) place(L.set, L.r.set, 2.4, [L.set], rollOff);
    L.blocks.forEach((blk) => {
      const rows = L.answers.slice(blk.first - 1, blk.first - 1 + blk.rows);
      place(rows.flat(), L.r.ans, 4, rows);
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
    res.set = cfg.sets ? one(set, 'Set') : null;
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

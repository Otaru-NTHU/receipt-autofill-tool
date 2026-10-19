// PDF analysis (pdf.js) and output (pdf-lib + fontkit)
(function (root) {
  const BASE = (root.RAF_BASE || "");
  function lib() {
    const p = root.pdfjsLib;
    if (p && !p.GlobalWorkerOptions.workerSrc) p.GlobalWorkerOptions.workerSrc = root.RAF_WORKER_SRC || (BASE + "lib/pdf.worker.min.js");
    return p;
  }

  async function analyze(bytes) {
    const pdfjs = lib();
    const opts = { data: bytes.slice(0), cMapUrl: BASE + "lib/cmaps/", cMapPacked: true, standardFontDataUrl: BASE + "lib/standard_fonts/", isEvalSupported: false };
    if (root.RAF_CMAP_JSON) opts.CMapReaderFactory = JsonCMapReader;
    const doc = await pdfjs.getDocument(opts).promise;
    const pages = []; const items = []; const vlines = {}; let tid = 0;
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      pages.push({ w: vp.width, h: vp.height, viewBox: page.view });
      const tc = await page.getTextContent();
      const raw = tc.items.filter(it => it.str && it.str.trim()).map(it => {
        const [a, b, c, d, e, f] = it.transform;
        const h = Math.hypot(c, d) || it.height || 10;
        return { str: it.str, x: e - page.view[0], y: f - page.view[1], w: it.width, h };
      }).sort((A, B) => (B.y - A.y) || (A.x - B.x));
      // merge runs on the same baseline that sit close together
      const merged = [];
      for (const it of raw) {
        const last = merged[merged.length - 1];
        if (last && Math.abs(last.y - it.y) < Math.max(2, it.h * 0.25)) {
          const gap = it.x - (last.x + last.w);
          if (gap > -it.h && gap < it.h * 1.2) {
            last.str += (gap > it.h * 0.35 ? " " : "") + it.str; last.w = it.x + it.w - last.x; last.h = Math.max(last.h, it.h); continue;
          }
        }
        merged.push({ ...it });
      }
      vlines[p] = await vectorLines(page, pdfjs.OPS);
      merged.forEach(m => items.push({ id: "t" + (++tid), page: p, str: m.str, x: r1(m.x), y: r1(m.y), w: r1(m.w), h: r1(m.h) }));
    }
    // fillable fields via pdf-lib
    const fields = [];
    try {
      const { PDFDocument, PDFTextField, PDFCheckBox } = root.PDFLib;
      const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
      const form = pdf.getForm(); const pageRefs = pdf.getPages().map(pg => pg.ref);
      form.getFields().forEach((f, i) => {
        const type = f instanceof PDFTextField ? "text" : f instanceof PDFCheckBox ? "checkbox" : null;
        if (!type) return;
        const w = f.acroField.getWidgets()[0]; if (!w) return;
        const rc = w.getRectangle(); const pref = w.P();
        let page = pref ? pageRefs.findIndex(r => r === pref || (r.objectNumber === pref.objectNumber)) + 1 : 0;
        if (page <= 0) page = 1;
        const maxLen = type === "text" ? (f.getMaxLength ? f.getMaxLength() : undefined) : undefined;
        fields.push({ id: "f" + (i + 1), name: f.getName(), type, page, x: r1(rc.x), y: r1(rc.y), w: r1(rc.width), h: r1(rc.height), maxLen, label: nearLabel(items, page, rc) });
      });
    } catch (e) { /* not loadable by pdf-lib: overlay only */ }
    const sig = pages.map(p => `${Math.round(p.w)}x${Math.round(p.h)}`).join(",") + "|" + items.map(i => i.str).join("|").slice(0, 4000) + "|" + fields.map(f => f.name).join(",");
    return { doc, pages, items, fields, sig, vlines };
  }
  const r1 = v => Math.round(v * 10) / 10;

  // CJK cmaps bundled in one JSON (for hosts that cannot serve .bcmap files)
  let cmapPack = null;
  class JsonCMapReader {
    constructor() {}
    async fetch({ name }) {
      if (!cmapPack) cmapPack = fetch(root.RAF_CMAP_JSON).then(r => r.json());
      const pack = await cmapPack; const b = pack[name];
      if (!b) throw new Error("cmap_missing:" + name);
      return { cMapData: Uint8Array.from(atob(b), c => c.charCodeAt(0)), compressionType: 1 };
    }
  }

  // vertical rules (table borders) from the page's drawing operators, in page coords
  async function vectorLines(page, OPS) {
    const out = [];
    try {
      const ol = await page.getOperatorList();
      const ox = page.view[0], oy = page.view[1];
      let ctm = [1, 0, 0, 1, 0, 0]; const stack = [];
      const mul = (m, n) => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
      const tp = (x, y) => [ctm[0] * x + ctm[2] * y + ctm[4] - ox, ctm[1] * x + ctm[3] * y + ctm[5] - oy];
      const seg = (a, b) => { if (Math.abs(a[0] - b[0]) < 1.2 && Math.abs(a[1] - b[1]) > 4) out.push({ x: r1((a[0] + b[0]) / 2), y1: r1(Math.min(a[1], b[1])), y2: r1(Math.max(a[1], b[1])) }); };
      for (let i = 0; i < ol.fnArray.length; i++) {
        const fn = ol.fnArray[i], args = ol.argsArray[i];
        if (fn === OPS.save) stack.push(ctm.slice());
        else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
        else if (fn === OPS.transform) ctm = mul(args, ctm);
        else if (fn === OPS.constructPath) {
          const sub = args[0], c = args[1]; let k = 0, cur = null, start = null;
          for (const op of sub) {
            if (op === OPS.rectangle) {
              const [x, y, w, h] = [c[k], c[k + 1], c[k + 2], c[k + 3]]; k += 4;
              const A = tp(x, y), B = tp(x + w, y), C = tp(x + w, y + h), Dd = tp(x, y + h);
              if (Math.abs(B[0] - A[0]) < 2.5) seg([(A[0] + B[0]) / 2, A[1]], [(A[0] + B[0]) / 2, C[1]]);
              else { seg(A, Dd); seg(B, C); }
            } else if (op === OPS.moveTo) { cur = start = tp(c[k], c[k + 1]); k += 2; }
            else if (op === OPS.lineTo) { const n = tp(c[k], c[k + 1]); k += 2; if (cur) seg(cur, n); cur = n; }
            else if (op === OPS.curveTo) { cur = tp(c[k + 4], c[k + 5]); k += 6; }
            else if (op === OPS.curveTo2 || op === OPS.curveTo3) { cur = tp(c[k + 2], c[k + 3]); k += 4; }
            else if (op === OPS.closePath) { if (cur && start) seg(cur, start); cur = start; }
          }
        }
      }
    } catch (e) { /* no vector info */ }
    return out;
  }

  function nearLabel(items, page, rc) {
    let best = null, bd = 1e9;
    for (const it of items) {
      if (it.page !== page) continue;
      const cy = rc.y + rc.height / 2;
      // left on same line
      if (it.y >= rc.y - 4 && it.y <= rc.y + rc.height + 2 && it.x + it.w <= rc.x + 4) { const d = rc.x - (it.x + it.w); if (d < bd && d < 220) { bd = d; best = it; } }
      // just above
      else if (it.y > rc.y + rc.height - 2 && it.y - (rc.y + rc.height) < 18 && it.x < rc.x + rc.width && it.x + it.w > rc.x) { const d = (it.y - rc.y) + 50; if (d < bd) { bd = d; best = it; } }
      void cy;
    }
    return best ? best.str : "";
  }

  async function renderPage(doc, pageNo, canvas, scale) {
    const page = await doc.getPage(pageNo);
    const vp = page.getViewport({ scale });
    const dpr = Math.min(root.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(vp.width * dpr); canvas.height = Math.floor(vp.height * dpr);
    canvas.style.width = vp.width + "px"; canvas.style.height = vp.height + "px";
    const ctx = canvas.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    return vp;
  }

  let fontCache = null;
  async function fontBytes() {
    if (!fontCache) fontCache = fetch(root.RAF_FONT_URL || (BASE + "fonts/NotoSansTC-Big5.ttf")).then(r => { if (!r.ok) throw new Error("font_load"); return r.arrayBuffer(); });
    return fontCache;
  }

  // fills: [{field, text}] ; checks: [{field, on}] ; places: [{page,x,y,size,text}]
  async function build(bytes, { fills = [], checks = [], places = [] }, fieldIndex) {
    const { PDFDocument, rgb } = root.PDFLib;
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
    pdf.registerFontkit(root.fontkit);
    const font = await pdf.embedFont(await fontBytes(), { subset: true });
    if (fills.length || checks.length) {
      const form = pdf.getForm();
      for (const f of fills) { const meta = fieldIndex[f.field]; if (!meta) continue; try { const tf = form.getTextField(meta.name); let t = f.text; if (meta.maxLen && t.length > meta.maxLen) t = t.slice(0, meta.maxLen); tf.setText(t); } catch (e) { console.warn(e); } }
      for (const c of checks) { const meta = fieldIndex[c.field]; if (!meta) continue; try { const cb = form.getCheckBox(meta.name); c.on ? cb.check() : cb.uncheck(); } catch (e) { console.warn(e); } }
      try { form.updateFieldAppearances(font); } catch (e) { console.warn(e); }
    }
    const pages = pdf.getPages();
    for (const p of places) {
      const pg = pages[p.page - 1]; if (!pg || !p.text) continue;
      const box = pg.getMediaBox();
      const color = rgb(0.05, 0.08, 0.2), size = p.size || 11;
      if (Array.isArray(p.xs) && p.xs.length) {
        const chars = Array.from(p.text.replace(/[\s-]/g, ""));
        chars.forEach((ch, i) => { const cx = p.xs[i]; if (cx == null) return; const w = font.widthOfTextAtSize(ch, size); pg.drawText(ch, { x: cx - w / 2 + box.x, y: p.y + box.y, size, font, color }); });
      } else pg.drawText(p.text, { x: p.x + box.x, y: p.y + box.y, size, font, color });
    }
    return pdf.save();
  }
  root.PdfFill = { analyze, renderPage, build, fontBytes };
})(this);

// Watermark ID/passbook images and lay them out on one A4 PDF (pdf-lib)
(function (root) {
  const COLORS = { red: [200, 0, 0], blue: [0, 0, 180], black: [0, 0, 0] };

  function loadImage(src) {
    return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("image_load")); i.src = src; });
  }

  // same visual logic as passport-watermark-tool: tiled 3-line text at -30°, dashed border
  function draw(img, opt) {
    const c = document.createElement("canvas"); c.width = img.naturalWidth || img.width; c.height = img.naturalHeight || img.height;
    const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0);
    const [r, g, b] = COLORS[opt.color] || COLORS.red; const a = opt.opacity;
    const color = `rgba(${r},${g},${b},${a})`;
    const scale = Math.max(c.width, c.height) / 1000;
    const fs = Math.round(opt.size * scale);
    ctx.save(); ctx.translate(c.width / 2, c.height / 2); ctx.rotate(-30 * Math.PI / 180);
    const lh = fs * 1.35, block = lh * 3.2, rx = c.width * 1.8, ry = c.height * 1.8;
    const family = '"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';
    ctx.fillStyle = color; ctx.textAlign = "center";
    const lines = [opt.line1, opt.line2, opt.date].filter(Boolean);
    const longest = Math.max(...lines.map(s => s.length), 8);
    const stepX = Math.max(fs * 16, fs * longest * 1.15);
    for (let y = -ry / 2; y < ry / 2; y += block) {
      for (let x = -rx / 2; x < rx / 2; x += stepX) {
        ctx.font = `700 ${fs}px ${family}`; if (opt.line1) ctx.fillText(opt.line1, x, y);
        ctx.font = `500 ${Math.round(fs * 0.85)}px ${family}`; if (opt.line2) ctx.fillText(opt.line2, x, y + lh);
        ctx.font = `400 ${Math.round(fs * 0.65)}px ${family}`; if (opt.date) ctx.fillText(opt.date, x, y + lh * 2);
      }
    }
    ctx.restore();
    ctx.save(); ctx.strokeStyle = `rgba(${r},${g},${b},${Math.min(a * 1.5, 0.6)})`; ctx.lineWidth = Math.round(4 * scale);
    ctx.setLineDash([Math.round(12 * scale), Math.round(6 * scale)]);
    const inset = Math.round(15 * scale); ctx.strokeRect(inset, inset, c.width - inset * 2, c.height - inset * 2); ctx.restore();
    return c;
  }

  const MM = 72 / 25.4;
  // images: {id_front, id_back, passbook} dataURLs (any may be missing)
  async function buildA4(images, opt) {
    const { PDFDocument } = root.PDFLib;
    const pdf = await PDFDocument.create();
    pdf.setTitle("身分證及存摺影本"); pdf.setProducer("receipt-autofill-tool"); pdf.setCreator("receipt-autofill-tool");
    const page = pdf.addPage([595.28, 841.89]);
    const W = 595.28, H = 841.89;
    const k = opt.enlarge ? 1.4 : 1;
    const cw = 85.6 * MM * k, ch = 54 * MM * k, gap = 10 * MM;
    const embed = async src => { const img = await loadImage(src); const cv = draw(img, opt); const bytes = await new Promise(r => cv.toBlob(b => b.arrayBuffer().then(r), "image/jpeg", 0.92)); return { e: await pdf.embedJpg(bytes), w: cv.width, h: cv.height }; };
    const fitIn = (im, bw, bh) => { const s = Math.min(bw / im.w, bh / im.h); return [im.w * s, im.h * s]; };
    let top = H - 48;
    const ids = [images.id_front, images.id_back].filter(Boolean);
    if (ids.length) {
      const totalW = ids.length * cw + (ids.length - 1) * gap;
      const twoRows = totalW > W - 60;
      let x = (W - (twoRows ? cw : totalW)) / 2;
      for (const src of ids) {
        const im = await embed(src); const [w, h] = fitIn(im, cw, ch);
        page.drawImage(im.e, { x: x + (cw - w) / 2, y: top - ch + (ch - h) / 2, width: w, height: h });
        if (twoRows) top -= ch + gap; else x += cw + gap;
      }
      if (!twoRows) top -= ch + gap * 1.5;
    }
    if (images.passbook) {
      const im = await embed(images.passbook);
      const maxW = Math.min(W - 80, 150 * MM * k), maxH = top - 48;
      const [w, h] = fitIn(im, maxW, maxH);
      page.drawImage(im.e, { x: (W - w) / 2, y: top - h, width: w, height: h });
    }
    return pdf.save();
  }
  const api = { draw, buildA4, loadImage };
  root.Watermark = api;
})(this);

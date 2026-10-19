// DocxFill engine — works in browser (global DocxFill) and Node (module.exports)
(function (root) {
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const kids = (el, name) => Array.from(el.childNodes || []).filter(n => n.nodeType === 1 && n.nodeName === name);
  const closest = (el, name) => { let p = el.parentNode; while (p && p.nodeName !== name) p = p.parentNode; return p; };
  const desc = (el, name) => Array.from(el.getElementsByTagName(name));

  // text nodes (<w:t>) belonging to this paragraph only (not nested text boxes)
  function tNodes(p) { return desc(p, "w:t").filter(t => closest(t, "w:p") === p); }
  function pText(p) { return tNodes(p).map(t => t.textContent).join(""); }
  function cellParas(tc) { return kids(tc, "w:p").concat(kids(tc, "w:sdt").flatMap(s => kids(s, "w:sdtContent").flatMap(c => kids(c, "w:p")))); }

  // Build an outline of the body: ids for paragraphs (p#) and table cells (c#)
  function analyze(doc) {
    const body = doc.getElementsByTagName("w:body")[0];
    const map = {}; const lines = []; const blocks = [];
    let pn = 0, cn = 0, tn = 0;
    function walk(container, depth, out) {
      for (const el of Array.from(container.childNodes)) {
        if (el.nodeType !== 1) continue;
        if (el.nodeName === "w:sdt") { kids(el, "w:sdtContent").forEach(c => walk(c, depth, out)); continue; }
        if (el.nodeName === "w:p") {
          const id = "p" + (++pn); map[id] = { kind: "p", el };
          const t = pText(el);
          if (t.trim()) lines.push("  ".repeat(depth) + `[${id}] ${JSON.stringify(t)}`);
          out.push({ type: "p", id });
        } else if (el.nodeName === "w:tbl") {
          const tid = "T" + (++tn);
          lines.push("  ".repeat(depth) + `<${tid}>`);
          const tb = { type: "tbl", rows: [] };
          kids(el, "w:tr").forEach((tr, ri) => {
            const cells = []; const row = [];
            kids(tr, "w:tc").forEach(tc => {
              const id = "c" + (++cn); map[id] = { kind: "c", el: tc };
              const pr = kids(tc, "w:tcPr")[0];
              const span = pr && kids(pr, "w:gridSpan")[0] ? +kids(pr, "w:gridSpan")[0].getAttribute("w:val") : 1;
              const vm = pr && kids(pr, "w:vMerge")[0];
              const vmCont = vm && vm.getAttribute("w:val") !== "restart";
              const t = cellParas(tc).map(pText).join(" / ");
              cells.push(`[${id}${span > 1 ? " span" + span : ""}${vmCont ? " (merged↑)" : ""}] ${JSON.stringify(t)}`);
              const inner = [];
              kids(tc, "w:tbl").forEach(nt => walk({ childNodes: [nt] }, depth + 2, inner));
              row.push({ id, span, vmCont, inner });
            });
            lines.push("  ".repeat(depth + 1) + `R${ri + 1}: ` + cells.join(" | "));
            row.forEach(c => { if (c.inner.length) { /* nested printed by walk */ } });
            tb.rows.push(row);
          });
          lines.push("  ".repeat(depth) + `</${tid}>`);
          out.push(tb);
        }
      }
    }
    walk(body, 0, blocks);
    return { map, outline: lines.join("\n"), blocks };
  }

  function setT(t, s) { t.textContent = s; t.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve"); }

  function newRunIn(doc, p) {
    const r = doc.createElementNS(W, "w:r");
    const pPr = kids(p, "w:pPr")[0];
    const mark = pPr && kids(pPr, "w:rPr")[0];
    if (mark) {
      const rPr = doc.createElementNS(W, "w:rPr");
      Array.from(mark.childNodes).forEach(n => { if (n.nodeType === 1 && !/^w:(ins|del|rPrChange|moveFrom|moveTo)$/.test(n.nodeName)) rPr.appendChild(n.cloneNode(true)); });
      r.appendChild(rPr);
    }
    const t = doc.createElementNS(W, "w:t"); r.appendChild(t);
    if (pPr && pPr.nextSibling) p.insertBefore(r, pPr.nextSibling); else if (pPr) p.appendChild(r); else p.insertBefore(r, p.firstChild);
    return t;
  }

  function setPara(doc, p, s) {
    const ts = tNodes(p);
    if (ts.length) { setT(ts[0], s); ts.slice(1).forEach(t => setT(t, "")); }
    else setT(newRunIn(doc, p), s);
  }

  function setTarget(doc, m, s) {
    if (m.kind === "p") return setPara(doc, m.el, s);
    let ps = cellParas(m.el);
    if (!ps.length) { const p = doc.createElementNS(W, "w:p"); m.el.appendChild(p); ps = [p]; }
    setPara(doc, ps[0], s);
    ps.slice(1).forEach(p => tNodes(p).forEach(t => setT(t, "")));
  }

  function replaceIn(m, find, value, occurrence) {
    const ps = m.kind === "p" ? [m.el] : cellParas(m.el);
    let seen = 0;
    for (const p of ps) {
      const ts = tNodes(p); const texts = ts.map(t => t.textContent); const full = texts.join("");
      let from = 0, idx;
      while ((idx = full.indexOf(find, from)) !== -1) {
        seen++;
        if (seen === (occurrence || 1)) {
          const end = idx + find.length; let off = 0; let placed = false;
          ts.forEach((t, i) => {
            const a = off, b = off + texts[i].length; off = b;
            if (b <= idx || a >= end) return;
            const s = texts[i]; const ls = Math.max(idx - a, 0), le = Math.min(end - a, s.length);
            if (!placed) { setT(t, s.slice(0, ls) + value + s.slice(le)); placed = true; }
            else setT(t, s.slice(le));
          });
          return true;
        }
        from = idx + Math.max(find.length, 1);
      }
    }
    return false;
  }

  // ops: {op:"set",target,value} | {op:"replace",target,find,value,occurrence?} | {op:"spread",targets:[],value}
  function apply(doc, map, ops, render) {
    const results = [];
    for (const op of ops) {
      if (op.enabled === false) { results.push({ op, ok: false, msg: "已略過" }); continue; }
      const val = render(op);
      if (val == null || val === "") { results.push({ op, ok: false, msg: "沒有對應資料" }); continue; }
      try {
        if (op.op === "spread") {
          const chars = Array.from(String(val).replace(/[\s-]/g, ""));
          const tg = op.targets || [];
          if (chars.length > tg.length) { results.push({ op, ok: false, msg: `格子不足（${chars.length}字/${tg.length}格）` }); continue; }
          const start = op.align === "right" ? tg.length - chars.length : 0;
          tg.forEach((id, i) => { const m = map[id]; if (m) setTarget(doc, m, chars[i - start] || ""); });
          results.push({ op, ok: true, val });
        } else {
          const m = map[op.target];
          if (!m) { results.push({ op, ok: false, msg: "找不到位置 " + op.target }); continue; }
          if (op.op === "set") { setTarget(doc, m, String(val)); results.push({ op, ok: true, val }); }
          else if (op.op === "replace") {
            const ok = replaceIn(m, op.find, String(val), op.occurrence);
            results.push({ op, ok, val, msg: ok ? "" : "找不到文字「" + op.find + "」" });
          } else results.push({ op, ok: false, msg: "未知操作" });
        }
      } catch (e) { results.push({ op, ok: false, msg: String(e.message || e) }); }
    }
    return results;
  }

  function touchedIds(ops) { const s = new Set(); ops.forEach(o => { if (o.target) s.add(o.target); (o.targets || []).forEach(t => s.add(t)); }); return s; }

  // ---------- value helpers ----------
  function cnAmount(n) {
    n = Math.round(Number(n)); if (!isFinite(n) || n <= 0) return "";
    const d = "零壹貳參肆伍陸柒捌玖", u = ["", "拾", "佰", "仟"], big = ["", "萬", "億"];
    let s = "", gi = 0, needZero = false;
    while (n > 0) {
      const g = n % 10000; n = Math.floor(n / 10000);
      if (g) {
        let gs = "", zero = false, x = g;
        for (let i = 0; i < 4; i++) { const dd = x % 10; x = Math.floor(x / 10); if (dd) { gs = d[dd] + u[i] + (zero && gs ? "零" : "") + gs; zero = false; } else if (gs) zero = true; }
        s = gs + big[gi] + (needZero && s ? "零" : "") + s;
        needZero = g < 1000;
      } else if (s) needZero = true;
      gi++;
    }
    return s + "元整";
  }
  function roc(dateStr) {
    if (!dateStr) return null; const [y, m, d] = dateStr.split("-").map(Number); if (!y) return null;
    return { y: String(y - 1911), m: String(m), d: String(d), full: `${y - 1911}年${m}月${d}日`, ad: `${y}/${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}` };
  }

  const api = { analyze, apply, touchedIds, cnAmount, roc, pText, cellParas, kids };
  if (typeof module !== "undefined") module.exports = api; else root.DocxFill = api;
})(this);

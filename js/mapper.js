// Field catalog + offline rule-based mapping (docx outline and PDF text)
(function (root) {
  // ---------- field catalog ----------
  // sens: never sent to Claude in AI mode; digits: one-char-per-box candidate
  const FIELDS = [
    { g: "基本資料", items: [
      { k: "name", l: "姓名" }, { k: "name_en", l: "英文姓名" },
      { k: "id_no", l: "身分證字號", sens: 1, mono: 1, digits: 1 }, { k: "birth", l: "出生日期", sens: 1, ph: "例：民國70年1月1日" },
      { k: "nationality", l: "國籍", def: "中華民國" }, { k: "identity", l: "身分別", def: "校外專家學者" }] },
    { g: "服務單位", items: [{ k: "org", l: "服務單位" }, { k: "title", l: "職稱" }] },
    { g: "聯絡方式", items: [
      { k: "mobile", l: "手機", sens: 1, mono: 1 }, { k: "phone", l: "市話", sens: 1, mono: 1, ph: "例：03-5715131" }, { k: "email", l: "Email" }] },
    { g: "地址", items: [
      { k: "zip", l: "戶籍郵遞區號", sens: 1, mono: 1, digits: 1 }, { k: "address", l: "戶籍地址", sens: 1 },
      { k: "mail_zip", l: "通訊郵遞區號", sens: 1, mono: 1, digits: 1, ph: "空白則同戶籍" }, { k: "mail_address", l: "通訊地址", sens: 1, ph: "空白則同戶籍" }] },
    { g: "匯款帳戶", items: [
      { k: "bank_name", l: "銀行名稱", sens: 1, ph: "例：中華郵政" }, { k: "bank_code", l: "銀行代碼", sens: 1, mono: 1, digits: 1, ph: "3 碼，例：700" },
      { k: "bank_branch", l: "分行名稱", sens: 1, ph: "例：新竹光復路郵局" }, { k: "branch_code", l: "分行代碼", sens: 1, mono: 1, digits: 1, ph: "4 碼" },
      { k: "account", l: "帳號", sens: 1, mono: 1, digits: 1, ph: "含檢查碼，可含 -" }, { k: "account_name", l: "戶名", sens: 1 }] },
  ];
  const ALL = FIELDS.flatMap(g => g.items);
  const LABEL = Object.fromEntries(ALL.map(f => [f.k, f.l]));
  Object.assign(LABEL, { phone_any: "電話", event_title: "講題／活動", event_org: "邀請單位", event_hours: "時數", event_place: "地點", event_time: "時間",
    amount: "金額", amount_fmt: "金額", amount_cn: "國字金額", event_date: "活動日期", today_full: "填表日期", zip_address: "戶籍地址", mail_zip_address: "通訊地址" });

  // ---------- label dictionary (first match wins; tested on whitespace-stripped label text) ----------
  const RULES = [
    ["name_en", /英文姓名|英文名/],
    ["id_no", /身[分份]證(統一)?(字號|號碼|編號)?|國民身[分份]|統一證號|身[分份]字號/],
    ["account_name", /^(存款)?戶名|帳戶名稱/],
    ["branch_code", /分行代[碼號]|分支機構代[碼號]|分局代[碼號]/],
    ["bank_code", /銀行代[碼號]|金融機構代[碼號]|總行代[碼號]|^代[碼號]$/],
    ["account", /帳號|帳戶號碼|存簿號碼/],
    ["bank_branch", /分行(名稱|別)?$|分支機構(名稱)?$|分行$/],
    ["bank_name", /銀行(名稱|別)?|金融機構(名稱)?|匯入銀行|受款銀行|^郵局$/],
    ["mail_zip_address", /通訊(地址|處|住址)|聯絡(地址|住址)|郵寄地址|現居(地址|住址)|居住地址|寄送地址/],
    ["zip_address", /戶籍(地址|地|住址)?|^(地址|住址)$/],
    ["mobile", /手機|行動電話/],
    ["phone_any", /電話/],
    ["email", /e-?mail|電子(郵件|信箱)|信箱/i],
    ["birth", /出生(年月日|日期)?|生日/],
    ["org", /服務(單位|機關|機構)|任職(單位|機關)|現職(單位)?|工作單位/],
    ["title", /職稱|職務|職級/],
    ["nationality", /國籍/],
    ["event_title", /講題|(講座|演講|課程|活動)(名稱|主題|題目)|事由/],
    ["event_hours", /時數/],
    ["amount_cn", /(國字|大寫)(金額)?/],
    ["amount_fmt", /^(請領|領款|應領|支領)?(金額|鐘點費|講座費|演講費|出席費|稿費)$/],
    ["name", /^(受款人|領款人|講者|講師|具領人|申請人|主講人)?姓名$|^受款人$|^領款人$/],
  ];
  const SKIP = /簽|章|蓋|捺|承辦|主管|會計|出納|核[定章銷對]|審[核查]|驗收|用印|傳票|實[領付]|扣繳|補充保費|所得稅|淨額|備註|說明|附件|黏貼|影本/;
  const DIGIT_KEYS = new Set(["id_no", "account", "bank_code", "branch_code", "zip", "mail_zip"]);

  const strip = s => String(s || "").replace(/[\s　]/g, "");
  const dropHints = s => String(s || "").replace(/[（(][^）)]*[）)]/g, "").replace(/[※＊*].*$/, "");
  function keyOf(raw) {
    const t = strip(dropHints(raw)).replace(/[:：]$/, "");
    if (!t || t.length > 14 || SKIP.test(t)) return null;
    for (const [k, re] of RULES) if (re.test(t)) return k;
    return null;
  }
  const BLANKISH = /^[\s　_＿□\.．…\-－]*$/;
  const HINT_ONLY = s => { const t = strip(s); return !!t && BLANKISH.test(dropHints(s)) && /[（(]/.test(t); };

  // template string for a key
  const TPL = { zip_address: "{zip_address}", mail_zip_address: "{mail_zip_address}" };
  const tplFor = k => TPL[k] || `{${k}}`;

  // ---------- docx ----------
  // analysis: result of DocxFill.analyze; textOf(id) gives text of a cell/paragraph
  function mapDocx(analysis, textOf, parasOf, opts) {
    opts = opts || {};
    const ops = []; const used = new Set();
    const add = op => { const ts = op.targets || [op.target]; if (op.op !== "replace" && ts.some(t => used.has(t))) return; if (op.op !== "replace") ts.forEach(t => used.add(t)); ops.push(op); };

    function inline(id) {
      // "標籤：____" patterns inside one paragraph (a cell may hold several)
      const paras = parasOf(id); let found = false; const prior = {};
      for (const text of paras) {
        const re = /([^\s　：:（）()，,；;。]{1,10})[：:]((?:[\s　_＿]|（[\s　]*）|\([\s　]*\))*)(?=$|[^\s　_＿]{1,10}[：:]|[（(])/g;
        let m;
        while ((m = re.exec(text))) {
          const k = keyOf(m[1]);
          if (!k) continue;
          const occ = (prior[m[0]] || 0) + countBefore(text, m[0], m.index);
          add({ op: "replace", target: id, find: m[0], value: `${m[1]}：${tplFor(k)}`, label: LABEL[k] || k, key: k, occurrence: occ });
          found = true;
        }
        let i = -1; const seenHere = {};
        re.lastIndex = 0; let mm; while ((mm = re.exec(text))) seenHere[mm[0]] = (seenHere[mm[0]] || 0) + 1;
        for (const k in seenHere) prior[k] = (prior[k] || 0) + seenHere[k];
      }
      return found;
    }
    function countBefore(text, find, idx) { let n = 0, i = -1; while ((i = text.indexOf(find, i + 1)) !== -1 && i <= idx) n++; return n || 1; }
    function dateFill(id, text) {
      if (opts.dateDone || /出生|生日/.test(text)) return false;
      for (const p of parasOf(id)) {
        const full = p.match(/年[\s　]+月[\s　]+日/);
        if (!full) continue;
        add({ op: "replace", target: id, find: full[0], value: "{today_y} 年 {today_m} 月 {today_d} 日", label: "填表日期", key: "today_full" });
        opts.dateDone = true; return true;
      }
      return false;
    }

    function walk(blocks) {
      for (const b of blocks) {
        if (b.type === "p") { const t = textOf(b.id); if (t.trim()) { inline(b.id); dateFill(b.id, t); } continue; }
        const rows = b.rows;
        rows.forEach((row, ri) => {
          row.forEach((c, ci) => {
            if (c.inner && c.inner.length) walk(c.inner);
            if (c.vmCont) return;
            const t = textOf(c.id);
            const k = keyOf(t);
            const next = row[ci + 1];
            if (k) {
              // label cell → target to the right, or the row below
              const isDigits = DIGIT_KEYS.has(k);
              const rightCells = []; for (let j = ci + 1; j < row.length && BLANKISH.test(textOf(row[j].id)) && !row[j].vmCont; j++) rightCells.push(row[j].id);
              if (isDigits && rightCells.length >= 3) { add({ op: "spread", targets: rightCells, value: tplFor(k), label: LABEL[k], key: k, align: "left" }); return; }
              if (rightCells.length) { add({ op: "set", target: rightCells[0], value: tplFor(k), label: LABEL[k], key: k }); return; }
              if (next && HINT_ONLY(textOf(next.id))) {
                const nt = textOf(next.id).replace(/^[\s　]+/, ""); const find = nt.slice(0, Math.min(nt.length, 4));
                add({ op: "replace", target: next.id, find, value: `${tplFor(k)}　${find}`, label: LABEL[k], key: k }); return;
              }
              if (!next) {
                const below = rows[ri + 1];
                if (below && below.every(x => BLANKISH.test(textOf(x.id)))) {
                  if (isDigits && below.length >= 3) add({ op: "spread", targets: below.map(x => x.id), value: tplFor(k), label: LABEL[k], key: k, align: "left" });
                  else add({ op: "set", target: below[0].id, value: tplFor(k), label: LABEL[k], key: k });
                  return;
                }
              }
            }
            // inline labels inside this cell (skip a label column whose twin sits to the right)
            if (next && strip(textOf(next.id)) === strip(t)) return;
            if (!inline(c.id)) dateFill(c.id, t);
          });
        });
      }
    }
    walk(analysis.blocks);
    return { title: "", ops, left_blank: [], missing: [], mode: "rule" };
  }

  // ---------- PDF (text items: {id,page,str,x,y,w,h}) ----------
  function mapPdfText(items, opts) {
    opts = opts || {}; const vlines = opts.vlines || {};
    const places = []; let dateDone = false;
    const norm = t => strip(t);
    const hasTwinRight = it => items.some(o => o !== it && o.page === it.page && o.x > it.x + 20 && Math.abs(o.y - it.y) < 40 && norm(o.str) === norm(it.str));
    const sameRow = (it, o) => o.page === it.page && Math.abs(o.y - it.y) < Math.max(4, it.h * 0.6);
    for (const it of items) {
      const s = it.str;
      if (hasTwinRight(it)) continue;
      // inline "label：" possibly with more after
      const re = /([^\s　：:（）()]{1,10})[：:]/g; let m; let hit = false;
      while ((m = re.exec(s))) {
        const k = keyOf(m[1]); if (!k) continue;
        const rest = s.slice(m.index + m[0].length);
        if (rest.trim() && !/^[\s　_＿]+/.test(rest) && !/^[（(]/.test(rest.trim()) && !/^[^\s　]{1,10}[：:]/.test(rest.trim())) continue;
        const frac = (m.index + m[0].length) / Math.max(s.length, 1);
        let x = it.x + it.w * frac + 3;
        if (/^[\s　]*[（(][\s　]*$/.test(rest)) {
          const close = items.filter(o => sameRow(it, o) && o.x > it.x && /^[\s　]*[）)]/.test(o.str)).sort((a, b) => a.x - b.x)[0];
          x = close ? close.x + close.w + 3 : it.x + it.w + 3;
        } else if (/^[\s　_＿（）()]+$/.test(rest)) x = it.x + it.w + 3;
        pushPlace(k, it, x);
        hit = true;
      }
      if (hit) continue;
      const k = keyOf(s);
      if (k) {
        const cells = cellsRight(it);
        if (DIGIT_KEYS.has(k) && cells.boxes.length >= 3) pushPlace(k, it, cells.boxes[0] - 4, cells.boxes);
        else if (DIGIT_KEYS.has(k) && boxesBelow(it)) { const bb = boxesBelow(it); pushPlace(k, { ...it, y: bb.y }, bb.boxes[0] - 4, bb.boxes); }
        else {
          let x = cells.first != null && cells.first - (it.x + it.w) >= 2 ? cells.first + 4 : it.x + it.w + 6;
          // skip over a hint or □□□ already printed at the start of that cell
          const block = items.filter(o => o !== it && sameRow(it, o) && o.x >= x - 6 && o.x < x + 60).sort((a, b) => a.x - b.x)[0];
          if (block && (/^[\s　□＿_]+$/.test(block.str) || /^[（(]/.test(block.str.trim()))) x = block.x + block.w + 6;
          pushPlace(k, it, x);
        }
      }
      // date "年 月 日"
      if (!dateDone && /年[\s　]*月[\s　]*日/.test(s) && !/出生|生日/.test(s) && (/[\s　]{2,}/.test(s) || /中華民國/.test(s) || /^[\s　]*年[\s　]+月[\s　]+日[\s　]*$/.test(s))) {
        const L = s.length, cw = it.w / Math.max(L, 1);
        const yi = s.indexOf("年"), mi = s.indexOf("月", yi), di = s.indexOf("日", mi);
        const base = fit(it.h);
        // year sits left of 年; month/day are centred in the gap before 月/日 and shrunk to fit
        const slot = (from, to) => { const gap = (to - from - 1) * cw; const size = Math.max(6, Math.min(base, gap / 1.3)); return { x: r1(it.x + cw * (from + 1) + gap / 2 - size * 0.55), size: r1(size) }; };
        const yr = { x: r1(it.x + cw * yi - base * 1.9), size: base };
        const mo = slot(yi, mi), dy = slot(mi, di);
        [["{today_y}", yr], ["{today_m}", mo], ["{today_d}", dy]].forEach(([v, q]) => places.push({ page: it.page, x: q.x, y: it.y, size: q.size, value: v, label: "填表日期", key: "today_full" }));
        dateDone = true;
      }
    }
    // vertical rules to the right of a label, on the label's row
    function cellsRight(it) {
      const ys = it.y + it.h * 0.35, x0 = it.x + it.w - 1;
      const xs = linesAt(it.page, ys).filter(x => x > x0 && x < x0 + 640);
      return { first: xs.length ? xs[0] : null, boxes: boxRun(xs) };
    }
    function linesAt(page, y) { return [...new Set((vlines[page] || []).filter(l => l.x > 2 && l.y2 - l.y1 < 600 && l.y1 <= y && l.y2 >= y).map(l => Math.round(l.x * 2) / 2))].sort((a, b) => a - b); }
    function boxRun(xs) {
      const boxes = [];
      for (let i = 0; i + 1 < xs.length; i++) { const w = xs[i + 1] - xs[i]; if (w < 6) continue; if (w > 50) { if (boxes.length >= 3) break; boxes.length = 0; continue; } boxes.push(r1((xs[i] + xs[i + 1]) / 2)); }
      return boxes;
    }
    // a row of small boxes just under the label (e.g. 帳號 label row, digit boxes below)
    function boxesBelow(it) {
      for (let d = 6; d <= 44; d += 3) {
        const y = it.y - d; const b = boxRun(linesAt(it.page, y));
        if (b.length >= 3) {
          const ls = (vlines[it.page] || []).filter(l => l.y1 <= y && l.y2 >= y);
          const top = Math.min(...ls.map(l => l.y2)), bot = Math.max(...ls.map(l => l.y1));
          return { boxes: b, y: r1((top + bot) / 2 - it.h * 0.35) };
        }
      }
      return null;
    }
    function pushPlace(k, it, x, xs) {
      // one per key per row: a later (further right) match on the same row replaces the earlier one
      const same = places.findIndex(p => p.key === k && p.page === it.page && Math.abs(p.y - it.y) < 3);
      const pl = { page: it.page, x: r1(x), y: it.y, size: fit(it.h), value: tplFor(k), label: LABEL[k] || k, key: k };
      if (xs) pl.xs = xs;
      if (same >= 0) places[same] = pl; else places.push(pl);
    }
    return { title: "", places, left_blank: [], missing: [], mode: "rule" };
  }
  const r1 = v => Math.round(v * 10) / 10;
  const fit = h => Math.max(8, Math.min(12, Math.round((h || 11) * 0.95)));

  // fillable fields: [{id,name,label}] → fills
  function mapPdfFields(fields) {
    const fills = []; const used = new Set();
    for (const f of fields) {
      const k = keyOf(f.label) || keyOf(cleanName(f.name));
      if (!k || used.has(k + f.label)) continue;
      used.add(k + f.label);
      fills.push({ field: f.id, value: tplFor(k), label: LABEL[k] || k, key: k });
    }
    return { title: "", fills, places: [], left_blank: [], missing: [], mode: "rule" };
  }
  const cleanName = n => String(n || "").replace(/^.*[.\/]/, "").replace(/\[\d+\]$/, "").replace(/[_\d]+$/, "");

  const api = { FIELDS, ALL, LABEL, keyOf, mapDocx, mapPdfText, mapPdfFields, DIGIT_KEYS };
  if (typeof module !== "undefined") module.exports = api; else root.Mapper = api;
})(this);

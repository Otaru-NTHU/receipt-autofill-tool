(function () {
"use strict";
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const { FIELDS, ALL, LABEL } = Mapper;
const LS_VAULT = "raf-vault-v1";
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); return true; } catch { return false; } };

function toast(t, ms) { const el = $("#toast"); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, ms || 3500); }

// ======================================================================
// claude.ai runtime (optional)
// ======================================================================
let sample = null, downloads = null;
async function initRuntime() {
  if (!window.claude || typeof window.claude.use !== "function") return;
  try {
    const [s, d] = await Promise.all([window.claude.use("sample").catch(() => null), window.claude.use("downloads").catch(() => null)]);
    sample = s; downloads = d;
  } catch {}
  if (sample) { const b = $("#modeBadge"); b.textContent = "AI 判斷（Claude）"; b.classList.add("ai"); $("#btnAI").hidden = false; $("#noteRow").hidden = false; refreshButtons(); }
}
async function saveBlob(name, blob) {
  if (downloads) {
    try { await downloads.save({ filename: name, data: blob }); return true; }
    catch (e) { if (!/cancel|declin/.test(e.code || "")) toast("下載失敗：" + (e.message || e.code)); return false; }
  }
  if (window.claude) { toast("這個檢視方式不能下載檔案"); return false; }
  const url = URL.createObjectURL(blob); const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000); return true;
}

// ======================================================================
// vault (encrypted data)
// ======================================================================
let K = null;           // {key, salt, iter}
let D = null;           // decrypted data
let dirty = false, remember = true, fileHandle = null;
function blankData() {
  const profile = {}; ALL.forEach(f => profile[f.k] = f.def || "");
  return { version: 1, profile, custom: [], images: {}, templates: {}, wm: { color: "red", opacity: 35, size: 42, line2: "他用無效", enlarge: false } };
}
function normalize(d) {
  const b = blankData(); d = d || {};
  return { version: 1, profile: { ...b.profile, ...(d.profile || {}) }, custom: Array.isArray(d.custom) ? d.custom : [], images: d.images || {}, templates: d.templates || {}, wm: { ...b.wm, ...(d.wm || {}) } };
}
function setVaultState() {
  const el = $("#vaultState");
  if (dirty) { el.textContent = remember ? "● 已暫存在這台電腦，尚未存成檔案" : "● 有未儲存的變更"; el.className = "vault-state dirty"; }
  else { el.textContent = "✓ 資料檔已儲存"; el.className = "vault-state clean"; }
}
let persistT = null;
function markDirty() {
  dirty = true; setVaultState();
  clearTimeout(persistT);
  persistT = setTimeout(async () => { if (remember && K && D) { const env = await Vault.seal(D, K); lsSet(LS_VAULT, JSON.stringify(env)); } }, 600);
}
async function unlocked(data, k, rememberIt) {
  K = k; D = normalize(data); remember = rememberIt;
  if (remember) lsSet(LS_VAULT, JSON.stringify(await Vault.seal(D, K)));
  $("#lockScreen").hidden = true; $("#app").hidden = false; $("#vaultBar").hidden = false;
  dirty = false; setVaultState();
  renderProfile(); renderSlots(); loadWmPrefs(); renderDerived(); profileWarn(); renderWmPreview();
  $("#tplCount").textContent = Object.keys(D.templates).length;
}
function lockMsg(t, ok) { const m = $("#lockMsg"); m.textContent = t; m.className = "msg" + (ok ? " ok" : ""); m.hidden = !t; }

function initLock() {
  const env = lsGet(LS_VAULT);
  if (env) {
    try { const e = JSON.parse(env); $("#cardRemembered").hidden = false; $("#rememberedInfo").textContent = `上次儲存：${new Date(e.savedAt).toLocaleString("zh-TW")}`; } catch { lsSet(LS_VAULT, null); }
  }
  $("#formUnlockLocal").addEventListener("submit", async e => {
    e.preventDefault(); lockMsg("解鎖中…", true);
    try { const { data, k } = await Vault.open(JSON.parse(lsGet(LS_VAULT)), $("#pwLocal").value); $("#pwLocal").value = ""; lockMsg(""); await unlocked(data, k, true); }
    catch (err) { lockMsg(err.message === "bad_password" ? "密碼不正確。" : "這台電腦上的資料無法讀取，請改用資料檔開啟。"); }
  });
  $("#btnForgetLocal").addEventListener("click", () => { lsSet(LS_VAULT, null); $("#cardRemembered").hidden = true; lockMsg("已從這台電腦移除。資料檔本身不受影響。", true); });
  $("#formOpen").addEventListener("submit", async e => {
    e.preventDefault(); const f = $("#fileVault").files[0]; if (!f) return;
    lockMsg("解鎖中…", true);
    try {
      const env = JSON.parse(await f.text());
      if (!Vault.isEnvelope(env)) throw new Error("not_a_data_file");
      const { data, k } = await Vault.open(env, $("#pwOpen").value); $("#pwOpen").value = ""; lockMsg("");
      await unlocked(data, k, $("#rememberOpen").checked);
    } catch (err) { lockMsg(err.message === "bad_password" ? "密碼不正確。" : "這個檔案不是本工具的資料檔。"); }
  });
  $("#formCreate").addEventListener("submit", async e => {
    e.preventDefault(); const a = $("#pwNew").value, b = $("#pwNew2").value;
    if (a.length < 6) return lockMsg("密碼至少 6 個字。");
    if (a !== b) return lockMsg("兩次輸入的密碼不一樣。");
    const k = await Vault.newKey(a); $("#pwNew").value = $("#pwNew2").value = "";
    await unlocked(blankData(), k, $("#rememberNew").checked); markDirty();
    switchTab("profile"); toast("已建立。先填好你的資料，再按右上角「儲存資料檔」。", 6000);
  });
  $("#btnSaveVault").addEventListener("click", saveVaultFile);
  $("#btnLock").addEventListener("click", () => {
    if (dirty && !remember && !confirmInline("btnLock", "有未儲存的變更，再按一次鎖定會遺失")) return;
    K = null; D = null; dirty = false; resetForm(); fileHandle = null;
    $("#profileForm").innerHTML = ""; $("#slots").innerHTML = ""; $("#wmPreview").innerHTML = ""; $("#previewBox").innerHTML = "";
    $("#planOut").innerHTML = ""; $("#formInfo").hidden = true; $("#previewWrap").hidden = true; $("#pdfTools").hidden = true;
    $("#app").hidden = true; $("#vaultBar").hidden = true; $("#lockScreen").hidden = false;
    const env = lsGet(LS_VAULT); $("#cardRemembered").hidden = !env;
    lockMsg("已鎖定。", true);
  });
  window.addEventListener("beforeunload", e => { if (D && dirty && !remember) { e.preventDefault(); e.returnValue = ""; } });
}
// two-step confirm inside the page (no confirm() dialogs)
const armed = {};
function confirmInline(id, msg) { if (armed[id] && Date.now() - armed[id] < 4000) { armed[id] = 0; return true; } armed[id] = Date.now(); toast(msg); return false; }

async function saveVaultFile() {
  if (!K || !D) return;
  const env = await Vault.seal(D, K); const text = JSON.stringify(env);
  const blob = new Blob([text], { type: "application/json" });
  let ok = false;
  if (!window.claude && window.showSaveFilePicker) {
    try {
      if (!fileHandle) fileHandle = await window.showSaveFilePicker({ suggestedName: "我的單據資料.json", types: [{ description: "加密資料檔", accept: { "application/json": [".json"] } }] });
      const w = await fileHandle.createWritable(); await w.write(blob); await w.close(); ok = true;
    } catch (e) { if (e.name === "AbortError") return; fileHandle = null; }
  }
  if (!ok) ok = await saveBlob("我的單據資料.json", blob);
  if (ok) { dirty = false; if (remember) lsSet(LS_VAULT, text); setVaultState(); toast("資料檔已儲存（已加密）"); }
}

// ======================================================================
// profile
// ======================================================================
function renderProfile() {
  $("#profileForm").innerHTML = FIELDS.map(g => `<fieldset><h3>${g.g}</h3>${g.items.map(f =>
    `<div class="f${f.sens ? " sens" : ""}"><label for="pf_${f.k}">${f.l}</label><input id="pf_${f.k}" data-k="${f.k}" class="${f.mono ? "mono" : ""}" value="${esc(D.profile[f.k])}" placeholder="${esc(f.ph || "")}" autocomplete="off"></div>`).join("")}</fieldset>`).join("");
  $("#profileForm").querySelectorAll("input").forEach(inp => inp.addEventListener("input", () => { D.profile[inp.dataset.k] = inp.value.trim(); markDirty(); profileWarn(); onValuesChanged(); }));
  renderCustom();
}
function renderCustom() {
  const box = $("#customList");
  if (!D.custom.length) { box.innerHTML = `<p class="note">例如「學歷」「專長」。表單上有同名欄位時，AI 判斷模式會填入。</p>`; return; }
  box.innerHTML = D.custom.map((c, i) => `<div class="custom-row"><input id="cl_${i}" aria-label="欄位名稱" value="${esc(c.label)}" placeholder="欄位名稱"><input id="cv_${i}" aria-label="內容" value="${esc(c.value)}" placeholder="內容"><button class="x" type="button" data-del="${i}" aria-label="刪除">✕</button></div>`).join("");
  D.custom.forEach((c, i) => {
    $("#cl_" + i).addEventListener("input", e => { c.label = e.target.value.trim(); markDirty(); });
    $("#cv_" + i).addEventListener("input", e => { c.value = e.target.value.trim(); markDirty(); onValuesChanged(); });
  });
  box.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => { D.custom.splice(+b.dataset.del, 1); renderCustom(); markDirty(); }));
}
$("#btnAddCustom").addEventListener("click", () => { D.custom.push({ label: "", value: "" }); renderCustom(); $("#cl_" + (D.custom.length - 1)).focus(); });
function profileWarn() {
  const need = ["name", "id_no", "address", "bank_name", "bank_code", "account"].filter(k => !D.profile[k]);
  const imgs = ["id_front", "id_back", "passbook"].filter(k => !D.images[k]);
  const w = $("#profileWarn");
  if (!need.length && !imgs.length) { w.hidden = true; return; }
  w.hidden = false;
  w.innerHTML = `「我的資料」還缺：${[...need.map(k => LABEL[k]), ...imgs.map(k => SLOT_LABEL[k])].join("、")}。<button type="button" class="link" id="goProfile">前往填寫</button>`;
  $("#goProfile").onclick = () => switchTab("profile");
}
// change password / templates
$("#btnChangePw").addEventListener("click", () => { $("#formChangePw").hidden = false; $("#pwChange").focus(); });
$("#btnCancelPw").addEventListener("click", () => { $("#formChangePw").hidden = true; });
$("#formChangePw").addEventListener("submit", async e => {
  e.preventDefault(); const a = $("#pwChange").value, b = $("#pwChange2").value;
  if (a.length < 6 || a !== b) return toast(a !== b ? "兩次輸入的密碼不一樣" : "密碼至少 6 個字");
  K = await Vault.newKey(a); $("#pwChange").value = $("#pwChange2").value = ""; $("#formChangePw").hidden = true;
  markDirty(); toast("密碼已更新。記得儲存資料檔，舊檔案仍是舊密碼。", 6000);
});
$("#btnClearTpl").addEventListener("click", () => { if (!confirmInline("clrTpl", "再按一次清除所有表單對應記錄")) return; D.templates = {}; $("#tplCount").textContent = 0; markDirty(); toast("已清除"); });

// ======================================================================
// images
// ======================================================================
const SLOT_LABEL = { id_front: "身分證正面", id_back: "身分證反面", passbook: "存摺封面" };
let slotTarget = null;
function renderSlots() {
  $("#slots").innerHTML = Object.entries(SLOT_LABEL).map(([k, l]) => {
    const src = D.images[k];
    return `<div class="slot${k === "passbook" ? " pass" : ""}"><strong>${l}</strong><div class="thumb">${src ? `<img alt="${l}" src="${src}">` : "尚未加入"}</div>
      <div class="row"><button type="button" data-up="${k}">${src ? "更換" : "上傳"}</button>${src ? `<button type="button" data-ed="${k}">調整</button><button type="button" class="x" data-rm="${k}" aria-label="移除${l}">✕</button>` : ""}</div></div>`;
  }).join("");
  $("#slots").querySelectorAll("[data-up]").forEach(b => b.onclick = () => { slotTarget = b.dataset.up; $("#imgFile").click(); });
  $("#slots").querySelectorAll("[data-ed]").forEach(b => b.onclick = () => openEditor(b.dataset.ed, D.images[b.dataset.ed]));
  $("#slots").querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { if (!confirmInline("rm" + b.dataset.rm, "再按一次移除")) return; delete D.images[b.dataset.rm]; renderSlots(); markDirty(); profileWarn(); renderWmPreview(); });
}
$("#imgFile").addEventListener("change", async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f || !slotTarget) return;
  if (!/^image\/(jpeg|png|webp)$/.test(f.type)) return toast("請用 JPG 或 PNG 檔（iPhone 的 HEIC 請先轉成 JPG）", 5000);
  const url = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });
  openEditor(slotTarget, url);
});

// --- editor ---
const ED = { img: null, rot: 0, crop: null, key: null, scale: 1 };
async function openEditor(key, src) {
  ED.img = await Watermark.loadImage(src); ED.rot = 0; ED.crop = null; ED.key = key;
  $("#edTitle").textContent = "調整：" + SLOT_LABEL[key];
  $("#editor").hidden = false; drawEditor();
}
function rotated() {
  const { img, rot } = ED; const c = document.createElement("canvas");
  const w = img.naturalWidth, h = img.naturalHeight; const sw = rot % 180 ? h : w, sh = rot % 180 ? w : h;
  c.width = sw; c.height = sh; const x = c.getContext("2d");
  x.translate(sw / 2, sh / 2); x.rotate(rot * Math.PI / 180); x.drawImage(img, -w / 2, -h / 2); return c;
}
function drawEditor() {
  const src = rotated(); ED.src = src;
  const cv = $("#edCanvas"); const maxW = Math.min(900, window.innerWidth - 80), maxH = Math.max(240, window.innerHeight * 0.58);
  const s = Math.min(maxW / src.width, maxH / src.height, 1); ED.scale = s;
  cv.width = Math.round(src.width * s); cv.height = Math.round(src.height * s);
  const x = cv.getContext("2d"); x.drawImage(src, 0, 0, cv.width, cv.height);
  if (ED.crop) {
    const r = ED.crop; x.fillStyle = "rgba(0,0,0,.5)";
    x.beginPath(); x.rect(0, 0, cv.width, cv.height); x.rect(r.x * s, r.y * s, r.w * s, r.h * s); x.fill("evenodd");
    x.strokeStyle = "#8fb0ff"; x.lineWidth = 2; x.setLineDash([6, 4]); x.strokeRect(r.x * s, r.y * s, r.w * s, r.h * s);
  }
}
(function editorEvents() {
  const cv = $("#edCanvas"); let start = null, moving = null;
  const pt = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * (cv.width / r.width) / ED.scale, y: (e.clientY - r.top) * (cv.height / r.height) / ED.scale }; };
  cv.addEventListener("pointerdown", e => {
    cv.setPointerCapture(e.pointerId); const p = pt(e); const c = ED.crop;
    if (c && p.x > c.x && p.x < c.x + c.w && p.y > c.y && p.y < c.y + c.h) moving = { dx: p.x - c.x, dy: p.y - c.y };
    else { start = p; ED.crop = null; }
  });
  cv.addEventListener("pointermove", e => {
    if (!start && !moving) return; const p = pt(e); const W = ED.src.width, H = ED.src.height;
    if (moving) { const c = ED.crop; c.x = Math.max(0, Math.min(W - c.w, p.x - moving.dx)); c.y = Math.max(0, Math.min(H - c.h, p.y - moving.dy)); }
    else { const x = Math.max(0, Math.min(start.x, p.x)), y = Math.max(0, Math.min(start.y, p.y)); ED.crop = { x, y, w: Math.min(W, Math.max(start.x, p.x)) - x, h: Math.min(H, Math.max(start.y, p.y)) - y }; }
    drawEditor();
  });
  const end = () => { if (ED.crop && (ED.crop.w < 20 || ED.crop.h < 20)) ED.crop = null; start = moving = null; drawEditor(); };
  cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", end);
  $("#edLeft").onclick = () => { ED.rot = (ED.rot + 270) % 360; ED.crop = null; drawEditor(); };
  $("#edRight").onclick = () => { ED.rot = (ED.rot + 90) % 360; ED.crop = null; drawEditor(); };
  $("#edReset").onclick = () => { ED.crop = null; drawEditor(); };
  $("#edCancel").onclick = () => { $("#editor").hidden = true; };
  $("#edApply").onclick = () => {
    const src = ED.src; const c = ED.crop || { x: 0, y: 0, w: src.width, h: src.height };
    const k = Math.min(1, 2000 / Math.max(c.w, c.h)); const out = document.createElement("canvas");
    out.width = Math.round(c.w * k); out.height = Math.round(c.h * k);
    out.getContext("2d").drawImage(src, c.x, c.y, c.w, c.h, 0, 0, out.width, out.height);
    D.images[ED.key] = out.toDataURL("image/jpeg", 0.9);
    $("#editor").hidden = true; renderSlots(); markDirty(); profileWarn(); renderWmPreview();
  };
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#editor").hidden) $("#editor").hidden = true; });
})();

// ======================================================================
// event values
// ======================================================================
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
$("#fill_date").value = iso(new Date());
const EV = ["ev_org", "ev_purpose", "ev_title", "ev_date", "ev_time", "ev_hours", "ev_amount", "ev_place", "fill_date", "ev_note"];
const ev = () => Object.fromEntries(EV.map(id => [id, $("#" + id).value.trim()]));
function values() {
  const p = D ? D.profile : {}; const v = { ...p }; const e = ev();
  v.mail_address = p.mail_address || p.address; v.mail_zip = p.mail_zip || (p.mail_address ? "" : p.zip);
  v.zip_address = [p.zip, p.address].filter(Boolean).join(" ");
  v.mail_zip_address = [v.mail_zip, v.mail_address].filter(Boolean).join(" ");
  v.phone_any = p.phone || p.mobile;
  (D ? D.custom : []).forEach((c, i) => { if (c.label) v["custom_" + (i + 1)] = c.value; });
  Object.assign(v, { event_title: e.ev_title, event_org: e.ev_org, event_time: e.ev_time, event_hours: e.ev_hours, event_place: e.ev_place, purpose: e.ev_purpose });
  const amt = e.ev_amount.replace(/[,\s元]/g, "");
  if (amt && !isNaN(+amt)) Object.assign(v, { amount: amt, amount_fmt: Number(amt).toLocaleString("en-US"), amount_cn: DocxFill.cnAmount(amt) });
  const ed = DocxFill.roc(e.ev_date), fd = DocxFill.roc(e.fill_date);
  if (ed) Object.assign(v, { event_date: ed.full, event_y: ed.y, event_m: ed.m, event_d: ed.d, event_date_ad: ed.ad });
  if (fd) Object.assign(v, { today_full: fd.full, today_y: fd.y, today_m: fd.m, today_d: fd.d, today_ad: fd.ad });
  return v;
}
function renderDerived() {
  const v = values(); const bits = [];
  if (v.amount_cn) bits.push(`國字金額：${v.amount_cn}`);
  if (v.event_date) bits.push(`活動日期：民國 ${v.event_date}`);
  if (v.today_full) bits.push(`填表日期：民國 ${v.today_full}`);
  $("#derived").textContent = bits.join("　·　");
}
EV.forEach(id => $("#" + id).addEventListener("input", () => { renderDerived(); syncWmAuto(); onValuesChanged(); }));
let valuesT = null;
function onValuesChanged() { clearTimeout(valuesT); valuesT = setTimeout(() => { if (F.plan) rebuild(); }, 250); }

// ======================================================================
// form intake
// ======================================================================
const F = { kind: null, name: "", bytes: null, docx: null, pdf: null, plan: null, hash: "", out: null };
function resetForm() { Object.assign(F, { kind: null, name: "", bytes: null, docx: null, pdf: null, plan: null, hash: "", out: null }); }
const drop = $("#drop");
drop.addEventListener("click", () => $("#formFile").click());
drop.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("#formFile").click(); } });
["dragenter", "dragover"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", e => { const f = e.dataTransfer.files[0]; if (f) takeFile(f); });
$("#formFile").addEventListener("change", e => { const f = e.target.files[0]; e.target.value = ""; if (f) takeFile(f); });

function hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
function planMsg(html) { $("#planOut").innerHTML = html; }

async function takeFile(f) {
  const n = f.name.toLowerCase();
  if (n.endsWith(".doc")) return planMsg(`<p class="msg">這是舊版 Word .doc，瀏覽器無法讀取。請用 Word 開啟後「另存新檔」成 .docx，或匯出成 PDF，再放進來。</p>`);
  if (!n.endsWith(".docx") && !n.endsWith(".pdf")) return planMsg(`<p class="msg">目前支援 .docx 與 .pdf。</p>`);
  resetForm(); F.name = f.name; F.bytes = await f.arrayBuffer();
  $("#formInfo").hidden = false; $("#formInfo").innerHTML = `<span class="chip">${esc(f.name)}</span><span class="note" id="formMeta">讀取中…</span>`;
  $("#previewWrap").hidden = true; $("#pdfTools").hidden = true; $("#btnDlForm").disabled = true;
  try {
    if (n.endsWith(".docx")) {
      F.kind = "docx";
      const zip = await JSZip.loadAsync(F.bytes); const xml = await zip.file("word/document.xml").async("string");
      const doc = new DOMParser().parseFromString(xml, "application/xml");
      const a = DocxFill.analyze(doc); F.docx = { zip, xml, a };
      F.hash = "d" + hash(a.outline);
      $("#formMeta").textContent = `Word・${Object.keys(a.map).length} 個段落／格子`;
    } else {
      F.kind = "pdf";
      planMsg(`<div class="think"><span class="dot"></span>讀取 PDF…</div>`);
      const info = await PdfFill.analyze(new Uint8Array(F.bytes)); F.pdf = info;
      F.hash = "p" + hash(info.sig);
      const tf = info.fields.filter(x => x.type === "text").length;
      $("#formMeta").textContent = `PDF・${info.pages.length} 頁・${tf ? `可填寫欄位 ${tf} 個` : "一般 PDF（文字疊印）"}${info.items.length ? "" : "・沒有可辨識文字（可能是掃描檔）"}`;
      fillAddKey();
    }
  } catch (e) { console.error(e); return planMsg(`<p class="msg">讀不到這個檔案的內容${F.kind === "pdf" ? "（PDF 可能有密碼保護或已損壞）" : ""}。</p>`); }
  refreshButtons();
  const tpl = D.templates[F.hash];
  if (tpl) { F.plan = JSON.parse(JSON.stringify(tpl)); F.plan.fromTemplate = true; }
  else F.plan = rulePlan();
  await rebuild(true);
}
function refreshButtons() { const has = !!F.kind; $("#btnRule").disabled = !has; $("#btnAI").disabled = !has || !sample; }

function rulePlan() {
  if (F.kind === "docx") {
    const a = F.docx.a;
    const paras = id => { const m = a.map[id]; return m.kind === "p" ? [DocxFill.pText(m.el)] : DocxFill.cellParas(m.el).map(DocxFill.pText); };
    return Mapper.mapDocx(a, id => paras(id).join("\n"), paras, {});
  }
  const i = F.pdf; const text = i.fields.filter(f => f.type === "text");
  if (text.length) { const p = Mapper.mapPdfFields(text); return p; }
  return Mapper.mapPdfText(i.items, { vlines: i.vlines });
}
$("#btnRule").addEventListener("click", async () => { if (!F.kind) return; F.plan = rulePlan(); await rebuild(true); saveTemplate(); });

// ======================================================================
// AI mapping (claude.ai only)
// ======================================================================
let ctl = null;
function catalogLines() {
  const v = values(); const lines = [];
  const add = (k, l, sens, len) => { const has = !!v[k]; let d = `{${k}}: ${l} — ${has ? "有" : "無"}`; if (has && len) d += `（${String(v[k]).replace(/[\s-]/g, "").length} 字）`; if (has && !sens) d += `，內容：${v[k]}`; lines.push(d); };
  ALL.forEach(f => add(f.k, f.l, f.sens, f.digits));
  add("zip_address", "郵遞區號＋戶籍地址", 1); add("mail_zip_address", "郵遞區號＋通訊地址（無則同戶籍）", 1); add("phone_any", "電話（市話，無則手機）", 1);
  D.custom.forEach((c, i) => { if (c.label) add("custom_" + (i + 1), c.label, 1); });
  [["event_title", "講題／活動名稱"], ["event_org", "邀請單位"], ["purpose", "費用用途"], ["event_time", "活動時間"], ["event_hours", "時數"], ["event_place", "地點"],
   ["amount", "金額阿拉伯數字"], ["amount_fmt", "金額含千分位"], ["amount_cn", "金額國字大寫，如 參仟元整"],
   ["event_date", "活動日期 民國 如 115年10月19日"], ["event_y", "活動 民國年"], ["event_m", "活動 月"], ["event_d", "活動 日"], ["event_date_ad", "活動日期 西元"],
   ["today_full", "填表日期 民國完整"], ["today_y", "填表 民國年"], ["today_m", "填表 月"], ["today_d", "填表 日"], ["today_ad", "填表日期 西元"]].forEach(([k, l]) => add(k, l, 0));
  return lines.join("\n");
}
const RULES_TEXT = `1. 絕不填：簽名、簽章、蓋章、親簽、指印處；機關內部欄位（承辦人、單位主管、會計、出納、經辦、核章、審核、驗收、用印、編號、傳票）；扣繳稅額、補充保費、實領／實付金額等由機關計算的欄位。把這些列入 left_blank。
2. 資料只能用 {key} 引用，可混合固定文字；絕不自行編造數值。表單需要但資料為「無」的項目不要產生操作，列入 missing（用表單上的名稱）。
3. 勾選框：要選的選項前的 □ 換成 ■、○ 換成 ●；已預先選好的不要動。身分別依 {identity} 判斷。
4. 簽名或具領人旁的日期用 {today_*}；講座、授課、出席日期用 {event_*}。表單用民國年就用民國年。
5. 每個操作附 label（2–8 字中文）。同一位置只產生一個操作。
6. 使用者補充指示優先於以上預設（但第 1 條永遠成立）。`;
function promptDocx() {
  return `你是協助大學教師填寫台灣各機關「講師領據、匯款委託書、勞務報酬單」等表單的助理。下面是一份 Word 表單的結構：段落以 [p#]、表格儲存格以 [c#] 標示，R# 是表格的列，span 是跨欄數。請規劃如何把講者資料填進正確位置。

## 可用資料（敏感資料只告訴你有無與長度）
${catalogLines()}

## 規則
${RULES_TEXT}
7. 標籤在一格、空白在另一格：對空白格用 set。
8. 標籤和空白在同一格或段落（如「手機：」「銀行別：    」「（　　）」「□□□」「年   月   日」）：用 replace。find 必須是同一段落內逐字存在的連續文字（含全形空白、空格），value 要保留仍需要的原文字，例如 find「手機：」value「手機：{mobile}」。
9. 一格一字的格子（身分證、帳號、代碼、郵遞區號）用 spread，targets 依由左至右列出那一排可填的格子；依表單說明決定 align（left/right，未說明時靠左）。

## 使用者補充指示
${ev().ev_note || "（無）"}

## 輸出
只輸出 JSON：{"title":"表單名稱","ops":[...],"left_blank":["..."],"missing":["..."]}
ops 三種格式：
{"op":"set","target":"c3","value":"{name}","label":"姓名"}
{"op":"replace","target":"c5","find":"手機：","value":"手機：{mobile}","label":"手機"}
{"op":"spread","targets":["c11","c12"],"value":"{id_no}","align":"left","label":"身分證字號"}

## 表單結構
${F.docx.a.outline}`;
}
function promptPdf() {
  const i = F.pdf;
  const pages = i.pages.map((p, n) => `第${n + 1}頁：寬 ${Math.round(p.w)} × 高 ${Math.round(p.h)}`).join("；");
  const items = i.items.slice(0, 1800).map(t => `${t.id} p${t.page} x=${t.x} y=${t.y} w=${t.w} h=${t.h} ${JSON.stringify(t.str)}`).join("\n");
  const vl = Object.entries(i.vlines || {}).flatMap(([pg, ls]) => ls.slice(0, 400).map(l => `p${pg} x=${l.x} y=${l.y1}–${l.y2}`)).join("\n");
  const fields = i.fields.map(f => `${f.id} ${f.type} p${f.page} x=${f.x} y=${f.y} w=${f.w} h=${f.h}${f.maxLen ? " max=" + f.maxLen : ""} name=${JSON.stringify(f.name)} 附近文字=${JSON.stringify(f.label)}`).join("\n");
  return `你是協助大學教師填寫台灣各機關「講師領據、匯款委託書、勞務報酬單」等表單的助理。下面是一份 PDF 表單的文字與位置。座標單位是 pt，原點在頁面左下角，y 是文字基線高度。${pages}。

## 可用資料（敏感資料只告訴你有無與長度）
${catalogLines()}

## 規則
${RULES_TEXT}
7. 若有可填寫欄位（fields），優先用 fills 把資料填進欄位；勾選框用 checks。
8. 沒有欄位可用的位置，用 places 把文字疊印上去：x,y 是文字左下角（基線）。通常放在標籤文字右側：x = 標籤 x + w + 4，y = 標籤 y；若標籤在表格左欄，放在右側空白格內偏左處。size 通常 10–12，要小於格子高度。
9. 一格一字的格子（帳號、身分證、代碼）：在 place 加上 "xs":[每一格中心的 x]，系統會每格放一個字；格子位置可由下方的表格直線推得。
10. 有可填寫欄位時，不要再對同一位置產生 places。

## 使用者補充指示
${ev().ev_note || "（無）"}

## 輸出
只輸出 JSON：{"title":"表單名稱","fills":[{"field":"f3","value":"{name}","label":"姓名"}],"checks":[{"field":"f9","on":true,"label":"身分別"}],"places":[{"page":1,"x":120.5,"y":700,"size":11,"value":"{name}","label":"姓名"}],"left_blank":["..."],"missing":["..."]}

## 可填寫欄位（fields）
${fields || "（無）"}

## 表格直線（垂直線，可用來判斷格子範圍）
${vl || "（無）"}

## 頁面文字（id 頁 x y w h 文字）
${items || "（沒有可辨識文字）"}`;
}
$("#btnAI").addEventListener("click", async () => {
  if (!F.kind || !sample) return;
  const prompt = F.kind === "docx" ? promptDocx() : promptPdf();
  if (prompt.length > 240000) return toast("這份文件太大，無法一次分析");
  ctl = new AbortController(); $("#btnAI").disabled = true; $("#btnStop").hidden = false;
  planMsg(`<div class="think"><span class="dot"></span>Claude 正在判斷每個欄位…（約 20–60 秒）</div>`);
  try {
    const res = await sample.json(prompt, { signal: ctl.signal, modelTier: "default", cache: false });
    if (!res || typeof res !== "object") throw { message: "回傳格式不對" };
    if (F.kind === "docx") { if (!Array.isArray(res.ops)) throw { message: "回傳格式不對" }; F.plan = { title: res.title, ops: res.ops, left_blank: res.left_blank, missing: res.missing, mode: "ai" }; }
    else F.plan = { title: res.title, fills: res.fills || [], checks: res.checks || [], places: res.places || [], left_blank: res.left_blank, missing: res.missing, mode: "ai" };
    await rebuild(true); saveTemplate();
  } catch (e) {
    const m = { not_granted: "你沒有允許此頁使用 Claude，所以無法用 AI 判斷。", rate_limited: "使用太頻繁，請稍等一分鐘再試。", cancelled: "已停止。" }[e.code] || ("AI 判斷失敗：" + (e.message || e.code || e));
    planMsg(`<p class="msg">${esc(m)}</p>`); if (F.plan) await rebuild(true);
  } finally { $("#btnAI").disabled = false; $("#btnStop").hidden = true; }
});
$("#btnStop").addEventListener("click", () => ctl && ctl.abort());

// ======================================================================
// rebuild: apply plan → preview + output bytes
// ======================================================================
const renderVal = (op, v) => op.override != null ? op.override : String(op.value ?? "").replace(/\{(\w+)\}/g, (_, k) => (v[k] ?? ""));
const refsMissing = (op, v) => op.override == null && [...String(op.value || "").matchAll(/\{(\w+)\}/g)].some(m => !v[m[1]]);
function saveTemplate() {
  if (!F.plan || !F.hash || !D) return;
  const t = JSON.parse(JSON.stringify(F.plan)); delete t.fromTemplate;
  D.templates[F.hash] = t; $("#tplCount").textContent = Object.keys(D.templates).length; markDirty();
}
let tplT = null; const saveTemplateSoon = () => { clearTimeout(tplT); tplT = setTimeout(saveTemplate, 500); };

async function rebuild(full) {
  if (!F.plan) return;
  if (F.kind === "docx") return rebuildDocx();
  return rebuildPdf(full);
}

function planHeader(okN) {
  const p = F.plan;
  const how = p.fromTemplate ? "沿用上次對這份表單的設定" : p.mode === "ai" ? "AI 判斷" : "規則比對";
  return `<div class="plan-head"><strong>${esc(p.title || F.name)}</strong><span class="note">已填 ${okN} 項・${how}</span></div>`;
}
function planTags() {
  const lb = F.plan.left_blank || [], ms = F.plan.missing || [];
  if (!lb.length && !ms.length) return "";
  return `<div class="tags">${lb.map(x => `<span class="tag sign">留白・${esc(x)}</span>`).join("")}${ms.map(x => `<span class="tag miss">缺資料・${esc(x)}</span>`).join("")}</div>`;
}
function bindRow(row, op, i, { size } = {}) {
  row.querySelector(".en").addEventListener("change", e => { op.enabled = e.target.checked; rebuild(); saveTemplateSoon(); });
  row.querySelector(".val").addEventListener("change", e => { op.override = e.target.value; rebuild(); saveTemplateSoon(); });
  const sz = row.querySelector(".sz"); if (sz) sz.addEventListener("change", e => { op.size = Math.max(5, Math.min(30, +e.target.value || 11)); rebuild(); saveTemplateSoon(); });
  const rm = row.querySelector(".rm"); if (rm) rm.addEventListener("click", () => { const arr = F.plan.places; arr.splice(arr.indexOf(op), 1); rebuild(); saveTemplateSoon(); });
}
function rowHtml(op, i, shown, status, opts = {}) {
  return `<div class="op${op.enabled === false ? " off" : ""}" data-i="${i}">
    <input type="checkbox" class="en" id="en_${i}" ${op.enabled === false ? "" : "checked"} aria-label="填入 ${esc(op.label)}">
    <label class="lab" for="en_${i}" title="${esc(op.label)}">${esc(op.label || op.op || "")}</label>
    <input type="text" class="val" id="val_${i}" value="${esc(shown)}" placeholder="（沒有資料）" aria-label="${esc(op.label)} 的內容">
    <span class="tail">${opts.size ? `<input type="number" class="sz" id="sz_${i}" min="5" max="30" step="0.5" value="${op.size || 11}" aria-label="字級">` : ""}${opts.rm ? `<button type="button" class="x rm" aria-label="刪除">✕</button>` : ""}</span>
    <span class="st ${status.ok ? "ok" : "bad"}">${status.ok ? "✓" : esc(status.msg || "")}</span></div>`;
}

// ---------- docx ----------
async function rebuildDocx() {
  const v = values();
  const doc = new DOMParser().parseFromString(F.docx.xml, "application/xml");
  const a = DocxFill.analyze(doc);
  const valid = op => (op.op === "spread" ? Array.isArray(op.targets) && op.targets.every(t => a.map[t]) : (op.op === "set" || (op.op === "replace" && typeof op.find === "string")) && a.map[op.target]);
  const ops = F.plan.ops.filter(valid);
  const results = DocxFill.apply(doc, a.map, ops, o => refsMissing(o, v) ? "" : renderVal(o, v));
  const out = document.createElement("div");
  out.innerHTML = planHeader(results.filter(r => r.ok).length) + `<div class="ops">${results.map((r, i) => rowHtml(r.op, i, refsMissing(r.op, v) ? (r.op.override ?? "") : renderVal(r.op, v), r)).join("")}</div>` + planTags();
  results.forEach((r, i) => bindRow(out.querySelector(`.op[data-i="${i}"]`), r.op, i));
  $("#planOut").replaceChildren(out);
  F.docx.zip.file("word/document.xml", new XMLSerializer().serializeToString(doc));
  F.out = await F.docx.zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  $("#btnDlForm").disabled = false;
  renderDocxPreview(a, DocxFill.touchedIds(results.filter(r => r.ok).map(r => r.op)));
}
function renderDocxPreview(a, hits) {
  const pt = el => DocxFill.pText(el); const sigRe = /簽名|簽章|蓋章|親簽|具領人|領款人簽/;
  const blocks = bs => bs.map(b => {
    if (b.type === "p") { const t = pt(a.map[b.id].el); return `<p class="${hits.has(b.id) ? "hit" : ""}${sigRe.test(t) ? " sig" : ""}">${esc(t) || "&nbsp;"}</p>`; }
    return `<table>${b.rows.map(r => `<tr>${r.map(c => { if (c.vmCont) return `<td colspan="${c.span}"></td>`; const t = DocxFill.cellParas(a.map[c.id].el).map(pt).map(esc).join("<br>"); return `<td colspan="${c.span}" class="${hits.has(c.id) ? "hit" : ""}${sigRe.test(t) ? " sig" : ""}">${t}${c.inner.length ? blocks(c.inner) : ""}</td>`; }).join("")}</tr>`).join("")}</table>`;
  }).join("");
  $("#previewTitle").textContent = "預覽（藍字為填入內容，實際排版以 Word 開啟為準）";
  $("#previewBox").innerHTML = `<div class="pv">${blocks(a.blocks)}</div>`;
  $("#previewWrap").hidden = false;
}

// ---------- pdf ----------
let pdfScale = 1, placing = false, selected = null, renderedFor = null;
function fillAddKey() {
  const keys = [...new Set([...ALL.map(f => f.k), "zip_address", "mail_zip_address", "phone_any", "event_title", "event_org", "event_date", "event_hours", "amount_fmt", "amount_cn", "today_full"])];
  $("#addKey").innerHTML = keys.map(k => `<option value="${k}">${esc(LABEL[k] || k)}</option>`).join("") + `<option value="__text">自訂文字</option>`;
  $("#pdfTools").hidden = false;
}
$("#btnPlace").addEventListener("click", () => { placing = !placing; $("#placeHint").textContent = placing ? "在下方頁面上點一下要放的位置" : ""; document.querySelectorAll(".pdf-page").forEach(p => p.classList.toggle("placing", placing)); });

async function rebuildPdf(full) {
  const v = values(); const p = F.plan; const info = F.pdf;
  p.fills = p.fills || []; p.checks = p.checks || []; p.places = p.places || [];
  const fIdx = Object.fromEntries(info.fields.map(f => [f.id, f]));
  p.fills = p.fills.filter(x => fIdx[x.field]); p.checks = p.checks.filter(x => fIdx[x.field]);
  // list
  const rows = []; let i = 0, okN = 0;
  const all = [...p.fills.map(o => ["fill", o]), ...p.checks.map(o => ["check", o]), ...p.places.map(o => ["place", o])];
  for (const [kind, o] of all) {
    const shown = kind === "check" ? (o.on ? "勾選" : "不勾") : (refsMissing(o, v) ? (o.override ?? "") : renderVal(o, v));
    const ok = kind === "check" || !!shown; if (ok && o.enabled !== false) okN++;
    rows.push(rowHtml(o, i++, shown, ok ? { ok: true } : { ok: false, msg: "沒有對應資料" }, { size: kind === "place", rm: kind === "place" }));
  }
  const out = document.createElement("div");
  out.innerHTML = planHeader(okN) + (rows.length ? `<div class="ops">${rows.join("")}</div>` : `<p class="empty">沒有自動找到欄位。用下方「新增文字到頁面」手動放置，下次同一份表單會直接套用。</p>`) + planTags();
  all.forEach(([kind, o], j) => { const r = out.querySelector(`.op[data-i="${j}"]`); if (kind === "check") { r.querySelector(".val").readOnly = true; r.querySelector(".en").addEventListener("change", e => { o.enabled = e.target.checked; rebuild(); saveTemplateSoon(); }); } else bindRow(r, o, j); });
  $("#planOut").replaceChildren(out);
  // preview
  if (full || renderedFor !== F.hash) await renderPdfPages();
  drawOverlays();
  // output
  try {
    const fills = p.fills.filter(o => o.enabled !== false).map(o => ({ field: o.field, text: renderVal(o, v) })).filter(o => o.text && !refsMissingText(o.text));
    const checks = p.checks.filter(o => o.enabled !== false).map(o => ({ field: o.field, on: !!o.on }));
    const places = p.places.filter(o => o.enabled !== false).map(o => ({ page: o.page, x: o.x, y: o.y, xs: o.xs, size: o.size, text: refsMissing(o, v) ? "" : renderVal(o, v) })).filter(o => o.text);
    const bytes = await PdfFill.build(new Uint8Array(F.bytes), { fills, checks, places }, fIdx);
    F.out = new Blob([bytes], { type: "application/pdf" }); $("#btnDlForm").disabled = false;
  } catch (e) { console.error(e); F.out = null; $("#btnDlForm").disabled = true; toast("PDF 產生失敗：" + (e.message || e), 6000); }
}
const refsMissingText = t => /\{\w+\}/.test(t);

async function renderPdfPages() {
  const info = F.pdf; const box = $("#previewBox");
  $("#previewTitle").textContent = "預覽（藍字可拖曳調整位置，點一下後可刪除）";
  $("#previewWrap").hidden = false;
  const avail = Math.max(320, box.clientWidth - 40 || 800);
  pdfScale = Math.min(1.6, avail / Math.max(...info.pages.map(p => p.w)));
  const wrap = document.createElement("div"); wrap.className = "pdf-pages";
  box.replaceChildren(wrap);
  for (let n = 1; n <= info.pages.length; n++) {
    const pg = document.createElement("div"); pg.className = "pdf-page"; pg.dataset.page = n;
    const cv = document.createElement("canvas"); pg.appendChild(cv); wrap.appendChild(pg);
    const vp = await PdfFill.renderPage(info.doc, n, cv, pdfScale);
    pg.style.width = vp.width + "px"; pg.style.height = vp.height + "px";
    pg.addEventListener("click", e => {
      if (!placing || e.target.closest(".ov")) return;
      const r = pg.getBoundingClientRect(); const x = (e.clientX - r.left) / pdfScale, yTop = (e.clientY - r.top) / pdfScale;
      const key = $("#addKey").value; const size = 11;
      const o = key === "__text" ? { page: n, x, y: info.pages[n - 1].h - yTop - size * 0.3, size, value: "", override: "", label: "自訂文字" }
        : { page: n, x, y: info.pages[n - 1].h - yTop - size * 0.3, size, value: `{${key}}`, label: LABEL[key] || key, key };
      F.plan.places.push(o); placing = false; $("#placeHint").textContent = ""; document.querySelectorAll(".pdf-page").forEach(p => p.classList.remove("placing"));
      selected = o; rebuild(); saveTemplateSoon();
    });
  }
  renderedFor = F.hash;
}
function drawOverlays() {
  const v = values(); const info = F.pdf; const s = pdfScale;
  document.querySelectorAll(".pdf-page").forEach(pg => pg.querySelectorAll(".ov").forEach(x => x.remove()));
  const pageEl = n => document.querySelector(`.pdf-page[data-page="${n}"]`);
  for (const o of F.plan.fills || []) {
    if (o.enabled === false) continue; const f = info.fields.find(x => x.id === o.field); const pg = pageEl(f && f.page); if (!pg) continue;
    const ph = info.pages[f.page - 1].h; const d = document.createElement("div"); d.className = "ov field";
    d.style.left = f.x * s + "px"; d.style.top = (ph - f.y - f.h) * s + "px"; d.style.width = f.w * s + "px"; d.style.height = f.h * s + "px";
    d.style.fontSize = Math.min(f.h * 0.7, 12) * s + "px"; d.style.lineHeight = f.h * s + "px"; d.textContent = refsMissing(o, v) ? "" : renderVal(o, v); pg.appendChild(d);
  }
  for (const o of F.plan.places || []) {
    if (o.enabled === false) continue; const pg = pageEl(o.page); if (!pg) continue;
    const ph = info.pages[o.page - 1].h; const size = o.size || 11;
    const text = refsMissing(o, v) ? "" : renderVal(o, v);
    const d = document.createElement("div"); d.className = "ov" + (text ? "" : " empty") + (selected === o ? " sel" : ""); d.tabIndex = 0;
    d.style.fontSize = size * s + "px"; d.style.fontFamily = '"Noto Sans TC",sans-serif';
    const place = () => {
      d.style.top = (ph - o.y - size * 0.88) * s + "px";
      if (o.xs && o.xs.length && text) { d.style.left = (o.xs[0] - size * 0.6) * s + "px"; d.style.width = (o.xs[o.xs.length - 1] - o.xs[0] + size * 1.2) * s + "px"; }
      else d.style.left = o.x * s + "px";
    };
    if (o.xs && o.xs.length && text) {
      d.style.height = size * 1.05 * s + "px";
      Array.from(text.replace(/[\s-]/g, "")).forEach((ch, i) => { if (o.xs[i] == null) return; const sp = document.createElement("span"); sp.textContent = ch; sp.style.cssText = `position:absolute;top:0;left:${(o.xs[i] - o.xs[0] + size * 0.6) * s}px;transform:translateX(-50%)`; d.appendChild(sp); });
    } else d.textContent = text || `〔${o.label}〕`;
    d.title = o.label; place();
    const del = document.createElement("button"); del.className = "del"; del.type = "button"; del.textContent = "✕"; del.setAttribute("aria-label", "刪除 " + o.label);
    del.addEventListener("click", e => { e.stopPropagation(); F.plan.places.splice(F.plan.places.indexOf(o), 1); selected = null; rebuild(); saveTemplateSoon(); });
    d.appendChild(del);
    let drag = null;
    d.addEventListener("pointerdown", e => { if (e.target === del) return; d.setPointerCapture(e.pointerId); drag = { sx: e.clientX, sy: e.clientY, x: o.x, y: o.y, xs: o.xs ? o.xs.slice() : null, moved: false }; selected = o; document.querySelectorAll(".ov.sel").forEach(x => x.classList.remove("sel")); d.classList.add("sel"); });
    d.addEventListener("pointermove", e => { if (!drag) return; const dx = (e.clientX - drag.sx) / s, dy = (e.clientY - drag.sy) / s; if (Math.abs(dx) + Math.abs(dy) > 0.5) drag.moved = true; o.x = Math.round((drag.x + dx) * 10) / 10; o.y = Math.round((drag.y - dy) * 10) / 10; if (drag.xs) o.xs = drag.xs.map(v => Math.round((v + dx) * 10) / 10); place(); });
    const end = () => { if (drag && drag.moved) { rebuild(); saveTemplateSoon(); } drag = null; };
    d.addEventListener("pointerup", end); d.addEventListener("pointercancel", end);
    d.addEventListener("keydown", e => {
      const step = e.shiftKey ? 5 : 1; const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
      if (mv) { e.preventDefault(); o.x += mv[0]; o.y += mv[1]; if (o.xs) o.xs = o.xs.map(v => v + mv[0]); rebuild(); saveTemplateSoon(); }
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); del.click(); }
    });
    pg.appendChild(d);
  }
}

$("#btnDlForm").addEventListener("click", async () => {
  if (!F.out) return;
  const base = F.name.replace(/\.(docx|pdf)$/i, "");
  if (await saveBlob(`${base}_已填.${F.kind === "docx" ? "docx" : "pdf"}`, F.out)) toast("已下載。列印後記得親筆簽名。");
});

// ======================================================================
// watermark
// ======================================================================
let wmLine1Auto = true;
function wmDefault1() { const e = ev(); return `僅供${e.ev_org || "〇〇單位"}${e.ev_purpose || "講座費"}請領使用`; }
function wmDate() { const d = DocxFill.roc(ev().fill_date); return d ? `中華民國 ${d.full}` : ""; }
function syncWmAuto() { if (wmLine1Auto) $("#wm1").value = wmDefault1(); if (!$("#wm3").dataset.touched) $("#wm3").value = wmDate(); renderWmPreviewSoon(); }
function wmOpts() { return { line1: $("#wm1").value, line2: $("#wm2").value, date: $("#wm3").value, color: $("#wmColor").value, opacity: +$("#wmOpacity").value / 100, size: +$("#wmSize").value, enlarge: $("#wmEnlarge").checked }; }
function loadWmPrefs() {
  const w = D.wm; $("#wmColor").value = w.color; $("#wmOpacity").value = w.opacity; $("#wmSize").value = w.size; $("#wm2").value = w.line2; $("#wmEnlarge").checked = !!w.enlarge;
  $("#wmOpacityV").textContent = w.opacity + "%"; $("#wmSizeV").textContent = w.size; syncWmAuto();
}
$("#wm1").addEventListener("input", () => { wmLine1Auto = !$("#wm1").value || $("#wm1").value === wmDefault1(); renderWmPreviewSoon(); });
$("#wm3").addEventListener("input", () => { $("#wm3").dataset.touched = "1"; renderWmPreviewSoon(); });
["wm2", "wmColor", "wmOpacity", "wmSize", "wmEnlarge"].forEach(id => $("#" + id).addEventListener("input", () => {
  $("#wmOpacityV").textContent = $("#wmOpacity").value + "%"; $("#wmSizeV").textContent = $("#wmSize").value;
  if (D) { D.wm = { color: $("#wmColor").value, opacity: +$("#wmOpacity").value, size: +$("#wmSize").value, line2: $("#wm2").value, enlarge: $("#wmEnlarge").checked }; markDirty(); }
  renderWmPreviewSoon();
}));
let wmT = null; function renderWmPreviewSoon() { clearTimeout(wmT); wmT = setTimeout(renderWmPreview, 200); }
async function renderWmPreview() {
  if (!D) return; const box = $("#wmPreview"); const o = wmOpts();
  const keys = ["id_front", "id_back", "passbook"].filter(k => D.images[k]);
  $("#btnDlWm").disabled = !keys.length;
  if (!keys.length) { box.innerHTML = `<p class="empty">在「我的資料」加入身分證正反面與存摺影像後，這裡會顯示預覽。</p>`; return; }
  const figs = [];
  for (const k of keys) { const img = await Watermark.loadImage(D.images[k]); const cv = Watermark.draw(img, o); const f = document.createElement("figure"); f.appendChild(cv); const cap = document.createElement("figcaption"); cap.textContent = SLOT_LABEL[k]; f.appendChild(cap); figs.push(f); }
  box.replaceChildren(...figs);
}
$("#btnDlWm").addEventListener("click", async () => {
  try {
    const bytes = await Watermark.buildA4({ id_front: D.images.id_front, id_back: D.images.id_back, passbook: D.images.passbook }, wmOpts());
    const org = ev().ev_org.replace(/[\\/:*?"<>|\s]/g, "") || "影本";
    if (await saveBlob(`身分證及存摺影本_${org}.pdf`, new Blob([bytes], { type: "application/pdf" }))) toast("已下載浮水印影本");
  } catch (e) { console.error(e); toast("產生失敗：" + (e.message || e)); }
});

// ======================================================================
// tabs + boot
// ======================================================================
function switchTab(which) {
  const fill = which !== "profile";
  $("#tabFill").setAttribute("aria-selected", fill); $("#tabProfile").setAttribute("aria-selected", !fill);
  $("#paneFill").hidden = !fill; $("#paneProfile").hidden = fill;
  if (fill) { profileWarn(); renderWmPreviewSoon(); }
}
$("#tabFill").addEventListener("click", () => switchTab("fill"));
$("#tabProfile").addEventListener("click", () => switchTab("profile"));
initLock(); initRuntime(); renderDerived();
window.__RAF = { F, get D() { return D; }, values, rulePlan };
})();

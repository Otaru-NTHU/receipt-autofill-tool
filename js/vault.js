// Encrypted data file: PBKDF2-SHA256 → AES-GCM-256, all in the browser (WebCrypto)
(function (root) {
  const FORMAT = "receipt-autofill-data";
  const ITER = 310000;
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = buf => { const u = new Uint8Array(buf); let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  async function deriveKey(password, salt, iter) {
    const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  // returns {key, salt, iter} for reuse while unlocked
  async function newKey(password) { const salt = crypto.getRandomValues(new Uint8Array(16)); return { key: await deriveKey(password, salt, ITER), salt, iter: ITER }; }

  async function seal(data, k) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k.key, enc.encode(JSON.stringify(data)));
    return { format: FORMAT, version: 1, kdf: "PBKDF2-SHA256", iter: k.iter, cipher: "AES-GCM-256", salt: b64(k.salt), iv: b64(iv), savedAt: new Date().toISOString(), data: b64(ct) };
  }
  async function open(envelope, password) {
    if (!envelope || envelope.format !== FORMAT) throw new Error("not_a_data_file");
    const salt = unb64(envelope.salt), iter = envelope.iter || ITER;
    const key = await deriveKey(password, salt, iter);
    let pt;
    try { pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(envelope.iv) }, key, unb64(envelope.data)); }
    catch { throw new Error("bad_password"); }
    return { data: JSON.parse(dec.decode(pt)), k: { key, salt, iter } };
  }
  const isEnvelope = o => !!(o && o.format === FORMAT && o.data && o.iv);
  const api = { seal, open, newKey, isEnvelope, FORMAT };
  if (typeof module !== "undefined") module.exports = api; else root.Vault = api;
})(this);

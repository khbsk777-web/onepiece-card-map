// お気に入りのお店に「在庫あり」の報告が来たら通知を送る（GitHub Actions で30分ごと）
// ・通知の宛先は、端末の中で暗号化されて保存されている。ここで秘密の鍵（PUSH_KEYS）を使って開く。
// ・前回からあとに来た報告だけを見る。前回の時刻は data/push-state.json に保存（だれの情報も入れない）
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import webpush from "web-push";

const PROJECT = "onepiece-card-map";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const APP_URL = "https://treasure-card-map.github.io/";
const STATE = "data/push-state.json";
const HIDE_FLAGS = 3;
const STATUS = { in: "⭐ 在庫あり", low: "⭐ 残りわずか" };
const PRODUCTS = { booster: "ブースターパック", extra: "エクストラブースター", premium: "プレミアムブースター", starter: "スタートデッキ", other: "その他" };
const val = (f) => f == null ? null : f.stringValue ?? f.timestampValue ?? (f.integerValue != null ? Number(f.integerValue) : f.doubleValue ?? null);

async function runQuery(collection, fields, from, to) {
  const out = [];
  let cursor = null;
  for (let page = 0; page < 20; page++) {
    const q = {
      from: [{ collectionId: collection }],
      select: { fields: fields.map((f) => ({ fieldPath: f })) },
      where: { compositeFilter: { op: "AND", filters: [
        { fieldFilter: { field: { fieldPath: "createdAt" }, op: "GREATER_THAN", value: { timestampValue: from } } },
        { fieldFilter: { field: { fieldPath: "createdAt" }, op: "LESS_THAN_OR_EQUAL", value: { timestampValue: to } } },
      ] } },
      orderBy: [{ field: { fieldPath: "createdAt" }, direction: "ASCENDING" }, { field: { fieldPath: "__name__" }, direction: "ASCENDING" }],
      limit: 1000,
    };
    if (cursor) q.startAt = { values: cursor, before: false };
    const res = await fetch(`${BASE}:runQuery`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ structuredQuery: q }) });
    if (!res.ok) throw new Error(`${collection} を読めませんでした: ${res.status}`);
    const docs = (await res.json()).filter((x) => x.document).map((x) => x.document);
    for (const d of docs) { const o = { _id: d.name.split("/").pop() }; for (const f of fields) o[f] = val(d.fields?.[f]); out.push(o); }
    if (docs.length < 1000) break;
    const last = docs[docs.length - 1];
    cursor = [{ timestampValue: last.fields.createdAt.timestampValue }, { referenceValue: last.name }];
  }
  return out;
}
async function getDoc(path) {
  const res = await fetch(`${BASE}/${path}`);
  if (!res.ok) return null;
  return (await res.json()).fields || null;
}
async function listSubs() {
  const out = [];
  let token = "";
  for (let i = 0; i < 50; i++) {
    const res = await fetch(`${BASE}/pushSubs?pageSize=300${token ? "&pageToken=" + encodeURIComponent(token) : ""}`);
    if (!res.ok) throw new Error(`pushSubs を読めませんでした: ${res.status}`);
    const j = await res.json();
    for (const d of j.documents || []) out.push({ id: d.name.split("/").pop(), box: val(d.fields?.box), at: val(d.fields?.updatedAt) });
    if (!j.nextPageToken) break;
    token = j.nextPageToken;
  }
  return out;
}

const b64u = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
async function openBox(box, privKey) {
  const [v, epk, iv, ct] = String(box).split(".");
  if (v !== "v1") throw new Error("形式がちがう");
  const { subtle } = globalThis.crypto;
  const pub = await subtle.importKey("raw", b64u(epk), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const bits = await subtle.deriveBits({ name: "ECDH", public: pub }, privKey, 256);
  const hk = await subtle.importKey("raw", bits, "HKDF", false, ["deriveKey"]);
  const key = await subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new TextEncoder().encode("tcm-push-v1") }, hk, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const pt = await subtle.decrypt({ name: "AES-GCM", iv: b64u(iv) }, key, b64u(ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
const hash = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);

async function main() {
  const raw = process.env.PUSH_KEYS || "";
  if (!raw) { console.log("::warning::PUSH_KEYS が未登録なので通知はお休みです"); return; }
  const keys = JSON.parse(raw);
  webpush.setVapidDetails("https://x.com/mapstoiawase", keys.vapidPublicKey, keys.vapidPrivateKey);
  const privKey = await globalThis.crypto.subtle.importKey("jwk", keys.boxPrivateJwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);

  let state = {};
  try { state = JSON.parse(readFileSync(STATE, "utf8")); } catch { /* はじめて */ }
  const now = new Date().toISOString();
  const since = state.since && Date.parse(state.since) > Date.now() - 6 * 3600e3 ? state.since : new Date(Date.now() - 3600e3).toISOString();
  const reps = (await runQuery("reports", ["storeId", "status", "product", "itemName", "flags", "createdAt"], since, now))
    .filter((r) => ["in", "low"].includes(r.status) && (r.flags || 0) < HIDE_FLAGS && r.storeId);
  console.log(`新しい在庫ありの報告：${reps.length}件（${since} 〜）`);
  const dead = new Set(state.dead || []);
  let sent = 0, gone = 0, bad = 0;
  if (reps.length) {
    const byStore = new Map();
    for (const r of reps) byStore.set(r.storeId, r); // 同じお店は一番新しい報告だけ
    const names = new Map();
    for (const id of byStore.keys()) { const f = await getDoc(`stores/${encodeURIComponent(id)}`); if (f) names.set(id, val(f.name)); }
    for (const sub of await listSubs()) {
      if (dead.has(hash(sub.id + sub.at))) continue;
      let data;
      try { data = await openBox(sub.box, privKey); } catch { bad++; continue; }
      const favs = new Set(Array.isArray(data.f) ? data.f.slice(0, 100) : []);
      const hits = [...byStore.values()].filter((r) => favs.has(r.storeId) && names.has(r.storeId));
      if (!hits.length || !data.s?.endpoint) continue;
      const r = hits[hits.length - 1];
      const body = `${names.get(r.storeId)}：${PRODUCTS[r.product] || ""}${r.itemName ? "「" + r.itemName + "」" : ""} ${STATUS[r.status]}${hits.length > 1 ? `（ほか${hits.length - 1}店）` : ""}`;
      const payload = JSON.stringify({ title: "❤️ お気に入りのお店に在庫の報告！", body, url: `${APP_URL}?s=${encodeURIComponent(r.storeId)}`, tag: "fav-stock" });
      try { await webpush.sendNotification(data.s, payload, { TTL: 6 * 3600, urgency: "normal" }); sent++; }
      catch (e) { if (e.statusCode === 404 || e.statusCode === 410) { dead.add(hash(sub.id + sub.at)); gone++; } else console.log("送れませんでした:", e.statusCode || e.message); }
    }
  }
  console.log(`通知：${sent}件送信、期限切れ${gone}件、読めない宛先${bad}件`);
  mkdirSync("data", { recursive: true });
  writeFileSync(STATE, JSON.stringify({ since: now, dead: [...dead].slice(-2000) }) + "\n");
}
main().catch((e) => { console.error(e.message); process.exit(1); });

// 新しい在庫報告をまとめて、X（旧Twitter）に自動で投稿する
// GitHub Actions から3時間ごとに動く。X のカギが登録されていないときは「投稿予定の文」を表示するだけ（お金はかからない）
//
// お金について：X の API は使った分だけ払う方式。リンクなしの投稿は1回 約0.015ドル、リンクありは約0.2ドル。
// なので、ふだんはリンクを付けず「地図はプロフィールのリンクから」と書く（X_INCLUDE_LINK=1 でリンク付き）。
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const PROJECT = "onepiece-card-map";
const APP_URL = "https://khbsk777-web.github.io/onepiece-card-map/";
const STATE_FILE = "data/x-state.json";
const STATUS = { in: "在庫あり", low: "残りわずか", soon: "入荷予定" }; // 売り切れ等は投稿しない
const MAX_STORES = 4;
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

// ---- Firestore（だれでも読める「在庫報告」と「お店」だけを読む）----
const val = (f) => f == null ? null : f.stringValue ?? f.timestampValue ?? (f.integerValue != null ? Number(f.integerValue) : f.doubleValue ?? null);
async function recentReports(sinceIso) {
  const body = { structuredQuery: {
    from: [{ collectionId: "reports" }],
    where: { fieldFilter: { field: { fieldPath: "createdAt" }, op: "GREATER_THAN", value: { timestampValue: sinceIso } } },
    orderBy: [{ field: { fieldPath: "createdAt" }, direction: "DESCENDING" }],
    limit: 100,
  } };
  const res = await fetch(`${BASE}:runQuery`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`報告を読めませんでした: ${res.status} ${await res.text()}`);
  return (await res.json()).filter((x) => x.document).map(({ document: d }) => {
    const f = d.fields || {};
    return { storeId: val(f.storeId), status: val(f.status), itemName: val(f.itemName), flags: val(f.flags) || 0, createdAt: val(f.createdAt) };
  });
}
async function getStore(id) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id || "")) return null;
  const res = await fetch(`${BASE}/stores/${id}`);
  if (!res.ok) return null;
  const f = (await res.json()).fields || {};
  return { name: val(f.name), pref: val(f.pref) };
}

// ---- 文を安全にする（URL・@メンション・#ハッシュタグを消して、勝手に人を呼んだりしない）----
const safe = (s, n) => String(s || "").normalize("NFKC")
  .replace(/https?:\/\/\S+|www\.\S+/gi, "").replace(/[@＠#＃]/g, "").replace(/\s+/g, " ").trim().slice(0, n);

// X の文字数（日本語は2、英数字は1として数える。上限280）
function xLen(s) {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    n += (c <= 4351 || (c >= 8192 && c <= 8205) || (c >= 8208 && c <= 8223) || (c >= 8242 && c <= 8247)) ? 1 : 2;
  }
  return n;
}

function compose(items, withLink) {
  const now = new Date(Date.now() + 9 * 3600e3); // 日本時間
  const head = `📢 ワンピースカードの新しい在庫報告（${now.getUTCMonth() + 1}/${now.getUTCDate()} ${now.getUTCHours()}時）`;
  const tail = (withLink ? `\n▶ 地図で見る（非公式）` : `\n▶ 地図はプロフィールのリンクから（非公式）`) + `\n#ワンピースカード #ワンピカ #トレジャーカードマップ`;
  const budget = 280 - (withLink ? 24 : 0); // リンクは23文字として数えられる
  let text = head;
  let used = 0;
  for (const it of items) {
    const line = `\n・${it.name}${it.pref ? `（${it.pref}）` : ""}：${it.status}${it.item ? `「${it.item}」` : ""}`;
    if (xLen(text + line + tail) > budget) break;
    text += line; used++;
  }
  if (!used) return null;
  return text + tail + (withLink ? `\n${APP_URL}` : "");
}

// ---- X に投稿（OAuth 1.0a の署名）----
const pct = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
async function postToX(text, k) {
  const url = "https://api.x.com/2/tweets";
  const oauth = {
    oauth_consumer_key: k.apiKey, oauth_nonce: randomBytes(16).toString("hex"), oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)), oauth_token: k.accessToken, oauth_version: "1.0",
  };
  const params = Object.keys(oauth).sort().map((key) => `${pct(key)}=${pct(oauth[key])}`).join("&");
  const base = ["POST", pct(url), pct(params)].join("&");
  oauth.oauth_signature = createHmac("sha1", `${pct(k.apiSecret)}&${pct(k.accessSecret)}`).update(base).digest("base64");
  const auth = "OAuth " + Object.keys(oauth).sort().map((key) => `${pct(key)}="${pct(oauth[key])}"`).join(", ");
  const res = await fetch(url, { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify({ text }) });
  const out = await res.text();
  if (!res.ok) throw new Error(`Xに投稿できませんでした: ${res.status} ${out}`);
  return JSON.parse(out);
}

async function main() {
  let state = {};
  try { state = JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch { /* はじめて */ }
  const since = state.last || new Date(Date.now() - 3 * 3600e3).toISOString();
  const reps = (await recentReports(since)).filter((r) => STATUS[r.status] && !r.flags);
  console.log(`新しい報告：${reps.length}件（${since} 以降）`);
  if (!reps.length) return;

  // お店ごとに一番新しい報告だけ使う
  const latest = new Map();
  for (const r of reps) if (!latest.has(r.storeId)) latest.set(r.storeId, r);
  const items = [];
  for (const [id, r] of [...latest].slice(0, MAX_STORES * 2)) {
    const s = await getStore(id);
    const name = safe(s?.name, 24);
    if (!name) continue;
    items.push({ name, pref: safe(s.pref, 5), status: STATUS[r.status], item: safe(r.itemName, 16) });
    if (items.length >= MAX_STORES) break;
  }
  const withLink = process.env.X_INCLUDE_LINK === "1";
  const text = compose(items, withLink);
  if (!text) return;
  console.log("---- 投稿する文 ----\n" + text + "\n--------------------");

  const k = { apiKey: process.env.X_API_KEY, apiSecret: process.env.X_API_SECRET, accessToken: process.env.X_ACCESS_TOKEN, accessSecret: process.env.X_ACCESS_SECRET };
  if (!k.apiKey || !k.apiSecret || !k.accessToken || !k.accessSecret) {
    console.log("Xのカギが登録されていないので、投稿はしません（お試し表示だけ）");
    return;
  }
  const out = await postToX(text, k);
  console.log("投稿しました:", out?.data?.id);
  state.last = reps[0].createdAt;
  state.posted = (state.posted || 0) + 1;
  writeFileSync(STATE_FILE, JSON.stringify(state) + "\n");
}

main().catch((e) => { console.error(e.message); process.exit(1); });

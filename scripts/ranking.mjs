// 月間ポイントランキングを作って data/ranking.json に保存する（GitHub Actions で6時間ごと）
// ポイント：報告1回＝10pt、もらった👍1つ＝5pt、開拓1店＝20pt（アプリと同じ）
// 先月の上位は「表彰」として残す。お金も賞品もなし、名誉だけ。
// 読むのはだれでも読める「報告」と「お店」だけ。出力にはニックネームとポイントだけを入れる（ユーザーIDは入れない）
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const PROJECT = "onepiece-card-map";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const OUT = "data/ranking.json";
const TOP = 30;
const HIDE_FLAGS = 3;
const PT = { report: 10, like: 5, pioneer: 20, invite: 30, mission: 5 };
const INVITE_CAP = 10; // 1人が1か月に招待ポイントをもらえるのは10人まで

const val = (f) => f == null ? null : f.stringValue ?? f.timestampValue ?? (f.integerValue != null ? Number(f.integerValue) : f.doubleValue ?? null);

// createdAt が from 以上 to 未満のドキュメントを全部読む（1000件ずつ）
async function readAll(collection, fields, from, to) {
  const out = [];
  let cursor = null;
  for (let page = 0; page < 50; page++) {
    const q = {
      from: [{ collectionId: collection }],
      select: { fields: fields.map((f) => ({ fieldPath: f })) },
      where: { compositeFilter: { op: "AND", filters: [
        { fieldFilter: { field: { fieldPath: "createdAt" }, op: "GREATER_THAN_OR_EQUAL", value: { timestampValue: from } } },
        { fieldFilter: { field: { fieldPath: "createdAt" }, op: "LESS_THAN", value: { timestampValue: to } } },
      ] } },
      orderBy: [{ field: { fieldPath: "createdAt" }, direction: "ASCENDING" }, { field: { fieldPath: "__name__" }, direction: "ASCENDING" }],
      limit: 1000,
    };
    if (cursor) q.startAt = { values: cursor, before: false };
    const res = await fetch(`${BASE}:runQuery`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ structuredQuery: q }) });
    if (!res.ok) throw new Error(`${collection} を読めませんでした: ${res.status} ${await res.text()}`);
    const docs = (await res.json()).filter((x) => x.document).map((x) => x.document);
    for (const d of docs) {
      const o = { _id: d.name.split("/").pop() };
      for (const f of fields) o[f] = val(d.fields?.[f]);
      out.push(o);
    }
    if (docs.length < 1000) break;
    const last = docs[docs.length - 1];
    cursor = [{ timestampValue: last.fields.createdAt.timestampValue }, { referenceValue: last.name }];
  }
  return out;
}

// 日本時間の「月の始まり」をUTCの時刻で返す
function monthStart(y, m) { return new Date(Date.UTC(y, m - 1, 1) - 9 * 3600e3); }
const key = (y, m) => `${y}-${String(m).padStart(2, "0")}`;

async function rank(y, m) {
  const from = monthStart(y, m).toISOString();
  const to = monthStart(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1).toISOString();
  const reports = await readAll("reports", ["uid", "nickname", "likes", "flags", "storeId", "createdAt"], from, to);
  const photos = await readAll("photos", ["uid", "flags", "createdAt"], from, to);
  const stores = await readAll("stores", ["createdBy", "pioneer", "createdAt"], from, to);
  const users = new Map();
  const u = (id) => {
    if (!users.has(id)) users.set(id, { name: "", reports: 0, likes: 0, pioneer: 0, invites: 0, missions: 0 });
    return users.get(id);
  };
  for (const r of reports) {
    if (!r.uid || (r.flags || 0) >= HIDE_FLAGS) continue;
    const x = u(r.uid);
    x.reports++; x.likes += Math.max(0, r.likes || 0);
    if (r.nickname) x.name = r.nickname; // 新しい順ではないが、ほぼ最新の名前になる
  }
  for (const s of stores) {
    if (!s.createdBy || !s.pioneer) continue; // 開拓者の名前があるお店だけ数える
    const x = u(s.createdBy);
    x.pioneer++;
    if (!x.name) x.name = s.pioneer;
  }
  // 今日のミッション（日本時間の1日ごと）：①1回報告 ②2店で報告 ③写真を1枚投稿。1つ5pt
  const jday = (iso) => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 10);
  const days = new Map(); // uid|日 → { stores:Set, photo }
  const dayOf = (uid, iso) => { const k = uid + "|" + jday(iso); if (!days.has(k)) days.set(k, { uid, stores: new Set(), photo: false }); return days.get(k); };
  for (const r of reports) if (r.uid && (r.flags || 0) < HIDE_FLAGS && r.storeId) dayOf(r.uid, r.createdAt).stores.add(r.storeId);
  for (const p of photos) if (p.uid && (p.flags || 0) < HIDE_FLAGS) dayOf(p.uid, p.createdAt).photo = true;
  for (const d of days.values()) {
    const n = (d.stores.size >= 1 ? 1 : 0) + (d.stores.size >= 2 ? 1 : 0) + (d.photo ? 1 : 0);
    if (n && users.has(d.uid)) users.get(d.uid).missions += n;
  }
  // 招待：この月に招待された人が、この月に1回以上報告したら、招待した人と招待された人の両方にポイント
  const invites = await readAll("invites", ["by", "createdAt"], from, to);
  for (const iv of invites) {
    const newbie = users.get(iv._id);
    if (!iv.by || !newbie || newbie.reports < 1 || iv.by === iv._id) continue;
    const host = u(iv.by);
    if (host.invites >= INVITE_CAP) continue;
    host.invites++; newbie.invites++;
  }
  const list = [...users.values()].filter((x) => x.name)
    .map((x) => ({ name: x.name, pt: x.reports * PT.report + x.likes * PT.like + x.pioneer * PT.pioneer + x.invites * PT.invite + x.missions * PT.mission, reports: x.reports, likes: x.likes, pioneer: x.pioneer, invites: x.invites, missions: x.missions }))
    .filter((x) => x.pt > 0)
    .sort((a, b) => b.pt - a.pt || b.reports - a.reports);
  console.log(`${key(y, m)}: 報告${reports.length}件・新しいお店${stores.length}店・参加者${list.length}人`);
  return { month: key(y, m), players: list.length, top: list.slice(0, TOP) };
}

// ---- 入荷しやすい曜日・時間帯（最近60日の「在庫あり・残りわずか」の報告から） ----
const TREND_OUT = "data/trends.json";
async function trends() {
  const to = new Date().toISOString();
  const from = new Date(Date.now() - 60 * 864e5).toISOString();
  const reps = await readAll("reports", ["storeId", "status", "product", "flags", "uid", "nickname", "still", "gone", "createdAt"], from, to);
  await stats(reps, from, to);
  await trust(reps);
  const stores = {};
  for (const r of reps) {
    if (!["in", "low"].includes(r.status) || (r.flags || 0) >= HIDE_FLAGS || !r.storeId) continue;
    const t = new Date(Date.parse(r.createdAt) + 9 * 3600e3); // 日本時間
    const h = t.getUTCHours();
    const slot = h < 6 ? 4 : h < 11 ? 0 : h < 15 ? 1 : h < 19 ? 2 : 3; // 朝・昼・夕方・夜・深夜
    const x = stores[r.storeId] || (stores[r.storeId] = { n: 0, wd: [0, 0, 0, 0, 0, 0, 0], slot: [0, 0, 0, 0, 0] });
    x.n++; x.wd[t.getUTCDay()]++; x.slot[slot]++;
  }
  for (const id of Object.keys(stores)) if (stores[id].n < 3) delete stores[id]; // 3件以上の報告があるお店だけ
  // 売り切れまでの目安：「在庫あり」の報告から、同じ商品の「売り切れ」の報告まで何時間だったか（48時間以内のものだけ）
  const runs = new Map();
  for (const r of [...reps].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))) {
    if ((r.flags || 0) >= HIDE_FLAGS || !r.storeId) continue;
    const k = r.storeId + "|" + (r.product || "");
    const t = Date.parse(r.createdAt);
    const cur = runs.get(k) || { start: null, list: [] };
    if (["in", "low"].includes(r.status)) { if (cur.start == null) cur.start = t; }
    else if (r.status === "out" && cur.start != null) {
      const h = (t - cur.start) / 3600e3;
      if (h > 0 && h <= 48) cur.list.push(h);
      cur.start = null;
    }
    runs.set(k, cur);
  }
  const sold = {};
  for (const [k, v] of runs) {
    const id = k.split("|")[0];
    (sold[id] ||= []).push(...v.list);
  }
  for (const id of Object.keys(sold)) {
    const l = sold[id].sort((a, b) => a - b);
    if (l.length < 2) { delete sold[id]; continue; }
    const med = l.length % 2 ? l[(l.length - 1) / 2] : (l[l.length / 2 - 1] + l[l.length / 2]) / 2;
    sold[id] = { h: Math.max(0.5, Math.round(med * 2) / 2), n: l.length };
  }
  console.log(`入荷の傾向：${Object.keys(stores).length}店（最近60日の報告${reps.length}件から）`);
  let old = {};
  try { old = JSON.parse(readFileSync(TREND_OUT, "utf8")); } catch { /* はじめて */ }
  if (JSON.stringify(old.stores) === JSON.stringify(stores) && JSON.stringify(old.sold || {}) === JSON.stringify(sold)) return;
  writeFileSync(TREND_OUT, JSON.stringify({ updated: new Date().toISOString(), days: 60, stores, sold }) + "\n");
}

// ---- 運営者向けの利用状況（毎日の報告数・報告した人数。数だけで、だれかは入れない） ----
const STATS_OUT = "data/stats.json";
async function stats(reps, from, to) {
  const day = (iso) => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 10);
  const byDay = new Map();
  for (let t = Date.parse(from) + 9 * 3600e3; t <= Date.parse(to) + 9 * 3600e3; t += 864e5) byDay.set(new Date(t).toISOString().slice(0, 10), { reports: 0, users: new Set() });
  const all = new Set(), stores = new Set();
  for (const r of reps) {
    const x = byDay.get(day(r.createdAt));
    if (x) { x.reports++; if (r.uid) x.users.add(r.uid); }
    if (r.uid) all.add(r.uid);
    if (r.storeId) stores.add(r.storeId);
  }
  const days = [...byDay.entries()].map(([date, x]) => ({ date, reports: x.reports, reporters: x.users.size })).slice(-30);
  const body = { total: { reports: reps.length, reporters: all.size, stores: stores.size }, days };
  let old = {};
  try { old = JSON.parse(readFileSync(STATS_OUT, "utf8")); } catch { /* はじめて */ }
  if (JSON.stringify({ total: old.total, days: old.days }) === JSON.stringify(body)) return;
  writeFileSync(STATS_OUT, JSON.stringify({ updated: new Date().toISOString(), ...body }) + "\n");
}


// ---- 報告の信頼度（最近60日）：「まだあった」が多い報告をたくさんした人に ☑️ ----
// 出力はニックネームとレベル（1か2）だけ
const TRUST_OUT = "data/trust.json";
async function trust(reps) {
  const by = new Map();
  for (const r of reps) {
    if (!r.uid || !r.nickname) continue;
    const x = by.get(r.uid) || { name: r.nickname, good: 0, bad: 0 };
    x.name = r.nickname;
    const still = r.still || 0, gone = r.gone || 0;
    if ((r.flags || 0) >= HIDE_FLAGS || gone > still) x.bad++;
    else if (still >= 1) x.good++;
    by.set(r.uid, x);
  }
  const names = {};
  for (const x of by.values()) {
    if (x.good >= 10 && x.bad * 5 <= x.good) names[x.name] = 2;
    else if (x.good >= 3 && x.bad * 3 <= x.good) names[x.name] = Math.max(names[x.name] || 0, 1);
  }
  console.log(`信頼度：☑️ ${Object.keys(names).length}人`);
  let old = {};
  try { old = JSON.parse(readFileSync(TRUST_OUT, "utf8")); } catch { /* はじめて */ }
  if (JSON.stringify(old.names) === JSON.stringify(names)) return;
  writeFileSync(TRUST_OUT, JSON.stringify({ updated: new Date().toISOString(), names }) + "\n");
}

// ---- 都道府県ごとのページ（Google検索で見つけてもらうため。area/1.html〜area/47.html） ----
const SITE = "https://treasure-card-map.github.io/";
const PREFS = "北海道 青森県 岩手県 宮城県 秋田県 山形県 福島県 茨城県 栃木県 群馬県 埼玉県 千葉県 東京都 神奈川県 新潟県 富山県 石川県 福井県 山梨県 長野県 岐阜県 静岡県 愛知県 三重県 滋賀県 京都府 大阪府 兵庫県 奈良県 和歌山県 鳥取県 島根県 岡山県 広島県 山口県 徳島県 香川県 愛媛県 高知県 福岡県 佐賀県 長崎県 熊本県 大分県 宮崎県 鹿児島県 沖縄県".split(" ");
const STATUS_JA = { in: "⭐ 在庫あり", low: "⭐ 残りわずか" };
const PRODUCT_JA = { booster: "ブースターパック", extra: "エクストラブースター", premium: "プレミアムブースター", starter: "スタートデッキ", other: "その他" };
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function jst(iso) { const t = new Date(Date.parse(iso) + 9 * 3600e3); return `${t.getUTCMonth() + 1}/${t.getUTCDate()} ${String(t.getUTCHours()).padStart(2, "0")}:${String(t.getUTCMinutes()).padStart(2, "0")}`; }
function page(title, desc, path, body) {
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'none'; style-src 'unsafe-inline'; img-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${SITE}${path}">
<meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${SITE}${path}"><meta property="og:image" content="${SITE}og.png"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="../icons/favicon-48.png" type="image/png">
<style>body{font-family:system-ui,-apple-system,"Hiragino Sans",sans-serif;margin:0;background:#f6f7fb;color:#14213d;line-height:1.6}
header{background:#14213d;color:#fff;padding:14px 16px}header a{color:#ffd166;text-decoration:none;font-weight:700}
main{max-width:720px;margin:0 auto;padding:16px}h1{font-size:1.3rem}h2{font-size:1.05rem;margin-top:24px}
.cta{display:block;text-align:center;background:#e63946;color:#fff;padding:14px;border-radius:12px;font-weight:700;text-decoration:none;margin:16px 0}
.row{background:#fff;border-radius:10px;padding:10px 12px;margin:8px 0;box-shadow:0 1px 3px #0001}.meta{color:#667;font-size:.85rem}
.prefs{display:flex;flex-wrap:wrap;gap:8px}.prefs a{background:#fff;padding:6px 10px;border-radius:8px;text-decoration:none;color:#14213d;box-shadow:0 1px 3px #0001}
footer{font-size:.8rem;color:#667;padding:16px;text-align:center}</style>
</head><body><header><a href="${SITE}">🗺 トレジャーカードマップ</a></header><main>
${body}
</main><footer>トレジャーカードマップは、ファンが作った非公式のアプリです。情報はユーザーの報告で、正しさは保証できません。<br><a href="../about.html">このアプリについて</a></footer></body></html>
`;
}
async function areaPages() {
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const now = new Date(Date.now() + 60e3).toISOString();
  const [reps, stores] = await Promise.all([
    readAll("reports", ["storeId", "status", "flags", "still", "gone", "product", "itemName", "createdAt"], since, now),
    readAll("stores", ["name", "pref", "createdAt"], "2000-01-01T00:00:00Z", now),
  ]);
  const storeById = new Map(stores.map((x) => [x._id, x]));
  // お店ごとに一番新しい報告だけ
  const latest = new Map();
  for (const r of reps) {
    if ((r.flags || 0) >= HIDE_FLAGS) continue;
    const k = r.storeId + "|" + r.product;
    const o = latest.get(k);
    if (!o || o.createdAt < r.createdAt) latest.set(k, r);
  }
  mkdirSync("area", { recursive: true });
  const links = [];
  let changed = 0;
  PREFS.forEach((pref, i) => {
    const n = i + 1;
    const inStock = [...latest.values()].filter((r) => ["in", "low"].includes(r.status) && (r.gone || 0) <= (r.still || 0) && storeById.get(r.storeId)?.pref === pref)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 50);
    const storeCount = stores.filter((x) => x.pref === pref).length;
    const title = `${pref}のワンピースカード在庫・入荷情報｜トレジャーカードマップ`;
    const desc = `${pref}のコンビニ・本屋・家電量販店などで報告された、ワンピースカードの在庫・入荷情報（最近7日間）。みんなで報告し合う無料の地図アプリ。`;
    const rows = inStock.length ? inStock.map((r) => {
      const st = storeById.get(r.storeId);
      return `<div class="row"><b>${esc(st.name)}</b><div>${STATUS_JA[r.status]}・${esc(PRODUCT_JA[r.product] || "")}${r.itemName ? "「" + esc(r.itemName) + "」" : ""}</div><div class="meta">${jst(r.createdAt)} の報告</div></div>`;
    }).join("\n") : `<p>最近7日間の「在庫あり」の報告はまだありません。見つけたら最初に報告してみよう！</p>`;
    const body = `<h1>${esc(pref)}のワンピースカード在庫情報</h1>
<p>${esc(pref)}で登録されたお店：${storeCount}店。最近7日間に「在庫あり」と報告されたお店：${inStock.length}店。</p>
<a class="cta" href="${SITE}?pref=${encodeURIComponent(pref)}">🗺 地図で${esc(pref)}の在庫を見る</a>
<h2>最近の在庫ありの報告</h2>
${rows}
<h2>ほかの地域</h2><p><a href="index.html">都道府県の一覧へ</a></p>`;
    const html = page(title, desc, `area/${n}.html`, body);
    const file = `area/${n}.html`;
    let old = "";
    try { old = readFileSync(file, "utf8"); } catch { /* はじめて */ }
    if (old !== html) { writeFileSync(file, html); changed++; }
    links.push({ n, pref, count: inStock.length });
  });
  const idx = page("都道府県別 ワンピースカード在庫情報｜トレジャーカードマップ", "47都道府県ごとの、ワンピースカードの在庫・入荷情報の一覧。", "area/index.html",
    `<h1>都道府県別のワンピースカード在庫情報</h1><a class="cta" href="${SITE}">🗺 地図アプリを開く</a><div class="prefs">${links.map((x) => `<a href="${x.n}.html">${esc(x.pref)}${x.count ? `（${x.count}）` : ""}</a>`).join("")}</div>`);
  let oldIdx = "";
  try { oldIdx = readFileSync("area/index.html", "utf8"); } catch { /* はじめて */ }
  if (oldIdx !== idx) { writeFileSync("area/index.html", idx); changed++; }
  const urls = ["", "about.html", "area/index.html", ...links.map((x) => `area/${x.n}.html`)];
  writeFileSync("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${SITE}${u}</loc></url>`).join("\n")}\n</urlset>\n`);
  writeFileSync("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${SITE}sitemap.xml\n`);
  console.log(`地域ページ：${changed}ページ更新`);
}

async function main() {
  mkdirSync("data", { recursive: true });
  await trends();
  await areaPages();
  let old = {};
  try { old = JSON.parse(readFileSync(OUT, "utf8")); } catch { /* はじめて */ }
  const now = new Date(Date.now() + 9 * 3600e3); // 日本時間
  const y = now.getUTCFullYear(), m = now.getUTCMonth() + 1;
  const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;

  const current = await rank(y, m);
  // 先月の結果：月が変わってから最初の数日は更新して確定させる（あとから届いた👍も反映）
  let last = old.last && old.last.month === key(py, pm) ? old.last : null;
  if (!last || now.getUTCDate() <= 3) last = await rank(py, pm);

  // 歴代の表彰（各月の上位3人）
  const hall = (old.hall || []).filter((h) => h.month !== last.month);
  if (last.top.length) hall.unshift({ month: last.month, top: last.top.slice(0, 3).map(({ name, pt }) => ({ name, pt })) });
  hall.sort((a, b) => (a.month < b.month ? 1 : -1));

  const body = { points: PT, current, last, hall: hall.slice(0, 24) };
  const same = JSON.stringify({ points: old.points, current: old.current, last: old.last, hall: old.hall }) === JSON.stringify(body);
  if (same) { console.log("変更なし"); return; }
  const data = { updated: new Date().toISOString(), ...body };
  mkdirSync("data", { recursive: true });
  writeFileSync(OUT, JSON.stringify(data) + "\n");
  console.log("保存しました:", OUT);
}

main().catch((e) => { console.error(e.message); process.exit(1); });

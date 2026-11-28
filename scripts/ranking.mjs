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
const PT = { report: 10, like: 5, pioneer: 20 };

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
      const o = {};
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
  const reports = await readAll("reports", ["uid", "nickname", "likes", "flags", "createdAt"], from, to);
  const stores = await readAll("stores", ["createdBy", "pioneer", "createdAt"], from, to);
  const users = new Map();
  const u = (id) => {
    if (!users.has(id)) users.set(id, { name: "", reports: 0, likes: 0, pioneer: 0 });
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
  const list = [...users.values()].filter((x) => x.name)
    .map((x) => ({ name: x.name, pt: x.reports * PT.report + x.likes * PT.like + x.pioneer * PT.pioneer, reports: x.reports, likes: x.likes, pioneer: x.pioneer }))
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
  const reps = await readAll("reports", ["storeId", "status", "flags", "uid", "createdAt"], from, to);
  await stats(reps, from, to);
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
  console.log(`入荷の傾向：${Object.keys(stores).length}店（最近60日の報告${reps.length}件から）`);
  let old = {};
  try { old = JSON.parse(readFileSync(TREND_OUT, "utf8")); } catch { /* はじめて */ }
  if (JSON.stringify(old.stores) === JSON.stringify(stores)) return;
  writeFileSync(TREND_OUT, JSON.stringify({ updated: new Date().toISOString(), days: 60, stores }) + "\n");
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

async function main() {
  mkdirSync("data", { recursive: true });
  await trends();
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

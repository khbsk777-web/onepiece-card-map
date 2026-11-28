// トレジャーカードマップ（非公式） — 画面の動き
// 安全のための決まり：ユーザーが入力した文字は必ず textContent で表示し、HTMLとして扱わない。
import { firebaseConfig, appCheckSiteKey } from "./firebase-config.js";

// ---------- 定数 ----------
export const PRODUCTS = { booster: "ブースターパック", extra: "エクストラブースター", premium: "プレミアムブースター", starter: "スタートデッキ", other: "その他" };
export const STATUS = { in: "在庫あり", low: "残りわずか", out: "売り切れ", soon: "入荷予定", na: "取り扱いなし" };
export const SALE = { pack: "バラ売り", box: "BOX", lottery: "抽選", other: "その他" };
const PREFS = "北海道 青森県 岩手県 宮城県 秋田県 山形県 福島県 茨城県 栃木県 群馬県 埼玉県 千葉県 東京都 神奈川県 新潟県 富山県 石川県 福井県 山梨県 長野県 岐阜県 静岡県 愛知県 三重県 滋賀県 京都府 大阪府 兵庫県 奈良県 和歌山県 鳥取県 島根県 岡山県 広島県 山口県 徳島県 香川県 愛媛県 高知県 福岡県 佐賀県 長崎県 熊本県 大分県 宮崎県 鹿児島県 沖縄県".split(" ");
const DAYS = 7;            // 何日前までの報告を読むか
const STALE_H = 72;        // これより古い情報は薄く表示
const HIDE_FLAGS = 3;      // 通報がこの数以上で非表示
const URL_RE = /(https?:\/\/|www\.|\.com|\.jp\b|\.xyz)/i;

// ---------- 小さな道具 ----------
const $ = (s) => document.querySelector(s);
function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k in e && k !== "list") e[k] = v;
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c instanceof Node ? c : String(c));
  return e;
}
export function timeAgo(ms, now = Date.now()) {
  const m = Math.floor((now - ms) / 60000);
  if (m < 1) return "たった今";
  if (m < 60) return `${m}分前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}時間前`;
  return `${Math.floor(h / 24)}日前`;
}
// 入力のおそうじ：前後の空白と見えない制御文字を消す
export function clean(s, max) {
  return String(s ?? "").replace(/[\u0000-\u0008\u000B-\u001F\u007F​-‏‪-‮⁦-⁩]/g, "").trim().slice(0, max);
}
function distM(a, b) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
// 投稿できるのは「いる場所から3km以内」のお店だけ（遠くからのウソ報告を防ぐ）
const POST_RANGE_M = 3000;
function getPos() {
  if (S.myPos && Date.now() - S.myPos.t < 60000) return Promise.resolve(S.myPos);
  return new Promise((ok, ng) => {
    if (!navigator.geolocation) return ng(new Error("no-geo"));
    navigator.geolocation.getCurrentPosition((p) => {
      S.myPos = { lat: p.coords.latitude, lng: p.coords.longitude, t: Date.now() };
      ok(S.myPos);
    }, ng, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
  });
}
async function nearCheck(pt) {
  let me;
  try { me = await getPos(); } catch { toast("投稿するには位置情報の許可が必要です（設定で許可してね）"); return false; }
  const d = distM(me, pt);
  if (d > POST_RANGE_M) { toast(`このお店から${(d / 1000).toFixed(1)}km離れています。投稿は現在地から3km以内のお店だけです`); return false; }
  return true;
}
let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3200);
}
function errMsg(e) {
  const c = e?.code || e?.message || "";
  const map = {
    "permission-denied": "連続で投稿できません（報告・お店の登録は5秒・写真は1分に1回まで）。少し待ってからもう一度ためしてね",
    "auth/email-already-in-use": "このメールアドレスはもう登録されています。ログインしてね",
    "auth/invalid-credential": "メールアドレスかパスワードがちがいます",
    "auth/wrong-password": "メールアドレスかパスワードがちがいます",
    "auth/user-not-found": "メールアドレスかパスワードがちがいます",
    "auth/weak-password": "パスワードは8文字以上にしてね",
    "auth/invalid-email": "メールアドレスの形が正しくありません",
    "auth/too-many-requests": "回数が多すぎます。しばらく待ってからためしてね",
    "auth/popup-closed-by-user": "ログインがキャンセルされました",
    "auth/popup-blocked": "ポップアップがブロックされました。もう一度ボタンを押してね",
    "auth/network-request-failed": "通信できませんでした。電波を確認してね",
    already: "もう押しています（1人1回まで）",
    "no-pref": "住所がわかりませんでした。先に「くわしく報告する」から都道府県を選んで報告してね",
    "too-big": "写真が大きすぎて小さくできませんでした。別の写真をためしてね",
    unavailable: "通信できませんでした。電波を確認してね",
  };
  for (const k in map) if (c.includes(k)) return map[k];
  return "うまくいきませんでした。時間をおいてもう一度ためしてね";
}

// ---------- 状態 ----------
const S = { placesMode: "all", places: null, backend: null, user: null, stores: [], reports: [], filter: "all", product: "", pref: "", mode: null, map: null, layer: null, me: null, liked: new Set(), flagged: new Set() };

// 店ごとの「いちばん新しい報告」
export function latestFor(reports, storeId, product) {
  for (const r of reports) {
    if (r.storeId !== storeId || (r.flags || 0) >= HIDE_FLAGS) continue;
    if (product && r.product !== product) continue;
    return r;
  }
  return null;
}
export function visibleStores(stores, reports, { filter, product, pref }, now = Date.now()) {
  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
  return stores.filter((s) => {
    if (pref && s.pref !== pref) return false;
    const r = latestFor(reports, s.id, product);
    if (filter === "stock") return r && (r.status === "in" || r.status === "low") && now - r.createdAt < STALE_H * 3600e3;
    if (filter === "today") return r && r.createdAt >= startOfDay.getTime();
    return true;
  });
}

// ---------- 地図 ----------
function initMap() {
  S.map = L.map("map", { zoomControl: false, tap: true }).setView([36.2, 138.2], 5);
  // 国土地理院の地図：無料・APIキー不要（出典の表示が必要）
  const gsi = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>';
  const bases = {
    "📷 航空写真": L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg", { minZoom: 5, maxZoom: 19, maxNativeZoom: 18, attribution: gsi }),
    "🗺 地図": L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png", { minZoom: 5, maxZoom: 19, maxNativeZoom: 18, attribution: gsi }),
  };
  let saved = null;
  try { saved = localStorage.getItem("opmap-base"); } catch {}
  (bases[saved] || bases["📷 航空写真"]).addTo(S.map);
  L.control.layers(bases, null, { position: "topright", collapsed: false }).addTo(S.map);
  S.map.on("baselayerchange", (e) => { try { localStorage.setItem("opmap-base", e.name); } catch {} });
  L.control.zoom({ position: "topleft" }).addTo(S.map);
  S.canvas = L.canvas({ padding: 0.3 });
  S.fk = L.layerGroup().addTo(S.map);
  S.places = L.layerGroup().addTo(S.map);
  S.layer = L.layerGroup().addTo(S.map);
  S.map.attributionControl.addAttribution('&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>');
  S.map.on("click", (e) => { if (S.mode === "pick") pickPoint(e.latlng); });
  S.map.on("moveend", () => { renderFukuoka(); clearTimeout(prefTimer); prefTimer = setTimeout(loadPrefData, 400); });
  S.map.on("moveend", () => { renderPlaces(); clearTimeout(placeTimer); placeTimer = setTimeout(loadPlaces, 500); });
}
function render() {
  S.layer.clearLayers();
  const list = visibleStores(S.stores, S.reports, S);
  const now = Date.now();
  for (const s of list) {
    const r = latestFor(S.reports, s.id, S.product);
    const cls = r ? r.status : "none";
    const stale = r && now - r.createdAt > STALE_H * 3600e3;
    const ch = chainOf(s.name);
    const wrap = el("div", { class: "pinwrap" }, el("div", { class: `pin ${cls}${stale ? " stale" : ""}` }), ch ? cvsBadge(ch) : null);
    const icon = L.divIcon({ className: "", html: wrap, iconSize: [26, 26], iconAnchor: [13, 26] });
    L.marker([s.lat, s.lng], { icon, title: s.name, keyboard: true }).on("click", () => openStore(s.id)).addTo(S.layer);
  }
  renderPlaces();
  renderFukuoka();
}

// ---------- 周辺のお店・駅（OpenStreetMap） ----------
// まだ登録されていないお店と駅名を、地図を拡大したときだけ表示する
const PLACE_MIN_ZOOM = 14;   // これ以上拡大したら表示
const LABEL_ZOOM = 16;       // これ以上でお店の名前も表示（駅名はいつも表示）
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const KIND = { station: ["🚉", "駅"], conv: ["🏪", "コンビニ"], books: ["📚", "本屋"], mall: ["🏬", "商業施設"], hobby: ["🃏", "カード・ホビー店"], elec: ["🔌", "家電量販店"] };
export function placeKind(t = {}) {
  if (t.railway === "station") return "station";
  switch (t.shop) {
    case "convenience": return "conv";
    case "books": return "books";
    case "mall": case "department_store": return "mall";
    case "toys": case "games": case "hobby": case "anime": case "video_games": case "collector": return "hobby";
    case "supermarket": return /イオン|aeon/i.test(`${t.name || ""} ${t.brand || ""}`) ? "mall" : null;
    case "electronics": return "elec";
  }
  return null;
}
// コンビニのチェーン（ロゴは使わず、文字と色で見分ける）
const CHAINS = [
  ["seven", "セブン", /セブン|7-?eleven|seven/i, "#ee7c00", "#fff"],
  ["famima", "ファミマ", /ファミリーマート|ファミマ|familymart|family mart/i, "#00973c", "#fff"],
  ["lawson", "ローソン", /ローソン|lawson/i, "#0b5fb0", "#fff"],
  ["ministop", "ミニストップ", /ミニストップ|ministop/i, "#ffd400", "#1d2c6b"],
  ["daily", "デイリー", /デイリーヤマザキ|ヤマザキ|daily ?yamazaki/i, "#d7000f", "#fff"],
  ["seico", "セコマ", /セイコーマート|セコマ|seicomart|seico ?mart/i, "#f08300", "#fff"],
  ["poplar", "ポプラ", /ポプラ|poplar/i, "#b5121b", "#fff"],
  ["newdays", "NewDays", /newdays|ニューデイズ/i, "#00875a", "#fff"],
];
export function chainOf(text) {
  if (!text) return null;
  for (const [key, label, re, bg, fg] of CHAINS) if (re.test(text)) return { key, label, bg, fg };
  return null;
}
export function toPlace(e) {
  const t = e.tags || {};
  const kind = placeKind(t);
  const lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon;
  if (!kind || typeof lat !== "number" || typeof lng !== "number") return null;
  let name = clean(t["name:ja"] || t.name || t.brand || "", 40);
  const branch = clean(t["branch:ja"] || t.branch || "", 20);
  if (branch && !name.includes(branch)) name = clean(`${name} ${branch}`, 40); // 例：ローソン ＋ 天神北店
  if (!name) { if (kind === "station") return null; name = KIND[kind][1]; }
  if (kind === "station" && !name.endsWith("駅")) name += "駅";
  const addr = clean(t["addr:full"] || [t["addr:city"], t["addr:suburb"], t["addr:quarter"], t["addr:neighbourhood"], t["addr:block_number"], t["addr:housenumber"]].filter(Boolean).join(""), 120);
  const tagPref = PREFS.includes(t["addr:province"]) ? t["addr:province"] : "";
  const chain = kind === "conv" ? chainOf([t.brand, t["brand:ja"], t["brand:en"], t.name, t["name:ja"], t["name:en"]].filter(Boolean).join(" ")) : null;
  return { id: `${e.type}/${e.id}`, kind, name, lat, lng, addr, tagPref, chain };
}
const placeById = new Map();
const loadedCells = new Set(), loadingCells = new Set();
let placeTimer, placeWarned = false;
const CELL = 0.02; // 約2kmのマスごとに読み込んで覚えておく
function cellsIn(b) {
  const out = [];
  for (let y = Math.floor(b.getSouth() / CELL); y <= Math.floor(b.getNorth() / CELL); y++)
    for (let x = Math.floor(b.getWest() / CELL); x <= Math.floor(b.getEast() / CELL); x++) out.push([y, x]);
  return out;
}
async function fetchPlaces(s, w, n, e) {
  const bb = `${s},${w},${n},${e}`;
  const q = `[out:json][timeout:20];(nwr["shop"~"^(convenience|books|mall|department_store|toys|games|hobby|anime|video_games|collector|electronics)$"](${bb});nwr["shop"="supermarket"]["name"~"イオン|AEON"](${bb});nwr["railway"="station"](${bb}););out center 1500;`;
  return fetchOverpass(q);
}
async function fetchOverpass(q) {
  for (const url of OVERPASS) {
    try {
      const res = await fetch(url, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded" } });
      if (res.ok) return (await res.json()).elements || [];
    } catch { /* 次のサーバーを試す */ }
  }
  throw new Error("overpass");
}
async function loadPlaces() {
  if (S.placesMode === "off" || S.map.getZoom() < PLACE_MIN_ZOOM) return;
  const cells = cellsIn(S.map.getBounds()).filter(([y, x]) => !loadedCells.has(`${y}:${x}`) && !loadingCells.has(`${y}:${x}`));
  if (!cells.length || cells.length > 12) return;
  const ys = cells.map((c) => c[0]), xs = cells.map((c) => c[1]);
  const keys = cells.map(([y, x]) => `${y}:${x}`);
  keys.forEach((k) => loadingCells.add(k));
  try {
    const els = await fetchPlaces(Math.min(...ys) * CELL, Math.min(...xs) * CELL, (Math.max(...ys) + 1) * CELL, (Math.max(...xs) + 1) * CELL);
    for (const e of els) { const p = toPlace(e); if (p) placeById.set(p.id, p); }
    keys.forEach((k) => loadedCells.add(k));
    renderPlaces();
  } catch (e) {
    if (!placeWarned) { placeWarned = true; toast("周辺のお店を読み込めませんでした。少しあとで地図を動かしてみてね"); }
  } finally { keys.forEach((k) => loadingCells.delete(k)); }
}
function renderPlaces() {
  if (!S.places) return;
  S.places.clearLayers();
  if (S.placesMode === "off" || S.map.getZoom() < PLACE_MIN_ZOOM) return;
  const b = S.map.getBounds().pad(0.2), z = S.map.getZoom();
  let n = 0;
  for (const p of placeById.values()) {
    if (!b.contains([p.lat, p.lng])) continue;
    if (S.placesMode === "conv" && p.kind !== "conv" && p.kind !== "station") continue;
    if (p.kind !== "station" && isRegistered(p)) continue; // 報告があるお店は色つきピンで出す
    if (++n > 600) break;
    const showName = p.kind === "station" || z >= LABEL_ZOOM;
    const node = p.kind === "conv"
      ? el("div", { class: "poi conv" }, cvsBadge(p.chain), showName ? el("span", { class: "poi-name below", text: p.name }) : null)
      : el("div", { class: `poi ${p.kind}` }, el("span", { class: "poi-ic", text: KIND[p.kind][0] }), showName ? el("span", { class: "poi-name", text: p.name }) : null);
    const icon = L.divIcon({ className: "", html: node, iconSize: [24, 24], iconAnchor: [12, 12] });
    const station = p.kind === "station";
    const m = L.marker([p.lat, p.lng], { icon, title: p.name, keyboard: false, interactive: !station, zIndexOffset: station ? -300 : p.kind === "conv" ? -100 : -200 });
    if (!station) m.on("click", () => openPlace(p));
    m.addTo(S.places);
  }
}

// ---------- 福岡県のコンビニを全部「⚫」で表示 ----------
// 引いた地図でも県内の未登録コンビニが全部見える。拡大するとチェーン名の札に切り替わる
// 引いた地図での点の色（種類ごと）
const FK_COLOR = { conv: "#111111", books: "#0d9488", mall: "#7c3aed", hobby: "#db2777", elec: "#ea580c" };
const FK_KEY = "opmap-fukuoka-v3";
const FK_TTL = 24 * 3600e3; // 1日覚えておく
let fkPlaces = [];
// ① スマホに覚えている分をすぐ表示 → ② サイトに置いた data/fukuoka.json（毎日自動更新）で最新に
// → ③ それも無いときだけ OpenStreetMap に直接聞く（時間がかかる）
async function loadFukuoka() {
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(FK_KEY)); } catch {}
  if (cached && Array.isArray(cached.list)) { setFukuoka(cached.list); renderFukuoka(); renderPlaces(); }
  if (cached && Date.now() - cached.t < FK_TTL && cached.src === "static") return;
  const pack = (els) => els.map(toPlace).filter((p) => p && FK_COLOR[p.kind])
    .map(({ id, kind, name, lat, lng, addr, chain }) => ({ id, kind, name, lat, lng, addr, chain }));
  let list = null, src = "static";
  for (const url of ["data/fukuoka.json", "https://raw.githubusercontent.com/khbsk777-web/onepiece-card-map/main/data/fukuoka.json"]) {
    try {
      const res = await fetch(url, { cache: "no-cache" });
      if (res.ok) { const j = await res.json(); if (Array.isArray(j.elements) && j.elements.length) { list = pack(j.elements); break; } }
    } catch { /* 次を試す */ }
  }
  if (!list) {
    if (cached && Date.now() - cached.t < FK_TTL) return;
    src = "overpass";
    try {
      // コンビニ・本屋・商業施設（イオンモールなど）・カード／ホビー店
      list = pack(await fetchOverpass('[out:json][timeout:90];area["ISO3166-2"="JP-40"]->.a;(nwr["shop"~"^(convenience|books|mall|department_store|toys|games|hobby|anime|collector)$"](area.a);nwr["shop"="supermarket"]["name"~"イオン|AEON"](area.a););out center 12000;'));
    } catch {
      if (!cached) toast("福岡県のお店を読み込めませんでした。あとで開き直してみてね");
      return;
    }
  }
  setFukuoka(list);
  try { localStorage.setItem(FK_KEY, JSON.stringify({ t: Date.now(), src, list })); } catch {}
  renderFukuoka(); renderPlaces();
}
function setFukuoka(list) {
  fkPlaces = list.map((p) => ({ ...p, tagPref: "福岡県" }));
  for (const p of fkPlaces) if (!placeById.has(p.id)) placeById.set(p.id, p);
}
// ---------- 全国のコンビニ・ヨドバシ（県ごとのファイルを、地図に映った県だけ読む） ----------
const PREF_MIN_ZOOM = 8;   // これより引いた地図では全国の点は出さない（重くなるため）
let prefIndex = null, prefTimer;
const prefLists = new Map(), prefLoading = new Set();
async function loadPrefIndex() {
  if (prefIndex) return prefIndex;
  try {
    const res = await fetch("data/pref/index.json", { cache: "no-cache" });
    if (res.ok) prefIndex = (await res.json()).prefs || {};
  } catch { /* まだデータがない */ }
  return prefIndex;
}
async function loadPrefData() {
  if (S.placesMode === "off" || S.map.getZoom() < PREF_MIN_ZOOM) return;
  const idx = await loadPrefIndex();
  if (!idx) return;
  const b = S.map.getBounds();
  const want = Object.entries(idx).filter(([code, v]) => code !== "JP-40" && v.bbox &&
    !(v.bbox[0] > b.getNorth() || v.bbox[2] < b.getSouth() || v.bbox[1] > b.getEast() || v.bbox[3] < b.getWest()))
    .map(([code, v]) => [code, v.name]).filter(([code]) => !prefLists.has(code) && !prefLoading.has(code)).slice(0, 6);
  await Promise.all(want.map(async ([code, name]) => {
    prefLoading.add(code);
    try {
      const res = await fetch(`data/pref/${code}.json`);
      if (!res.ok) return;
      const j = await res.json();
      const list = (j.elements || []).map(toPlace).filter((p) => p && FK_COLOR[p.kind])
        .map((p) => ({ ...p, tagPref: p.tagPref || name }));
      prefLists.set(code, list);
      for (const p of list) if (!placeById.has(p.id)) placeById.set(p.id, p);
    } catch { /* 読めなかった県はあとでもう一度 */ } finally { prefLoading.delete(code); }
  }));
  if (want.length) { renderFukuoka(); renderPlaces(); }
}
function* dotPlaces() {
  yield* fkPlaces;
  if (S.map.getZoom() >= PREF_MIN_ZOOM) for (const list of prefLists.values()) yield* list;
}
function renderFukuoka() {
  if (!S.fk) return;
  S.fk.clearLayers();
  const z = S.map.getZoom();
  if (S.placesMode === "off" || z >= PLACE_MIN_ZOOM) return;
  const r = z < 9 ? 2.5 : z < 11 ? 3.5 : 5;
  const b = S.map.getBounds().pad(0.1);
  for (const p of dotPlaces()) {
    if (S.placesMode === "conv" && p.kind !== "conv") continue;
    if (!b.contains([p.lat, p.lng]) || isRegistered(p)) continue;
    L.circleMarker([p.lat, p.lng], { renderer: S.canvas, radius: r, weight: 1, color: "#fff", fillColor: FK_COLOR[p.kind] || "#111", fillOpacity: 0.9 })
      .on("click", () => openPlace(placeById.get(p.id) || p)).addTo(S.fk);
  }
}
// コンビニの目印：チェーン名の札（色は上の表で決めた値だけを使う）
function cvsBadge(c) {
  const b = el("span", { class: "cvs", text: c ? c.label : "🏪 コンビニ" });
  if (c) { b.style.background = c.bg; b.style.color = c.fg; }
  return b;
}
// 「あった／少し／なかった」のかんたん報告ボタン
function quickButtons(onPick) {
  return el("div", { class: "quick" },
    el("p", { class: "quick-q", text: "ワンピースカード、あった？" }),
    el("div", { class: "quick-row" },
      ...[["in", "✅ あった"], ["low", "⚠️ 少しあった"], ["out", "❌ 売り切れ"], ["na", "🚫 取り扱いなし"]].map(([k, t]) =>
        el("button", { type: "button", class: `q ${k}`, text: t, onclick: () => ready() && onPick(k) }))));
}
// 未登録のお店を、報告や写真のときに自動で登録する（都道府県がわからなければ null）
async function storeForPlace(place, prefFallback = "") {
  const g = await placeGeo(place);
  const pref = g.pref || prefFallback;
  if (!pref) return null;
  const st = await S.backend.ensureStore(osmStoreId(place), { name: place.name, lat: +place.lat.toFixed(6), lng: +place.lng.toFixed(6), address: clean(g.addr || "", 120), pref });
  if (!S.stores.some((x) => x.id === st.id)) { S.stores.push(st); addPrefOption(st.pref); }
  return st;
}
// OpenStreetMapのお店は「osm_node_123」のような決まったIDで保存する（同じお店が二重にできない）
export const osmStoreId = (p) => "osm_" + p.id.replace("/", "_");
function isRegistered(p) {
  const sid = osmStoreId(p);
  return S.stores.some((s) => s.id === sid || (s.name === p.name && distM(s, p) < 60));
}
// 都道府県と住所を調べる（1回だけ）
function placeGeo(p) {
  if (!p.geo) {
    p.geo = geo(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18&accept-language=ja&lat=${p.lat}&lon=${p.lng}`)
      .then((pl) => ({ pref: p.tagPref || prefOf(pl.address), addr: (p.addr && p.addr.length >= 6) ? p.addr : (addrOf(pl.address) || p.addr) }))
      .catch(() => ({ pref: p.tagPref, addr: p.addr }));
  }
  return p.geo;
}
function openPlace(p) {
  // 住所：調べ終わったら書きかえる
  const addrLine = el("p", { class: "addr", text: p.addr ? `📍 ${p.tagPref || ""}${p.addr}` : "📍 住所を調べています…" });
  placeGeo(p).then((g) => {
    const full = `${g.pref || ""}${g.addr || ""}`;
    addrLine.textContent = full ? `📍 ${full}` : "📍 住所がわかりませんでした";
  });
  const repBtn = el("button", { class: "btn sec", type: "button", text: "📝 くわしく報告する", onclick: () => ready() && openReportForm({ id: null, name: p.name }, p) });
  openSheet(
    p.kind === "conv" ? el("div", { class: "sheet-badge" }, cvsBadge(p.chain)) : null,
    el("h2", { text: p.kind === "conv" ? p.name : `${KIND[p.kind][0]} ${p.name}` }),
    el("p", { class: "sub", text: KIND[p.kind][1] }),
    addrLine,
    el("p", { class: "small", text: "まだ在庫の報告がありません。見かけたら最初の報告をしてみよう！" }),
    quickButtons((k) => openReportForm({ id: null, name: p.name }, p, k)),
    repBtn,
    photoSection(null, async () => {
      const st = await storeForPlace(p);
      if (!st) throw new Error("no-pref");
      render();
      return st;
    }, p),
    el("a", { class: "btn ghost", href: `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`, target: "_blank", rel: "noopener noreferrer", text: "🧭 地図アプリで道案内", style: "text-align:center;text-decoration:none" }),
    el("p", { class: "small", text: "お店の情報：© OpenStreetMap contributors" }),
  );
}

// ---------- 下から出るパネル ----------
function openSheet(...nodes) {
  const body = $("#sheetBody");
  body.replaceChildren(...nodes.filter((n) => n != null && n !== false));
  $("#sheet").hidden = false;
  $("#sheet").scrollTop = 0;
}
function closeSheet() { $("#sheet").hidden = true; }

// ---------- ログインまわり ----------
function ready() {
  if (!S.user) { openLogin(); return false; }
  if (!S.user.emailVerified) { openVerify(); return false; }
  if (!S.user.nickname) { openNickname(); return false; }
  return true;
}
function busy(btn, fn) {
  return async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    try { await fn(); } catch (e) { console.warn(e); toast(errMsg(e)); } finally { btn.disabled = false; }
  };
}
function openLogin() {
  const email = el("input", { type: "email", autocomplete: "email", inputmode: "email", maxLength: 254, placeholder: "you@example.com" });
  const pw = el("input", { type: "password", autocomplete: "current-password", minLength: 8, maxLength: 128, placeholder: "8文字以上" });
  const g = el("button", { class: "btn sec", type: "button", text: "Googleでログイン" });
  const login = el("button", { class: "btn", type: "button", text: "メールでログイン" });
  const signup = el("button", { class: "btn ghost", type: "button", text: "メールで新規登録" });
  const forgot = el("button", { class: "btn ghost", type: "button", text: "パスワードを忘れた" });
  const check = () => {
    const e = clean(email.value, 254), p = pw.value;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw { code: "auth/invalid-email" };
    if (p.length < 8) throw { code: "auth/weak-password" };
    return [e, p];
  };
  g.onclick = busy(g, () => S.backend.signInGoogle());
  login.onclick = busy(login, () => S.backend.signInEmail(...check()));
  signup.onclick = busy(signup, async () => { await S.backend.signUpEmail(...check()); toast("確認メールを送りました"); });
  forgot.onclick = busy(forgot, async () => {
    const e = clean(email.value, 254);
    if (!e) return toast("メールアドレスを入れてから押してね");
    await S.backend.resetPassword(e); toast("再設定メールを送りました（登録がある場合）");
  });
  openSheet(
    el("h2", { text: "ログイン" }),
    el("p", { class: "sub", text: "在庫の報告・👍・通報にはログインが必要です。見るだけならログインなしでOK。" }),
    g, el("p", { class: "divider", text: "または" }),
    el("label", { text: "メールアドレス" }), email,
    el("label", { text: "パスワード" }), pw,
    login, signup, forgot,
    el("p", { class: "small", text: "公開されるのはニックネームだけです。メールアドレスは他の人に見えません。ログインすると、利用規約とプライバシーポリシーに同意したことになります。" }),
    aboutLink("📄 利用規約・プライバシーポリシーを読む"),
  );
}
function openVerify() {
  const done = el("button", { class: "btn", type: "button", text: "メールのリンクを押した！" });
  const again = el("button", { class: "btn ghost", type: "button", text: "確認メールをもう一度送る" });
  const out = el("button", { class: "btn ghost", type: "button", text: "ログアウト" });
  done.onclick = busy(done, async () => {
    S.user = await S.backend.refreshUser();
    updateAccountBtn();
    if (S.user?.emailVerified) { toast("確認できました！"); if (!S.user.nickname) openNickname(); else closeSheet(); }
    else toast("まだ確認できていません。メールを見てね");
  });
  again.onclick = busy(again, async () => { await S.backend.resendVerification(); toast("送りました"); });
  out.onclick = busy(out, async () => { await S.backend.signOut(); closeSheet(); });
  openSheet(el("h2", { text: "メールを確認してね" }),
    el("p", { class: "sub", text: "なりすまし防止のため、確認メールのリンクを押した人だけ投稿できます。迷惑メールフォルダも見てね。" }),
    done, again, out);
}
function openNickname(after) {
  const input = el("input", { type: "text", maxLength: 20, placeholder: "例：お宝ハンター", value: S.user?.nickname || "" });
  const save = el("button", { class: "btn", type: "button", text: "決定" });
  save.onclick = busy(save, async () => {
    const n = clean(input.value, 20);
    if (!n) return toast("ニックネームを入れてね");
    if (URL_RE.test(n) || /[<>@]/.test(n)) return toast("URLや記号（< > @）は使えません");
    await S.backend.setNickname(n);
    S.user = { ...S.user, nickname: n };
    updateAccountBtn(); toast("ニックネームを保存しました");
    after ? after() : closeSheet();
  });
  openSheet(el("h2", { text: "ニックネーム" }), el("p", { class: "sub", text: "報告といっしょに表示されます（20文字まで）。本名はやめておこう。" }),
    el("label", { text: "ニックネーム" }), input, save);
}
async function openAccount() {
  if (!S.user || !S.user.emailVerified || !S.user.nickname) return void ready();
  const stat = el("div", { class: "stat" }, el("div", {}, el("b", { text: "…" }), "報告"), el("div", {}, el("b", { text: "…" }), "もらった👍"), el("div", {}, el("b", { text: "…" }), "開拓"), el("div", {}, el("b", { text: "…" }), "ポイント"));
  const nick = el("button", { class: "btn ghost", type: "button", text: "ニックネームを変える" });
  const out = el("button", { class: "btn ghost", type: "button", text: "ログアウト" });
  const del = el("button", { class: "btn ghost danger", type: "button", text: "アカウントを削除" });
  nick.onclick = () => openNickname(openAccount);
  out.onclick = busy(out, async () => { await S.backend.signOut(); closeSheet(); toast("ログアウトしました"); });
  del.onclick = openDeleteAccount;
  openSheet(el("h2", { text: S.user.nickname }), el("p", { class: "sub", text: "報告1回＝10pt、👍1つ＝5pt、開拓1店＝20pt" }), stat, nick, out,
    el("button", { class: "btn ghost", type: "button", text: "🏆 月間ランキング・表彰", onclick: openRanking }),
    el("button", { class: "btn ghost", type: "button", text: "🏴 開拓者ランキング", onclick: openPioneers }), aboutLink(), del);
  try {
    const st = await S.backend.myStats();
    const b = stat.querySelectorAll("b");
    const pioneered = S.stores.filter((s) => s.createdBy && s.createdBy === S.user.uid).length;
    b[0].textContent = st.reports; b[1].textContent = st.likes; b[2].textContent = pioneered;
    b[3].textContent = st.reports * 10 + st.likes * 5 + pioneered * PIONEER_PT;
  } catch (e) { console.warn(e); }
}
function aboutLink(text = "ℹ️ このアプリについて・プライバシー・規約") {
  return el("a", { class: "btn ghost", href: "about.html", text });
}
function openDeleteAccount() {
  const yes = el("button", { class: "btn danger", type: "button", text: "削除する（元に戻せません）" });
  const no = el("button", { class: "btn ghost", type: "button", text: "やめる" });
  no.onclick = openAccount;
  yes.onclick = busy(yes, async () => {
    const myUid = S.user?.uid || "me";
    try {
      await S.backend.deleteAccount();
    } catch (e) {
      if (e?.code === "auth/requires-recent-login") {
        toast("安全のため、いったんログアウトして、もう一度ログインしてから削除してね");
        return;
      }
      throw e;
    }
    S.user = null; S.reports = S.reports.filter((r) => r.uid !== myUid);
    updateAccountBtn(); closeSheet(); toast("アカウントを削除しました。ご利用ありがとうございました");
    loadData();
  });
  openSheet(el("h2", { text: "アカウントを削除しますか？" }),
    el("p", { class: "sub", text: "メールアドレス・ニックネーム・あなたの報告・あなたの写真がすべて消えます。👍や通報の「押した印」は不正防止のため残ります。登録したお店はみんなの地図のデータなので残ります。" }),
    yes, no);
}
function updateAccountBtn() {
  const b = $("#accountBtn");
  b.textContent = !S.user ? "ログイン" : S.user.nickname ? `👤 ${S.user.nickname.slice(0, 8)}` : "設定";
}

// ---------- お店のパネル ----------
// ---------- Xでシェア ----------
const APP_URL = "https://khbsk777-web.github.io/onepiece-card-map/";
const TAGS = "#ワンピースカード #ワンピカ #トレジャーカードマップ";
function xShareBtn(text, url) {
  const href = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  return el("a", { class: "btn x-share", href, target: "_blank", rel: "noopener noreferrer", text: "𝕏 でシェア" });
}
// ---------- 開拓者（そのお店を最初に地図に登録した人） ----------
const PIONEER_PT = 20; // 開拓1店＝20pt
function pioneerOf(s) {
  if (s.pioneer) return s.pioneer;
  // 古いお店：登録した人の報告が読み込めていれば、その名前を使う
  const r = S.reports.find((x) => x.uid && x.uid === s.createdBy && x.nickname);
  return r ? r.nickname : "";
}
function pioneerRanking() {
  const count = new Map();
  for (const s of S.stores) {
    const n = pioneerOf(s);
    if (n) count.set(n, (count.get(n) || 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]);
}
function openPioneers() {
  const list = pioneerRanking();
  const me = S.user?.nickname;
  const myRank = me ? list.findIndex(([n]) => n === me) : -1;
  const medal = (i) => ["🥇", "🥈", "🥉"][i] || `${i + 1}位`;
  openSheet(el("h2", { text: "🏴 開拓者ランキング" }),
    el("p", { class: "sub", text: "まだだれも登録していないお店を、最初に地図に登録した人が「開拓者」です。1店につき20pt！" }),
    me ? el("p", { class: "pioneer-me", text: myRank >= 0 ? `あなた（${me}）：${myRank + 1}位・${list[myRank][1]}店` : `あなた（${me}）：まだ開拓なし。緑の円の中の未登録のお店に報告してみよう！` }) : null,
    ...(list.length ? list.slice(0, 30).map(([n, c], i) => el("div", { class: "pioneer-row" + (n === me ? " me" : "") },
      el("span", { class: "rank", text: medal(i) }), el("span", { class: "name", text: n }), el("span", { class: "cnt", text: `${c}店` })))
      : [el("p", { class: "small", text: "まだ開拓者がいません。最初の開拓者になろう！" })]),
    el("button", { class: "btn ghost", type: "button", text: "もどる", onclick: openFeed }));
}

// ---------- 月間ランキングと表彰（集計は GitHub Actions が6時間ごとに data/ranking.json に保存） ----------
let rankingCache = null;
async function loadRanking() {
  if (rankingCache && Date.now() - rankingCache.t < 10 * 60e3) return rankingCache.data;
  const res = await fetch("data/ranking.json", { cache: "no-cache" });
  if (!res.ok) throw new Error("まだランキングがありません");
  rankingCache = { t: Date.now(), data: await res.json() };
  return rankingCache.data;
}
const monthLabel = (ym) => { const [y, m] = String(ym || "").split("-"); return y ? `${y}年${Number(m)}月` : ""; };
const medal = (i) => ["🥇", "🥈", "🥉"][i] || `${i + 1}位`;
function rankRows(list, me) {
  return list.map((x, i) => el("div", { class: "pioneer-row" + (x.name === me ? " me" : "") },
    el("span", { class: "rank", text: medal(i) }),
    el("span", { class: "name" }, x.name, x.reports != null ? el("small", { class: "rank-sub", text: ` 報告${x.reports}・👍${x.likes}・開拓${x.pioneer}` }) : null),
    el("span", { class: "cnt", text: `${x.pt}pt` })));
}
async function openRanking() {
  openSheet(el("h2", { text: "🏆 月間ランキング" }), el("p", { class: "sub", text: "読み込み中…" }));
  let d;
  try { d = await loadRanking(); } catch {
    return openSheet(el("h2", { text: "🏆 月間ランキング" }), el("p", { class: "sub", text: "ランキングはまだ集計されていません。6時間ごとに更新されます。" }),
      el("button", { class: "btn ghost", type: "button", text: "もどる", onclick: openFeed }));
  }
  const me = S.user?.nickname;
  const cur = d.current || { top: [] }, last = d.last || { top: [] };
  const myIdx = me ? cur.top.findIndex((x) => x.name === me) : -1;
  const upd = d.updated ? new Date(d.updated) : null;
  const share = last.top.length ? xShareBtn(
    `🏆 ${monthLabel(last.month)}のトレジャーカードマップ 月間ランキング\n` +
    last.top.slice(0, 3).map((x, i) => `${["🥇", "🥈", "🥉"][i]} ${x.name}さん ${x.pt}pt`).join("\n") +
    `\n在庫報告ありがとうございました！\n${TAGS}`, APP_URL) : null;
  openSheet(el("h2", { text: "🏆 月間ランキング" }),
    el("p", { class: "sub", text: `報告1回＝10pt・👍1つ＝5pt・開拓1店＝20pt。毎月1日にリセット。上位の人は毎月ここで表彰します（賞品なし・名誉だけ）。${upd ? `（${upd.getMonth() + 1}/${upd.getDate()} ${upd.getHours()}時 更新）` : ""}` }),
    el("h3", { text: `${monthLabel(cur.month)}（${cur.players || 0}人が参加中）` }),
    me ? el("p", { class: "pioneer-me", text: myIdx >= 0 ? `あなた（${me}）：${myIdx + 1}位・${cur.top[myIdx].pt}pt` : `あなた（${me}）：まだランク外。報告や開拓でポイントをためよう！` }) : null,
    ...(cur.top.length ? rankRows(cur.top, me) : [el("p", { class: "small", text: "今月はまだだれもポイントを持っていません。一番乗りのチャンス！" })]),
    last.top.length ? el("h3", { text: `🎉 ${monthLabel(last.month)}の表彰` }) : null,
    ...(last.top.length ? rankRows(last.top.slice(0, 3), me) : []),
    share,
    (d.hall || []).length > 1 ? el("details", { class: "hall" }, el("summary", { text: "📜 歴代の表彰" }),
      ...d.hall.map((h) => el("p", { class: "small", text: `${monthLabel(h.month)}：` + h.top.map((x, i) => `${["🥇", "🥈", "🥉"][i]}${x.name}（${x.pt}pt）`).join(" ") }))) : null,
    el("button", { class: "btn ghost", type: "button", text: "🏴 開拓者ランキング（ずっと）", onclick: openPioneers }),
    el("button", { class: "btn ghost", type: "button", text: "もどる", onclick: openFeed }));
}

function storeShareText(s, reps) {
  const r = [...reps].sort((a, b) => b.createdAt - a.createdAt)[0];
  const st = r ? `${STATUS[r.status] || ""}${itemLabel(r) ? `（${itemLabel(r)}）` : ""}・${timeAgo(r.createdAt)}` : "まだ報告なし";
  return `【${s.name}】ワンピースカードの在庫：${st}\nみんなで在庫を報告し合う地図はこちら👇\n${TAGS}`;
}

async function openStore(id) {
  const s = S.stores.find((x) => x.id === id);
  if (!s) return;
  const reps = S.reports.filter((r) => r.storeId === id);
  const ids = reps.map((r) => r.id);
  const reportBtn = el("div", {}, quickButtons((k) => openReportForm(s, null, k)),
    el("button", { class: "btn sec", type: "button", text: "📝 くわしく報告する", onclick: () => ready() && openReportForm(s) }));
  const gmap = el("a", { class: "btn ghost", href: `https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}`, target: "_blank", rel: "noopener noreferrer", text: "🧭 地図アプリで道案内", style: "text-align:center;text-decoration:none" });
  const listBox = el("div");
  const ch = chainOf(s.name);
  openSheet(ch ? el("div", { class: "sheet-badge" }, cvsBadge(ch)) : null, el("h2", { text: s.name }), el("p", { class: "addr", text: `📍 ${[s.pref, s.address].filter(Boolean).join("") || "住所未登録"}` }), pioneerOf(s) ? el("p", { class: "pioneer", text: `🏴 開拓者：${pioneerOf(s)}さん` }) : null, reportBtn, photoSection(s, async () => s), listBox, gmap, xShareBtn(storeShareText(s, reps), `${APP_URL}?s=${encodeURIComponent(s.id)}`));
  if (S.user?.emailVerified && ids.length) {
    try { [S.liked, S.flagged] = await Promise.all([S.backend.myVotes(ids, "like"), S.backend.myVotes(ids, "flag")]); } catch {}
  }
  listBox.replaceChildren(
    el("p", { class: "meta", style: "margin-top:14px", text: `最近${DAYS}日の報告（${reps.length}件）` }),
    ...(reps.length ? reps.map(reportItem) : [el("p", { class: "small", text: "まだ報告がありません。最初の報告をしてみよう！" })]),
  );
}
function reportItem(r) {
  if ((r.flags || 0) >= HIDE_FLAGS) return el("div", { class: "report small", text: "通報が多いため非表示になっています" });
  const mine = S.user && r.uid === (S.backend.isDemo ? "me" : S.user.uid);
  const like = el("button", { type: "button", text: `👍 役に立った ${r.likes || 0}`, disabled: mine || S.liked.has(r.id) });
  like.onclick = busy(like, async () => {
    if (!ready()) return;
    await S.backend.vote(r.id, "like"); r.likes = (r.likes || 0) + 1; S.liked.add(r.id);
    like.textContent = `👍 役に立った ${r.likes}`; like.disabled = true; setTimeout(() => (like.disabled = true));
  });
  const flag = el("button", { type: "button", text: S.flagged.has(r.id) ? "🚩 通報済み" : "🚩 通報", disabled: mine || S.flagged.has(r.id) });
  flag.onclick = busy(flag, async () => {
    if (!ready()) return;
    if (!confirmInline(flag)) return;
    await S.backend.vote(r.id, "flag"); r.flags = (r.flags || 0) + 1; S.flagged.add(r.id);
    flag.textContent = "🚩 通報済み"; setTimeout(() => (flag.disabled = true)); toast("通報しました。ありがとう！"); render();
  });
  const del = mine ? el("button", { type: "button", text: "🗑 削除" }) : null;
  if (del) del.onclick = busy(del, async () => {
    if (!confirmInline(del)) return;
    await S.backend.deleteReport(r.id);
    S.reports = S.reports.filter((x) => x.id !== r.id); render(); openStore(r.storeId);
  });
  return el("div", { class: "report" },
    el("div", { class: "row" },
      el("div", {}, el("span", { class: `badge ${r.status}`, text: STATUS[r.status] || "?" }), " ",
        el("b", { text: PRODUCTS[r.product] || "" }), itemLabel(r) ? el("span", { class: "meta", text: ` ${itemLabel(r)}` }) : null),
      el("span", { class: "meta", text: timeAgo(r.createdAt) })),
    el("div", { class: "meta", text: `${SALE[r.saleType] || ""}・${r.nickname || "名無し"}` }),
    r.note ? el("p", { class: "note", text: r.note }) : null,
    el("div", { class: "acts" }, like, flag, del));
}
// ---------- お店の写真 ----------
// 写真は端末の中で小さくしてから送る。描き直すので位置情報などの隠れた情報は消える
const PHOTO_MAX = 1024, PHOTO_LIMIT = 290000, THUMB_MAX = 240, THUMB_LIMIT = 38000;
async function loadImage(file) {
  const url = URL.createObjectURL(file);
  try { const img = new Image(); img.src = url; await img.decode(); return img; }
  finally { setTimeout(() => URL.revokeObjectURL(url), 2000); }
}
export function encodeImage(img, max, limit) {
  const c = document.createElement("canvas"), ctx = c.getContext("2d");
  let scale = Math.min(1, max / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
  for (let i = 0; i < 6; i++) {
    const w = Math.max(1, Math.round((img.naturalWidth || img.width) * scale)), h = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
    c.width = w; c.height = h;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    for (const q of [0.78, 0.62, 0.48]) {
      const data = c.toDataURL("image/jpeg", q);
      if (data.length <= limit) return { data, w, h };
    }
    scale *= 0.8;
  }
  throw new Error("too-big");
}
function photoSection(store, getStore, where = store) {
  const grid = el("div", { class: "photo-grid" });
  const input = el("input", { type: "file", accept: "image/*", hidden: true });
  const add = el("button", { class: "btn sec", type: "button", text: "📷 写真を投稿する" });
  add.onclick = () => { if (ready()) input.click(); };
  input.onchange = busy(add, async () => {
    const file = input.files && input.files[0];
    input.value = "";
    if (!file) return;
    if (!/^image\//.test(file.type) || file.size > 25 * 1024 * 1024) return toast("写真のファイルを選んでね（25MBまで）");
    if (where && !(await nearCheck(where))) return;
    add.textContent = "⏳ 写真を小さくしています…";
    try {
      const img = await loadImage(file);
      const full = encodeImage(img, PHOTO_MAX, PHOTO_LIMIT);
      const thumb = encodeImage(img, THUMB_MAX, THUMB_LIMIT);
      add.textContent = "⏳ 送信中…";
      const st = await getStore();
      const ph = await S.backend.addPhoto({ storeId: st.id, thumb: thumb.data, w: full.w, h: full.h }, full.data);
      toast("写真を投稿しました！");
      if (!store) return openStore(st.id);
      grid.prepend(photoThumb(ph, st));
      grid.querySelector(".photo-empty")?.remove();
    } finally { add.textContent = "📷 写真を投稿する"; }
  });
  const box = el("div", { class: "photos" },
    el("p", { class: "meta", style: "margin-top:14px", text: "📷 お店の写真（売り場・棚など）" }),
    grid, add, input,
    el("p", { class: "small", text: "人の顔や、ほかの人が写っている写真は投稿しないでね。位置情報などは自動で消してから送ります。" }));
  if (store) {
    grid.append(el("p", { class: "small photo-empty", text: "読み込み中…" }));
    S.backend.listPhotos(store.id).then((list) => {
      const show = list.filter((x) => (x.flags || 0) < HIDE_FLAGS).sort((a, b) => b.createdAt - a.createdAt).slice(0, 12);
      grid.replaceChildren(...(show.length ? show.map((ph) => photoThumb(ph, store)) : [el("p", { class: "small photo-empty", text: "まだ写真がありません" })]));
    }).catch(() => grid.replaceChildren(el("p", { class: "small photo-empty", text: "写真を読み込めませんでした" })));
  } else {
    grid.append(el("p", { class: "small photo-empty", text: "まだ写真がありません" }));
  }
  return box;
}
function photoThumb(ph, store) {
  const img = el("img", { src: ph.thumb, alt: "お店の写真", loading: "lazy" });
  return el("button", { type: "button", class: "photo-th", onclick: () => openPhoto(ph, store) }, img,
    el("span", { class: "photo-time", text: timeAgo(ph.createdAt) }));
}
function openPhoto(ph, store) {
  const big = el("img", { class: "photo-big", src: ph.thumb, alt: "お店の写真" });
  S.backend.getPhotoData(ph.id).then((d) => { if (d) big.src = d; }).catch(() => {});
  const mine = S.user && ph.uid === (S.backend.isDemo ? "me" : S.user.uid);
  const flag = el("button", { type: "button", text: "🚩 通報", disabled: mine });
  flag.onclick = busy(flag, async () => {
    if (!ready() || !confirmInline(flag)) return;
    await S.backend.flagPhoto(ph.id); ph.flags = (ph.flags || 0) + 1;
    flag.textContent = "🚩 通報済み"; setTimeout(() => (flag.disabled = true)); toast("通報しました。ありがとう！");
  });
  const del = mine ? el("button", { type: "button", text: "🗑 削除" }) : null;
  if (del) del.onclick = busy(del, async () => {
    if (!confirmInline(del)) return;
    await S.backend.deletePhoto(ph.id); toast("写真を削除しました"); openStore(store.id);
  });
  openSheet(el("h2", { text: store.name }),
    el("p", { class: "meta", text: `${ph.nickname || "名無し"}・${timeAgo(ph.createdAt)}` }),
    big,
    el("div", { class: "acts" }, flag, del),
    el("button", { class: "btn ghost", type: "button", text: "← お店にもどる", onclick: () => openStore(store.id) }));
}

// 2回押しで確定（ブラウザのダイアログを使わない）
function confirmInline(btn) {
  if (btn.dataset.armed) return true;
  btn.dataset.armed = "1"; const old = btn.textContent; btn.textContent = "もう一度押すと確定";
  setTimeout(() => { if (btn.isConnected && !btn.disabled) { delete btn.dataset.armed; btn.textContent = old; } }, 3000);
  return false;
}
function seg(options, initial) {
  let val = initial;
  const box = el("div", { class: "seg", role: "radiogroup" });
  for (const [k, label] of Object.entries(options)) {
    const b = el("button", { type: "button", role: "radio", class: k === val ? "on" : "", text: label, "aria-checked": String(k === val) });
    b.onclick = () => { val = k; for (const x of box.children) { x.classList.toggle("on", x === b); x.setAttribute("aria-checked", String(x === b)); } };
    box.append(b);
  }
  return { box, get: () => val };
}
// ---------- 商品名の候補（みんなの入力から学習） ----------
const ITEM_KEY = "opmap-my-items";
const normItem = (v) => clean(String(v || "").normalize("NFKC").replace(/\s+/g, " "), 30);
function myItems() { try { return JSON.parse(localStorage.getItem(ITEM_KEY)) || []; } catch { return []; } }
function rememberItem(name) {
  if (!name) return;
  try { localStorage.setItem(ITEM_KEY, JSON.stringify([name, ...myItems().filter((x) => x !== name)].slice(0, 10))); } catch { /* 保存できなくても動かす */ }
}
// みんなの報告で多く使われた商品名ほど上に出す（自分が最近入れた名前は少し優先）
function itemSuggestions(typed) {
  const score = new Map();
  for (const r of S.reports) {
    const n = normItem(r.itemName);
    if (n) score.set(n, (score.get(n) || 0) + 1);
  }
  myItems().forEach((n, i) => score.set(n, (score.get(n) || 0) + 3 - i * 0.2));
  const q = normItem(typed).toLowerCase();
  return [...score.entries()]
    .filter(([n]) => !q || (n.toLowerCase().includes(q) && n.toLowerCase() !== q))
    .sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n]) => n);
}
// カードが置いてある場所のよくある例（タップでメモに入る）
const PLACE_HINTS = ["レジ横", "レジの後ろの棚", "カード売り場", "店員さんに聞く", "入口の近く", "おもちゃ売り場"];
const itemLabel = (r) => normItem(r.itemName) || r.setCode || "";

function openReportForm(s, place = null, initStatus = "in") {
  const product = seg(PRODUCTS, "booster");
  const status = seg(STATUS, initStatus);
  const sale = seg(SALE, "pack");
  const item = el("input", { type: "text", maxLength: 30, placeholder: "例：最強の戦士（わからなければ空でOK）", autocomplete: "off", enterkeyhint: "done" });
  const itemBox = el("div", { class: "sugg-chips" });
  const drawItems = () => {
    itemBox.replaceChildren(...itemSuggestions(item.value).map((n) =>
      el("button", { type: "button", class: "s-chip", text: n, onclick: () => { item.value = n; drawItems(); } })));
  };
  item.oninput = drawItems; drawItems();
  const note = el("textarea", { maxLength: 100, placeholder: "例：レジ横の棚に10パックくらい（100文字まで・URL不可）" });
  const placeBox = el("div", { class: "sugg-chips" }, ...PLACE_HINTS.map((h) =>
    el("button", { type: "button", class: "s-chip", text: h, onclick: () => {
      const cur = note.value.trim();
      if (!cur.includes(h)) note.value = (cur ? cur + "・" : "") + h;
    } })));
  const send = el("button", { class: "btn", type: "button", text: "報告する" });
  // 未登録のお店：都道府県がわからないときだけ選んでもらう
  const prefLabel = el("label", { text: "都道府県", hidden: true });
  const prefSel = el("select", { hidden: true }, el("option", { value: "", text: "都道府県を選ぶ" }), ...PREFS.map((x) => el("option", { value: x, text: x })));
  if (place) placeGeo(place).then((g) => { if (!g.pref) { prefLabel.hidden = false; prefSel.hidden = false; } });
  send.onclick = busy(send, async () => {
    const itemName = normItem(item.value);
    const n = clean(note.value, 100);
    if (URL_RE.test(itemName + n) || /[<>]/.test(itemName + n)) return toast("商品名やメモにURLや < > は書けません");
    if (!(await nearCheck(place || s))) return;
    if (place) {
      const st = await storeForPlace(place, prefSel.value);
      if (!st) { prefLabel.hidden = false; prefSel.hidden = false; return toast("都道府県を選んでね"); }
      s = st;
    }
    const base = { storeId: s.id, product: product.get(), setCode: "", status: status.get(), saleType: sale.get(), note: n };
    let rep;
    try {
      rep = await S.backend.addReport(itemName ? { ...base, itemName } : base);
    } catch (e) {
      // サーバーのルールがまだ古いとき：商品名をメモの先頭に入れて送り直す
      if (!itemName || e?.code !== "permission-denied") throw e;
      rep = await S.backend.addReport({ ...base, note: clean(`【${itemName}】${n}`, 100) });
    }
    rememberItem(itemName);
    S.reports.unshift(rep); render(); toast("報告ありがとう！ +10pt"); openStore(s.id);
  });
  openSheet(el("h2", { text: "在庫を報告" }), el("p", { class: "sub", text: s.name }),
    prefLabel, prefSel,
    el("label", { text: "商品" }), product.box,
    el("label", { text: "商品名（任意）" }), item, itemBox,
    el("label", { text: "いまの状態" }), status.box,
    el("label", { text: "売り方" }), sale.box,
    el("label", { text: "カードが置いてある場所（メモ・任意）" }), placeBox, note,
    el("div", { class: "warn", text: "見たままの情報だけ書いてね。ウソの情報・転売の呼びかけ・個人情報は禁止です。" }),
    send);
}

// ---------- お店の登録 ----------
let lastGeo = 0;
async function geo(url) {
  const wait = Math.max(0, 1100 - (Date.now() - lastGeo)); // OSMの決まり：1秒に1回まで
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastGeo = Date.now();
  const res = await fetch(url, { headers: { Accept: "application/json" }, referrerPolicy: "strict-origin-when-cross-origin" });
  if (!res.ok) throw new Error("geo");
  return res.json();
}
function prefOf(a = {}) {
  const p = a.province || a.state || "";
  return PREFS.includes(p) ? p : "";
}
// 住所を日本の順番で組み立てる（都道府県は別に持つので入れない）
function addrOf(a = {}) {
  const parts = [a.county, a.city || a.town || a.village, a.city_district, a.suburb, a.quarter, a.neighbourhood, a.city_block, a.house_number];
  const out = [];
  for (const x of parts) if (x && !out.includes(x)) out.push(x);
  if (out.length < 2 && a.road) out.push(a.road);
  return clean(out.join(""), 120);
}
function openAddStore() {
  if (!ready()) return;
  const q = el("input", { type: "search", maxLength: 60, placeholder: "例：〇〇書店 梅田" });
  const results = el("div", { class: "search-results" });
  const go = el("button", { class: "btn sec", type: "button", text: "🔍 店名で探す" });
  const tap = el("button", { class: "btn", type: "button", text: "📍 地図をタップして選ぶ" });
  go.onclick = busy(go, async () => {
    const text = clean(q.value, 60);
    if (text.length < 2) return toast("2文字以上入れてね");
    const c = S.map.getCenter();
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&countrycodes=jp&limit=8&accept-language=ja&q=${encodeURIComponent(text)}&viewbox=${c.lng - 1},${c.lat + 1},${c.lng + 1},${c.lat - 1}`;
    const list = await geo(url);
    results.replaceChildren(...(list.length ? list.map((p) => el("button", { type: "button", onclick: () => storeForm({ lat: +p.lat, lng: +p.lon }, p) },
      el("b", { text: p.name || p.display_name.split(",")[0] }), el("div", { class: "meta", text: p.display_name }))) : [el("p", { class: "small", text: "見つかりませんでした。地図をタップして選んでね" })]));
  });
  tap.onclick = () => { closeSheet(); S.mode = "pick"; $("#modeBanner").hidden = false; };
  openSheet(el("h2", { text: "お店を登録" }), el("p", { class: "sub", text: "カードを売っているお店を追加しよう" }), q, go, results, tap);
}
async function pickPoint(ll) {
  S.mode = null; $("#modeBanner").hidden = true;
  let place = null;
  try { place = await geo(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18&accept-language=ja&lat=${ll.lat}&lon=${ll.lng}`); } catch {}
  storeForm({ lat: ll.lat, lng: ll.lng }, place);
}
function storeForm(pt, place) {
  if (!(pt.lat > 20 && pt.lat < 46 && pt.lng > 122 && pt.lng < 154)) return toast("日本国内の場所を選んでね");
  const name = el("input", { type: "text", maxLength: 40, value: clean(place?.name || "", 40), placeholder: "例：〇〇書店 梅田店" });
  const pref = el("select", {}, el("option", { value: "", text: "都道府県を選ぶ" }), ...PREFS.map((p) => el("option", { value: p, text: p })));
  pref.value = prefOf(place?.address);
  const addr = el("input", { type: "text", maxLength: 120, value: addrOf(place?.address), placeholder: "例：大阪市北区梅田" });
  const near = S.stores.filter((s) => distM(s, pt) < 60);
  const save = el("button", { class: "btn", type: "button", text: "この場所で登録" });
  save.onclick = busy(save, async () => {
    const n = clean(name.value, 40), a = clean(addr.value, 120);
    if (!n) return toast("お店の名前を入れてね");
    if (!pref.value) return toast("都道府県を選んでね");
    if (URL_RE.test(n + a) || /[<>]/.test(n + a)) return toast("URLや < > は入れられません");
    if (!(await nearCheck(pt))) return;
    const st = await S.backend.addStore({ name: n, lat: +pt.lat.toFixed(6), lng: +pt.lng.toFixed(6), address: a, pref: pref.value });
    S.stores.push(st); addPrefOption(st.pref); render();
    S.map.setView([st.lat, st.lng], Math.max(S.map.getZoom(), 16));
    toast("お店を登録しました！"); openStore(st.id);
  });
  openSheet(el("h2", { text: "お店の情報" }),
    near.length ? el("div", { class: "warn" }, "近くにもう登録されています。同じお店なら、そちらに報告してね：",
      ...near.map((s) => el("button", { class: "btn ghost", type: "button", text: s.name, onclick: () => openStore(s.id) }))) : null,
    el("label", { text: "お店の名前" }), name,
    el("label", { text: "都道府県" }), pref,
    el("label", { text: "住所（だいたいでOK）" }), addr,
    el("p", { class: "small", text: "個人の家など、お店以外の場所は登録しないでね。" }),
    save);
}

// ---------- 新着 ----------
function openFeed() {
  const items = S.reports.filter((r) => (r.flags || 0) < HIDE_FLAGS).filter((r) => {
    const s = S.stores.find((x) => x.id === r.storeId);
    return s && (!S.pref || s.pref === S.pref) && (!S.product || r.product === S.product);
  }).slice(0, 40);
  openSheet(el("h2", { text: "🆕 新着の報告" }), el("p", { class: "sub", text: S.pref || "全国" }),
    el("div", { class: "two-btn" },
      el("button", { class: "btn sec", type: "button", text: "🏆 月間ランキング", onclick: openRanking }),
      el("button", { class: "btn sec", type: "button", text: "🏴 開拓者", onclick: openPioneers })),
    ...(items.length ? items.map((r) => {
      const s = S.stores.find((x) => x.id === r.storeId);
      return el("div", { class: "feed-item", role: "button", tabindex: "0", onclick: () => { S.map.setView([s.lat, s.lng], 16); openStore(s.id); } },
        el("div", { class: "row", style: "display:flex;justify-content:space-between" }, el("b", { text: s.name }), el("span", { class: "meta", text: timeAgo(r.createdAt) })),
        el("div", {}, el("span", { class: `badge ${r.status}`, text: STATUS[r.status] }), " ", PRODUCTS[r.product] || "", itemLabel(r) ? ` ${itemLabel(r)}` : ""));
    }) : [el("p", { class: "small", text: "まだ報告がありません" })]),
    xShareBtn(`ワンピースカードの在庫を、みんなで報告し合う地図アプリ「トレジャーカードマップ」（非公式）を使ってみてね🗺\n${TAGS}`, APP_URL));
}

// ---------- 絞り込み ----------
function addPrefOption(p) {
  const sel = $("#prefFilter");
  if (!p || [...sel.options].some((o) => o.value === p)) return;
  const opts = [...sel.options].slice(1).map((o) => o.value).concat(p).sort((a, b) => PREFS.indexOf(a) - PREFS.indexOf(b));
  sel.replaceChildren(el("option", { value: "", text: "全国" }), ...opts.map((v) => el("option", { value: v, text: v })));
  sel.value = S.pref;
}
function initFilters() {
  document.querySelectorAll(".chip[data-f]").forEach((b) => b.addEventListener("click", () => {
    S.filter = b.dataset.f;
    document.querySelectorAll(".chip[data-f]").forEach((x) => x.classList.toggle("on", x === b));
    render();
  }));
  const pm = $("#placesMode");
  try { const v = localStorage.getItem("opmap-places-mode"); if (["all", "conv", "off"].includes(v)) S.placesMode = v; } catch {}
  pm.value = S.placesMode;
  pm.onchange = () => {
    S.placesMode = pm.value;
    try { localStorage.setItem("opmap-places-mode", S.placesMode); } catch {}
    renderPlaces(); loadPlaces(); renderFukuoka(); loadPrefData();
    if (S.placesMode !== "off" && S.map.getZoom() < PLACE_MIN_ZOOM) toast("地図を拡大すると、周辺のお店が出てきます（コンビニ・ヨドバシは点で表示中）");
  };
  const pf = $("#productFilter");
  pf.replaceChildren(el("option", { value: "", text: "全商品" }), ...Object.entries(PRODUCTS).map(([k, v]) => el("option", { value: k, text: v })));
  pf.onchange = () => { S.product = pf.value; render(); };
  $("#prefFilter").onchange = (e) => {
    S.pref = e.target.value; render();
    const pts = S.stores.filter((s) => s.pref === S.pref).map((s) => [s.lat, s.lng]);
    if (pts.length) S.map.fitBounds(pts, { padding: [40, 40], maxZoom: 13 });
  };
}

// ---------- データ読み込み ----------
async function loadData() {
  try {
    const [stores, reports] = await Promise.all([S.backend.listStores(), S.backend.listRecentReports(DAYS)]);
    S.stores = stores.filter((s) => typeof s.lat === "number" && typeof s.lng === "number");
    S.reports = reports.sort((a, b) => b.createdAt - a.createdAt);
    S.stores.forEach((s) => addPrefOption(s.pref));
    render();
  } catch (e) { console.warn(e); toast("データを読み込めませんでした"); }
}

// ---------- 起動 ----------
async function main() {
  initMap();
  initFilters();
  // 現在地：青い点で表示（ボタンを押したとき＋アプリを開いたとき）
  const showMe = (p) => {
    const ll = [p.coords.latitude, p.coords.longitude];
    S.myPos = { lat: ll[0], lng: ll[1], t: Date.now() };
    // 緑の円：ここから3km以内のお店なら投稿・報告できる
    if (S.range) S.range.setLatLng(ll); else S.range = L.circle(ll, { radius: POST_RANGE_M, color: "#16a34a", weight: 2, opacity: 0.8, dashArray: "6 6", fillColor: "#22c55e", fillOpacity: 0.08, interactive: false }).addTo(S.map);
    if (S.me) S.me.setLatLng(ll); else S.me = L.circleMarker(ll, { radius: 8, color: "#fff", weight: 3, fillColor: "#2563eb", fillOpacity: 1, interactive: false }).addTo(S.map);
    return ll;
  };
  const locate = (fromStart) => {
    if (!navigator.geolocation) { if (!fromStart) toast("この端末では現在地が使えません"); return; }
    navigator.geolocation.getCurrentPosition((p) => {
      const ll = showMe(p);
      // 開いた直後にお店などを選んでいたら、勝手に地図を動かさない
      if (!fromStart || $("#sheet").hidden) S.map.setView(ll, fromStart ? 15 : 14);
    }, () => toast(fromStart ? "現在地を表示するには、位置情報を許可してね（📍ボタンでもう一度）" : "現在地を使えませんでした（設定で許可してね）"),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  };
  $("#locateBtn").onclick = () => locate(false);
  locate(true);
  // 歩いて動いたら青い点もついてくる（地図は動かさない）
  if (navigator.geolocation) navigator.geolocation.watchPosition(showMe, () => {}, { enableHighAccuracy: true, maximumAge: 30000 });
  const useFirebase = !!(firebaseConfig.apiKey && firebaseConfig.projectId);
  if (useFirebase) {
    const { createFirebaseBackend } = await import("./backend-firebase.js");
    S.backend = await createFirebaseBackend(firebaseConfig, appCheckSiteKey);
  } else {
    const { createDemoBackend } = await import("./backend-demo.js");
    S.backend = createDemoBackend();
    $("#demoNote").hidden = false;
  }
  let first = true;
  S.backend.onAuth((u) => {
    S.user = u; updateAccountBtn();
    if (!first && u && !$("#sheet").hidden) { if (u.emailVerified && !u.nickname) openNickname(); else if (!u.emailVerified) openVerify(); else closeSheet(); }
    first = false;
  });
  $("#accountBtn").onclick = openAccount;
  $("#addStoreBtn").onclick = openAddStore;
  $("#feedBtn").onclick = openFeed;
  // 開いてすぐ見える「𝕏」ボタン：アプリを紹介する文をXに入れて開く
  $("#xShareFab").href = `https://x.com/intent/post?text=${encodeURIComponent(`ワンピースカードの在庫を、みんなで報告し合える地図アプリ「トレジャーカードマップ」🗺\nコンビニ・本屋・ヨドバシの入荷情報がひと目で分かる！無料で使えるよ\n${TAGS}`)}&url=${encodeURIComponent(APP_URL)}`;
  $("#modeCancel").onclick = () => { S.mode = null; $("#modeBanner").hidden = true; };
  $(".sheet-close").onclick = closeSheet;
  loadFukuoka(); // 待たずに先に読み込む（お店の点はすぐ出す）
  loadPrefData();
  await loadData();
  // シェアされたリンク（?s=お店ID）から開いたら、そのお店を表示
  try {
    const sid = new URLSearchParams(location.search).get("s");
    const st = sid && /^[A-Za-z0-9_-]{1,64}$/.test(sid) && S.stores.find((x) => x.id === sid);
    if (st) { S.map.setView([st.lat, st.lng], 16); openStore(st.id); }
  } catch { /* 読めないリンクは無視 */ }
  // 画面を開いている間は2分ごとに更新
  setInterval(() => { if (document.visibilityState === "visible" && $("#sheet").hidden) loadData(); }, 120000);
}
if (typeof window !== "undefined" && !window.__TEST__) main();

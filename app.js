// トレジャーカードマップ（非公式） — 画面の動き
// 安全のための決まり：ユーザーが入力した文字は必ず textContent で表示し、HTMLとして扱わない。
import { firebaseConfig, appCheckSiteKey } from "./firebase-config.js";
import { getLang, setLang, startI18n } from "./i18n.js?v=6";

// 他のサイトの中にこのアプリをうめこんで、だまして押させる攻撃（クリックジャッキング）を防ぐ
if (window.top !== window.self) { try { window.top.location.replace(window.self.location.href); } catch { document.documentElement.style.display = "none"; } }

// ---------- 定数 ----------
export const PRODUCTS = { booster: "ブースターパック", extra: "エクストラブースター", premium: "プレミアムブースター", starter: "スタートデッキ", other: "その他" };
export const STATUS = { in: "⭐ 在庫あり", low: "⭐ 残りわずか", out: "売り切れ", soon: "入荷予定", na: "取り扱いなし" };
export const SALE = { pack: "バラ売り", box: "BOX", lottery: "抽選", other: "その他" };
export const LIMIT = { none: "制限なし", p1: "1人1パック", p2: "1人2パック", p3: "1人3パック", p5: "1人5パック", p10: "1人10パック", box1: "1人1BOX" };
// 商品名で探す（ひらがな・カタカナ・全角半角のちがいはあまり気にしない）
const kana = (v) => String(v || "").normalize("NFKC").toLowerCase().replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/\s+/g, "");
export const matchItem = (r, q) => kana([r.itemName, r.setCode, r.note].filter(Boolean).join(" ")).includes(kana(q));
// 「もうなかった」が「まだあった」より多い報告は、売り切れとして扱う
export const effStatus = (r) => (r && (r.gone || 0) > (r.still || 0) && ["in", "low"].includes(r.status) ? "out" : r?.status);
const PREFS = "北海道 青森県 岩手県 宮城県 秋田県 山形県 福島県 茨城県 栃木県 群馬県 埼玉県 千葉県 東京都 神奈川県 新潟県 富山県 石川県 福井県 山梨県 長野県 岐阜県 静岡県 愛知県 三重県 滋賀県 京都府 大阪府 兵庫県 奈良県 和歌山県 鳥取県 島根県 岡山県 広島県 山口県 徳島県 香川県 愛媛県 高知県 福岡県 佐賀県 長崎県 熊本県 大分県 宮崎県 鹿児島県 沖縄県".split(" ");
const DAYS = 7;            // 何日前までの報告を読むか
const STALE_H = 72;        // これより古い情報は薄く表示
const HIDE_FLAGS = 3;      // 通報がこの数以上で非表示
const URL_RE = /(https?:\/\/|www\.|\.com|\.jp\b|\.xyz)/i;
// 見えない文字・向きを変える文字（なりすまし対策）。サーバーのルールと同じ
const HIDDEN_RE = /[\u0000-\u0009\u000B-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/;
// 電話番号・メールアドレス（個人情報の書きこみ防止）。全角数字も半角にしてからチェック
const PII_RE = /(0[0-9]{1,4}-?[0-9]{1,4}-?[0-9]{4}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/;
const NICK_NG = /(運営|公式|管理者|admin|official|support|bandai|バンダイ|トレジャーカードマップ)/i;
// 入力した文章の問題を1つ返す（問題なければ空）
function textProblem(v, { pii = true } = {}) {
  if (URL_RE.test(v) || /[<>]/.test(v)) return "URLや < > は書けません";
  if (HIDDEN_RE.test(v)) return "見えない特殊な文字は使えません";
  if (pii && PII_RE.test(String(v).normalize("NFKC").replace(/[ー－]/g, "-"))) return "電話番号やメールアドレスは書けません（個人情報を守るため）";
  return "";
}

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
// お気に入りのお店（この端末だけに保存。ログイン不要）
const FAV_KEY = "opmap-favs";
function loadFavs() { try { return new Set(JSON.parse(localStorage.getItem(FAV_KEY)) || []); } catch { return new Set(); } }
function saveFavs() { try { localStorage.setItem(FAV_KEY, JSON.stringify([...S.favs].slice(0, 200))); } catch { /* なにもしない */ } pushFavsChanged(); }
// フォロー（この端末だけに保存。uid → ニックネーム）
const FOLLOW_KEY = "opmap-follows";
function loadFollows() { try { return JSON.parse(localStorage.getItem(FOLLOW_KEY)) || {}; } catch { return {}; } }
function saveFollows() { try { localStorage.setItem(FOLLOW_KEY, JSON.stringify(S.follows)); } catch { /* なにもしない */ } }
const S = { follows: loadFollows(), isAdmin: false, heat: false, favs: loadFavs(), stilled: new Set(), goned: new Set(), placesMode: "all", places: null, backend: null, user: null, stores: [], reports: [], filter: "all", product: "", pref: "", mode: null, map: null, layer: null, me: null, liked: new Set(), flagged: new Set() };

// 店ごとの「いちばん新しい報告」
export function latestFor(reports, storeId, product) {
  for (const r of reports) {
    if (r.storeId !== storeId || (r.flags || 0) >= HIDE_FLAGS) continue;
    if (product && r.product !== product) continue;
    return r;
  }
  return null;
}
export function visibleStores(stores, reports, { filter, product, pref, favs, itemQ }, now = Date.now()) {
  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
  return stores.filter((s) => {
    if (pref && s.pref !== pref) return false;
    const r = latestFor(reports, s.id, product);
    // 商品名で探す：最新の報告の商品名に入っていて、在庫ありのお店だけ
    if (itemQ && !(r && ["in", "low"].includes(effStatus(r)) && matchItem(r, itemQ))) return false;
    if (filter === "fav") return favs && favs.has(s.id);
    if (filter === "stock") return r && ["in", "low"].includes(effStatus(r)) && now - r.createdAt < STALE_H * 3600e3;
    if (filter === "today") return r && r.createdAt >= startOfDay.getTime();
    return true;
  });
}

// ---------- 地図 ----------
function initMap() {
  S.map = L.map("map", { zoomControl: false, tap: true }).setView([36.2, 138.2], 5);
  // 国土地理院の地図：無料・APIキー不要（出典の表示が必要）
  const gsi = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>';
  // 地図は航空写真だけ（切りかえボタンなし）
  L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg", { minZoom: 5, maxZoom: 19, maxNativeZoom: 18, attribution: gsi }).addTo(S.map);
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
    const cls = r ? effStatus(r) : "none";
    const stale = r && now - r.createdAt > STALE_H * 3600e3;
    const ch = chainOf(s.name);
    // 在庫あり（最近の報告）は⭐マークでひと目で分かるように
    const star = (cls === "in" || cls === "low") && !stale;
    const fresh = r && Date.now() - r.createdAt < 30 * 60e3; // 30分以内の報告は光らせる
    const wrap = el("div", { class: "pinwrap" + (star ? " has-star" : "") + (fresh ? " fresh" : "") }, el("div", { class: `pin ${cls}${stale ? " stale" : ""}` }),
      star ? el("span", { class: "pin-star", text: "⭐" }) : null, ch ? cvsBadge(ch) : null);
    const icon = L.divIcon({ className: "", html: wrap, iconSize: [26, 26], iconAnchor: [13, 26] });
    if (star && !S.map.getPane("stock")) S.map.createPane("stock").style.zIndex = 660; // 在庫ありはほかのお店より前に出す
    L.marker([s.lat, s.lng], { icon, title: s.name, keyboard: true, ...(star ? { pane: "stock" } : {}) }).on("click", () => openStore(s.id)).addTo(S.layer);
  }
  renderPlaces();
  renderFukuoka();
  updateStockStrip();
  if (S.heat) renderHeat();
}

// ---------- 画面の上に「100km以内の在庫あり」を近い順に並べる ----------
const STRIP_KM = 100;
function updateStockStrip() {
  const bar = $("#stockStrip");
  if (!bar) return;
  const me = S.myPos;
  if (!me) { bar.hidden = true; document.body.classList.remove("has-strip"); return; }
  const now = Date.now(), seen = new Set(), list = [];
  for (const r of S.reports) { // 新しい順
    if ((r.flags || 0) >= HIDE_FLAGS || seen.has(r.storeId)) continue;
    if (S.product && r.product !== S.product) continue;
    seen.add(r.storeId);
    if (!["in", "low"].includes(effStatus(r)) || now - r.createdAt > STALE_H * 3600e3) continue;
    const s = S.stores.find((x) => x.id === r.storeId);
    if (!s) continue;
    const d = distM(me, s) / 1000;
    if (d <= STRIP_KM) list.push({ s, r, d });
  }
  list.sort((a, b) => a.d - b.d);
  if (!list.length) { bar.hidden = true; document.body.classList.remove("has-strip"); return; }
  const km = (d) => (d < 1 ? `${Math.round(d * 1000)}m` : `${d.toFixed(d < 10 ? 1 : 0)}km`);
  bar.replaceChildren(
    el("button", { class: "strip-head", type: "button", text: `⭐ ${STRIP_KM}km以内の在庫 ${list.length}件`, onclick: openNearby }),
    ...list.slice(0, 15).map((x) => el("button", { class: `strip-item ${effStatus(x.r)}`, type: "button",
      onclick: () => { S.map.setView([x.s.lat, x.s.lng], 16); openStore(x.s.id); } },
      el("b", { text: x.s.name }), el("span", { text: ` ${km(x.d)}・${timeAgo(x.r.createdAt)}` }))));
  bar.hidden = false;
  document.body.classList.add("has-strip");
}

// ---------- 周辺のお店・駅（OpenStreetMap） ----------
// まだ登録されていないお店と駅名を、地図を拡大したときだけ表示する
const PLACE_MIN_ZOOM = 14;   // これ以上拡大したら表示
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
  const hours = clean(t.opening_hours || "", 80);
  return { id: `${e.type}/${e.id}`, kind, name, lat, lng, addr, tagPref, chain, ...(hours ? { hours } : {}) };
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
  const b = S.map.getBounds().pad(0.2);
  let n = 0;
  for (const p of placeById.values()) {
    if (!b.contains([p.lat, p.lng])) continue;
    if (S.placesMode === "conv" && p.kind !== "conv" && p.kind !== "station") continue;
    if (p.kind !== "station" && isRegistered(p)) continue; // 報告があるお店は色つきピンで出す
    if (++n > 600) break;
    // まだ投稿がないお店は名前を出さない。押すと名前が出る。駅名はいつも表示
    const showName = p.kind === "station";
    // 投稿がないお店はチェーン名も出さず、種類のアイコンだけ（コンビニは🏪）
    const node = el("div", { class: `poi ${p.kind}` }, el("span", { class: "poi-ic", text: KIND[p.kind][0] }), showName ? el("span", { class: "poi-name", text: p.name }) : null);
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
const FK_KEY = "opmap-fukuoka-v4";
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
  for (const url of ["data/fukuoka.json", "https://raw.githubusercontent.com/treasure-card-map/treasure-card-map.github.io/main/data/fukuoka.json"]) {
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

// ---------- ログインの有効期限：24時間使わなかったら自動でログアウト ----------
const SESSION_KEY = "opmap-last-active";
const SESSION_MS = 24 * 60 * 60 * 1000;
function touchSession() { try { localStorage.setItem(SESSION_KEY, String(Date.now())); } catch { /* 保存できない端末 */ } }
function lastActive() {
  try { return Number(localStorage.getItem(SESSION_KEY)) || 0; } catch { return 0; }
}
// 記録がまだない人（この機能を入れる前からログインしていた人）は、今から数える
function sessionExpired() { const t = lastActive(); return t > 0 && Date.now() - t > SESSION_MS; }
async function expireIfIdle() {
  if (!S.user || !sessionExpired()) { if (S.user) touchSession(); return false; }
  try { await S.backend.signOut(); } catch (e) { console.warn(e); }
  try { localStorage.removeItem(SESSION_KEY); } catch { /* なにもしない */ }
  S.user = null; updateAccountBtn();
  toast("24時間以上使われなかったので、安全のためログアウトしました。もう一度ログインしてね");
  return true;
}

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
  g.onclick = busy(g, () => { touchSession(); return S.backend.signInGoogle(); });
  login.onclick = busy(login, () => { const a = check(); touchSession(); return S.backend.signInEmail(...a); });
  signup.onclick = busy(signup, async () => { const a = check(); touchSession(); await S.backend.signUpEmail(...a); toast("確認メールを送りました"); });
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
    if (/@/.test(n)) return toast("記号の @ は使えません");
    if (textProblem(n)) return toast(textProblem(n));
    if (NICK_NG.test(n)) return toast("運営・公式とまちがえやすい名前は使えません");
    const firstTime = !S.user?.nickname;
    await S.backend.setNickname(n);
    S.user = { ...S.user, nickname: n };
    if (firstTime) claimInviteOnce();
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
  const titleLine = el("p", { class: "title-line", text: "称号を読み込み中…" });
  const badgeBox = el("div", { class: "badges" });
  openSheet(el("h2", { text: S.user.nickname }), titleLine, el("p", { class: "sub", text: "報告1回＝10pt、👍1つ＝5pt、開拓1店＝20pt、招待1人＝30pt、ミッション1つ＝5pt" }), stat,
    el("h3", { class: "mini-h", text: "🎖 バッジ" }), badgeBox,
    el("button", { class: "btn sec", type: "button", text: "🎁 友だちを招待（30pt）", onclick: openInvite }), nick, out,
    el("button", { class: "btn ghost", type: "button", text: "🏆 月間ランキング・表彰", onclick: openRanking }),
    el("button", { class: "btn ghost", type: "button", text: "🏴 開拓者ランキング", onclick: openPioneers }),
    S.isAdmin ? el("button", { class: "btn sec admin", type: "button", text: "🛠 運営者の管理画面", onclick: openAdmin }) : null, aboutLink(), del,
    el("details", { class: "hall" }, el("summary", { class: "small", text: "あなたのユーザーID（運営者の設定に使います）" }),
      el("p", { class: "small", style: "user-select:all;word-break:break-all", text: S.backend.isDemo ? "me" : S.user.uid })));
  try {
    const st = await S.backend.myStats();
    const b = stat.querySelectorAll("b");
    const pioneered = S.stores.filter((s) => s.createdBy && s.createdBy === S.user.uid).length;
    b[0].textContent = st.reports; b[1].textContent = st.likes; b[2].textContent = pioneered;
    const pt = st.reports * 10 + st.likes * 5 + pioneered * PIONEER_PT;
    b[3].textContent = pt;
    const t = titleFor(pt);
    titleLine.textContent = t.next ? `${t.icon} ${t.name}（次の「${t.next.name}」まであと${t.next.pt - pt}pt）` : `${t.icon} ${t.name}`;
    let times = [];
    try { times = await S.backend.myReportTimes(); } catch { /* 読めなくてもバッジは出す */ }
    const streak = bestStreak(times);
    badgeBox.replaceChildren(...BADGES.map((x) => {
      const got = x.test({ reports: st.reports, likes: st.likes, pioneered, streak });
      return el("div", { class: "badge-item" + (got ? " got" : ""), title: x.hint },
        el("span", { class: "b-ic", text: got ? x.icon : "🔒" }), el("span", { class: "b-name", text: x.name }), el("span", { class: "b-hint", text: x.hint }));
    }));
  } catch (e) { console.warn(e); titleLine.textContent = ""; }
}
// ---------- 称号とバッジ ----------
const TITLES = [
  { pt: 0, icon: "🧭", name: "見習い冒険家" }, { pt: 100, icon: "🗺", name: "探検家" }, { pt: 300, icon: "⚓", name: "航海士" },
  { pt: 1000, icon: "🚢", name: "船長" }, { pt: 3000, icon: "👑", name: "伝説の冒険家" },
];
function titleFor(pt) {
  let i = 0;
  TITLES.forEach((t, k) => { if (pt >= t.pt) i = k; });
  return { ...TITLES[i], next: TITLES[i + 1] || null };
}
const BADGES = [
  { icon: "🎉", name: "はじめての報告", hint: "報告1回", test: (x) => x.reports >= 1 },
  { icon: "📝", name: "報告マスター", hint: "報告10回", test: (x) => x.reports >= 10 },
  { icon: "🏅", name: "報告の達人", hint: "報告50回", test: (x) => x.reports >= 50 },
  { icon: "💎", name: "報告レジェンド", hint: "報告100回", test: (x) => x.reports >= 100 },
  { icon: "👍", name: "みんなの味方", hint: "👍を10個もらう", test: (x) => x.likes >= 10 },
  { icon: "🏴", name: "はじめての開拓", hint: "開拓1店", test: (x) => x.pioneered >= 1 },
  { icon: "🗾", name: "大開拓者", hint: "開拓10店", test: (x) => x.pioneered >= 10 },
  { icon: "🔥", name: "3日連続", hint: "3日続けて報告", test: (x) => x.streak >= 3 },
  { icon: "⚡", name: "7日連続", hint: "7日続けて報告", test: (x) => x.streak >= 7 },
];
// 日本時間で何日続けて報告したか（いちばん長い記録）
function bestStreak(times) {
  const days = [...new Set(times.map((t) => Math.floor((t + 9 * 3600e3) / 864e5)))].sort((a, b) => a - b);
  let best = 0, run = 0;
  days.forEach((d, i) => { run = i && d === days[i - 1] + 1 ? run + 1 : 1; best = Math.max(best, run); });
  return best;
}

// ---------- 入荷しやすい曜日・時間帯（6時間ごとに自動集計した data/trends.json） ----------
let trendsCache = null;
async function loadTrends() {
  if (trendsCache) return trendsCache;
  try { const res = await fetch("data/trends.json", { cache: "no-cache" }); const j = res.ok ? await res.json() : {}; trendsCache = j.stores || {}; S.sold = j.sold || {}; } catch { trendsCache = {}; S.sold = {}; }
  return trendsCache;
}
const WD = ["日", "月", "火", "水", "木", "金", "土"], SLOT = ["朝", "昼", "夕方", "夜", "深夜"];
function trendText(t) {
  if (!t || t.n < 3) return "";
  const top = (arr, names) => { const m = Math.max(...arr); return arr.map((v, i) => (v === m && m > 0 ? names[i] : null)).filter(Boolean).slice(0, 2).join("・"); };
  return `📈 入荷の報告が多いのは「${top(t.wd, WD)}曜日」の「${top(t.slot, SLOT)}」（最近60日・${t.n}件）`;
}

// ---------- 発売日カレンダー（data/releases.json） ----------
let releasesCache = null;
async function loadReleases() {
  if (releasesCache) return releasesCache;
  try { const res = await fetch("data/releases.json", { cache: "no-cache" }); releasesCache = res.ok ? (await res.json()).items || [] : []; } catch { releasesCache = []; }
  return releasesCache;
}
// 日本時間の「今日」から何日後か（0＝今日、1＝明日、マイナス＝発売ずみ）
function daysUntil(date) {
  const today = Math.floor((Date.now() + 9 * 3600e3) / 864e5);
  return Math.round(Date.parse(date + "T00:00:00+09:00") / 864e5 + 9 / 24) - today;
}
async function openCalendar() {
  const list = (await loadReleases()).map((x) => ({ ...x, d: daysUntil(x.date) })).filter((x) => x.d >= -7).sort((a, b) => a.d - b.d);
  const label = (d) => (d === 0 ? "🎉 今日発売" : d === 1 ? "⏰ 明日発売" : d < 0 ? "発売中" : `あと${d}日`);
  openSheet(el("h2", { text: "📅 発売日カレンダー" }),
    el("p", { class: "sub", text: "公式サイトで発表された発売日です。発売日の前日と当日は、アプリを開いたときにお知らせします。" }),
    ...(list.length ? list.map((x) => el("div", { class: "rel-row" + (x.d <= 1 ? " soon" : "") },
      el("div", {}, el("b", { text: x.name }), el("div", { class: "meta", text: `${x.date.replace(/-/g, "/")}（${WD[new Date(x.date + "T00:00:00+09:00").getDay()]}）${x.code ? "・" + x.code : ""}` })),
      el("span", { class: "rel-left", text: label(x.d) })))
      : [el("p", { class: "small", text: "いま発表されている発売予定はありません。" })]),
    el("button", { class: "btn ghost", type: "button", text: "もどる", onclick: openFeed }));
}
async function showReleaseBanner() {
  const soon = (await loadReleases()).map((x) => ({ ...x, d: daysUntil(x.date) })).filter((x) => x.d === 0 || x.d === 1);
  if (!soon.length) return;
  const x = soon[0];
  const b = $("#releaseBanner");
  b.querySelector("span").textContent = `📅 ${x.d === 0 ? "今日" : "明日"}は「${x.name}」の発売日！`;
  b.hidden = false;
  b.querySelector("span").onclick = x.d === 0 ? openReleaseDay : openCalendar;
  b.querySelector("button").onclick = () => { b.hidden = true; };
}

// 情報の新しさ：30分以内＝新鮮、3時間以内＝ふつう、それより前＝古め
function ageClass(t) { const m = (Date.now() - t) / 60e3; return m < 30 ? "age-new" : m < 180 ? "age-mid" : "age-old"; }

// ---------- 近くの在庫あり・お気に入り ----------
function storeRow(s, r, distKm) {
  const st = r ? effStatus(r) : null;
  return el("div", { class: "feed-item", role: "button", tabindex: "0", onclick: () => { S.map.setView([s.lat, s.lng], 16); openStore(s.id); } },
    el("div", { class: "row", style: "display:flex;justify-content:space-between;gap:8px" },
      el("b", { text: (S.favs.has(s.id) ? "❤️ " : "") + s.name }), el("span", { class: "meta", text: distKm != null ? `${distKm < 1 ? Math.round(distKm * 1000) + "m" : distKm.toFixed(1) + "km"}` : "" })),
    r ? el("div", {}, el("span", { class: `badge ${st}`, text: STATUS[st] }), " ", itemLabel(r) || PRODUCTS[r.product] || "",
      r.limit && r.limit !== "none" ? el("span", { class: "meta", text: `・${LIMIT[r.limit]}` }) : null,
      el("span", { class: `meta age ${ageClass(r.createdAt)}`, text: `・${timeAgo(r.createdAt)}` }))
      : el("div", { class: "meta", text: `最近${DAYS}日の報告はまだありません` }));
}
// 在庫がある報告のリスト：距離（10〜300km・全国）と並び順（近い順・新しい順）を選べる
async function openNearby() {
  openSheet(el("h2", { text: "📋 在庫ありの報告リスト" }), el("p", { class: "sub", text: "現在地を調べています…" }));
  let me = null;
  try { me = await getPos(); } catch { /* 位置がわからないときは「全国・新しい順」で出す */ }
  let km = 30, sort = "near";
  try {
    const v = localStorage.getItem("opmap-near-km");
    km = v === "all" ? "all" : Math.min(300, Math.max(10, Number(v) || 30));
    sort = localStorage.getItem("opmap-near-sort") || "near";
  } catch { /* なにもしない */ }
  if (!me) { km = "all"; sort = "new"; }
  const sel = el("select", { class: "range-sel", "aria-label": "探す範囲", disabled: !me },
    ...Array.from({ length: 30 }, (_, i) => (i + 1) * 10).map((v) => el("option", { value: String(v), text: `${v}km以内` })),
    el("option", { value: "all", text: "全国" }));
  sel.value = String(km);
  const sortSel = el("select", { class: "range-sel", "aria-label": "並び順" },
    el("option", { value: "near", text: "近い順", disabled: !me }), el("option", { value: "new", text: "新しい順" }));
  sortSel.value = sort;
  const box = el("div");
  const q = el("input", { type: "search", class: "item-q", placeholder: "🔎 商品名で探す（例：最強の戦士）", value: S.itemQ || "", enterkeyhint: "search" });
  q.oninput = () => { S.itemQ = q.value.trim(); syncItemChip(); render(); draw(); };
  const draw = () => {
    const now = Date.now();
    const seen = new Set();
    const list = [];
    for (const r of S.reports) { // 新しい順に並んでいる
      if ((r.flags || 0) >= HIDE_FLAGS || seen.has(r.storeId)) continue;
      if (S.product && r.product !== S.product) continue;
      seen.add(r.storeId); // お店ごとに一番新しい報告だけ
      if (!["in", "low"].includes(effStatus(r)) || now - r.createdAt > STALE_H * 3600e3) continue;
      if (S.itemQ && !matchItem(r, S.itemQ)) continue;
      const s = S.stores.find((x) => x.id === r.storeId);
      if (!s) continue;
      const d = me ? distM(me, s) / 1000 : null;
      if (km !== "all" && d != null && d > km) continue;
      list.push({ s, r, d });
    }
    if (sort === "near" && me) list.sort((a, b) => a.d - b.d);
    box.replaceChildren(
      el("p", { class: "meta", text: `${list.length}件${list.length > 50 ? "（50件まで表示）" : ""}` }),
      ...(list.length ? list.slice(0, 50).map((x) => storeRow(x.s, x.r, x.d))
        : [el("p", { class: "small", text: `${km === "all" ? "全国" : km + "km以内"}の在庫情報はまだありません。範囲を広げるか、見つけたら報告してね！` })]));
  };
  sel.onchange = () => { km = sel.value === "all" ? "all" : Number(sel.value); try { localStorage.setItem("opmap-near-km", String(km)); } catch { /* なにもしない */ } draw(); };
  sortSel.onchange = () => { sort = sortSel.value; try { localStorage.setItem("opmap-near-sort", sort); } catch { /* なにもしない */ } draw(); };
  draw();
  openSheet(el("h2", { text: "📋 在庫ありの報告リスト" }),
    el("p", { class: "sub", text: `最近${STALE_H}時間に「在庫あり」「残りわずか」と報告されたお店です（お店ごとに最新の報告）。${me ? "" : "位置情報を許可すると距離で絞りこめます。"}` }),
    q,
    el("div", { class: "two-sel" }, el("div", {}, el("label", { text: "現在地からの距離" }), sel), el("div", {}, el("label", { text: "並び順" }), sortSel)),
    box,
    el("button", { class: "btn ghost", type: "button", text: "閉じる", onclick: closeSheet }));
}
function openFavorites() {
  markFavSeen(); $("#favNews").hidden = true;
  const list = S.stores.filter((s) => S.favs.has(s.id));
  const me = S.myPos;
  openSheet(el("h2", { text: "❤️ お気に入りのお店" }),
    el("p", { class: "sub", text: "お店の画面の「🤍」で追加できます（この端末に保存）。" }),
    ...(list.length ? list.map((s) => storeRow(s, latestFor(S.reports, s.id, S.product), me ? distM(me, s) / 1000 : null))
      : [el("p", { class: "small", text: "まだお気に入りがありません。よく行くお店を開いて「🤍 お気に入り」を押してね。" })]),
    el("button", { class: "btn ghost", type: "button", text: "もどる", onclick: openFeed }));
}

// ---------- 表示（ダークモード） ----------
const THEME_KEY = "opmap-theme";
const THEMES = { auto: "自動", light: "ライト", dark: "ダーク" };
function getTheme() { try { return localStorage.getItem(THEME_KEY) || "auto"; } catch { return "auto"; } }
function applyTheme() {
  const t = getTheme();
  const dark = t === "dark" || (t === "auto" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}
function cycleTheme(btn) {
  const order = ["auto", "light", "dark"];
  const next = order[(order.indexOf(getTheme()) + 1) % 3];
  try { localStorage.setItem(THEME_KEY, next); } catch { /* なにもしない */ }
  applyTheme();
  if (btn) btn.textContent = `🌙 表示：${THEMES[next]}`;
}

// ---------- 電波が弱いときの一時保存 ----------
const QUEUE_KEY = "opmap-queue";
function readQueue() { try { return JSON.parse(localStorage.getItem(QUEUE_KEY)) || []; } catch { return []; } }
function writeQueue(q) { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(0, 10))); } catch { /* なにもしない */ } }
function queueReport(payload) { writeQueue([...readQueue(), { payload, at: Date.now() }]); }
let flushing = false;
async function flushQueue() {
  if (flushing || !navigator.onLine || !S.user) return;
  const q = readQueue().filter((x) => Date.now() - x.at < 6 * 3600e3); // 6時間より古いものは送らない（情報が古くなるため）
  if (!q.length) { writeQueue([]); return; }
  flushing = true;
  let sent = 0;
  try {
    while (q.length) {
      const { payload } = q[0];
      try { const rep = await S.backend.addReport(payload); S.reports.unshift(rep); sent++; }
      catch (e) { if (e?.code === "unavailable") break; console.warn(e); } // 送れないものは捨てる（ルール違反など）
      q.shift(); writeQueue(q);
      if (q.length) await new Promise((ok) => setTimeout(ok, 5500)); // 連投制限（5秒）に合わせて少し待つ
    }
  } finally { flushing = false; }
  if (sent) { render(); toast(`📶 保存していた報告を${sent}件送りました`); }
}
window.addEventListener("online", () => flushQueue());

// ---------- 営業時間（OpenStreetMapのデータ） ----------
const DAY_JA = { Mo: "月", Tu: "火", We: "水", Th: "木", Fr: "金", Sa: "土", Su: "日", PH: "祝" };
function hoursJa(h) {
  if (!h) return "";
  if (/^24\/7$/.test(h.trim())) return "24時間営業";
  return h.replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/g, (m) => DAY_JA[m]).replace(/\boff\b/gi, "休み").replace(/;\s*/g, "／").replace(/,/g, "・");
}
function hoursFor(s) {
  let best = null, bd = 60; // 60m以内で一番近い、時間の情報があるお店
  for (const p of placeById.values()) {
    if (!p.hours) continue;
    const d = distM(s, p);
    if (d < bd) { bd = d; best = p; }
  }
  return best ? hoursJa(best.hours) : "";
}

// ---------- 地域ごとのまとめ ----------
function openRegions() {
  const now = Date.now(), today = Math.floor((now + 9 * 3600e3) / 864e5);
  const by = {};
  const seen = new Set();
  for (const r of S.reports) {
    const s = S.stores.find((x) => x.id === r.storeId);
    const pref = s?.pref || "不明";
    const x = by[pref] || (by[pref] = { stock: 0, today: 0, stores: 0 });
    if (Math.floor((r.createdAt + 9 * 3600e3) / 864e5) === today) x.today++;
    if (seen.has(r.storeId)) continue;
    seen.add(r.storeId);
    if (["in", "low"].includes(effStatus(r)) && now - r.createdAt < STALE_H * 3600e3) x.stock++;
  }
  for (const s of S.stores) { const x = by[s.pref || "不明"]; if (x) x.stores++; }
  const list = Object.entries(by).sort((a, b) => b[1].stock - a[1].stock || b[1].today - a[1].today);
  openSheet(el("h2", { text: "📊 地域のようす" }),
    el("p", { class: "sub", text: `都道府県ごとの「⭐在庫ありのお店（最近${STALE_H}時間）」と「今日の報告」の数です。` }),
    ...(list.length ? list.map(([pref, x]) => el("div", { class: "pioneer-row" },
      el("span", { class: "name", text: pref }), el("span", { class: "cnt", text: `⭐${x.stock}店` }), el("span", { class: "meta", text: `今日${x.today}件` })))
      : [el("p", { class: "small", text: "まだ報告がありません。" })]),
    el("button", { class: "btn ghost", type: "button", text: "もどる", onclick: openFeed }));
}

// ---------- フォロー中の人の報告 ----------
function openFollowing() {
  const ids = Object.keys(S.follows);
  const reps = S.reports.filter((r) => S.follows[r.uid] && (r.flags || 0) < HIDE_FLAGS).slice(0, 50);
  openSheet(el("h2", { text: "👥 フォロー中の人の報告" }),
    el("p", { class: "sub", text: ids.length ? `フォロー中：${ids.map((u) => S.follows[u]).join("、")}` : "報告の「👤 フォロー」を押すと、その人の報告をここで見られます（この端末に保存）。" }),
    ...(reps.length ? reps.map((r) => { const s = S.stores.find((x) => x.id === r.storeId); return s ? storeRow(s, r, S.myPos ? distM(S.myPos, s) / 1000 : null) : null; })
      : [el("p", { class: "small", text: ids.length ? `最近${DAYS}日の報告はまだありません。` : "" })]),
    ids.length ? el("details", { class: "hall" }, el("summary", { text: "フォローをやめる" }),
      ...ids.map((u) => el("button", { class: "btn ghost", type: "button", text: `${S.follows[u]}さんのフォローをやめる`,
        onclick: () => { delete S.follows[u]; saveFollows(); openFollowing(); } }))) : null,
    el("button", { class: "btn ghost", type: "button", text: "もどる", onclick: openFeed }));
}

// ---------- 在庫ヒートマップ（在庫ありの報告が多い地域を色の濃さで） ----------
function renderHeat() {
  if (!S.heatLayer) S.heatLayer = L.layerGroup().addTo(S.map);
  S.heatLayer.clearLayers();
  if (!S.heat) return;
  const now = Date.now(), seen = new Set();
  for (const r of S.reports) {
    if (seen.has(r.storeId)) continue;
    seen.add(r.storeId);
    if (!["in", "low"].includes(effStatus(r)) || now - r.createdAt > STALE_H * 3600e3) continue;
    const s = S.stores.find((x) => x.id === r.storeId);
    if (!s) continue;
    L.circle([s.lat, s.lng], { radius: 4000, stroke: false, fillColor: "#ef4444", fillOpacity: 0.18, interactive: false, renderer: S.canvas }).addTo(S.heatLayer);
    L.circle([s.lat, s.lng], { radius: 1500, stroke: false, fillColor: "#f97316", fillOpacity: 0.22, interactive: false, renderer: S.canvas }).addTo(S.heatLayer);
  }
}

// ---------- 発売日モード（発売日の当日だけ、今日の報告をまとめて表示） ----------
async function releaseToday() { return (await loadReleases()).find((x) => daysUntil(x.date) === 0) || null; }
async function openReleaseDay() {
  const rel = await releaseToday();
  const start = Math.floor((Date.now() + 9 * 3600e3) / 864e5) * 864e5 - 9 * 3600e3; // 日本時間の今日0時
  const seen = new Set(), rows = [];
  for (const r of S.reports) {
    if (r.createdAt < start || seen.has(r.storeId) || (r.flags || 0) >= HIDE_FLAGS) continue;
    seen.add(r.storeId);
    const s = S.stores.find((x) => x.id === r.storeId);
    if (s) rows.push(storeRow(s, r, S.myPos ? distM(S.myPos, s) / 1000 : null));
  }
  openSheet(el("h2", { text: `🎉 発売日モード${rel ? "：" + rel.name : ""}` }),
    el("p", { class: "sub", text: "今日（0時から）報告されたお店です。見つけたらどんどん報告してね！" }),
    ...(rows.length ? rows : [el("p", { class: "small", text: "今日の報告はまだありません。一番乗りのチャンス！" })]),
    el("button", { class: "btn ghost", type: "button", text: "閉じる", onclick: closeSheet }));
}

// ---------- 運営者の管理画面（通報の確認・削除、利用状況） ----------
async function openAdmin() {
  if (!S.isAdmin) return toast("運営者だけが使えます");
  openSheet(el("h2", { text: "🛠 運営者の管理画面" }), el("p", { class: "sub", text: "読み込み中…" }));
  let f = { reports: [], photos: [] }, st = null;
  try { f = await S.backend.adminFlagged(); } catch (e) { console.warn(e); }
  try { const res = await fetch("data/stats.json", { cache: "no-cache" }); if (res.ok) st = await res.json(); } catch { /* まだない */ }
  const repRow = (r) => {
    const s = S.stores.find((x) => x.id === r.storeId);
    const del = el("button", { class: "btn ghost danger", type: "button", text: "🗑 この報告を削除" });
    del.onclick = busy(del, async () => {
      if (!confirmInline(del)) return;
      await S.backend.deleteReport(r.id); S.reports = S.reports.filter((x) => x.id !== r.id); render(); toast("削除しました"); openAdmin();
    });
    return el("div", { class: "report" },
      el("div", { class: "row" }, el("b", { text: `🚩${r.flags}件　${s ? s.name : "（お店不明）"}` }), el("span", { class: "meta", text: timeAgo(r.createdAt) })),
      el("div", { class: "meta", text: [STATUS[r.status], itemLabel(r), r.nickname || "名無し"].filter(Boolean).join("・") }),
      r.note ? el("p", { class: "note", text: r.note }) : null, del);
  };
  const phRow = (p) => {
    const del = el("button", { class: "btn ghost danger", type: "button", text: "🗑 この写真を削除" });
    del.onclick = busy(del, async () => { if (!confirmInline(del)) return; await S.backend.deletePhoto(p.id); toast("削除しました"); openAdmin(); });
    return el("div", { class: "report" }, el("b", { text: `🚩${p.flags}件　${p.nickname || "名無し"}・${timeAgo(p.createdAt)}` }),
      p.thumb ? el("img", { src: p.thumb, alt: "通報された写真", style: "max-width:100%;border-radius:8px;margin:6px 0" }) : null, del);
  };
  const days = (st?.days || []).slice(-14);
  const max = Math.max(1, ...days.map((d) => d.reports));
  openSheet(el("h2", { text: "🛠 運営者の管理画面" }),
    el("h3", { class: "mini-h", text: `🚩 通報された報告（${f.reports.length}件）` }),
    ...(f.reports.length ? f.reports.map(repRow) : [el("p", { class: "small", text: "通報された報告はありません。" })]),
    el("h3", { class: "mini-h", text: `🚩 通報された写真（${f.photos.length}件）` }),
    ...(f.photos.length ? f.photos.map(phRow) : [el("p", { class: "small", text: "通報された写真はありません。" })]),
    el("h3", { class: "mini-h", text: "📊 利用状況（最近14日）" }),
    st ? el("p", { class: "meta", text: `合計：報告${st.total?.reports ?? "-"}件・報告があったお店${st.total?.stores ?? "-"}店・報告した人${st.total?.reporters ?? "-"}人（最近60日）` }) : null,
    ...(days.length ? days.map((d) => el("div", { class: "stat-bar" },
      el("span", { class: "d", text: d.date.slice(5).replace("-", "/") }),
      el("span", { class: "bar", style: `width:${Math.round((d.reports / max) * 100)}%` }),
      el("span", { class: "v", text: `${d.reports}件・${d.reporters}人` })))
      : [el("p", { class: "small", text: "利用状況は6時間ごとに集計されます。" })]),
    el("button", { class: "btn ghost", type: "button", text: "閉じる", onclick: closeSheet }));
}

// ---------- (2) ワンタップ報告：いちばん近いお店を自動で選ぶ ----------
const LAST_PRODUCT_KEY = "opmap-last-product";
function lastProduct() { try { const v = localStorage.getItem(LAST_PRODUCT_KEY); return PRODUCTS[v] ? v : "booster"; } catch { return "booster"; } }
async function openHere() {
  let me;
  try { me = await getPos(); } catch { return toast("位置情報を許可すると、いるお店を自動で選べます"); }
  const cands = [
    ...S.stores.map((s) => ({ s, d: distM(me, s) })),
    ...[...placeById.values()].filter((p) => p.kind !== "station" && !isRegistered(p)).map((p) => ({ p, d: distM(me, p) })),
  ].filter((x) => x.d <= 300).sort((a, b) => a.d - b.d).slice(0, 4);
  if (!cands.length) {
    if (S.map.getZoom() < PLACE_MIN_ZOOM) { S.map.setView([me.lat, me.lng], 17); loadPlaces(); }
    return toast("300m以内にお店が見つかりませんでした。地図からお店を選んでね");
  }
  const pick = (x) => {
    const name = x.s ? x.s.name : x.p.name;
    const box = el("div", { class: "here-card" },
      el("div", { class: "row" }, el("b", { text: name }), el("span", { class: "meta", text: `${Math.round(x.d)}m` })),
      el("div", { class: "here-btns" },
        ...[["in", "⭐ あった"], ["low", "⭐ 残りわずか"], ["out", "❌ なかった"]].map(([st, label]) => {
          const b = el("button", { class: `btn here ${st}`, type: "button", text: label });
          b.onclick = busy(b, () => quickReport(x, st));
          return b;
        })),
      el("button", { class: "btn ghost small-btn", type: "button", text: "くわしく報告する（商品名・購入制限など）",
        onclick: () => (x.s ? openReportForm(x.s, null, "in") : openReportForm({ id: null, name: x.p.name, lat: x.p.lat, lng: x.p.lng }, x.p, "in")) }));
    return box;
  };
  openSheet(el("h2", { text: "📍 いるお店で報告" }),
    el("p", { class: "sub", text: `近い順に${cands.length}件。${PRODUCTS[lastProduct()]}の在庫を、ボタン1つで報告できます。` }),
    ...cands.map(pick));
}
async function quickReport(x, status) {
  if (!ready()) return;
  if (!(await nearCheck(x.s || x.p))) return;
  let s = x.s;
  if (!s) {
    s = await storeForPlace(x.p);
    if (!s) return openReportForm({ id: null, name: x.p.name, lat: x.p.lat, lng: x.p.lng }, x.p, status); // 都道府県が分からないときは通常の画面で
    render();
  }
  const payload = { storeId: s.id, product: lastProduct(), setCode: "", status, saleType: "pack", note: "" };
  if (!navigator.onLine) { queueReport(payload); closeSheet(); return toast("📶 電波がないので、報告をスマホに保存しました。つながったら自動で送ります"); }
  const rep = await S.backend.addReport(payload);
  S.reports.unshift(rep); render(); openStore(s.id); afterReport(rep, s);
}

// ---------- (7)(10) 報告のあと：取り消しボタン（10秒）と、近くの未報告のお店 ----------
let postTimer;
function afterReport(rep, s) {
  try { localStorage.setItem(LAST_PRODUCT_KEY, rep.product); } catch { /* なにもしない */ }
  const bar = $("#postBar");
  const undo = el("button", { type: "button", class: "undo", text: "取り消す" });
  undo.onclick = busy(undo, async () => {
    await S.backend.deleteReport(rep.id);
    S.reports = S.reports.filter((x) => x.id !== rep.id); render(); openStore(s.id);
    bar.hidden = true; toast("報告を取り消しました");
  });
  // 1km以内で、まだ報告がないお店（開拓のチャンス）
  let next = null;
  const me = S.myPos || s;
  for (const p of placeById.values()) {
    if (p.kind === "station" || isRegistered(p)) continue;
    const d = distM(me, p);
    if (d <= 1000 && (!next || d < next.d)) next = { p, d };
  }
  const nextBox = next ? el("div", { class: "next" }, `🏴 近くに未報告のお店：${next.p.name}（${Math.round(next.d)}m）`,
    el("button", { type: "button", text: "見る", onclick: () => { bar.hidden = true; closeSheet(); S.map.setView([next.p.lat, next.p.lng], 17); openPlace(next.p); } })) : null;
  bar.replaceChildren(el("div", { class: "row" }, el("b", { text: "✅ 報告ありがとう！ +10pt" }), undo), nextBox);
  bar.hidden = false;
  clearTimeout(postTimer); postTimer = setTimeout(() => { bar.hidden = true; }, next ? 15000 : 10000);
  undo.disabled = false; setTimeout(() => { undo.disabled = true; undo.textContent = "取り消しは終了"; }, 10000);
}

// ---------- (8) 最近見たお店 ----------
const RECENT_KEY = "opmap-recent";
function readRecent() { try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; } }
function pushRecent(id) { try { localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...readRecent().filter((x) => x !== id)].slice(0, 10))); } catch { /* なにもしない */ } }
function openRecent() {
  const list = readRecent().map((id) => S.stores.find((s) => s.id === id)).filter(Boolean);
  openSheet(el("h2", { text: "🕘 最近見たお店" }),
    ...(list.length ? list.map((s) => storeRow(s, latestFor(S.reports, s.id, S.product), S.myPos ? distM(S.myPos, s) / 1000 : null))
      : [el("p", { class: "small", text: "まだありません。お店を開くとここに残ります（最大10件）。" })]),
    el("button", { class: "btn ghost", type: "button", text: "もどる", onclick: openFeed }));
}

// ---------- (9) 文字・ボタンの大きさ ----------
const BIG_KEY = "opmap-big-text";
function bigText() { try { return localStorage.getItem(BIG_KEY) === "1"; } catch { return false; } }
function setBigText(on) { try { localStorage.setItem(BIG_KEY, on ? "1" : "0"); } catch { /* なにもしない */ } document.documentElement.classList.toggle("big-text", on); }

// ---------- (1) お気に入りの新着まとめ ----------
const FAV_SEEN_KEY = "opmap-fav-seen";
function favSeen() { try { return Number(localStorage.getItem(FAV_SEEN_KEY)) || 0; } catch { return 0; } }
function markFavSeen() { try { localStorage.setItem(FAV_SEEN_KEY, String(Date.now())); } catch { /* なにもしない */ } }
let favNewsShown = false;
function showFavNews() {
  if (favNewsShown || !S.favs.size) return;
  const seen = favSeen();
  if (!seen) { markFavSeen(); return; } // はじめての日は数えない
  const news = S.reports.filter((r) => S.favs.has(r.storeId) && r.createdAt > seen && (r.flags || 0) < HIDE_FLAGS);
  favNewsShown = true;
  if (!news.length) return;
  const stock = news.filter((r) => ["in", "low"].includes(effStatus(r))).length;
  const b = $("#favNews");
  b.querySelector("span").textContent = `❤️ お気に入りのお店に新しい報告が${news.length}件${stock ? `（⭐在庫あり${stock}件）` : ""}`;
  b.hidden = false;
  b.querySelector("span").onclick = () => { b.hidden = true; markFavSeen(); openFavorites(); };
  b.querySelector("button").onclick = () => { b.hidden = true; markFavSeen(); };
}

// ---------- (5) はじめての人向けガイド ----------
const GUIDE_KEY = "opmap-guide-done";
const GUIDE = [
  { icon: "🗺", title: "在庫が地図でひと目で分かる", text: "⭐がついたピンは「在庫あり」のお店です。上の黄色い帯には、100km以内の在庫ありのお店が近い順に出ます。" },
  { icon: "📍", title: "見つけたらワンタップで報告", text: "お店で「📍 いるお店で報告」を押して「あった／なかった」を選ぶだけ。ログインが必要です（無料）。" },
  { icon: "🏆", title: "報告でポイント・称号がもらえる", text: "報告10pt・👍5pt・開拓20pt。月間ランキングで表彰されます。右下の🧭メニューから、いろいろな機能を使えます。" },
];
function openGuide(i = 0) {
  const g = GUIDE[i];
  const m = $("#guide");
  m.querySelector(".g-ic").textContent = g.icon;
  m.querySelector("h2").textContent = g.title;
  m.querySelector("p").textContent = g.text;
  m.querySelector(".g-dots").textContent = GUIDE.map((_, k) => (k === i ? "●" : "○")).join(" ");
  const next = m.querySelector(".g-next");
  next.textContent = i < GUIDE.length - 1 ? "次へ" : "はじめる！";
  next.onclick = () => (i < GUIDE.length - 1 ? openGuide(i + 1) : closeGuide());
  m.querySelector(".g-skip").onclick = closeGuide;
  m.hidden = false;
}
function closeGuide() { $("#guide").hidden = true; try { localStorage.setItem(GUIDE_KEY, "1"); } catch { /* なにもしない */ } }

// ---------- (3) 商品名で探しているときの表示 ----------
function syncItemChip() {
  const c = $("#itemQChip");
  if (!c) return;
  c.hidden = !S.itemQ;
  c.textContent = S.itemQ ? `🔎 ${S.itemQ} ×` : "";
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
const APP_URL = "https://treasure-card-map.github.io/";
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

// LINEで送る（友だちを選んで送れる）
function lineShareBtn(text, url) {
  return el("a", { class: "btn line-share", href: `https://line.me/R/share?text=${encodeURIComponent(text.replace(/\n#.*$/s, "") + "\n" + url)}`, target: "_blank", rel: "noopener noreferrer", text: "LINEで送る" });
}

function storeShareText(s, reps) {
  const r = [...reps].sort((a, b) => b.createdAt - a.createdAt)[0];
  // お店の名前や場所は入れない（どこにいるか分からないように）
  const item = r && itemLabel(r) ? `「${itemLabel(r)}」` : "ワンピースカード";
  const head = r && ["in", "low"].includes(r.status) ? `🎉 ${item}を見つけた！` : `🗺 ${item}の在庫をチェック中！`;
  return `${head}\nみんなでシェアしてカード集めよう！\n在庫を報告し合える地図アプリ「トレジャーカードマップ」はこちら👇\n${TAGS}`;
}

async function openStore(id) {
  const s = S.stores.find((x) => x.id === id);
  if (!s) return;
  pushRecent(id);
  const reps = S.reports.filter((r) => r.storeId === id);
  const ids = reps.map((r) => r.id);
  const reportBtn = el("div", {}, quickButtons((k) => openReportForm(s, null, k)),
    el("button", { class: "btn sec", type: "button", text: "📝 くわしく報告する", onclick: () => ready() && openReportForm(s) }));
  const gmap = el("a", { class: "btn ghost", href: `https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}`, target: "_blank", rel: "noopener noreferrer", text: "🧭 地図アプリで道案内", style: "text-align:center;text-decoration:none" });
  const listBox = el("div");
  const ch = chainOf(s.name);
  const fav = el("button", { class: "fav-btn" + (S.favs.has(s.id) ? " on" : ""), type: "button", text: S.favs.has(s.id) ? "❤️ お気に入り" : "🤍 お気に入り" });
  fav.onclick = () => {
    S.favs.has(s.id) ? S.favs.delete(s.id) : S.favs.add(s.id); saveFavs();
    fav.classList.toggle("on", S.favs.has(s.id)); fav.textContent = S.favs.has(s.id) ? "❤️ お気に入り" : "🤍 お気に入り";
    toast(S.favs.has(s.id) ? "お気に入りに追加しました" : "お気に入りから外しました");
    if (S.filter === "fav") render();
  };
  const trend = el("p", { class: "trend" });
  // 営業時間（地図データにあるときだけ）
  const hrs = hoursFor(s);
  const hoursEl = hrs ? el("p", { class: "hours", text: `🕒 営業時間：${hrs}` }) : null;
  // これから行く（2時間ごとに数え直し）
  const go = el("button", { class: "go-btn", type: "button", text: "🏃 これから行く" });
  const goInfo = el("span", { class: "go-info" });
  S.backend.goingCount(s.id).then((g) => {
    goInfo.textContent = g.n ? `いま${g.n}人が向かっています` : "";
    if (g.mine) { go.disabled = true; go.textContent = "🏃 向かっています"; }
  }).catch(() => {});
  go.onclick = busy(go, async () => {
    if (!ready()) return;
    try { const n = await S.backend.goTo(s.id); goInfo.textContent = `いま${n}人が向かっています`; }
    catch (e) { if (e?.message !== "already") throw e; }
    setTimeout(() => { go.disabled = true; go.textContent = "🏃 向かっています"; });
    toast("みんなに「向かっている人数」を伝えました。着いたら在庫を報告してね！");
  });
  const goRow = el("div", { class: "go-row" }, go, goInfo);
  const adminDel = S.isAdmin ? el("button", { class: "btn ghost danger", type: "button", text: "🛠 このお店を削除（運営者）" }) : null;
  if (adminDel) adminDel.onclick = busy(adminDel, async () => {
    if (!confirmInline(adminDel)) return;
    await S.backend.adminDeleteStore(s.id);
    S.stores = S.stores.filter((x) => x.id !== s.id); closeSheet(); render(); toast("お店を削除しました");
  });
  loadTrends().then((t) => { const so = S.sold?.[s.id]; trend.textContent = [trendText(t[s.id]), predictText(t[s.id]), so ? `⏳ このお店は、入荷からふだん約${so.h}時間で売り切れています（${so.n}回の記録）` : ""].filter(Boolean).join("\n"); });
  openSheet(ch ? el("div", { class: "sheet-badge" }, cvsBadge(ch)) : null, el("h2", { text: s.name }), el("p", { class: "addr", text: `📍 ${[s.pref, s.address].filter(Boolean).join("") || "住所未登録"}` }), pioneerOf(s) ? el("p", { class: "pioneer", text: `🏴 開拓者：${pioneerOf(s)}さん` }) : null, hoursEl, fav, goRow, trend, reportBtn, await lotterySection(s), photoSection(s, async () => s), listBox, gmap, xShareBtn(storeShareText(s, reps), APP_URL), lineShareBtn(storeShareText(s, reps), APP_URL), adminDel);
  if (S.user?.emailVerified && ids.length) {
    try { [S.liked, S.flagged, S.stilled, S.goned] = await Promise.all(["like", "flag", "still", "gone"].map((k) => S.backend.myVotes(ids, k))); } catch {}
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
  // 「まだあった」「もうなかった」：現地（3km以内）にいる人だけ、1人1回
  const store = S.stores.find((x) => x.id === r.storeId);
  const canCheck = ["in", "low"].includes(r.status);
  const mkCheck = (kind, label, set) => {
    const field = kind === "still" ? "still" : "gone";
    const b = el("button", { type: "button", class: `chk ${kind}`, text: `${label} ${r[field] || 0}`, disabled: mine || set.has(r.id) });
    b.onclick = busy(b, async () => {
      if (!ready()) return;
      if (store && !(await nearCheck(store))) return;
      await S.backend.vote(r.id, kind); r[field] = (r[field] || 0) + 1; set.add(r.id);
      toast(kind === "still" ? "ありがとう！まだあることをみんなに伝えました" : "ありがとう！売り切れたことをみんなに伝えました");
      render(); openStore(r.storeId);
    });
    return b;
  };
  const checks = canCheck ? el("div", { class: "acts chk-row" },
    mkCheck("still", "✅ まだあった", S.stilled), mkCheck("gone", "❌ もうなかった", S.goned)) : null;
  const del = mine || S.isAdmin ? el("button", { type: "button", text: mine ? "🗑 削除" : "🛠 削除（運営）" }) : null;
  const fol = !mine && r.uid ? el("button", { type: "button", text: S.follows[r.uid] ? "👥 フォロー中" : "👤 フォロー" }) : null;
  if (fol) fol.onclick = () => {
    if (S.follows[r.uid]) delete S.follows[r.uid]; else S.follows[r.uid] = r.nickname || "名無し";
    saveFollows(); fol.textContent = S.follows[r.uid] ? "👥 フォロー中" : "👤 フォロー";
    toast(S.follows[r.uid] ? `${r.nickname || "名無し"}さんをフォローしました（メニューの「フォロー中」で報告を見られます）` : "フォローをやめました");
  };
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
    el("div", { class: "meta", text: [SALE[r.saleType], r.limit && LIMIT[r.limit], nickWithTrust(r.nickname)].filter(Boolean).join("・") }),
    effStatus(r) !== r.status ? el("div", { class: "gone-note", text: "❌ もうなかったという声が多いです（売り切れたかも）" }) : null,
    checks,
    r.note ? el("p", { class: "note", text: r.note }) : null,
    el("div", { class: "acts" }, like, flag, fol, del));
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
  const adminMode = !mine && S.isAdmin;
  const flag = el("button", { type: "button", text: "🚩 通報", disabled: mine });
  flag.onclick = busy(flag, async () => {
    if (!ready() || !confirmInline(flag)) return;
    await S.backend.flagPhoto(ph.id); ph.flags = (ph.flags || 0) + 1;
    flag.textContent = "🚩 通報済み"; setTimeout(() => (flag.disabled = true)); toast("通報しました。ありがとう！");
  });
  const del = mine || adminMode ? el("button", { type: "button", text: mine ? "🗑 削除" : "🛠 削除（運営）" }) : null;
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
  const limit = el("select", {}, el("option", { value: "", text: "わからない・書かない" }), ...Object.entries(LIMIT).map(([k, v]) => el("option", { value: k, text: v })));
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
    { const why = textProblem(itemName + " " + n); if (why) return toast("商品名やメモに" + why); }
    if (!(await nearCheck(place || s))) return;
    if (place) {
      const st = await storeForPlace(place, prefSel.value);
      if (!st) { prefLabel.hidden = false; prefSel.hidden = false; return toast("都道府県を選んでね"); }
      s = st;
    }
    const base = { storeId: s.id, product: product.get(), setCode: "", status: status.get(), saleType: sale.get(), note: n };
    const lim = limit.value;
    let rep;
    const payload = { ...base, ...(itemName ? { itemName } : {}), ...(lim ? { limit: lim } : {}) };
    // 電波がないとき：お店が登録ずみなら、スマホに一時保存してあとで自動で送る
    if (!navigator.onLine && s.id) {
      queueReport(payload); rememberItem(itemName); closeSheet();
      return toast("📶 電波がないので、報告をスマホに保存しました。つながったら自動で送ります");
    }
    try {
      rep = await S.backend.addReport(payload);
    } catch (e) {
      if (s.id && (e?.code === "unavailable" || !navigator.onLine)) {
        queueReport(payload); closeSheet();
        return toast("📶 電波が弱いので、報告をスマホに保存しました。つながったら自動で送ります");
      }
      // サーバーのルールがまだ古いとき：商品名と購入制限をメモの先頭に入れて送り直す
      if ((!itemName && !lim) || e?.code !== "permission-denied") throw e;
      const pre = [itemName && `【${itemName}】`, lim && `【${LIMIT[lim]}】`].filter(Boolean).join("");
      rep = await S.backend.addReport({ ...base, note: clean(pre + n, 100) });
    }
    rememberItem(itemName);
    S.reports.unshift(rep); render(); openStore(s.id); afterReport(rep, s);
  });
  openSheet(el("h2", { text: "在庫を報告" }), el("p", { class: "sub", text: s.name }),
    prefLabel, prefSel,
    el("label", { text: "商品" }), product.box,
    el("label", { text: "商品名（任意）" }), item, itemBox,
    el("label", { text: "いまの状態" }), status.box,
    el("label", { text: "売り方" }), sale.box,
    el("label", { text: "購入制限（任意）" }), limit,
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
    { const why = textProblem(n + " " + a, { pii: false }); if (why) return toast(why); }
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
let releaseMode = false; // 発売日の当日だけ true
function openFeed() {
  const items = S.reports.filter((r) => (r.flags || 0) < HIDE_FLAGS).filter((r) => {
    const s = S.stores.find((x) => x.id === r.storeId);
    return s && (!S.pref || s.pref === S.pref) && (!S.product || r.product === S.product);
  }).slice(0, 40);
  openSheet(el("h2", { text: "🧭 メニュー" }), el("p", { class: "sub", text: S.pref || "全国" }),
    el("div", { class: "hub" },
      el("button", { class: "btn sec", type: "button", text: "📋 在庫リスト", onclick: openNearby }),
      el("button", { class: "btn sec", type: "button", text: "❤️ お気に入り", onclick: openFavorites }),
      el("button", { class: "btn sec", type: "button", text: "📅 発売日", onclick: openCalendar }),
      el("button", { class: "btn sec", type: "button", text: "🔔 在庫の通知", onclick: openNotify }),
      el("button", { class: "btn sec", type: "button", text: "🎯 今日のミッション", onclick: openMissions }),
      el("button", { class: "btn sec", type: "button", text: "🎟 抽選・予約", onclick: openLotteries }),
      el("button", { class: "btn sec", type: "button", text: "🏆 大会・イベント", onclick: openEvents }),
      el("button", { class: "btn sec", type: "button", text: "🚗 まわる順番", onclick: openRoute }),
      el("button", { class: "btn sec", type: "button", text: "🖼 今週のまとめ", onclick: openWeekly }),
      el("button", { class: "btn sec", type: "button", text: "🎁 友だち招待", onclick: openInvite }),
      el("button", { class: "btn sec", type: "button", text: "🖨 QRチラシ", onclick: openFlyer }),
      el("a", { class: "btn sec", href: "area/index.html", style: "text-align:center;text-decoration:none", text: "🗾 都道府県ページ" }),
      el("button", { class: "btn sec", type: "button", text: "🏆 ランキング", onclick: openRanking }),
      el("button", { class: "btn sec", type: "button", text: "🏴 開拓者", onclick: openPioneers }),
      el("button", { class: "btn sec", type: "button", text: "📊 地域", onclick: openRegions }),
      el("button", { class: "btn sec", type: "button", text: "👥 フォロー中", onclick: openFollowing }),
      el("button", { class: "btn sec", type: "button", text: S.heat ? "🔥 ヒート：オン" : "🔥 ヒート：オフ",
        onclick: (e) => { S.heat = !S.heat; renderHeat(); e.currentTarget.textContent = S.heat ? "🔥 ヒート：オン" : "🔥 ヒート：オフ"; if (S.heat) toast("在庫ありの報告が多い地域ほど赤くなります"); } }),
      el("button", { class: "btn sec", type: "button", text: `🌙 表示：${THEMES[getTheme()]}`, onclick: (e) => cycleTheme(e.currentTarget) }),
      el("button", { class: "btn sec", type: "button", text: "🕘 最近見た", onclick: openRecent }),
      el("button", { class: "btn sec", type: "button", text: `🔠 文字：${bigText() ? "大きい" : "ふつう"}`, onclick: (e) => { setBigText(!bigText()); e.currentTarget.textContent = `🔠 文字：${bigText() ? "大きい" : "ふつう"}`; } }),
      el("button", { class: "btn sec", type: "button", text: "❓ 使い方", onclick: () => { closeSheet(); openGuide(); } }),
      el("button", { class: "btn sec", type: "button", text: langLabel(), onclick: toggleLang }),
      S.isAdmin ? el("button", { class: "btn sec admin", type: "button", text: "🛠 管理", onclick: openAdmin }) : null,
      releaseMode ? el("button", { class: "btn sec release", type: "button", text: "🎉 発売日モード", onclick: openReleaseDay }) : null),
    el("h3", { class: "mini-h", text: "🆕 新着の報告" }),
    ...(items.length ? items.map((r) => {
      const s = S.stores.find((x) => x.id === r.storeId);
      return el("div", { class: "feed-item", role: "button", tabindex: "0", onclick: () => { S.map.setView([s.lat, s.lng], 16); openStore(s.id); } },
        el("div", { class: "row", style: "display:flex;justify-content:space-between" }, el("b", { text: s.name }), el("span", { class: "meta", text: timeAgo(r.createdAt) })),
        el("div", {}, el("span", { class: `badge ${effStatus(r)}`, text: STATUS[effStatus(r)] }), " ", PRODUCTS[r.product] || "", itemLabel(r) ? ` ${itemLabel(r)}` : ""));
    }) : [el("p", { class: "small", text: "まだ報告がありません" })]),
    xShareBtn(`ワンピースカードの在庫を、みんなで報告し合う地図アプリ「トレジャーカードマップ」を使ってみてね🗺\n${TAGS}`, APP_URL),
    lineShareBtn("ワンピースカードの在庫を、みんなで報告し合える地図アプリ「トレジャーカードマップ」だよ🗺 無料で使えるよ", APP_URL));
}

// ============================================================
// 追加機能（信頼度・週間まとめ画像・まわる順番・入荷予想・抽選予約・カウントダウン・招待・地域ページ）
// ============================================================

// ---------- 報告の信頼度（data/trust.json：「まだあった」が多い報告をよくする人） ----------
async function loadTrust() {
  try { const res = await fetch("data/trust.json", { cache: "no-cache" }); S.trust = res.ok ? (await res.json()).names || {} : {}; } catch { S.trust = {}; }
}
function nickWithTrust(n) {
  const name = n || "名無し";
  const lv = S.trust?.[name] || 0;
  return lv >= 2 ? `${name} ☑️☑️高信頼` : lv === 1 ? `${name} ☑️信頼` : name;
}

// ---------- 在庫ありのお店（いちばん新しい報告で判断） ----------
function inStockStores(maxAgeH = STALE_H) {
  const seen = new Set(), ok = new Map();
  const now = Date.now();
  for (const r of S.reports) {
    if ((r.flags || 0) >= HIDE_FLAGS) continue;
    const k = r.storeId + "|" + r.product;
    if (seen.has(k)) continue; // 新しい順にならんでいるので、最初の1件がいちばん新しい
    seen.add(k);
    if (["in", "low"].includes(effStatus(r)) && now - r.createdAt < maxAgeH * 3600e3 && !ok.has(r.storeId)) ok.set(r.storeId, r);
  }
  return [...ok.entries()].map(([id, r]) => ({ s: S.stores.find((x) => x.id === id), r })).filter((x) => x.s);
}

// ---------- 週間まとめ画像（端末の中で作る。サーバーには送らない） ----------
function weeklyData() {
  const reps = S.reports.filter((r) => (r.flags || 0) < HIDE_FLAGS);
  const stock = reps.filter((r) => ["in", "low"].includes(r.status));
  const pref = new Map(), item = new Map();
  for (const r of stock) {
    const s = S.stores.find((x) => x.id === r.storeId);
    if (s?.pref) pref.set(s.pref, (pref.get(s.pref) || 0) + 1);
    const nm = r.itemName || (r.setCode ? r.setCode : "");
    if (nm) item.set(nm, (item.get(nm) || 0) + 1);
  }
  const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  return { total: reps.length, stock: stock.length, prefs: top(pref, 5), items: top(item, 3) };
}
function drawWeekly(w) {
  const W = 1200, H = 675;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d");
  const font = (px, b = true) => `${b ? "700 " : ""}${px}px "Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic",sans-serif`;
  const grad = g.createLinearGradient(0, 0, W, H); grad.addColorStop(0, "#14213d"); grad.addColorStop(1, "#1d3557");
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  g.fillStyle = "#ffd166"; g.fillRect(0, 0, W, 10);
  const end = new Date(), start = new Date(Date.now() - 6 * 864e5);
  const md = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
  g.fillStyle = "#ffd166"; g.font = font(30); g.fillText(`📅 ${md(start)}〜${md(end)}`, 60, 80);
  g.fillStyle = "#fff"; g.font = font(58); g.fillText("今週のワンピカ入荷まとめ", 60, 160);
  g.font = font(34, false); g.fillStyle = "#e5e7eb";
  g.fillText(`報告 ${w.total}件 ／ ⭐在庫ありの報告 ${w.stock}件`, 60, 220);
  g.fillStyle = "#ffd166"; g.font = font(34); g.fillText("🏆 入荷が多かった地域", 60, 300);
  g.fillStyle = "#fff"; g.font = font(32, false);
  (w.prefs.length ? w.prefs : [["まだ報告がありません", 0]]).forEach(([p, n], i) => g.fillText(`${i + 1}位　${p}${n ? `（${n}件）` : ""}`, 80, 350 + i * 46));
  if (w.items.length) {
    g.fillStyle = "#ffd166"; g.font = font(34); g.fillText("🔥 よく見つかった商品", 660, 300);
    g.fillStyle = "#fff"; g.font = font(30, false);
    w.items.forEach(([p, n], i) => g.fillText(`${p.slice(0, 14)}（${n}件）`, 680, 350 + i * 46));
  }
  g.fillStyle = "#e63946"; g.fillRect(0, H - 90, W, 90);
  g.fillStyle = "#fff"; g.font = font(34); g.fillText("🗺 トレジャーカードマップ", 60, H - 32);
  g.font = font(26, false); g.textAlign = "right"; g.fillText("treasure-card-map.github.io", W - 60, H - 34);
  return c;
}
function openWeekly() {
  const w = weeklyData();
  const c = drawWeekly(w);
  const img = el("img", { src: c.toDataURL("image/png"), alt: "今週のまとめ画像", style: "width:100%;border-radius:12px;margin:8px 0" });
  const share = el("button", { class: "btn", type: "button", text: "📤 画像をシェア・保存" });
  share.onclick = busy(share, async () => {
    const blob = await new Promise((ok) => c.toBlob(ok, "image/png"));
    const file = new File([blob], "treasure-card-map-week.png", { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], text: `今週のワンピカ入荷まとめ🗺\n${TAGS}` }); } catch { /* キャンセル */ }
    } else {
      const a = el("a", { href: URL.createObjectURL(blob), download: "treasure-card-map-week.png" });
      document.body.append(a); a.click(); a.remove();
      toast("画像を保存しました");
    }
  });
  const top = w.prefs[0] ? `今週いちばん入荷の報告が多かったのは「${w.prefs[0][0]}」！` : "";
  openSheet(el("h2", { text: "🖼 今週のまとめ" }),
    el("p", { class: "sub", text: "最近7日間の報告から作った画像です。保存してXやLINEにのせてね。" }), img, share,
    xShareBtn(`今週のワンピカ入荷まとめ🗺\n${top}\n報告${w.total}件・在庫あり${w.stock}件\n${TAGS}`, APP_URL),
    el("button", { class: "btn ghost", type: "button", text: "もどる", onclick: openFeed }));
}

// ---------- まわる順番ナビ（近い順に在庫ありのお店をつなぐ） ----------
const ROUTE_KM = 20, ROUTE_MAX = 8, ROUTE_NAV = 4; // 地図アプリに渡すのは4店まで（スマホの地図アプリの上限）
function routeOrder(start, list) {
  const left = [...list], out = [];
  let cur = start;
  while (left.length && out.length < ROUTE_MAX) {
    let bi = 0, bd = Infinity;
    left.forEach((x, i) => { const d = distM(cur, x.s); if (d < bd) { bd = d; bi = i; } });
    const [x] = left.splice(bi, 1);
    out.push({ ...x, legKm: bd / 1000 });
    cur = x.s;
  }
  return out;
}
async function openRoute() {
  let me;
  try { me = await getPos(); } catch { return toast("まわる順番を出すには、位置情報を許可してね"); }
  const near = inStockStores().filter((x) => distM(me, x.s) <= ROUTE_KM * 1000);
  const route = routeOrder(me, near);
  const nav = route.slice(0, ROUTE_NAV);
  const url = nav.length ? "https://www.google.com/maps/dir/?api=1&travelmode=driving"
    + `&origin=${me.lat},${me.lng}`
    + `&destination=${nav[nav.length - 1].s.lat},${nav[nav.length - 1].s.lng}`
    + (nav.length > 1 ? `&waypoints=${encodeURIComponent(nav.slice(0, -1).map((x) => `${x.s.lat},${x.s.lng}`).join("|"))}` : "") : "";
  openSheet(el("h2", { text: "🚗 まわる順番ナビ" }),
    el("p", { class: "sub", text: `現在地から${ROUTE_KM}km以内の「在庫あり」のお店を、近い順につなぎました。` }),
    ...(route.length ? route.map((x, i) => el("div", { class: "feed-item", role: "button", tabindex: "0", onclick: () => { S.map.setView([x.s.lat, x.s.lng], 16); openStore(x.s.id); } },
      el("div", { style: "display:flex;justify-content:space-between" }, el("b", { text: `${i + 1}. ${x.s.name}` }), el("span", { class: "meta", text: `+${x.legKm.toFixed(1)}km` })),
      el("div", {}, el("span", { class: `badge ${effStatus(x.r)}`, text: STATUS[effStatus(x.r)] }), " ", PRODUCTS[x.r.product] || "", " ", el("span", { class: "meta", text: timeAgo(x.r.createdAt) }))))
      : [el("p", { class: "small", text: `${ROUTE_KM}km以内に在庫ありの報告はまだありません。` })]),
    url ? el("a", { class: "btn", href: url, target: "_blank", rel: "noopener noreferrer", style: "text-align:center;text-decoration:none;display:block",
      text: `🧭 地図アプリで ${nav.length}店をまわる` }) : null,
    route.length > ROUTE_NAV ? el("p", { class: "small", text: `地図アプリには最初の${ROUTE_NAV}店をわたします（スマホの地図アプリの上限のため）。` }) : null,
    el("p", { class: "small", text: "⚠️ 在庫は売り切れていることもあります。運転中はスマホを操作しないでね。" }),
    el("button", { class: "btn ghost", type: "button", text: "もどる", onclick: openFeed }));
}

// ---------- 入荷予想（最近60日の「入荷しやすい曜日・時間」から） ----------
function predictText(t) {
  if (!t || t.n < 3) return "";
  const now = new Date(Date.now() + 9 * 3600e3);
  const wd = now.getUTCDay(), h = now.getUTCHours();
  const ratio = t.wd[wd] / (t.n / 7);
  const level = ratio >= 1.5 ? "🔮🔮🔮 高い" : ratio >= 0.8 ? "🔮🔮 ふつう" : "🔮 低め";
  const slot = h < 6 ? 4 : h < 11 ? 0 : h < 15 ? 1 : h < 19 ? 2 : 3;
  const best = t.slot.indexOf(Math.max(...t.slot));
  const later = best > slot && best !== 4 ? `（${SLOT[best]}に報告が多いお店です）` : "";
  return `今日（${WD[wd]}曜日）の入荷しそう度：${level}${later}`;
}

// ---------- 抽選・予約ボード ----------
const LOT_KIND = { lottery: "🎟 抽選", reserve: "📝 予約", event: "🏆 大会・イベント" };
let lotCache = null, lotAt = 0;
async function loadLotteries(force = false) {
  if (!force && lotCache && Date.now() - lotAt < 5 * 60e3) return lotCache;
  try { lotCache = await S.backend.listLotteries(); lotAt = Date.now(); } catch (e) { console.warn(e); lotCache = lotCache || []; }
  return lotCache;
}
function md(t) { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()}`; }
function lotWhen(x) {
  if (x.kind !== "event") return lotLeft(x.end);
  const d = Math.ceil((x.start - Date.now()) / 864e5);
  return x.start > Date.now() ? (d <= 1 ? "⏰ もうすぐ開催" : `あと${d}日で開催`) : "🎉 開催中";
}
function lotLeft(end) {
  const h = (end - Date.now()) / 3600e3;
  return h < 24 ? `⏰ 締切まであと${Math.max(1, Math.ceil(h))}時間` : `締切まであと${Math.ceil(h / 24)}日`;
}
function lotteryItem(x, { withStore = true } = {}) {
  const s = S.stores.find((v) => v.id === x.storeId);
  const mine = S.user && x.uid === (S.backend.isDemo ? "me" : S.user.uid);
  const flag = el("button", { type: "button", text: "🚩 通報", disabled: mine });
  flag.onclick = busy(flag, async () => {
    if (!ready() || !confirmInline(flag)) return;
    try { await S.backend.flagLottery(x.id); } catch (e) { if (e?.message !== "already") throw e; }
    x.flags = (x.flags || 0) + 1; setTimeout(() => { flag.disabled = true; flag.textContent = "🚩 通報済み"; }); toast("通報しました。ありがとう！");
  });
  const del = mine || S.isAdmin ? el("button", { type: "button", text: mine ? "🗑 削除" : "🛠 削除（運営）" }) : null;
  if (del) del.onclick = busy(del, async () => {
    if (!confirmInline(del)) return;
    await S.backend.deleteLottery(x.id); lotCache = (lotCache || []).filter((v) => v.id !== x.id); toast("削除しました"); closeSheet();
  });
  return el("div", { class: "report lot-item" },
    el("div", { class: "row" }, el("div", {}, el("span", { class: "badge soon", text: LOT_KIND[x.kind] || "🎟" }), " ", el("b", { text: x.title })),
      el("span", { class: "meta", text: lotWhen(x) })),
    withStore && s ? el("div", { class: "meta lot-store", role: "button", tabindex: "0", text: `🏪 ${s.name}（${s.pref || ""}）`, onclick: () => { S.map.setView([s.lat, s.lng], 16); openStore(s.id); } }) : null,
    el("div", { class: "meta", text: `${x.kind === "event" ? "開催" : "受付"}：${md(x.start)}${md(x.start) === md(x.end) ? "" : "〜" + md(x.end)}・${nickWithTrust(x.nickname)}` }),
    x.how ? el("p", { class: "note", text: x.how }) : null,
    el("div", { class: "acts" }, flag, del));
}
async function openLotteries() {
  const box = el("div", {}, el("p", { class: "small", text: "読み込み中…" }));
  openSheet(el("h2", { text: "🎟 抽選・予約ボード" }),
    el("p", { class: "sub", text: `${S.pref || "全国"}の、受付中・これからの抽選や予約です。お店のページから登録できます。` }), box,
    el("button", { class: "btn ghost", type: "button", text: "もどる", onclick: openFeed }));
  const list = (await loadLotteries(true)).filter((x) => x.kind !== "event" && (x.flags || 0) < HIDE_FLAGS).filter((x) => {
    const s = S.stores.find((v) => v.id === x.storeId);
    return s && (!S.pref || s.pref === S.pref);
  });
  box.replaceChildren(...(list.length ? list.map((x) => lotteryItem(x)) : [el("p", { class: "small", text: "いま登録されている抽選・予約はありません。お店で見つけたら登録してみよう！" })]));
}
function dateInput(v) { return el("input", { type: "date", value: new Date(v + 9 * 3600e3).toISOString().slice(0, 10) }); }
function openLotteryForm(s) {
  if (!ready()) return;
  const kind = el("select", {}, el("option", { value: "lottery", text: "🎟 抽選" }), el("option", { value: "reserve", text: "📝 予約" }), el("option", { value: "event", text: "🏆 大会・イベント" }));
  const startLabel = el("label", { text: "受付開始" }), endLabel = el("label", { text: "締切" });
  kind.onchange = () => { const ev = kind.value === "event"; startLabel.textContent = ev ? "開催日（はじまり）" : "受付開始"; endLabel.textContent = ev ? "開催日（おわり・1日だけなら同じ日）" : "締切"; };
  const title = el("input", { type: "text", maxLength: 40, placeholder: "例：最強の戦士 BOX抽選" });
  const how = el("input", { type: "text", maxLength: 100, placeholder: "例：レジで応募用紙を記入。1人1口" });
  const start = dateInput(Date.now()), end = dateInput(Date.now() + 7 * 864e5);
  const save = el("button", { class: "btn", type: "button", text: "登録する" });
  save.onclick = busy(save, async () => {
    const t = clean(title.value, 40), h = clean(how.value, 100);
    if (!t) return toast("タイトルを入れてね");
    { const why = textProblem(t + " " + h); if (why) return toast(why); }
    const st = Date.parse(start.value + "T00:00:00+09:00"), en = Date.parse(end.value + "T23:59:00+09:00");
    if (!st || !en) return toast("日付を選んでね");
    if (en < st) return toast(kind.value === "event" ? "おわりの日は、はじまりの日と同じか後にしてね" : "締切は受付開始より後にしてね");
    if (en <= Date.now()) return toast(kind.value === "event" ? "もう終わった日付です" : "締切がもう過ぎています");
    if (en > Date.now() + 89 * 864e5) return toast("締切は3か月以内にしてね");
    if (st < Date.now() - 29 * 864e5) return toast("受付開始は1か月以内の日付にしてね");
    const x = await S.backend.addLottery({ storeId: s.id, kind: kind.value, title: t, how: h, start: st, end: en });
    lotCache = [...(lotCache || []), x].sort((a, b) => a.end - b.end);
    toast("登録しました。みんなに伝わります！");
    openStore(s.id);
  });
  openSheet(el("h2", { text: "🎟 抽選・予約・大会を登録" }), el("p", { class: "sub", text: s.name }),
    el("label", { text: "種類" }), kind, el("label", { text: "タイトル（40文字まで）" }), title,
    startLabel, start, endLabel, end,
    el("label", { text: "応募の方法など（100文字まで・任意）" }), how,
    el("p", { class: "small", text: "お店に貼ってあるお知らせなど、本当の情報だけ登録してね。電話番号やURLは書けません。1分に1回まで登録できます。" }),
    save, el("button", { class: "btn ghost", type: "button", text: "もどる", onclick: () => openStore(s.id) }));
}
async function lotterySection(s) {
  const box = el("div", { class: "lot-sec" });
  loadLotteries().then((list) => {
    const mine = list.filter((x) => x.storeId === s.id && (x.flags || 0) < HIDE_FLAGS);
    box.replaceChildren(
      ...(mine.length ? [el("h3", { class: "mini-h", text: "🎟 このお店の抽選・予約・大会" }), ...mine.map((x) => lotteryItem(x, { withStore: false }))] : []),
      el("button", { class: "btn ghost", type: "button", text: "🎟 抽選・予約・大会を登録", onclick: () => openLotteryForm(s) }));
  });
  return box;
}
// お気に入りのお店の抽選が48時間以内に締め切られるとき、開いたときにお知らせ
async function showLotteryNews() {
  if (!S.favs.size) return;
  const soon = (await loadLotteries()).filter((x) => x.kind !== "event" && S.favs.has(x.storeId) && (x.flags || 0) < HIDE_FLAGS && x.end - Date.now() < 48 * 3600e3);
  if (!soon.length) return;
  const b = $("#lotNews");
  const s = S.stores.find((v) => v.id === soon[0].storeId);
  b.querySelector("span").textContent = `🎟 お気に入りのお店の「${soon[0].title}」は${lotLeft(soon[0].end).replace("⏰ ", "")}${soon.length > 1 ? `（ほか${soon.length - 1}件）` : ""}`;
  b.querySelector("span").onclick = () => { b.hidden = true; if (soon.length === 1 && s) { S.map.setView([s.lat, s.lng], 16); openStore(s.id); } else openLotteries(); };
  b.querySelector("button").onclick = () => { b.hidden = true; };
  b.hidden = false;
}

// ---------- 発売日カウントダウン（地図の上の小さいボタン） ----------
async function showCountdown() {
  const next = (await loadReleases()).map((x) => ({ ...x, d: daysUntil(x.date) })).filter((x) => x.d >= 0).sort((a, b) => a.d - b.d)[0];
  const c = $("#countdownChip");
  if (!next || !c) return;
  c.textContent = next.d === 0 ? `🎉 今日発売：${next.code || next.name}` : `⏳ ${next.code || next.name}まであと${next.d}日`;
  c.title = next.name;
  c.hidden = false;
  c.onclick = openCalendar;
}

// ---------- 友だち招待（招待した人・された人の両方に30pt） ----------
const REF_KEY = "opmap-ref";
function saveRefFromUrl() {
  try {
    const r = new URLSearchParams(location.search).get("ref");
    if (r && /^[A-Za-z0-9]{10,128}$/.test(r)) localStorage.setItem(REF_KEY, r);
  } catch { /* なにもしない */ }
}
async function claimInviteOnce() {
  let r = "";
  try { r = localStorage.getItem(REF_KEY) || ""; } catch { return; }
  if (!r) return;
  try { await S.backend.claimInvite(r); toast("🎁 招待でようこそ！報告すると、あなたと招待した人に30ptずつ入ります"); } catch { /* 古いアカウントなどは対象外 */ }
  try { localStorage.removeItem(REF_KEY); } catch { /* なにもしない */ }
}
async function openInvite() {
  if (!ready()) return;
  const url = `${APP_URL}?ref=${encodeURIComponent(S.backend.isDemo ? "demo" : S.user.uid)}`;
  const count = el("b", { text: "…" });
  const copy = el("button", { class: "btn sec", type: "button", text: "🔗 招待リンクをコピー" });
  copy.onclick = async () => { try { await navigator.clipboard.writeText(url); toast("コピーしました"); } catch { toast("コピーできませんでした"); } };
  const text = "ワンピースカードの在庫を地図でみんなで報告し合えるアプリ「トレジャーカードマップ」に招待するよ🗺 このリンクから登録して報告すると、2人ともポイントがもらえる！";
  openSheet(el("h2", { text: "🎁 友だちを招待" }),
    el("p", { class: "sub", text: "このリンクから登録した友だちが、その月に1回報告すると、あなたと友だちに30ptずつ入ります（1か月10人まで）。" }),
    el("p", {}, "これまでに招待した人：", count, "人"),
    copy, xShareBtn(`${text}\n${TAGS}`, url), lineShareBtn(text, url),
    el("p", { class: "small", text: "※ リンクには、あなたを見分けるための番号（ユーザーID）が入ります。メールアドレスは入りません。" }),
    el("button", { class: "btn ghost", type: "button", text: "もどる", onclick: openAccount }));
  try { count.textContent = await S.backend.myInviteCount(); } catch { count.textContent = "-"; }
}

// ---------- 在庫の通知（お気に入りのお店に「在庫あり」の報告が来たらお知らせ） ----------
// しくみ：通知の宛先とお気に入りを、この端末の中で暗号化してから保存する。
//         中身を読めるのは、通知を送る自動の仕組み（GitHub Actions）だけ。
// 公開してよい鍵は、通知を送る自動の仕組みが data/push-public.json に書き出す
let pushPubCache = null;
async function loadPushPub() {
  if (pushPubCache) return pushPubCache;
  const res = await fetch("data/push-public.json", { cache: "no-cache" });
  if (!res.ok) throw new Error("push-not-ready");
  pushPubCache = await res.json();
  return pushPubCache;
}
const PUSH_KID_KEY = "opmap-push-kid";
const PUSH_KEY = "opmap-push";
const b64u = {
  enc: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  dec: (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0)),
};
async function sealBox(obj) {
  const { subtle } = crypto;
  const pub = await loadPushPub();
  const serverPub = await subtle.importKey("raw", b64u.dec(pub.boxPublicKey), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const eph = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const bits = await subtle.deriveBits({ name: "ECDH", public: serverPub }, eph.privateKey, 256);
  const hk = await subtle.importKey("raw", bits, "HKDF", false, ["deriveKey"]);
  const key = await subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new TextEncoder().encode("tcm-push-v1") }, hk, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return ["v1", b64u.enc(await subtle.exportKey("raw", eph.publicKey)), b64u.enc(iv), b64u.enc(ct)].join(".");
}
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && !!crypto?.subtle;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
function pushOn() { try { return localStorage.getItem(PUSH_KEY) === "1"; } catch { return false; } }
function setPushOn(v) { try { localStorage.setItem(PUSH_KEY, v ? "1" : "0"); } catch { /* なにもしない */ } }
async function pushSub(create) {
  const reg = await navigator.serviceWorker.register("sw.js");
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub && create) {
    const pub = await loadPushPub();
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u.dec(pub.vapidPublicKey) });
    try { localStorage.setItem(PUSH_KID_KEY, pub.kid); } catch { /* なにもしない */ }
  }
  return sub;
}
// 鍵が新しくなっていたら、通知の登録をやり直す（だめなら「ONにし直してね」と出す）
async function checkPushKey() {
  if (!pushOn() || !pushSupported() || Notification.permission !== "granted") return;
  let pub, kid = "";
  try { pub = await loadPushPub(); kid = localStorage.getItem(PUSH_KID_KEY) || ""; } catch { return; }
  if (kid === pub.kid) return;
  try {
    const old = await pushSub(false);
    if (old) await old.unsubscribe();
    await pushSub(true);
    if (S.user?.emailVerified) await syncPush();
  } catch {
    setPushOn(false);
    toast("通知の設定が新しくなりました。メニューの「🔔 在庫の通知」からONにし直してね");
  }
}
async function syncPush() {
  const sub = await pushSub(false);
  if (!sub) { setPushOn(false); return false; }
  const kw = kwConf();
  await S.backend.savePush(await sealBox({ s: sub.toJSON(), f: [...S.favs].slice(0, 100), k: kw.k, r: kw.r, p: kw.p }));
  return true;
}
let pushTimer;
function pushFavsChanged() {
  if (!pushOn() || !S.user?.emailVerified || !pushSupported()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => syncPush().catch((e) => console.warn(e)), 3000);
}
async function openNotify() {
  const box = el("div");
  const draw = () => {
    if (!pushSupported()) {
      box.replaceChildren(el("p", { class: "small", text: isIOS() && !isStandalone()
        ? "iPhoneで通知を受け取るには、先にホーム画面に追加してね：Safariの「共有」ボタン →「ホーム画面に追加」→ ホーム画面のトレカマップから開いて、もう一度ここへ。"
        : "この端末・ブラウザは通知に対応していません。" }));
      return;
    }
    if (isIOS() && !isStandalone()) {
      box.replaceChildren(el("p", { class: "small", text: "iPhoneは、ホーム画面に追加したアプリからだけ通知を受け取れます。Safariの「共有」→「ホーム画面に追加」をして、ホーム画面のトレカマップから開いてね。" }));
      return;
    }
    const on = pushOn() && Notification.permission === "granted";
    const btn = el("button", { class: on ? "btn ghost" : "btn", type: "button", text: on ? "🔕 通知をOFFにする" : "🔔 通知をONにする" });
    btn.onclick = busy(btn, async () => {
      if (on) {
        const sub = await pushSub(false).catch(() => null);
        if (sub) await sub.unsubscribe().catch(() => {});
        if (S.user) await S.backend.deletePush().catch(() => {});
        setPushOn(false); toast("通知をOFFにしました"); return draw();
      }
      if (!ready()) return;
      try { await loadPushPub(); } catch { return toast("通知の準備中です。30分ほどしてからもう一度ためしてね"); }
      const p = await Notification.requestPermission();
      if (p !== "granted") return toast("通知が許可されませんでした（設定から許可できます）");
      await pushSub(true);
      setPushOn(true);
      await syncPush();
      toast(S.favs.size ? "通知をONにしました！" : "通知をONにしました。お店を ❤️ お気に入りにすると届きます");
      draw();
    });
    box.replaceChildren(el("p", {}, on ? "🔔 いまは ON です" : "🔕 いまは OFF です"), btn, ...(on ? [kwSection()] : []));
  };
  draw();
  openSheet(el("h2", { text: "🔔 在庫の通知" }),
    el("p", { class: "sub", text: "❤️ お気に入りのお店に「在庫あり」の報告が来たら、スマホにお知らせします。" }), box,
    el("p", { class: "small", text: `いまのお気に入り：${S.favs.size}店（最大100店まで通知）` }),
    el("p", { class: "small", style: "white-space:pre-line", text: "・通知は30分〜1時間おきにまとめて届きます（すぐには届きません）。\n・通知の宛先とお気に入りは、端末の中で暗号化してから保存します。ほかの人には読めません。\n・ログインが必要です（いたずら防止のため）。" }),
    el("button", { class: "btn ghost", type: "button", text: "もどる", onclick: openFeed }));
}

// ---------- 今日のミッション（1つ5pt。ポイントは6時間ごとの集計でランキングに入る） ----------
function jstDayStart() { const n = Date.now() + 9 * 3600e3; return n - (n % 864e5) - 9 * 3600e3; }
async function openMissions() {
  const me = S.user ? (S.backend.isDemo ? "me" : S.user.uid) : null;
  const t0 = jstDayStart();
  const mine = me ? S.reports.filter((r) => r.uid === me && r.createdAt >= t0) : [];
  const stores = new Set(mine.map((r) => r.storeId));
  const rows = el("div");
  const draw = (photo) => {
    const list = [
      { ok: stores.size >= 1, name: "在庫を1回報告する", hint: "お店で「📍 いるお店で報告」を押すだけ" },
      { ok: stores.size >= 2, name: "2つのお店で報告する", hint: `いま${Math.min(stores.size, 2)}/2店` },
      { ok: photo, name: "お店の写真を1枚投稿する", hint: "売り場や棚の写真（人が写らないように）" },
    ];
    const done = list.filter((x) => x.ok).length;
    rows.replaceChildren(
      el("p", { class: "mission-total", text: `今日の達成：${done}/3（+${done * 5}pt）` }),
      ...list.map((x) => el("div", { class: "mission" + (x.ok ? " done" : "") },
        el("span", { class: "m-ic", text: x.ok ? "✅" : "⬜" }),
        el("div", {}, el("b", { text: `${x.name}　+5pt` }), el("div", { class: "meta", text: x.hint })))));
  };
  draw(false);
  openSheet(el("h2", { text: "🎯 今日のミッション" }),
    el("p", { class: "sub", text: "毎日0時（日本時間）に新しくなります。達成したポイントは、6時間ごとの集計で月間ランキングに入ります。" }),
    me ? rows : el("p", { class: "small", text: "ミッションに参加するにはログインしてね（無料）。" }),
    me ? null : el("button", { class: "btn", type: "button", text: "ログイン", onclick: () => ready() }),
    el("button", { class: "btn ghost", type: "button", text: "もどる", onclick: openFeed }));
  if (me) { try { draw(await S.backend.myPhotoToday(t0)); } catch { /* 読めなくても表示はそのまま */ } }
}

// ---------- 大会・イベント（抽選・予約ボードと同じしくみ） ----------
async function openEvents() {
  const box = el("div", {}, el("p", { class: "small", text: "読み込み中…" }));
  openSheet(el("h2", { text: "🏆 大会・イベント" }),
    el("p", { class: "sub", text: `${S.pref || "全国"}のカードショップなどの大会・イベントです。お店のページから登録できます。` }), box,
    el("button", { class: "btn ghost", type: "button", text: "もどる", onclick: openFeed }));
  const list = (await loadLotteries(true)).filter((x) => x.kind === "event" && (x.flags || 0) < HIDE_FLAGS).filter((x) => {
    const s = S.stores.find((v) => v.id === x.storeId);
    return s && (!S.pref || s.pref === S.pref);
  }).sort((a, b) => a.start - b.start);
  box.replaceChildren(...(list.length ? list.map((x) => lotteryItem(x)) : [el("p", { class: "small", text: "いま登録されている大会・イベントはありません。お店で見つけたら登録してみよう！" })]));
}

// ---------- 商品名の通知の設定（この端末に保存。送るときは暗号化） ----------
const KW_KEY = "opmap-push-kw";
function kwConf() { try { return JSON.parse(localStorage.getItem(KW_KEY)) || { k: [], r: 30, p: null }; } catch { return { k: [], r: 30, p: null }; } }
function setKwConf(c) { try { localStorage.setItem(KW_KEY, JSON.stringify(c)); } catch { /* なにもしない */ } }
function kwSection(after) {
  const c = kwConf();
  const input = el("input", { type: "text", maxLength: 70, placeholder: "例：最強の戦士、OP-19（3つまで、読点で区切る）", value: c.k.join("、") });
  const r = el("select", {}, ...[10, 30, 50, 100].map((km) => el("option", { value: String(km), text: `${km}km以内`, selected: c.r === km })));
  const save = el("button", { class: "btn sec", type: "button", text: "🔎 この内容で通知する" });
  save.onclick = busy(save, async () => {
    const words = input.value.split(/[、,，\s]+/).map((w) => clean(w, 20)).filter((w) => w.length >= 2).slice(0, 3);
    for (const w of words) { const why = textProblem(w); if (why) return toast(why); }
    let p = c.p;
    if (words.length) {
      try { const me = await getPos(); p = { lat: Math.round(me.lat * 20) / 20, lng: Math.round(me.lng * 20) / 20 }; } // 約5kmの細かさに丸めて保存
      catch { return toast("距離で絞るために、位置情報を許可してね"); }
    }
    setKwConf({ k: words, r: Number(r.value), p });
    if (pushOn()) await syncPush();
    toast(words.length ? `「${words.join("・")}」の在庫が${r.value}km以内で報告されたらお知らせします` : "商品名の通知をやめました");
    after?.();
  });
  return el("div", { class: "kw-box" },
    el("h3", { class: "mini-h", text: "🔎 商品名でも通知" }),
    el("p", { class: "small", text: "お気に入りのお店でなくても、さがしている商品の在庫が近くで報告されたらお知らせします。場所は約5kmの細かさに丸めて、暗号化して保存します。" }),
    input, r, save);
}

// ---------- QRコードのチラシ（印刷・配布用の画像を端末の中で作る） ----------
async function drawFlyer(url) {
  const { default: qrcode } = await import("./vendor/qrcode/qrcode.mjs");
  const W = 1240, H = 1754;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d");
  const font = (px, b = true) => `${b ? "800 " : ""}${px}px "Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic",sans-serif`;
  g.fillStyle = "#fffaf0"; g.fillRect(0, 0, W, H);
  g.fillStyle = "#14213d"; g.fillRect(0, 0, W, 300);
  g.fillStyle = "#ffd166"; g.fillRect(0, 300, W, 14);
  const logo = await new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = "icons/icon-512.png"; });
  if (logo) g.drawImage(logo, 70, 60, 180, 180);
  g.fillStyle = "#fff"; g.font = font(78); g.fillText("トレジャー", 290, 140);
  g.fillText("カードマップ", 290, 235);
  g.textAlign = "center"; g.fillStyle = "#14213d";
  g.font = font(64); g.fillText("ワンピースカードの在庫", W / 2, 440);
  g.fillText("みんなで地図に報告！", W / 2, 530);
  g.font = font(38, false); g.fillStyle = "#334";
  g.fillText("コンビニ・本屋・家電量販店の入荷情報がひと目で分かる", W / 2, 610);
  // QRコード
  const q = qrcode(0, "M"); q.addData(url); q.make();
  const n = q.getModuleCount(), size = 640, cell = Math.floor(size / (n + 8)), qs = cell * (n + 8);
  const qx = (W - qs) / 2, qy = 680;
  g.fillStyle = "#fff"; g.fillRect(qx, qy, qs, qs);
  g.fillStyle = "#000";
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.isDark(y, x)) g.fillRect(qx + (x + 4) * cell, qy + (y + 4) * cell, cell, cell);
  g.strokeStyle = "#14213d"; g.lineWidth = 6; g.strokeRect(qx - 3, qy - 3, qs + 6, qs + 6);
  g.fillStyle = "#e63946"; g.font = font(44); g.fillText("📱 スマホのカメラで読み取ってね", W / 2, qy + qs + 80);
  g.textAlign = "left"; g.fillStyle = "#14213d"; g.font = font(40, false);
  ["⭐ 在庫ありのお店が地図でわかる", "🔔 お気に入りのお店の入荷を通知", "🏆 報告でポイント・月間ランキング"].forEach((t, i) => g.fillText(t, 200, qy + qs + 170 + i * 66));
  g.fillStyle = "#14213d"; g.fillRect(0, H - 110, W, 110);
  g.fillStyle = "#fff"; g.textAlign = "center"; g.font = font(30, false);
  g.fillText("無料・登録なしで見られます／ファンが作った非公式アプリです", W / 2, H - 45);
  return c;
}
async function openFlyer() {
  const url = S.user?.uid && !S.backend.isDemo ? `${APP_URL}?ref=${encodeURIComponent(S.user.uid)}` : APP_URL;
  const box = el("div", {}, el("p", { class: "small", text: "作成中…" }));
  openSheet(el("h2", { text: "🖨 QRコードのチラシ" }),
    el("p", { class: "sub", text: S.user ? "あなたの招待リンク入りのチラシです。読み取った人が登録して報告すると、2人に30ptずつ入ります。" : "アプリのQRコード入りのチラシです。ログインすると、招待リンク入りのチラシになります。" }),
    box, el("p", { class: "small", text: "お店に貼るときは、必ずお店の人の許可をもらってね。" }),
    el("button", { class: "btn ghost", type: "button", text: "もどる", onclick: openFeed }));
  const c = await drawFlyer(url);
  const save = el("button", { class: "btn", type: "button", text: "📤 チラシを保存・シェア" });
  save.onclick = busy(save, async () => {
    const blob = await new Promise((ok) => c.toBlob(ok, "image/png"));
    const file = new File([blob], "treasure-card-map-flyer.png", { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file] }); } catch { /* キャンセル */ } }
    else { const a = el("a", { href: URL.createObjectURL(blob), download: "treasure-card-map-flyer.png" }); document.body.append(a); a.click(); a.remove(); toast("チラシを保存しました（A4で印刷できます）"); }
  });
  box.replaceChildren(el("img", { src: c.toDataURL("image/png"), alt: "QRコードのチラシ", style: "width:100%;border-radius:8px;box-shadow:0 1px 6px #0003" }), save);
}

// ---------- 英語表示の切りかえ ----------
function langLabel() { return getLang() === "en" ? "🌐 日本語" : "🌐 English"; }
function toggleLang() { setLang(getLang() === "en" ? "ja" : "en"); location.reload(); }

// ---------- 地域ページ（?pref=福岡県 で開いたら、その県にしぼる） ----------
function applyPrefFromUrl() {
  try {
    const p = new URLSearchParams(location.search).get("pref");
    if (!p || !PREFS.includes(p)) return;
    addPrefOption(p); S.pref = p; $("#prefFilter").value = p; render();
    const list = S.stores.filter((s) => s.pref === p);
    if (list.length) S.map.fitBounds(list.map((s) => [s.lat, s.lng]), { maxZoom: 12, padding: [30, 30] });
  } catch { /* 読めないリンクは無視 */ }
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
  // 「未登録をかくす」ボタン：報告がまだないお店（アイコン・点）をまとめて消す／出す
  const hu = $("#hideUnregBtn");
  let lastShown = S.placesMode === "off" ? "all" : S.placesMode;
  const syncHide = () => { const on = S.placesMode === "off"; hu.classList.toggle("on", on); hu.setAttribute("aria-pressed", String(on)); hu.textContent = on ? "👁 未登録を表示" : "🙈 未登録をかくす"; };
  const applyPlaces = () => {
    try { localStorage.setItem("opmap-places-mode", S.placesMode); } catch {}
    pm.value = S.placesMode; syncHide();
    renderPlaces(); loadPlaces(); renderFukuoka(); loadPrefData();
    if (S.placesMode !== "off" && S.map.getZoom() < PLACE_MIN_ZOOM) toast("地図を拡大すると、周辺のお店が出てきます（コンビニ・家電量販店は点で表示中）");
  };
  pm.onchange = () => { S.placesMode = pm.value; if (S.placesMode !== "off") lastShown = S.placesMode; applyPlaces(); };
  hu.onclick = () => {
    S.placesMode = S.placesMode === "off" ? lastShown : "off";
    applyPlaces();
    toast(S.placesMode === "off" ? "報告がまだないお店をかくしました（報告があるお店だけ表示）" : "報告がまだないお店も表示します");
  };
  syncHide();
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
  startI18n();
  initMap();
  initFilters();
  // 現在地：青い点で表示（ボタンを押したとき＋アプリを開いたとき）
  const showMe = (p) => {
    const ll = [p.coords.latitude, p.coords.longitude];
    const first = !S.myPos;
    S.myPos = { lat: ll[0], lng: ll[1], t: Date.now() };
    if (first) updateStockStrip();
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
  S.backend.onAuth(async (u) => {
    S.user = u; updateAccountBtn();
    S.isAdmin = u ? await S.backend.isAdmin().catch(() => false) : false;
    if (u) flushQueue();
    if (u && await expireIfIdle()) { first = false; return; }
    if (!first && u && !$("#sheet").hidden) { if (u.emailVerified && !u.nickname) openNickname(); else if (!u.emailVerified) openVerify(); else closeSheet(); }
    first = false;
  });
  // 使っているあいだは「最後に使った時刻」を更新。しばらく閉じていて戻ってきたら期限をチェック
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") expireIfIdle(); });
  ["pointerdown", "keydown"].forEach((ev) => document.addEventListener(ev, () => {
    if (S.user && Date.now() - lastActive() > 60000) expireIfIdle();
  }, { passive: true }));
  $("#accountBtn").onclick = openAccount;
  $("#addStoreBtn").onclick = openAddStore;
  $("#feedBtn").onclick = openFeed;
  $("#stockListBtn").onclick = openNearby;
  $("#hereBtn").onclick = openHere;
  $("#itemQChip").onclick = () => { S.itemQ = ""; syncItemChip(); render(); };
  saveRefFromUrl();
  showCountdown();
  loadTrust();
  setBigText(bigText());
  applyTheme();
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", applyTheme);
  showReleaseBanner();
  releaseToday().then((x) => { releaseMode = !!x; });
  setInterval(flushQueue, 60000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") flushQueue(); });
  // 開いてすぐ見える「𝕏」ボタン：アプリを紹介する文をXに入れて開く
  $("#xShareFab").href = `https://x.com/intent/post?text=${encodeURIComponent(`みんなでシェアしてカード集めよう！🗺\nワンピースカードの在庫を報告し合える地図アプリ「トレジャーカードマップ」\nコンビニ・本屋・家電量販店の入荷情報がひと目で分かる！無料で使えるよ\n${TAGS}`)}&url=${encodeURIComponent(APP_URL)}`;
  // 開いたときに画面の真ん中に「Xでシェアしてね」を出す（「今日はもう表示しない」を押した日は出さない）
  const XKEY = "opmap-xmodal-off";
  const today = new Date().toLocaleDateString("ja-JP");
  let off = "";
  try { off = localStorage.getItem(XKEY) || ""; } catch { /* 保存できない端末でも動かす */ }
  const modal = $("#xModal");
  const closeModal = () => { modal.hidden = true; };
  $("#xModalShare").href = $("#xShareFab").href;
  $("#xModalShare").addEventListener("click", closeModal);
  $("#xModalClose").onclick = closeModal;
  $("#xModalToday").onclick = () => { try { localStorage.setItem(XKEY, today); } catch { /* なにもしない */ } closeModal(); };
  modal.onclick = (e) => { if (e.target === modal) closeModal(); };
  // はじめての人にはガイドを先に出す（その回はシェアのお知らせは出さない）
  let guideDone = false;
  try { guideDone = localStorage.getItem(GUIDE_KEY) === "1"; } catch { /* なにもしない */ }
  if (!guideDone && !new URLSearchParams(location.search).get("s")) openGuide();
  else if (off !== today && !new URLSearchParams(location.search).get("s")) modal.hidden = false;
  $("#modeCancel").onclick = () => { S.mode = null; $("#modeBanner").hidden = true; };
  $(".sheet-close").onclick = closeSheet;
  loadFukuoka(); // 待たずに先に読み込む（お店の点はすぐ出す）
  loadPrefData();
  await loadData();
  showFavNews();
  applyPrefFromUrl();
  showLotteryNews();
  checkPushKey();
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

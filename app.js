// ワンピカ在庫マップ（非公式） — 画面の動き
// 安全のための決まり：ユーザーが入力した文字は必ず textContent で表示し、HTMLとして扱わない。
import { firebaseConfig, appCheckSiteKey } from "./firebase-config.js";

// ---------- 定数 ----------
export const PRODUCTS = { booster: "ブースターパック", extra: "エクストラブースター", premium: "プレミアムブースター", starter: "スタートデッキ", other: "その他" };
export const STATUS = { in: "在庫あり", low: "残りわずか", out: "売り切れ", soon: "入荷予定" };
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
let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3200);
}
function errMsg(e) {
  const c = e?.code || e?.message || "";
  const map = {
    "permission-denied": "連続投稿の制限中か、入力内容に問題があります。少し待ってからもう一度ためしてね",
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
    unavailable: "通信できませんでした。電波を確認してね",
  };
  for (const k in map) if (c.includes(k)) return map[k];
  return "うまくいきませんでした。時間をおいてもう一度ためしてね";
}

// ---------- 状態 ----------
const S = { backend: null, user: null, stores: [], reports: [], filter: "all", product: "", pref: "", mode: null, map: null, layer: null, me: null, liked: new Set(), flagged: new Set() };

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
  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    maxZoom: 19, subdomains: "abcd",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>',
  }).addTo(S.map);
  L.control.zoom({ position: "topleft" }).addTo(S.map);
  S.layer = L.layerGroup().addTo(S.map);
  S.map.on("click", (e) => { if (S.mode === "pick") pickPoint(e.latlng); });
}
function render() {
  S.layer.clearLayers();
  const list = visibleStores(S.stores, S.reports, S);
  const now = Date.now();
  for (const s of list) {
    const r = latestFor(S.reports, s.id, S.product);
    const cls = r ? r.status : "none";
    const stale = r && now - r.createdAt > STALE_H * 3600e3;
    const icon = L.divIcon({ className: "", html: `<div class="pin ${cls}${stale ? " stale" : ""}"></div>`, iconSize: [26, 26], iconAnchor: [13, 26] });
    L.marker([s.lat, s.lng], { icon, title: s.name, keyboard: true }).on("click", () => openStore(s.id)).addTo(S.layer);
  }
}

// ---------- 下から出るパネル ----------
function openSheet(...nodes) {
  const body = $("#sheetBody");
  body.replaceChildren(...nodes);
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
    el("p", { class: "small", text: "公開されるのはニックネームだけです。メールアドレスは他の人に見えません。" }),
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
  const input = el("input", { type: "text", maxLength: 20, placeholder: "例：麦わらハンター", value: S.user?.nickname || "" });
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
  const stat = el("div", { class: "stat" }, el("div", {}, el("b", { text: "…" }), "報告"), el("div", {}, el("b", { text: "…" }), "もらった👍"), el("div", {}, el("b", { text: "…" }), "ポイント"));
  const nick = el("button", { class: "btn ghost", type: "button", text: "ニックネームを変える" });
  const out = el("button", { class: "btn ghost", type: "button", text: "ログアウト" });
  nick.onclick = () => openNickname(openAccount);
  out.onclick = busy(out, async () => { await S.backend.signOut(); closeSheet(); toast("ログアウトしました"); });
  openSheet(el("h2", { text: S.user.nickname }), el("p", { class: "sub", text: "報告1回＝10pt、👍1つ＝5pt" }), stat, nick, out);
  try {
    const st = await S.backend.myStats();
    const b = stat.querySelectorAll("b");
    b[0].textContent = st.reports; b[1].textContent = st.likes; b[2].textContent = st.reports * 10 + st.likes * 5;
  } catch (e) { console.warn(e); }
}
function updateAccountBtn() {
  const b = $("#accountBtn");
  b.textContent = !S.user ? "ログイン" : S.user.nickname ? `👤 ${S.user.nickname.slice(0, 8)}` : "設定";
}

// ---------- お店のパネル ----------
async function openStore(id) {
  const s = S.stores.find((x) => x.id === id);
  if (!s) return;
  const reps = S.reports.filter((r) => r.storeId === id);
  const ids = reps.map((r) => r.id);
  const reportBtn = el("button", { class: "btn", type: "button", text: "📝 在庫を報告する", onclick: () => ready() && openReportForm(s) });
  const gmap = el("a", { class: "btn ghost", href: `https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}`, target: "_blank", rel: "noopener noreferrer", text: "🧭 地図アプリで道案内", style: "text-align:center;text-decoration:none" });
  const listBox = el("div");
  openSheet(el("h2", { text: s.name }), el("p", { class: "sub", text: [s.pref, s.address].filter(Boolean).join(" ") || "住所未登録" }), reportBtn, listBox, gmap);
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
        el("b", { text: PRODUCTS[r.product] || "" }), r.setCode ? el("span", { class: "meta", text: ` ${r.setCode}` }) : null),
      el("span", { class: "meta", text: timeAgo(r.createdAt) })),
    el("div", { class: "meta", text: `${SALE[r.saleType] || ""}・${r.nickname || "名無し"}` }),
    r.note ? el("p", { class: "note", text: r.note }) : null,
    el("div", { class: "acts" }, like, flag, del));
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
function openReportForm(s) {
  const product = seg(PRODUCTS, "booster");
  const status = seg(STATUS, "in");
  const sale = seg(SALE, "pack");
  const code = el("input", { type: "text", maxLength: 12, placeholder: "例：OP-14（わからなければ空でOK）", autocapitalize: "characters" });
  const note = el("textarea", { maxLength: 100, placeholder: "例：レジ横に10パックくらい（100文字まで・URL不可）" });
  const send = el("button", { class: "btn", type: "button", text: "報告する" });
  send.onclick = busy(send, async () => {
    const setCode = clean(code.value, 12).toUpperCase();
    const n = clean(note.value, 100);
    if (setCode && !/^[A-Z0-9-]{1,12}$/.test(setCode)) return toast("弾の番号は英数字とハイフンだけで入れてね");
    if (URL_RE.test(n) || /[<>]/.test(n)) return toast("メモにURLや < > は書けません");
    const rep = await S.backend.addReport({ storeId: s.id, product: product.get(), setCode, status: status.get(), saleType: sale.get(), note: n });
    S.reports.unshift(rep); render(); toast("報告ありがとう！ +10pt"); openStore(s.id);
  });
  openSheet(el("h2", { text: "在庫を報告" }), el("p", { class: "sub", text: s.name }),
    el("label", { text: "商品" }), product.box,
    el("label", { text: "弾の番号（任意）" }), code,
    el("label", { text: "いまの状態" }), status.box,
    el("label", { text: "売り方" }), sale.box,
    el("label", { text: "ひとことメモ（任意）" }), note,
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
function addrOf(a = {}) {
  return clean([a.city || a.town || a.village || a.county, a.suburb || a.quarter || a.neighbourhood, a.road].filter(Boolean).join(" "), 120);
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
    ...(items.length ? items.map((r) => {
      const s = S.stores.find((x) => x.id === r.storeId);
      return el("div", { class: "feed-item", role: "button", tabindex: "0", onclick: () => { S.map.setView([s.lat, s.lng], 16); openStore(s.id); } },
        el("div", { class: "row", style: "display:flex;justify-content:space-between" }, el("b", { text: s.name }), el("span", { class: "meta", text: timeAgo(r.createdAt) })),
        el("div", {}, el("span", { class: `badge ${r.status}`, text: STATUS[r.status] }), " ", PRODUCTS[r.product] || "", r.setCode ? ` ${r.setCode}` : ""));
    }) : [el("p", { class: "small", text: "まだ報告がありません" })]));
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
  $("#modeCancel").onclick = () => { S.mode = null; $("#modeBanner").hidden = true; };
  $(".sheet-close").onclick = closeSheet;
  $("#locateBtn").onclick = () => {
    if (!navigator.geolocation) return toast("この端末では現在地が使えません");
    navigator.geolocation.getCurrentPosition((p) => {
      const ll = [p.coords.latitude, p.coords.longitude];
      S.map.setView(ll, 14);
      if (S.me) S.me.setLatLng(ll); else S.me = L.circleMarker(ll, { radius: 8, color: "#fff", weight: 3, fillColor: "#2563eb", fillOpacity: 1 }).addTo(S.map);
    }, () => toast("現在地を使えませんでした（設定で許可してね）"), { enableHighAccuracy: true, timeout: 10000 });
  };
  await loadData();
  // 画面を開いている間は2分ごとに更新
  setInterval(() => { if (document.visibilityState === "visible" && $("#sheet").hidden) loadData(); }, 120000);
}
if (typeof window !== "undefined" && !window.__TEST__) main();

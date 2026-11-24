// デモモード：Firebase未設定のときに使う。データはこの端末(localStorage)の中だけ。
const KEY = "opmap-demo-v1";
const mem = { data: null };

function load() {
  if (mem.data) return mem.data;
  try { mem.data = JSON.parse(localStorage.getItem(KEY)); } catch { mem.data = null; }
  if (!mem.data) mem.data = seed();
  return mem.data;
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(mem.data)); } catch { /* 保存できない環境でも動かす */ }
}
const id = () => Math.random().toString(36).slice(2, 12);

function seed() {
  const now = Date.now();
  const stores = [
    { id: "s1", name: "サンプルカード店 梅田", lat: 34.7025, lng: 135.4959, address: "大阪市北区（サンプル）", pref: "大阪府" },
    { id: "s2", name: "サンプル書店 難波", lat: 34.6657, lng: 135.5013, address: "大阪市中央区（サンプル）", pref: "大阪府" },
    { id: "s3", name: "サンプルホビー 秋葉原", lat: 35.6984, lng: 139.7731, address: "千代田区（サンプル）", pref: "東京都" },
    { id: "s4", name: "サンプル家電 名駅", lat: 35.1709, lng: 136.8815, address: "名古屋市中村区（サンプル）", pref: "愛知県" },
    { id: "s5", name: "サンプル玩具 天神", lat: 33.5902, lng: 130.3990, address: "福岡市中央区（サンプル）", pref: "福岡県" },
  ].map((s) => ({ ...s, createdBy: "demo", createdAt: now }));
  const r = (storeId, product, setCode, status, saleType, note, minAgo, likes) => ({
    id: id(), storeId, uid: "other", nickname: "サンプル船長", product, setCode, status, saleType, note, likes, flags: 0, createdAt: now - minAgo * 60000,
  });
  const reports = [
    r("s1", "booster", "", "in", "pack", "レジ横に並んでました（サンプル）", 25, 3),
    r("s2", "starter", "", "low", "pack", "残り2個くらい（サンプル）", 140, 1),
    r("s3", "booster", "", "out", "box", "", 300, 0),
    r("s4", "extra", "", "soon", "lottery", "抽選の告知が貼ってありました（サンプル）", 60 * 20, 2),
    r("s5", "booster", "", "in", "box", "", 60 * 80, 0),
  ];
  return { stores, reports, likes: {}, flags: {}, user: null, lastReport: 0, lastStore: 0 };
}

export function createDemoBackend() {
  let cb = () => {};
  const d = load();
  const user = () => (d.user ? { uid: "me", email: "demo@example.com", emailVerified: true, nickname: d.user.nickname } : null);
  const wait = (v) => new Promise((res) => setTimeout(() => res(v), 120));
  return {
    isDemo: true,
    onAuth(f) { cb = f; f(user()); },
    async refreshUser() { return user(); },
    async signInGoogle() { d.user = { nickname: "" }; save(); cb(user()); },
    async signUpEmail() { d.user = { nickname: "" }; save(); cb(user()); },
    async signInEmail() { d.user = { nickname: "" }; save(); cb(user()); },
    async resetPassword() {},
    async resendVerification() {},
    async signOut() { d.user = null; save(); cb(null); },
    async setNickname(n) { d.user = { nickname: n }; save(); },
    async listStores() { return wait(d.stores.slice()); },
    async listRecentReports(days) {
      const since = Date.now() - days * 864e5;
      return wait(d.reports.filter((r) => r.createdAt >= since).sort((a, b) => b.createdAt - a.createdAt));
    },
    async addStore(s) {
      if (Date.now() - d.lastStore < 120000) throw Object.assign(new Error("rate"), { code: "permission-denied" });
      const st = { id: id(), ...s, createdBy: "me", createdAt: Date.now() };
      d.stores.push(st); d.lastStore = Date.now(); save(); return st;
    },
    async addReport(r) {
      if (Date.now() - d.lastReport < 30000) throw Object.assign(new Error("rate"), { code: "permission-denied" });
      const rep = { id: id(), ...r, uid: "me", nickname: d.user.nickname, likes: 0, flags: 0, createdAt: Date.now() };
      d.reports.push(rep); d.lastReport = Date.now(); save(); return rep;
    },
    async deleteReport(rid) { d.reports = d.reports.filter((x) => !(x.id === rid && x.uid === "me")); save(); },
    async vote(rid, kind) {
      const box = kind === "like" ? d.likes : d.flags;
      if (box[rid]) throw new Error("already");
      box[rid] = true;
      const rep = d.reports.find((x) => x.id === rid);
      if (rep) rep[kind === "like" ? "likes" : "flags"]++;
      save();
    },
    async myVotes(ids, kind) {
      const box = kind === "like" ? d.likes : d.flags;
      return new Set(ids.filter((i) => box[i]));
    },
    async myStats() {
      const mine = d.reports.filter((r) => r.uid === "me");
      return { reports: mine.length, likes: mine.reduce((a, r) => a + r.likes, 0) };
    },
  };
}

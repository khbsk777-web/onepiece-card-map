// 本番用：Firebase（ログイン＋データベース）につなぐ部分
// 守りの本体は firestore.rules。ここはその決まりに合わせてデータを送るだけ。
const V = "10.12.2";
const base = `https://www.gstatic.com/firebasejs/${V}`;

export async function createFirebaseBackend(config, appCheckSiteKey) {
  const { initializeApp } = await import(`${base}/firebase-app.js`);
  const A = await import(`${base}/firebase-auth.js`);
  const F = await import(`${base}/firebase-firestore.js`);

  const app = initializeApp(config);
  if (appCheckSiteKey) {
    const { initializeAppCheck, ReCaptchaV3Provider } = await import(`${base}/firebase-app-check.js`);
    initializeAppCheck(app, { provider: new ReCaptchaV3Provider(appCheckSiteKey), isTokenAutoRefreshEnabled: true });
  }
  const auth = A.getAuth(app);
  auth.languageCode = "ja";
  const db = F.getFirestore(app);
  let profile = null;

  async function loadProfile(u) {
    if (!u) return null;
    const snap = await F.getDoc(F.doc(db, "users", u.uid));
    return snap.exists() ? snap.data() : null;
  }
  function toUser(u) {
    if (!u) return null;
    return { uid: u.uid, email: u.email, emailVerified: u.emailVerified, nickname: profile?.nickname || "" };
  }
  const ts = (t) => (t && t.toMillis ? t.toMillis() : Date.now());

  return {
    isDemo: false,
    onAuth(cb) {
      A.onAuthStateChanged(auth, async (u) => {
        profile = u ? await loadProfile(u).catch(() => null) : null;
        cb(toUser(u));
      });
    },
    async refreshUser() {
      if (!auth.currentUser) return null;
      await A.reload(auth.currentUser);
      await auth.currentUser.getIdToken(true); // メール確認済みを反映
      profile = await loadProfile(auth.currentUser);
      return toUser(auth.currentUser);
    },
    async signInGoogle() {
      await A.signInWithPopup(auth, new A.GoogleAuthProvider());
    },
    async signUpEmail(email, pw) {
      const c = await A.createUserWithEmailAndPassword(auth, email, pw);
      await A.sendEmailVerification(c.user);
    },
    async signInEmail(email, pw) {
      await A.signInWithEmailAndPassword(auth, email, pw);
    },
    async resetPassword(email) {
      await A.sendPasswordResetEmail(auth, email);
    },
    async resendVerification() {
      if (auth.currentUser) await A.sendEmailVerification(auth.currentUser);
    },
    async signOut() {
      await A.signOut(auth);
    },
    async setNickname(nickname) {
      const ref = F.doc(db, "users", auth.currentUser.uid);
      if (profile) await F.updateDoc(ref, { nickname });
      else await F.setDoc(ref, { nickname, createdAt: F.serverTimestamp() });
      profile = { ...(profile || {}), nickname };
    },
    async listStores() {
      const snap = await F.getDocs(F.query(F.collection(db, "stores"), F.limit(5000)));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },
    async listRecentReports(days) {
      const since = F.Timestamp.fromMillis(Date.now() - days * 864e5);
      const q = F.query(F.collection(db, "reports"), F.where("createdAt", ">=", since), F.orderBy("createdAt", "desc"), F.limit(1500));
      const snap = await F.getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data(), createdAt: ts(d.data().createdAt) }));
    },
    // 連投制限：rateLimits の時刻とセットで書かないとサーバーが拒否する
    async addStore(s) {
      const uid = auth.currentUser.uid;
      const ref = F.doc(F.collection(db, "stores"));
      const b = F.writeBatch(db);
      b.set(F.doc(db, "rateLimits", uid), { lastStore: F.serverTimestamp() }, { merge: true });
      b.set(ref, { ...s, createdBy: uid, createdAt: F.serverTimestamp() });
      await b.commit();
      return { id: ref.id, ...s, createdBy: uid, createdAt: Date.now() };
    },
    // 決まったIDのお店：なければ作る、あればそのまま使う
    async ensureStore(id, st) {
      const ref = F.doc(db, "stores", id);
      const snap = await F.getDoc(ref);
      if (snap.exists()) return { id, ...snap.data() };
      const uid = auth.currentUser.uid;
      const b = F.writeBatch(db);
      b.set(F.doc(db, "rateLimits", uid), { lastStore: F.serverTimestamp() }, { merge: true });
      b.set(ref, { ...st, createdBy: uid, createdAt: F.serverTimestamp() });
      await b.commit();
      return { id, ...st, createdBy: uid, createdAt: Date.now() };
    },
    async addReport(r) {
      const uid = auth.currentUser.uid;
      const ref = F.doc(F.collection(db, "reports"));
      const data = { ...r, uid, nickname: profile.nickname, likes: 0, flags: 0, createdAt: F.serverTimestamp() };
      const b = F.writeBatch(db);
      b.set(F.doc(db, "rateLimits", uid), { lastReport: F.serverTimestamp() }, { merge: true });
      b.set(ref, data);
      await b.commit();
      return { id: ref.id, ...data, createdAt: Date.now() };
    },
    async deleteReport(id) {
      await F.deleteDoc(F.doc(db, "reports", id));
    },
    // 👍と通報：1人1回。サブコレクションに自分の印を残し、数を+1するのを同時に行う
    async vote(id, kind) {
      const uid = auth.currentUser.uid;
      const rRef = F.doc(db, "reports", id);
      const mark = F.doc(db, "reports", id, kind === "like" ? "likes" : "flags", uid);
      await F.runTransaction(db, async (tx) => {
        const [r, m] = [await tx.get(rRef), await tx.get(mark)];
        if (!r.exists()) throw new Error("not-found");
        if (m.exists()) throw new Error("already");
        const field = kind === "like" ? "likes" : "flags";
        tx.set(mark, { createdAt: F.serverTimestamp() });
        tx.update(rRef, { [field]: (r.data()[field] || 0) + 1 });
      });
    },
    // ----- 写真：一覧用の小さい写真(photos)と、大きい写真(photoData)を分けて保存 -----
    async listPhotos(storeId) {
      const snap = await F.getDocs(F.query(F.collection(db, "photos"), F.where("storeId", "==", storeId), F.limit(30)));
      return snap.docs.map((d) => ({ id: d.id, ...d.data(), createdAt: ts(d.data().createdAt) }));
    },
    async addPhoto(meta, full) {
      const uid = auth.currentUser.uid;
      const ref = F.doc(F.collection(db, "photos"));
      const data = { ...meta, uid, nickname: profile.nickname, flags: 0, createdAt: F.serverTimestamp() };
      const b = F.writeBatch(db);
      b.set(F.doc(db, "rateLimits", uid), { lastPhoto: F.serverTimestamp() }, { merge: true });
      b.set(ref, data);
      b.set(F.doc(db, "photoData", ref.id), { uid, data: full });
      await b.commit();
      return { id: ref.id, ...data, createdAt: Date.now() };
    },
    async getPhotoData(id) {
      const snap = await F.getDoc(F.doc(db, "photoData", id));
      return snap.exists() ? snap.data().data : null;
    },
    async deletePhoto(id) {
      const b = F.writeBatch(db);
      b.delete(F.doc(db, "photoData", id));
      b.delete(F.doc(db, "photos", id));
      await b.commit();
    },
    async flagPhoto(id) {
      const uid = auth.currentUser.uid;
      const pRef = F.doc(db, "photos", id);
      const mark = F.doc(db, "photos", id, "flags", uid);
      await F.runTransaction(db, async (tx) => {
        const [p, m] = [await tx.get(pRef), await tx.get(mark)];
        if (!p.exists()) throw new Error("not-found");
        if (m.exists()) throw new Error("already");
        tx.set(mark, { createdAt: F.serverTimestamp() });
        tx.update(pRef, { flags: (p.data().flags || 0) + 1 });
      });
    },
    async myVotes(ids, kind) {
      const uid = auth.currentUser?.uid;
      if (!uid) return new Set();
      const sub = kind === "like" ? "likes" : "flags";
      const res = await Promise.all(ids.map((id) => F.getDoc(F.doc(db, "reports", id, sub, uid)).then((s) => (s.exists() ? id : null)).catch(() => null)));
      return new Set(res.filter(Boolean));
    },
    // アカウント削除：自分の報告・写真・ニックネームを消してから、ログイン情報を消す
    async deleteAccount() {
      const u = auth.currentUser;
      const last = Date.parse(u?.metadata?.lastSignInTime || 0);
      if (!u || Date.now() - last > 5 * 60 * 1000) throw { code: "auth/requires-recent-login" };
      for (const col of ["photos", "reports"]) {
        const snap = await F.getDocs(F.query(F.collection(db, col), F.where("uid", "==", u.uid)));
        for (const d of snap.docs) {
          if (col === "photos") await this.deletePhoto(d.id); else await F.deleteDoc(d.ref);
        }
      }
      await F.deleteDoc(F.doc(db, "users", u.uid));
      profile = null;
      await A.deleteUser(u);
    },
    async myStats() {
      const q = F.query(F.collection(db, "reports"), F.where("uid", "==", auth.currentUser.uid));
      const agg = await F.getAggregateFromServer(q, { n: F.count(), likes: F.sum("likes") });
      const d = agg.data();
      return { reports: d.n || 0, likes: d.likes || 0 };
    },
  };
}

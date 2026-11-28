// セキュリティルールの自動テスト
// 実行：npm i -D firebase-tools @firebase/rules-unit-testing firebase
//       npx firebase emulators:exec --only firestore --project demo-op "node tests/rules.test.mjs"
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp, collection } from "firebase/firestore";

const env = await initializeTestEnvironment({
  projectId: "demo-op",
  firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
});
const verified = (uid) => env.authenticatedContext(uid, { email_verified: true }).firestore();
const unverified = env.authenticatedContext("u9", { email_verified: false }).firestore();
const guest = env.unauthenticatedContext().firestore();
const results = [];
async function t(name, p) {
  try { await p; results.push(["OK ", name]); } catch (e) { results.push(["NG ", name + " → " + e.message]); }
}

await env.withSecurityRulesDisabled(async (c) => {
  const db = c.firestore();
  await setDoc(doc(db, "stores/s1"), { name: "店", lat: 35, lng: 135, address: "", pref: "大阪府", createdBy: "x", createdAt: new Date() });
  await setDoc(doc(db, "admins/boss"), { note: "運営者" });
  await setDoc(doc(db, "reports/r9"), { storeId: "s1", uid: "bob", nickname: "ボブ", product: "booster", setCode: "", status: "in", saleType: "pack", note: "", likes: 0, flags: 3, createdAt: new Date() });
  await setDoc(doc(db, "reports/r1"), { storeId: "s1", uid: "bob", nickname: "ボブ", product: "booster", setCode: "", status: "in", saleType: "pack", note: "", likes: 0, flags: 0, createdAt: new Date() });
});

const alice = verified("alice"), bob = verified("bob");
await t("未ログインでも見られる", assertSucceeds(getDoc(doc(guest, "reports/r1"))));
await t("メール未確認はニックネームを作れない", assertFails(setDoc(doc(unverified, "users/u9"), { nickname: "x", createdAt: serverTimestamp() })));
await t("自分のニックネームを作れる", assertSucceeds(setDoc(doc(alice, "users/alice"), { nickname: "アリス", createdAt: serverTimestamp() })));
await t("他人のニックネームは作れない", assertFails(setDoc(doc(alice, "users/bob"), { nickname: "偽", createdAt: serverTimestamp() })));
await t("URL入りニックネームは不可", assertFails(updateDoc(doc(alice, "users/alice"), { nickname: "http://spam" })));

const report = (over = {}) => ({ storeId: "s1", uid: "alice", nickname: "アリス", product: "booster", setCode: "OP-14", status: "in", saleType: "pack", note: "あり", likes: 0, flags: 0, createdAt: serverTimestamp(), ...over });
async function postReport(db, data) {
  const b = writeBatch(db);
  b.set(doc(db, "rateLimits/alice"), { lastReport: serverTimestamp() }, { merge: true });
  b.set(doc(collection(db, "reports")), data);
  return b.commit();
}
await t("連投制限の時刻なしの報告は拒否", assertFails(setDoc(doc(alice, "reports/x1"), report())));
await t("正しい報告はOK", assertSucceeds(postReport(alice, report())));
await t("5秒以内の連投は拒否", assertFails(postReport(alice, report())));
await t("他人になりすました報告は拒否", assertFails(postReport(verified("alice"), report({ uid: "bob" }))));
await t("いいね数を最初から盛るのは拒否", assertFails(postReport(alice, report({ likes: 99 }))));
await t("31文字以上の商品名は拒否", assertFails(postReport(alice, report({ itemName: "あ".repeat(31) }))));
await t("URL入りの商品名は拒否", assertFails(postReport(alice, report({ itemName: "https://spam" }))));
await t("決められていない項目は拒否", assertFails(postReport(alice, report({ extra: 1 }))));
await new Promise((r) => setTimeout(r, 5500));
await t("商品名つきの報告はOK", assertSucceeds(postReport(alice, report({ itemName: "最強の戦士" }))));
await t("決められていない購入制限は拒否", assertFails(postReport(alice, report({ limit: "p99" }))));
await new Promise((r) => setTimeout(r, 5500));
await t("購入制限つきの報告はOK", assertSucceeds(postReport(alice, report({ limit: "p3" }))));

async function vote(db, uid, id, sub, field, to) {
  const b = writeBatch(db);
  b.set(doc(db, `reports/${id}/${sub}/${uid}`), { createdAt: serverTimestamp() });
  b.update(doc(db, `reports/${id}`), { [field]: to });
  return b.commit();
}
await t("👍は+1ならOK", assertSucceeds(vote(alice, "alice", "r1", "likes", "likes", 1)));
await t("👍の2回目は拒否", assertFails(vote(alice, "alice", "r1", "likes", "likes", 2)));
await t("👍を+10は拒否", assertFails(vote(verified("carol"), "carol", "r1", "likes", "likes", 11)));
await t("自分の投稿に👍は拒否", assertFails(vote(bob, "bob", "r1", "likes", "likes", 2)));
await t("「まだあった」は+1ならOK（項目がまだない報告でも）", assertSucceeds(vote(alice, "alice", "r1", "stills", "still", 1)));
await t("「まだあった」の2回目は拒否", assertFails(vote(alice, "alice", "r1", "stills", "still", 2)));
await t("「もうなかった」を+5は拒否", assertFails(vote(verified("carol"), "carol", "r1", "gones", "gone", 5)));
await t("「もうなかった」は+1ならOK", assertSucceeds(vote(verified("carol"), "carol", "r1", "gones", "gone", 1)));
await t("自分の報告に「まだあった」は拒否", assertFails(vote(bob, "bob", "r1", "stills", "still", 2)));
await t("他人の報告の書き換えは拒否", assertFails(updateDoc(doc(alice, "reports/r1"), { status: "out" })));
await t("他人の報告の削除は拒否", assertFails(deleteDoc(doc(alice, "reports/r1"))));
await t("自分の報告は削除できる", assertSucceeds(deleteDoc(doc(bob, "reports/r1"))));
await t("お店の書き換えは拒否", assertFails(updateDoc(doc(alice, "stores/s1"), { name: "乗っ取り" })));
await t("海外座標のお店は拒否", assertFails((async () => {
  const b = writeBatch(alice);
  b.set(doc(alice, "rateLimits/alice"), { lastStore: serverTimestamp() }, { merge: true });
  b.set(doc(collection(alice, "stores")), { name: "店", lat: 40.7, lng: -74, address: "", pref: "東京都", createdBy: "alice", createdAt: serverTimestamp() });
  return b.commit();
})()));
const newStore = (pioneer) => (async () => {
  const b = writeBatch(alice);
  b.set(doc(alice, "rateLimits/alice"), { lastStore: serverTimestamp() }, { merge: true });
  b.set(doc(collection(alice, "stores")), { name: "店", lat: 33.6, lng: 130.4, address: "", pref: "福岡県", createdBy: "alice", createdAt: serverTimestamp(), ...(pioneer ? { pioneer } : {}) });
  return b.commit();
})();
await t("開拓者の名前を他人の名前にするのは拒否", assertFails(newStore("ボブ")));
await t("開拓者の名前が自分のニックネームならOK", assertSucceeds(newStore("アリス")));
await t("他人のニックネームは削除できない", assertFails(deleteDoc(doc(verified("bob"), "users/alice"))));
await t("自分のニックネームは削除できる（アカウント削除）", assertSucceeds(deleteDoc(doc(alice, "users/alice"))));
// ---- 運営者 ----
const boss = verified("boss");
await t("運営者でない人は他人の報告を消せない", assertFails(deleteDoc(doc(alice, "reports/r9"))));
await t("運営者は通報された報告を消せる", assertSucceeds(deleteDoc(doc(boss, "reports/r9"))));
await t("運営者の名簿は自分で作れない", assertFails(setDoc(doc(alice, "admins/alice"), { note: "x" })));
await t("運営者の名簿は他人には読めない", assertFails(getDoc(doc(alice, "admins/boss"))));
// ---- これから行く ----
const slot = Math.floor(Date.now() / 7200000);
const going = (db, uid, n, s = slot) => (async () => {
  const b = writeBatch(db);
  const id = `s1_${s}`;
  b.set(doc(db, "goings", id), { storeId: "s1", slot: s, n }, n > 1 ? { merge: true } : undefined);
  b.set(doc(db, "goings", id, "marks", uid), { createdAt: serverTimestamp() });
  return b.commit();
})();
await t("「これから行く」1人目はOK", assertSucceeds(going(alice, "alice", 1)));
await t("同じ人の2回目は拒否", assertFails(going(alice, "alice", 2)));
await t("2人目は+1ならOK", assertSucceeds(going(bob, "bob", 2)));
await t("人数を+5は拒否", assertFails(going(verified("carol"), "carol", 7)));
await t("ちがう時間帯の番号は拒否", assertFails(going(verified("dave"), "dave", 1, slot - 5)));
await t("だれが行くかは他人には見えない", assertFails(getDoc(doc(bob, "goings", `s1_${slot}`, "marks", "alice"))));
await t("人数はだれでも見られる", assertSucceeds(getDoc(doc(guest, "goings", `s1_${slot}`))));

// ---- なりすまし・個人情報・見えない文字の対策 ----
const erin = verified("erin");
const nick = (n) => setDoc(doc(erin, "users/erin"), { nickname: n, createdAt: serverTimestamp() });
await t("「運営」を含むニックネームは拒否", assertFails(nick("トレカ運営")));
await t("「公式」を含むニックネームは拒否", assertFails(nick("公式アカウント")));
await t("Adminを含むニックネームは拒否（大文字でも）", assertFails(nick("ADMIN太郎")));
await t("見えない文字入りのニックネームは拒否", assertFails(nick("アリ\u200Bス")));
await t("文字の向きを変える文字は拒否", assertFails(nick("abc\u202Edef")));
await t("電話番号入りのニックネームは拒否", assertFails(nick("09012345678")));
await t("ふつうのニックネームはOK", assertSucceeds(nick("エリン")));
const erinReport = (over = {}) => {
  const b = writeBatch(erin);
  b.set(doc(erin, "rateLimits/erin"), { lastReport: serverTimestamp() }, { merge: true });
  b.set(doc(collection(erin, "reports")), report({ uid: "erin", nickname: "エリン", ...over }));
  return b.commit();
};
await t("メモに電話番号は拒否", assertFails(erinReport({ note: "店員 080-1234-5678" })));
await t("メモにメールアドレスは拒否", assertFails(erinReport({ note: "連絡は abc@example.com" })));
await t("商品名に見えない文字は拒否", assertFails(erinReport({ itemName: "最強\u200Dの戦士" })));
await t("メモの改行はOK・日付もOK", assertSucceeds(erinReport({ note: "レジ横\n2026-11-28 入荷" })));
await t("ないお店の「これから行く」は拒否", assertFails((async () => {
  const b = writeBatch(erin);
  const id = `nai_${slot}`;
  b.set(doc(erin, "goings", id), { storeId: "nai", slot, n: 1 });
  b.set(doc(erin, "goings", id, "marks", "erin"), { createdAt: serverTimestamp() });
  return b.commit();
})()));
await t("想定外の場所は読めない", assertFails(getDoc(doc(guest, "admin/secret"))));

for (const r of results) console.log(r.join(" "));
await env.cleanup();
process.exit(results.some((r) => r[0] === "NG ") ? 1 : 0);

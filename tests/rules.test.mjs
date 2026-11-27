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
await t("想定外の場所は読めない", assertFails(getDoc(doc(guest, "admin/secret"))));

for (const r of results) console.log(r.join(" "));
await env.cleanup();
process.exit(results.some((r) => r[0] === "NG ") ? 1 : 0);

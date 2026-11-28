// 英語表示（English mode）
// 画面に出る日本語のうち、決まった文（ボタン・見出しなど）だけを英語に置きかえる。
// みんなが書いた店名・メモ・ニックネームはそのまま（勝手に変えない）。
const KEY = "opmap-lang";
export function getLang() { try { return localStorage.getItem(KEY) === "en" ? "en" : "ja"; } catch { return "ja"; } }
export function setLang(v) { try { localStorage.setItem(KEY, v); } catch { /* 保存できない端末 */ } }

const D = {
  "駅": "Station", "決定": "Save", "自動": "Auto", "地図": "Map", "商品": "Product", "本屋": "Bookstore", "次へ": "Next",
  "締切": "Deadline", "種類": "Type", "抽選": "Lottery", "見る": "View", "売切": "Sold out", "全国": "All Japan", "やめる": "Cancel",
  "近い順": "Nearest", "全商品": "All products", "あとで": "Later", "すべて": "All", "売り方": "How sold", "ダーク": "Dark",
  "もどる": "Back", "その他": "Other", "閉じる": "Close", "並び順": "Sort", "または": "or", "ライト": "Light", "⭐あり": "⭐ In stock",
  "報告する": "Report", "スキップ": "Skip", "バラ売り": "Single packs", "📊 地域": "📊 Regions", "制限なし": "No limit", "ログイン": "Log in",
  "コンビニ": "Convenience store", "都道府県": "Prefecture", "🚩 通報": "🚩 Report abuse", "🚩 通報済み": "🚩 Reported", "⭐わずか": "⭐ Few left", "🗺 凡例": "🗺 Legend",
  "探す範囲": "Search range", "登録する": "Register", "受付開始": "Opens", "🎟 抽選": "🎟 Lottery", "取り消す": "Undo", "📝 予約": "📝 Pre-order",
  "新しい順": "Newest", "🛠 管理": "🛠 Admin", "入荷予定": "Coming soon", "商業施設": "Mall", "売り切れ": "Sold out", "絞り込み": "Filters",
  "お店の情報": "Store info", "パスワード": "Password", "🏴 開拓者": "🏴 Pioneers", "ログアウト": "Log out", "いまの状態": "Current status",
  "📅 発売日": "📅 Releases", "📍 現在地": "📍 My location", "在庫を報告": "Report stock", "8文字以上": "8+ characters", "お店を登録": "Add a store",
  "🎖 バッジ": "🎖 Badges", "家電量販店": "Electronics store", "❓ 使い方": "❓ How to use", "お店の名前": "Store name", "ニックネーム": "Nickname",
  "𝕏 でシェア": "Share on 𝕏", "𝕏 でシェアする": "Share on 𝕏", "1人1BOX": "1 box / person", "1人1パック": "1 pack / person", "1人2パック": "2 packs / person",
  "1人3パック": "3 packs / person", "1人5パック": "5 packs / person", "1人10パック": "10 packs / person", "読み込み中…": "Loading…",
  "🕘 最近見た": "🕘 Recent", "取り扱いなし": "Not sold here", "⭐ 在庫あり": "⭐ In stock", "⭐ 残りわずか": "⭐ Few left", "🧭 メニュー": "🧭 Menu",
  "🟢 在庫あり": "🟢 In stock", "報告なしのお店": "Stores without reports", "この場所で登録": "Register here", "都道府県を選ぶ": "Choose prefecture",
  "🏆 ランキング": "🏆 Ranking", "📋 在庫リスト": "📋 Stock list", "情報なし/古い": "No info / old", "🕒 今日の情報": "🕒 Today",
  "商品で絞り込み": "Filter by product", "スタートデッキ": "Starter Deck", "👥 フォロー中": "👥 Following", "🎁 友だち招待": "🎁 Invite friends",
  "🆕 新着の報告": "🆕 Latest reports", "📜 歴代の表彰": "📜 Hall of fame", "商品名（任意）": "Product name (optional)", "メールアドレス": "Email",
  "🚗 まわる順番": "🚗 Route", "投稿できる範囲": "Where you can post", "LINEで送る": "Send on LINE", "🏪 周辺：全部": "🏪 Nearby: all",
  "🎟 抽選・予約": "🎟 Lotteries", "本屋（福岡県）": "Bookstores (Fukuoka)", "🔍 店名で探す": "🔍 Search store", "＋ お店を登録": "＋ Add store",
  "🏪 コンビニだけ": "🏪 Convenience only", "カード集めよう！": "and collect cards!", "🕘 最近見たお店": "🕘 Recently viewed",
  "🎉 発売日モード": "🎉 Release-day mode", "周辺のお店の表示": "Nearby stores", "ブースターパック": "Booster Pack", "メールで新規登録": "Sign up with email",
  "🖼 今週のまとめ": "🖼 Weekly summary", "現在地からの距離": "Distance from you", "❤️ お気に入り": "❤️ Favorites", "🤍 お気に入り": "🤍 Favorite",
  "🏃 これから行く": "🏃 I'm going", "🏃 向かっています": "🏃 On my way", "アカウントを削除": "Delete account", "📊 地域のようす": "📊 By region",
  "フォローをやめる": "Unfollow", "👤 フォロー": "👤 Follow", "カード・ホビー店": "Card & hobby shop", "購入制限（任意）": "Purchase limit (optional)",
  "🎁 友だちを招待": "🎁 Invite friends", "コンビニ（全国）": "Convenience stores (Japan)", "メールでログイン": "Log in with email",
  "← お店にもどる": "← Back to store", "🙈 未登録をかくす": "🙈 Hide unreported", "👁 未登録を表示": "👁 Show unreported",
  "🗑 この報告を削除": "🗑 Delete report", "🗑 削除": "🗑 Delete", "🚗 まわる順番ナビ": "🚗 Route planner", "メールを確認してね": "Check your email",
  "パスワードを忘れた": "Forgot password", "🏆 月間ランキング": "🏆 Monthly ranking", "🗑 この写真を削除": "🗑 Delete photo",
  "📍 いるお店で報告": "📍 Report where I am", "都道府県で絞り込み": "Filter by prefecture", "このアプリについて": "About this app",
  "📷 写真を投稿する": "📷 Post a photo", "🗾 都道府県ページ": "🗾 Prefecture pages", "Xでアプリをシェア": "Share the app on X",
  "エクストラブースター": "Extra Booster", "📅 発売日カレンダー": "📅 Release calendar", "まだ写真がありません": "No photos yet",
  "プレミアムブースター": "Premium Booster", "🎟 抽選・予約ボード": "🎟 Lottery & pre-order board", "🎟 抽選・予約を登録": "🎟 Add lottery / pre-order",
  "🏴 開拓者ランキング": "🏴 Pioneer ranking", "今日はもう表示しない": "Don't show again today", "🛠 運営者の管理画面": "🛠 Admin panel",
  "まだ報告がありません": "No reports yet", "まだ報告がありません。": "No reports yet.", "📝 くわしく報告する": "📝 Detailed report",
  "ニックネームを変える": "Change nickname", "わからない・書かない": "Unknown / skip", "📚🏬🃏 その他のお店": "📚🏬🃏 Other stores",
  "Googleでログイン": "Log in with Google", "現在地を調べています…": "Finding your location…", "🧭 地図アプリで道案内": "🧭 Directions in Maps",
  "トレジャーカードマップ": "Treasure Card Map", "トレジャーカードマップ（非公式）": "Treasure Card Map (unofficial)",
  "コンビニ（拡大で表示）": "Convenience stores (zoom in)", "❤️ お気に入りのお店": "❤️ Favorite stores", "🔗 招待リンクをコピー": "🔗 Copy invite link",
  "住所（だいたいでOK）": "Address (approximate is OK)", "📤 画像をシェア・保存": "📤 Share / save image", "Xでみんなにシェアして": "Share on X",
  "タイトル（40文字まで）": "Title (max 40)", "確認メールをもう一度送る": "Resend confirmation email", "📍 地図をタップして選ぶ": "📍 Tap the map to choose",
  "👥 フォロー中の人の報告": "👥 Reports from people you follow", "緑の円＝現在地から3km": "Green circle = 3 km from you",
  "📋 在庫ありの報告リスト": "📋 In-stock reports", "🏆 月間ランキング・表彰": "🏆 Monthly ranking & awards", "🎟 このお店の抽選・予約": "🎟 Lotteries at this store",
  "100km以内の在庫あり": "In stock within 100 km", "メールのリンクを押した！": "I clicked the email link!", "在庫が地図でひと目で分かる": "See stock at a glance",
  "写真を読み込めませんでした": "Couldn't load the photo", "削除する（元に戻せません）": "Delete (cannot be undone)", "見つけたらワンタップで報告": "Found it? Report in one tap",
  "アカウントを削除しますか？": "Delete your account?", "ワンピースカード、あった？": "Did you find ONE PIECE cards?", "🎁 友だちを招待（30pt）": "🎁 Invite friends (30pt)",
  "🛠 このお店を削除（運営者）": "🛠 Delete store (admin)", "🏴 開拓者ランキング（ずっと）": "🏴 Pioneer ranking (all time)",
  "報告でポイント・称号がもらえる": "Earn points and titles", "✅ 報告ありがとう！ +10pt": "✅ Thanks for reporting! +10pt",
  "📷 お店の写真（売り場・棚など）": "📷 Store photos (shelves etc.)", "カードを売っているお店を追加しよう": "Add a store that sells cards",
  "🔎 商品名で探す（例：最強の戦士）": "🔎 Search by product name", "通報が多いため非表示になっています": "Hidden because of many reports",
  "カードが置いてある場所（メモ・任意）": "Where the cards are (note, optional)", "応募の方法など（100文字まで・任意）": "How to apply (max 100, optional)",
  "📍 地図をタップしてお店の場所を選んでね": "📍 Tap the map to choose the store location",
  "くわしく報告する（商品名・購入制限など）": "Detailed report (product name, limits…)", "いま発表されている発売予定はありません。": "No upcoming releases announced.",
  "まだ報告がありません。最初の報告をしてみよう！": "No reports yet. Be the first to report!",
  "個人の家など、お店以外の場所は登録しないでね。": "Please don't register homes or non-store places.",
  "見つかりませんでした。地図をタップして選んでね": "Not found. Tap the map to choose.",
  "今日の報告はまだありません。一番乗りのチャンス！": "No reports today yet. Be the first!",
  "❌ もうなかったという声が多いです（売り切れたかも）": "❌ Many say it's gone (maybe sold out)",
  "⚠️ 在庫は売り切れていることもあります。運転中はスマホを操作しないでね。": "⚠️ Items may be sold out. Don't use your phone while driving.",
  "在庫の報告・👍・通報にはログインが必要です。見るだけならログインなしでOK。": "Log in to report, like or flag. Browsing needs no login.",
  "まだお気に入りがありません。よく行くお店を開いて「🤍 お気に入り」を押してね。": "No favorites yet. Open a store and tap “🤍 Favorite”.",
  "いま登録されている抽選・予約はありません。お店で見つけたら登録してみよう！": "No lotteries or pre-orders yet. Add one when you see it in a store!",
  "メニュー（新着・近くの在庫・お気に入り・発売日・ランキング）": "Menu (latest, nearby stock, favorites, releases, ranking)",
  "まだ在庫の報告がありません。見かけたら最初の報告をしてみよう！": "No stock reports yet. Be the first to report!",
  "✅ まだあった": "✅ Still there", "❌ もうなかった": "❌ Gone", "役に立った": "Helpful", "BOX": "Box",
  "表示：自動": "Theme: Auto", "🔠 文字：ふつう": "🔠 Text: normal", "🔠 文字：大きい": "🔠 Text: large",
  "🔥 ヒート：オン": "🔥 Heatmap: on", "🔥 ヒート：オフ": "🔥 Heatmap: off", "🌐 English": "🌐 日本語",
  "住所未登録": "No address",
};
// 数字などが入る文
const P = [
  [/^たった今$/, "just now"], [/^(\d+)分前$/, "$1 min ago"], [/^(\d+)時間前$/, "$1 h ago"], [/^(\d+)日前$/, "$1 d ago"],
  [/^⏳ (.+)まであと(\d+)日$/, "⏳ $2 days to $1"], [/^🎉 今日発売：(.+)$/, "🎉 Out today: $1"], [/^あと(\d+)日$/, "$1 days left"],
  [/^最近(\d+)日の報告（(\d+)件）$/, "Reports in the last $1 days ($2)"], [/^いま(\d+)人が向かっています$/, "$1 people on the way"],
  [/^⏰ 締切まであと(\d+)時間$/, "⏰ Closes in $1 h"], [/^締切まであと(\d+)日$/, "Closes in $1 days"],
  [/^📍 (.+)$/, null], // 住所などはそのまま
  [/^🧭 地図アプリで (\d+)店をまわる$/, "🧭 Visit $1 stores in Maps"],
  [/^👍 役に立った (\d+)$/, "👍 Helpful $1"], [/^✅ まだあった (\d+)$/, "✅ Still there $1"], [/^❌ もうなかった (\d+)$/, "❌ Gone $1"],
  [/^🌙 表示：自動$/, "🌙 Theme: Auto"], [/^🌙 表示：ライト$/, "🌙 Theme: Light"], [/^🌙 表示：ダーク$/, "🌙 Theme: Dark"],
];
function tr(s) {
  const t = s.trim();
  if (!t || !/[ぁ-んァ-ン一-龥]/.test(t)) return null;
  if (D[t]) return s.replace(t, D[t]);
  for (const [re, to] of P) if (re.test(t)) return to == null ? null : s.replace(t, t.replace(re, to));
  return null;
}
function walk(root) {
  if (root.nodeType === 3) { const v = tr(root.nodeValue); if (v != null) root.nodeValue = v; return; }
  if (root.nodeType !== 1) return;
  if (root.matches?.(".note, .addr, [data-no-tr]")) return; // みんなが書いた文は変えない
  for (const a of ["placeholder", "aria-label", "title"]) {
    const v = root.getAttribute?.(a);
    if (v) { const n = tr(v); if (n != null) root.setAttribute(a, n); }
  }
  if (root.tagName === "INPUT" || root.tagName === "TEXTAREA") return;
  for (const c of root.childNodes) walk(c);
}
export function startI18n() {
  if (getLang() !== "en") return;
  document.documentElement.lang = "en";
  walk(document.body);
  // 新しく出てきた部分も英語にする
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === "characterData") { const v = tr(m.target.nodeValue); if (v != null && v !== m.target.nodeValue) m.target.nodeValue = v; }
      else m.addedNodes.forEach(walk);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
}

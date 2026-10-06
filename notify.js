// ★ OneSignalによるプッシュ通知の共通処理。talkScript.js / appScript.js から import して使う。
//   APIキーは imgbb と同じく Firestore の system_keys/{KEY_DOC_ID} に保存する:
//     { appId: "OneSignalのApp ID", restApiKey: "OneSignalのREST APIキー" }
//   ★ サイトごとにOneSignalのアプリを分ける場合は、ここのドキュメントIDだけをサイトごとに変える
//     （チャットサイト: "onesignal" / 問題投稿サイト: "onesignal_ProblemPosting"）
const KEY_DOC_ID = "onesignal";

let keysCache = null;
let initPromise = null;
let initError = null;      // 直近の初期化エラー（iPhoneではConsoleが見られないので画面に出す用）
let ctx = null;            // { db, userId }（再試行用）
let initStep = "";         // 初期化のどの段階か（エラー表示用）

async function loadKeys(db) {
  if (keysCache) return keysCache;
  const snap = await db.collection("system_keys").doc(KEY_DOC_ID).get();
  if (!snap.exists) throw new Error(`Firestoreの system_keys/${KEY_DOC_ID} が見つかりません。`);
  const data = snap.data();
  if (!data.appId || !data.restApiKey) throw new Error(`system_keys/${KEY_DOC_ID} に appId / restApiKey がありません。`);
  keysCache = data;
  return keysCache;
}

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(typeof message === "function" ? message() : message)), ms))
  ]);
}

// ★ ログイン後に1回呼ぶ。OneSignalを初期化し、Firebaseのユーザー名(userId)と端末を紐づける
export function initPush(db, userId) {
  ctx = { db, userId };
  if (initPromise) return initPromise;
  initError = null;
  initPromise = (async () => {
    initStep = "Firestoreからキーを取得中";
    const { appId } = await loadKeys(db);
    // GitHub Pagesのサブパス公開でも動くよう、現在のページのフォルダをService Workerの範囲にする
    const base = location.pathname.replace(/[^/]*$/, "");
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    const sdkReady = new Promise((resolve, reject) => {
      window.OneSignalDeferred.push(async (OneSignal) => {
        try {
          initStep = "OneSignalの初期化中（Service Workerの登録など）";
          await OneSignal.init({
            appId,
            serviceWorkerPath: base + "OneSignalSDKWorker.js",
            serviceWorkerParam: { scope: base },
            allowLocalhostAsSecureOrigin: true,
            notifyButton: { enable: false }
          });
          initStep = "ユーザーの紐づけ中";
          await OneSignal.login(userId);
          initStep = "";
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
    await withTimeout(sdkReady, 15000, () => "OneSignalの準備が終わりませんでした。\n止まった段階: " + (initStep || "SDKの読み込み待ち（SDKが読み込めていない可能性）"));
  })().catch((e) => {
    initError = e;
    initPromise = null;   // 次回押したときに再試行できるようにする
    console.warn("プッシュ通知の初期化に失敗:", e);
  });
  return initPromise;
}

// ★ ログアウト前に呼ぶ（この端末に前のユーザー宛の通知が届き続けないようにする）
export async function logoutPush() {
  try {
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    await new Promise((resolve) => {
      window.OneSignalDeferred.push(async (OneSignal) => {
        try { await OneSignal.logout(); } catch (e) { console.warn(e); }
        resolve();
      });
      setTimeout(resolve, 3000); // 初期化されていない場合に固まらないように
    });
  } catch (e) {
    console.warn(e);
  }
}

// ★ この端末が実際にOneSignalで購読済みかどうかを取得する
function getSubscription() {
  window.OneSignalDeferred = window.OneSignalDeferred || [];
  return withTimeout(new Promise((resolve, reject) => {
    window.OneSignalDeferred.push(async (OneSignal) => {
      try {
        resolve({
          optedIn: !!OneSignal.User.PushSubscription.optedIn,
          id: OneSignal.User.PushSubscription.id || ""
        });
      } catch (e) {
        reject(e);
      }
    });
  }), 5000, "購読状態を取得できませんでした。");
}

// ★ 現在の通知許可状態（true/false）
export function isPushEnabled() {
  return typeof Notification !== "undefined" && Notification.permission === "granted";
}

// ★ 「通知をオンにする」ボタンの初期化（talk.html / app.html 共通）
//   ボタンは「実際に購読まで完了したとき」だけ隠す（許可済みでも登録が未完了なら再試行できるようにする）
export function setupPushButton(buttonId) {
  const btn = document.getElementById(buttonId);
  if (!btn || btn.dataset.pushBound) return;
  btn.dataset.pushBound = "1";
  const defaultText = btn.textContent;

  // ★ .normal-button の display:block が .hidden より後に定義されていて .hidden が効かないため、
  //   このボタンの表示/非表示は inline style で直接切り替える
  const setVisible = (visible) => { btn.style.display = visible ? "" : "none"; };

  const say = async (msg) => {
    if (window.AppDialog) await window.AppDialog.alert(msg);
    else alert(msg);
  };

  const updateVisibility = async () => {
    try {
      if (!isPushEnabled()) { setVisible(true); return; }
      if (initPromise) await initPromise;
      const sub = await getSubscription();
      setVisible(!sub.optedIn);
      if (!sub.optedIn) btn.textContent = "通知の登録をやり直す";
    } catch (e) {
      console.warn(e);
      setVisible(true);
      btn.textContent = "通知の登録をやり直す";
    }
  };
  updateVisibility();

  btn.addEventListener("click", async () => {
    if (typeof Notification === "undefined") {
      await say("この環境では通知を利用できません。\niPhoneの場合は、Safariの共有ボタンから「ホーム画面に追加」して、追加したアイコンから開いてください。");
      return;
    }
    if (Notification.permission === "denied") {
      await say("通知がブロックされています。\n端末（またはブラウザ）の設定から、このサイトの通知を許可してください。");
      return;
    }

    btn.disabled = true;
    let subscribed = false;
    try {
      // ① ユーザー操作の直後に、まずブラウザ標準の許可ダイアログを出す（iOSはこの順序が重要）
      if (Notification.permission !== "granted") {
        btn.textContent = "許可を確認中...";
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          await say("通知が許可されませんでした。");
          return;
        }
      }

      // ② OneSignal側の初期化を待つ（前回失敗していれば再試行）
      btn.textContent = "OneSignalを準備中...";
      if (!initPromise && ctx) initPush(ctx.db, ctx.userId);
      if (initPromise) await initPromise;
      if (initError) throw initError;

      // ③ この端末を購読状態にする
      btn.textContent = "購読を登録中...";
      window.OneSignalDeferred = window.OneSignalDeferred || [];
      await withTimeout(new Promise((resolve, reject) => {
        window.OneSignalDeferred.push(async (OneSignal) => {
          try {
            await OneSignal.User.PushSubscription.optIn();
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      }), 15000, "購読の登録が終わりませんでした（optIn待ち）。");

      const sub = await getSubscription();
      subscribed = sub.optedIn;

      // ★ ダイアログを出す前にボタンの見た目を確定させる
      btn.disabled = false;
      setVisible(!subscribed);
      btn.textContent = isPushEnabled() ? "通知の登録をやり直す" : defaultText;

      await say(subscribed
        ? "通知をオンにしました。"
        : "許可はされましたが、購読の登録が完了していません。\nもう一度ボタンを押してください。");
    } catch (e) {
      console.error(e);
      btn.disabled = false;
      setVisible(true);
      btn.textContent = isPushEnabled() ? "通知の登録をやり直す" : defaultText;
      await say("通知の設定に失敗しました。\n\n" + (e && e.message ? e.message : String(e)));
    } finally {
      // 途中で return した場合（許可されなかった等）の後始末
      btn.disabled = false;
      if (!subscribed) {
        setVisible(true);
        btn.textContent = isPushEnabled() ? "通知の登録をやり直す" : defaultText;
      }
    }
  });
}

// ★ OneSignalのREST APIで、指定したユーザーID宛に通知を1件送る（内部共通処理）
async function postNotification({ appId, restApiKey, ids, title, body, url, topic }) {
  const payload = {
    app_id: appId,
    target_channel: "push",
    include_aliases: { external_id: ids },
    headings: { en: title, ja: title },
    contents: { en: body, ja: body },
    url
  };
  if (topic) payload.web_push_topic = topic;   // 同じトピックの通知は最新1件にまとまる

  const res = await fetch("https://api.onesignal.com/notifications", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Authorization": `Key ${restApiKey}`
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) console.warn("通知送信エラー:", res.status, await res.text());
}

// ★ 特定のユーザー宛に、任意のタイトル・本文で通知を送る（アンケート回答の通知など）。
//   失敗しても呼び出し元の処理には影響させない
export async function sendPushToUsers(db, { targetIds, title, body, url, topic }) {
  try {
    const ids = (targetIds || []).filter(Boolean);
    if (ids.length === 0) return;
    const { appId, restApiKey } = await loadKeys(db);
    const absoluteUrl = new URL(url || "", location.href).href;
    await postNotification({ appId, restApiKey, ids, title, body, url: absoluteUrl, topic });
  } catch (e) {
    console.warn("通知送信に失敗:", e);
  }
}

// ★ プロフィールを変更したことを、サイトの全ユーザー（変更した本人は除く）へ通知する。
//   宛先は Firestore の users_random コレクションの全ドキュメントID（isActive が false の人は除く）。
//   失敗しても呼び出し元の処理には影響させない
export async function sendProfileChangeNotification(db, { senderId, userName }) {
  try {
    const snapshot = await db.collection("users_random").get();
    const ids = snapshot.docs
      .filter((doc) => (doc.data() || {}).isActive !== false)
      .map((doc) => doc.id)
      .filter((id) => id !== senderId);
    await sendPushToUsers(db, {
      targetIds: ids,
      title: "プロフィール変更",
      body: `${userName}がプロフィールを変更しました`,
      url: "app.html#home"
    });
  } catch (e) {
    console.warn("プロフィール変更の通知に失敗:", e);
  }
}

// ★ 新着メッセージを、ルームのメンバー（送信者本人を除く）へ通知する。
//   タイトル: 「トークルーム名|送信者名」
//   本文    : 通常は「メッセージ内容」、返信なら「〇〇に返信しました－メッセージ内容」
//             （返信先が受信者本人なら「あなたに返信しました－メッセージ内容」）
//   失敗してもメッセージ送信自体には影響させない（エラーは握りつぶす）
export async function sendMessageNotification(db, { roomId, roomTitle, memberIds, senderId, senderName, text, replyToUserId, replyToName }) {
  try {
    const targets = (memberIds || []).filter((id) => id && id !== senderId);
    if (targets.length === 0) return;

    const { appId, restApiKey } = await loadKeys(db);
    const content = (text || "").replace(/\s+/g, " ").trim().slice(0, 80) || "メッセージが届きました";
    const url = new URL(`app.html#talk_${encodeURIComponent(roomId)}`, location.href).href;   // ★ SPA：トーク画面は app.html#talk_ルームID
    const title = roomTitle
      ? `${roomTitle}|${senderName || "不明なユーザー"}`
      : (senderName || "不明なユーザー");   // ★ 個人トークはルーム名が無いので送信者名だけ

    // 宛先ごとの本文を決める（返信先の本人だけ「あなたに」になる）
    const groups = []; // { ids: [...], body: "..." }
    if (replyToUserId) {
      const replied = targets.filter((id) => id === replyToUserId);
      const others = targets.filter((id) => id !== replyToUserId);
      if (replied.length) groups.push({ ids: replied, body: `あなたに返信しました－${content}` });
      if (others.length) groups.push({ ids: others, body: `${replyToName || replyToUserId}に返信しました－${content}` });
    } else {
      groups.push({ ids: targets, body: content });
    }

    await Promise.all(groups.map((group) =>
      postNotification({ appId, restApiKey, ids: group.ids, title, body: group.body, url, topic: roomId })
    ));
  } catch (e) {
    console.warn("通知送信に失敗（CORSの可能性あり）:", e);
  }
}

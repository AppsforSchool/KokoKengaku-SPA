// ★ SPA 共通モジュール。app.html の中で「トーク一覧」と「トーク画面」が共有するものをここにまとめる。
//   Firebase の初期化・ログイン中ユーザー・ユーザー情報キャッシュ・ヘッダー/ドロワー・プロフィール・
//   ローディングオーバーレイなど。ページ遷移せず画面を切り替えても、これらは作り直されない。
import { logoutPush, sendProfileChangeNotification } from "./notify.js";

const firebaseConfig = {
  apiKey: "AIzaSyAqIiNj0N4WruPSOkWbeo5gxzsNyeMkuLo",
  authDomain: "appsforschool-study.firebaseapp.com",
  projectId: "appsforschool-study",
  storageBucket: "appsforschool-study.firebasestorage.app",
  messagingSenderId: "740735293440",
  appId: "1:740735293440:web:982702b6d53aaa18ec60e5"
};

// Firebase 初期化とサービス取得
export const app = firebase.initializeApp(firebaseConfig);
export const auth = firebase.auth();
export const db = firebase.firestore();

// ★ ログイン中ユーザー（他のモジュールには live binding で見える。書き換えは setMe 経由のみ）
export let myUid = "";
export let myUserId = "";
export let meIsAdmin = false;
export function setMe({ uid, userId, isAdmin }) {
  myUid = uid || "";
  myUserId = userId || "";
  meIsAdmin = !!isAdmin;
}

// ★ プロフィールを保存したときに呼ばれる関数の登録先
export const profileSavedListeners = [];

// ★ Firestoreのタイムスタンプ(またはミリ秒数値)を、比較に使いやすいミリ秒数値へ揃える
export function toMillisOrNull(value) {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value === "number") return value;
  return null;
}

// ★ 景品(名前が虹色に光る演出)の持続時間。「問題投稿」アプリ側の仕様に合わせて10分間
export const PRIZE_DURATION_MS = 10 * 60 * 1000;

// ★ 景品が、付与されてからまだ持続時間内（＝現在も有効）かどうか
export function hasActivePrize(cached) {
  const grantedAt = cached && cached.prizeGrantedAt;
  return typeof grantedAt === "number" && grantedAt + PRIZE_DURATION_MS > Date.now();
}

let userDataCache = {};
export function getUserCache(userId) {
  return userDataCache[userId] || null;
}
export function setUserCache(userId, data) {
  const normalized = Object.assign({}, data);
  if ("prizeGrantedAt" in normalized) {
    normalized.prizeGrantedAt = toMillisOrNull(normalized.prizeGrantedAt);
  }
  userDataCache[userId] = Object.assign({}, userDataCache[userId] || {}, normalized);
  return userDataCache[userId];
}

// ★ アバターの頭文字を安全に取り出すヘルパー
export function getInitial(name) {
  if (!name) return "?";
  return Array.from(name.trim())[0] || "?";
}

// ★ 頭文字アバター、または画像アバターを生成するヘルパー（size: "small" | "large" | 省略で通常サイズ）
export function createAvatar(name, size, imageUrl) {
  if (imageUrl) {
    const img = document.createElement("img");
    img.classList.add("avatar-circle");
    if (size === "small") img.classList.add("small");
    if (size === "large") img.classList.add("large");
    img.src = imageUrl;
    img.alt = name || "";
    return img;
  }
  const avatar = document.createElement("div");
  avatar.classList.add("avatar-circle");
  if (size === "small") avatar.classList.add("small");
  if (size === "large") avatar.classList.add("large");
  avatar.textContent = getInitial(name);
  return avatar;
}


// ★ ImgBBへの画像アップロード共通処理（チャット画像・プロフィール・グループアイコン共通）
let imgbbApiKeyCache = null;
export async function uploadImageToImgbb(file) {
  if (!imgbbApiKeyCache) {
    const keyDoc = await db.collection("system_keys").doc("imgbb").get();
    if (!keyDoc.exists) {
      throw new Error("APIキーの設定が見つかりません。セキュリティルールかドキュメントを確認してください。");
    }
    imgbbApiKeyCache = keyDoc.data().apiKey;
  }

  const formData = new FormData();
  formData.append("image", file);

  const response = await fetch(`https://api.imgbb.com/1/upload?key=${imgbbApiKeyCache}`, {
    method: "POST",
    body: formData
  });

  const result = await response.json();
  if (!result.success) {
    throw new Error("ImgBBのアップロード処理に失敗しました。");
  }
  return result.data.url;
}

// ================================
// ★ ローディングオーバーレイ（一覧・トーク共通）
// ================================
const loadingOverlay = document.getElementById("loading-overlay");
const loadingOverlayText = document.getElementById("loading-overlay-text");
const loadingProgressBarFill = document.getElementById("loading-progress-bar-fill");
const loadingOverlaySkipButton = document.getElementById("loading-overlay-skip-button");
const noActiveOverlay = document.getElementById("no-active-overlay");

// 段階テキストと進捗バー（0〜100）をまとめて更新する
export function setLoadingStage(text, percent) {
  if (loadingOverlayText) loadingOverlayText.textContent = text;
  if (loadingProgressBarFill && typeof percent === "number") {
    const clamped = Math.max(0, Math.min(100, percent));
    loadingProgressBarFill.style.width = `${clamped}%`;
  }
}
// オーバーレイを（再び）表示する。画面を切り替えるたびに進捗表示を初期状態に戻す
export function showLoadingOverlay(text, percent = 0) {
  loadingOverlaySkipButton.classList.add("hidden");
  setLoadingStage(text, percent);
  loadingOverlay.classList.remove("hidden");
}
export function hideLoadingOverlay() {
  loadingOverlay.classList.add("hidden");
  loadingOverlaySkipButton.classList.add("hidden");
}
export function setLoadingOverlayText(text) {
  if (loadingOverlayText) loadingOverlayText.textContent = text;
}
export function setLoadingProgressFull() {
  if (loadingProgressBarFill) loadingProgressBarFill.style.width = "100%";
}
export function setSkipButtonVisible(visible) {
  loadingOverlaySkipButton.classList.toggle("hidden", !visible);
}
export function onSkipButtonClick(handler) {
  loadingOverlaySkipButton.addEventListener("click", handler);
}
// アカウント停止中の表示
export function showNoActiveOverlay() {
  loadingOverlay.classList.add("hidden");
  noActiveOverlay.classList.remove("hidden");
}

// ================================
// ★ ヘッダー高さ（トーク画面の #head-area をスマホで固定表示するために --header-height へ反映）
// ================================
function updateHeaderHeightVar() {
  const header = document.getElementById("app-header");
  if (header) {
    document.documentElement.style.setProperty("--header-height", header.offsetHeight + "px");
  }
}
updateHeaderHeightVar();
window.addEventListener("resize", updateHeaderHeightVar);
{
  const header = document.getElementById("app-header");
  if (header && window.ResizeObserver) {
    new ResizeObserver(() => updateHeaderHeightVar()).observe(header);
  }
}

// ================================
// ★ アカウント設定ドロワー
// ================================
const drawerOverlay = document.getElementById("drawerOverlay");
const accountSettingsDrawer = document.getElementById("accountSettingsDrawer");
const drawerCloseButton = document.getElementById("drawerCloseButton");
const accountSettingsButton = document.getElementById("setting-button");
export const drawerUserId = document.getElementById("drawerUserId");
export const drawerUsername = document.getElementById("drawerUsername");
const drawerLogoutButton = document.getElementById("logout-button");
const drawerEditProfileButton = document.getElementById("drawer-edit-profile-button");

export function openDrawer() {
  accountSettingsDrawer.classList.add("is-open");
  drawerOverlay.classList.add("is-open");
}
export function closeDrawer() {
  accountSettingsDrawer.classList.remove("is-open");
  drawerOverlay.classList.remove("is-open");
}

const handleLogout = async () => {
  const isConfirmed = await AppDialog.confirm("ログアウトしますか？");
  if (isConfirmed) {
    try {
      await logoutPush(); // ★ この端末への通知紐づけを解除
      await auth.signOut(auth);
      console.log("ログアウトしました！");
      await AppDialog.alert("ログアウトしました。");
    } catch (error) {
      console.error("ログアウトエラー:", error);
      await AppDialog.alert("ログアウトに失敗しました。");
    }
  }
};

accountSettingsButton.addEventListener("click", openDrawer);
drawerCloseButton.addEventListener("click", closeDrawer);
drawerOverlay.addEventListener("click", closeDrawer);
drawerLogoutButton.addEventListener("click", handleLogout);
// ドロワー内の「プロフィールをみる」ボタン
drawerEditProfileButton.addEventListener("click", () => {
  closeDrawer();
  openProfileModal(myUserId, false); // 自分のプロフィールを表示するだけ（編集モードにはしない）
});

// ================================
// ★ シェアモーダル
// ================================
{
  const shareModalBtn = document.getElementById("share-modal-btn");
  const shareModal = document.getElementById("share-modal");
  const shareModalClose = document.getElementById("share-modal-close");
  shareModalBtn.addEventListener("click", () => shareModal.classList.remove("hidden"));
  shareModalClose.addEventListener("click", () => shareModal.classList.add("hidden"));
}

// ================================
// ★ プロフィールモーダル
// ================================
let profileModal;
let profileModalClose;
let profileAvatarWrap;
let profileAvatarHolder;
let profileAvatarInput;
let profileAvatarRemoveButton;
let profileName;
let profileNameInput;
let profileText;
let profileTextEdit;
let profileEditButton;
let profileCancelButton;
let isProfileEditing = false;
let currentProfileUserId = "";
let canEditCurrentProfile = false; // 現在開いているプロフィールが自分（or管理者権限で）編集可能か
let profileAvatarCurrentUrl = ""; // Firestoreに保存されている現在の画像URL
let profileAvatarFile = null; // 新しく選択された未アップロードの画像ファイル
let profileAvatarRemoved = false; // 「画像を削除」が押されたかどうか

document.addEventListener("DOMContentLoaded", () => {
  profileModal = document.getElementById("profile-modal");
  profileModalClose = document.getElementById("profile-modal-close");
  profileAvatarWrap = document.querySelector(".profile-avatar-wrap");
  profileAvatarHolder = document.getElementById("profile-avatar-holder");
  profileAvatarInput = document.getElementById("profile-avatar-input");
  profileAvatarRemoveButton = document.getElementById("profile-avatar-remove-button");
  profileName = document.getElementById("profile-name");
  profileNameInput = document.getElementById("profile-name-input");
  profileText = document.getElementById("profile-text");
  profileTextEdit = document.getElementById("profile-text-edit");
  profileEditButton = document.getElementById("profile-edit-button");
  profileCancelButton = document.getElementById("profile-cancel-button");

  profileModalClose.addEventListener("click", () => {
    profileModal.classList.add("hidden");
    resetProfileEditMode();
  });

  profileEditButton.addEventListener("click", handleProfileEditOrSave);
  profileCancelButton.addEventListener("click", () => {
    resetProfileEditMode();
  });

  // アイコンをタップ（編集モード中のみ有効）→ ファイル選択を開く
  profileAvatarHolder.addEventListener("click", () => {
    if (!isProfileEditing || !canEditCurrentProfile) return;
    profileAvatarInput.click();
  });

  // ファイルが選択されたらプレビューに反映（アップロードは保存時にまとめて行う）
  profileAvatarInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    profileAvatarFile = file;
    profileAvatarRemoved = false;

    const reader = new FileReader();
    reader.onload = (event) => {
      profileAvatarHolder.innerHTML = "";
      const img = document.createElement("img");
      img.classList.add("avatar-circle", "large");
      img.src = event.target.result;
      profileAvatarHolder.appendChild(img);
      profileAvatarRemoveButton.classList.remove("hidden");
    };
    reader.readAsDataURL(file);
  });

  // 「画像を削除」→ プレビューを頭文字アバターに戻し、保存時に画像を消去
  profileAvatarRemoveButton.addEventListener("click", () => {
    profileAvatarFile = null;
    profileAvatarRemoved = true;
    profileAvatarInput.value = "";

    profileAvatarHolder.innerHTML = "";
    const nameForInitial = isProfileEditing ? profileNameInput.value : profileName.textContent;
    profileAvatarHolder.appendChild(createAvatar(nameForInitial, "large"));
    profileAvatarRemoveButton.classList.add("hidden");
  });
});

// 編集モードをリセットする関数
function resetProfileEditMode() {
  isProfileEditing = false;
  if (profileEditButton) {
    profileEditButton.textContent = "プロフィールを編集";
    profileEditButton.disabled = false;
  }
  if (profileCancelButton) profileCancelButton.classList.add("hidden");
  if (profileName) profileName.classList.remove("hidden");
  if (profileNameInput) profileNameInput.classList.add("hidden");
  if (profileText) profileText.classList.remove("hidden");
  if (profileTextEdit) profileTextEdit.classList.add("hidden");

  // アバターの編集用UIも隠し、未保存の変更があれば元の状態に戻す
  if (profileAvatarWrap) profileAvatarWrap.classList.remove("editable");
  if (profileAvatarRemoveButton) profileAvatarRemoveButton.classList.add("hidden");
  profileAvatarFile = null;
  profileAvatarRemoved = false;
  if (profileAvatarHolder && profileName) {
    profileAvatarHolder.innerHTML = "";
    profileAvatarHolder.appendChild(createAvatar(profileName.textContent, "large", profileAvatarCurrentUrl));
  }
}

// 編集ボタン・保存ボタンが押された時の処理
async function handleProfileEditOrSave() {
  if (!isProfileEditing) {
    isProfileEditing = true;
    profileEditButton.textContent = "プロフィールを保存";
    if (profileCancelButton) profileCancelButton.classList.toggle("hidden", !canEditCurrentProfile);

    // 現在のキャッシュからテキストを取得する
    const cached = getUserCache(currentProfileUserId) || {};
    const currentName = cached.name || "";
    const currentText = cached.profileText || "";

    profileName.classList.add("hidden");
    profileNameInput.classList.remove("hidden");
    profileNameInput.value = currentName;

    profileText.classList.add("hidden");
    profileTextEdit.classList.remove("hidden");
    profileTextEdit.value = currentText;

    // アイコンをタップして変更できるようにする（自分／管理者のみ）
    if (canEditCurrentProfile) {
      profileAvatarWrap.classList.add("editable");
      if (profileAvatarCurrentUrl) {
        profileAvatarRemoveButton.classList.remove("hidden");
      }
    }

  } else {
    const newName = profileNameInput.value.trim();
    const newProfileText = profileTextEdit.value.trim();

    if (!newName) {
      await AppDialog.alert("ユーザーネームを入力してください。");
      return;
    }

    profileEditButton.disabled = true;
    profileEditButton.textContent = "保存中...";

    try {
      // アイコン画像の変更があれば、先にアップロード（または削除）を確定させる
      let finalImageUrl = profileAvatarCurrentUrl;
      if (profileAvatarFile) {
        profileEditButton.textContent = "画像をアップロード中...";
        finalImageUrl = await uploadImageToImgbb(profileAvatarFile);
      } else if (profileAvatarRemoved) {
        finalImageUrl = "";
      }

      profileEditButton.textContent = "保存中...";

      await db.collection("users_random").doc(currentProfileUserId).set(
        {
          name: newName,
          profileText: newProfileText,
          imageUrl: finalImageUrl
        },
        { merge: true }
      );

      // キャッシュ情報の更新（name / isAdmin / imageUrl / profileText / prizeGrantedAt を一括で最新化）
      const previousCache = getUserCache(currentProfileUserId) || {};
      const updated = setUserCache(currentProfileUserId, {
        name: newName,
        isAdmin: previousCache.isAdmin || false,
        imageUrl: finalImageUrl,
        profileText: newProfileText,
        prizeGrantedAt: previousCache.prizeGrantedAt
      });

      // ★ 自分自身のプロフィールを編集した場合のみ、ドロワーの表示名も更新する
      if (currentProfileUserId === myUserId) {
        drawerUsername.textContent = newName;
      }

      profileName.textContent = newName;
      profileText.textContent = newProfileText || "ステータスメッセージはありません。";

      profileAvatarCurrentUrl = finalImageUrl;
      profileAvatarFile = null;
      profileAvatarRemoved = false;
      profileAvatarHolder.innerHTML = "";
      profileAvatarHolder.appendChild(createAvatar(newName, "large", updated.imageUrl));

      profileName.classList.toggle("admin", !!updated.isAdmin);
      profileName.classList.toggle("prize", !updated.isAdmin && hasActivePrize(updated));

      sendProfileChangeNotification(db, { senderId: myUserId, userName: newName }); // ★ 全員へ通知（待たない）
      profileSavedListeners.forEach((fn) => { try { fn(currentProfileUserId); } catch (e) { console.warn(e); } }); // ★ 一覧やトーク画面の表示名・アイコンを更新
      resetProfileEditMode();
      await AppDialog.alert("プロフィールを保存しました。");
    } catch (error) {
      console.error("プロフィール保存エラー:", error);
      await AppDialog.alert("プロフィールの保存に失敗しました: " + error.message);
      profileEditButton.disabled = false;
      profileEditButton.textContent = "プロフィールを保存";
    }
  }
}

// プロフィールモーダルを開いてFirebaseから最新のステメ等を取得する関数
// startEditModeがtrueの場合、ダイレクトに編集可能なテキストエリア等を開く
export async function openProfileModal(userId, startEditMode = false) {
  currentProfileUserId = userId;
  canEditCurrentProfile = meIsAdmin || userId === myUserId;
  resetProfileEditMode();

  // ★ キャッシュがあれば先にそれを表示し（体感速度優先）、裏で最新データに更新する
  const cached = getUserCache(userId);
  const hasCachedProfileText = !!cached && cached.profileText !== undefined;
  profileName.textContent = (cached && cached.name) || "取得中...";
  profileName.classList.toggle("admin", !!(cached && cached.isAdmin));
  profileName.classList.toggle("prize", !!cached && !cached.isAdmin && hasActivePrize(cached));
  profileText.textContent = hasCachedProfileText
    ? (cached.profileText || "ステータスメッセージはありません。")
    : "取得中...";
  profileAvatarCurrentUrl = (cached && cached.imageUrl) || "";

  profileAvatarHolder.innerHTML = "";
  profileAvatarHolder.appendChild(createAvatar(profileName.textContent, "large", profileAvatarCurrentUrl));

  profileEditButton.classList.toggle("hidden", !canEditCurrentProfile);
  profileModal.classList.remove("hidden");

  // ★ すでにステータスメッセージまでキャッシュ済みなら、Firestoreへは再取得しに行かない
  if (hasCachedProfileText) {
    if (canEditCurrentProfile && startEditMode) {
      handleProfileEditOrSave();
    }
    return;
  }

  try {
    const userSnapshot = await db.collection("users_random").doc(userId).get();
    if (userSnapshot.exists) {
      const userData = userSnapshot.data();

      // ★ ユーザーデータをまとめてキャッシュに反映
      const updated = setUserCache(userId, {
        name: userData.name || "名前未設定",
        isAdmin: userData.isAdmin || false,
        imageUrl: userData.imageUrl || "",
        profileText: userData.profileText || "",
        prizeGrantedAt: userData.prizeGrantedAt
      });

      profileName.textContent = updated.name;
      profileName.classList.toggle("admin", !!updated.isAdmin);
      profileName.classList.toggle("prize", !updated.isAdmin && hasActivePrize(updated));
      profileText.textContent = updated.profileText || "ステータスメッセージはありません。";
      profileAvatarCurrentUrl = updated.imageUrl || "";

      profileAvatarHolder.innerHTML = "";
      profileAvatarHolder.appendChild(createAvatar(profileName.textContent, "large", profileAvatarCurrentUrl));

      // ドロワーから来たなどの場合は即座に編集モードに移行する
      if (canEditCurrentProfile && startEditMode) {
        handleProfileEditOrSave();
      }
    } else {
      profileName.textContent = "不明なユーザー";
      profileText.textContent = "";
    }
  } catch (error) {
    console.error("プロフィール取得エラー:", error);
    profileName.textContent = "エラー";
    profileText.textContent = "プロフィールの取得に失敗しました。";
  }
}





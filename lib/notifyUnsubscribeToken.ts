import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

// 通知メール内の「配信通知をすべて停止する」リンク用トークン。ログインしていない
// 状態（メールを別端末・別ブラウザで開いた場合等）でもワンクリックで解除できるように、
// user_idをHMAC-SHA256で署名したトークンをURLに埋め込む（業界標準的な手法）。
// "unsubscribe:"というpurposeプレフィックスを含めて署名することで、将来他の
// 用途で同じ秘密鍵を使った署名リンクを作っても、トークンの使い回しができないようにする。
function secret(): string {
  const s = process.env.NOTIFY_UNSUBSCRIBE_SECRET;
  if (!s) throw new Error("NOTIFY_UNSUBSCRIBE_SECRET が未設定です。");
  return s;
}

export function signUnsubscribeToken(userId: string): string {
  const payload = `unsubscribe:${userId}`;
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

// トークンが指定userIdに対する正当な署名か検証する。タイミング攻撃を避けるため
// timingSafeEqualで比較する（文字列長が異なる場合は即falseにする）。
export function verifyUnsubscribeToken(userId: string, token: string): boolean {
  const expected = signUnsubscribeToken(userId);
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

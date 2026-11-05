// 秘密の値（cronの共有シークレット・管理画面のトークン）を比べる（2026-11-05導入）。
//
// `a !== b` は先頭から1文字ずつ比べて、違った時点で返る。応答時間の差から一致した
// 長さを推測できる（タイミング攻撃）。ネット越しに測るのは難しいが、比べ方を1箇所に
// まとめておけば検査で逆戻りを止められるので、全部ここを通す。
//
// 長さが違うと `timingSafeEqual` は例外を投げる（＝長さが漏れる）ので、先に両方を
// SHA-256 にかけて同じ32バイトにしてから比べる。
// **未設定（空文字・undefined）は常に不一致**（設定漏れで「空と空が一致」して通さない）。
// Node専用（node:crypto）。edge runtime のルートからは import しないこと。
import { createHash, timingSafeEqual } from "node:crypto";

function digest(s: string): Buffer {
  return createHash("sha256").update(s, "utf8").digest();
}

/** 秘密の値どうしを一定時間で比べる。どちらかが空・未設定なら false。 */
export function safeEqual(provided: string | null | undefined, expected: string | null | undefined): boolean {
  if (typeof provided !== "string" || typeof expected !== "string") return false;
  if (provided.length === 0 || expected.length === 0) return false;
  return timingSafeEqual(digest(provided), digest(expected));
}

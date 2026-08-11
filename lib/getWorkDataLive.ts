// 作品1件を Annict から**ライブ取得するだけ**の最小モジュール。
//
// なぜ getWorkData.ts から切り出してあるか（2026-08-07）:
//   `app/anime/[id]/opengraph-image.tsx` は `runtime = "edge"` で動く。
//   Edge runtime のバンドルは自己完結する必要があり（`fs` が無いので実行時に
//   ファイルを読めない）、**動的 import も遅延ロードにならず丸ごとインライン化される**。
//   そのため getWorkData.ts が持つ過去クールのフォールバック
//   （`await import("../content/snapshots/{year}-{season}.json")`）を edge から
//   参照すると、**64ファイル・5.1MB のスナップショットがOG画像の関数に全部入る**。
//
//   実測（ローカル本番ビルド）: `.next/server/app/anime/[id]/opengraph-image/route.js`
//   が **16KB → 5,040KB**。VercelのEdge Functionにはサイズ上限（プランにより1〜4MB）が
//   あるため、これを超えるとデプロイが失敗する。ローカルとGitHub ActionsのCIには
//   サイズ上限が無いので**どちらも緑のまま通り、Vercelだけが落ちる**（PR #41で発生）。
//
// したがって **edge runtime のルートは必ずこちらを使うこと**。
// スナップショットのフォールバックが要るのはNode runtimeのページ／APIだけで、
// OG画像はAnnict障害時に生成できなくても本文の表示には影響しない。
import { fetchWorkById } from "./annict";
import { toAnimeDetail } from "./services";
import { EXTRA_SERVICES } from "@/content/works/extraServices";
import { RELEASE_DATES } from "@/content/works/releaseDates";
import type { AnimeDetail } from "./types";

// トークン未設定なら投げる（呼び出し側が握りつぶすかはそちらの判断）。
// 取得できなければ null。フォールバックは一切行わない。
export async function getWorkDataLive(id: number): Promise<AnimeDetail | null> {
  const token = process.env.ANNICT_TOKEN;
  if (!token) {
    throw new Error("ANNICT_TOKEN が未設定です。プロジェクト直下に .env.local を作り、トークンを設定してください。");
  }
  const w = await fetchWorkById(id, token);
  if (!w) return null;
  return toAnimeDetail(w, EXTRA_SERVICES[id], RELEASE_DATES[id]);
}

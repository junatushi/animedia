import type { Metadata } from "next";

import NotFoundPanel from "@/components/NotFoundPanel";

// ルート未一致のURL用の404。
// **`notFound()` 経由の404はここに来ない**（Next.js 14）。区画ごとに置いた
// `app/*/not-found.tsx` がそちらを担当する。中身は components/NotFoundPanel.tsx が
// 1つだけ持つ。経緯と実測は同ファイルのコメント、docs/operations.md の㊲。

export const metadata: Metadata = {
  title: "ページが見つかりません",
  // 404は本来インデックスされないが、ルートレイアウトが index, follow を宣言している
  // ため、ここで明示的に打ち消しておく（robots メタは404でも出力される）。
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return <NotFoundPanel />;
}

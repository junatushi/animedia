// この区画の notFound() 用の404。
//
// **置き場所は page.tsx と同じ階層でなければ効かない**（Next.js 14.2 で実測）。
// ルートの app/not-found.tsx が拾うのは「どのルートにも一致しなかったURL」だけで、
// ルートに一致したうえで notFound() を呼んだ場合（存在しない作品ID・索引に無い名前・
// 未知のクール名など＝実際に起きる404のほぼ全部）は既定の画面が出る。
// app/<区画>/not-found.tsx（1階層浅い位置）も効かなかった。
// 中身は components/NotFoundPanel.tsx が1つだけ持つ。
// 検査は node scripts/check.ts の「404の境界」節。経緯は docs/operations.md の㊲。
import NotFoundPanel from "@/components/NotFoundPanel";

export default function NotFound() {
  return <NotFoundPanel />;
}

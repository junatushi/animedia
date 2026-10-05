"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import IntentLink from "./IntentLink";
import { previousEntryIs } from "./screenMemory";

// 作品ページの「トップに戻る」「◯年◯期アニメ一覧を見る」（2026-10-05導入）。
//
// 直前に見ていたのがその一覧なら、新しく遷移せず**ブラウザの「戻る」**として動く。
// こうすると:
//   ①一覧は離れた時点の画面（絞り込み・スクロール位置）でそのまま戻ってくる
//   ②Next.js のルーターキャッシュから描き直すので、"/"（RSC 181KB級）を取り直さない
//     ＝Vercelへの要求が0件（無料枠に一切乗らない）
//   ③履歴に「作品ページ → トップ」が積まれないので、そのあと戻るボタンを押しても
//     作品ページへ逆戻りしない
// 直前が一覧でない（検索から作品ページに直接来た・作品を何ページか渡り歩いた）ときは、
// 従来どおりの普通のリンク。中身は IntentLink なので、先読みの方針も変わらない。
// 見た目は作品ページのヘッダーのリンクと同じ "official" に固定している
// （className を受け渡しにすると、CSSの層分けがソースから導出できなくなる＝
// scripts/lib/css-layers.js は className の文字列リテラルを読む）。
type Props = {
  href: string;
  children: ReactNode;
};

export default function BackLink({ href, children }: Props) {
  const router = useRouter();
  return (
    <IntentLink
      href={href}
      className="official"
      onClick={(e) => {
        // 新しいタブで開く操作（Ctrl/⌘クリック・中クリック）は邪魔しない。
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
          return;
        }
        if (!previousEntryIs(href)) return;
        e.preventDefault();
        router.back();
      }}
    >
      {children}
    </IntentLink>
  );
}

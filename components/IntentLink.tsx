"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AnchorHTMLAttributes, ReactNode } from "react";

// サイト内リンクの共通部品（2026-09-03導入）。
//
// 【なぜ next/link を直接使わないか】App Router の <Link> は既定で
// **画面に入った（正確には200px手前まで近づいた）リンクのRSCペイロードを先読みする**。
// このサイトはリンクが多く、しかも1件あたりのペイロードが大きい。ローカル本番ビルドの実測:
//
//   /anime/[id]     … 11.9KB × シーズン一覧に173本
//   /season/[y]/[s] … 181KB（!）× フッターの他クールリンク19本
//   /service/…      … 12.8KB × 12本
//
// つまりシーズン一覧を下までスクロールすると、誰も押していないページのために
// 最大5MB超を裏で取りに行く。ヘッダーの「アニメ視聴ガイド」（"/"）に至っては
// **どのページでも初期表示と同時に181KBの先読みが走っていた**。これは
// ①訪問者の回線と端末を、見ていないページのために使う（表示が遅くなる）
// ②Vercelの Function Invocations・ISR Reads/Writes・転送量を、押されてもいない
//   ページのために消費する（無料枠の3指標のうち Active CPU は2026-09-02実測で
//   既に上限の106%）
// の両方で損をする。
//
// 【代わりに何をするか】先読みは「押しそうな素振り」＝カーソルを載せた・指を触れた
// ときだけ行う。onTouchStart は指を離す（＝クリック確定）より確実に早く発火するので、
// スマホでもタップからページ描画までの前倒しは効く。押されないリンクは1バイトも取らない。
//
// 【この判断が上書きしているもの】app/anime/[id]/page.tsx は「loading.tsx を置くと
// ソフト404になるので置かない。代わりにISR＋先読みで速さを担保する」という方針を
// 採っており（2026-07-27）、その先読みがこれに当たる。**やめるのではなく、
// 全リンクから素振りのあったリンクへ絞る**ことでその方針は維持している。
//
// 使い方: サイト内リンクは必ずこれを使う（next/link を直接importしてよいのはこのファイルだけ。
// scripts/check.ts の「リンクの先読み」節が機械的に見張る）。
type Props = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  children: ReactNode;
};

// 一度先読みしたURLは覚えておき、行ったり来たりで同じ取得を繰り返さない。
const warmed = new Set<string>();

export default function IntentLink({ href, children, onMouseEnter, onTouchStart, ...rest }: Props) {
  const router = useRouter();

  function warm() {
    if (warmed.has(href)) return;
    warmed.add(href);
    try {
      router.prefetch(href);
    } catch {
      // 先読みは「できたら速い」だけの機能なので、失敗しても遷移そのものは動く。
    }
  }

  return (
    <Link
      href={href}
      // 画面内に入っただけでは取りに行かない（このファイル冒頭の理由）。
      prefetch={false}
      onMouseEnter={(e) => {
        warm();
        onMouseEnter?.(e);
      }}
      onTouchStart={(e) => {
        warm();
        onTouchStart?.(e);
      }}
      {...rest}
    >
      {children}
    </Link>
  );
}

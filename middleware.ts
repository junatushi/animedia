import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { malformedRouteStatus } from "@/lib/routeGuard";
import { canonicalQueryTarget } from "@/lib/queryPolicy";
import { rejectedMethodStatus } from "@/lib/methodGuard";

// 形として不正なURLに返す404の本文（ページ向け）。
//
// **なぜ components/NotFoundPanel.tsx を使わないか**（㊴の「404を行き止まりに
// しない」との関係）: ㊴が守っているのは「検索結果や古いリンクから**人が**
// 着地する404」で、そこには次の行き先が要る。一方このURLは `/anime/0x3374` や
// `/season/9999/spring` のような**形が壊れたURL**で、検索結果にも内部リンクにも
// 現れない＝人は辿り着かない（辿り着くのは巡回とクローラーだけ）。
// また middleware は React を描画できないので、Panel をそのまま出す手段が無い。
// それでも行き止まりにはしないよう、トップへのリンクだけは入れておく。
const NOT_FOUND_HTML = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,follow"><title>ページが見つかりません</title></head>
<body style="font-family:system-ui,sans-serif;padding:2rem;line-height:1.7">
<h1>ページが見つかりません</h1>
<p>URLの形が正しくないようです。</p>
<p><a href="/">アニメ視聴ガイドのトップへ</a></p>
</body></html>`;

// 埋め込み（/embed/anime/[id]）向けの400本文。
// `app/embed/anime/[id]/route.ts` の `plain()` と同じ見た目・同じ文言にする
// （middlewareが横取りしても route handler が返すのと区別が付かないように）。
const EMBED_BAD_ID_HTML = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="robots" content="noindex"><title>アニメ視聴ガイド</title></head>
<body style="margin:0;font:13px/1.6 system-ui,sans-serif;color:#5b6472;padding:12px">
作品IDが正しくありません。</body></html>`;

export async function middleware(request: NextRequest) {
  // 【2026-11-05】ページへのPOST・Server Action の要求は、描画させずにここで返す
  // （lib/methodGuard.ts。Next.js 14 に修正版の出ない Server Actions／RSC のPOST経路の
  // 勧告への緩和策で、このサイトは Server Actions を1つも使っていない）。
  const rejected = rejectedMethodStatus(request.method, request.nextUrl.pathname, request.headers);
  if (rejected !== null) {
    return new NextResponse(null, {
      status: rejected,
      headers: { allow: "GET, HEAD, OPTIONS", "cache-control": "no-store" },
    });
  }

  // 【重要】形が不正なURLは、ページ／route handler を描画する**前に**ここで返す。
  // 描画させると Next.js がその応答をISRキャッシュに書き込み、
  // 未見の不正な文字列の数だけ書き込みが増える（Next.js #73101・未修正）。
  // 理由と実測は lib/routeGuard.ts の冒頭。
  //
  // 【2026-09-15修正】どのルートも一律404を返していたため、`/api/work/[id]`・
  // `/embed/anime/[id]` が route handler 自身の契約（400）を6日間破っていた
  // （`scripts/verify-production.sh` のH-3節・Issue #146）。ここで
  // ルートごとの `malformedStatus` に従って出し分ける。
  const status = malformedRouteStatus(request.nextUrl.pathname);
  if (status !== null) {
    const { pathname } = request.nextUrl;

    if (pathname.startsWith("/api/work/")) {
      return NextResponse.json(
        { error: "作品ID（Annict の annictId）を整数で指定してください。" },
        {
          status,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "cache-control": "public, max-age=0, s-maxage=604800",
          },
        }
      );
    }

    if (pathname.startsWith("/embed/anime/")) {
      return new NextResponse(EMBED_BAD_ID_HTML, {
        status,
        headers: {
          "content-type": "text/html; charset=utf-8",
          // route handler 側の同じ失敗（plain()）に合わせ、エッジにも置かない。
          "cache-control": "no-store",
          "x-robots-tag": "noindex",
        },
      });
    }

    return new NextResponse(NOT_FOUND_HTML, {
      status,
      headers: {
        "content-type": "text/html; charset=utf-8",
        // 不正な形のURLは中身が変わらないので、エッジに置いて関数の起動自体を減らす。
        // ISRではないので ISR Writes は増えない。
        "cache-control": "public, max-age=0, s-maxage=604800",
        "x-robots-tag": "noindex, follow",
      },
    });
  }

  // 【2026-11-05】公開の route handler に付いた知らないクエリは、関数を起動する前に落とす
  // （lib/queryPolicy.ts。`?x=<乱数>` でCDNのキャッシュを外して関数を起動させ続けられた）。
  if (request.method === "GET" || request.method === "HEAD") {
    const target = canonicalQueryTarget(request.nextUrl.pathname, request.nextUrl.search);
    if (target !== null) {
      return NextResponse.redirect(new URL(target, request.nextUrl.origin), 308);
    }
  }

  return await updateSession(request);
}

// 静的アセット・画像生成ルートはセッション更新が不要なため除外する。
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};

import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { isMalformedRoutePath } from "@/lib/routeGuard";

// 形として不正なURLに返す404の本文。
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

export async function middleware(request: NextRequest) {
  // 【重要】形が不正なURLは、ページを描画する**前に**ここで返す。
  // 描画させると Next.js がその404をISRキャッシュに書き込み、
  // 未見の不正な文字列の数だけ書き込みが増える（Next.js #73101・未修正）。
  // 理由と実測は lib/routeGuard.ts の冒頭。
  if (isMalformedRoutePath(request.nextUrl.pathname)) {
    return new NextResponse(NOT_FOUND_HTML, {
      status: 404,
      headers: {
        "content-type": "text/html; charset=utf-8",
        // 不正な形のURLは中身が変わらないので、エッジに置いて関数の起動自体を減らす。
        // ISRではないので ISR Writes は増えない。
        "cache-control": "public, max-age=0, s-maxage=604800",
        "x-robots-tag": "noindex, follow",
      },
    });
  }

  return await updateSession(request);
}

// 静的アセット・画像生成ルートはセッション更新が不要なため除外する。
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};

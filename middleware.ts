import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { malformedRouteStatus, unknownNameStatus, type KnownNames } from "@/lib/routeGuard";
import { SERVICES } from "@/lib/services";
import studioIndexJson from "@/content/archive/studios.json";
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

// 名前で引くページの実在する名前（lib/routeGuard.ts の unknownNameStatus）。
// 件数が少ない（配信サービス十数件・制作会社と監督で数百件）ので、起動時に1回だけ作る。
const nonEmptyKeys = (m: Record<string, unknown[]>) => new Set(Object.keys(m).filter((k) => (m[k]?.length ?? 0) > 0));
const KNOWN_NAMES: KnownNames = {
  serviceKeys: new Set(SERVICES.map((s) => s.key)),
  studios: nonEmptyKeys(studioIndexJson.studios as Record<string, unknown[]>),
  directors: nonEmptyKeys(studioIndexJson.directors as Record<string, unknown[]>),
};

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
  const status =
    malformedRouteStatus(request.nextUrl.pathname) ?? unknownNameStatus(request.nextUrl.pathname, KNOWN_NAMES);
  if (status !== null) {
    const { pathname } = request.nextUrl;

    if (pathname.startsWith("/api/work/")) {
      return NextResponse.json(
        { error: "作品ID（Annict の annictId）を整数で指定してください。" },
        {
          status,
          headers: {
            // CORSは付けない（route handler 側と同じ。Annict API利用規約第6条・2026-11-10）。
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
    // クエリは**届いたままの文字列**で見る（request.nextUrl は `?&&&` の空の区切りを落として
    // 正規化した値を返すことがあるが、CDNのキャッシュは届いたままの文字列ごとに分かれる）。
    const rawUrl = request.url;
    const q = rawUrl.indexOf("?");
    const rawSearch = q >= 0 ? rawUrl.slice(q).split("#")[0] : "";
    const target = canonicalQueryTarget(request.nextUrl.pathname, rawSearch);
    if (target !== null) {
      // 公開APIは他サイトの fetch からも呼ばれる（CORS許可）。リダイレクトの応答自体に
      // 許可が無いと、余計なクエリを付ける呼び出し側（jQuery の `_=<時刻>` 等）がCORSエラーになる。
      return new NextResponse(null, {
        status: 308,
        headers: {
          location: new URL(target, request.nextUrl.origin).toString(),
          "access-control-allow-origin": "*",
          "cache-control": "no-store",
        },
      });
    }
  }

  return await updateSession(request);
}

// 静的アセット・画像生成ルートはセッション更新が不要なため除外する。
//
// 【2026-11-05・反証で修正】画像の拡張子で終わるパスを除外しているので、`/anime/abc.png`・
// `/season/2026/x.png` のように**動的ルートに拡張子を付けるだけで middleware を丸ごと迂回**でき、
// 上の判定（形の不正・POSTの拒否・季節）を全部すり抜けて描画とISRへの書き込みが起きていた。
// 動的ルートと窓口の接頭辞は拡張子に関係なく必ず通す（2つ目以降。どれか1つに一致すれば走る）。
// `_vercel`（Web Analytics の送信先）は Vercel 自身の窓口なので除外する。
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|_vercel|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
    "/anime/:path*",
    "/season/:path*",
    "/rankings/:path*",
    "/exclusive/:path*",
    "/service/:path*",
    "/person/:path*",
    "/studio/:path*",
    "/director/:path*",
    "/embed/:path*",
    "/api/:path*",
  ],
};

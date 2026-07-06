import { ImageResponse } from "next/og";
import { loadGoogleFont } from "@/lib/ogFont";

// SNS（X/LINE等）でURLを共有した時のリンクカード画像。
// Next.js の File-based Metadata 規約により、この場所に置くだけで
// og:image / twitter:image として自動的に埋め込まれる。
export const runtime = "edge";
// Google Fonts への外部通信を伴うため、ビルド時の静的生成では実行せずリクエスト時に生成する。
export const dynamic = "force-dynamic";
export const alt = "アニメ視聴ガイド ― 今期アニメの配信状況をサービス別にスキャン";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const TITLE = "アニメ視聴ガイド";
const TAGLINE = "配信状況をサービス別にスキャン";

// og:image URL にはクエリが渡らない（クローラーはクエリ無しで取得する）ため、
// 共有された「今」のシーズンを画像生成時のサーバー日付から算出して見出しに使う。
// 共有の大半は今期なのでこれで十分実用的で、毎シーズン自動で更新される。
function currentSeasonHeadline(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const label = m <= 3 ? "冬" : m <= 6 ? "春" : m <= 9 ? "夏" : "秋";
  return `${y}年 ${label}アニメ`;
}

export default async function OpengraphImage() {
  const headline = currentSeasonHeadline();
  const fontData = await loadGoogleFont(TITLE + TAGLINE + headline + "年アニメ配信ガイド");

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "linear-gradient(135deg, #060a16 0%, #0b1526 55%, #0f1f34 100%)",
          fontFamily: "Noto Sans JP",
        }}
      >
        <div style={{ display: "flex", width: "100%", height: 6, background: "linear-gradient(90deg, #3fa9f5, #8ecbff)" }} />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            justifyContent: "center",
            padding: "0 84px",
          }}
        >
          {/* シーズン見出しを主役に。件数は入れず（要サーバー化のため）、
              季節だけ動的にして「今の情報だ」と伝わるようにする。 */}
          <div
            style={{
              display: "flex",
              fontSize: 100,
              fontWeight: 900,
              color: "#f2f9ff",
              lineHeight: 1.05,
            }}
          >
            {headline}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 40,
              color: "#8ecbff",
              marginTop: 28,
            }}
          >
            {TITLE}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 30,
              color: "#85a4c4",
              marginTop: 16,
            }}
          >
            {TAGLINE}
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [{ name: "Noto Sans JP", data: fontData, style: "normal", weight: 900 }],
    }
  );
}

import { ImageResponse } from "next/og";

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
const EYEBROW = "LINK START";
const TAGLINE = "今期アニメの配信状況をサービス別にスキャン";

// Satori（ImageResponse の描画エンジン）は日本語グリフを内蔵していないため、
// 使用する文字だけを指定して Google Fonts から都度取得する
// （Vercel og-image の定番パターン）。
async function loadGoogleFont(text: string): Promise<ArrayBuffer> {
  const url = `https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@900&text=${encodeURIComponent(text)}`;
  const css = await (await fetch(url)).text();
  const match = css.match(/src: url\(([^)]+)\) format\('(opentype|truetype)'\)/);
  if (match) {
    const res = await fetch(match[1]);
    if (res.ok) return res.arrayBuffer();
  }
  throw new Error("Google Font の取得に失敗しました");
}

export default async function OpengraphImage() {
  const fontData = await loadGoogleFont(TITLE + EYEBROW + TAGLINE);

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
          <div
            style={{
              display: "flex",
              fontSize: 28,
              letterSpacing: 6,
              color: "#8ecbff",
              marginBottom: 28,
            }}
          >
            {EYEBROW}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 104,
              color: "#f2f9ff",
              lineHeight: 1.1,
            }}
          >
            {TITLE}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 34,
              color: "#85a4c4",
              marginTop: 32,
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

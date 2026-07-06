import { ImageResponse } from "next/og";
import { loadGoogleFont } from "@/lib/ogFont";
import { getWorkData } from "@/lib/getWorkData";

// 作品ページを共有した時、その作品名・配信サービスが入ったカード画像を出す。
export const runtime = "edge";
export const dynamic = "force-dynamic";
export const alt = "アニメ視聴ガイド";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// 長いタイトルでもレイアウトが崩れないよう文字数で切る。
function truncate(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : chars.slice(0, max - 1).join("") + "…";
}

export default async function OpengraphImage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  let title = "作品情報";
  let serviceLine = "";

  try {
    const item = Number.isInteger(id) ? await getWorkData(id) : null;
    if (item) {
      title = item.title;
      serviceLine = item.services.map((s) => s.short).join(" / ");
    }
  } catch {
    // 取得失敗時も汎用のカードにフォールバックする（画像生成自体は落とさない）
  }

  const displayTitle = truncate(title, 42);
  const fontData = await loadGoogleFont(displayTitle + serviceLine + "アニメ視聴ガイド配信状況");

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
              fontSize: 22,
              letterSpacing: 4,
              color: "#8ecbff",
              marginBottom: 24,
            }}
          >
            アニメ視聴ガイド ｜ 配信状況
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 64,
              fontWeight: 900,
              color: "#f2f9ff",
              lineHeight: 1.25,
            }}
          >
            {displayTitle}
          </div>
          {serviceLine && (
            <div
              style={{
                display: "flex",
                fontSize: 30,
                color: "#85a4c4",
                marginTop: 28,
              }}
            >
              {serviceLine}
            </div>
          )}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [{ name: "Noto Sans JP", data: fontData, style: "normal", weight: 900 }],
    }
  );
}

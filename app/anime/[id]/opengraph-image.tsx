import { ImageResponse } from "next/og";
import { loadGoogleFont } from "@/lib/ogFont";
// ここは edge runtime なので **getWorkData ではなく getWorkDataLive** を使う。
// getWorkData が持つ過去クールのスナップショット・フォールバックは動的importで
// content/snapshots/*.json（64ファイル・5.1MB）を参照しており、edgeではそれが
// 遅延ロードにならず関数へ丸ごとインライン化される（実測16KB→5,040KB）。
// Vercel の Edge Function のサイズ上限を超えてデプロイが落ちる。詳細は
// lib/getWorkDataLive.ts の冒頭。
import { getWorkDataLive } from "@/lib/getWorkDataLive";

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
    const item = Number.isInteger(id) ? await getWorkDataLive(id) : null;
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
      // 【2026-08-25追加】CDN（Vercelのエッジ）に載せる。
      // このルートは force-dynamic ＝ **1リクエストごとに関数が起動**し、その中で
      // Annict（getWorkDataLive）とGoogle Fonts（CSS＋フォント本体）へ合計3回の
      // 外向き通信をしていた。OGP画像はSNS・検索エンジンのクローラーが繰り返し
      // 取りに来る一方、中身が変わるのは配信サービスが増えたときだけなので、
      // 毎回作り直す理由が無い。
      // Vercelの Fluid Provisioned Memory は「割当メモリ×稼働時間」で**I/O待ち中も
      // 止まらない**（Active CPU は止まる）ため、この「待つだけの3往復」が
      // メモリ課金を直接食っていた（2026-08-25の停止時: 489.1 GB-Hrs ÷ 2GB＝
      // 約245インスタンス時間に対し実CPUは12時間＝稼働の約95%がI/O待ち）。
      // s-maxage でエッジに載せれば2回目以降は関数が起動しない。ISRではないので
      // ISR Writes も増えない。経緯は docs/operations.md の㉝。
      headers: {
        "cache-control": "public, max-age=0, s-maxage=604800, stale-while-revalidate=86400",
      },
    }
  );
}

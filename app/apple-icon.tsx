import { ImageResponse } from "next/og";

// iOSの「ホーム画面に追加」用アイコン（apple-touch-icon）。
// 日本語テキストを使わないため Google Fonts への通信は不要（安定して生成できる）。
export const runtime = "edge";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #060a16 0%, #0f1f34 100%)",
        }}
      >
        <div
          style={{
            display: "flex",
            width: 76,
            height: 76,
            border: "7px solid #8ecbff",
            borderRadius: 14,
            transform: "rotate(45deg)",
          }}
        />
      </div>
    ),
    { ...size }
  );
}

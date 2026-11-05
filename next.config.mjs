// 【2026-11-05】セキュリティの補強と、Vercelの無料枠を外から削らせないための設定。
// 経緯は docs/operations.md の [71]、検査は scripts/check.ts の「セキュリティヘッダー」節。

// 全ページ共通のセキュリティヘッダー（埋め込み /embed/** だけは別扱い。下を参照）。
// CSP は**スクリプトを縛らない最小限**にしてある（JSON-LD・テーマ切替のインラインスクリプト・
// Vercel Analytics・Supabase を全部許す必要があり、script-src まで縛ると壊れたことに
// 画面でしか気づけない）。ここで縛るのは「他人のサイトに枠ごと埋め込まれない」
// （クリックジャッキング）・`<base>`の差し替え・プラグイン・外部へのフォーム送信だけ。
const COMMON_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
];
const FRAME_HEADERS = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'; form-action 'self'",
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // 応答に「Next.js製」と名乗らない（使っている版の当たりを付けさせない）。
  poweredByHeader: false,
  // next/image は使っていない（画像は public/ の webp を <img> で直接出す）。
  // 有効のままだと `/_next/image?url=…&w=…&q=…` の w・q を変えるだけで変換を何度でも
  // 起こせ、Hobby の Image Transformations（月5,000）を外から使い切られる。
  // Next.js 14 に修正版の無い画像最適化APIの勧告（GHSA-2xp9-vwfh-vxw4 ほか）の入口も閉じる。
  images: { unoptimized: true },
  async headers() {
    return [
      { source: "/:path*", headers: COMMON_HEADERS },
      // 埋め込み（他人のサイトの iframe に入る）は枠の制限を付けない。
      // app/embed/anime/[id]/route.ts が自分で `frame-ancestors *` を返している。
      { source: "/:path((?!embed/).*)", headers: FRAME_HEADERS },
      // 管理画面はURLにトークンが載るので、リファラで外へ漏らさない。
      { source: "/admin/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
    ];
  },
};
export default nextConfig;

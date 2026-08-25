// next/og の ImageResponse（Satori）は日本語グリフを内蔵していないため、
// 使用する文字だけを指定して Google Fonts から都度取得する
// （Vercel og-image の定番パターン）。
// app/opengraph-image.tsx と app/anime/[id]/opengraph-image.tsx で共有する。
export async function loadGoogleFont(text: string): Promise<ArrayBuffer> {
  const url = `https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@900&text=${encodeURIComponent(text)}`;
  // 【2026-08-25追加】fetchの結果をキャッシュする。この関数はOGP画像ルート
  // （force-dynamic）から呼ばれるため、既定では毎リクエストで実際にGoogle Fontsへ
  // 出ていく（CSS＋フォント本体で2往復）。Vercelの Fluid Provisioned Memory は
  // I/O待ち中も課金が止まらないので、この往復がそのままメモリ課金になる。
  // urlには表示する文字（text=）が入るので、同じ文面の再生成では確実に当たる。
  // 経緯は docs/operations.md の㉝。
  const css = await (await fetch(url, { next: { revalidate: 604800 } })).text();
  const match = css.match(/src: url\(([^)]+)\) format\('(opentype|truetype)'\)/);
  if (match) {
    const res = await fetch(match[1], { next: { revalidate: 604800 } });
    if (res.ok) return res.arrayBuffer();
  }
  throw new Error("Google Font の取得に失敗しました");
}

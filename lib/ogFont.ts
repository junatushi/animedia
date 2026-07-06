// next/og の ImageResponse（Satori）は日本語グリフを内蔵していないため、
// 使用する文字だけを指定して Google Fonts から都度取得する
// （Vercel og-image の定番パターン）。
// app/opengraph-image.tsx と app/anime/[id]/opengraph-image.tsx で共有する。
export async function loadGoogleFont(text: string): Promise<ArrayBuffer> {
  const url = `https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@900&text=${encodeURIComponent(text)}`;
  const css = await (await fetch(url)).text();
  const match = css.match(/src: url\(([^)]+)\) format\('(opentype|truetype)'\)/);
  if (match) {
    const res = await fetch(match[1]);
    if (res.ok) return res.arrayBuffer();
  }
  throw new Error("Google Font の取得に失敗しました");
}

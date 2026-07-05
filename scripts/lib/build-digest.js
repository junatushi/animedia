// 週次のSNS投稿下書き（今期の注目作TOP5）を組み立てる共通ロジック。
// デプロイ済みの本番サイトのAPI（/api/season）を叩くだけなので、
// ANNICT_TOKENの複製やAnnictへの直接アクセスは不要。
const SITE_URL = "https://animedia-khaki.vercel.app";

// X(280字)・Bluesky(300字)双方で安全に収まるよう、控えめな上限で統一する。
const MAX_LEN = 260;

function currentSeason(d = new Date()) {
  const m = d.getMonth() + 1;
  if (m <= 3) return { key: "winter", label: "冬" };
  if (m <= 6) return { key: "spring", label: "春" };
  if (m <= 9) return { key: "summer", label: "夏" };
  return { key: "autumn", label: "秋" };
}

function truncate(text, max) {
  const chars = [...text];
  if (chars.length <= max) return text;
  return chars.slice(0, max - 1).join("") + "…";
}

async function buildDigest() {
  const now = new Date();
  const year = now.getFullYear();
  const { key: season, label } = currentSeason(now);

  const res = await fetch(`${SITE_URL}/api/season?year=${year}&season=${season}`);
  if (!res.ok) {
    throw new Error(`サイトのAPI取得に失敗しました（${res.status}）`);
  }
  const data = await res.json();
  const top5 = [...data.items].sort((a, b) => b.watchers - a.watchers).slice(0, 5);

  const url = `${SITE_URL}/?year=${year}&season=${season}`;
  const lines = [
    `今週の「アニメ視聴ガイド」注目作TOP5（${year}年${label}アニメ）`,
    "",
    ...top5.map((it, i) => `${i + 1}. ${it.title}`),
    "",
    url,
    `#${year}年${label}アニメ`,
  ];

  const text = truncate(lines.join("\n"), MAX_LEN);
  return { text, year, season, label, count: data.count };
}

module.exports = { buildDigest, truncate, MAX_LEN, SITE_URL };

// SNS投稿下書きを組み立てる共通ロジック。曜日によって内容を出し分ける（毎日投稿ローテーション）。
//   日曜: 今期の注目作TOP5
//   月〜土: その曜日に放送/配信のある今期アニメ（broadcastWeekdayで抽出）
// デプロイ済みの本番サイトのAPI（/api/season）を叩くだけなので、
// ANNICT_TOKENの複製やAnnictへの直接アクセスは不要。
const SITE_URL = "https://animedia-khaki.vercel.app";

// X(280字)・Bluesky(300字)双方で安全に収まるよう、控えめな上限で統一する。
const MAX_LEN = 260;
const WEEKDAY_LABEL = ["日", "月", "火", "水", "木", "金", "土"];

function currentSeasonByMonth(m) {
  if (m <= 3) return { key: "winter", label: "冬" };
  if (m <= 6) return { key: "spring", label: "春" };
  if (m <= 9) return { key: "summer", label: "夏" };
  return { key: "autumn", label: "秋" };
}

// GitHub Actionsのランナーは常にUTC。JST（+9h）に直してから年・月・曜日を取る。
function jstParts(now) {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return {
    year: jst.getUTCFullYear(),
    month: jst.getUTCMonth() + 1,
    weekday: jst.getUTCDay(), // 0=日 〜 6=土（JST基準）
  };
}

function truncate(text, max) {
  const chars = [...text];
  if (chars.length <= max) return text;
  return chars.slice(0, max - 1).join("") + "…";
}

// 日曜: 今期の注目作TOP5
function buildTop5(data, year, label, url) {
  const top5 = [...data.items].sort((a, b) => b.watchers - a.watchers).slice(0, 5);
  const lines = [
    `今週の「アニメ視聴ガイド」注目作TOP5（${year}年${label}アニメ）`,
    "",
    ...top5.map((it, i) => `${i + 1}. ${it.title}`),
    "",
    url,
    `#${year}年${label}アニメ`,
  ];
  return truncate(lines.join("\n"), MAX_LEN);
}

// 月〜土: その曜日に放送/配信のある今期アニメ。注目度順に、字数上限まで詰める。
// 該当作品が無ければ null（呼び出し側でTOP5にフォールバック）。
function buildTodayAiring(data, weekday, year, label, url) {
  const today = data.items
    .filter((it) => it.broadcastWeekday === weekday)
    .sort((a, b) => b.watchers - a.watchers);
  if (today.length === 0) return null;

  const wl = WEEKDAY_LABEL[weekday];
  const header = `【${wl}曜】今日放送・配信の今期アニメ（${year}年${label}）`;
  const tag = `#${year}年${label}アニメ`;

  // タイトルを1本ずつ足していき、上限を超えない範囲で最大数を載せる。
  const picks = [];
  for (const it of today) {
    const line = it.broadcastTime ? `・${it.title}（${it.broadcastTime}〜）` : `・${it.title}`;
    const remain = today.length - (picks.length + 1);
    const tail = remain > 0 ? `ほか${remain}作品。曜日別はカレンダー表示で。` : "曜日別はカレンダー表示で。";
    const candidate = [header, "", ...picks, line, "", tail, url, tag].join("\n");
    if ([...candidate].length > MAX_LEN) break;
    picks.push(line);
  }
  // 1本も入らない極端なケースはヘッダーだけでも出す（通常は起きない）。
  if (picks.length === 0) {
    return truncate([header, "", url, tag].join("\n"), MAX_LEN);
  }
  const remain = today.length - picks.length;
  const tail = remain > 0 ? `ほか${remain}作品。曜日別はカレンダー表示で。` : "曜日別はカレンダー表示で。";
  return truncate([header, "", ...picks, "", tail, url, tag].join("\n"), MAX_LEN);
}

async function buildDigest(now = new Date()) {
  const { year, month, weekday } = jstParts(now);
  const { key: season, label } = currentSeasonByMonth(month);

  const res = await fetch(`${SITE_URL}/api/season?year=${year}&season=${season}`);
  if (!res.ok) {
    throw new Error(`サイトのAPI取得に失敗しました（${res.status}）`);
  }
  const data = await res.json();
  const url = `${SITE_URL}/?year=${year}&season=${season}`;

  const text =
    weekday === 0
      ? buildTop5(data, year, label, url)
      : buildTodayAiring(data, weekday, year, label, url) || buildTop5(data, year, label, url);

  return { text, year, season, label, count: data.count, weekday };
}

module.exports = { buildDigest, truncate, MAX_LEN, SITE_URL };

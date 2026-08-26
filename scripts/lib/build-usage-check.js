// Vercel利用量の「答え合わせ」を促すIssueの生成（2026-08-26導入）。
//
// 【なぜ要るか】2026-08-24にVercel Hobbyの利用上限を超過してサイトが停止し、
// 2026-08-25〜26に対策を入れた（docs/operations.md の㉝）。だが**効果は推定でしか
// 書けていない**。Vercelのダッシュボードはログインが要るのでセッションからは読めず、
// ルート別の内訳も出ない。つまり「本当に減ったか」は人が画面を見るしかない。
//
// そして2026-08-25に救済措置で**30日だけ通常の3倍枠**をもらっている。30日後に通常枠へ
// 戻るので、その前に実測で確かめて足りなければ追加の手を打つ必要がある。
// 見に行くきっかけが運用に無いと、気づいたときにはまた止まっている。
//
// 【なぜ日付をここだけが持つか】YAMLにも書くと、片方だけ直したときにズレて気づけない。
// season-prep.js / build-digest.js と同じ方針（時刻・日付の定義は1箇所）。
// scripts/check.ts が「ワークフローのYAMLに判定日を書いていないこと」を検査する。

// 判定日。窓を持たせてあるのは、GitHub Actionsのscheduleが数時間〜十数時間遅れることと、
// 利用者がすぐ見られるとは限らないため（窓の間は毎日判定に当たるが、起票は
// タイトル検索で1回に抑える）。
const WINDOW_DAYS = 7;

const CHECKPOINTS = [
  {
    date: "2026-09-02",
    label: "1週間後の答え合わせ",
    why: "対策のデプロイ（2026-08-26）から1週間。ローリング30日の集計には対策前の分が\nまだ大量に残っているので、**総量ではなく「1日あたりの増え方」を見る**。",
  },
  {
    date: "2026-09-18",
    label: "通常枠へ戻る前の最終確認",
    why: "3倍枠（2026-08-25から30日）が切れるのが9月下旬。**まだ手を打てるうちに**\n通常上限に収まる見通しかを確かめる。ここで足りなければ追加の対策を入れる。",
  },
];

function toDateString(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// JSTの「今日」（YYYY-MM-DD）。GitHub Actionsのランナーは常にUTCなので明示的に足す。
function jstToday(now = new Date()) {
  return toDateString(new Date(now.getTime() + 9 * 60 * 60 * 1000));
}

function daysBetween(fromIso, toIso) {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

/**
 * いま窓の中にある判定日を返す（無ければ null）。
 * 窓 = [判定日, 判定日 + WINDOW_DAYS]
 */
function dueCheckpoint(today) {
  for (const c of CHECKPOINTS) {
    const elapsed = daysBetween(c.date, today);
    if (elapsed >= 0 && elapsed <= WINDOW_DAYS) return c;
  }
  return null;
}

/**
 * Issueのタイトルと本文を組み立てる。窓の外なら null。
 * タイトルは判定日を含む＝窓の間ずっと同じ文字列になるので、タイトル検索で
 * 二重起票を防げる（season-prep.js と同じ手法）。
 */
function buildUsageCheck(today = jstToday()) {
  const c = dueCheckpoint(today);
  if (!c) return null;

  const title = `Vercel利用量の答え合わせ（${c.date}・${c.label}）`;

  const body = `Vercelのダッシュボードは**ログインが要るためセッションからは読めない**。
この確認だけは人が画面を見る必要がある。

${c.why}

## 見るところ

https://vercel.com/ → プロジェクト → Usage（30日ローリング）

| 指標 | 通常上限 | いまの枠 |
|---|---|---|
| ISR Writes | 200,000 | 600,000（3倍枠・2026-09下旬まで） |
| Fluid Active CPU | 4h | 12h |
| Fluid Provisioned Memory | 360 GB-Hrs | 1,080 GB-Hrs |

## 判定

**総量ではなく「1日あたり」を見る。** ローリング30日の総量には対策前
（〜2026-08-25）の分が混ざっているので、総量で判断すると必ず過大に見える。

| 見るもの | 合格ライン | 根拠 |
|---|---|---|
| ISR Writes | **1日 2,500件未満** | 対策前は9,882件/日。見込みは約2,300件/日 |
| Fluid Active CPU | 1日 8分未満 | 4h ÷ 30日 = 8分/日 |
| Provisioned Memory | 1日 12 GB-Hrs未満 | 360 ÷ 30 = 12/日 |

## 合格していた場合

\`docs/operations.md\` の㉝に**実測**を追記する（予測ではなく）。
見込み（ISR Writes 約68,000件/30日）と実際がどれだけ違ったか、
違っていたら式のどこが外れたかを書く。

## 合格していなかった場合（次の手・効果の大きい順）

1. **過去クールの作品ページ1,961件を事前生成に移す**。声優ページで効いたのと同じ手。
   ただし \`lib/getWorkData.ts\` が過去クールでもAnnictへライブ取得する構造なので、
   スナップショット優先へ切り替える必要がある。切り替えると \`credits\`
   （キャラ名対応・監督・製作会社・原作者）が欠けるため、
   \`scripts/snapshot-past-seasons.ts\` を \`toAnimeDetail\` まで含めて再生成するのが本筋。
   要 \`ANNICT_TOKEN\`＝PC作業（手順は \`docs/snapshot-regenerate.md\`）
2. **\`app/anime/[id]/page.tsx\` の過剰取得をやめる**。共演声優の閾値判定と関連作品8件の
   ためだけにクール全作品（最大224作品・casts込み）を取っている。実際に読むのは
   6フィールドだけで、フルアイテムの22.9%（実測: 2024-autumnで158KB→36KB）。
   ISR Writesには効かないがCPU/メモリには効く
3. **\`robots.txt\` にCrawl-delayを入れる**。クロール量がそのまま書き込み量なので効くが、
   SEOと引き換え。\`docs/seo-operations.md\` の判断と突き合わせること
4. デプロイ頻度をさらに下げる（デプロイ＝ISRキャッシュ実質全消去。実測30日23回）

## 背景

- 経緯と学び: \`docs/operations.md\` の㉝
- 引き継ぎ: \`docs/handoff.md\` の先頭
- 再発防止の機械検査: \`node scripts/check.ts\` の「ISRの再生成頻度」節
`;

  return { title, body };
}

module.exports = { buildUsageCheck, dueCheckpoint, jstToday, CHECKPOINTS, WINDOW_DAYS };

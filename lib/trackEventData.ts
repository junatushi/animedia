// 行動ログの付随データ（`/api/track` の `data`）を検証して、通してよい形だけにする
// （2026-09-07導入・重大度中）。
//
// ───────────────────────────────────────────────────────────────
// 【なぜ要るか】無認証の口から、エージェントが毎日読むファイルへ文字列が届く
//
// `/api/track` は認証もOriginの検査もレート制限も無い（意図的。計測はユーザーの
// 操作を邪魔してはいけないので、失敗しても握りつぶす設計）。イベント名は
// `ALLOWED_EVENTS` で許可制だが、**`data` は「プレーンオブジェクトか」しか見ておらず、
// キー数・値の型・文字列長のどれにも上限が無かった**。
//
// これだけなら「DBに変な行が入る」で済むが、経路がつながっている:
//
//   誰でも POST できる /api/track
//     → Supabase の analytics_events
//     → lib/adminAnalytics.ts の buildSnapshot（countByDataField は値の上位10件を出す）
//     → scripts/fetch-site-analytics.js が content/analytics/site/<日付>.json に書く
//     → **GitHub Actions が main へコミットする**
//     → docs/daily-ops.md が「毎日これを読む」と指示している
//
// つまり `curl -d '{"event":"page_view","data":{"ref":"<任意の文章>"}}'` を10回投げるだけで、
// **リポジトリの中の「実測データ」に任意の文章を載せられる**。読むのは人と
// エージェントなので、偽の流入元の捏造にも、指示の注入にも使える。
//
// 2026-09-07時点でコミット済みのJSONに `referrers` がまだ無いのは、
// 本番が旧コードだから（この経路は**マージして次の日次収集が走った時点で成立する**）。
// ただし `service`（`official_link_click` 等）は**すでに**書き出されているので、
// 同じ形の穴は前からあった。同時に塞ぐ。
//
// 【どこまで縛るか】
// ①**全フィールド共通**の上限（キー数・キー名・文字列長・数値の有限性）。
//   これはDBとメモリを守るための土台で、どのイベントにも効く。
// ②**コミットされるJSONに入るフィールドだけ**、形まで縛る。
//   いま入るのは `ref`（page_view）・`service`（filter_service / official_link_click /
//   affiliate_click）・`face` と指標名（web_vitals の vitalsP75）の3系統。
//   `title`（作品名）や `cast`（声優名）は日本語の自由文だが、**JSONには出ない**ので
//   共通の長さ制限だけにする。
//
// **クライアントの検証は当てにしない。** `components/WebVitals.tsx` は
// ホスト名だけを送るが、それは正直なクライアントの話で、攻撃者は何でも送れる。
// ここがサーバー側の唯一の門番。
//
// `route.ts` は `next/server` に依存して Node から直接 import できないので、
// 判定は素の `.ts` に置く（`lib/embed.ts`・`lib/serviceDataset.ts` と同じ理由）。
// 検査は `node scripts/check.ts` の「行動ログの付随データ」節。
// ───────────────────────────────────────────────────────────────

/** 1イベントに付けられるキーの数。web_vitals が最大（5指標＋face＝6）。 */
export const MAX_KEYS = 12;
/** キー名の形。指標名（LCP・CLS…）と面（face）が通ればよい。 */
const KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,23}$/;
/** 文字列値の長さ。作品名・声優名が入るので日本語で十分な長さを取る。 */
export const MAX_STRING = 64;
/** 数値の絶対値の上限。ミリ秒の指標なので桁で十分。 */
const MAX_NUMBER = 1e9;

/**
 * コミットされるJSONに入るフィールドだけ、形まで縛る。
 * ここに載っていないキーは共通の制限（長さ）だけを受ける。
 */
const FIELD_SHAPE: Record<string, RegExp> = {
  // ホスト名だけ。生のURL・検索語・自由文はここで落ちる。
  // 末尾ドット無し・ラベルはハイフンで始まらない/終わらない・ドットを1つ以上含む。
  ref: /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/,
  // 配信サービスのキー（例: d_anime）。lib/services.ts の SERVICES の形。
  service: /^[a-z0-9_]{1,32}$/,
  // 面（ページ種別）。components/WebVitals.tsx が送るのは小文字の英字だけ。
  face: /^[a-z]{1,16}$/,
};

/**
 * `data` を検証し、通してよいフィールドだけを残す。
 *
 * **落とすのはフィールド単位**（リクエスト全体を弾かない）。計測はユーザーの操作を
 * 邪魔してはいけないので、1つ変な値が混ざっても残りは記録する。
 *
 * @returns 残ったフィールド。1つも残らなければ `null`（空オブジェクトを書かない）
 */
export function sanitizeEventData(data: unknown): Record<string, string | number> | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;

  const out: Record<string, string | number> = {};
  let kept = 0;
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (kept >= MAX_KEYS) break;
    if (!KEY_RE.test(key)) continue;

    if (typeof value === "number") {
      if (!Number.isFinite(value) || Math.abs(value) > MAX_NUMBER) continue;
      out[key] = value;
      kept++;
      continue;
    }

    if (typeof value === "string") {
      if (value.length === 0 || value.length > MAX_STRING) continue;
      const shape = FIELD_SHAPE[key];
      if (shape && !shape.test(value)) continue;
      out[key] = value;
      kept++;
      continue;
    }

    // 真偽値・null・入れ子のオブジェクト・配列は通さない
    // （countByDataField も vitalsP75 も文字列と数値しか見ない）。
  }
  return kept > 0 ? out : null;
}

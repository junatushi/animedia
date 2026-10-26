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

/**
 * 1イベントに付けられるキーの数。web_vitals が最大（6指標＋face＋ua＋src＋seen＋補助6＝16。
 * 補助は lib/vitalsDiagnostics.ts が作る。実際の最大形が収まることは node scripts/check.ts が
 * その関数を呼んで確かめるので、ここに数を書き写して合わせる必要は無い）。
 */
// 2026-10-26に seen を足して最大形が16＝上限ちょうどになったので 20 に上げた
// （上限ちょうどだと補助指標を1つ足した日に末尾が黙って落ちる）。
export const MAX_KEYS = 20;
/** キー名の形。指標名（LCP・CLS…）と面（face）が通ればよい。 */
const KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,23}$/;
/** 文字列値の長さ。作品名・声優名が入るので日本語で十分な長さを取る。 */
export const MAX_STRING = 64;
/** 数値の絶対値の上限。ミリ秒の指標なので桁で十分。 */
const MAX_NUMBER = 1e9;

/** ページ内の欄の名前（data-nav / data-out の値）。小文字の英字と _ だけ。 */
export const SECTION_RE = /^[a-z_]{1,16}$/;

/**
 * 集計に通してよい値の一覧（2026-10-26・反証レビューで追加）。形（上の正規表現）だけだと、
 * 無認証の口に「形の合う任意の単語」を大量に送ってコミットされるJSONを膨らませられる。
 * また via / seen は形を縛る前から nav・web_vitals に付けて送れたので、窓の中に自由文の行が残りうる。
 * 集計（lib/adminAnalytics.ts）は**この一覧にある値だけ**を数える。
 * ページに欄を足したら KNOWN_SECTIONS にも足すこと（node scripts/check.ts が app/ と components/ の
 * data-nav / data-out を走査して突き合わせ、無い名前があれば落ちる）。
 */
/** 面。components/WebVitals.tsx の faceOf が返しうる値の全部。 */
export const KNOWN_FACES = new Set([
  "home",
  "other",
  "anime",
  "season",
  "person",
  "service",
  "studio",
  "director",
  "rankings",
  "exclusive",
  "developers",
]);
/** 欄（data-nav）。名前の意味は各ページの冒頭のコメント。 */
export const KNOWN_SECTIONS = new Set([
  // 作品ページ
  "head", "where", "wmore", "rent", "cast", "cred", "more", "ser", "rel", "emb", "foot",
  // 声優ページ
  "film", "works", "costar", "other", "seasons",
  // 制作会社・監督ページ（head・works は上と共通）
  "partner",
  // サービス別ページ
  "excl", "list", "others", "cal",
  // 一覧（トップ・シーズン。list は上と共通）
  "calendar", "cross",
]);
/** 外部リンクの種類（data-out）。付いていないリンクは other。 */
export const KNOWN_OUT_KINDS = new Set(["official", "source", "other"]);

/**
 * 検索語として通してよい形（2026-10-26導入）。
 * 作品名・声優名に使われる文字（文字・数字・空白と ー〜~・×☆★♪.:!?&'- ）だけで30文字まで。
 * **`/` `<` `>` `"` `@` `#` `=` と括弧は通さない**（URL・HTML・メールアドレス・指示文の体裁を作らせない）。
 * 検索語は自由文で、しかも集計がコミットされるJSONに出る（2回以上検索された語だけ）。
 * 無認証の口から届く値なので、ここが唯一の門番になる（上の【なぜ要るか】）。
 */
export const SEARCH_QUERY_RE = /^[\p{L}\p{N}\p{M} ー〜~・×☆★♪.:!?&'-]{1,30}$/u;

/**
 * 検索語の正規化（クライアントが送る前・集計が数える前の両方で使う）。
 * 全角半角の揺れ（NFKC）・大文字小文字・前後と連続の空白を畳み、30文字で切る。
 * 形に合わなければ null（送らない・数えない）。
 */
export function normalizeSearchQuery(raw: string): string | null {
  // 30文字はコードポイントで数える（slice だとサロゲートペアの片割れが残って全体が弾かれる）。
  const q = Array.from(raw.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim()).slice(0, 30).join("").trim();
  if (q === "" || !SEARCH_QUERY_RE.test(q)) return null;
  // 作品名・声優名の検索には現れない形も落とす（2026-10-26・反証レビュー）。
  // 7桁以上の数字（電話番号・郵便番号）／ホスト名（http・www・ドット2つ以上）／5語以上の文。
  if ((q.match(/[0-9]/g)?.length ?? 0) >= 7) return null;
  if (/http|www/.test(q) || (q.match(/\./g)?.length ?? 0) >= 2) return null;
  if (q.split(" ").length >= 5) return null;
  return q;
}

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
  // 2026-10-21追加。どれもコミットされるJSONに出る（lib/adminAnalytics.ts の agents / landings / refTags）。
  ua: /^(bot|ios|android|desktop|other)$/,
  src: /^(direct|internal|[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+)$/,
  tag: /^[a-z0-9_-]{1,24}$/,
  // 回遊（nav）の移動元の面。移動先は face。face と同じ形。
  from: /^[a-z]{1,16}$/,
  // 2026-10-26追加。どれもコミットされるJSONに出る（lib/adminAnalytics.ts の navVia / outbound / sectionsSeen）。
  // via … 押されたリンクがあった欄（ページ内の data-nav の値）。kind … 外部リンクの種類（data-out の値）。
  via: SECTION_RE,
  kind: SECTION_RE,
  // seen … そのページで画面に出た欄の一覧（カンマ区切り。1つも無ければ "-"）。
  seen: /^(-|[a-z_]{1,16}(,[a-z_]{1,16})*)$/,
  // q … 検索欄に入力された語（normalizeSearchQuery を通した形）。URL・HTML・記号の並びはここで落ちる。
  q: SEARCH_QUERY_RE,
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
      // 検索語は形に加えて正規化済みであること（normalizeSearchQuery の追加の条件も通す）。
      if (key === "q" && normalizeSearchQuery(value) !== value) continue;
      out[key] = value;
      kept++;
      continue;
    }

    // 真偽値・null・入れ子のオブジェクト・配列は通さない
    // （countByDataField も vitalsP75 も文字列と数値しか見ない）。
  }
  return kept > 0 ? out : null;
}

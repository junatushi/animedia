// API とフロントで共有する型

// casts/staffs の生ノード形（シーズン一覧・作品個別ページの両方で取得する）。
export interface RawCastNode {
  name: string;
  // シーズン一覧のクエリはキャラクター名を取らない（声優名しか使わないため。
  // lib/annict.ts の creditsFields を参照）ので、一覧由来のデータでは欠ける。
  character?: { name: string } | null;
}
export interface RawStaffNode {
  name: string;
  roleText: string;
  resource: { __typename: string; name: string } | null;
}

export interface AnnictWork {
  annictId: number;
  title: string;
  watchersCount: number | null;
  officialSiteUrl: string | null;
  image: { recommendedImageUrl: string | null } | null;
  // Annict の Media enum（TV / MOVIE / OVA / WEB / OTHER 等）。構造化データ（JSON-LD）で
  // 作品種別（TVSeries / Movie）を出し分けるために使う。
  media: string | null;
  // rebroadcast は作品個別取得（fetchWorkById）でのみ入る。シーズン一覧
  // （fetchSeasonWorks）では取得しないため常にundefined。
  // episode は配信開始通知機能専用で、fetchWorkById(..., { withEpisode: true }) で
  // 取ったときだけ入る（通常の作品個別取得では常にundefined）。episodeを要求した
  // クエリでは未紐付けのprogramがAnnict側のnon-nullフィールド違反によりノード自体が
  // nullで返ってくるため、要素はnull許容にしている（lib/annict.tsのPROGRAM_FIELDS_*）。
  programs: {
    nodes: ({
      channel: { name: string | null } | null;
      startedAt: string | null;
      rebroadcast?: boolean | null;
      episode?: { number: number | null; numberText: string | null } | null;
    } | null)[];
  } | null;
  // 声優・スタッフ名での検索用に、シーズン一覧でも取得する（casts先頭5件・staffs先頭40件）。
  casts: RawCastNode[];
  staffs: RawStaffNode[];
}

export interface ServiceTag {
  key: string;
  name: string;
  short: string;
  color: string;
  // Annictにはまだ登録されておらず、公式サイト等の一次情報で人力確認したサービスの
  // 場合のみ出典URLが入る（content/works/extraServices.ts参照）。UIが「手動確認」の
  // 印と出典リンクを出すために使う。Annict由来の通常のサービスはundefined。
  manualSourceUrl?: string;
}

// 劇場公開日のように、Annict が持たない日付を人力で補完するためのエントリ。
// 実データは content/works/releaseDates.ts に置き、getSeasonData/getWorkData から
// toAnimeItem/toAnimeDetail の第3引数として注入する（ExtraServiceEntry と同じ設計。
// lib は content に直接依存させない）。
export interface ReleaseDateEntry {
  // 劇場公開日（"YYYY-MM-DD", JST）。
  date: string;
  // 一次情報（公式サイト・配給/製作会社の発表等）のURL。CLAUDE.mdの「一次情報のみ・
  // 創作しない」方針に従い必須とする。UI側で出典として表示する。
  sourceUrl: string;
  // 確認日（"YYYY-MM-DD"）。公開日は延期・変更されることがあるため鮮度の目安に使う。
  confirmedDate: string;
}

export interface AnimeItem {
  id: number;
  title: string;
  image: string | null;
  officialSiteUrl: string | null;
  watchers: number;
  services: ServiceTag[];
  otherServices: string[];
  // Annictにこの作品のprograms（放送/配信記録）が1件でもあるか。TV放送のみで
  // 配信サービスが0件の場合もtrue。services/otherServicesが両方空のとき、
  // 「Annictに放送データ自体が無い」（false）か「放送はあるが配信サービス未登録」
  // （true）かをUIで出し分けるために使う（ServiceMarks参照）。
  hasBroadcastData: boolean;
  // 配信スケジュールカレンダー用。最も早い programs（=初回放送/配信）から
  // 導出した曜日（0=日〜6=土, JST）と時刻（"23:00"などJST）。
  // programs が空/未登録の作品は null（「配信日未定」として扱う）。
  broadcastWeekday: number | null;
  broadcastTime: string | null;
  // 劇場公開日（人力補完）。Annict の API は劇場公開日を持たない（GraphQL に
  // フィールドが無く、REST v1 の released_on も新作映画では空のことが多い）ため、
  // 公式サイト等の一次情報で確認できた作品にだけ content/works/releaseDates.ts で
  // 与える（未確認の作品は null。推測では埋めない）。
  releaseDate: ReleaseDateEntry | null;
  // 上記と同じ最速 programs から導出した放送/配信開始日（"YYYY-MM-DD", JST）。
  // 放送開始の1週間より前は「今週の曜日」のように見せず日付表示に切り替え、
  // カレンダー（曜日別グリッド）にも出さない基本ルールの判定に使う（SeasonExplorer側）。
  broadcastStartDate: string | null;
  // 声優・スタッフ名での検索用。casts(先頭5件)の人物名 + staffs(先頭40件)の
  // 人物/組織名をまとめたもの（重複除去済み）。UIには出さず検索マッチにのみ使う。
  creditNames: string[];
  // 声優のみの人物名（casts、重複除去済み）。声優フィルターチップの構築に使う
  // （creditNamesはスタッフ側に音楽レーベル・制作会社等の組織名も混ざるため分離）。
  castNames: string[];
  // Annict の Media enum（"TV" / "MOVIE" / "OVA" / "WEB" / "OTHER"）。
  // 構造化データ（JSON-LD）で TVSeries / Movie を出し分けるのに使う。
  media: string | null;
}

export interface SeasonResponse {
  season: string;
  count: number;
  items: AnimeItem[];
}

// クール横断検索用の軽量インデックスの1件。配信・クレジット等の重いデータは持たず、
// タイトル一致だけを見るための最小限（クリックすると /anime/[id] で本体を取得する）。
export interface SearchIndexEntry {
  id: number;
  title: string;
  kana: string;
  year: number | null;
  season: string | null;
}

export interface WorkCastCredit {
  personName: string;
  characterName: string;
}

// Annict の staffs/casts から導出したクレジット情報。
// director/productionCompany/originalCreators は該当データが無ければ null/空配列
// （「配信情報なし」と同様、推測で埋めない）。
export interface WorkCredits {
  casts: WorkCastCredit[];
  director: string | null;
  productionCompany: string | null;
  originalCreators: string[];
}

export interface AnimeDetail extends AnimeItem {
  credits: WorkCredits;
}

// content/works/ に人力で用意する補足コンテンツ（あらすじ・見どころ・出版社）。
// Annictに構造化データが無いため、公式サイト等の一次情報を人が確認して書く。
// 未整備の作品は該当ファイルが無い＝表示側で単純に省略する。
export interface WorkDetailContent {
  synopsis: string;
  highlights: string[];
  publisher?: string | null;
  // 「2期から見ても大丈夫？」「どの順番で見ればいい？」のように、視聴前に検索される疑問と回答。
  // 作品ページに可視テキストとして出しつつ、FAQPage構造化データにも入れる（＝生成AIの回答に
  // 引用されうる形にする）。answerは一次情報で確認できた事実だけで書き、確認できないことは
  // 書かない（sourceUrlに載せた出典で裏が取れる範囲に留める）。未整備の作品は省略。
  faq?: { question: string; answer: string }[];
  // 記載内容の根拠にした一次情報（公式サイト等）のURL。検証可能性のため必須。
  sourceUrl: string;
}

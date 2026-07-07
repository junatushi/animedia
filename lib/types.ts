// API とフロントで共有する型

// casts/staffs の生ノード形（シーズン一覧・作品個別ページの両方で取得する）。
export interface RawCastNode {
  name: string;
  character: { name: string } | null;
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
  programs: { nodes: { channel: { name: string | null } | null; startedAt: string | null }[] } | null;
  // 声優・スタッフ名での検索用に、シーズン一覧でも取得する（casts先頭5件・staffs先頭40件）。
  casts: RawCastNode[];
  staffs: RawStaffNode[];
}

export interface ServiceTag {
  key: string;
  name: string;
  short: string;
  color: string;
}

export interface AnimeItem {
  id: number;
  title: string;
  image: string | null;
  officialSiteUrl: string | null;
  watchers: number;
  services: ServiceTag[];
  otherServices: string[];
  // 配信スケジュールカレンダー用。最も早い programs（=初回放送/配信）から
  // 導出した曜日（0=日〜6=土, JST）と時刻（"23:00"などJST）。
  // programs が空/未登録の作品は null（「配信日未定」として扱う）。
  broadcastWeekday: number | null;
  broadcastTime: string | null;
  // 声優・スタッフ名での検索用。casts(先頭5件)の人物名 + staffs(先頭40件)の
  // 人物/組織名をまとめたもの（重複除去済み）。UIには出さず検索マッチにのみ使う。
  creditNames: string[];
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
  // 記載内容の根拠にした一次情報（公式サイト等）のURL。検証可能性のため必須。
  sourceUrl: string;
}

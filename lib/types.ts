// API とフロントで共有する型

export interface AnnictWork {
  annictId: number;
  title: string;
  watchersCount: number | null;
  officialSiteUrl: string | null;
  image: { recommendedImageUrl: string | null } | null;
  programs: { nodes: { channel: { name: string | null } | null; startedAt: string | null }[] } | null;
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
}

export interface SeasonResponse {
  season: string;
  count: number;
  items: AnimeItem[];
}

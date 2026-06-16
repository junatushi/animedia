// API とフロントで共有する型

export interface AnnictWork {
  annictId: number;
  title: string;
  watchersCount: number | null;
  officialSiteUrl: string | null;
  image: { recommendedImageUrl: string | null } | null;
  programs: { nodes: { channel: { name: string | null } | null }[] } | null;
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
}

export interface SeasonResponse {
  season: string;
  count: number;
  items: AnimeItem[];
}

// ───────────────────────────────────────────────────────────────
// 配信正規化エージェント（②）の中核ロジック
//   Annict のチャンネル名 → 国内配信サービスの正準データに変換する。
//   ・既知の配信サービスに一致 → そのサービスとして表示
//   ・テレビ局っぽい名前        → 除外（国内"配信"のみ表示のため）
//   ・どちらでもない            → 「その他配信」として元の名前で拾う
//   ＝ 配信を取りこぼさず、TV だけを落とす設計。
//   サービスを増やしたいときは SERVICES に1行足すだけ。
// ───────────────────────────────────────────────────────────────

export type ServiceKey =
  | "d_anime" | "abema" | "netflix" | "prime" | "unext"
  | "disney" | "hulu" | "lemino" | "dmm" | "bandai"
  | "fod" | "niconico" | "anime_houdai" | "wowow_od" | "telasa" | "youtube";

export interface ServiceDef {
  key: ServiceKey;
  name: string;   // 表示名（フル）
  short: string;  // バッジ用の短い名前
  color: string;  // ブランド寄りの色
  match: RegExp;  // 正規化したチャンネル名に対して判定
}

// 半角化・小文字化・空白/長音の揺れを吸収
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[ー－―‐]/g, "-")
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xfee0)
    );
}

// 並び順 = 判定の優先順。配信サービスを TV 判定より先に当てる。
// 色は各サービスの実際のブランドカラーに準ずる。サイト全体のデザイン（ダーク×
// ブルー系のガラス質HUD）とはバッジ側の発光演出（globals.css の .badge-mark の
// box-shadow）で馴染ませており、色相そのものはブランドから変えていない。
export const SERVICES: ServiceDef[] = [
  { key: "d_anime",      name: "dアニメストア",         short: "dアニメ",    color: "#ff7a00", match: /dアニメ|danime|d-anime/ },
  { key: "abema",        name: "ABEMA",                 short: "ABEMA",     color: "#22c55e", match: /abema/ },
  { key: "netflix",      name: "Netflix",               short: "Netflix",   color: "#e50914", match: /netflix/ },
  { key: "prime",        name: "Amazon Prime Video",    short: "Prime",     color: "#00a8e1", match: /primevideo|prime-video|amazonprime|amazon|prime/ },
  { key: "unext",        name: "U-NEXT",                short: "U-NEXT",    color: "#8b5cf6", match: /u-next|unext/ },
  { key: "dmm",          name: "DMM TV",                short: "DMM TV",    color: "#ff2e63", match: /dmmtv|dmm/ },
  { key: "lemino",       name: "Lemino",                short: "Lemino",    color: "#e4007f", match: /lemino|dtv/ },
  { key: "disney",       name: "Disney+",               short: "Disney+",   color: "#2a6df5", match: /disney/ },
  { key: "hulu",         name: "Hulu",                  short: "Hulu",      color: "#10d27a", match: /hulu/ },
  { key: "bandai",       name: "バンダイチャンネル",     short: "バンチャ",   color: "#e6002d", match: /バンダイ|bandai/ },
  { key: "fod",          name: "FOD",                   short: "FOD",       color: "#d8132f", match: /\bfod\b|フジテレビオンデマンド/ },
  { key: "niconico",     name: "ニコニコ",               short: "ニコニコ",   color: "#d59a00", match: /niconico|ニコニコ|nicovideo/ },
  { key: "anime_houdai", name: "アニメ放題",             short: "アニメ放題", color: "#d61a1a", match: /アニメ放題|animehoudai/ },
  { key: "wowow_od",     name: "WOWOWオンデマンド",      short: "WOWOW OD",  color: "#1f7ae0", match: /wowowオンデマンド|wowow-od/ },
  { key: "telasa",       name: "TELASA",                short: "TELASA",    color: "#ff8c1a", match: /telasa/ },
  { key: "youtube",      name: "YouTube",               short: "YouTube",   color: "#ff0000", match: /youtube|ユーチューブ/ },
];

// 配信に当たらなかった名前のうち、地上波/BS/CS など放送局を判定して除外する
const TV_PATTERN =
  /(放送|テレビ|ＴＶ|^tv|tv$|チャンネル.*放送|wowow|bs|cs|nhk|日テレ|日本テレビ|ntv|tbs|フジ|テレビ朝日|テレ朝|テレビ東京|テレ東|tokyomx|mx|tvk|サンテレビ|kbs京都|kbs|チバ|テレ玉|とちぎ|群馬|びわ湖|岐阜|三重|静岡|札幌|北海道|htb|stv|hbc|青森|岩手|秋田|山形|福島|新潟|長野|山梨|福井|石川|富山|広島|岡山|山口|愛媛|高知|香川|徳島|福岡|rkb|佐賀|長崎|熊本|大分|宮崎|鹿児島|沖縄|at-x|atx|アニマックス|animax|キッズステーション|キッズ|アニメシアター|メ.?テレ)/i;

export type ChannelClass =
  | { kind: "service"; def: ServiceDef }
  | { kind: "tv" }
  | { kind: "other"; name: string };

export function classifyChannel(rawName: string): ChannelClass {
  const n = norm(rawName);
  for (const def of SERVICES) {
    if (def.match.test(n)) return { kind: "service", def };
  }
  if (TV_PATTERN.test(n)) return { kind: "tv" };
  return { kind: "other", name: rawName.trim() };
}

// レンタル/都度課金扱いのサービス（content/works/rentalServices.ts で人力管理）を、
// 通常の配信サービス一覧（見放題想定）から分離する。カード一覧・作品ページの両方で使う。
export function splitRentalServices(
  services: import("./types").ServiceTag[],
  rentalKeys: string[] | undefined
): { streaming: import("./types").ServiceTag[]; rental: import("./types").ServiceTag[] } {
  if (!rentalKeys || rentalKeys.length === 0) {
    return { streaming: services, rental: [] };
  }
  const rentalSet = new Set(rentalKeys);
  return {
    streaming: services.filter((s) => !rentalSet.has(s.key)),
    rental: services.filter((s) => rentalSet.has(s.key)),
  };
}

// バッジ背景色に対して読みやすい文字色（黒 or 白）を返す
export function textOn(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#10141f" : "#ffffff";
}

// 呼び出し側でカード表示対象（配信サービス・その他配信）に絞り込んだ startedAt から、
// 配信スケジュールカレンダー用の曜日・時刻をJSTで求める。TVチャンネル（カードには
// 出さない）はここに含めない: TV各局は放送免許の都合で数十分単位の時差放送が普通にあり
// （例: AT-Xが同作品の他局より30分早く放送する等）、最速のTV局を代表値にすると
// カードに出ている配信サービスの実際の配信開始時刻とズレて「時間通りに見たのに配信されて
// いない」という誤誘導になる（2026-07-11 実例: Re:ゼロ4期奪還編でAT-X 22:00 vs
// 実際に表示されるABEMA/dアニメ 22:30）。programs が無い/日時が取れない作品は null
// （=「配信日未定」としてカレンダーの外に出す）。
// date（YYYY-MM-DD、JST）も併せて返す。まだ放送開始前の作品を「今週の曜日」のように
// 見せてしまうミスリードを防ぐため、UI側（SeasonExplorer）で放送開始日までの残日数を
// 判定する基準値として使う（基本ルール。2026-07-11 導入）。
function deriveBroadcastSlot(
  nodes: ({ startedAt: string | null } | null)[]
): { weekday: number; time: string; date: string } | null {
  let earliest: number | null = null;
  for (const p of nodes) {
    if (!p || !p.startedAt) continue;
    const ms = Date.parse(p.startedAt);
    if (Number.isNaN(ms)) continue;
    if (earliest === null || ms < earliest) earliest = ms;
  }
  if (earliest === null) return null;

  const jst = new Date(earliest + 9 * 60 * 60 * 1000);
  const weekday = jst.getUTCDay();
  const hh = String(jst.getUTCHours()).padStart(2, "0");
  const mm = String(jst.getUTCMinutes()).padStart(2, "0");
  const yyyy = jst.getUTCFullYear();
  const MM = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(jst.getUTCDate()).padStart(2, "0");
  return { weekday, time: `${hh}:${mm}`, date: `${yyyy}-${MM}-${dd}` };
}

// AnnictWork（生データ）→ AnimeItem（画面/APIが使う整形済みデータ）への変換。
// シーズン一覧（getSeasonData）と作品個別ページ（getWorkData）の両方から共有する。
export function toAnimeItem(w: import("./types").AnnictWork): import("./types").AnimeItem {
  const serviceMap = new Map<string, ServiceDef>();
  const others = new Set<string>();
  const streamingStarts: { startedAt: string | null }[] = [];

  for (const p of w.programs?.nodes ?? []) {
    // episode未紐付け等でAnnict側がnon-nullフィールド違反になった場合、
    // そのprogramノード自体がnullで返ることがある（lib/annict.tsのgql()参照）。
    if (!p) continue;
    const name = p.channel?.name;
    if (!name) continue;
    const c = classifyChannel(name);
    if (c.kind === "service") {
      serviceMap.set(c.def.key, c.def);
      streamingStarts.push({ startedAt: p.startedAt });
    } else if (c.kind === "other") {
      others.add(c.name);
      streamingStarts.push({ startedAt: p.startedAt });
    }
    // kind === "tv" は国内配信のみ表示のため捨てる（曜日/時刻の算出からも除外。理由は
    // deriveBroadcastSlot のコメント参照）
  }

  const slot = deriveBroadcastSlot(streamingStarts);

  // 声優・スタッフ名での検索用（UIには出さず、SeasonExplorerの検索マッチにのみ使う）。
  const castNames = [...new Set(w.casts.map((c) => c.name))].filter(Boolean);
  const creditNames = [
    ...new Set([
      ...castNames,
      ...w.staffs.map((s) => s.resource?.name || s.name),
    ]),
  ].filter(Boolean);

  return {
    id: w.annictId,
    title: w.title,
    image: w.image?.recommendedImageUrl || null,
    officialSiteUrl: w.officialSiteUrl || null,
    watchers: w.watchersCount ?? 0,
    services: [...serviceMap.values()].map((def) => ({
      key: def.key,
      name: def.name,
      short: def.short,
      color: def.color,
    })),
    otherServices: [...others],
    broadcastStartDate: slot?.date ?? null,
    broadcastWeekday: slot?.weekday ?? null,
    broadcastTime: slot?.time ?? null,
    creditNames,
    castNames,
    media: w.media ?? null,
  };
}

// staffs の name は「守雨「作品名」（MFブックス／KADOKAWA刊）」のような自由記述が
// 混ざることがあるため、resource側の綺麗な人物/組織名を優先する（無ければ name にフォールバック）。
function staffDisplayName(s: import("./types").RawStaffNode): string {
  return s.resource?.name || s.name;
}

// 作品個別ページ用。casts/staffs から声優・監督・製作会社・原作者を導出する。
// 該当データが無い項目は null/空配列にし、推測では埋めない（"配信情報なし"と同じ方針）。
function deriveCredits(
  castNodes: import("./types").RawCastNode[],
  staffNodes: import("./types").RawStaffNode[]
): import("./types").WorkCredits {
  const casts = castNodes.map((c) => ({
    personName: c.name,
    characterName: c.character?.name ?? "",
  }));

  const director = staffNodes.find((s) => s.roleText === "監督");
  const productionCompany = staffNodes.find(
    (s) => s.roleText === "アニメーション制作" && s.resource?.__typename === "Organization"
  );
  const originalCreators = [
    ...new Set(
      staffNodes
        .filter((s) => s.roleText === "原作" && s.resource?.__typename === "Person")
        .map((s) => staffDisplayName(s))
    ),
  ];

  return {
    casts,
    director: director ? staffDisplayName(director) : null,
    productionCompany: productionCompany ? staffDisplayName(productionCompany) : null,
    originalCreators,
  };
}

// AnnictWork → AnimeDetail への変換。作品個別ページ専用（casts/staffsの完全なクレジット付き）。
export function toAnimeDetail(w: import("./types").AnnictWork): import("./types").AnimeDetail {
  const item = toAnimeItem(w);
  return { ...item, credits: deriveCredits(w.casts, w.staffs) };
}

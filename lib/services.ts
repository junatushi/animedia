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
  | "fod" | "niconico" | "anime_houdai" | "wowow_od" | "telasa" | "youtube"
  | "crunchyroll";

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
  // 2026-07-12 service-mapper点検で発見（2026春クールの実データ、otherServicesに漏れていた）。
  { key: "crunchyroll",  name: "Crunchyroll",           short: "Crunchyroll", color: "#f47521", match: /crunchyroll/ },
];

// 配信に当たらなかった名前のうち、地上波/BS/CS など放送局を判定して除外する
// 2026-07-12追記: ぎふチャン（ひらがな表記の岐阜のCATV局）・チャンネルNECO（時代劇専門CS局）・
// 鉄道チャンネル（CS局）・カートゥーンネットワーク／ディズニー・チャンネル（CS/CATVの
// 放送チャンネルで、Disney+等の"配信"サービスとは別物）を追加（2026冬・春クールの実データより）。
const TV_PATTERN =
  /(放送|テレビ|ＴＶ|^tv|tv$|チャンネル.*放送|wowow|bs|cs|nhk|日テレ|日本テレビ|ntv|tbs|フジ|テレビ朝日|テレ朝|テレビ東京|テレ東|tokyomx|mx|tvk|サンテレビ|kbs京都|kbs|チバ|テレ玉|とちぎ|群馬|びわ湖|岐阜|ぎふ|三重|静岡|札幌|北海道|htb|stv|hbc|青森|岩手|秋田|山形|福島|新潟|長野|山梨|福井|石川|富山|広島|岡山|山口|愛媛|高知|香川|徳島|福岡|rkb|佐賀|長崎|熊本|大分|宮崎|鹿児島|沖縄|at-x|atx|アニマックス|animax|キッズステーション|キッズ|アニメシアター|メ.?テレ|チャンネルneco|鉄道チャンネル|カ-トゥ-ンネットワ-ク|cartoonnetwork|ディズニ-.?チャンネル|disneychannel)/i;

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

// Annictにまだ登録されていない配信サービスを人力で補完するためのエントリ形。
// content/works/extraServices.ts に実データを置き、getSeasonData/getWorkData から
// toAnimeItem の第2引数として注入する（libがcontentに直接依存すると、check.tsの
// node直実行・tsc・webpackの3ランタイムでimport解決が食い違うため、libは受け取る
// だけにしてcontent側には依存しない。2026-07-12導入、[[lemino-manual-fill-deferred]]
// で確立した設計を再利用）。
export interface ExtraServiceEntry {
  key: ServiceKey;
  // 一次情報（公式サイト・公式発表記事等）のURL。CLAUDE.mdの「一次情報のみ・
  // 創作しない」方針に従い必須とする。UI側で出典として表示する。
  sourceUrl: string;
  // 確認日（"YYYY-MM-DD"）。データが古くなっていないかの目安に使う。
  confirmedDate: string;
  // 任意: このサービスの配信スケジュール（曜日・時刻・初回配信日）を公式サイト等の
  // 一次情報で確認できた場合のみ指定する。Annictの実データ（streamingStarts）が
  // 1件でもあればそちらを優先し、これは「Annictに配信の実データが1件も無い」ときの
  // フォールバックとしてのみ使う（deriveBroadcastSlotと同じJST基準）。
  schedule?: { weekday: number; time: string; startDate: string };
}

// AnnictWork（生データ）→ AnimeItem（画面/APIが使う整形済みデータ）への変換。
// シーズン一覧（getSeasonData）と作品個別ページ（getWorkData）の両方から共有する。
export function toAnimeItem(
  w: import("./types").AnnictWork,
  extra: ExtraServiceEntry[] = []
): import("./types").AnimeItem {
  const serviceMap = new Map<string, ServiceDef>();
  const others = new Set<string>();
  const streamingStarts: { startedAt: string | null }[] = [];
  // 人力補完で追加したサービスkey→出典URL。UI（ServiceMarks）が「手動確認」の
  // 印と出典リンクを出すために使う（Annict由来のサービスとは区別する）。
  const manualSourceByKey = new Map<string, string>();

  // Annictにこの作品のprogramsが1件でもあるか（TV放送のみでも true）。
  // 配信サービスが0件のとき、「Annictに放送データ自体が無い」のか「TV放送はある
  // がAnnictに配信サービスがまだ登録されていない」のかをUI側で出し分けるために使う
  // （2026-07-12導入。実例: 片田舎のおっさん、剣聖になるⅡはTV放送28局分のデータは
  // あるのに配信サービス登録が0件で、両者を一律「配信情報なし」と出すと実態と違う）。
  let hasBroadcastData = false;

  for (const p of w.programs?.nodes ?? []) {
    // episode未紐付け等でAnnict側がnon-nullフィールド違反になった場合、
    // そのprogramノード自体がnullで返ることがある（lib/annict.tsのgql()参照）。
    if (!p) continue;
    const name = p.channel?.name;
    if (!name) continue;
    hasBroadcastData = true;
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

  // 人力補完サービスをマージする。Annictにその配信の実際の放送/配信日時（startedAt）は
  // 無いため、streamingStarts（曜日・時刻の算出元）には加えない（誤った時刻を創作
  // しないため）。ただしextra側で一次情報の schedule が指定されていれば、Annictの
  // 実データが無いときだけフォールバックとして使う（下のmanualSlot参照）。
  let manualSlot: { weekday: number; time: string; date: string } | null = null;
  for (const e of extra) {
    const def = SERVICES.find((s) => s.key === e.key);
    if (!def) continue; // SERVICESに存在しないkeyは無視（extraServices.tsの入力ミス対策）
    serviceMap.set(def.key, def);
    manualSourceByKey.set(def.key, e.sourceUrl);
    if (e.schedule && !manualSlot) {
      manualSlot = { weekday: e.schedule.weekday, time: e.schedule.time, date: e.schedule.startDate };
    }
  }

  // Annictの実データ（streamingStarts）があれば必ずそちらを優先する。
  // 人力のscheduleはAnnictに配信の実データが1件も無いときのフォールバック専用。
  const slot = deriveBroadcastSlot(streamingStarts) ?? manualSlot;

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
      manualSourceUrl: manualSourceByKey.get(def.key),
    })),
    otherServices: [...others],
    hasBroadcastData,
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
export function toAnimeDetail(
  w: import("./types").AnnictWork,
  extra: ExtraServiceEntry[] = []
): import("./types").AnimeDetail {
  const item = toAnimeItem(w, extra);
  return { ...item, credits: deriveCredits(w.casts, w.staffs) };
}

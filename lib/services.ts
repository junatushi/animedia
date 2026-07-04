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
  | "fod" | "niconico" | "anime_houdai" | "wowow_od" | "telasa";

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
];

// 配信に当たらなかった名前のうち、地上波/BS/CS など放送局を判定して除外する
const TV_PATTERN =
  /(放送|テレビ|ＴＶ|^tv|tv$|チャンネル.*放送|wowow|bs|cs|nhk|日テレ|日本テレビ|ntv|tbs|フジ|テレビ朝日|テレ朝|テレビ東京|テレ東|tokyomx|mx|tvk|サンテレビ|kbs京都|kbs|チバ|テレ玉|とちぎ|群馬|びわ湖|岐阜|三重|静岡|札幌|北海道|htb|stv|hbc|青森|岩手|秋田|山形|福島|新潟|長野|山梨|福井|石川|富山|広島|岡山|山口|愛媛|高知|香川|徳島|福岡|rkb|佐賀|長崎|熊本|大分|宮崎|鹿児島|沖縄|at-x|atx|アニマックス|animax|キッズステーション|キッズ|アニメシアター)/i;

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

// バッジ背景色に対して読みやすい文字色（黒 or 白）を返す
export function textOn(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#10141f" : "#ffffff";
}

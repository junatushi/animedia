// ───────────────────────────────────────────────────────────────
// アフィリエイトプログラムの登録データ（人力更新）
//   ・各配信サービスに対して、提携済みASPのリンクと報酬額を登録する。
//   ・表示時は「active かつ rewardYen が最大」のリンクが自動採用される
//     （同額なら confirmedDate が新しい方。ロジックは lib/affiliate.ts）。
//   ・報酬額はASP管理画面（ログイン制）でしか確認できないため、月1回の
//     定期確認で rewardYen / confirmedDate を更新する。更新すればリンクの
//     切り替えは自動。運用手順は docs/affiliate-setup.md。
//   ・未登録・全て inactive のサービスはCTA自体が表示されない（サイトの
//     見た目は従来のまま）。
// ───────────────────────────────────────────────────────────────
import type { ServiceKey } from "@/lib/services";

export interface AffiliateProgram {
  /** ASP名（例: "A8.net" | "afb" | "バリューコマース" | "アクセストレード" | "ドコモアフィリエイト" | "Amazonアソシエイト"） */
  asp: string;
  /** ASP管理画面で発行されたアフィリエイトリンク */
  url: string;
  /** 成果1件あたりの報酬額（円）。この値が最大のリンクが自動採用される */
  rewardYen: number;
  /** 税込/税抜と成果条件のメモ（例: "税込・無料トライアル登録"） */
  rewardNote?: string;
  /** 報酬額をASP管理画面で確認した日（"YYYY-MM-DD"） */
  confirmedDate: string;
  /** 提携終了・案件停止時に false（即座に次候補へ切替 or 非表示） */
  active: boolean;
}

// 提携承認が下りたサービスから順に追記していく。記入例:
// unext: [
//   { asp: "A8.net", url: "https://px.a8.net/svt/ejp?a8mat=XXXXX", rewardYen: 1430, rewardNote: "税込・無料トライアル登録", confirmedDate: "2026-07-20", active: true },
//   { asp: "バリューコマース", url: "https://ck.jp.ap.valuecommerce.com/servlet/referral?sid=XXXX&pid=XXXX", rewardYen: 1320, rewardNote: "税込・無料トライアル登録", confirmedDate: "2026-07-20", active: true },
// ],
export const AFFILIATE_PROGRAMS: Partial<Record<ServiceKey, AffiliateProgram[]>> = {
  abema: [
    { asp: "A8.net", url: "https://px.a8.net/svt/ejp?a8mat=4B83D3+16V93U+4EKC+60WN6", rewardYen: 902, rewardNote: "税込・新規会員登録（ABEMAプレミアム）", confirmedDate: "2026-07-24", active: true },
  ],
  prime: [
    { asp: "afb", url: "https://t.afi-b.com/visit.php?a=915733P-r510403Z&p=i9877067", rewardYen: 845, rewardNote: "税込・新規登録後7日以内のプライムビデオ初回視聴（1動画を10分以上）。他にチャンネル登録100円、レンタル・購入は税込8.47%", confirmedDate: "2026-07-28", active: true },
    { asp: "バリューコマース", url: "https://primevideojapan.sjv.io/MKAnAo", rewardYen: 836, rewardNote: "税込・新規登録後の動画視聴。他に月額サブスクリプション契約209円、レンタル・購入は税込8.36%、新規登録のみは0円", confirmedDate: "2026-07-24", active: true },
  ],
<<<<<<< HEAD
  hulu: [
    { asp: "afb", url: "https://t.afi-b.com/visit.php?a=G8792C-u506241i&p=i9877067", rewardYen: 2368, rewardNote: "税込・定額報酬（Hulu月額有料会員登録）", confirmedDate: "2026-08-10", active: true },
=======
  // 広告ID 506241 を採用。afbのHuluは広告IDごとに訴求（コナン／日テレドラマ／韓流／海外ドラマ）が
  // 分かれており、遷移先もその特集になりうる。このサイトのバッジは全アニメ作品の下に同じものが
  // 出るため、作品を限定しない汎用のHulu素材（alt="Hulu"・素材の中で最も新しい）を選んだ。
  // 素材のうち広告ID 334531 は <script> でiframeを書き出す形式のため使わない
  // （バッジはただのテキストリンクであり、他所で実行されるJSを持ち込まない方針）。
  // afbのインプレッション計測用<img>は入れていない。成果はvisit.php経由のクリックで計上される。
  hulu: [
    { asp: "afb", url: "https://t.afi-b.com/visit.php?a=G8792C-u506241i&p=i9877067", rewardYen: 2368, rewardNote: "税込・定額報酬", confirmedDate: "2026-08-10", active: true },
>>>>>>> 55168a332efd91fa0088c96340482aeea7c1821f
  ],
};

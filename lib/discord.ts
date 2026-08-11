// ───────────────────────────────────────────────────────────────
// Discord スラッシュコマンドの受け口（2026-08-07導入）。
//
// なぜ作るか:
//   調査（docs/growth-strategy-2026-08.md の Tier 2④）で、AnimeSchedule が
//   Discord bot 経由で得ている露出が「サーバー管理者が自分で見つけて追加する」形＝
//   こちらからリプライ営業をしない到達経路だと分かった。ユーザー方針
//   （リプライ・DM・フォロー営業をしない）と矛盾しない数少ない拡散手段。
//   保留されていた理由は「ホスティング費用」だったが、**常時起動のプロセスは要らない**。
//   Discord の Interactions Endpoint 方式なら、ただのHTTPエンドポイント1本で成立する
//   （Gateway に常時接続する bot とは別方式）。つまり既存のVercelに相乗りでき、
//   新しい費用も新しい運用先も発生しない。
//
// 【3秒ルール】Discord は3秒以内の応答を要求する。遅延応答（type 5）は
//   サーバーレスだと「返した後に続きを実行する」必要があって壊れやすいので使わない。
//   代わりに **キャッシュ済みのデータだけで即答する**（今期＝getSeasonDataの15分キャッシュ、
//   過去クール＝リポジトリ同梱の静的索引）。間に合わないときはサイトへのリンクを返す。
//
// 【返信の中身の制約】放送が終わった作品に「いま配信中」と書かない
//   （CLAUDE.mdの基本ルール。lib/workAvailability.ts と同じ扱い）。過去クールの作品は
//   配信サービスを列挙せず、作品ページへ案内するに留める。
//
// 素の `.ts` なのは `node scripts/check.ts` から検査できるようにするため。
// ───────────────────────────────────────────────────────────────
import { createPublicKey, verify as cryptoVerify } from "node:crypto";
import { siteUrl } from "./siteUrl.ts";

/** Discord の Interaction 種別（必要なものだけ）。 */
export const INTERACTION_PING = 1;
export const INTERACTION_COMMAND = 2;

/** 応答種別（必要なものだけ）。 */
export const RESPONSE_PONG = 1;
export const RESPONSE_MESSAGE = 4;

/** スラッシュコマンド名。Discord側の登録と一致させること。 */
export const COMMAND_NAME = "anime";
export const COMMAND_OPTION = "title";

/** 流入の実測用。ウィジェット（?ref=embed）と同じ考え方。 */
export const DISCORD_REF = "discord";

/**
 * Discord からのリクエストの署名を検証する。
 *
 * Discord はアプリごとの Ed25519 公開鍵（16進64文字）を配り、
 * `署名 = Ed25519(タイムスタンプ + 生のリクエストボディ)` を送ってくる。
 * **必ず生のボディ文字列で検証すること**（JSON.parse→stringify し直すと
 * キーの順序や空白が変わって検証に失敗する）。
 *
 * 検証に失敗したら 401 を返すこと。Discord は登録時に**わざと壊れた署名**を送って
 * 401 を返すかを確かめ、返さないエンドポイントは登録を拒否する。
 */
export function verifyDiscordSignature(
  publicKeyHex: string,
  signatureHex: string,
  timestamp: string,
  rawBody: string
): boolean {
  if (!publicKeyHex || !signatureHex || !timestamp) return false;
  if (!/^[0-9a-f]+$/i.test(publicKeyHex) || publicKeyHex.length !== 64) return false;
  if (!/^[0-9a-f]+$/i.test(signatureHex) || signatureHex.length !== 128) return false;
  try {
    // 生の32バイト公開鍵を SubjectPublicKeyInfo(DER) に包んで KeyObject にする。
    // 先頭12バイトは Ed25519 の固定ヘッダ。
    const der = Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      Buffer.from(publicKeyHex, "hex"),
    ]);
    const key = createPublicKey({ key: der, format: "der", type: "spki" });
    return cryptoVerify(
      null,
      Buffer.from(timestamp + rawBody, "utf8"),
      key,
      Buffer.from(signatureHex, "hex")
    );
  } catch {
    return false;
  }
}

/** 検索語の正規化（全角空白・前後の空白を落とす）。 */
export function normalizeQuery(s: string): string {
  return s.replace(/[\s　]+/g, " ").trim();
}

export interface DiscordWorkHit {
  id: number;
  title: string;
  /** 見放題で見られる配信サービスの短縮名。過去クールでは使わない。 */
  serviceNames: string[];
  year: number;
  season: string;
  /** 現在クールより前＝放送終了扱い（lib/workAvailability.ts の airingStatus と同じ考え方） */
  finished: boolean;
}

const SEASON_LABEL: Record<string, string> = {
  winter: "冬",
  spring: "春",
  summer: "夏",
  autumn: "秋",
};

/** 作品ページのURL（流入計測用の ?ref= 付き）。 */
export function workUrl(id: number): string {
  return `${siteUrl}/anime/${id}?ref=${DISCORD_REF}`;
}

/**
 * 返信本文を組み立てる。Discord のメッセージは Markdown が使える。
 *
 * 表現の使い分け（CLAUDE.mdの基本ルール）:
 *  - 放送中/これからの作品 … 「〜で配信されています」と言い切ってよい
 *  - 放送が終わった作品   … 「配信情報があります」までに留め、断定しない。
 *    サービス名を並べると現在の可否と誤読されるので**並べない**。
 */
export function buildAnimeReply(query: string, hit: DiscordWorkHit | null): string {
  const q = normalizeQuery(query);
  if (!hit) {
    return [
      `「${q}」は見つかりませんでした。`,
      `サイトの検索から探せます: ${siteUrl}/?ref=${DISCORD_REF}`,
    ].join("\n");
  }

  const seasonLabel = `${hit.year}年${SEASON_LABEL[hit.season] ?? ""}`;
  if (hit.finished) {
    return [
      `**${hit.title}**（${seasonLabel}）`,
      `放送が終わったクールの作品です。配信情報はこちら（現在も配信されているかは各サービスでご確認ください）:`,
      workUrl(hit.id),
    ].join("\n");
  }

  if (hit.serviceNames.length === 0) {
    return [
      `**${hit.title}**（${seasonLabel}）`,
      `配信サービスはまだ登録されていません。最新の状況はこちら:`,
      workUrl(hit.id),
    ].join("\n");
  }

  return [
    `**${hit.title}**（${seasonLabel}）`,
    `${hit.serviceNames.join("・")} で配信されています。`,
    workUrl(hit.id),
  ].join("\n");
}

/** 候補が複数あるときに並べる上限。Discordのメッセージ長と可読性の兼ね合い。 */
export const MAX_CANDIDATES = 5;

/**
 * 候補が複数見つかったときの返信。
 *
 * 【なぜ要るか・2026-08-11】
 * 一致した作品を1件だけ返していたため、「異世界」のような広い語だと**該当する
 * 他の作品があること自体が分からなかった**（利用者からの指摘）。
 * 検索欄と違ってDiscordでは絞り込みのやり直しが面倒なので、候補を並べて選べるようにする。
 *
 * ここでは配信サービス名を**並べない**。1作品あたり1行に収めないとメッセージが
 * 長くなりすぎるうえ、放送終了作品が混ざったときに現在の可否と誤読される
 * （CLAUDE.mdの基本ルール）。サービス名は作品を特定してから出す。
 */
export function buildCandidatesReply(query: string, hits: DiscordWorkHit[]): string {
  const q = normalizeQuery(query);
  const shown = hits.slice(0, MAX_CANDIDATES);
  const lines = shown.map((h) => `・**${h.title}** ${workUrl(h.id)}`);
  const head =
    hits.length > MAX_CANDIDATES
      ? `「${q}」に一致する作品が ${hits.length} 件あります（上位${MAX_CANDIDATES}件）:`
      : `「${q}」に一致する作品が ${hits.length} 件あります:`;
  return [
    head,
    ...lines,
    `作品名をもう少し詳しく入れると1件に絞れます。`,
  ].join("\n");
}

/** Discord に返す JSON（メッセージ）。 */
export function messageResponse(content: string) {
  return {
    type: RESPONSE_MESSAGE,
    data: {
      content,
      // 埋め込みプレビューを抑制しない（作品ページのOGPを出したいため）。
      // allowed_mentions は空にして、返信が誰かにメンションを飛ばさないようにする。
      allowed_mentions: { parse: [] as string[] },
    },
  };
}

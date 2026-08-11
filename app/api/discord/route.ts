import { NextResponse } from "next/server";
import { getSeasonData } from "@/lib/getSeasonData";
import { splitRentalServices } from "@/lib/services";
import { RENTAL_SERVICES } from "@/content/works/rentalServices";
import { currentYearSeason } from "@/lib/resolveSeasonParams";
import { DISCORD_PUBLIC_KEY_FALLBACK } from "@/content/discord/publicKey";
import {
  COMMAND_NAME,
  COMMAND_OPTION,
  INTERACTION_COMMAND,
  INTERACTION_PING,
  RESPONSE_PONG,
  buildAnimeReply,
  messageResponse,
  normalizeQuery,
  verifyDiscordSignature,
  type DiscordWorkHit,
} from "@/lib/discord";

// Discord スラッシュコマンドの受け口（2026-08-07導入）。設計理由は lib/discord.ts の冒頭。
//
// runtime を nodejs にしているのは Ed25519 の検証に node:crypto を使うため。
// dynamic を force-dynamic にしているのは、署名検証が生のリクエストボディに依存し、
// キャッシュされては困るため。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 今期データの取得に使える時間の上限。Discord の3秒ルールに対して余裕を取る。
// 超えたらサイトへのリンクだけ返す（黙って落とさない）。
const DATA_TIMEOUT_MS = 2000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

export async function POST(request: Request) {
  // 環境変数を優先し、無ければリポジトリ同梱の値を使う。
  // Public Key は秘密情報ではない（署名の検証専用で、偽造には使えない）ため
  // コミットしてよい。理由と経緯は content/discord/publicKey.ts の冒頭。
  const publicKey = process.env.DISCORD_PUBLIC_KEY || DISCORD_PUBLIC_KEY_FALLBACK;
  if (!publicKey) {
    // 未設定なら機能自体が無効。Discord側から見ると登録に失敗するだけで、
    // サイトの他の機能には影響しない。
    return new NextResponse("Discord integration is not configured", { status: 503 });
  }

  // 【重要】必ず生のボディ文字列で検証する（JSONに直してから戻すと検証に失敗する）。
  const rawBody = await request.text();
  const signature = request.headers.get("x-signature-ed25519") ?? "";
  const timestamp = request.headers.get("x-signature-timestamp") ?? "";

  if (!verifyDiscordSignature(publicKey, signature, timestamp, rawBody)) {
    // Discord はエンドポイント登録時にわざと壊れた署名を送り、401 を返すかを確かめる。
    return new NextResponse("invalid request signature", { status: 401 });
  }

  let body: {
    type?: number;
    data?: { name?: string; options?: { name?: string; value?: unknown }[] };
  };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new NextResponse("bad request", { status: 400 });
  }

  // 疎通確認（Discord が定期的に送ってくる）。
  if (body.type === INTERACTION_PING) {
    return NextResponse.json({ type: RESPONSE_PONG });
  }

  if (body.type !== INTERACTION_COMMAND || body.data?.name !== COMMAND_NAME) {
    return NextResponse.json(
      messageResponse(`使い方: /${COMMAND_NAME} ${COMMAND_OPTION}:<作品名>`)
    );
  }

  const raw = body.data.options?.find((o) => o.name === COMMAND_OPTION)?.value;
  const query = normalizeQuery(typeof raw === "string" ? raw : "");
  if (!query) {
    return NextResponse.json(
      messageResponse(`作品名を入れてください。例: /${COMMAND_NAME} ${COMMAND_OPTION}:リゼロ`)
    );
  }

  // 今期のデータだけを対象にする。キャッシュ済み（15分）なので即答でき、
  // 3秒ルールに間に合う。過去クールの横断検索はここでは行わず、見つからなければ
  // サイトの検索へ案内する（lib/discord.ts の設計メモを参照）。
  const { year, season } = currentYearSeason();
  const data = await withTimeout(getSeasonData(year, season), DATA_TIMEOUT_MS);

  let hit: DiscordWorkHit | null = null;
  if (data) {
    const needle = query.toLowerCase();
    const found =
      data.items.find((it) => it.title.toLowerCase() === needle) ??
      data.items.find((it) => it.title.toLowerCase().includes(needle));
    if (found) {
      hit = {
        id: found.id,
        title: found.title,
        serviceNames: splitRentalServices(
          found.services,
          RENTAL_SERVICES[found.id]
        ).streaming.map((s) => s.short),
        year: Number(year),
        season,
        // 今期のデータしか見ていないので、ここに入るのは常に放送中/これから。
        finished: false,
      };
    }
  }

  return NextResponse.json(messageResponse(buildAnimeReply(query, hit)));
}

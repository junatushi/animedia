// 配信開始メール通知のバッチ本体。GitHub Actions（.github/workflows/notify-run.yml）
// から毎日1回、x-cron-secretヘッダー付きで叩かれる。人間のブラウザからは使わない。
//
// 処理の流れ:
//  1. notify_requestsから重複無しのwork_id一覧を取得（service-role clientでRLSを越える）
//  2. 各作品をfetchWorkById（話数が要るので withEpisode: true）で個別取得し、
//     programsの中から「今日（JST）・再放送でない」
//     番組を探す（曜日の推測ではなく実際のstartedAtの日付で照合するため、特番週・休止週
//     での誤爆が無い）。見つかった作品だけが「今日配信がある」対象になる
//  3. 対象作品ごとにnotify_requestsを引き、購読ユーザーを集める→ユーザー単位で
//     その日届く作品をまとめ、1人1通のダイジェストメールをResendで送る
import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/safeEqual";
import { Resend } from "resend";
import { createServiceClient } from "@/lib/supabase/service";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { fetchWorkById } from "@/lib/annict";
import { toAnimeItem } from "@/lib/services";
import { signUnsubscribeToken } from "@/lib/notifyUnsubscribeToken";
import { parseWorkIdValue } from "@/lib/workId";

import { siteUrl as SITE_URL } from "@/lib/siteUrl";
// Annictへの直列アクセスを緩やかにする（対象作品数が多い日でもバーストさせない）。
const FETCH_DELAY_MS = 500;
// 1回の実行で問い合わせる作品数の上限（2026-11-05）。200件×0.5秒＝100秒＋取得時間。
const MAX_WORKS_PER_RUN = 200;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// programs.nodesのstartedAtをJST日付（YYYY-MM-DD）に変換する。
// lib/services.tsのderiveBroadcastSlotと同じ変換方式（UTC+9h）。
function toJstDateString(iso: string): string | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const jst = new Date(ms + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

interface TodayAiringWork {
  workId: number;
  title: string;
  episodeText: string | null;
  serviceNames: string[];
}

export async function POST(request: Request) {
  const cronSecret = process.env.NOTIFY_CRON_SECRET;
  if (!safeEqual(request.headers.get("x-cron-secret"), cronSecret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const annictToken = process.env.ANNICT_TOKEN;
  const resendKey = process.env.RESEND_API_KEY;
  if (!isSupabaseConfigured() || !annictToken || !resendKey || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    // 外部セットアップ未完了。cronからの定期呼び出しでエラーログを埋めないよう200で終える。
    return NextResponse.json({ skipped: true, reason: "not configured" });
  }

  const supabase = createServiceClient();
  const resend = new Resend(resendKey);
  const today = toJstDateString(new Date().toISOString())!;

  // 1. 通知希望のある作品ID（重複無し）を集める
  const { data: allRequests, error: reqError } = await supabase
    .from("notify_requests")
    .select("work_id, user_id");
  if (reqError) {
    console.error("notify/run:", reqError.message);
    return NextResponse.json({ error: "notify_requests の取得に失敗" }, { status: 500 });
  }
  // 値域外のID（古い経路で入った小数・負数など）は問い合わせない。さらに1回の実行で
  // 問い合わせる作品数に上限を置く（1件0.5秒の間隔なので、上限が無いと登録数しだいで
  // 関数の時間制限を超え、全員の通知が止まる）。超えた分は応答の truncated に出す。
  const validIds = [...new Set(allRequests.map((r) => parseWorkIdValue(r.work_id)))].filter(
    (id): id is number => id !== null
  );
  const workIds = validIds.slice(0, MAX_WORKS_PER_RUN);
  const truncated = validIds.length - workIds.length;

  // 2. 各作品を個別取得し、今日配信があるかを実日付で判定する
  const todayAiring: TodayAiringWork[] = [];
  for (const workId of workIds) {
    // withEpisode: true はこの通知バッチ専用。話数（「第5話」）を本文に出すために
    // episode を要求する2本目のクエリを投げ、取れた分だけ重ねる（lib/annict.ts の
    // mergeEpisodeInfo）。episode を最初のクエリで要求すると program ノードごと
    // 消えて配信サービスまで失うため、この形でなければならない（2026-08-16）。
    const work = await fetchWorkById(workId, annictToken, { withEpisode: true });
    await sleep(FETCH_DELAY_MS);
    if (!work) continue;

    const todaysProgram = (work.programs?.nodes ?? []).find(
      (p) => p && p.startedAt && !p.rebroadcast && toJstDateString(p.startedAt) === today
    );
    if (!todaysProgram) continue;

    const services = toAnimeItem(work).services;
    todayAiring.push({
      workId,
      title: work.title,
      episodeText: todaysProgram.episode?.numberText ?? null,
      serviceNames: services.map((s) => s.short),
    });
  }

  if (todayAiring.length === 0) {
    return NextResponse.json({ sent: 0, todayAiringCount: 0, truncated });
  }

  // 3. 対象作品ごとに購読者を引き、ユーザー単位でまとめる
  const byUser = new Map<string, TodayAiringWork[]>();
  for (const item of todayAiring) {
    const subscribers = allRequests.filter((r) => r.work_id === item.workId).map((r) => r.user_id);
    for (const userId of subscribers) {
      const list = byUser.get(userId) ?? [];
      list.push(item);
      byUser.set(userId, list);
    }
  }

  let sent = 0;
  for (const [userId, items] of byUser) {
    const { data: userData } = await supabase.auth.admin.getUserById(userId);
    const email = userData?.user?.email;
    if (!email) continue;

    const unsubToken = signUnsubscribeToken(userId);
    const unsubUrl = `${SITE_URL}/api/notify/unsubscribe?uid=${encodeURIComponent(userId)}&token=${encodeURIComponent(unsubToken)}`;

    const lines = items.map((it) => {
      const ep = it.episodeText ? `${it.episodeText} ` : "";
      const svc = it.serviceNames.length > 0 ? it.serviceNames.join("・") : "配信情報なし";
      return `《${it.title}》${ep}本日配信 — 配信先: ${svc}\n${SITE_URL}/anime/${it.workId}`;
    });
    const text = [
      "本日配信のアニメをお知らせします（アニメ視聴ガイド）。",
      "",
      ...lines,
      "",
      "---",
      "配信通知をすべて停止する:",
      unsubUrl,
    ].join("\n");

    await resend.emails.send({
      from: "アニメ視聴ガイド <onboarding@resend.dev>",
      to: email,
      subject: "本日配信のアニメ（アニメ視聴ガイド）",
      text,
      // メールクライアントの「登録解除」ボタン（RFC 8058のワンクリック解除）。
      // 解除先は POST だけで消す（app/api/notify/unsubscribe/route.ts。GETは確認画面）。
      headers: {
        "List-Unsubscribe": `<${unsubUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    sent++;
  }

  return NextResponse.json({ sent, todayAiringCount: todayAiring.length, truncated });
}

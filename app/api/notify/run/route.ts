// 配信開始メール通知のバッチ本体。GitHub Actions（.github/workflows/notify-run.yml）
// から毎日1回、x-cron-secretヘッダー付きで叩かれる。人間のブラウザからは使わない。
//
// 処理の流れ:
//  1. notify_requestsから重複無しのwork_id一覧を取得（service-role clientでRLSを越える）
//  2. 各作品をfetchWorkByIdで個別取得し、programsの中から「今日（JST）・再放送でない」
//     番組を探す（曜日の推測ではなく実際のstartedAtの日付で照合するため、特番週・休止週
//     での誤爆が無い）。見つかった作品だけが「今日配信がある」対象になる
//  3. 対象作品ごとにnotify_requestsを引き、購読ユーザーを集める→ユーザー単位で
//     その日届く作品をまとめ、1人1通のダイジェストメールをResendで送る
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createServiceClient } from "@/lib/supabase/service";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { fetchWorkById } from "@/lib/annict";
import { toAnimeItem } from "@/lib/services";
import { signUnsubscribeToken } from "@/lib/notifyUnsubscribeToken";

const SITE_URL = "https://animedia-khaki.vercel.app";
// Annictへの直列アクセスを緩やかにする（対象作品数が多い日でもバーストさせない）。
const FETCH_DELAY_MS = 500;

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
  if (!cronSecret || request.headers.get("x-cron-secret") !== cronSecret) {
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
    return NextResponse.json({ error: reqError.message }, { status: 500 });
  }
  const workIds = [...new Set(allRequests.map((r) => r.work_id))];

  // 2. 各作品を個別取得し、今日配信があるかを実日付で判定する
  const todayAiring: TodayAiringWork[] = [];
  for (const workId of workIds) {
    const work = await fetchWorkById(workId, annictToken);
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
    return NextResponse.json({ sent: 0, todayAiringCount: 0 });
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
    });
    sent++;
  }

  return NextResponse.json({ sent, todayAiringCount: todayAiring.length });
}

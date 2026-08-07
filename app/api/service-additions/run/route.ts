// 「配信サービスが新しく登録された」ことの検知バッチ。
// .github/workflows/service-additions.yml から毎日1回、x-cron-secret付きで叩かれる。
// 判定ロジックは lib/serviceAdditions.ts（純粋関数。scripts/check.ts が検査する）。
//
// ここがやるのは「今日のシーズンデータを取る」「保存されている観測記録と突き合わせる」
// 「書き戻す」の3つだけ。**メール送信は一切しない**（docs/operations.md ⑱-13）。
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getSeasonData } from "@/lib/getSeasonData";
import { splitRentalServices } from "@/lib/services";
import { RENTAL_SERVICES } from "@/content/works/rentalServices";
import { currentSeasonKey } from "@/lib/resolveSeasonParams";
import { applySightings, type Sighting, type TodayPair } from "@/lib/serviceAdditions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLE = "service_sightings";

/** JSTの今日（YYYY-MM-DD）。lib/services.ts の変換方式と揃える。 */
function jstToday(): string {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, "0")}-${String(
    jst.getUTCDate()
  ).padStart(2, "0")}`;
}

export async function POST(request: Request) {
  const secret = process.env.NOTIFY_CRON_SECRET;
  if (!secret || request.headers.get("x-cron-secret") !== secret) {
    return new NextResponse("unauthorized", { status: 401 });
  }
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    // 外部セットアップ未完了の間は静かに何もしない（他の機能に影響させない）。
    return NextResponse.json({ skipped: true, reason: "supabase未設定" });
  }

  const season = currentSeasonKey();
  const [year, seasonName] = season.split("-");

  let items;
  try {
    items = (await getSeasonData(year, seasonName)).items;
  } catch (e) {
    // 上流が落ちている日は「全サービスが消えた」ように見える。何も書かずに終わる
    // （消えたことは扱わない、という方針と合わせて、連続日数を壊さないため）。
    return NextResponse.json(
      { skipped: true, reason: e instanceof Error ? e.message : "取得に失敗" },
      { status: 502 }
    );
  }

  const today: TodayPair[] = [];
  for (const it of items) {
    // レンタル/都度課金は「契約すれば見られる」ではないので対象外
    // （視聴プラン・対応本数の集計と同じ扱い）。
    for (const s of splitRentalServices(it.services, RENTAL_SERVICES[it.id]).streaming) {
      today.push({
        workId: it.id,
        workTitle: it.title,
        serviceKey: s.key,
        serviceShort: s.short,
      });
    }
  }

  const supabase = createServiceClient();
  const { data: rows, error } = await supabase
    .from(TABLE)
    .select("work_id, service_key, last_seen, streak, reported_on")
    .eq("season", season);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const existing: Sighting[] = (rows ?? []).map((r) => ({
    workId: r.work_id as number,
    serviceKey: r.service_key as string,
    lastSeen: r.last_seen as string,
    streak: r.streak as number,
    reportedOn: (r.reported_on as string | null) ?? null,
  }));

  // 【種まき】このクールの記録がまだ1件も無いなら初回。既存のペアを
  // 「新規追加」と誤認しないよう、全部を報告済みとして黙って記録する。
  const seed = existing.length === 0;

  const { upserts, confirmed } = applySightings(
    existing,
    today,
    jstToday(),
    season,
    seed
  );

  if (upserts.length > 0) {
    const { error: upErr } = await supabase.from(TABLE).upsert(
      upserts.map((u) => ({
        work_id: u.workId,
        service_key: u.serviceKey,
        season: u.season,
        work_title: u.workTitle,
        service_short: u.serviceShort,
        last_seen: u.lastSeen,
        streak: u.streak,
        reported_on: u.reportedOn,
      })),
      { onConflict: "work_id,service_key" }
    );
    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    season,
    seeded: seed,
    tracked: upserts.length,
    confirmed: confirmed.map((c) => ({
      workId: c.workId,
      title: c.workTitle,
      service: c.serviceShort,
    })),
  });
}

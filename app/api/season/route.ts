// ───────────────────────────────────────────────────────────────
// API ルート（収集①＋正規化②をつなぐ窓口）
//   GET /api/season?year=2026&season=spring
//   season は winter | spring | summer | autumn
//   トークンはここ（サーバー側）でだけ使われ、ブラウザには出ない。
// ───────────────────────────────────────────────────────────────
import { NextResponse } from "next/server";
import { fetchSeasonWorks } from "@/lib/annict";
import { classifyChannel } from "@/lib/services";
import type { AnimeItem, ServiceTag, SeasonResponse } from "@/lib/types";

const VALID_SEASONS = new Set(["winter", "spring", "summer", "autumn"]);

export async function GET(req: Request) {
  const token = process.env.ANNICT_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "ANNICT_TOKEN が未設定です。プロジェクト直下に .env.local を作り、トークンを設定してください。" },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(req.url);
  const year = searchParams.get("year");
  const season = searchParams.get("season");

  if (!year || !/^\d{4}$/.test(year) || !season || !VALID_SEASONS.has(season)) {
    return NextResponse.json(
      { error: "year（4桁）と season（winter/spring/summer/autumn）を指定してください。" },
      { status: 400 }
    );
  }

  const seasonStr = `${year}-${season}`;

  try {
    const works = await fetchSeasonWorks(seasonStr, token);

    const items: AnimeItem[] = works
      .map((w): AnimeItem => {
        const serviceMap = new Map<string, ServiceTag>();
        const others = new Set<string>();

        for (const p of w.programs?.nodes ?? []) {
          const name = p.channel?.name;
          if (!name) continue;
          const c = classifyChannel(name);
          if (c.kind === "service") {
            serviceMap.set(c.def.key, {
              key: c.def.key,
              name: c.def.name,
              short: c.def.short,
              color: c.def.color,
            });
          } else if (c.kind === "other") {
            others.add(c.name);
          }
          // kind === "tv" は国内配信のみ表示のため捨てる
        }

        return {
          id: w.annictId,
          title: w.title,
          image: w.image?.recommendedImageUrl || null,
          officialSiteUrl: w.officialSiteUrl || null,
          watchers: w.watchersCount ?? 0,
          services: [...serviceMap.values()],
          otherServices: [...others],
        };
      })
      .sort((a, b) => b.watchers - a.watchers);

    const body: SeasonResponse = { season: seasonStr, count: items.length, items };
    return NextResponse.json(body);
  } catch (e) {
    const message = e instanceof Error ? e.message : "取得に失敗しました。";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

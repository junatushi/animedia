// ───────────────────────────────────────────────────────────────
// SNS投稿添付用のPNG画像を返すルート（2026-07-27導入）。
//   GET /api/sns-image?kind=ranking             … 今期の注目作TOP5
//   GET /api/sns-image?kind=airing&day=月        … その曜日に放送/配信がある今期作品
//
// なぜ必要か: Threads APIは画像投稿に image_url（公開サーバー上のURL）しか受け付けず、
// バイナリの直接アップロードに対応していない（"We will cURL your image using the URL
// provided so it must be on a public server."）。Bluesky/MastodonにはPlaywrightで撮った
// PNGバイナリを添付できるが、Threadsだけはこの方式が使えず画像なし投稿になっていた。
// そこでサイト自身がPlaywright撮影と同等の内容（TOP5パネル・曜日別カレンダー相当）を
// next/og の ImageResponse で公開URLとして配信し、Threadsから直接cURLさせる。
//
// runtimeは既存のOG画像2本（app/opengraph-image.tsx、app/anime/[id]/opengraph-image.tsx）と
// 同じ edge に揃える。nodejs runtime だと next/og が同梱フォントを file:// URL として
// 読み込む際にWindowsのパス区切りで壊れ、ローカル開発機では常に例外になる
// （＝手元で一切検証できないまま本番に出すことになる）。edgeならローカルでも本番でも
// 同じ経路で動くため、実際に叩いて確認できる。
//
// edgeでは fs を使う getSeasonData を呼べないので、データはサイト自身の公開API
// （/api/season）から取る。SNS投稿を組み立てる scripts/lib/build-digest.js が使うのと
// 同じ窓口で、CDNキャッシュ（s-maxage=600）も効くため追加負荷は小さい。
// originはリクエストURLから取る（本番URLをハードコードすると開発サーバーで叩いたときに
// 本番データを見に行ってしまい、検証にならないため）。
import { ImageResponse } from "next/og";
import { loadGoogleFont } from "@/lib/ogFont";
import type { SeasonResponse } from "@/lib/types";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const SIZE = { width: 1200, height: 630 };
const FONT_NAME = "Noto Sans JP";
const BRAND = "アニメ視聴ガイド";
const TAGLINE = "配信状況をサービス別にスキャン";
const EYEBROW = "アニメ視聴ガイド ｜ 配信状況";
// scripts/lib/build-digest.js の WEEKDAY_LABEL と同じ並び（0=日〜6=土）。
const WEEKDAY_LABEL = ["日", "月", "火", "水", "木", "金", "土"];

// Threads側が何度も取得しても重くならないよう1時間キャッシュ（CDNエッジ向け）。
const CACHE_HEADERS = { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" };

// 長いタイトルでもレイアウトが崩れないよう文字数で切る（anime/[id]/opengraph-image.tsx と同じ方式）。
function truncate(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : chars.slice(0, max - 1).join("") + "…";
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// scripts/lib/build-digest.js の jstParts と同じ結果になるようにする
// （GitHub Actionsランナー同様、サーバーもUTCで動く前提でJSTに変換する）。
function jstParts(now: Date) {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return {
    year: jst.getUTCFullYear(),
    month: jst.getUTCMonth() + 1,
    day: jst.getUTCDate(),
  };
}

// scripts/lib/build-digest.js の currentSeasonByMonth と同じ結果になるようにする。
function currentSeasonByMonth(m: number): { key: string; label: string } {
  if (m <= 3) return { key: "winter", label: "冬" };
  if (m <= 6) return { key: "spring", label: "春" };
  if (m <= 9) return { key: "summer", label: "夏" };
  return { key: "autumn", label: "秋" };
}

async function fetchSeasonData(origin: string, year: number, seasonKey: string): Promise<SeasonResponse> {
  const res = await fetch(`${origin}/api/season?year=${year}&season=${seasonKey}`);
  if (!res.ok) throw new Error(`season API ${res.status}`);
  return (await res.json()) as SeasonResponse;
}

// 今期の注目作TOP5（watchers降順）。scripts/lib/build-digest.js の buildTop5 と同じ抽出条件。
async function renderRanking(data: SeasonResponse, year: number, label: string): Promise<ImageResponse> {
  const top5 = [...data.items].sort((a, b) => b.watchers - a.watchers).slice(0, 5);
  const heading = `${year}年${label}アニメ 注目作TOP5`;
  const rows = top5.map((it, i) => ({
    rank: i + 1,
    title: truncate(it.title, 22),
    watchers: `${it.watchers.toLocaleString("ja-JP")}人が注目`,
  }));

  // 描画する全文字（動的なタイトル・数字を含む）をまとめてGoogle Fontsに渡す。
  const fontText = EYEBROW + heading + BRAND + rows.map((r) => `${r.rank}${r.title}${r.watchers}`).join("");
  const fontData = await loadGoogleFont(fontText);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "linear-gradient(135deg, #060a16 0%, #0b1526 55%, #0f1f34 100%)",
          fontFamily: FONT_NAME,
        }}
      >
        <div style={{ display: "flex", width: "100%", height: 6, background: "linear-gradient(90deg, #3fa9f5, #8ecbff)" }} />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            justifyContent: "center",
            padding: "0 84px",
          }}
        >
          <div style={{ display: "flex", fontSize: 20, letterSpacing: 4, color: "#8ecbff", marginBottom: 16 }}>
            {EYEBROW}
          </div>
          <div style={{ display: "flex", fontSize: 48, fontWeight: 900, color: "#f2f9ff", lineHeight: 1.15, marginBottom: 28 }}>
            {heading}
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {rows.map((r, i) => (
              <div key={r.rank} style={{ display: "flex", alignItems: "center", marginTop: i === 0 ? 0 : 14 }}>
                <div
                  style={{
                    display: "flex",
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    background: "linear-gradient(135deg, #3fa9f5, #8ecbff)",
                    color: "#060a16",
                    fontSize: 22,
                    fontWeight: 900,
                    alignItems: "center",
                    justifyContent: "center",
                    marginRight: 22,
                  }}
                >
                  {r.rank}
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <div style={{ display: "flex", fontSize: 28, fontWeight: 900, color: "#f2f9ff" }}>{r.title}</div>
                  <div style={{ display: "flex", fontSize: 18, color: "#8ecbff", marginTop: 2 }}>{r.watchers}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", fontSize: 18, color: "#5f7fa3", marginTop: 28 }}>{BRAND}</div>
        </div>
      </div>
    ),
    { ...SIZE, fonts: [{ name: FONT_NAME, data: fontData, style: "normal", weight: 900 }], headers: CACHE_HEADERS }
  );
}

// その曜日に放送/配信がある今期作品。scripts/lib/build-digest.js の buildTodayAiring と同じ抽出条件
// （broadcastWeekday一致 かつ 放送開始1週間前ルール＝broadcastStartDateが今日以前）。
async function renderAiring(
  data: SeasonResponse,
  weekdayIdx: number,
  year: number,
  label: string,
  todayStr: string
): Promise<ImageResponse> {
  const items = data.items
    .filter((it) => it.broadcastWeekday === weekdayIdx)
    .filter((it) => !it.broadcastStartDate || it.broadcastStartDate <= todayStr)
    .sort((a, b) => b.watchers - a.watchers);

  const MAX_ROWS = 6;
  const visible = items.slice(0, MAX_ROWS);
  const restCount = items.length - visible.length;
  const overflowText = restCount > 0 ? `ほか${restCount}作品` : "";
  const emptyText = visible.length === 0 ? "該当する配信・放送はありません" : "";

  const wl = WEEKDAY_LABEL[weekdayIdx];
  const heading = `【${wl}曜】今日放送・配信の今期アニメ`;
  const rows = visible.map((it) => ({
    title: truncate(it.title, 20),
    time: it.broadcastTime ? `${it.broadcastTime}〜` : "",
  }));

  const fontText =
    EYEBROW + heading + BRAND + overflowText + emptyText + rows.map((r) => `${r.title}${r.time}`).join("");
  const fontData = await loadGoogleFont(fontText);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "linear-gradient(135deg, #060a16 0%, #0b1526 55%, #0f1f34 100%)",
          fontFamily: FONT_NAME,
        }}
      >
        <div style={{ display: "flex", width: "100%", height: 6, background: "linear-gradient(90deg, #3fa9f5, #8ecbff)" }} />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            justifyContent: "center",
            padding: "0 84px",
          }}
        >
          <div style={{ display: "flex", fontSize: 20, letterSpacing: 4, color: "#8ecbff", marginBottom: 16 }}>
            {EYEBROW}
          </div>
          <div style={{ display: "flex", fontSize: 44, fontWeight: 900, color: "#f2f9ff", lineHeight: 1.15, marginBottom: 28 }}>
            {heading}
          </div>
          {emptyText ? (
            <div style={{ display: "flex", fontSize: 26, color: "#85a4c4" }}>{emptyText}</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {rows.map((r, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", marginTop: i === 0 ? 0 : 12 }}>
                  <div style={{ display: "flex", width: 10, height: 10, borderRadius: 5, background: "#3fa9f5", marginRight: 20 }} />
                  <div style={{ display: "flex", fontSize: 26, fontWeight: 900, color: "#f2f9ff", flex: 1 }}>{r.title}</div>
                  {r.time && <div style={{ display: "flex", fontSize: 20, color: "#8ecbff", marginLeft: 20 }}>{r.time}</div>}
                </div>
              ))}
            </div>
          )}
          {overflowText && (
            <div style={{ display: "flex", fontSize: 20, color: "#85a4c4", marginTop: 18 }}>{overflowText}</div>
          )}
          <div style={{ display: "flex", fontSize: 18, color: "#5f7fa3", marginTop: 28 }}>{BRAND}</div>
        </div>
      </div>
    ),
    { ...SIZE, fonts: [{ name: FONT_NAME, data: fontData, style: "normal", weight: 900 }], headers: CACHE_HEADERS }
  );
}

// 不正なkind/day、データ取得失敗時のフォールバック（app/opengraph-image.tsx相当のブランド画像）。
// SNS投稿の画像取得が丸ごと失敗するのを避けるため、500ではなくこれを返す。
async function renderFallback(): Promise<ImageResponse> {
  const fontData = await loadGoogleFont(BRAND + TAGLINE);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "linear-gradient(135deg, #060a16 0%, #0b1526 55%, #0f1f34 100%)",
          fontFamily: FONT_NAME,
        }}
      >
        <div style={{ display: "flex", width: "100%", height: 6, background: "linear-gradient(90deg, #3fa9f5, #8ecbff)" }} />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            justifyContent: "center",
            alignItems: "center",
            padding: "0 84px",
          }}
        >
          <div style={{ display: "flex", fontSize: 80, fontWeight: 900, color: "#f2f9ff" }}>{BRAND}</div>
          <div style={{ display: "flex", fontSize: 32, color: "#8ecbff", marginTop: 24 }}>{TAGLINE}</div>
        </div>
      </div>
    ),
    { ...SIZE, fonts: [{ name: FONT_NAME, data: fontData, style: "normal", weight: 900 }], headers: CACHE_HEADERS }
  );
}

export async function GET(req: Request): Promise<ImageResponse | Response> {
  const { searchParams } = new URL(req.url);
  const kind = searchParams.get("kind");
  const dayParam = searchParams.get("day");

  try {
    const origin = new URL(req.url).origin;
    const { year, month, day } = jstParts(new Date());
    const { key: seasonKey, label } = currentSeasonByMonth(month);
    const todayStr = `${year}-${pad2(month)}-${pad2(day)}`;

    if (kind === "ranking") {
      const data = await fetchSeasonData(origin, year, seasonKey);
      return await renderRanking(data, year, label);
    }

    if (kind === "airing") {
      const weekdayIdx = dayParam ? WEEKDAY_LABEL.indexOf(dayParam) : -1;
      if (weekdayIdx === -1) {
        return await renderFallback();
      }
      const data = await fetchSeasonData(origin, year, seasonKey);
      return await renderAiring(data, weekdayIdx, year, label, todayStr);
    }

    // kind未指定・未知の値
    return await renderFallback();
  } catch {
    // データ取得・フォント取得の失敗時もSNS投稿が画像なしで丸ごと落ちないよう、
    // ブランドだけのフォールバック画像を返す（500にしない）。
    try {
      return await renderFallback();
    } catch {
      // フォールバック生成自体が失敗する（Google Fontsに完全に到達不能等）、
      // 最後の手段としてのみ非200を返す。
      return new Response("image generation failed", { status: 502 });
    }
  }
}

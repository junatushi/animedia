"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { track } from "@vercel/analytics";
import { textOn } from "@/lib/services";
import { CHANGELOG } from "@/lib/changelog";
import ThemeToggle from "./ThemeToggle";
import ScrollTopButton from "./ScrollTopButton";
import type { AnimeItem, SeasonResponse, ServiceTag } from "@/lib/types";

const SEASONS = [
  { key: "winter", label: "冬" },
  { key: "spring", label: "春" },
  { key: "summer", label: "夏" },
  { key: "autumn", label: "秋" },
] as const;
const SEASON_KEYS = new Set(SEASONS.map((s) => s.key));

const SEASON_LABEL: Record<string, string> = {
  winter: "冬",
  spring: "春",
  summer: "夏",
  autumn: "秋",
};

function currentSeasonKey(): string {
  const m = new Date().getMonth() + 1;
  if (m <= 3) return "winter";
  if (m <= 6) return "spring";
  if (m <= 9) return "summer";
  return "autumn";
}

// 作品サムネイルは表示しない方針。配信各社・権利者の画像（キービジュアル等）を
// 無断で読み込み表示しないための著作権配慮。代わりに作品ごとに色違いの
// グラデーション＋頭文字（モノグラム）の「デザインタイル」を生成して空欄を避ける。
function posterStyle(id: number): React.CSSProperties {
  // 作品ごとの揺らぎ（無単位）だけを CSS 変数で渡し、実際のグラデーションは
  // globals.css の .thumb-empty 側で組み立てる。こうするとダーク（蒼のタイル）と
  // ライト（アスナ基調の淡い緋色タイル）をテーマごとに切り替えられる。
  return {
    "--tvs": id % 5,
    "--tvl": id % 4,
    "--tvl2": (id * 3) % 4,
  } as React.CSSProperties;
}
// 作品種別プレフィックスと、タイルに添える種別マーク（上から順に判定）。
//  劇場公開系＝《劇》 ／ OVA・OAD＝《O》 ／ 総集編＝《総》
// ※「劇場総集編」は劇場公開なので《劇》、単独の「総集編」は《総》に振り分ける。
const TITLE_KINDS: Array<[RegExp, string]> = [
  [/^(劇場版|劇場総集編|劇場編集版|劇場|映画)\s*/, "《劇》"],
  [/^(OVA|OAD)\s*/, "《O》"],
  [/^(総集編|TV総集編|テレビ総集編)\s*/, "《総》"],
];
// 先頭にあっても識別に役立たない記号・約物・空白（「」〈〉！ 等）。
const LEADING_SKIP = /[\p{P}\p{S}\s]/u;

// モノグラム＝画像の代わりにタイルへ出す頭文字。作品を見分けやすくするため、
//  ・劇場版/映画/OVA/総集編 … 種別を外して本体頭字＋種別マーク（劇/O/総）
//  ・記号始まり             … 記号を飛ばして中身の頭字（記号だけの無意味表示を避ける）
function monogram(title: string): { mark: string; core: string } {
  let t = title.trim();
  let mark = "";
  for (const [re, label] of TITLE_KINDS) {
    const m = t.match(re);
    if (m) {
      mark = label;
      t = t.slice(m[0].length).trim();
      break;
    }
  }
  const chars = [...t];
  let i = 0;
  while (i < chars.length && LEADING_SKIP.test(chars[i])) i++;
  // 中身が全部記号という稀なケースは、記号込みで頭2字を出す。
  const core = i >= chars.length ? chars.slice(0, 2).join("") || "?" : chars[i];
  return { mark, core };
}

// モノグラムのタイル表示（「（劇）」は小さく上に、本体は大きく）。
function MonoLabel({ title }: { title: string }) {
  const { mark, core } = monogram(title);
  return (
    <span className="mono" data-len={[...core].length}>
      {mark && <span className="mono-kind">{mark}</span>}
      {core}
    </span>
  );
}
// バッジを公式ロゴ風ロックアップにするための先頭マーク
function brandMark(short: string): string {
  const ch = [...short.trim()];
  return ch.length ? ch[0] : "?";
}

// X（旧Twitter）の投稿画面を、本文とURLをプリセットして開く共通処理。
function openXIntent(text: string, url: string) {
  const intent = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  window.open(intent, "_blank", "noopener,noreferrer,width=600,height=480");
}

// 現在のページ（選択中の年・シーズンの一覧）を共有する。
function shareOnX() {
  track("share_site");
  openXIntent("アニメ視聴ガイド ― 今期アニメの配信状況をサービス別にスキャン", window.location.href);
}

// 個別の作品を共有する。URLは作品個別ページ（/anime/[id]）の固定リンクを使う
// ことで、共有された側が常に最新の配信情報を見られ、検索にも拾われやすくなる。
function shareWork(title: string, id: number) {
  track("share_work", { title });
  const url = `${window.location.origin}/anime/${id}`;
  openXIntent(`「${title}」の配信状況をチェック｜アニメ視聴ガイド`, url);
}

export interface SeasonExplorerProps {
  // /season/[year]/[season] のようなサーバーレンダリング済みページから渡された
  // 場合はここに初期値が入り、その年・シーズンで固定表示する（URLクエリより優先）。
  // 未指定（トップページ "/"）の場合は、URLクエリ→現在の年・シーズンの順に決める。
  initialYear?: number;
  initialSeason?: string;
  initialData?: SeasonResponse;
}

// URLクエリ（?year=2026&season=summer）と年・シーズンの選択状態を同期する。
// これにより「Xで共有」ボタンが常に「今見ている内容」への正しいディープリンクを
// 共有でき、共有された側もリンクを開くだけで同じ年・シーズンを見られる。
export default function SeasonExplorer({
  initialYear: fixedYear,
  initialSeason: fixedSeason,
  initialData,
}: SeasonExplorerProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // サーバー側から年・シーズンを渡された（＝/season/.. ページ）場合は、
  // URLクエリへの同期やクエリからの読み取りをしない「固定表示」モードになる。
  const isFixed = fixedYear !== undefined && fixedSeason !== undefined;

  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: thisYear - 2009 }, (_, i) => thisYear - i);

  const initialYear =
    fixedYear ??
    (() => {
      const y = Number(searchParams.get("year"));
      return years.includes(y) ? y : thisYear;
    })();
  const initialSeasonKey =
    fixedSeason ??
    (() => {
      const s = searchParams.get("season");
      return s && SEASON_KEYS.has(s as (typeof SEASONS)[number]["key"]) ? s : currentSeasonKey();
    })();

  const [year, setYear] = useState(initialYear);
  const [season, setSeason] = useState<string>(initialSeasonKey);
  const [data, setData] = useState<SeasonResponse | null>(initialData ?? null);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState<string | null>(null);
  // サーバーから初期データを受け取った最初の1回だけ、client fetchをスキップする。
  const skipNextFetch = useRef(!!initialData);

  const [query, setQuery] = useState("");
  const [active, setActive] = useState<Set<string>>(new Set());
  // 人気順（API側で watchers 降順に整形済み）と、五十音順（タイトルの辞書順）を切り替える。
  const [sortKey, setSortKey] = useState<"popular" | "title">("popular");
  // 一覧（グリッド）と、曜日別の配信スケジュール（カレンダー）の表示切り替え。
  const [viewMode, setViewMode] = useState<"grid" | "calendar">("grid");
  // 複数の配信サービスを選んだ時、いずれか一致（OR）か全て一致（AND）かを切り替える。
  const [andMode, setAndMode] = useState(false);

  // お気に入り＝ログイン不要でブラウザの localStorage に作品IDを保存する。
  // シーズンをまたいで保持したいので、キーはシーズンに依存しないグローバルな1つ。
  const FAVORITES_KEY = "anime-haishin:favorites";
  const [favorites, setFavorites] = useState<Set<number>>(new Set());
  const [favoritesOnly, setFavoritesOnly] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(FAVORITES_KEY);
      if (raw) setFavorites(new Set(JSON.parse(raw)));
    } catch {
      // localStorage が使えない環境（プライベートモード等）では無視する
    }
  }, []);

  function toggleFavorite(id: number) {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        track("favorite_add"); // 追加時だけ計測（人気把握のため。削除は取らない）
      }
      try {
        localStorage.setItem(FAVORITES_KEY, JSON.stringify([...next]));
      } catch {
        // 保存できなくても表示上のトグルは機能させる
      }
      return next;
    });
  }

  // 年セレクトはネイティブ <select> だとハイライト色をブラウザ側が決めてしまい
  // サイトのダーク基調デザインに合わせられないため、自前のリストボックスにしている。
  const [yearMenuOpen, setYearMenuOpen] = useState(false);
  const yearDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!yearMenuOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (!yearDropdownRef.current?.contains(e.target as Node)) {
        setYearMenuOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setYearMenuOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [yearMenuOpen]);

  // 選択中の年・シーズンをURLに反映する（共有リンクが「今見ている内容」を再現できるように）。
  // /season/.. の固定表示ページではパス自体が年・シーズンを表すので同期しない。
  useEffect(() => {
    if (isFixed) return;
    const params = new URLSearchParams();
    params.set("year", String(year));
    params.set("season", season);
    window.history.replaceState(null, "", `${pathname}?${params.toString()}`);
  }, [year, season, pathname, isFixed]);

  useEffect(() => {
    if (skipNextFetch.current) {
      skipNextFetch.current = false;
      return;
    }
    let abort = false;
    setLoading(true);
    setError(null);
    setActive(new Set());
    fetch(`/api/season?year=${year}&season=${season}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || `エラー（${r.status}）`);
        return j as SeasonResponse;
      })
      .then((d) => !abort && setData(d))
      .catch((e) => {
        if (!abort) {
          setError(e.message);
          setData(null);
        }
      })
      .finally(() => !abort && setLoading(false));
    return () => {
      abort = true;
    };
  }, [year, season]);

  // データに登場する配信サービスだけを、登場頻度順で絞り込みチップに出す
  const availableServices = useMemo<ServiceTag[]>(() => {
    if (!data) return [];
    const map = new Map<string, { tag: ServiceTag; n: number }>();
    for (const it of data.items) {
      for (const s of it.services) {
        const cur = map.get(s.key);
        if (cur) cur.n += 1;
        else map.set(s.key, { tag: s, n: 1 });
      }
    }
    return [...map.values()].sort((a, b) => b.n - a.n).map((x) => x.tag);
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    const list = data.items.filter((it) => {
      const okText = q === "" || it.title.toLowerCase().includes(q);
      const okSvc =
        active.size === 0
          ? true
          : andMode
            ? [...active].every((k) => it.services.some((s) => s.key === k))
            : it.services.some((s) => active.has(s.key));
      const okFav = !favoritesOnly || favorites.has(it.id);
      return okText && okSvc && okFav;
    });
    // "popular" は API が watchers 降順で返す並びをそのまま使う（再ソート不要）。
    if (sortKey === "title") {
      return [...list].sort((a, b) => a.title.localeCompare(b.title, "ja"));
    }
    return list;
  }, [data, query, active, sortKey, andMode, favoritesOnly, favorites]);

  function toggle(key: string) {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
        track("filter_service", { service: key }); // どのサービスで絞り込まれるか
      }
      return next;
    });
  }

  // 今期の人気上位（watchers 降順の先頭5件）。検索・絞り込みとは独立に、
  // 常に「そのシーズンの注目作」を示すことで再訪・共有のフックにする。
  const topRanking = useMemo<AnimeItem[]>(() => {
    if (!data) return [];
    return [...data.items].sort((a, b) => b.watchers - a.watchers).slice(0, 5);
  }, [data]);

  // 配信スケジュールカレンダー用。曜日（月始まり）ごとに束ね、放送日が
  // 取れない作品（配信情報なし等）は最後の「配信日未定」に集める。
  const calendarGroups = useMemo<{ label: string; items: AnimeItem[] }[]>(() => {
    const order = [1, 2, 3, 4, 5, 6, 0]; // 月火水木金土日
    const labels = ["月", "火", "水", "木", "金", "土", "日"];
    const buckets = new Map<number, AnimeItem[]>();
    const tbd: AnimeItem[] = [];
    for (const it of filtered) {
      if (it.broadcastWeekday === null) {
        tbd.push(it);
        continue;
      }
      const list = buckets.get(it.broadcastWeekday) ?? [];
      list.push(it);
      buckets.set(it.broadcastWeekday, list);
    }
    for (const list of buckets.values()) {
      list.sort((a, b) => (a.broadcastTime ?? "").localeCompare(b.broadcastTime ?? ""));
    }
    const groups = order.map((w, i) => ({ label: labels[i], items: buckets.get(w) ?? [] }));
    if (tbd.length > 0) groups.push({ label: "配信日未定", items: tbd });
    return groups;
  }, [filtered]);

  return (
    <div className="wrap">
      <header className="masthead">
        <span className="eyebrow" aria-hidden="true">
          LINK START :: 今期アニメの配信データベースに接続完了
        </span>
        <div className="brandrow">
          <h1 className="brand">
            アニメ視聴ガイド<span className="dot" aria-hidden="true" />
          </h1>
          <span className="brand-season">
            {year} {SEASON_LABEL[season]}クール
          </span>
        </div>
        <div className="meta">
          <span className="live">
            <i />
            リアルタイム取得
          </span>
          <span className="tagline">
            今期アニメの配信状況をサービス別にスキャン
          </span>
          <button type="button" className="share-x" onClick={shareOnX}>
            Xで共有
          </button>
          <ThemeToggle />
        </div>
      </header>

      <div className="controls">
        <div className="control-line">
          <div className="segmented" role="group" aria-label="シーズン">
            {SEASONS.map((s) => (
              <button
                key={s.key}
                className="seg-btn"
                aria-pressed={season === s.key}
                onClick={() => {
                  setSeason(s.key);
                  track("change_season", { season: s.key, year });
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="year-dropdown" ref={yearDropdownRef}>
            <button
              type="button"
              className="year-select"
              aria-haspopup="listbox"
              aria-expanded={yearMenuOpen}
              aria-label="年"
              onClick={() => setYearMenuOpen((v) => !v)}
            >
              {year}
              <span className="year-caret" aria-hidden="true" />
            </button>
            {yearMenuOpen && (
              <ul className="year-menu" role="listbox" aria-label="年">
                {years.map((y) => (
                  <li
                    key={y}
                    role="option"
                    aria-selected={y === year}
                    className="year-option"
                    data-selected={y === year}
                    onClick={() => {
                      setYear(y);
                      setYearMenuOpen(false);
                    }}
                  >
                    {y}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <span className="control-label">年</span>
        </div>

        <input
          className="search"
          type="text"
          placeholder="作品名でスキャン…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        {availableServices.length > 0 && (
          <div className="filters" role="group" aria-label="配信サービスで絞り込み">
            <button
              className="chip chip-reset"
              data-on={active.size === 0}
              onClick={() => setActive(new Set())}
            >
              すべて
            </button>
            <button
              type="button"
              className="chip"
              data-on={favoritesOnly}
              aria-pressed={favoritesOnly}
              onClick={() => setFavoritesOnly((v) => !v)}
            >
              ★ お気に入り
            </button>
            {active.size > 1 && (
              <button
                type="button"
                className="chip"
                data-on={andMode}
                aria-pressed={andMode}
                title="複数選択時、いずれか一致（OR）か全て一致（AND）かを切り替え"
                onClick={() => setAndMode((v) => !v)}
              >
                {andMode ? "AND" : "OR"}
              </button>
            )}
            {availableServices.map((s) => {
              const on = active.has(s.key);
              return (
                <button
                  key={s.key}
                  className="chip"
                  data-on={on}
                  style={on ? { background: s.color } : undefined}
                  onClick={() => toggle(s.key)}
                >
                  {s.short}
                </button>
              );
            })}
          </div>
        )}

        {data && !loading && !error && (
          <div className="count-row">
            <div className="count">
              <b>{filtered.length}</b> 作品
              {filtered.length !== data.count ? `（全 ${data.count} 中）` : ""}
            </div>
            <div className="sort" role="group" aria-label="表示形式">
              <button
                type="button"
                className="sort-btn"
                aria-pressed={viewMode === "grid"}
                onClick={() => setViewMode("grid")}
              >
                一覧
              </button>
              <button
                type="button"
                className="sort-btn"
                aria-pressed={viewMode === "calendar"}
                onClick={() => setViewMode("calendar")}
              >
                カレンダー
              </button>
            </div>
            {viewMode === "grid" && (
              <div className="sort" role="group" aria-label="並び替え">
                <button
                  type="button"
                  className="sort-btn"
                  aria-pressed={sortKey === "popular"}
                  onClick={() => setSortKey("popular")}
                >
                  人気順
                </button>
                <button
                  type="button"
                  className="sort-btn"
                  aria-pressed={sortKey === "title"}
                  onClick={() => setSortKey("title")}
                >
                  五十音順
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 今期の注目作ランキング。検索・絞り込みをしていない素の状態のときだけ出し、
          そのシーズンの「顔ぶれ」を一目で見せて共有・再訪のきっかけにする。 */}
      {viewMode === "grid" && !loading && !error && data && topRanking.length > 0 &&
        query.trim() === "" && active.size === 0 && !favoritesOnly && (
          <section className="ranking" aria-label="今期の注目作ランキング">
            <h2 className="ranking-title">今期の注目作 TOP5</h2>
            <ol className="ranking-list">
              {topRanking.map((it, i) => (
                <li key={it.id} className="ranking-item">
                  <span className="ranking-rank" data-rank={i + 1}>{i + 1}</span>
                  <span className="ranking-name">{it.title}</span>
                </li>
              ))}
            </ol>
          </section>
        )}

      {loading && (
        <div className="grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton-card" />
          ))}
        </div>
      )}

      {error && !loading && (
        <div className="state error">
          <h2>データを取得できませんでした</h2>
          <p>{error}</p>
          <p>
            初回は <code>.env.local</code> に <code>ANNICT_TOKEN</code> が
            設定されているか確認してください。
          </p>
        </div>
      )}

      {!loading && !error && data && filtered.length === 0 && (
        <div className="state">
          <h2>該当する作品がありません</h2>
          <p>検索語や絞り込みを変えてみてください。</p>
        </div>
      )}

      {/* 配信スケジュールカレンダー。放送/配信の初回日時（Annict programs の startedAt）から
          導出した曜日ごとに束ねる。「配信日未定」は programs がない/日時が取れない作品。 */}
      {viewMode === "calendar" && !loading && !error && data && filtered.length > 0 && (
        <>
          <p className="calendar-note">
            時刻は初回放送/配信から推定した目安です。話数によって前後する場合があります。
          </p>
          <div className="calendar">
          {calendarGroups.map((g) => (
            <section key={g.label} className="calendar-day">
              <h3 className="calendar-day-head">
                {g.label}
                <span className="calendar-day-count">{g.items.length}</span>
              </h3>
              {g.items.length === 0 ? (
                <p className="calendar-empty">なし</p>
              ) : (
                <ul className="calendar-list">
                  {g.items.map((it) => (
                    <li key={it.id} className="calendar-item">
                      {it.broadcastTime && (
                        <span className="calendar-time">{it.broadcastTime}</span>
                      )}
                      <Link href={`/anime/${it.id}`} className="calendar-title">
                        {it.title}
                      </Link>
                      {(it.services.length > 0 || it.otherServices.length > 0) && (
                        <div className="badges calendar-badges">
                          {it.services.map((s) => (
                            <span
                              key={s.key}
                              className="badge"
                              style={{ ["--c" as string]: s.color }}
                            >
                              <span
                                className="badge-mark"
                                style={{ background: s.color, color: textOn(s.color) }}
                              >
                                {brandMark(s.short)}
                              </span>
                              <span className="badge-name">{s.short}</span>
                            </span>
                          ))}
                          {it.otherServices.map((name) => (
                            <span key={name} className="badge badge-other">
                              {name}
                            </span>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
          </div>
        </>
      )}

      {viewMode === "grid" && !loading && !error && data && filtered.length > 0 && (
        <div className="grid">
          {filtered.map((it) => (
            <article key={it.id} className="card">
              <span className="slash" aria-hidden="true" />
              {/* 著作権配慮のため外部の作品画像は読み込まず、作品IDから生成した
                  グラデーション＋頭文字のモノグラムタイルに統一する。 */}
              <div className="thumb thumb-empty" style={posterStyle(it.id)} aria-hidden>
                <MonoLabel title={it.title} />
              </div>
              <div className="card-actions">
                <button
                  type="button"
                  className="card-action share"
                  aria-label={`「${it.title}」をXで共有`}
                  onClick={() => shareWork(it.title, it.id)}
                >
                  <span aria-hidden="true">↗</span>
                </button>
                <button
                  type="button"
                  className="card-action fav-btn"
                  aria-pressed={favorites.has(it.id)}
                  aria-label={favorites.has(it.id) ? "お気に入りから削除" : "お気に入りに追加"}
                  onClick={() => toggleFavorite(it.id)}
                >
                  {favorites.has(it.id) ? "★" : "☆"}
                </button>
              </div>
              <div className="card-body">
                <h3 className="card-title">
                  <Link href={`/anime/${it.id}`}>{it.title}</Link>
                </h3>

                {it.services.length === 0 && it.otherServices.length === 0 ? (
                  <span className="no-haishin">配信情報なし</span>
                ) : (
                  <div className="badges">
                    {it.services.map((s) => (
                      <span
                        key={s.key}
                        className="badge"
                        style={{ ["--c" as string]: s.color }}
                      >
                        <span
                          className="badge-mark"
                          style={{ background: s.color, color: textOn(s.color) }}
                        >
                          {brandMark(s.short)}
                        </span>
                        <span className="badge-name">{s.short}</span>
                      </span>
                    ))}
                    {it.otherServices.map((name) => (
                      <span key={name} className="badge badge-other">
                        {name}
                      </span>
                    ))}
                  </div>
                )}

                {it.officialSiteUrl && (
                  <a
                    className="official"
                    href={it.officialSiteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    公式サイト ↗
                  </a>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      <details className="changelog">
        <summary>更新履歴</summary>
        <ul>
          {CHANGELOG.map((c, i) => (
            <li key={i}>
              <time>{c.date}</time>
              <span>{c.text}</span>
            </li>
          ))}
        </ul>
      </details>

      <p className="footnote">
        データ元: Annict（コミュニティ更新ベース）。配信情報は網羅率100%ではなく、
        新作は反映が遅れることがあります。視聴前に各サービスの最新情報もご確認ください。
        「その他配信」は未登録サービスの可能性があり、点線で表示しています。
      </p>

      <ScrollTopButton />
    </div>
  );
}

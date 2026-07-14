"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { track } from "@vercel/analytics";
import { textOn, splitRentalServices } from "@/lib/services";
import { CHANGELOG } from "@/lib/changelog";
import ThemeToggle from "./ThemeToggle";
import AuthWidget from "./AuthWidget";
import { useAuth } from "./AuthProvider";
import { useLoginGatedWorkSet } from "./useLoginGatedWorkSet";
import ScrollTopButton from "./ScrollTopButton";
import ServiceMarks from "./ServiceMarks";
import type { AnimeItem, SeasonResponse, ServiceTag, SearchIndexEntry } from "@/lib/types";
import { WORK_IMAGE_IDS } from "@/content/works/imageIds";
import { RENTAL_SERVICES } from "@/content/works/rentalServices";
import { WORK_ALIASES } from "@/content/works/aliases";
import { resolveYearSeason, validYears } from "@/lib/resolveSeasonParams";

// 「独占」は実在の配信サービスではなく、「見放題配信サービスが1つだけの作品」を
// 指す仮想チップ。active（配信サービスの絞り込みSet）に同居させることで、既存の
// OR/AND切り替えがそのまま使える（例: 「独占」+「dアニメ」をANDにすると
// dアニメの独占配信作品だけに絞れる）。lib/services.ts の ServiceKey には
// 実データ由来のキーだけを置きたいのでUI側だけの定数として持つ。
const EXCLUSIVE_KEY = "__exclusive__";

// AI独断解釈サムネの注釈（全箇所で同じ文言を使う）。
const AI_IMAGE_NOTE = "AIがタイトルのみから独断と偏見で作成した画像です。本作品との関連性はありません。";

const SEASONS = [
  { key: "winter", label: "冬" },
  { key: "spring", label: "春" },
  { key: "summer", label: "夏" },
  { key: "autumn", label: "秋" },
] as const;

const SEASON_LABEL: Record<string, string> = {
  winter: "冬",
  spring: "春",
  summer: "夏",
  autumn: "秋",
};

// broadcastWeekday（0=日〜6=土）→ 曜日ラベル。カード内の放送タイミング表示に使う。
const WEEKDAY_SHORT = ["日", "月", "火", "水", "木", "金", "土"];

// 基本ルール（2026-07-11導入）: 放送開始の1週間より前は「毎週この曜日・時刻」のように
// 見せない。まだ1話も配信されていない作品を「今週の水曜22:30」のように出すと、当日
// アクセスしても配信されておらず誤誘導になる（実例: Re:ゼロ4期奪還編、8月開始なのに
// 7月から曜日・時刻付きでカレンダーに出ていた）。放送開始日（JST日付）までの残日数で
// 出し分ける: 1週間より先は日付表示＆カレンダー非表示、1週間以内〜放送済みは通常表示。
const PREMIERE_LOOKAHEAD_DAYS = 7;

// broadcastStartDate（"YYYY-MM-DD", JST）の何日後かを返す。過去日（放送開始済み）は負数。
function daysUntilStart(dateStr: string): number {
  const startMs = new Date(`${dateStr}T00:00:00+09:00`).getTime();
  return Math.ceil((startMs - Date.now()) / (24 * 60 * 60 * 1000));
}

// 放送開始の1週間より前かどうか（true＝まだ先。日付表示にし、カレンダーには出さない）。
function isFarBeforePremiere(it: AnimeItem): boolean {
  if (!it.broadcastStartDate) return false;
  return daysUntilStart(it.broadcastStartDate) > PREMIERE_LOOKAHEAD_DAYS;
}

// "YYYY-MM-DD" → "M/D"（JST日付文字列をそのまま分解するだけなのでタイムゾーン変換不要）。
function formatMonthDay(dateStr: string): string {
  const [, m, d] = dateStr.split("-");
  return `${Number(m)}/${Number(d)}`;
}

function airLabel(it: AnimeItem): string | null {
  if (it.broadcastWeekday === null) return null;
  const wd = WEEKDAY_SHORT[it.broadcastWeekday] ?? "";
  if (it.broadcastStartDate && isFarBeforePremiere(it)) {
    return `${formatMonthDay(it.broadcastStartDate)}(${wd})〜`;
  }
  return it.broadcastTime ? `${wd} ${it.broadcastTime}` : wd;
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

// カードの左タイル。AI独断解釈サムネがあればそれを、無ければモノグラムタイルを出す。
// AI画像には「AI創作」タグと、注釈をtitle属性で添える（本作品と無関係である旨）。
function WorkTile({ id, title }: { id: number; title: string }) {
  if (WORK_IMAGE_IDS.has(id)) {
    return (
      <div className="thumb thumb-ai" title={AI_IMAGE_NOTE}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/works/${id}.jpg`} alt="" loading="lazy" className="thumb-ai-img" />
        <span className="thumb-ai-tag">AI創作</span>
      </div>
    );
  }
  return (
    <div className="thumb thumb-empty" style={posterStyle(id)} aria-hidden>
      <MonoLabel title={title} />
    </div>
  );
}
// バッジを公式ロゴ風ロックアップにするための先頭マーク
function brandMark(short: string): string {
  const ch = [...short.trim()];
  return ch.length ? ch[0] : "?";
}

// 行動ログ共通処理。Vercel Web Analytics（無料プランはカスタムイベントがダッシュボードに
// 出ない）に加えて、自前の /api/track にも送る（Supabase無料枠に記録し、/admin/analyticsで見る）。
// 計測はユーザー操作の成否に影響してはいけないため、失敗しても握りつぶす（catchのみ）。
function logEvent(event: string, data?: Record<string, string | number | boolean | null>) {
  track(event, data);
  fetch("/api/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, data }),
    keepalive: true,
  }).catch(() => {
    // オフライン・Supabase未設定時等は無視する（体験は既存のtrack()同様に壊さない）
  });
}

// X（旧Twitter）の投稿画面を、本文とURLをプリセットして開く共通処理。
function openXIntent(text: string, url: string) {
  const intent = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  window.open(intent, "_blank", "noopener,noreferrer,width=600,height=480");
}

// 共有導線の共通処理。スマホ（Android Chrome・iOS Safari等）は navigator.share が使えるため、
// LINE・Instagram・コピーなどOS標準の共有シートを出す（日本のアニメ層はX以外にLINEでの
// 共有比率も高いため、X固定より間口が広い）。非対応環境（主にデスクトップ）は
// 従来どおりXの投稿画面にフォールバックする。
function nativeShareOrX(title: string, url: string) {
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    navigator.share({ title, url }).catch(() => {
      // ユーザーがシートを閉じた場合等の AbortError はエラー扱いしない
    });
    return;
  }
  openXIntent(title, url);
}

// 現在のページ（選択中の年・シーズンの一覧）を共有する。
function shareOnX() {
  logEvent("share_site");
  nativeShareOrX("アニメ視聴ガイド ― 今期アニメの配信状況をサービス別にスキャン", window.location.href);
}

// 個別の作品を共有する。URLは作品個別ページ（/anime/[id]）の固定リンクを使う
// ことで、共有された側が常に最新の配信情報を見られ、検索にも拾われやすくなる。
function shareWork(title: string, id: number) {
  logEvent("share_work", { title });
  const url = `${window.location.origin}/anime/${id}`;
  nativeShareOrX(`「${title}」の配信状況をチェック｜アニメ視聴ガイド`, url);
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
  const years = validYears(thisYear);

  // resolveYearSeason はサーバー側（app/page.tsxのSSR初期データ取得）と同じロジックを
  // 共有する（lib/resolveSeasonParams.ts）。isFixed=false（トップページ）の場合、
  // ここで解決する年・シーズンは、SSR側が initialData を取得した際の年・シーズンと
  // 一致する必要がある（一致しないと表示中の年・シーズンとinitialDataの中身がズレる）。
  const resolved = isFixed
    ? { year: fixedYear!, season: fixedSeason! }
    : resolveYearSeason({
        year: searchParams.get("year") ?? undefined,
        season: searchParams.get("season") ?? undefined,
      });
  const initialYear = resolved.year;
  const initialSeasonKey = resolved.season;

  const [year, setYear] = useState(initialYear);
  const [season, setSeason] = useState<string>(initialSeasonKey);
  const [data, setData] = useState<SeasonResponse | null>(initialData ?? null);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState<string | null>(null);
  // サーバーから初期データを受け取った最初の1回だけ、client fetchをスキップする。
  const skipNextFetch = useRef(!!initialData);

  const [query, setQuery] = useState("");
  const [active, setActive] = useState<Set<string>>(new Set());
  // 声優チップで選択中の人物名（複数選択可、いずれか一致=OR）。試験実装。
  const [activeCast, setActiveCast] = useState<Set<string>>(new Set());
  // 人気順（API側で watchers 降順に整形済み）と、五十音順（タイトルの辞書順）を切り替える。
  const [sortKey, setSortKey] = useState<"popular" | "title">("popular");
  // 一覧（グリッド）と、曜日別の配信スケジュール（カレンダー）の表示切り替え。
  // ?view=calendar&day=火 のようなURLクエリで初期状態を復元できる（SNS自動投稿の
  // スクリーンショット撮影がヘッドレスブラウザから直接その画面を開けるようにするため。
  // 2026-07-14導入）。それ以外の通常閲覧では従来通りクリック操作で切り替わる。
  const CALENDAR_DAY_LABELS = ["月", "火", "水", "木", "金", "土", "日", "配信日未定"];
  const [viewMode, setViewMode] = useState<"grid" | "calendar">(
    searchParams.get("view") === "calendar" ? "calendar" : "grid"
  );
  // カレンダー表示で、特定の曜日だけに絞り込むためのラベル（"all" = 全曜日）。
  const [calendarDay, setCalendarDay] = useState<string>(() => {
    const day = searchParams.get("day");
    return day && CALENDAR_DAY_LABELS.includes(day) ? day : "all";
  });
  // ?ranking=open で「今期の注目作 TOP5」パネルを初期状態から開いておける（同上の理由）。
  const [rankingOpen] = useState(() => searchParams.get("ranking") === "open");
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

  // クール横断キーワード検索用の軽量インデックス（/api/search-index、直近数年分の
  // タイトル・読み仮名・年・季節のみ）。検索語が入って初めて意味を持つので、
  // 初回描画をブロックしないよう「検索欄に触れた時」に一度だけ遅延取得する。
  const [searchIndex, setSearchIndex] = useState<SearchIndexEntry[]>([]);
  const indexRequested = useRef(false);
  function ensureSearchIndex() {
    if (indexRequested.current) return;
    indexRequested.current = true;
    fetch("/api/search-index")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (Array.isArray(j?.entries)) setSearchIndex(j.entries);
      })
      .catch(() => {
        // 失敗しても現在クール内の検索は動くので、再試行できるようフラグを戻す。
        indexRequested.current = false;
      });
  }

  function toggleFavorite(id: number) {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        logEvent("favorite_add"); // 追加時だけ計測（人気把握のため。削除は取らない）
      }
      try {
        localStorage.setItem(FAVORITES_KEY, JSON.stringify([...next]));
      } catch {
        // 保存できなくても表示上のトグルは機能させる
      }
      return next;
    });
  }

  // 視聴済み・配信通知希望＝お気に入りとは別機能。ログインユーザーごとにSupabase側で
  // 永続化する（localStorageではなくサーバー側が真実のソース）。ログインしていない
  // ユーザーには一切影響しない（お気に入り等の既存機能はログイン不要のまま動作し続ける）。
  // 共通ロジックはuseLoginGatedWorkSet（components/useLoginGatedWorkSet.ts）に集約。
  const { user } = useAuth();
  const { items: watched, toggle: toggleWatched } = useLoginGatedWorkSet("/api/watched", () =>
    logEvent("watched_add") // 追加時だけ計測（人気把握のため。削除は取らない）
  );
  const { items: notifyRequested, toggle: toggleNotify } = useLoginGatedWorkSet("/api/notify", () =>
    logEvent("notify_add")
  );

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

  // データに登場する配信サービスを、登場頻度（=何本その配信で観られるか）順に集計する。
  // 絞り込みチップ（タグのみ）と比較表（件数つき）の両方がこの集計を使う。
  const serviceUsage = useMemo<{ tag: ServiceTag; n: number }[]>(() => {
    if (!data) return [];
    const map = new Map<string, { tag: ServiceTag; n: number }>();
    for (const it of data.items) {
      // レンタル扱いのサービスは「見放題で何本見れるか」の対応本数には数えない。
      const { streaming } = splitRentalServices(it.services, RENTAL_SERVICES[it.id]);
      for (const s of streaming) {
        const cur = map.get(s.key);
        if (cur) cur.n += 1;
        else map.set(s.key, { tag: s, n: 1 });
      }
    }
    return [...map.values()].sort((a, b) => b.n - a.n);
  }, [data]);
  const availableServices = useMemo<ServiceTag[]>(
    () => serviceUsage.map((x) => x.tag),
    [serviceUsage],
  );

  // 今期に複数作品へ出演している声優を、出演数の多い順にチップ化する（試験実装）。
  // 1作品だけの声優は対象外にして、チップの数を絞る。
  const CAST_CHIP_MIN_COUNT = 2;
  const CAST_CHIP_LIMIT = 20;
  const availableCastChips = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, number>();
    for (const it of data.items) {
      for (const name of it.castNames) {
        map.set(name, (map.get(name) ?? 0) + 1);
      }
    }
    return [...map.entries()]
      .filter(([, n]) => n >= CAST_CHIP_MIN_COUNT)
      .sort((a, b) => b[1] - a[1])
      .slice(0, CAST_CHIP_LIMIT);
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    const list = data.items.filter((it) => {
      const aliases = WORK_ALIASES[it.id] ?? [];
      const okText =
        q === "" ||
        it.title.toLowerCase().includes(q) ||
        it.creditNames.some((n) => n.toLowerCase().includes(q)) ||
        aliases.some((a) => a.toLowerCase().includes(q));
      const matchesKey = (k: string) => {
        if (k === EXCLUSIVE_KEY) {
          const { streaming } = splitRentalServices(it.services, RENTAL_SERVICES[it.id]);
          return streaming.length === 1;
        }
        return it.services.some((s) => s.key === k);
      };
      const okSvc =
        active.size === 0
          ? true
          : andMode
            ? [...active].every(matchesKey)
            : [...active].some(matchesKey);
      const okCast =
        activeCast.size === 0 || it.castNames.some((n) => activeCast.has(n));
      const okFav = !favoritesOnly || favorites.has(it.id);
      return okText && okSvc && okCast && okFav;
    });
    // "popular" は API が watchers 降順で返す並びをそのまま使う（再ソート不要）。
    if (sortKey === "title") {
      return [...list].sort((a, b) => a.title.localeCompare(b.title, "ja"));
    }
    return list;
  }, [data, query, active, activeCast, sortKey, andMode, favoritesOnly, favorites]);

  // クール横断検索の結果。検索語が入っている時だけ、表示中クール以外の作品を
  // 軽量インデックスから拾う（タイトル・読み仮名・通称/略称で一致）。配信サービス
  // 絞り込み・お気に入りは重いデータが無いインデックスには適用できないため、無指定時のみ出す。
  const CROSS_LIMIT = 60;
  const crossMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "" || searchIndex.length === 0) return [];
    if (active.size > 0 || favoritesOnly) return [];
    const currentIds = new Set((data?.items ?? []).map((it) => it.id));
    return searchIndex
      .filter((e) => !currentIds.has(e.id))
      .filter((e) => {
        const aliases = WORK_ALIASES[e.id] ?? [];
        return (
          e.title.toLowerCase().includes(q) ||
          e.kana.toLowerCase().includes(q) ||
          aliases.some((a) => a.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || a.title.localeCompare(b.title, "ja"));
  }, [query, searchIndex, data, active, favoritesOnly]);
  const crossShown = crossMatches.slice(0, CROSS_LIMIT);

  // カード内に出す「いつ放送か」のラベル（現在表示中クール）。
  const currentSeasonLabel = `${year}年 ${SEASON_LABEL[season] ?? ""}`;

  function toggle(key: string) {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
        logEvent("filter_service", { service: key }); // どのサービスで絞り込まれるか
        // 「独占」と実サービスを組み合わせた時はORのままだと「独占の何か」or「そのサービス」
        // という意図と違う絞り込みになってしまうため、この組み合わせが成立した瞬間だけ
        // 自動でANDに切り替える（ユーザーがどちらを先にクリックしても結果は同じにする）。
        if (next.size > 1 && next.has(EXCLUSIVE_KEY)) {
          setAndMode(true);
        }
      }
      return next;
    });
  }

  function toggleCast(name: string) {
    setActiveCast((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
        logEvent("filter_cast", { cast: name });
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
  // 基本ルール: 放送開始の1週間より前の作品はカレンダーに出さない（airLabel と同じ理由）。
  const calendarGroups = useMemo<{ label: string; items: AnimeItem[] }[]>(() => {
    const order = [1, 2, 3, 4, 5, 6, 0]; // 月火水木金土日
    const labels = ["月", "火", "水", "木", "金", "土", "日"];
    const buckets = new Map<number, AnimeItem[]>();
    const tbd: AnimeItem[] = [];
    for (const it of filtered) {
      if (isFarBeforePremiere(it)) continue;
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

  // 曜日フィルタで選ばれた曜日だけに絞る（"all" のときは全曜日を出す）。
  const visibleCalendarGroups =
    calendarDay === "all" ? calendarGroups : calendarGroups.filter((g) => g.label === calendarDay);

  return (
    <div className="wrap">
      <a href="#main-content" className="skip-link">
        本文へスキップ
      </a>
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
            共有
          </button>
          <AuthWidget />
          <ThemeToggle />
        </div>
      </header>

      <main id="main-content" tabIndex={-1}>
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
                  logEvent("change_season", { season: s.key, year });
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

        <details className="fold-panel fold-panel-controls">
          <summary className="fold-summary">
            <h2 className="fold-summary-text">検索・配信サービスで絞る</h2>
          </summary>

          <input
            className="search"
            type="text"
            placeholder="作品名・声優・スタッフでスキャン…"
            aria-label="作品名・声優・スタッフでスキャン"
            value={query}
            onFocus={ensureSearchIndex}
            onChange={(e) => {
              ensureSearchIndex();
              setQuery(e.target.value);
            }}
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
              <button
                type="button"
                className="chip"
                data-on={active.has(EXCLUSIVE_KEY)}
                aria-pressed={active.has(EXCLUSIVE_KEY)}
                title="見放題配信サービスが1つだけの作品に絞る（他のサービスチップとANDにすると「◯◯の独占」で絞り込める）"
                onClick={() => toggle(EXCLUSIVE_KEY)}
              >
                独占
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
        </details>

        {availableCastChips.length > 0 && (
          <details className="fold-panel fold-panel-controls">
            <summary className="fold-summary">
              <h2 className="fold-summary-text">出演作品が多い声優で絞る</h2>
            </summary>
            <div className="filters" role="group" aria-label="声優で絞り込み（試験実装）">
              {availableCastChips.map(([name, count]) => {
                const on = activeCast.has(name);
                return (
                  <button
                    key={name}
                    type="button"
                    className="chip chip-cast"
                    data-on={on}
                    onClick={() => toggleCast(name)}
                    title={`今期${count}作品に出演`}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          </details>
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

      {/* 今期の注目作ランキング。検索・絞り込みをしていない素の状態のときだけ出す。
          配信情報（作品一覧）が下に押しやられないよう、既定は折りたたみ、クリックで開く。 */}
      {viewMode === "grid" && !loading && !error && data && topRanking.length > 0 &&
        query.trim() === "" && active.size === 0 && !favoritesOnly && (
          <details className="ranking fold-panel" open={rankingOpen}>
            <summary className="fold-summary">
              <h2 className="fold-summary-text">今期の注目作 TOP5</h2>
            </summary>
            <ol className="ranking-list">
              {topRanking.map((it, i) => (
                <li key={it.id} className="ranking-item">
                  <span className="ranking-rank" data-rank={i + 1}>{i + 1}</span>
                  <span className="ranking-name">{it.title}</span>
                </li>
              ))}
            </ol>
          </details>
        )}

      {/* 配信サービス横断の比較表。「このサービスだけで何本見れるか」を一目で見せる。
          注目作ランキングと同じく、絞り込みをしていない素の状態でだけ出す。既定は折りたたみ。
          行をクリックするとそのサービスで絞り込める（既存のサービスチップと同じ toggle を再利用）。 */}
      {viewMode === "grid" && !loading && !error && data && serviceUsage.length > 0 &&
        query.trim() === "" && active.size === 0 && !favoritesOnly && (
          <details className="svc-compare fold-panel">
            <summary className="fold-summary">
              <h2 className="fold-summary-text">配信サービス別 対応本数</h2>
            </summary>
            <ul className="svc-compare-list">
              {serviceUsage.map(({ tag, n }) => (
                <li key={tag.key} className="svc-compare-item">
                  <button
                    type="button"
                    className="svc-compare-row"
                    onClick={() => toggle(tag.key)}
                    title={`${tag.name}で絞り込む`}
                  >
                    <span className="svc-compare-name">{tag.short}</span>
                    <span className="svc-compare-bar-track">
                      <span
                        className="svc-compare-bar"
                        style={{
                          width: `${(n / serviceUsage[0].n) * 100}%`,
                          background: tag.color,
                        }}
                      />
                    </span>
                    <span className="svc-compare-count">{n}本</span>
                  </button>
                </li>
              ))}
            </ul>
          </details>
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

      {!loading && !error && data && filtered.length === 0 && crossShown.length === 0 && (
        <div className="state">
          <h2>該当する作品がありません</h2>
          <p>検索語や絞り込みを変えてみてください。</p>
        </div>
      )}

      {/* 配信スケジュールカレンダー。放送/配信の初回日時（Annict programs の startedAt）から
          導出した曜日ごとに束ねる。「配信日未定」は programs がない/日時が取れない作品。 */}
      {viewMode === "calendar" && !loading && !error && data && filtered.length > 0 && (
        <>
          {/* 曜日を絞り込むボタン。スマホでは全曜日を横に並べると狭いので、
              曜日を選ぶと1日分だけを大きく表示できるようにする。 */}
          <div className="calendar-days" role="group" aria-label="曜日で絞り込み">
            <button
              type="button"
              className="calendar-day-btn"
              aria-pressed={calendarDay === "all"}
              onClick={() => setCalendarDay("all")}
            >
              すべて
            </button>
            {calendarGroups.map((g) => (
              <button
                key={g.label}
                type="button"
                className="calendar-day-btn"
                aria-pressed={calendarDay === g.label}
                onClick={() => setCalendarDay(g.label)}
              >
                {g.label}
                <span className="calendar-day-btn-count">{g.items.length}</span>
              </button>
            ))}
          </div>
          <p className="calendar-note">
            時刻は初回放送/配信から推定した目安です。話数によって前後する場合があります。
            放送開始の1週間前から表示されます。
          </p>
          <div className="calendar" data-single={calendarDay !== "all"}>
          {visibleCalendarGroups.map((g) => (
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
                      {(() => {
                        const { streaming } = splitRentalServices(it.services, RENTAL_SERVICES[it.id]);
                        if (streaming.length === 0 && it.otherServices.length === 0) return null;
                        return (
                          <div className="badges calendar-badges">
                            {streaming.map((s) => (
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
                        );
                      })()}
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
              {/* 上部バー：放送タイミング（左）＋クール（右）。 */}
              <div className="card-topbar">
                <span className="card-air-time">{airLabel(it) ?? "放送時期未定"}</span>
                <span className="card-cool">{currentSeasonLabel}</span>
              </div>
              {/* タイトル（全幅）。 */}
              <div className="card-head">
                <h3 className="card-title">
                  <Link href={`/anime/${it.id}`}>{it.title}</Link>
                </h3>
              </div>
              {/* 中段：サムネ（左）＋配信サービス（右）。 */}
              <div className="card-main">
                <div className="card-thumb-col">
                  {/* 権利者の画像は使わない。AI独断解釈サムネ（本作品と無関係な創作）が
                      あればそれを、無ければモノグラムタイルを出す。 */}
                  <WorkTile id={it.id} title={it.title} />
                  <div className="card-actions">
                    <button
                      type="button"
                      className="card-action share"
                      aria-label={`「${it.title}」をシェア`}
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
                    <button
                      type="button"
                      className="card-action watched-btn"
                      aria-pressed={watched.has(it.id)}
                      aria-label={
                        watched.has(it.id)
                          ? "視聴済みから削除"
                          : user
                            ? "視聴済みにする"
                            : "視聴済みにする（Googleログインが必要）"
                      }
                      title="見た作品"
                      onClick={() => toggleWatched(it.id)}
                    >
                      {/* 絵文字だと環境依存で表示されない/文字化けすることがあるため、
                          確実に表示されるSVGの目玉アイコンにしている（stroke=currentColorで
                          視聴済み時の色変化にも追従する）。 */}
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        width="16"
                        height="16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="card-action notify-btn"
                      aria-pressed={notifyRequested.has(it.id)}
                      aria-label={
                        notifyRequested.has(it.id)
                          ? "配信通知を解除"
                          : user
                            ? "配信開始をメールで通知"
                            : "配信開始をメールで通知（Googleログインが必要）"
                      }
                      title="配信開始を通知"
                      onClick={() => toggleNotify(it.id)}
                    >
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        width="16"
                        height="16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="card-svc-col">
                  <ServiceMarks
                    services={splitRentalServices(it.services, RENTAL_SERVICES[it.id]).streaming}
                    otherServices={it.otherServices}
                    hasBroadcastData={it.hasBroadcastData}
                  />
                </div>
              </div>
              {/* 最下段：注目人数（左）＋公式サイト（右）。サムネ・配信の下に置く。 */}
              <div className="card-foot">
                {it.watchers > 0 ? (
                  <span className="card-pop" title="Annictで視聴登録している人数">
                    {it.watchers.toLocaleString()}人が注目
                  </span>
                ) : (
                  <span />
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

      {/* クール横断検索の結果。検索語が入っている時だけ、表示中クール以外の作品を
          別枠で出す（配信サービス等の重いデータは持たないので、作品ページへ誘導する）。 */}
      {viewMode === "grid" && !loading && !error && data && crossShown.length > 0 && (
        <section className="cross" aria-label="他のクールの検索結果">
          <h2 className="cross-title">
            他のクールの作品
            <span className="cross-count">{crossMatches.length}件</span>
          </h2>
          <div className="grid">
            {crossShown.map((e) => (
              <article key={e.id} className="card card-compact">
                <div className="thumb thumb-empty" style={posterStyle(e.id)} aria-hidden>
                  <MonoLabel title={e.title} />
                </div>
                <div className="card-body">
                  <span className="card-season">
                    {e.year ? `${e.year}年 ${e.season ? SEASON_LABEL[e.season] ?? "" : ""}` : "放送時期不明"}
                  </span>
                  <h3 className="card-title">
                    <Link href={`/anime/${e.id}`}>{e.title}</Link>
                  </h3>
                  <Link href={`/anime/${e.id}`} className="official">
                    配信情報を見る →
                  </Link>
                </div>
              </article>
            ))}
          </div>
          {crossMatches.length > crossShown.length && (
            <p className="cross-more">
              ほか {crossMatches.length - crossShown.length} 件。検索語をもう少し具体的にすると絞り込めます。
            </p>
          )}
        </section>
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
        {" "}
        <Link href={`/exclusive/${year}/${season}`}>{year}年{SEASON_LABEL[season]}アニメの独占配信まとめ</Link>
        {" ・ "}
        <Link href={`/rankings/${year}/${season}`}>配信サービス勢力図・ランキング</Link>
        {" ・ "}
        <Link href="/about">運営者情報</Link>
      </p>
      </main>

      <ScrollTopButton />
    </div>
  );
}

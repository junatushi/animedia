"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { textOn } from "@/lib/services";
import type { SeasonResponse, ServiceTag } from "@/lib/types";

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
  // 色相は固定し、彩度と明度だけを作品ごとに振って統一感のある
  // 空色〜蒼のシステムウィンドウ風グラデーションにする。
  const s = 50 + (id % 5) * 6;
  const l1 = 14 + (id % 4) * 2;
  const l2 = 8 + ((id * 3) % 4);
  return {
    background: `linear-gradient(150deg, hsl(205 ${s}% ${l1}%), hsl(216 ${s + 6}% ${l2}%))`,
  };
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

export default function Page() {
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: thisYear - 2009 }, (_, i) => thisYear - i);

  const [year, setYear] = useState(thisYear);
  const [season, setSeason] = useState<string>(currentSeasonKey());
  const [data, setData] = useState<SeasonResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [active, setActive] = useState<Set<string>>(new Set());

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

  useEffect(() => {
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
    return data.items.filter((it) => {
      const okText = q === "" || it.title.toLowerCase().includes(q);
      const okSvc =
        active.size === 0 || it.services.some((s) => active.has(s.key));
      return okText && okSvc;
    });
  }, [data, query, active]);

  function toggle(key: string) {
    setActive((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

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
                onClick={() => setSeason(s.key)}
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
          <div className="count">
            <b>{filtered.length}</b> 作品
            {filtered.length !== data.count ? `（全 ${data.count} 中）` : ""}
          </div>
        )}
      </div>

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

      {!loading && !error && data && filtered.length > 0 && (
        <div className="grid">
          {filtered.map((it) => (
            <article key={it.id} className="card">
              <span className="slash" aria-hidden="true" />
              {/* 著作権配慮のため外部の作品画像は読み込まず、作品IDから生成した
                  グラデーション＋頭文字のモノグラムタイルに統一する。 */}
              <div className="thumb thumb-empty" style={posterStyle(it.id)} aria-hidden>
                <MonoLabel title={it.title} />
              </div>
              <div className="card-body">
                <h3 className="card-title">{it.title}</h3>

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

      <p className="footnote">
        データ元: Annict（コミュニティ更新ベース）。配信情報は網羅率100%ではなく、
        新作は反映が遅れることがあります。視聴前に各サービスの最新情報もご確認ください。
        「その他配信」は未登録サービスの可能性があり、点線で表示しています。
      </p>
    </div>
  );
}

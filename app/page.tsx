"use client";

import { useEffect, useMemo, useState } from "react";
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

// Annict は画像ホスティングを廃止しており画像はほぼ常に null。
// その場合に味気ない空欄を出さないよう、作品ごとに色違いの
// グラデーション＋頭文字（モノグラム）の「デザインタイル」を生成する。
function posterStyle(id: number): React.CSSProperties {
  const h = (id * 47) % 360;
  // ミニマル＝明るく淡いトーンのグラデーション（色はごく控えめ）
  return {
    background: `linear-gradient(150deg, hsl(${h} 36% 94%), hsl(${(h + 40) % 360} 32% 87%))`,
  };
}
function monogram(title: string): string {
  const ch = [...title.trim()];
  return ch.length ? ch.slice(0, 1).join("") : "?";
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
        <div className="brandrow">
          <h1 className="brand">
            アニメ配信ガイド<span className="dot">.</span>
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
            シーズンのアニメを、観られる国内配信サービスで一覧。
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
          <span className="control-label">年</span>
          <select
            className="year-select"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            aria-label="年"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>

        <input
          className="search"
          type="text"
          placeholder="作品名で検索…"
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
              {it.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="thumb" src={it.image} alt="" loading="lazy" />
              ) : (
                <div className="thumb thumb-empty" style={posterStyle(it.id)} aria-hidden>
                  <span className="mono">{monogram(it.title)}</span>
                </div>
              )}
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

"use client";

// 実利用者の表示速度（Core Web Vitals）と、外部リファラのホスト名を記録する
// （2026-09-06導入）。
//
// ───────────────────────────────────────────────────────────────
// 【なぜ要るか】
// このサイトは「表示を2秒未満にする」という目標を掲げながら、**実利用者の速度を
// 一度も測っていなかった**。使える計測は次のとおりで、どれも判定に足りない:
//
//   ・PageSpeed Insights のラボ値 … ノイズが±300ms級（**変更していない**作品ページが
//     −234ms動いた実測がある）。50ms級の改善を判定できない
//   ・CrUX … このサイトのデータが無い（トラフィックが閾値に届かない）
//   ・@vercel/analytics … CWVは測っていない（それは別製品の @vercel/speed-insights で、
//     このリポジトリには入っていない）。しかもダッシュボードはセッションから読めない
//   ・ローカル実測 … この環境は実データ・実画像の入った画面を描けない（㊶）
//
// リファラも同じで、`app/api/track/route.ts` も `middleware.ts` も
// **リファラを一度も記録していなかった**。そのため
// `docs/ai-era-strategy-2026-08-13.md` の「AI検索からの流入が月1件以上あるか」という
// 判定条件は、**実際に流入があっても0件のまま期限（2026-11-13）を迎える**状態だった。
//
// 【設計上の約束】
// ①**初期JSを重くしない**のがこのサイトの方針（ログイン用JSを遅延読込にしている）。
//   ここで使う `useReportWebVitals` は Next.js 同梱なので**新しい依存は増えない**。
//   実測の増分は commit メッセージに残す。
// ②**送信はまとめる**。指標が確定するたびに送るとページビュー×5件に
//   なり、Supabaseへの往復＝Fluid Provisioned Memory（I/O待ちも課金される・㉝④）を
//   無駄に食う。指標は溜めておき、ページを離れるときに1件だけ送る。
//   2026-10-26に足した「画面に出た欄」（seen）も、新しい送信を増やさず web_vitals と nav に相乗りする。
//   単独で送るのは、画面内の移動のあとに閉じたページの分（seen）と、外部リンクのクリック（outbound_click）だけ。
// ③**リファラは「ホスト名」だけ**を送る。生のURLは検索語などを含みうるので保存しない。
//   自サイト内の遷移は送らない（外から来たときだけ）。
// ④面（ページ種別）は**先頭セグメントだけ**をその場で求める。
//   `scripts/lib/gsc-page-type.js` を import してはいけない
//   （`vercel.json` が `scripts/` をデプロイ対象外にしている前提が崩れる。
//   その前提は `node scripts/check.ts` が検査している）。
// ───────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useReportWebVitals } from "next/web-vitals";
import { buildDiagnostics, currentAgent, landingSource, refTag, vitalsPayload } from "@/lib/vitalsDiagnostics";
import { KNOWN_FACES, SECTION_RE } from "@/lib/trackEventData";

// 着地したときのクエリ。**モジュールの読み込み時（＝hydrationより前）に控える**（2026-10-21）。
// トップ（/）では SeasonExplorer の URL 同期が先に replaceState("/") して `?ref=` を消す
// （子の effect は親より先に走り、layout では {children} が <WebVitals/> より前にある）。
// effect の中で location.search を読むと、`/?ref=xxx` で来た人の tag が必ず空になる。
const LANDING_SEARCH = typeof window !== "undefined" ? window.location.search : "";

// 面（ページ種別）。SEOレポートの「面」と同じ粒度に揃えるが、
// 分類そのものは共有しない（上の④）。知らない接頭辞は "other" に落とす。
// 面の一覧は lib/trackEventData.ts の KNOWN_FACES（集計がその一覧の値だけを数えるので1箇所に置く）。
function faceOf(pathname: string): string {
  const first = pathname.split("/")[1] ?? "";
  if (first === "") return "home";
  return first !== "home" && first !== "other" && KNOWN_FACES.has(first) ? first : "other";
}

// 送信は sendBeacon を優先する。ページを離れる瞬間でも届きやすく、
// fetch(keepalive) より取りこぼしが少ない。使えない環境では fetch に落とす。
function send(event: string, data: Record<string, string | number>) {
  const body = JSON.stringify({ event, data });
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon("/api/track", blob)) return;
    }
    void fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // 計測の失敗は体験に影響させない（既存の lib/logEvent.ts と同じ方針）。
  }
}

// FCP/LCP が遅いときに「どこで遅いか」を切り分ける補助指標（2026-09-24追加）。
// 合成計測は全面 LCP 600ms未満なのに、RUM の p75 は作品・声優・サービス別で
// FCP 2.8〜3.2秒あった。TTFB の p75 は 0.3〜1.0秒なので、差の約2秒は
// 「HTMLが届いてから描くまで」にあるが、端末の違いなのか回線の違いなのかを
// RUM が区別できず、手元のラボでは再現しなかった（同一条件で FCP が 328〜2,324ms とぶれる）。
//   ・HTML_DL … HTML本体の受信にかかった時間（responseEnd − responseStart）。
//     大きければ回線、小さいのに FCP が遅ければ端末側（解析・レイアウト・描画）。
//   ・FCP_touch / LCP_touch と FCP_mouse / LCP_mouse … 同じ値を操作手段で分けて複製する。
//     集計（lib/adminAnalytics.ts の vitalsP75）は数値のキーを指標として面ごとに
//     p75 を取るので、キー名で分ければ集計側を変えずにスマホとPCを分けて見られる。
// どれも既存の FCP/LCP を置き換えない（既存の判定と時系列を途切れさせない）。
// 2026-09-29に回線の種類・転送量・RTTを追加し、組み立ては lib/vitalsDiagnostics.ts へ移した
// （キー数の上限を node scripts/check.ts がその関数の実際の出力で検査するため）。
// ここではブラウザから値を読むだけにする。
function diagnostics(m: Record<string, number>): Record<string, number> {
  try {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const conn = (navigator as Navigator & { connection?: { effectiveType?: string; rtt?: number } })
      .connection;
    return buildDiagnostics(m, {
      nav,
      coarse: window.matchMedia("(pointer: coarse)").matches,
      connection: conn ? { effectiveType: conn.effectiveType, rtt: conn.rtt } : undefined,
    });
  } catch {
    // 補助指標が取れなくても本体の指標は送る
    return {};
  }
}

// ── 押したリンクがあった欄（2026-10-26）。クリックは遷移より先に起きるので、ここで控えて次の nav に付ける。
// 欄はページ側が data-nav 属性で囲んで示す（値は SECTION_RE の形）。
// 欄の外のリンク・戻る/進む・アドレスバーからの移動では付かない。
let pendingVia: { via: string; at: number } | null = null;
/**
 * クリックから遷移までにこれ以上かかったら、そのクリックによる移動とはみなさない。
 * 作品ページは loading.tsx を置かない（ソフト404回避）ので、遅いときはデータが届くまで
 * パスが変わらない（初回の生成で数十秒の実測がある）。短いと遅いページほど欄が付かずに偏る。
 * 戻る・進む（popstate）では捨てる（クリックと無関係の移動に付けない。BackLink の戻るは残す）。
 */
const VIA_TTL_MS = 60_000;

function sectionOf(el: Element | null): string | null {
  const v = el?.closest("[data-nav]")?.getAttribute("data-nav");
  return v && SECTION_RE.test(v) ? v : null;
}

/** 1ページ（画面内の移動1回ぶん）の「画面に出た欄」。1ページにつき1回だけ送る。 */
type PageSeen = { face: string; landing: boolean; sections: boolean; seen: Set<string>; reported: boolean };

/** 送る形（カンマ区切り）にして、送ったことにする。欄の無いページ・送り済みなら null。 */
function takeSeen(page: PageSeen | null): string | null {
  if (!page || !page.sections || page.reported) return null;
  page.reported = true;
  let out = "";
  for (const name of page.seen) {
    const next = out === "" ? name : `${out},${name}`;
    // 文字列の上限（MAX_STRING=64）を超えると欄ごと落ちるので、収まる分だけにする。
    if (next.length > 64) break;
    out = next;
  }
  return out === "" ? "-" : out;
}

export default function WebVitals() {
  // 指標が確定するたびにここへ溜め、離脱時に1件だけ送る。
  const metrics = useRef<Record<string, number>>({});
  const sent = useRef(false);
  const pathname = usePathname();
  const prevPath = useRef<string | null>(null);
  const agent = useRef("other");
  const page = useRef<PageSeen | null>(null);

  // ── ③ サイト内の移動（2026-10-21追加）。クライアント側の遷移は web_vitals に残らないので、
  // パスが変わるたびに「どの面からどの面へ」を1件送る。初回（着地）は送らない＝1遷移1件。
  // クエリだけの変化（一覧の ?year= の書き換え）はパスが変わらないので数えない。
  // 戻る・進むでもパスは変わるので、それも1回の移動として数える。
  // 2026-10-26: 押したリンクの欄（via）と、離れたページで画面に出た欄（seen）も付ける。
  useEffect(() => {
    if (!pathname) return;
    const prev = prevPath.current;
    if (prev === pathname) return;
    prevPath.current = pathname;
    const left = page.current;
    const cur: PageSeen = {
      face: faceOf(pathname),
      landing: prev === null,
      sections: false,
      seen: new Set(),
      reported: false,
    };
    page.current = cur;
    const via = pendingVia && Date.now() - pendingVia.at < VIA_TTL_MS ? pendingVia.via : null;
    pendingVia = null;
    // 自動アクセスの移動は集計で捨てるので送らない（/api/track と Supabase への書き込みを増やさない）。
    if (prev !== null && agent.current !== "bot") {
      const seen = takeSeen(left);
      send("nav", {
        face: cur.face,
        from: faceOf(prev),
        ua: agent.current,
        ...(via ? { via } : {}),
        ...(seen ? { seen } : {}),
      });
    }
  }, [pathname]);

  // 新しいページの欄の観測。上の effect とは分ける（上は同じパスで2回走ると何もしないので、
  // 開発時の StrictMode の付け外しで観測だけが外れたままになる）。上で作った page.current を使う。
  // 下端から15%は「まだ出ていない」扱い（端がのぞいただけを数えない）。
  useEffect(() => {
    const cur = page.current;
    if (!cur) return;
    let io: IntersectionObserver | null = null;
    const rescans: ReturnType<typeof setTimeout>[] = [];
    try {
      const observed = new Set<Element>();
      io = new IntersectionObserver(
        (entries) => {
          for (const en of entries) {
            if (!en.isIntersecting) continue;
            const name = sectionOf(en.target);
            if (name) cur.seen.add(name);
            io?.unobserve(en.target);
          }
        },
        { rootMargin: "0px 0px -15% 0px" }
      );
      const scan = () => {
        document.querySelectorAll("[data-nav]").forEach((el) => {
          if (observed.has(el)) return;
          observed.add(el);
          cur.sections = true;
          io?.observe(el);
        });
      };
      scan();
      // 後から差し込まれる欄（ストリーミング・一覧のデータ取得後の描画）を拾い直す。
      rescans.push(setTimeout(scan, 1500), setTimeout(scan, 5000));
    } catch {
      // IntersectionObserver が無い環境では欄を数えない（sections=false のまま＝分母にも入らない）
    }
    return () => {
      rescans.forEach(clearTimeout);
      io?.disconnect();
    };
  }, [pathname]);

  // **渡す関数は useCallback で固定する**（2026-10-21・反証レビューで判明）。
  // useReportWebVitals は渡された関数を effect の依存に持ち、変わるたびに onLCP/onINP 等を
  // 登録し直す（web-vitals には登録を外す手段が無い）。usePathname を足してからは画面内の
  // 移動ごとにこの部品が再描画されるので、インラインの関数だと移動のたびに観測が積み上がる。
  const report = useCallback((metric: { name: string; value: number }) => {
    // 値は小数以下が長いので丸める。CLS だけは小さい値なので3桁残す。
    metrics.current[metric.name] =
      metric.name === "CLS" ? Math.round(metric.value * 1000) / 1000 : Math.round(metric.value);
  }, []);
  useReportWebVitals(report);

  useEffect(() => {
    const face = faceOf(window.location.pathname);
    // 着地の流入元（外部ならホスト名・無ければ direct・自サイト内なら internal）と
    // 端末の大まかな種類。どちらも web_vitals に付けて「人か自動アクセスか」
    // 「どこから来てどの面に着地したか」を数えられるようにする（2026-10-21）。
    let src = "direct";
    const ua = currentAgent();
    agent.current = ua;
    try {
      src = landingSource(document.referrer, window.location.hostname);
    } catch {
      // 読めなくても計測本体は続ける
    }

    // ── ① 外部リファラのホスト名（ページを開いた直後に1回だけ）
    // すぐ離脱する人の分も取りたいので、離脱時ではなくここで送る。
    // 自サイト内の遷移は送らない（外から来た経路だけを知りたい）。
    // `?ref=<媒体>`（返信・埋め込みに付けるリンク）はリファラが消えるアプリ内ブラウザから
    // 来ることがあるので、リファラが無くても tag があれば送る（2026-10-21）。
    try {
      const tag = refTag(LANDING_SEARCH);
      const external = src !== "direct" && src !== "internal";
      if (external || tag) {
        // ua も付ける（流入元・?ref= の集計から自動アクセスを除くため）。
        send("page_view", {
          ...(external ? { ref: src } : {}),
          face,
          ua,
          ...(tag ? { tag } : {}),
        });
      }
    } catch {
      // referrer が壊れた値でも計測以外に影響させない
    }

    // ── ④ リンクのクリック（2026-10-26）。サイト内なら欄を控えて次の nav に付け、
    // 外部なら outbound_click を1件送る。外部リンクの種類はページ側が `data-out` で示す
    // （無ければ other）。**自分でイベントを送るリンクは数えない**（`data-selflog` を付ける。
    // 配信サービスのバッジ＝official_link_click / affiliate_click、SNSフォロー＝follow_click。
    // ここでも送ると二重になる）。
    // URL・作品名は送らない（種類と欄の名前だけ）。
    const onClick = (e: MouseEvent) => {
      try {
        const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
        if (!a) return;
        const url = new URL(a.href, window.location.href);
        const via = sectionOf(a);
        if (url.origin === window.location.origin) {
          // 画面内の移動にならないクリックでは控えない（新しいタブ・ダウンロード・同じページ内）。
          // 控えると、10秒〜1分以内の戻る・進むなど無関係の移動に欄が付いてしまう。
          const newTab = e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target === "_blank";
          if (newTab || a.hasAttribute("download") || url.pathname === window.location.pathname) return;
          pendingVia = via ? { via, at: Date.now() } : null;
          return;
        }
        if (!/^https?:$/.test(url.protocol) || a.hasAttribute("data-selflog") || agent.current === "bot") return;
        const kind = a.getAttribute("data-out");
        send("outbound_click", {
          face: faceOf(window.location.pathname),
          kind: kind && SECTION_RE.test(kind) ? kind : "other",
          ...(via ? { via } : {}),
          ua: agent.current,
        });
      } catch {
        // 計測の失敗はクリックの邪魔をしない
      }
    };
    document.addEventListener("click", onClick, true);
    // 戻る・進むでは控えた欄を捨てる。ただし直前（1秒以内）のクリックが起こした戻る
    // （BackLink の router.back()）はそのクリックの移動なので残す。
    const onPop = () => {
      if (pendingVia && Date.now() - pendingVia.at > 1000) pendingVia = null;
    };
    window.addEventListener("popstate", onPop);

    // ── ② Core Web Vitals（離脱時にまとめて1件）
    const flush = () => {
      const cur = page.current;
      const m = metrics.current;
      // 1つも確定していないなら送らない（空行を作らない）。
      if (!sent.current && Object.keys(m).length > 0) {
        sent.current = true;
        // 着地したページのままなら、画面に出た欄もここに相乗りさせる。
        const seen = cur?.landing ? takeSeen(cur) : null;
        // face・ua・src を先頭に置く。キー数の上限（MAX_KEYS）は先頭から数えるので、
        // 末尾に置くと補助指標を足した日にそこだけ落ちて面が "other" に化ける。
        // 並べ方は vitalsPayload が1箇所で持つ（node scripts/check.ts も同じ関数で最大形を作る）。
        send("web_vitals", vitalsPayload({ face, ua, src, ...(seen ? { seen } : {}) }, m, diagnostics(m)));
      }
      // 画面内を移動したあとのページ（または指標が1つも無いまま閉じた着地ページ）の欄は単独で送る。
      if (agent.current !== "bot") {
        const seen = takeSeen(cur);
        if (seen && cur) send("seen", { face: cur.face, ua: agent.current, seen });
      }
    };

    // visibilitychange(hidden) が最も確実。pagehide も併せて張る
    // （iOS Safari は visibilitychange を飛ばすことがある）。
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPop);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
    };
  }, []);

  return null;
}

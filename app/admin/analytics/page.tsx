import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createServiceClient } from "@/lib/supabase/service";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const metadata: Metadata = { robots: { index: false, follow: false } };
// 集計対象は毎回最新にする（キャッシュされた古い数字を運営者に見せない）。
export const dynamic = "force-dynamic";

// 運営者本人だけが見られる簡易ダッシュボード。ログイン機能（Supabase Auth）とは別に、
// 共有URLに ?token=... を付ける方式にしている（管理者ロールを新設する規模ではないため、
// app/api/notify/run が使う x-cron-secret ヘッダー方式と同じ「固定シークレットの一致」で
// 十分と判断した。ヘッダーではなくクエリパラメータなのは、ブラウザで直接開く画面のため）。
const WINDOW_DAYS = 30;
const MAX_ROWS = 5000;

type EventRow = { event_name: string; event_data: Record<string, unknown> | null; created_at: string };

const EVENT_LABELS: Record<string, string> = {
  share_site: "サイト全体を共有",
  share_work: "作品を共有",
  favorite_add: "お気に入り登録",
  watched_add: "視聴済みに登録",
  notify_add: "配信通知を登録",
  filter_service: "配信サービスで絞り込み",
  filter_cast: "声優で絞り込み",
  change_season: "シーズン切り替え",
  // フッターのフォロー導線（2026-08-06追加。components/FollowLinks.tsx）。
  // Xのフォロワーを増やす手段のうち、サイト側で測れる唯一の数字なので必ず出す。
  follow_click: "SNSフォロー導線をクリック",
  // カレンダー購読（2026-08-07追加。app/calendar.ics / components/FollowLinks.tsx）。
  // フォローと違い、購読されるとこちらが投稿しなくても毎週相手のカレンダーに出る。
  // 定着（Direct流入）の施策なので、follow_click と並べて比較する
  // （docs/growth-strategy-2026-08.md ／ docs/operations.md ⑱）。
  calendar_subscribe: "カレンダー購読をクリック",
  // 【2026-08-06追加】配信バッジのクリック。`components/ServiceMarks.tsx` が
  // 2026-07-19からずっと記録していたのに、このラベル表に載っていなかったため
  // ダッシュボードのどこにも出ていなかった（`events` は EVENT_LABELS のキーから
  // 作られるので、ここに無いイベントは表にもグラフにも現れない）。
  // アフィリエイトの提携先を決める判断材料そのものなので必ず出す。
  affiliate_click: "広告リンクをクリック（提携済み）",
  official_link_click: "公式サイトへ（未提携）",
  // 配信先ウィジェットの貼り付けコードがコピーされた（2026-08-06追加。
  // components/EmbedSnippet.tsx）。被リンク施策（docs/operations.md ⑯）の
  // 効果測定の起点で、コピー数と ?ref=embed の流入を突き合わせて
  // 「貼られていないのか／貼られたが押されないのか」を切り分ける。
  embed_copy: "埋め込みコードをコピー",
};

function countBy(rows: EventRow[], since: Date | null): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (since && new Date(row.created_at) < since) continue;
    counts[row.event_name] = (counts[row.event_name] ?? 0) + 1;
  }
  return counts;
}

// filter_service / filter_cast のように event_data に識別子が付くイベントの、
// 値ごとの内訳（例: どの配信サービスがよく絞り込まれるか）。
function countByDataField(rows: EventRow[], eventName: string, field: string): [string, number][] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.event_name !== eventName) continue;
    const value = row.event_data?.[field];
    if (typeof value !== "string") continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
}

function Bar({ label, count, max }: { label: string; count: number; max: number }) {
  const pct = max > 0 ? Math.max(4, Math.round((count / max) * 100)) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
      <span style={{ width: 160, flexShrink: 0, fontSize: 13, color: "var(--muted)" }}>{label}</span>
      <div style={{ flex: 1, background: "var(--paper)", borderRadius: "var(--radius)", overflow: "hidden" }}>
        <div
          style={{
            width: `${pct}%`,
            background: "var(--accent)",
            height: 16,
            borderRadius: "var(--radius)",
          }}
        />
      </div>
      <span style={{ width: 40, textAlign: "right", fontFamily: "var(--mono)", fontSize: 13 }}>{count}</span>
    </div>
  );
}

export default async function AnalyticsDashboard({
  searchParams,
}: {
  searchParams: { token?: string };
}) {
  const adminToken = process.env.ADMIN_DASHBOARD_TOKEN;
  if (!adminToken) {
    return (
      <main style={{ padding: 32, fontFamily: "var(--mono)", color: "var(--ink)", background: "var(--bg)" }}>
        <p>効果測定ダッシュボードは未設定です（ADMIN_DASHBOARD_TOKEN が未設定）。</p>
        <p>設定手順は docs/operations.md「計測の見かた」を参照してください。</p>
      </main>
    );
  }
  // トークン不一致・未指定は「存在しないページ」として扱う（不一致の理由を教えない）。
  if (searchParams.token !== adminToken) {
    notFound();
  }
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return (
      <main style={{ padding: 32, fontFamily: "var(--mono)", color: "var(--ink)", background: "var(--bg)" }}>
        <p>Supabaseが未設定のため、計測データがありません。</p>
      </main>
    );
  }

  const supabase = createServiceClient();
  const since = new Date();
  since.setDate(since.getDate() - WINDOW_DAYS);

  const { data, error } = await supabase
    .from("analytics_events")
    .select("event_name, event_data, created_at")
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);

  if (error) {
    return (
      <main style={{ padding: 32, fontFamily: "var(--mono)", color: "var(--ink)", background: "var(--bg)" }}>
        <p>取得に失敗しました: {error.message}</p>
      </main>
    );
  }

  const rows = (data ?? []) as EventRow[];
  const totalCounts = countBy(rows, null);
  const last7Counts = countBy(rows, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
  const events = Object.keys(EVENT_LABELS);
  const maxTotal = Math.max(1, ...events.map((e) => totalCounts[e] ?? 0));

  const topServices = countByDataField(rows, "filter_service", "service");
  const maxService = Math.max(1, ...topServices.map(([, n]) => n));

  // 【2026-08-06追加】配信バッジのクリックをサービス別に出す。
  // 未提携（official_link_click）の多い順が、そのまま「次にどのASPと提携すれば
  // 収益が増えるか」の答えになる。掲載本数からの推定（docs/affiliate-setup.md の
  // 「提携の優先順位」）より、こちらの実クリックのほうが一次情報として強い。
  const affiliateClicks = countByDataField(rows, "affiliate_click", "service");
  const officialClicks = countByDataField(rows, "official_link_click", "service");
  const maxAffiliate = Math.max(1, ...affiliateClicks.map(([, n]) => n));
  const maxOfficial = Math.max(1, ...officialClicks.map(([, n]) => n));

  return (
    <main
      style={{
        padding: 32,
        maxWidth: 720,
        margin: "0 auto",
        fontFamily: "var(--mono)",
        color: "var(--ink)",
        background: "var(--bg)",
        minHeight: "100vh",
      }}
    >
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>効果測定ダッシュボード</h1>
      <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 24 }}>
        直近{WINDOW_DAYS}日間・最大{MAX_ROWS}件を集計（Supabase自前計測。IPアドレス・ユーザーIDは記録していません）。
      </p>

      <h2 style={{ fontSize: 15, marginBottom: 10 }}>イベント別件数（直近7日 / 直近{WINDOW_DAYS}日）</h2>
      {events.map((e) => (
        <Bar key={e} label={EVENT_LABELS[e]} count={last7Counts[e] ?? 0} max={maxTotal} />
      ))}
      <table style={{ width: "100%", marginTop: 16, fontSize: 13, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)" }}>
            <th style={{ textAlign: "left", padding: "4px 0" }}>イベント</th>
            <th style={{ textAlign: "right", padding: "4px 0" }}>直近7日</th>
            <th style={{ textAlign: "right", padding: "4px 0" }}>直近{WINDOW_DAYS}日</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e} style={{ borderBottom: "1px solid var(--border-soft)" }}>
              <td style={{ padding: "4px 0" }}>{EVENT_LABELS[e]}</td>
              <td style={{ textAlign: "right" }}>{last7Counts[e] ?? 0}</td>
              <td style={{ textAlign: "right" }}>{totalCounts[e] ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {topServices.length > 0 && (
        <>
          <h2 style={{ fontSize: 15, margin: "28px 0 10px" }}>配信サービス別 絞り込み回数（直近{WINDOW_DAYS}日）</h2>
          {topServices.map(([service, n]) => (
            <Bar key={service} label={service} count={n} max={maxService} />
          ))}
        </>
      )}

      {officialClicks.length > 0 && (
        <>
          <h2 style={{ fontSize: 15, margin: "28px 0 4px" }}>
            未提携サービスへのクリック（直近{WINDOW_DAYS}日）
          </h2>
          <p style={{ color: "var(--muted)", fontSize: 12, marginBottom: 10 }}>
            提携が無いため公式サイトへ素通ししているクリック。
            <strong>多い順に提携すれば、そのぶんがそのまま収益機会になる</strong>。
            手順は <code>docs/affiliate-setup.md</code>「提携の優先順位」。
          </p>
          {officialClicks.map(([service, n]) => (
            <Bar key={service} label={service} count={n} max={maxOfficial} />
          ))}
        </>
      )}

      {affiliateClicks.length > 0 && (
        <>
          <h2 style={{ fontSize: 15, margin: "28px 0 4px" }}>
            提携済みサービスへのクリック（直近{WINDOW_DAYS}日）
          </h2>
          <p style={{ color: "var(--muted)", fontSize: 12, marginBottom: 10 }}>
            収益になりうるクリック。<strong>成果（登録完了）の件数はASPの管理画面にしか出ない</strong>ので、
            ここで分かるのはクリックまで。
          </p>
          {affiliateClicks.map(([service, n]) => (
            <Bar key={service} label={service} count={n} max={maxAffiliate} />
          ))}
        </>
      )}
    </main>
  );
}

// Annict の seriesList が使えるかを調べる「探り」スクリプト（2026-08-11導入）。
//
// 【なぜ要るか】
// content/works/series.ts（1期↔2期の対応表）は人力で維持している。Annictには
// シリーズを表す `seriesList` があるはずだが、Claudeのセッション環境からは
// Annictへの通信ができず**応答を一度も見たことがない**。未検証のフィールドを
// lib/annict.ts の一覧クエリに足すと、名前や形が違ったときに**クエリ全体が
// エラーになり、サイト全部の配信情報が消える**。だから本番のクエリに足す前に、
// 手元（トークンのあるPC）で応答を確かめる必要がある。
//
// 【このスクリプトが安全な理由】
//   ・読み取りだけ。Annictに何も書き込まない
//   ・lib/annict.ts の本番クエリを一切変更しない（このファイルは誰からもimportされない）
//   ・**フィールド名を決め打ちしない**。まずGraphQLのイントロスペクションで
//     「Work型に seriesList はあるか」「返る型は何か」を聞き、その答えから
//     問い合わせ文を組み立てる。だから「無いフィールドを指定して失敗する」が起きない
//
// 【使い方】
//   node scripts/probe-series.ts            … series.ts に載っている作品で試す
//   node scripts/probe-series.ts 14132 16555 … 作品IDを指定して試す
//
// 要 ANNICT_TOKEN（.env.local から読む。トークンの中身は出力しない）。
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SERIES } from "../content/works/series.ts";

// ANNICT_GRAPHQL_ENDPOINT はテスト（scripts/check-probe-series.js）でローカルの
// スタブサーバーに向けるための差し替え口。**差し替えるのはURLという値だけ**で、
// 判断の分岐はテストと本番で同じ経路を通す（CLAUDE.mdの基本ルール）。
const ENDPOINT = process.env.ANNICT_GRAPHQL_ENDPOINT || "https://api.annict.com/graphql";

function loadEnvLocal(): void {
  const path = join(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    const [, key, rawValue] = m;
    if (process.env[key] === undefined) {
      process.env[key] = rawValue.trim().replace(/^["']|["']$/g, "");
    }
  }
}

let token = "";

// 再試行の待ち時間。テストから短くするための差し替え口（値だけ）。
const RETRY_BASE_MS = Number(process.env.PROBE_RETRY_BASE_MS ?? 800);
// 1件ずつ問い合わせるときの間隔。Annictに負荷をかけないため。
const GAP_MS = Number(process.env.PROBE_GAP_MS ?? 300);
// 1作品あたりに取るシリーズ数・1シリーズあたりに取る作品数。
// 大きくすると Annict が 500 を返す（2026-08-11実測）。控えめにする。
const SERIES_PER_WORK = 5;
const WORKS_PER_SERIES = 30;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function gql(query: string, label: string, retries = 2): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query }),
    });
    const text = await res.text();
    if (!res.ok) {
      // 一時的なエラー（5xx・429）だけ再試行し、恒久的なエラー（401など）は即失敗させる
      // ＝CLAUDE.mdの「外部APIに投げる処理」の基本ルール。
      const transient = res.status >= 500 || res.status === 429;
      if (transient && attempt < retries) {
        await sleep(RETRY_BASE_MS * 2 ** attempt);
        continue;
      }
      const body = text.slice(0, 200).replace(/\s+/g, " ").trim();
      throw new Error(
        `${label}: HTTP ${res.status} ${res.statusText}${body ? ` / 応答: ${body}` : ""}`
      );
    }
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`${label}: JSONとして読めない応答（${text.slice(0, 120)}）`);
    }
    if (json.errors) {
      // GraphQLは200でエラーを返す。ここを見落とすと「成功した」と誤読する。
      throw new Error(`${label}: ${json.errors.map((e: any) => e.message).join(" / ")}`);
    }
    return json.data;
  }
}

/** NON_NULL / LIST の包みを剥がして、中身の型名と種類を得る。 */
function unwrap(t: any): { name: string | null; kind: string } {
  let cur = t;
  while (cur && (cur.kind === "NON_NULL" || cur.kind === "LIST")) cur = cur.ofType;
  return { name: cur?.name ?? null, kind: cur?.kind ?? "?" };
}

const TYPE_QUERY = (name: string) => `
{
  __type(name: "${name}") {
    name
    kind
    fields {
      name
      type { kind name ofType { kind name ofType { kind name ofType { kind name } } } }
    }
  }
}`;

type FieldInfo = { name: string; type: { name: string | null; kind: string } };

async function typeFields(name: string): Promise<FieldInfo[] | null> {
  const data = await gql(TYPE_QUERY(name), `イントロスペクション(${name})`);
  if (!data.__type) return null;
  return (data.__type.fields ?? []).map((f: any) => ({ name: f.name, type: unwrap(f.type) }));
}

/**
 * コネクション型（*Connection）から「1件ぶんの型」まで降りる。
 * nodes があれば nodes、無ければ edges { node } を使う。
 * 戻り値の selection は、この階層を書くときのGraphQLの断片。
 */
async function connectionShape(
  connName: string
): Promise<{ itemType: string; open: string; close: string } | null> {
  const fields = await typeFields(connName);
  if (!fields) return null;
  const nodes = fields.find((f) => f.name === "nodes");
  if (nodes?.type.name) {
    return { itemType: nodes.type.name, open: "nodes {", close: "}" };
  }
  const edges = fields.find((f) => f.name === "edges");
  if (edges?.type.name) {
    const edgeFields = await typeFields(edges.type.name);
    const node = edgeFields?.find((f) => f.name === "node");
    if (node?.type.name) {
      return { itemType: node.type.name, open: "edges { node {", close: "} }" };
    }
  }
  return null;
}

function ok(msg: string) {
  console.log(`✓  ${msg}`);
}
function ng(msg: string) {
  console.log(`✗  ${msg}`);
}
function info(msg: string) {
  console.log(`ℹ  ${msg}`);
}

async function main() {
  loadEnvLocal();
  token = process.env.ANNICT_TOKEN ?? "";
  if (!token) {
    console.error("ANNICT_TOKEN が未設定です（.env.local を確認してください）。");
    process.exit(1);
  }

  const argIds = process.argv.slice(2).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const targetIds =
    argIds.length > 0 ? argIds : SERIES.flatMap((s) => s.works.map((w) => w.id));

  // ── ① Work型に seriesList があるか ────────────────────────────
  console.log("\n── ① Work型に seriesList があるか ──");
  const workFields = await typeFields("Work");
  if (!workFields) {
    ng("Work型が引けなかった。Annictのスキーマが変わっている可能性がある");
    process.exit(1);
  }
  const seriesField = workFields.find((f) => f.name === "seriesList");
  if (!seriesField) {
    ng("Work型に seriesList が無い");
    info(
      "似た名前のフィールド: " +
        (workFields.filter((f) => /series/i.test(f.name)).map((f) => f.name).join("・") || "なし")
    );
    console.log("\n→ 自動化はできない。content/works/series.ts の人力運用を続ける。");
    process.exit(0);
  }
  ok(`seriesList がある → ${seriesField.type.name}（${seriesField.type.kind}）`);

  // ── ② 返ってくる形 ────────────────────────────────────────
  console.log("\n── ② 返ってくる形 ──");
  const seriesConn = await connectionShape(seriesField.type.name!);
  if (!seriesConn) {
    ng(`${seriesField.type.name} から1件ぶんの型に降りられなかった`);
    process.exit(1);
  }
  ok(`${seriesField.type.name} → ${seriesConn.itemType}`);

  const seriesFields = await typeFields(seriesConn.itemType);
  if (!seriesFields) {
    ng(`${seriesConn.itemType} のフィールドが引けなかった`);
    process.exit(1);
  }
  info(`${seriesConn.itemType} のフィールド: ${seriesFields.map((f) => f.name).join("・")}`);

  // シリーズ名に使えそうなスカラーを拾う（あるものだけ）。
  const nameField = ["name", "nameJa", "title"].find((n) =>
    seriesFields.some((f) => f.name === n)
  );
  // シリーズに属する作品の一覧。
  const worksField = seriesFields.find((f) => f.name === "works");
  if (!worksField?.type.name) {
    ng(`${seriesConn.itemType} に works が無い＝シリーズ内の作品を引けない`);
    console.log("\n→ シリーズ名は取れても「他の作品」は作れない。人力運用を続ける。");
    process.exit(0);
  }
  const worksConn = await connectionShape(worksField.type.name);
  if (!worksConn) {
    ng(`${worksField.type.name} から1件ぶんの型に降りられなかった`);
    process.exit(1);
  }
  ok(`${seriesConn.itemType}.works → ${worksConn.itemType}`);

  const itemFields = await typeFields(worksConn.itemType);
  if (!itemFields) {
    ng(`${worksConn.itemType} のフィールドが引けなかった`);
    process.exit(1);
  }
  info(`${worksConn.itemType} のフィールド: ${itemFields.map((f) => f.name).join("・")}`);

  // 1件ぶんが Work そのものか、Work を包んだ型（item / node / work）かを見る。
  const hasAnnictId = itemFields.some((f) => f.name === "annictId");
  const wrapper = hasAnnictId
    ? null
    : ["item", "work", "node"].find((n) => itemFields.some((f) => f.name === n));
  if (!hasAnnictId && !wrapper) {
    ng(`${worksConn.itemType} から作品IDに辿り着けない`);
    process.exit(1);
  }
  // 並び順の手がかり（第何作か）になりそうなフィールドがあるかも見ておく。
  // スカラー（またはenum）に限る。オブジェクト型を選択すると「selection set が要る」と
  // GraphQLに怒られて、探りそのものが失敗するため。
  const orderHints = itemFields
    .filter((f) => /summary|number|order|position/i.test(f.name))
    .filter((f) => f.type.kind === "SCALAR" || f.type.kind === "ENUM")
    .map((f) => f.name);
  if (orderHints.length > 0) info(`並び順・区分に使えそう: ${orderHints.join("・")}`);

  // シリーズ内の1作品について取るフィールド。包み型（item等）があれば1段くぐる。
  const itemSel = (base: string) => {
    const hints = orderHints.join(" ");
    return (wrapper ? `${hints} ${wrapper} { ${base} }` : `${hints} ${base}`).trim();
  };
  const worksSel = (base: string) =>
    `works(first: ${WORKS_PER_SERIES}) { ${worksConn.open} ${itemSel(base)} ${worksConn.close} }`;

  // ── ③ どこまで取れるか（段階的な切り分け）────────────────────
  //
  // 【なぜ段階的に試すか】2026-08-11、`seriesList { name works { … } }` を1作品ぶん
  // 要求しただけで Annict が **HTTP 500** を返した。全部入りのクエリを1回投げて
  // 落ちるだけでは「seriesListが壊れている」のか「その中の works が壊れている」のか
  // 区別できず、次の手が決まらない。そこで**浅い形から順に試して、どこで落ちるか**を
  // 突き止める。得られる結論が変わる:
  //   ・シリーズ名すら取れない → seriesList は使えない。人力運用を続ける
  //   ・名前は取れるが works が取れない → シリーズ内の作品を列挙できない＝自動化不可
  //   ・作品IDまで取れる → 自動化を検討できる
  const SHAPES = [
    { label: "シリーズ名だけ", inner: `${nameField ?? "__typename"}`, depth: 1 },
    {
      label: "＋シリーズ内の作品ID",
      inner: `${nameField ?? "__typename"} ${worksSel("annictId")}`,
      depth: 2,
    },
    {
      label: "＋作品タイトルと放送クール",
      inner: `${nameField ?? "__typename"} ${worksSel("annictId title seasonYear seasonName")}`,
      depth: 3,
    },
  ];

  const buildQuery = (id: number, inner: string) => `
{
  searchWorks(annictIds: [${id}], first: 1) {
    nodes {
      annictId
      title
      ${seriesField.name}(first: ${SERIES_PER_WORK}) {
        ${seriesConn.open}
          ${inner}
        ${seriesConn.close}
      }
    }
  }
}`;

  console.log("\n── ③ どこまで取れるか ──");
  let chosen: (typeof SHAPES)[number] | null = null;
  for (const shape of SHAPES) {
    try {
      await gql(buildQuery(targetIds[0], shape.inner), `形の確認(${shape.label})`, 1);
      ok(`${shape.label}: 取れた`);
      chosen = shape;
    } catch (e) {
      ng(`${shape.label}: ${e instanceof Error ? e.message : String(e)}`);
      // 浅い順に並べてあるので、落ちた時点でそれより深い形は試すだけ無駄。
      break;
    }
    await sleep(GAP_MS);
  }

  if (!chosen) {
    console.log("\n────────────────────────────────");
    console.log("結論: seriesList は**シリーズ名すら取れない**（Annict側が落ちる）。");
    console.log("→ 自動化はできない。content/works/series.ts の人力運用を続ける。");
    console.log("この出力をそのまま貼って共有してください。");
    process.exit(0);
  }
  if (chosen.depth === 1) {
    console.log("\n────────────────────────────────");
    console.log("結論: シリーズ名は取れるが、**シリーズ内の作品を列挙できない**（works で落ちる）。");
    console.log("→ 「他の作品」を作れないので自動化はできない。人力運用を続ける。");
    console.log("この出力をそのまま貼って共有してください。");
    process.exit(0);
  }
  const hasTitles = chosen.depth >= 3;

  // ── ④ 実際の応答 ──────────────────────────────────────────
  //
  // 【1作品ずつ問い合わせる理由】まとめて要求すると重くなり、Annictが500を返しやすい。
  // 1件の失敗で残り全部を巻き添えにしないよう、try/catchも1件ずつ独立させる
  // （CLAUDE.mdの「外部APIに投げる処理」の基本ルール）。
  console.log("\n── ④ 実際の応答 ──");
  console.log(`組み立てた問い合わせ（${targetIds.length}作品ぶん、1件ずつ投げる）:`);
  console.log(
    buildQuery(targetIds[0], chosen.inner).split("\n").map((l) => `  ${l}`).join("\n")
  );

  const nodes: any[] = [];
  const failed: string[] = [];
  for (const id of targetIds) {
    try {
      const data = await gql(buildQuery(id, chosen.inner), `seriesList の取得(${id})`);
      const got: any[] = data.searchWorks?.nodes ?? [];
      if (got.length === 0) failed.push(`${id}: 作品が返らなかった`);
      else nodes.push(...got);
    } catch (e) {
      failed.push(`${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
    await sleep(GAP_MS);
  }
  if (failed.length > 0) {
    console.log("");
    for (const f of failed) ng(f);
  }
  if (nodes.length === 0) {
    ng("作品が1件も返らなかった");
    process.exit(1);
  }

  // 応答から「作品ID → 同じシリーズの作品IDの集合」を作る。
  const fromAnnict = new Map<number, { series: string; ids: number[] }[]>();
  for (const w of nodes) {
    const conn = w[seriesField.name];
    const seriesNodes: any[] = conn?.nodes ?? (conn?.edges ?? []).map((e: any) => e.node);
    const list: { series: string; ids: number[] }[] = [];
    for (const s of seriesNodes ?? []) {
      const wc = s.works;
      const items: any[] = wc?.nodes ?? (wc?.edges ?? []).map((e: any) => e.node);
      const ids = (items ?? [])
        .map((it) => (wrapper ? it[wrapper]?.annictId : it.annictId))
        .filter((n: any) => Number.isInteger(n));
      list.push({ series: nameField ? s[nameField] : "(名前なし)", ids });
    }
    fromAnnict.set(w.annictId, list);
    const label = list.length === 0 ? "（シリーズ情報なし）" : "";
    console.log(`\n${w.annictId} ${w.title} ${label}`);
    for (const s of list) {
      console.log(`  シリーズ「${s.series}」: ${s.ids.length}作品`);
      const titles: string[] = [];
      const conn2 = seriesNodes.find((x: any) => (nameField ? x[nameField] : "") === s.series);
      const items2: any[] =
        conn2?.works?.nodes ?? (conn2?.works?.edges ?? []).map((e: any) => e.node) ?? [];
      for (const it of items2) {
        const w2 = wrapper ? it[wrapper] : it;
        if (!w2) continue;
        titles.push(
          hasTitles
            ? `    ${w2.annictId} ${w2.title}（${w2.seasonYear ?? "?"}-${w2.seasonName ?? "?"}）`
            : `    ${w2.annictId}`
        );
      }
      console.log(titles.join("\n"));
    }
  }

  // ── ⑤ 手作業の対応表との突き合わせ ──────────────────────────
  // ここが判断材料。Annictが人力で確認した対応を再現できるなら自動化を検討でき、
  // 取りこぼす・余計なものを含めるなら人力を続ける根拠になる。
  if (argIds.length === 0) {
    console.log("\n── ⑤ 手作業の対応表との突き合わせ ──");
    for (const s of SERIES) {
      const handIds = s.works.map((w) => w.id).sort((a, b) => a - b);
      // シリーズ内のどれか1作品から引けた集合のうち、最も手作業に近いものを見る。
      let best: number[] = [];
      for (const id of handIds) {
        for (const got of fromAnnict.get(id) ?? []) {
          const inter = got.ids.filter((x) => handIds.includes(x)).length;
          const bestInter = best.filter((x) => handIds.includes(x)).length;
          if (inter > bestInter) best = got.ids;
        }
      }
      const gotSorted = [...new Set(best)].sort((a, b) => a - b);
      const same =
        gotSorted.length === handIds.length && gotSorted.every((v, i) => v === handIds[i]);
      const missing = handIds.filter((x) => !gotSorted.includes(x));
      const extra = gotSorted.filter((x) => !handIds.includes(x));
      if (same) {
        ok(`${s.title}: 一致（${handIds.join(", ")}）`);
      } else {
        ng(
          `${s.title}: 手作業=${handIds.join(", ")} / Annict=${gotSorted.join(", ") || "なし"}` +
            (missing.length ? ` / 取りこぼし: ${missing.join(", ")}` : "") +
            (extra.length ? ` / 余分: ${extra.join(", ")}` : "")
        );
      }
    }
  }

  console.log("\n────────────────────────────────");
  console.log("この出力をそのまま貼って共有してください。");
  console.log("⑤が全部✓なら自動化を検討します。✗が混じるなら人力の対応表を続けます。");
}

main().catch((e) => {
  console.error(`\n失敗: ${e instanceof Error ? e.message : String(e)}`);
  console.error("この文面もそのまま貼って共有してください（本番のクエリには影響しません）。");
  process.exit(1);
});

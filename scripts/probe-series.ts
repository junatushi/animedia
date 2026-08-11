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

async function gql(query: string, label: string): Promise<any> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    throw new Error(`${label}: HTTP ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  if (json.errors) {
    // GraphQLは200でエラーを返す。ここを見落とすと「成功した」と誤読する。
    throw new Error(`${label}: ${json.errors.map((e: any) => e.message).join(" / ")}`);
  }
  return json.data;
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

  const workSel = "annictId title seasonYear seasonName";
  const itemSel = wrapper
    ? `${orderHints.join(" ")} ${wrapper} { ${workSel} }`
    : `${orderHints.join(" ")} ${workSel}`;

  // ── ③ 実際の応答 ──────────────────────────────────────────
  console.log("\n── ③ 実際の応答 ──");
  const query = `
{
  searchWorks(annictIds: [${targetIds.join(", ")}], first: ${targetIds.length}) {
    nodes {
      annictId
      title
      ${seriesField.name}(first: 10) {
        ${seriesConn.open}
          ${nameField ?? ""}
          works(first: 50) {
            ${worksConn.open}
              ${itemSel}
            ${worksConn.close}
          }
        ${seriesConn.close}
      }
    }
  }
}`;
  console.log("組み立てた問い合わせ:");
  console.log(query.split("\n").map((l) => `  ${l}`).join("\n"));

  const data = await gql(query, "seriesList の取得");
  const nodes: any[] = data.searchWorks?.nodes ?? [];
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
        titles.push(`    ${w2.annictId} ${w2.title}（${w2.seasonYear ?? "?"}-${w2.seasonName ?? "?"}）`);
      }
      console.log(titles.join("\n"));
    }
  }

  // ── ④ 手作業の対応表との突き合わせ ──────────────────────────
  // ここが判断材料。Annictが人力で確認した対応を再現できるなら自動化を検討でき、
  // 取りこぼす・余計なものを含めるなら人力を続ける根拠になる。
  if (argIds.length === 0) {
    console.log("\n── ④ 手作業の対応表との突き合わせ ──");
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
  console.log("④が全部✓なら自動化を検討します。✗が混じるなら人力の対応表を続けます。");
}

main().catch((e) => {
  console.error(`\n失敗: ${e instanceof Error ? e.message : String(e)}`);
  console.error("この文面もそのまま貼って共有してください（本番のクエリには影響しません）。");
  process.exit(1);
});

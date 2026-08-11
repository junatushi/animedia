// scripts/probe-series.ts の回帰テスト（2026-08-11導入）。
//
// probe-series.ts は「Annictの seriesList が使えるか」をPCで確かめるための探り。
// 実際に走らせるのは利用者のPCで、こちらの環境では試せない。壊れたまま渡すと
// 往復1回ぶんの時間を無駄にするので、**Annictの代わりになるスタブサーバーを立てて
// 実際に probe-series.ts を動かす**。ネットワークには出ない。
//
// 固定したいこと:
//   ① seriesList が無いスキーマなら、落ちずに「自動化できない」と言って正常終了する
//   ② nodes 形式のコネクションを辿り、対応表と一致すれば ✓ を出す
//   ③ edges { node } 形式でも同じ結論に辿り着く（形が違っても壊れない）
//   ④ 中身が違えば ✗ を出し、取りこぼし・余分を名指しする（黙って通さない）
//   ⑤ GraphQLが200でerrorsを返したら失敗として扱う（成功と誤読しない）
//
// probe-series.ts を触ったら必ず実行すること。
const { createServer } = require("node:http");
const { spawn } = require("node:child_process");
const { join } = require("node:path");

const ROOT = join(__dirname, "..");

// ── スタブが返すスキーマ ────────────────────────────────
// 実際のAnnictそのものではなく、probe-series.ts が辿る分岐を通せる最小の形。
const T = {
  scalar: (name) => ({ kind: "SCALAR", name, ofType: null }),
  object: (name) => ({ kind: "OBJECT", name, ofType: null }),
};

function schemaWith({ hasSeriesList, connectionStyle }) {
  const types = {
    Work: {
      name: "Work",
      kind: "OBJECT",
      fields: [
        { name: "annictId", type: T.scalar("Int") },
        { name: "title", type: T.scalar("String") },
        ...(hasSeriesList
          ? [{ name: "seriesList", type: T.object("SeriesConnection") }]
          : [{ name: "seasonName", type: T.scalar("SeasonName") }]),
      ],
    },
    SeriesConnection: {
      name: "SeriesConnection",
      kind: "OBJECT",
      fields:
        connectionStyle === "nodes"
          ? [{ name: "nodes", type: T.object("Series") }]
          : [{ name: "edges", type: T.object("SeriesEdge") }],
    },
    SeriesEdge: {
      name: "SeriesEdge",
      kind: "OBJECT",
      fields: [{ name: "node", type: T.object("Series") }],
    },
    Series: {
      name: "Series",
      kind: "OBJECT",
      fields: [
        { name: "annictId", type: T.scalar("Int") },
        { name: "name", type: T.scalar("String") },
        { name: "works", type: T.object("SeriesWorkConnection") },
      ],
    },
    SeriesWorkConnection: {
      name: "SeriesWorkConnection",
      kind: "OBJECT",
      fields:
        connectionStyle === "nodes"
          ? [{ name: "nodes", type: T.object("SeriesWork") }]
          : [{ name: "edges", type: T.object("SeriesWorkEdge") }],
    },
    SeriesWorkEdge: {
      name: "SeriesWorkEdge",
      kind: "OBJECT",
      fields: [{ name: "node", type: T.object("SeriesWork") }],
    },
    // 1件ぶんは Work そのものではなく item で包んだ形（実際のAnnictもこの形に近い）。
    // summary は並び順の手がかりとして拾われるスカラー。
    SeriesWork: {
      name: "SeriesWork",
      kind: "OBJECT",
      fields: [
        { name: "summary", type: T.scalar("String") },
        // オブジェクト型の order を混ぜて、スカラーだけを選ぶ実装かどうかを見る。
        // （オブジェクトを選択に入れると GraphQL は selection set を要求して失敗する）
        { name: "orderInfo", type: T.object("OrderInfo") },
        { name: "item", type: T.object("Work") },
      ],
    },
    OrderInfo: { name: "OrderInfo", kind: "OBJECT", fields: [{ name: "n", type: T.scalar("Int") }] },
  };
  return types;
}

/** 探りが最後に投げる問い合わせへの応答を、指定のシリーズ構成から組み立てる。 */
function makeSearchWorksData({ connectionStyle, seriesByWork, titles }) {
  const wrapItems = (arr) =>
    connectionStyle === "nodes" ? { nodes: arr } : { edges: arr.map((node) => ({ node })) };
  const nodes = Object.entries(seriesByWork).map(([id, entries]) => ({
    annictId: Number(id),
    title: titles[id] ?? `作品${id}`,
    seriesList: wrapItems(
      entries.map((e) => ({
        name: e.name,
        works: wrapItems(
          e.ids.map((wid) => ({
            summary: "",
            item: {
              annictId: wid,
              title: titles[wid] ?? `作品${wid}`,
              seasonYear: 2026,
              seasonName: "SUMMER",
            },
          }))
        ),
      }))
    ),
  }));
  return { searchWorks: { nodes } };
}

function startStub(handler) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        let query = "";
        try {
          query = JSON.parse(body).query ?? "";
        } catch {
          /* 空のまま扱う */
        }
        const out = handler(query);
        res.writeHead(out.status ?? 200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(out.body));
      });
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

function run(port, args = []) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(ROOT, "scripts", "probe-series.ts"), ...args], {
      cwd: ROOT,
      env: {
        ...process.env,
        ANNICT_TOKEN: "dummy-token-for-stub",
        ANNICT_GRAPHQL_ENDPOINT: `http://127.0.0.1:${port}/graphql`,
      },
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => {
      // PROBE_DEBUG=1 で探りの出力をそのまま流す（テストが落ちたときの原因追跡用）。
      if (process.env.PROBE_DEBUG) console.log(`\n===== probe出力 (exit=${code}) =====\n${out}`);
      resolve({ code, out });
    });
  });
}

/** イントロスペクション要求から型名を抜く。 */
function introspectedTypeName(query) {
  const m = query.match(/__type\(name:\s*"([A-Za-z]+)"\)/);
  return m ? m[1] : null;
}

function makeHandler({ hasSeriesList, connectionStyle, data, graphqlErrors }) {
  const types = schemaWith({ hasSeriesList, connectionStyle });
  return (query) => {
    if (graphqlErrors && !introspectedTypeName(query)) {
      // GraphQLは失敗しても200を返す。errorsを見落とさないことの確認。
      return { status: 200, body: { errors: [{ message: "Field 'seriesList' doesn't exist" }] } };
    }
    const typeName = introspectedTypeName(query);
    if (typeName) {
      return { status: 200, body: { data: { __type: types[typeName] ?? null } } };
    }
    return { status: 200, body: { data } };
  };
}

const cases = [];
function check(label, ok, detail) {
  cases.push({ label, ok, detail });
}

/**
 * 出力から「組み立てた問い合わせ」の本文だけを切り出す。
 * 出力全体に対して includes で判定すると、フィールド一覧の表示や末尾の案内文
 * （「✗が混じるなら…」）まで拾って誤判定するため、必ず節を絞ってから見る。
 */
function assembledQuery(out) {
  const m = out.match(/組み立てた問い合わせ:\n([\s\S]*?)\n\n── ③/);
  if (m) return m[1];
  const m2 = out.match(/組み立てた問い合わせ:\n([\s\S]*?)\n\n/);
  return m2 ? m2[1] : "";
}

/** ④の突き合わせ節だけを切り出す（末尾の案内文を含めない）。 */
function comparisonSection(out) {
  const m = out.match(/── ④ 手作業の対応表との突き合わせ ──\n([\s\S]*?)\n─{8}/);
  return m ? m[1] : "";
}

async function main() {
  const titles = {
    10591: "逃げ上手の若君",
    14132: "逃げ上手の若君 第二期",
    13593: "クレバテス-魔獣の王と赤子と屍の勇者-",
    16555: "クレバテスⅡ-魔獣の王と偽りの勇者伝承-",
  };

  // ① seriesList が無いスキーマ
  {
    const { server, port } = await startStub(
      makeHandler({ hasSeriesList: false, connectionStyle: "nodes", data: {} })
    );
    const { code, out } = await run(port);
    server.close();
    check(
      "seriesListが無ければ落ちずに終わる",
      code === 0 && out.includes("Work型に seriesList が無い") && out.includes("人力運用を続ける"),
      `exit=${code}`
    );
  }

  // ②③ nodes形式・edges形式のどちらでも、対応表と一致すれば ✓
  for (const style of ["nodes", "edges"]) {
    // series.ts の全エントリを「Annictも同じ答えを返す」状態にする。
    const { SERIES } = await import("../content/works/series.ts");
    const seriesByWork = {};
    for (const s of SERIES) {
      const ids = s.works.map((w) => w.id);
      for (const w of s.works) seriesByWork[w.id] = [{ name: s.title, ids }];
    }
    const data = makeSearchWorksData({ connectionStyle: style, seriesByWork, titles });
    const { server, port } = await startStub(
      makeHandler({ hasSeriesList: true, connectionStyle: style, data })
    );
    const { code, out } = await run(port);
    server.close();
    const section = comparisonSection(out);
    const allMatched = SERIES.every((s) => section.includes(`✓  ${s.title}: 一致`));
    check(
      `${style}形式で全一致を検出する`,
      code === 0 && allMatched && !section.includes("✗"),
      code === 0
        ? allMatched && !section.includes("✗")
          ? `${SERIES.length}シリーズすべて✓`
          : "一致と判定されなかった"
        : `exit=${code}`
    );
    // 組み立てた問い合わせに、オブジェクト型のフィールドを選択に混ぜていないこと。
    // （選択に入れるとGraphQLが selection set を要求して探り自体が失敗する）
    const q = assembledQuery(out);
    check(
      `${style}形式でオブジェクト型を選択に混ぜない`,
      q.length > 0 && !q.includes("orderInfo") && q.includes("summary"),
      "問い合わせに summary（SCALAR）は入り orderInfo（OBJECT）は入らない"
    );
  }

  // ④ 中身が違えば ✗ を出し、取りこぼし・余分を名指しする
  {
    const seriesByWork = {
      10591: [{ name: "逃げ上手の若君", ids: [10591] }], // 14132 を取りこぼす
      14132: [{ name: "逃げ上手の若君", ids: [10591, 14132, 99999] }], // 余分を含む
    };
    const data = makeSearchWorksData({ connectionStyle: "nodes", seriesByWork, titles });
    const { server, port } = await startStub(
      makeHandler({ hasSeriesList: true, connectionStyle: "nodes", data })
    );
    const { code, out } = await run(port, ["10591", "14132"]);
    server.close();
    // 作品IDを引数で渡したときは④の突き合わせを出さない（対象が部分集合になるため）。
    check(
      "作品IDを指定したときは突き合わせを出さない",
      code === 0 && !out.includes("手作業の対応表との突き合わせ"),
      `exit=${code}`
    );
    check(
      "シリーズの中身を実際に表示する",
      out.includes("シリーズ「逃げ上手の若君」") && out.includes("99999"),
      "③にAnnictの答えがそのまま出る"
    );
  }

  // ④' 引数なしのとき、食い違いを ✗ で名指しする
  {
    const { SERIES } = await import("../content/works/series.ts");
    const first = SERIES[0];
    const seriesByWork = {};
    for (const s of SERIES) {
      const ids = s.works.map((w) => w.id);
      for (const w of s.works) {
        // 先頭シリーズだけ、わざと1件足りない答えを返させる。
        seriesByWork[w.id] = [{ name: s.title, ids: s === first ? ids.slice(0, 1) : ids }];
      }
    }
    const data = makeSearchWorksData({ connectionStyle: "nodes", seriesByWork, titles });
    const { server, port } = await startStub(
      makeHandler({ hasSeriesList: true, connectionStyle: "nodes", data })
    );
    const { code, out } = await run(port);
    server.close();
    const missing = first.works.slice(1).map((w) => w.id).join(", ");
    check(
      "食い違いを✗で名指しする",
      code === 0 && out.includes(`✗  ${first.title}:`) && out.includes(`取りこぼし: ${missing}`),
      `${first.title} の取りこぼし ${missing} を検出`
    );
  }

  // ⑤ 200 + errors を失敗として扱う
  {
    const { server, port } = await startStub(
      makeHandler({ hasSeriesList: true, connectionStyle: "nodes", data: {}, graphqlErrors: true })
    );
    const { code, out } = await run(port);
    server.close();
    check(
      "200で返るGraphQLエラーを失敗にする",
      code === 1 && out.includes("失敗:") && out.includes("doesn't exist"),
      `exit=${code}`
    );
  }

  console.log("\n── probe-series.ts のテスト ──");
  let ng = 0;
  for (const c of cases) {
    if (!c.ok) ng++;
    console.log(`${c.ok ? "✓" : "✗"}  ${c.label.padEnd(44)} → ${c.ok ? c.detail : `NG: ${c.detail}`}`);
  }
  console.log(`結果: ${cases.length - ng} 件OK / ${ng} 件NG`);
  process.exit(ng > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

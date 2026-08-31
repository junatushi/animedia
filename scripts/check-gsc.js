// scripts/fetch-gsc.js（GSC検索パフォーマンスの日次取得）の回帰テスト。
//
// scripts/check-threads.js と同じ流儀: node:http でスタブサーバーを立て、
// fetch-gsc.js を **子プロセスで実際に実行**して外形挙動を固定する。
// ネットワークには一切出ない（127.0.0.1 のスタブのみ）。依存パッケージも追加しない。
//
// ここで固定していること（CLAUDE.md「外部APIに投げる処理は一時的な失敗を前提に書く」）:
//   1. 正常系: 各種類のデータが揃い、期間合計が**表示回数で重み付け**されて計算される
//   2. 429 は指数バックオフで再試行して成功する（＝一時的なエラーで丸ごと落ちない）
//   3. 5xx も同様に再試行する
//   4. 401 は**再試行せず即座に失敗**する（何度投げても直らないため）
//   5. 1つが恒久エラーでも**残りは取得され、ファイルにも書かれる**
//      （1件目の失敗で残りを巻き添えにしない）。ただし終了コードは1（運用動線に出すため）
//   6. 鍵の形式が壊れていたら、トークンURLを叩く前に失敗する
//   7. **書き出したJSONに秘密鍵・アクセストークンが混入しない**
//      （このファイルはリポジトリにコミットされるので、混入は事故に直結する）
//   8. 面別（週次・長期）が「週 × ページ種別」に畳まれ、順位が**表示回数で重み付け**される
//      （2026-08-11追加。生の date×page 行をそのまま書くとファイルが肥大化するので、
//        畳んでから書く設計になっている。畳み方が壊れると分析が静かに嘘になる）
//   9. 表示もクリックも0の組は書き出さない（ファイルを無意味に膨らませない）
//  10. 長期の窓が直近28日の窓より**実際に長い**（長期側を取りにいっている）
//  11. rowLimit ちょうどで返ってきたらページ送りして続きを取る
//      （取り切れていないのに「全部取れた」と誤読すると、分析が静かに歪む）
//
// このテストを消したり緩めたりすると、「毎日静かに失敗しているのに緑に見える」状態に戻る。

const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const FETCH_GSC = path.join(__dirname, "fetch-gsc.js");

const { privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const SERVICE_ACCOUNT = {
  type: "service_account",
  client_email: "gsc-reader@example.iam.gserviceaccount.com",
  private_key: privateKey,
};

const ACCESS_TOKEN = "ya29.STUB-ACCESS-TOKEN";

let failures = 0;
function ok(label, cond, detail) {
  if (cond) {
    console.log(`✓  ${label}`);
  } else {
    failures++;
    console.log(`✗  ${label}${detail ? ` … ${detail}` : ""}`);
  }
}

function jsonRes(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

/**
 * スタブサーバー。behavior で失敗の出し方を切り替える。
 * counts に「どのエンドポイントを何回叩いたか」を記録し、再試行の有無を検証する。
 */
function startStub(behavior) {
  // 軸の並びをそのままキーにする。dimensions[0] で数えると
  // ["date"] と ["date","page"] が同じ "date" に潰れて、再試行回数の検証が壊れる。
  const counts = { token: 0, date: 0, query: 0, page: 0, "date+page": 0 };
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (req.url.startsWith("/token")) {
        counts.token++;
        const plan = behavior.token || [];
        const status = plan[counts.token - 1];
        if (status) return jsonRes(res, status, { error: "stub_error" });
        return jsonRes(res, 200, { access_token: ACCESS_TOKEN, expires_in: 3600 });
      }
      if (req.url.includes("/searchAnalytics/query")) {
        const body = JSON.parse(raw || "{}");
        const dim = body.dimensions.join("+");
        counts[dim]++;
        const plan = behavior[dim] || [];
        const status = plan[counts[dim] - 1];
        if (status) return jsonRes(res, status, { error: "stub_error" });
        return jsonRes(res, 200, { rows: rowsFor(dim, body) });
      }
      jsonRes(res, 404, { error: "not_found" });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, counts, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

// 日別2行。表示回数の重みが効いているかを見たいので、順位を大きく変えてある。
//   合算: クリック 3+7=10 / 表示 100+900=1000 / CTR 1.0% /
//   平均掲載順位 (20*100 + 10*900) / 1000 = 11.0（単純平均なら15.0になる＝重み付けの検証）
// date×page の行。「週 × 面」への畳み方を検証するために、次を全部含めてある:
//   ・同じ週の同じ面が2行（合算されるか／順位が表示回数で重み付けされるか）
//   ・週をまたぐ行（2026-08-03は月曜、2026-08-10は次の週の月曜）
//   ・面が違う行（/anime/ → 作品、/person/ → 声優。声優URLはGSC同様に
//     パーセントエンコードされた状態で渡し、復号して分類できるかを見る）
//   ・表示もクリックも0の行（書き出されずに落ちるか）
//
// 期待する集約結果:
//   2026-08-03 作品: クリック1 / 表示400 / 順位 (20*100 + 10*300)/400 = 12.5
//                    （単純平均なら15.0＝重み付けの検証）
//   2026-08-03 声優: クリック5 / 表示50  / 順位 6
//   2026-08-10 作品: クリック0 / 表示10  / 順位 30
const DATE_PAGE_ROWS = [
  { keys: ["2026-08-03", "https://example.test/anime/11771"], clicks: 1, impressions: 100, ctr: 0.01, position: 20 },
  { keys: ["2026-08-04", "https://example.test/anime/14132"], clicks: 0, impressions: 300, ctr: 0, position: 10 },
  {
    keys: ["2026-08-05", "https://example.test/person/%E6%82%A0%E6%9C%A8%E7%A2%A7/2026/summer"],
    clicks: 5,
    impressions: 50,
    ctr: 0.1,
    position: 6,
  },
  { keys: ["2026-08-06", "https://example.test/"], clicks: 0, impressions: 0, ctr: 0, position: 0 },
  { keys: ["2026-08-10", "https://example.test/anime/11771"], clicks: 0, impressions: 10, ctr: 0, position: 30 },
];

function rowsFor(dim, body = {}) {
  if (dim === "date") {
    return [
      { keys: ["2026-08-01"], clicks: 3, impressions: 100, ctr: 0.03, position: 20 },
      { keys: ["2026-08-02"], clicks: 7, impressions: 900, ctr: 0.0078, position: 10 },
    ];
  }
  if (dim === "query") {
    // 順位帯サマリ（queryBands）を働かせるため、1ページ目・2ページ目・圏外を混ぜる。
    return [
      { keys: ["ダンダダン 配信"], clicks: 6, impressions: 400, ctr: 0.015, position: 8.2 },
      { keys: ["2ページ目のクエリ"], clicks: 1, impressions: 50, ctr: 0.02, position: 15 },
      { keys: ["圏外のクエリ"], clicks: 0, impressions: 900, ctr: 0, position: 120 },
    ];
  }
  if (dim === "date+page") {
    // ページ送りを実際に働かせる。rowLimit を小さくして走らせると複数回に分かれる。
    const start = body.startRow || 0;
    return DATE_PAGE_ROWS.slice(start, start + (body.rowLimit || DATE_PAGE_ROWS.length));
  }
  return [
    { keys: ["https://example.test/anime/11771"], clicks: 4, impressions: 300, ctr: 0.013, position: 9.4 },
    { keys: ["https://example.test/anime/99999"], clicks: 0, impressions: 700, ctr: 0, position: 45 },
  ];
}

function runFetch({ baseUrl, serviceAccount = SERVICE_ACCOUNT, outDir, extraEnv = {} }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [FETCH_GSC], {
      env: {
        ...process.env,
        GSC_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccount),
        GSC_TOKEN_URL: `${baseUrl}/token`,
        GSC_API_BASE: baseUrl,
        GSC_SITE_URL: "https://example.test/",
        GSC_OUT_DIR: outDir,
        GSC_RETRY_BASE_MS: "1", // 待ち時間**だけ**を短くする。分岐は本番と同じ経路を通る
        ...extraEnv, // 差し替えるのは数値だけ。判断の分岐はテストと本番で同じ経路を通す
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => resolve({ code, out, err }));
  });
}

function readOutput(outDir) {
  const files = fs.existsSync(outDir) ? fs.readdirSync(outDir).filter((f) => f.endsWith(".json")) : [];
  if (files.length !== 1) return null;
  return {
    name: files[0],
    text: fs.readFileSync(path.join(outDir, files[0]), "utf8"),
    json: JSON.parse(fs.readFileSync(path.join(outDir, files[0]), "utf8")),
  };
}

async function withStub(behavior, fn, extraEnv = {}) {
  const stub = await startStub(behavior);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "gsc-check-"));
  try {
    const result = await runFetch({ baseUrl: stub.baseUrl, outDir, extraEnv });
    await fn({ ...result, counts: stub.counts, outDir, output: readOutput(outDir) });
  } finally {
    stub.server.close();
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

async function main() {
  console.log("── GSC取得スクリプトの検査 ──");

  // 1. 正常系
  await withStub({}, ({ code, output, counts }) => {
    ok("正常系: 終了コード0", code === 0, `code=${code}`);
    ok("正常系: JSONが1件書き出される", output !== null);
    if (output) {
      const j = output.json;
      ok("正常系: 日別・クエリ別・ページ別がすべて入る",
        j.daily.length === 2 && j.queries.length === 3 && j.pages.length === 2,
        `daily=${j.daily.length} queries=${j.queries.length} pages=${j.pages.length}`);
      ok("正常系: クリック・表示の合計が合う",
        j.totals.clicks === 10 && j.totals.impressions === 1000,
        JSON.stringify(j.totals));
      ok("正常系: 平均掲載順位が表示回数で重み付けされる（単純平均15.0ではなく11.0）",
        Math.abs(j.totals.position - 11) < 1e-9, `position=${j.totals.position}`);
      ok("正常系: ファイル名が期間の終端日", output.name === `${j.range.endDate}.json`, output.name);
      ok("正常系: errorsが空", j.errors.length === 0);

      // 順位帯サマリ（2026-08-31追加）。上位100行だけを保存する運用では、
      // 全表示の大半がどの順位にいるか分からず、按分で誤診したことがある（㉟）。
      // 保存する行数を増やさずに「クリック0の表示がどの帯に何件あるか」を残す。
      const qb = j.queryBands || [];
      const pb = j.pageBands || [];
      ok("順位帯: クエリ別のサマリが出る", qb.length === 3, `${qb.length}帯`);
      const band = (arr, name) => arr.find((b) => b.band === name);
      ok(
        "順位帯: 1ページ目・2ページ目・圏外に分かれる",
        !!band(qb, "1-10") && !!band(qb, "11-20") && !!band(qb, "101+"),
        qb.map((b) => b.band).join(",")
      );
      ok(
        "順位帯: 圏外の表示回数とクリック0が残る",
        band(qb, "101+")?.impressions === 900 && band(qb, "101+")?.clicks === 0,
        JSON.stringify(band(qb, "101+"))
      );
      ok(
        "順位帯: 帯の合計が全体の表示回数と一致する",
        qb.reduce((a, b) => a + b.impressions, 0) === 1350,
        `${qb.reduce((a, b) => a + b.impressions, 0)}`
      );
      ok("順位帯: ページ別のサマリも出る", pb.length === 2, pb.map((b) => b.band).join(","));
      // 生データは従来どおり上位100行まで（保存量を増やさない）。
      ok("順位帯: 生の行は保存し続ける", j.queries.length === 3 && j.pages.length === 2,
        `queries=${j.queries.length} pages=${j.pages.length}`);

      // 8〜10. 面別（週次・長期）
      const w = j.weeklyByType;
      ok("面別: 「週 × 面」に畳まれる（5行 → 3行。0の組は落ちる）",
        Array.isArray(w) && w.length === 3, `weeklyByType=${JSON.stringify(w)}`);
      if (Array.isArray(w) && w.length === 3) {
        ok("面別: 同じ週の同じ面が合算される",
          w[0].week === "2026-08-03" && w[0].type === "作品" &&
            w[0].clicks === 1 && w[0].impressions === 400,
          JSON.stringify(w[0]));
        ok("面別: 順位が表示回数で重み付けされる（単純平均15.0ではなく12.5）",
          Math.abs(w[0].position - 12.5) < 1e-9, `position=${w[0].position}`);
        ok("面別: パーセントエンコードされたURLも声優ページとして分類される",
          w[1].week === "2026-08-03" && w[1].type === "声優" && w[1].impressions === 50,
          JSON.stringify(w[1]));
        ok("面別: 週をまたぐ行は別の週になる",
          w[2].week === "2026-08-10" && w[2].type === "作品" && w[2].impressions === 10,
          JSON.stringify(w[2]));
        ok("面別: 表示もクリックも0の組は書き出さない",
          !w.some((r) => r.clicks === 0 && r.impressions === 0),
          JSON.stringify(w));
      }
      ok("面別: 長期の窓が直近28日の窓より前から始まる",
        j.longRange && j.longRange.startDate < j.range.startDate &&
          j.longRange.endDate === j.range.endDate,
        `range=${JSON.stringify(j.range)} longRange=${JSON.stringify(j.longRange)}`);
      // 7. 秘密情報の混入検査
      ok("書き出したJSONに秘密鍵が混入しない", !output.text.includes("PRIVATE KEY"));
      ok("書き出したJSONにアクセストークンが混入しない", !output.text.includes(ACCESS_TOKEN));
      ok("書き出したJSONにサービスアカウントのアドレスが混入しない",
        !output.text.includes(SERVICE_ACCOUNT.client_email));
    }
    ok("正常系: トークン取得は1回だけ", counts.token === 1, `token=${counts.token}`);
  });

  // 2. 429 は再試行して成功する
  await withStub({ date: [429] }, ({ code, output, counts }) => {
    ok("429: 再試行して最終的に成功する", code === 0 && output !== null, `code=${code}`);
    ok("429: 日別を2回叩いている（＝再試行した）", counts.date === 2, `date=${counts.date}`);
    if (output) ok("429: データは欠けない", output.json.daily.length === 2);
  });

  // 3. 5xx も再試行する
  await withStub({ query: [503, 500] }, ({ code, counts, output }) => {
    ok("5xx: 再試行して成功する", code === 0, `code=${code}`);
    ok("5xx: 3回目で成功している", counts.query === 3, `query=${counts.query}`);
    if (output) ok("5xx: クエリ別が取れている", output.json.queries.length === 3);
  });

  // 4. 401 は即失敗（再試行しない）
  await withStub({ token: [401] }, ({ code, err, counts, output }) => {
    ok("401: 失敗する", code === 1, `code=${code}`);
    ok("401: 再試行しない（トークン取得は1回だけ）", counts.token === 1, `token=${counts.token}`);
    ok("401: 恒久的なエラーとして報告される", err.includes("恒久的なエラー"), err.trim().slice(0, 120));
    ok("401: ファイルを書かない", output === null);
  });

  // 5. 1つが恒久エラーでも残りは取得し、ファイルにも書く
  await withStub({ query: [403] }, ({ code, output, counts }) => {
    ok("一部失敗: 終了コードは1（運用動線に出す）", code === 1, `code=${code}`);
    ok("一部失敗: 403は再試行しない", counts.query === 1, `query=${counts.query}`);
    ok("一部失敗: それでもファイルは書かれる", output !== null);
    if (output) {
      const j = output.json;
      ok("一部失敗: 残り2種類は取得できている",
        j.daily.length === 2 && j.pages.length === 2,
        `daily=${j.daily.length} pages=${j.pages.length}`);
      ok("一部失敗: 失敗した種類がerrorsに残る",
        j.errors.length === 1 && j.errors[0].key === "queries", JSON.stringify(j.errors));
      ok("一部失敗: 取れた分の合計は計算される", j.totals && j.totals.clicks === 10);
    }
  });

  // 11. rowLimit ちょうどで返ってきたらページ送りする（取りこぼしを黙って作らない）
  await withStub(
    {},
    ({ code, output, counts }) => {
      ok("ページ送り: 成功する", code === 0, `code=${code}`);
      ok("ページ送り: 3回に分けて取りにいく（2件+2件+1件）",
        counts["date+page"] === 3, `date+page=${counts["date+page"]}`);
      if (output) {
        ok("ページ送り: 全5行ぶんが畳まれている（3行）",
          output.json.weeklyByType.length === 3,
          JSON.stringify(output.json.weeklyByType));
        ok("ページ送り: 最後の週の行まで取れている",
          output.json.weeklyByType.some((r) => r.week === "2026-08-10"),
          JSON.stringify(output.json.weeklyByType));
      }
    },
    { GSC_PAGE_ROW_LIMIT: "2" }
  );

  // 12. 面別だけが恒久エラーでも、残りは取得されファイルにも書かれる
  await withStub({ "date+page": [403] }, ({ code, output, counts }) => {
    ok("面別の失敗: 終了コードは1（運用動線に出す）", code === 1, `code=${code}`);
    ok("面別の失敗: 403は再試行しない", counts["date+page"] === 1, `date+page=${counts["date+page"]}`);
    ok("面別の失敗: それでもファイルは書かれる", output !== null);
    if (output) {
      const j = output.json;
      ok("面別の失敗: 日別・クエリ別・ページ別は巻き添えにならない",
        j.daily.length === 2 && j.queries.length === 3 && j.pages.length === 2,
        `daily=${j.daily.length} queries=${j.queries.length} pages=${j.pages.length}`);
      ok("面別の失敗: errorsに残る",
        j.errors.length === 1 && j.errors[0].key === "weeklyByType", JSON.stringify(j.errors));
      ok("面別の失敗: weeklyByTypeは空配列のまま", Array.isArray(j.weeklyByType) && j.weeklyByType.length === 0);
    }
  });

  // 6. 鍵が壊れていたらトークンURLを叩く前に失敗する
  const stub = await startStub({});
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "gsc-check-"));
  try {
    const { code, err } = await runFetch({
      baseUrl: stub.baseUrl,
      outDir,
      serviceAccount: { ...SERVICE_ACCOUNT, private_key: "-----BEGIN PRIVATE KEY-----\nbroken\n-----END PRIVATE KEY-----\n" },
    });
    ok("鍵が壊れている: 失敗する", code === 1, `code=${code}`);
    ok("鍵が壊れている: トークンURLを叩かない", stub.counts.token === 0, `token=${stub.counts.token}`);
    ok("鍵が壊れている: 恒久的なエラーとして報告される", err.includes("恒久的なエラー"), err.trim().slice(0, 120));
  } finally {
    stub.server.close();
    fs.rmSync(outDir, { recursive: true, force: true });
  }

  console.log(failures === 0 ? "\n全件OK" : `\nNG ${failures}件`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

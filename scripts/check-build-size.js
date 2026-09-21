// デプロイ成果物の大きさに予算を設けて見張る
// （2026-09-14導入 / 2026-09-21に式を作り直し・重大度高）。
//
// 【なぜ要るか】Vercel Hobby の Deployment Storage は 10GB で、**保持している
// デプロイ数ぶん掛かる**。成果物はページ数とページの大きさの積で決まり、
// **クールが増えるたびに自動で増える**（CLAUDE.md の条件④）。放っておくと必ず
// また超えるので、増えたことに気づく仕掛けが要る。「気づく」だけでは足りない
// （気づいても誰も見ない）ので、予算を超えたら落とす。
//
// 【2026-09-21・この検査自身が桁で間違っていた】導入時の式は
//   10GB × 0.65 ÷ 10件（保持期間に関わらず残る本番デプロイ数）= 650MB
// で、同日の実測 303MB を「予算の47%」＝余裕あり、と報告していた。
// ところが同じ日のダッシュボードの実測は **41.93GB ＝ 上限の419%** だった。
// 数えているものが違えば、緑でも何の保証にもならない。外れた理由は2つある:
//
//   ①**「床」しか数えていなかった。** 保持期間（Hobby既定30日）の中に入った
//     デプロイは全部残るので、実際に掛かるのは
//        1デプロイの大きさ × (保持日数 × 1日あたりのデプロイ数)
//     であって、「必ず残る件数」はその**下限**にすぎない。当時の本番は
//     1日0.57件＝30日で18件で、床(10件)の1.8倍あった。
//   ②**プレビューデプロイを1件も数えていなかった。** 作業ブランチが32本
//     生きており、**生きているブランチのデプロイは保持期間で消えない**。
//     実測41.93GBのうち本番で説明できるのは9.3GBだけで、残り約32GBがこれ。
//     プレビューは vercel.json が本番以外のビルドを丸ごと飛ばすようにして止めた
//     （`$VERCEL_ENV` が preview なら exit 0）。この分は式から落としてよくなった。
//
// 【いまの式】
//   保持件数 = max(必ず残る件数, 保持日数 × 1日あたりの本番デプロイ数)
//   予算     = 10GB × 0.65 ÷ 保持件数
// 1日あたりの本番デプロイ数は**手で書かない**（㊳）。git の履歴に vercel.json の
// ignoreCommand と**同じ除外**を当てて数える（門番と数え方がズレないように、
// 除外パスはこのファイルに写さず vercel.json から読む）。履歴が浅くて数えられない
// ときは**黙って通さず**、保守側の既定値を使ったと明示する。
// **この値を上げるときは、上の式のどれを変えるのかを書くこと**（数字だけ書き換えない）。
//
// 【超えたときの手当て】順番がある:
//   ①ダッシュボードの保持期間を縮める（Project Settings → Security →
//     Deployment Retention Policy）。分母にそのまま効くので一番強い。
//     縮めたら下の RETENTION_DAYS も同じ値に直すこと。
//   ②1ページを小さくする（ISR Writes も転送量も同じ比率で効く）。内訳を出すのはそのため。
//   ③事前生成の対象を減らすのは最後の手段（焼かないページはデプロイのたびに
//     ISR Writes を払い直すので、成果物が減っても総費用が増えることがある）。
// 経緯は docs/operations.md の㊻・[52]・[54]。

const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");

const QUOTA_BYTES = 10 * 1000 * 1000 * 1000; // Hobby の Deployment Storage
const FLOOR_SHARE = 0.65; // 予算に使ってよい割合（残りは数え落としの取り分）

// 保持期間に関わらず残るデプロイ数。2026-09-16に Vercel が Hobby の保持件数を
// 減らした（本番3件＋種別を問わない直近3件＝実質6件）。導入時は10件と書いていた。
// https://vercel.com/changelog/hobby-projects-now-retain-fewer-deployments-to-free-up-storage
const ALWAYS_RETAINED = 6;

// 【必ずダッシュボードと一致させること】Project Settings → Security →
// Deployment Retention Policy の設定値。
// **ここだけ直してダッシュボードを直さないと、この検査は緑のまま嘘をつく。**
// 2026-09-21に既定の30日から縮めた（Production Deployments = 1 week）。
// 同時に Canceled/Errored/Pre-Production Deployments を 1 day にした
// （Pre-Productionはプレビュー。vercel.json でプレビューのビルド自体を止めた
// ので新規の積み増しは無いが、ダッシュボードの保持も最短にして念のため二重に絞る）。
const RETENTION_DAYS = 7;

// git から数えられなかったときに使う保守側の既定値。
// 毎日コミットする収集が1本ある（fetch-upcoming.yml → content/works/autoSchedule.json）
// ので、下回ることはあっても上回りにくい値として 1 を採る。
const FALLBACK_DEPLOYS_PER_DAY = 1;
const RATE_WINDOW_DAYS = 30;

// vercel.json の ignoreCommand から除外パススペック（':!…'）を取り出す。
// **このファイルに写さない**（門番と数え方がズレると、数えたつもりのものが実際は違う）。
function excludeSpecs() {
  const vercelJson = fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8");
  return [...vercelJson.matchAll(/':!([^']+)'/g)].map((m) => `:!${m[1]}`);
}

// 1日あたり何件の本番デプロイが起きているかを git から導出する（手で書かない＝㊳）。
// 数えられなければ null を返す（推測の数字を黙って使わない）。
function deploysPerDay() {
  try {
    const since = new Date(Date.now() - RATE_WINDOW_DAYS * 86400 * 1000)
      .toISOString()
      .slice(0, 10);
    // 浅いクローンだと数え落とす（CIの actions/checkout は既定で深さ1）。
    // 窓の始まりより古いコミットが見えることを先に確かめる。
    const dates = execFileSync("git", ["log", "--format=%cs", "-n", "5000"], {
      cwd: ROOT,
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .filter(Boolean);
    const oldest = dates[dates.length - 1];
    if (!oldest || oldest > since) return null; // 履歴が窓を覆っていない
    const shas = execFileSync("git", ["rev-list", `--since=${since}`, "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .filter(Boolean);
    const excl = excludeSpecs();
    if (excl.length === 0) return null; // 除外が読めていない＝数え方が門番と違う
    let n = 0;
    for (const sha of shas) {
      // `git diff --quiet` は差分ありで 1。親が無い等で 128 のときは門番も
      // ビルドする側に倒すので、0 以外はまとめて「デプロイが起きる」と数える。
      const r = spawnSync("git", ["diff", "--quiet", `${sha}^`, sha, "--", ".", ...excl], {
        cwd: ROOT,
      });
      if (r.status !== 0) n++;
    }
    return n / RATE_WINDOW_DAYS;
  } catch {
    return null;
  }
}

// 予算は固定値ではなく、上の式から毎回導出する。
function budget() {
  const derived = deploysPerDay();
  const perDay = derived ?? FALLBACK_DEPLOYS_PER_DAY;
  const retained = Math.max(ALWAYS_RETAINED, Math.ceil(RETENTION_DAYS * perDay));
  return {
    bytes: Math.round((QUOTA_BYTES * FLOOR_SHARE) / retained),
    retained,
    perDay,
    derived: derived !== null,
  };
}

// デプロイに含まれるもの。ビルドキャッシュ（.next/cache）は別枠なので数えない。
const TARGETS = [".next/server", ".next/static", "public"];

function dirSize(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) stack.push(full);
      else {
        try {
          total += fs.statSync(full).size;
        } catch {
          /* 競合で消えたファイルは無視 */
        }
      }
    }
  }
  return total;
}

const mb = (n) => (n / 1e6).toFixed(1) + "MB";

/** 面ごとの「1ページあたりバイト数」を、このビルドの実測から出す（.html の枚数で割る）。 */
function bytesPerPage(appDir, face) {
  const dir = path.join(appDir, face);
  if (!fs.existsSync(dir)) return null;
  let pages = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) stack.push(path.join(d, e.name));
      else if (e.name.endsWith(".html")) pages++;
    }
  }
  if (pages === 0) return null;
  return { pages, perPage: dirSize(dir) / pages };
}

/**
 * 1年あたりに増える成果物のバイト数。**実データから導出**する（手で書かない）。
 * 材料が1つでも欠けたら null を返す（年数を推測で出さない）。
 */
function estimateGrowth(appDir) {
  let index, people;
  try {
    index = JSON.parse(fs.readFileSync(path.join(ROOT, "content/archive/index.json"), "utf8"));
    people = JSON.parse(fs.readFileSync(path.join(ROOT, "content/archive/people.json"), "utf8"));
  } catch {
    return null;
  }

  // 作品ページ: 配信1件以上（＝sitemapに載せ、焼く対象）を年で畳む。
  const worksByYear = new Map();
  for (const s of index.seasons || []) {
    worksByYear.set(s.year, (worksByYear.get(s.year) || 0) + (s.workIds?.length || 0));
  }
  // 声優ページ: app/person/[name]/[year]/[season] の generateStaticParams と同じ規則で
  // 組を作り、年で畳む。規則は①そのクールに2作品以上 ②過去年は総出演が閾値以上
  // （＝索引に載るページだけ焼く）。
  //
  // **閾値をここに書き写さない。** lib/personPage.ts から読み取る（1箇所が持つ）。
  // 読めなければ null を返して見通しを出さない（古い閾値で年数を出すほうが害になる）。
  const personSrc = (() => {
    try {
      return fs.readFileSync(path.join(ROOT, "lib/personPage.ts"), "utf8");
    } catch {
      return "";
    }
  })();
  const minAppear = Number(/PERSON_PAGE_MIN_APPEARANCES\s*=\s*(\d+)/.exec(personSrc)?.[1]);
  const minTotal = Number(/PERSON_PAGE_INDEX_MIN_TOTAL_WORKS\s*=\s*(\d+)/.exec(personSrc)?.[1]);
  if (!Number.isFinite(minAppear) || !Number.isFinite(minTotal)) return null;

  const personByYear = new Map();
  {
    const counts = new Map();
    const totalWorks = new Map();
    for (const [name, works] of Object.entries(people.people || {})) {
      totalWorks.set(name, works.length);
      for (const w of works) {
        const k = `${w[2]}/${w[3]}/${name}`;
        counts.set(k, (counts.get(k) || 0) + 1);
      }
    }
    for (const [key, c] of counts) {
      if (c < minAppear) continue;
      const parts = key.split("/");
      const year = Number(parts[0]);
      const name = parts.slice(2).join("/");
      // 今年のクールは索引に載るが**焼かない**（ライブ取得なのでビルドを外部APIに
      // 依存させない）。成長の見積もりに要るのは「翌年以降、過去年として焼かれる数」
      // なので、ここでは過去年の規則（総出演が閾値以上）で数える。
      if ((totalWorks.get(name) || 0) < minTotal) continue;
      personByYear.set(year, (personByYear.get(year) || 0) + 1);
    }
  }

  // 直近3年の平均。**最新年は途中（まだクールが揃っていない）ことがある**ので、
  // 揃っている年だけを使う（作品数の索引に4クール分ある年）。
  const completeYears = [...worksByYear.keys()]
    .filter((y) => (index.seasons || []).filter((s) => s.year === y).length === 4)
    .sort((a, b) => b - a)
    .slice(0, 3);
  if (completeYears.length === 0) return null;
  const avg = (m) => completeYears.reduce((n, y) => n + (m.get(y) || 0), 0) / completeYears.length;
  const worksPerYear = Math.round(avg(worksByYear));
  const personPerYear = Math.round(avg(personByYear));

  const anime = bytesPerPage(appDir, "anime");
  const person = bytesPerPage(appDir, "person");
  const season = bytesPerPage(appDir, "season");
  if (!person || !season) return null;
  // 作品ページを焼いていないビルド（スナップショットが旧形式）では実測が無い。
  // その場合は作品ページ分を 0 として出し、注記で分かるようにする。
  const animePer = anime ? anime.perPage : 0;

  return {
    worksPerYear,
    personPerYear,
    // 作品ページをまだ焼いていない断面（スナップショットが旧形式）では実測が無いので
    // 0 として数える。**そのぶん見通しは長く出る**ので、呼び出し側で必ず断る。
    animeMissing: !anime,
    bytesPerYear:
      worksPerYear * animePer + personPerYear * person.perPage + 4 * season.perPage,
  };
}

function main() {
  console.log("【デプロイ成果物の大きさ】");
  const B = budget();
  const BUDGET_BYTES = B.bytes;
  if (!fs.existsSync(path.join(ROOT, ".next", "BUILD_ID"))) {
    // `npm run check` からも呼ばれる。ビルドが無いときは**黙って成功せず**、
    // 省略したと言ってから抜ける（CIでは build の直後に走るので必ず本物になる）。
    console.log("  ─ .next が無いので省略（CIでは `npm run build` の後に実行される）");
    console.log("結果: 省略（ビルドしてから実行すると検査されます）");
    return;
  }

  let total = 0;
  for (const t of TARGETS) {
    const size = dirSize(path.join(ROOT, t));
    total += size;
    console.log(`  ${t.padEnd(16)} ${mb(size).padStart(9)}`);
  }

  // どのページ種別が効いているかを出す（減らす先を探すのは人なので、内訳が要る）。
  // **対象は走査して導出する**（ページ種別を足したら自動で出る。CLAUDE.md の㊳）。
  const appDir = path.join(ROOT, ".next", "server", "app");
  if (fs.existsSync(appDir)) {
    const rows = [];
    for (const e of fs.readdirSync(appDir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const size = dirSize(path.join(appDir, e.name));
      if (size > 1e6) rows.push([e.name, size]);
    }
    rows.sort((a, b) => b[1] - a[1]);
    if (rows.length > 0) {
      console.log("  ── 内訳（1MB以上の面）──");
      for (const [name, size] of rows.slice(0, 8)) {
        console.log(`  ${("/" + name).padEnd(16)} ${mb(size).padStart(9)}  (${Math.round((size / total) * 100)}%)`);
      }
    }
  }

  // ── クールが増えたら何年で予算に当たるか（2026-09-19導入）────────────────
  //
  // 【なぜ要るか】この検査は「超えた日」に落ちるが、超えてから慌てても打てる手は
  // 少ない（1ページを小さくする作業は数日かかる）。CLAUDE.md の条件④は
  // 「クールが増えるたび作品数は増えることを加味する」なので、**いつ当たるか**を
  // 毎回出しておく。
  //
  // 【数え方】増分は手で書かない（㊳）。実データから導出する:
  //   ・作品ページ … content/archive/index.json の workIds を年で畳み、直近3年の平均
  //   ・声優ページ … content/archive/people.json から generateStaticParams と
  //                  同じ規則で組を作り、直近3年の平均
  //   ・シーズンページ … 1年4クール（定義そのもの）
  // 1ページの大きさは**このビルドの実測**（面ごとの合計 ÷ .html の枚数）を使う。
  // どちらかが取れなければ「出さない」（推測で年数を書かない）。
  const growth = estimateGrowth(appDir);
  if (growth) {
    const left = BUDGET_BYTES - total;
    const years = growth.bytesPerYear > 0 ? left / growth.bytesPerYear : Infinity;
    console.log(
      `  ── 成長の見通し ──  1年あたり +${mb(growth.bytesPerYear)}` +
        `（作品 ${growth.worksPerYear}件 / 声優 ${growth.personPerYear}件 / シーズン 4件）`
    );
    console.log(
      left <= 0
        ? "  残り 0 — すでに予算を超えています"
        : `  残り ${mb(left)} — このままなら約 ${years.toFixed(1)} 年で予算に当たります` +
          (years < 2 ? "（2年未満。1ページを小さくする手を先に決めておくこと）" : "")
    );
    // **この断りを消さないこと。** 作品ページを焼いていない断面では、いちばん増える面が
    // 見通しから丸ごと抜けている＝年数が実際よりずっと長く出る。「10年ある」と読んで
    // 安心したまま再生成し、その日に予算を超えるのがいちばん困る壊れ方。
    if (growth.animeMissing) {
      console.log(
        "  ※ 作品ページをまだ焼いていないので、この見通しに作品ページ分は入っていません" +
          "（スナップショット再生成後は大きく短くなる。docs/snapshot-regenerate.md の手順5）"
      );
    }
  }

  // ── 予算の前提を毎回出す（2026-09-21追加）────────────────────────────
  //
  // **この3行を消さないこと。** 予算の分母は「ダッシュボードの保持期間」という
  // CIからは読めない値に乗っている。前提を黙って抱えたままだと、設定を戻した日に
  // 検査は緑のまま嘘をつき始める（実際にそれで419%まで気づけなかった）。
  // 毎回・日付つきで出しておけば、読んだ人が食い違いに気づける。
  console.log("  ── 予算の前提 ──");
  console.log(
    `  保持期間 ${RETENTION_DAYS}日（ダッシュボードの設定と一致させること。最終確認 2026-09-21）` +
      ` × 本番デプロイ ${B.perDay.toFixed(2)}件/日` +
      (B.derived ? "（git の履歴から導出）" : "（**履歴が浅く数えられず既定値を使用**）")
  );
  const stored = total * B.retained;
  console.log(
    `  → 保持件数 ${B.retained}件（必ず残る ${ALWAYS_RETAINED}件が下限）` +
      ` ＝ 保存される見込み ${mb(stored)}（上限 ${mb(QUOTA_BYTES)} の ${Math.round((stored / QUOTA_BYTES) * 100)}%）`
  );

  const pct = Math.round((total / BUDGET_BYTES) * 100);
  console.log(`  合計 ${mb(total)} / 予算 ${mb(BUDGET_BYTES)}（${pct}%）`);

  if (total > BUDGET_BYTES) {
    // 保持期間をいくつにすればこの成果物が収まるかを、式を逆に解いて出す。
    // 「小さくしろ」しか言われないと、いちばん強い手（分母）に手が伸びない。
    const fits = Math.floor((QUOTA_BYTES * FLOOR_SHARE) / total);
    const days = B.perDay > 0 ? Math.floor(fits / B.perDay) : Infinity;
    console.error(
      `結果: NG — 予算 ${mb(BUDGET_BYTES)} を超えています。\n` +
        `  いまの成果物(${mb(total)})なら保持件数 ${fits}件までが限界で、` +
        `本番 ${B.perDay.toFixed(2)}件/日 だと保持期間 ${days}日ぶんに相当する。\n` +
        "  ①まずダッシュボードの保持期間を縮める（Project Settings → Security →\n" +
        `    Deployment Retention Policy を ${Number.isFinite(days) ? days : "?"}日以下に）。` +
        "縮めたらこのファイルの RETENTION_DAYS も同じ値に直すこと。\n" +
        "  ②次に「1ページを小さくする」（ISR Writes・転送量・表示速度に同じ比率で効く）。\n" +
        "  ③事前生成の対象を減らすのは最後の手段（焼かないページはデプロイのたびに\n" +
        "  ISR Writes を払い直すので、成果物が減っても総費用が増えることがある）。\n" +
        "  予算そのものを上げるときは、このファイル冒頭の式のどれを変えるのかを書くこと。"
    );
    process.exit(1);
  }
  console.log("結果: 全てOK");
}

if (require.main === module) main();
module.exports = { budget, dirSize };

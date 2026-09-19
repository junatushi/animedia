// デプロイ成果物の大きさに予算を設けて見張る（2026-09-14導入・重大度高）。
//
// 【なぜ要るか】Vercel Hobby の Deployment Storage は 10GB で、**保持している
// デプロイ数ぶん掛かる**。しかも Hobby は「直近10件の本番デプロイ」を保持期間の
// 設定に関わらず必ず保持する（https://vercel.com/changelog/hobby-projects-now-default-to-30-day-deployment-retention）。
// つまり **1デプロイの成果物 × 10 が、何をしても消えない床**になる。
//
//   成果物 1.0GB → 床だけで 10GB ＝ 上限ちょうど（2026-09-14に実際にこの状態で、
//                                        実測は 28.23GB ＝ 上限の282%だった）
//   成果物 0.57GB → 床は 5.7GB ＝ 上限の57%
//
// 成果物はページ数とページの大きさの積で決まり、**クールが増えるたびに自動で増える**
// （CLAUDE.md の条件④）。放っておくと必ずまた超えるので、増えたことに気づく仕掛けが要る。
// 「気づく」だけでは足りない（気づいても誰も見ない）ので、予算を超えたら落とす。
//
// 【予算の出し方】ここに書いた数字は逐次的に決めた値ではなく、上限から逆算している:
//   10GB（上限） × 0.65（床に使ってよい割合） ÷ 10（必ず保持される本番デプロイ数）= 650MB
// 残りの3.5GBはプレビューと、直近10件より古い本番デプロイの取り分。
// **この値を上げるときは、上の式のどれを変えるのかを書くこと**（数字だけ書き換えない）。
//
// 【超えたときの手当て】ページを減らすのではなく、まず1ページを小さくする
// （ISR Writes も転送量も同じ比率で効く）。内訳を出すのはそのため。
// 経緯は docs/operations.md の㊻。

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

const QUOTA_BYTES = 10 * 1000 * 1000 * 1000; // Hobby の Deployment Storage
const ALWAYS_RETAINED_PRODUCTION = 10; // 保持期間に関わらず残る本番デプロイ数
const FLOOR_SHARE = 0.65; // 上の床に使ってよい割合（残りはプレビュー等）
const BUDGET_BYTES = Math.round((QUOTA_BYTES * FLOOR_SHARE) / ALWAYS_RETAINED_PRODUCTION);

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

function main() {
  console.log("【デプロイ成果物の大きさ】");
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

  const pct = Math.round((total / BUDGET_BYTES) * 100);
  const floor = total * ALWAYS_RETAINED_PRODUCTION;
  console.log(
    `  合計 ${mb(total)} / 予算 ${mb(BUDGET_BYTES)}（${pct}%）` +
      ` — 必ず保持される本番${ALWAYS_RETAINED_PRODUCTION}件ぶんの床は ${mb(floor)}` +
      `（上限 ${mb(QUOTA_BYTES)} の ${Math.round((floor / QUOTA_BYTES) * 100)}%）`
  );

  if (total > BUDGET_BYTES) {
    console.error(
      `結果: NG — 予算 ${mb(BUDGET_BYTES)} を超えています。\n` +
        "  まず「1ページを小さくする」を検討すること（ISR Writes・転送量・表示速度に同じ比率で効く）。\n" +
        "  事前生成の対象を減らすのは最後の手段（焼かないページはデプロイのたびに\n" +
        "  ISR Writes を払い直すので、成果物が減っても総費用が増えることがある）。\n" +
        "  予算そのものを上げるときは、このファイル冒頭の式のどれを変えるのかを書くこと。"
    );
    process.exit(1);
  }
  console.log("結果: 全てOK");
}

if (require.main === module) main();
module.exports = { BUDGET_BYTES, dirSize };

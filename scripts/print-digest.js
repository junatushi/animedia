// 投稿本文を標準出力に出すだけのスクリプト。GitHub Actions（daily-digest.yml/season-announce.yml）
// からは環境変数 POST_KIND で呼ばれる。手元で新機能・修正を告知したい時は、以下のように
// コマンドライン引数でも指定できる（env指定と等価。手打ちの手間を減らすためのショートカット）:
//   node scripts/print-digest.js coverage
//   node scripts/print-digest.js feature "独占チップ" "配信サービスをAND条件で絞れるようになりました"
const { buildPost } = require("./lib/build-digest");

const [, , argKind, argName, argDesc] = process.argv;
if (argKind) process.env.POST_KIND = argKind;
if (argName) process.env.FEATURE_NAME = argName;
if (argDesc) process.env.FEATURE_DESC = argDesc;

buildPost()
  .then(({ text }) => {
    process.stdout.write(text + "\n");
  })
  .catch((err) => {
    console.error("投稿本文の生成に失敗しました:", err);
    process.exit(1);
  });

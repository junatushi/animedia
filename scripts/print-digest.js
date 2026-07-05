// 週次ダイジェスト本文を標準出力に出すだけのスクリプト。
// X（手動投稿）用の下書きIssue作成や、動作確認に使う。
const { buildDigest } = require("./lib/build-digest");

buildDigest()
  .then(({ text }) => {
    process.stdout.write(text + "\n");
  })
  .catch((err) => {
    console.error("ダイジェストの生成に失敗しました:", err);
    process.exit(1);
  });

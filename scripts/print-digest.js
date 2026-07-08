// 投稿本文を標準出力に出すだけのスクリプト。POST_KIND（digest=日次 / season=新シーズン告知）で
// 内容が切り替わる。X（手動投稿）用の下書きIssue作成や、動作確認に使う。
const { buildPost } = require("./lib/build-digest");

buildPost()
  .then(({ text }) => {
    process.stdout.write(text + "\n");
  })
  .catch((err) => {
    console.error("投稿本文の生成に失敗しました:", err);
    process.exit(1);
  });

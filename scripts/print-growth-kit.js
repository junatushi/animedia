// 週次「Xアカウント成長キット」のMarkdownを標準出力に出すだけのスクリプト。
// x-growth.yml から呼ばれ、出力をそのままGitHub Issueの本文にする。
// 手元で内容を確認したいときは `node scripts/print-growth-kit.js` を直接実行する。
const { buildGrowthKit, renderGrowthKit } = require("./lib/build-growth-kit");

buildGrowthKit()
  .then((kit) => {
    process.stdout.write(renderGrowthKit(kit) + "\n");
  })
  .catch((err) => {
    console.error("成長キットの生成に失敗しました:", err);
    process.exit(1);
  });

// 投稿本文を標準出力に出すだけのスクリプト。GitHub Actions（daily-digest.yml/season-announce.yml）
// からは環境変数 POST_KIND で呼ばれる。手元で新機能・修正を告知したい時は、以下のように
// コマンドライン引数でも指定できる（env指定と等価。手打ちの手間を減らすためのショートカット）:
//   node scripts/print-digest.js coverage
//   node scripts/print-digest.js feature "独占チップ" "配信サービスをAND条件で絞れるようになりました"
//
// 投稿先ごとの本文（2026-08-06導入）は --platform= で切り替える。既定は x（Xの手動投稿用）。
//   node scripts/print-digest.js --platform=mastodon
//   node scripts/print-digest.js --platform=all     … 全ての投稿先を続けて出す（目視確認用）
// 環境変数 DIGEST_PLATFORM でも同じ指定ができる（ワークフローの dry_run 用）。
//
// --issue … GitHub Issueの本文用にMarkdownで整形する（2026-08-07導入）。
//   投稿ごとに「タップ1回でXの投稿画面が本文入りで開く」リンクを添える。
//   経緯: 週次X成長キットには2026-08-06にこのリンクを入れたが、**毎日起票される
//   日次の下書きIssueには入っておらず**、こちらは本文がベタ書きで置かれているだけだった。
//   スマホで「長押しで選択→コピー→Xアプリに切替→貼り付け」を毎日やるのは続かない
//   （実際、日次の下書きIssueは7/31以降7件が連続でopenのまま放置されていた）。
//   毎日実施する側にこそ手数の削減が要るので、日次にも同じ形を入れる。
//   詳細は scripts/lib/x-intent.js のコメント。
const { buildPost, PLATFORMS } = require("./lib/build-digest");
const { xPostUrl } = require("./lib/x-intent");

const argv = process.argv.slice(2);
// --platform=... は位置引数と混ざらないよう先に抜き取る。
const platformArg = argv.find((a) => a.startsWith("--platform="));
const issueMode = argv.includes("--issue");
const rest = argv.filter((a) => !a.startsWith("--platform=") && a !== "--issue");
const platform = platformArg ? platformArg.slice("--platform=".length) : process.env.DIGEST_PLATFORM || "x";

const [argKind, argName, argDesc] = rest;
if (argKind) process.env.POST_KIND = argKind;
if (argName) process.env.FEATURE_NAME = argName;
if (argDesc) process.env.FEATURE_DESC = argDesc;

// 日曜はTOP5＋曜日紹介の2投稿になりうるため、区切り線を挟んで両方出す。
const joinPosts = (posts) => posts.map((p) => p.text).join("\n\n---\n\n");

// Issue本文用の見出し。kindが増えたときは既定でそのkind名がそのまま出るので、
// ラベルを足し忘れても本文が欠けることはない。
const KIND_LABEL = {
  top5: "注目作TOP5",
  airing: "今日の放送・配信",
  spotlight: "【どこで見れる？】スポットライト",
};

// 投稿ごとに「Xの投稿画面を開くリンク」＋「コピー用のコードブロック」を並べる。
// コードブロックを残すのは、PCでのコピペ運用と、Web Intentが将来Xの仕様変更で
// 壊れたときの保険（週次キットと同じ方針）。
function renderIssue(posts) {
  const out = [
    "その日の投稿下書きです。**リンクを押すと本文が入った状態でXの投稿画面が開きます**（投稿ボタンは自分で押してください）。",
    "",
    "投稿し終えたらこのIssueを閉じてください。",
    "",
  ];
  posts.forEach((p, i) => {
    const label = KIND_LABEL[p.kind] ?? p.kind ?? `投稿${i + 1}`;
    out.push(`## ${label}`);
    out.push("");
    out.push(`**[▶ このままXの投稿画面を開く](${xPostUrl(p.text)})**`);
    out.push("");
    out.push("```");
    out.push(p.text);
    out.push("```");
    out.push("");
    // 本文からURLを外した投稿（＝X。2026-08-16導入）は、リプライに貼るURLをここに出す。
    // 本文に入れないだけで導線自体は残す設計なので、**この欄を出し忘れると流入が丸ごと
    // 消える**。posts側に replyUrl があるときだけ出し、無いときは何も足さない。
    if (p.replyUrl) {
      out.push("### ↑を投稿したら、自分のポストにリプライでURLを貼る");
      out.push("");
      out.push(
        "本文に外部リンクを入れないための運用です（2026-08-07のシャドウバン対応）。" +
          "本文とリプライを分けることで、リンクは残したまま本文からリンクを外せます。"
      );
      out.push("");
      out.push("```");
      out.push(p.replyUrl);
      out.push("```");
      out.push("");
    }
  });
  return out.join("\n");
}

async function main() {
  if (issueMode) {
    const { posts } = await buildPost(new Date(), platform);
    process.stdout.write(renderIssue(posts) + "\n");
    return;
  }
  if (platform !== "all") {
    const { posts } = await buildPost(new Date(), platform);
    process.stdout.write(joinPosts(posts) + "\n");
    return;
  }
  // --platform=all: 投稿先ごとに本文がどう変わるかを1度に見比べるための出力。
  const chunks = [];
  for (const p of PLATFORMS) {
    const { posts } = await buildPost(new Date(), p);
    chunks.push(`===== ${p} =====\n${joinPosts(posts)}`);
  }
  process.stdout.write(chunks.join("\n\n") + "\n");
}

// 直接実行されたときだけ走らせる。`node scripts/check.ts` から renderIssue を
// import して検査したいが、その際にネットワークへ出る main() が動くと困るため
// （サンドボックスでは外向き通信が塞がれていて必ず失敗する）。
if (require.main === module) {
  main().catch((err) => {
    console.error("投稿本文の生成に失敗しました:", err);
    process.exit(1);
  });
}

module.exports = { renderIssue };

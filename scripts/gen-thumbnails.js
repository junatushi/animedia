// AI独断解釈サムネの事前生成スクリプト。
// Pollinations（無料・APIキー不要）で、作品タイトルから連想した「本編とは無関係な
// 創作イラスト」を生成し、public/works/{annictId}.jpg として保存する。
// 実行時に都度生成するのではなく、ここで一度だけ生成して静的ファイルとしてコミットするため、
// サイトの表示コスト・APIキー・レート制限はゼロ（生成物はリポジトリの資産になる）。
//
// 重要:
//  - プロンプトは実在キャラの再現を避け、タイトルの字面から連想した抽象的な情景にする
//    （著作権配慮。生成物には必ず「本作品との関連性はありません」の注釈を表示する）。
//  - 作品ごとに絵柄トーン（画風）を変える。
//  - 生成後は必ず人の目で確認してからコミットすること。
//
// 使い方: node scripts/gen-thumbnails.js
const https = require("https");
const fs = require("fs");
const path = require("path");

const OUT_DIR = path.join(__dirname, "..", "public", "works");
const MANIFEST = path.join(__dirname, "..", "content", "works", "imageIds.ts");

// 作品ID → 独断と偏見プロンプト（画風は作品ごとに変える）＋seed。
// prompt末尾に "no text, no watermark" 等を足して余計な文字入りを避ける。
const PROMPTS = [
  { id: 8410, seed: 7, prompt: "a single ornate hair ribbon floating in a swirling clockwork apocalypse sky, dark pastel storybook illustration, dreamy and ominous, no characters, no text" },
  { id: 13582, seed: 42, prompt: "a weary middle-aged man resting in a field at sunset, magic staff glowing faintly, anime background art, warm nostalgic scenery, no faces, no text" },
  { id: 8632, seed: 11, prompt: "a small worn military officer cap lying on a foggy war-torn battlefield at dawn, gritty oil painting, dramatic, no characters, no text" },
  { id: 14132, seed: 23, prompt: "a small figure dashing across misty medieval japanese mountains, escaping, dynamic sumi-e ink wash painting, monochrome with a touch of red, no text" },
  { id: 15557, seed: 5, prompt: "two paper cranes drifting under a fading violet twilight, bittersweet and delicate watercolor, soft and quiet, no characters, no text" },
  { id: 17197, seed: 88, prompt: "a lone spiral tower rising from an endless moonlit desert under a starry sky, fantasy matte painting, epic and lonely, no characters, no text" },
  { id: 17088, seed: 3, prompt: "a grumpy stray cat silhouette with a glowing cigarette in a neon back alley at night, humorous flat cartoon style, no text" },
  { id: 16391, seed: 9, prompt: "a quiet smoking corner behind a convenience store at night, two glowing cigarette embers in the dark, cinematic slice of life, moody realism, no characters, no text" },
  { id: 17361, seed: 14, prompt: "two umbrellas of opposite colors standing side by side in gentle rain, wholesome minimal flat vector illustration, pastel, no characters, no text" },
  { id: 6187, seed: 30, prompt: "a retro taisho-era kyoto street lit by the first electric lightbulbs, steampunk, impressionist painting, warm nostalgic glow, no characters, no text" },
  { id: 16658, seed: 100, prompt: "a hundred glowing heart-shaped balloons filling a bright cheerful sky, exuberant pop art, vivid and playful, no characters, no text" },
  { id: 13052, seed: 55, prompt: "a rain-soaked neon cyberpunk city street with floating data streams and holograms, blade runner atmosphere, no characters, no text" },
];

function genOne({ id, prompt, seed }) {
  const encoded = encodeURIComponent(prompt);
  const url = `https://image.pollinations.ai/prompt/${encoded}?width=640&height=360&nologo=true&seed=${seed}`;
  const file = path.join(OUT_DIR, `${id}.jpg`);
  return new Promise((resolve) => {
    const req = https.get(url, (res) => {
      if (res.statusCode !== 200) {
        console.log(`  ✗ ${id}: status ${res.statusCode}`);
        res.resume();
        return resolve(false);
      }
      const w = fs.createWriteStream(file);
      res.pipe(w);
      w.on("finish", () => {
        const size = fs.statSync(file).size;
        console.log(`  ✓ ${id}: ${(size / 1024).toFixed(0)}KB`);
        resolve(size > 1000);
      });
    });
    req.setTimeout(60000, () => {
      req.destroy();
      console.log(`  ✗ ${id}: timeout`);
      resolve(false);
    });
    req.on("error", (e) => {
      console.log(`  ✗ ${id}: ${e.message}`);
      resolve(false);
    });
  });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`生成開始（${PROMPTS.length}件）…`);
  for (const p of PROMPTS) {
    await genOne(p);
  }
  // public/works にある画像IDを走査して manifest を更新する。
  const ids = fs
    .readdirSync(OUT_DIR)
    .filter((f) => f.endsWith(".jpg"))
    .map((f) => Number(f.replace(".jpg", "")))
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b);
  const body =
    "// 自動生成（scripts/gen-thumbnails.js）。AI独断解釈サムネ（public/works/{id}.jpg）が\n" +
    "// 存在する作品IDの一覧。カード・作品ページはこの集合で画像の有無を判定する。\n" +
    `export const WORK_IMAGE_IDS = new Set<number>([${ids.join(", ")}]);\n`;
  fs.writeFileSync(MANIFEST, body);
  console.log(`manifest更新: ${ids.length}件 → ${MANIFEST}`);
}

main();

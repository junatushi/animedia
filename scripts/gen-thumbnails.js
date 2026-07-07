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
  { id: 8410, seed: 207, prompt: "an ornate magical clock face glowing in a swirling stormy twilight sky, dark gothic fairytale illustration, dramatic and mysterious, centered composition, no characters, no text" },
  { id: 13582, seed: 242, prompt: "a lone weary traveler resting under a giant warm sunset in a grassy meadow, nostalgic anime background art, soft golden light, centered, no visible face, no text" },
  { id: 8632, seed: 311, prompt: "a small worn military officer cap resting on a misty battlefield at dawn, muted gritty oil painting, somber mood, centered subject, no characters, no text" },
  { id: 14132, seed: 223, prompt: "a nimble figure leaping across stylized mountains and clouds, traditional japanese ukiyo-e woodblock print, bold flat colors, no text" },
  { id: 15557, seed: 405, prompt: "two delicate paper cranes over a soft pastel twilight, lyrical dreamy watercolor, tender and melancholic, centered, no characters, no text" },
  { id: 17197, seed: 188, prompt: "a lone spiral watchtower on an endless moonlit desert, grand fantasy matte painting, starry sky, centered, no characters, no text" },
  { id: 17088, seed: 303, prompt: "a chubby grumpy black cat sitting in a neon alley with a small wisp of smoke, cute flat cartoon sticker style, humorous, centered, no text" },
  { id: 16391, seed: 209, prompt: "two glowing cigarette embers floating in a dark quiet parking lot at night, moody cinematic realism, soft bokeh lights, no characters, no text" },
  { id: 17361, seed: 214, prompt: "two opposite-colored umbrellas side by side under cheerful rain, bright cute pop illustration, pastel poster style, centered, no characters, no text" },
  { id: 6187, seed: 330, prompt: "a nostalgic taisho-era street glowing with the first electric lightbulbs, warm impressionist oil painting, steampunk, centered, no characters, no text" },
  { id: 16658, seed: 500, prompt: "a joyful burst of a hundred heart-shaped balloons in a bright sky, vivid pop art poster, energetic and colorful, centered, no text" },
  { id: 13052, seed: 155, prompt: "a neon-drenched rainy cyberpunk city with holographic signs and wet reflections, moody sci-fi concept art, no characters, no text" },
  { id: 15751, seed: 612, prompt: "a stack of manga drafting pens and inked panels under a harsh spotlight in a dark studio, dramatic sumi-e ink wash style with a single red brushstroke accent, intense tension, no characters, no text" },
  { id: 15881, seed: 674, prompt: "an ornate mongolian ger tent glowing warmly under a starry steppe night sky with swirling mystic incense smoke, folk gouache painting style, rich earthy colors, no characters, no text" },
  { id: 16714, seed: 719, prompt: "a translucent glass deer sprinting through a quiet neon-lit night street, ghostly glowing outline trailing light, ethereal dreamy digital art, no characters, no text" },
  { id: 17057, seed: 733, prompt: "swirling ribbons of colorful light forming a dynamic dance silhouette on an empty stage with confetti bursts, vibrant vector pop concert poster, energetic, no characters, no text" },
  { id: 16248, seed: 288, prompt: "a lone katana standing upright in a misty countryside rice field at dawn, serene watercolor painting, soft pastel light, no characters, no text" },
  { id: 16339, seed: 841, prompt: "a whimsical striped circus tent surrounded by a field of giant sunflowers under a golden sky, flat cute cartoon sticker style, playful, no characters, no text" },
  { id: 16571, seed: 366, prompt: "scuba diving fins and a snorkel mask resting on a sun-bleached wooden dock over turquoise ocean water, retro travel poster illustration, bright summer colors, no characters, no text" },
  { id: 7915, seed: 528, prompt: "a glowing arcade fighting-game cabinet joystick lit by neon signs in a dim arcade, moody cyberpunk illustration, vivid magenta and cyan lights, no characters, no text" },
  { id: 14969, seed: 902, prompt: "a sleek glass office tower sprouting magical sparkles and stars from its highest window at dusk, flat modern corporate-fantasy vector art, no characters, no text" },
  { id: 13010, seed: 447, prompt: "a single empty swing gently moving in a quiet park at dusk, soft melancholic watercolor, muted blue and orange tones, no characters, no text" },
  { id: 16677, seed: 355, prompt: "an ornate candlelit library filled with towering bookshelves and a single white rose on the desk, elegant oil painting, warm chiaroscuro lighting, no characters, no text" },
  { id: 10352, seed: 190, prompt: "an antique game controller glowing beside a stack of storybooks under soft pastel light, whimsical storybook illustration, no characters, no text" },
  { id: 11193, seed: 823, prompt: "cherry blossom petals drifting across an empty schoolyard path in soft afternoon light, gentle cel-shaded anime background art, pastel tones, no characters, no text" },
  { id: 16910, seed: 561, prompt: "a candy-colored kaiju silhouette looming behind pastel city rooftops at sunset, pop-surrealist illustration, sweet caramel tones, no characters, no text" },
  { id: 16023, seed: 274, prompt: "a vintage teacup, feather duster, and broom neatly arranged on a lace tablecloth in a cozy sunlit room, whimsical flat maid-cafe illustration, no characters, no text" },
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

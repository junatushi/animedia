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
  { id: 15035, seed: 205, prompt: "a single weathered katana blade planted upright in barren cracked earth under a blood-red eclipse sky, empty desolate battlefield, dramatic monochrome ink painting with crimson accents, absolutely no people, no figures, no silhouettes, no text" },
  { id: 16519, seed: 143, prompt: "a glowing electric guitar and drifting music notes over a dreamy starry stage, sparkling pastel idol-band poster art, vibrant and cheerful, no characters, no text" },
  { id: 14929, seed: 656, prompt: "an empty suit of polished armor draped with a travel cloak standing in a sunlit fantasy meadow, lighthearted storybook watercolor, no characters, no text" },
  { id: 13889, seed: 471, prompt: "a massive ornate war greatsword planted in cracked ground glowing with pixel-game energy runes, vivid retro game-fantasy digital art, no characters, no text" },
  { id: 15036, seed: 385, prompt: "a glowing magical staff crossed with a blazing gun-blade over a starburst of pink energy, dynamic magical-girl poster art, sparkles and lens flares, no characters, no text" },
  { id: 17114, seed: 227, prompt: "a flickering paper lantern floating in a dark misty shrine corridor with faint ghostly wisps, eerie yet cute japanese horror-comedy illustration, no characters, no text" },
  { id: 15724, seed: 604, prompt: "two ornate hair ornaments of a butterfly and a mouse resting on silk beside a lantern-lit palace garden, elegant chinese-court gouache painting, no characters, no text" },
  { id: 17353, seed: 812, prompt: "a foreboding dungeon gate glowing with harsh red 'hell difficulty' runes over a dark stony chasm, gritty dark-fantasy game concept art, no characters, no text" },
  { id: 17519, seed: 259, prompt: "a golden euphonium resting on a music stand in a sunlit rehearsal room with drifting sheet music, tender nostalgic watercolor, warm afternoon light, no characters, no text" },
  { id: 17131, seed: 690, prompt: "an ancient spellbook floating open with glowing arcane sigils inside a grand magic academy hall, luminous fantasy illustration, deep blues and gold, no characters, no text" },
  { id: 16606, seed: 640, prompt: "a single sword planted alone on a deserted windswept clifftop overlooking a vast sea at dawn, completely empty landscape, epic golden-hour matte painting, absolutely no people, no figures, no silhouettes, no text" },
  { id: 16478, seed: 344, prompt: "a humble wooden signpost in a peaceful green fantasy village glowing faintly with the number 999 in magical light, cozy rpg storybook art, no characters, no text" },
  { id: 15481, seed: 733, prompt: "a tiny sleeping dragon curled up among fluffy cats in a mossy sunlit forest hollow, warm gentle picture-book illustration, soft greens, no characters, no text" },
  { id: 16856, seed: 405, prompt: "a blazing iron wok erupting with dramatic flames and swirling steam over a dark kitchen, intense dynamic manga-style illustration, fiery orange and black, no characters, no text" },
  { id: 16405, seed: 337, prompt: "a close-up of steaming home-cooked japanese dishes arranged on an empty wooden dining table in a cozy sunlit room, warm still-life food illustration, absolutely no people, no figures, no hands, no text" },
  { id: 16555, seed: 951, prompt: "a shattered stone crown resting atop an overgrown school desk in a misty abandoned courtyard, dark fantasy gouache painting, absolutely no people, no text" },
  { id: 16822, seed: 955, prompt: "extreme close-up of an oversized comical oni demon mask carved from weathered wood, mounted on an old shrine wall, moss and lichen texture, whimsical folk-horror illustration, empty background, absolutely no people, no village street, no text" },
  { id: 16538, seed: 489, prompt: "an ornate deck of playing cards fanned out beside a broken pocket watch on dark velvet, elegant film-noir illustration, moody spotlight, absolutely no people, no text" },
  { id: 16468, seed: 172, prompt: "seven ornate glowing spellbooks stacked in a spiral around a single burning candle, dark academia oil painting, dramatic shadows, absolutely no people, no text" },
  { id: 17354, seed: 630, prompt: "a single glowing roulette game token spinning on a cracked black table in total darkness, tense minimalist illustration, red rim light, absolutely no people, no text" },
  { id: 16524, seed: 815, prompt: "a glowing shield and enchanted staff crossed together radiating protective light rays in a dungeon corridor, supportive fantasy digital painting, absolutely no people, no text" },
  { id: 16132, seed: 294, prompt: "a red ceremonial wedding sash draped over an ornate oni mask under falling cherry blossoms, elegant japanese gouache painting, absolutely no people, no text" },
  { id: 11195, seed: 706, prompt: "a plain wooden mask beside a hidden silver dagger resting on an imperial velvet cushion, noble intrigue illustration, dim candlelight, absolutely no people, no text" },
  { id: 16569, seed: 358, prompt: "a single boxing glove resting on an empty teacher's desk in a sunlit classroom, playful retro anime background art, absolutely no people, no text" },
  { id: 16396, seed: 927, prompt: "glowing holy light leaking from a cracked porcelain teacup onto a lace tablecloth, soft pastel fantasy still life, absolutely no people, no text" },
  { id: 16395, seed: 611, prompt: "a wooden signpost with a small carved horn ornament standing in an empty grassy frontier field at dusk, pastoral watercolor painting, absolutely no people, no creatures, no body parts, no text" },
  { id: 15623, seed: 582, prompt: "a black flame emblem burning on an ancient ninja scroll surrounded by scattered shuriken, dark ink and wash illustration, absolutely no people, no text" },
  { id: 17296, seed: 401, prompt: "a tiny vintage camper van parked beside a crackling campfire pot under a starry sky, cozy flat travel-poster illustration, absolutely no people, no text" },
  { id: 16808, seed: 264, prompt: "four mismatched teacups arranged on a warm wooden kitchen table in morning sunlight, heartwarming soft illustration, absolutely no people, no text" },
  { id: 17147, seed: 718, prompt: "a pressed white rose inside an old handwritten love letter tied with silk ribbon, romantic vintage watercolor, absolutely no people, no text" },
  { id: 16328, seed: 559, prompt: "a scorched dodgeball trailing flame streaks mid-air over a school gym floor, dynamic sports manga ink illustration, absolutely no people, no text" },
  { id: 17042, seed: 883, prompt: "an ornate ancient golden mask half-buried in sand within a torch-lit tomb chamber, adventurous matte painting, absolutely no people, no text" },
  { id: 17514, seed: 320, prompt: "a glowing ribbon-shaped sword crossed with a jeweled tiara floating above storm clouds, epic fairy-tale illustration, absolutely no people, no text" },
  { id: 6528, seed: 677, prompt: "glowing crystalline dust particles swirling around a cracked meteorite fragment in a quiet suburban night sky, sci-fi concept art, absolutely no people, no text" },
  { id: 17121, seed: 508, prompt: "an ornate golden dagger and ancient cuneiform tablet resting on desert sand under a blood-red sky, historical epic matte painting, absolutely no people, no text" },
  { id: 11119, seed: 214, prompt: "a small toy battleship model floating among soap bubbles in a bright bathtub, playful pastel illustration, cheerful and cute, absolutely no people, no text" },
  { id: 17043, seed: 462, prompt: "a stack of well-worn handwritten letters tied with string resting on an old wooden school desk, soft nostalgic illustration, warm afternoon light, absolutely no people, no text" },
  { id: 17543, seed: 891, prompt: "a simple hero's cape draped over an empty chair in a sunlit training gym, inspirational flat vector illustration, bright and hopeful, absolutely no people, no text" },
  { id: 17069, seed: 349, prompt: "a hand-drawn firework sketch pinned to a corkboard beside a riverside photograph, nostalgic watercolor illustration, warm summer glow, absolutely no people, no text" },
  { id: 17323, seed: 480, prompt: "an empty school blazer hanging on a coat hook beside a windowsill blooming with flowers, soft shoujo watercolor illustration, no figures inside the clothing, absolutely no people, no faces, no text" },
  { id: 17379, seed: 726, prompt: "a magnifying glass resting on an old detective notebook in a mysterious moonlit garden, whimsical mystery illustration, pastel magical tones, absolutely no people, no text" },
  { id: 16632, seed: 118, prompt: "a comically oversized paper ghost lantern floating above a torii gate at dusk, playful horror-comedy illustration, absolutely no people, no text" },
  { id: 16734, seed: 640, prompt: "a delicate seashell necklace resting on wet sand beside gentle turquoise ocean waves, cute pastel illustration, absolutely no people, no text" },
  { id: 16475, seed: 970, prompt: "a lone katana blade reflecting pale moonlight embedded in a cracked stone wall of an ancient japanese castle, dramatic photoreal dark-fantasy illustration, absolutely no people, no text" },
  { id: 17192, seed: 285, prompt: "two mismatched coffee mugs beside an open laptop on a cluttered university desk at night, warm romantic slice-of-life illustration, absolutely no people, no text" },
  { id: 16440, seed: 837, prompt: "a delicate ornate treasure locket resting on gentle ocean waves under a golden sunset, adventurous nautical watercolor illustration, absolutely no people, no text" },
  { id: 16681, seed: 452, prompt: "a tiny dog paw-print trail crossing scattered handwritten notebook pages, playful ink illustration, absolutely no people, no text" },
  { id: 13779, seed: 306, prompt: "a single wind-up tin toy robot standing alone on a sunlit wooden floor, nostalgic warm illustration, gentle dust motes in light, absolutely no people, no text" },
  { id: 17092, seed: 665, prompt: "a paper airplane gliding past a classroom window with three empty desks catching morning light, playful cartoon sticker style, absolutely no people, no text" },
  { id: 17371, seed: 194, prompt: "an icy blue rose frozen inside a delicate glass ornament resting on frost-covered velvet, elegant winter fairy-tale illustration, absolutely no people, no text" },
  { id: 16393, seed: 508, prompt: "a glowing mechanical eye embedded in a cracked ancient stone monument overgrown with vines, retro sci-fi concept art, absolutely no people, no text" },
  { id: 16792, seed: 733, prompt: "a set of ornate lacquered samurai armor plates stacked neatly in a dim candlelit shrine hall, dramatic traditional japanese illustration, absolutely no people, no text" },
  { id: 17054, seed: 421, prompt: "a large mechanical wrench resting against a rain-streaked hangar window at night, moody industrial illustration, blue-grey tones, absolutely no people, no text" },
  { id: 17190, seed: 856, prompt: "a lone paper talisman fluttering on a shrine rope under a stormy purple sky, eerie japanese folklore illustration, absolutely no people, no text" },
  { id: 17134, seed: 372, prompt: "two mismatched wine glasses left on a city apartment balcony railing at night, moody romantic illustration, warm city lights bokeh, absolutely no people, no text" },
  { id: 17333, seed: 112, prompt: "a cracked leather gauntlet resting on a scorched post-apocalyptic wasteland rock, gritty dramatic illustration, dusty orange haze, absolutely no people, no text" },
  { id: 17643, seed: 447, prompt: "a military officer's cap and an iron cross medal resting on a war-torn map table, somber wartime illustration, muted colors, absolutely no people, no text" },
  { id: 17729, seed: 205, prompt: "a tiny paper theater stage lit by a single glowing candle, whimsical miniature illustration, warm cozy tones, absolutely no people, no text" },
  { id: 16726, seed: 663, prompt: "a small glowing green UFO light hovering over a quiet countryside field at night, quirky retro sci-fi illustration, absolutely no people, no text" },
  { id: 17820, seed: 890, prompt: "a single glowing phoenix feather resting on a hospital windowsill at dusk, surreal soft illustration, gentle warm light, absolutely no people, no text" },
  { id: 16982, seed: 358, prompt: "an open antique storybook with its pages turning into paper birds mid-flight, whimsical flat illustration, warm cream tones, absolutely no people, no text" },
  { id: 17130, seed: 521, prompt: "a straw yokai charm hanging from a beach umbrella at a retro japanese hot spring resort, playful folklore illustration, absolutely no people, no text" },
  { id: 17721, seed: 749, prompt: "a solitary glass butterfly frozen mid-flight above a rain-streaked window, melancholic ethereal illustration, soft blue tones, absolutely no people, no text" },
  { id: 17308, seed: 284, prompt: "a pair of round yellow goggles resting beside a furry blue monster paw print in a candy-colored room, playful cartoon illustration, absolutely no people, no text" },
  { id: 17802, seed: 916, prompt: "a lone lantern glowing beside a bubbling cauldron in a misty moonlit valley, dark whimsical fairy-tale illustration, absolutely no people, no text" },
  { id: 17343, seed: 137, prompt: "a golden folding fan and an ornate katana resting on a red kabuki stage curtain, vibrant traditional japanese illustration, absolutely no people, no text" },
  { id: 17538, seed: 602, prompt: "a glowing neon takoyaki stand sign above a bustling empty osaka back-alley at night, vibrant retro neon illustration, absolutely no people, no text" },
  { id: 17196, seed: 830, prompt: "a plastic dinosaur model kit still on its sprue under a warm desk lamp, nostalgic hobby-craft illustration, absolutely no people, no text" },
  { id: 17812, seed: 274, prompt: "a tattered paper kamishibai theater frame glowing eerily in darkness, unsettling japanese horror illustration, absolutely no people, no text" },
  { id: 17390, seed: 495, prompt: "a small pirate ship built from colorful toy building bricks sailing on a blue felt sea, playful toy-photography illustration, absolutely no people, no text" },
  { id: 17521, seed: 402, prompt: "a small glowing globe resting alone on an empty windowsill at sunset, no one nearby, cute heartwarming still-life illustration, soft golden light, absolutely no people, no children, no figures, no text" },
  { id: 17857, seed: 328, prompt: "a train ticket and small suitcase resting on a station bench in the yamagata countryside, nostalgic travel illustration, absolutely no people, no text" },
  { id: 17562, seed: 573, prompt: "a plump loaf of bread wearing a tiny knitted hat resting in a wicker basket, adorable bakery illustration, warm cozy tones, absolutely no people, no text" },
  { id: 17868, seed: 908, prompt: "a banana peel shaped like a cozy blanket draped over a tiny cushion, whimsical cute illustration, pastel colors, absolutely no people, no text" },
  { id: 17370, seed: 140, prompt: "a row of colorful paw-print footprints leading across a sandy prehistoric jungle path toward a distant volcano, adventurous flat cartoon illustration, empty scene, no creatures, no toys, no hands, no people, no text" },
  { id: 17925, seed: 671, prompt: "a shattered chess king piece glowing red on a tactical holographic map, dramatic sci-fi illustration, deep blues and crimson, absolutely no people, no text" },
  { id: 17881, seed: 856, prompt: "a glowing energy-sword hilt resting on ancient stone steps under twin suns, epic sci-fi illustration, sweeping desert vista, absolutely no people, no text" },
  { id: 17865, seed: 190, prompt: "a single house key resting on a welcome mat under warm porch light, cozy quiet illustration, evening tones, absolutely no people, no text" },
  { id: 17819, seed: 435, prompt: "a small glowing alien footprint on a suburban backyard lawn at night, playful cute sci-fi illustration, starry sky, absolutely no people, no text" },
  { id: 17642, seed: 702, prompt: "a tiny die-cast toy car parked on a wooden train track diorama, nostalgic toy-photography illustration, warm light, absolutely no people, no text" },
  { id: 17900, seed: 318, prompt: "a fluffy white cloud-shaped pastry on a pastel blue plate with a tiny bell charm, cute kawaii illustration, soft pastel colors, absolutely no people, no text" },
  { id: 17901, seed: 947, prompt: "a sparkling ribbon-wrapped wand resting on a bouquet of glowing flowers, shiny magical-girl poster art, pastel sparkles, absolutely no people, no text" },
  { id: 17902, seed: 563, prompt: "an ancient rune-carved stone tablet glowing faintly in an overgrown fantasy ruin, epic rpg concept art, mystical mist, absolutely no people, no text" },
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

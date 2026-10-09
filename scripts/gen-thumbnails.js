// AI独断解釈サムネの事前生成スクリプト。
// AI Horde（無料・登録不要。ボランティアのGPUで動く非営利の生成サービス）で、作品タイトルから
// 連想した「本編とは無関係な創作イラスト」を生成し、public/works/{annictId}.webp として保存する。
// 実行時に都度生成するのではなく、ここで一度だけ生成して静的ファイルとしてコミットするため、
// サイトの表示コスト・APIキー・レート制限はゼロ（生成物はリポジトリの資産になる）。
//
// 【2026-10-10】生成元をPollinationsからAI Hordeへ移した。Pollinationsのキー無しの窓口
// （image.pollinations.ai）が有料化され、402 Payment Required（1枚0.01 USDCの支払い要求）を
// 返すようになった。通った1枚も nologo=true を無視して右下にロゴが入っていた。
// AI Hordeは匿名キーでも使えるが優先度が最低で、実測1枚12分。共有のボランティア資源なので
// 同時に投げるのは CONCURRENCY 件までにする（全件を一度に投げて列を占有しない）。
// モデルは FLUX.1 schnell（Apache 2.0＝生成物をサイトに載せてよい）。
//
// 重要:
//  - プロンプトは実在キャラの再現を避け、タイトルの字面から連想した抽象的な情景にする
//    （著作権配慮。生成物には必ず「本作品との関連性はありません」の注釈を表示する）。
//  - 作品ごとに絵柄トーン（画風）を変える。
//  - 生成後は必ず人の目で確認してからコミットすること。
//
// 使い方:
//   node scripts/gen-thumbnails.js            … 画像がまだ無い作品だけ生成する
//   node scripts/gen-thumbnails.js 17089 ...  … 指定した作品だけ作り直す（目視で弾いたとき）
// 既にある画像は作り直さない（2026-10-10）。以前は毎回全件を生成し直していたため、
// 1クール足すたびに目視確認済みの過去の画像まで差し替わる恐れがあった
// （同じseedでも生成モデル側の更新で絵が変わる）。
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
  // ── 2026年秋（10月期）2026-10-10追加 ──
  { id: 16290, seed: 731, prompt: "an apothecary's wooden cabinet of tiny drawers with dried herbs and a porcelain mortar in a lantern-lit palace room, detailed botanical ink illustration, absolutely no people, no text" },
  { id: 15941, seed: 214, prompt: "a meeting room table with a wooden gavel and a single ring donut with a big hole, playful pop cartoon illustration, bright colors, absolutely no people, no text" },
  { id: 17053, seed: 588, prompt: "glowing green and red candlestick chart bars rising like skyscrapers over a night city, dramatic synthwave illustration, absolutely no people, no numbers, no text" },
  { id: 16586, seed: 342, prompt: "a small pink ceramic piggy bank sitting on a seaside train station bench at dusk, soft cinematic anime background art, absolutely no people, no text" },
  { id: 10404, seed: 907, prompt: "a vast spiraling abyss descending into glowing mist with ancient ruins clinging to the cliffs, epic fantasy matte painting, absolutely no people, no text" },
  { id: 15795, seed: 163, prompt: "a white badminton shuttlecock resting on a blue wooden box in an empty sunlit school gym, fresh airy watercolor, absolutely no people, no text" },
  { id: 9753, seed: 479, prompt: "a detective's deerstalker hat and magnifying glass beside a white lily on an airplane window seat, moody film-noir illustration, absolutely no people, no text" },
  { id: 15391, seed: 822, prompt: "crackling blue electric sparks dancing on wet pavement in a dark abandoned city alley, gritty urban sci-fi illustration, absolutely no people, no text" },
  { id: 16662, seed: 256, prompt: "an ornate jeweled hairpin inside an open lacquered treasure box in a moonlit chinese palace hall, lavish cinematic oil painting, absolutely no people, no text" },
  { id: 9236, seed: 618, prompt: "a lonely western-style mansion on a hill under a huge full moon with a faint magic circle in the night sky, 1980s retro anime cel style, absolutely no people, no text" },
  { id: 17864, seed: 612, prompt: "a close-up of a sparkling translucent ice brick wall with spring flowers growing at its base, macro pastel watercolor, absolutely no people, no figures, no text, no letters" },
  { id: 17097, seed: 704, prompt: "a glowing enchanted sword surrounded by floating sparkling upgrade runes on a quiet countryside road, bright rpg game illustration, absolutely no people, no text" },
  { id: 10258, seed: 133, prompt: "a legendary sword lying on a forest floor scattered with little paw prints, glowing soft blue light, fantasy anime background art, absolutely no people, no animals, no text" },
  { id: 17077, seed: 541, prompt: "a fragile lace parasol and a cracked iron war gauntlet resting side by side on a palace balcony, rococo meets martial arts ink illustration, absolutely no people, no text" },
  { id: 17298, seed: 289, prompt: "a salt shaker and a sugar cube sitting side by side on a cafe counter beside a heart-shaped latte, cute flat illustration, absolutely no people, no text" },
  { id: 14998, seed: 866, prompt: "a glowing magical monocle lens examining a jeweled noble crest on a velvet desk, luxurious fantasy illustration, absolutely no people, no text" },
  { id: 14903, seed: 427, prompt: "a cracked sparkly magic wand lying on a dark chessboard beside a softly glowing smartphone, dark pastel magical-girl illustration, absolutely no people, no text" },
  { id: 16284, seed: 950, prompt: "a fiery bee-shaped brooch resting on a long crimson stone stairway, bold minimalist graphic art with flat colors, absolutely no people, no text" },
  { id: 12849, seed: 377, prompt: "an empty ornate birdcage on a tidy office desk next to a faintly glowing magic circle, quirky slice-of-life fantasy illustration, absolutely no people, no text" },
  { id: 16563, seed: 612, prompt: "a dropped glowing smartphone lying on a wet empty city street in dense fog with an abandoned skateboard nearby, eerie comedic illustration, absolutely no people, no figures, no text, no letters" },
  { id: 17359, seed: 238, prompt: "a dusty cowboy hat and a spinning steel ball resting on a rock in a vast empty american desert at sunset, bold dramatic comic art with saturated colors, no animals, absolutely no people, no figures, no text, no letters" },
  { id: 13592, seed: 784, prompt: "three glowing gemstones of red, blue and green floating above a mystical floating island in the sky, 90s shoujo fantasy illustration, absolutely no people, no text" },
  { id: 15600, seed: 451, prompt: "a holy glowing staff leaning against a wooden weapon rack beside a neatly folded plain wool cloak on a bench, soft fantasy watercolor, absolutely no people, no figures, no text, no letters" },
  { id: 16602, seed: 196, prompt: "a cozy wooden dormitory beside a rural train station with a red local train passing, cheerful pastel illustration, absolutely no people, no text" },
  { id: 17089, seed: 533, prompt: "a pink love potion bottle glowing on a witch's cluttered herb table, romantic storybook illustration, absolutely no people, no text" },
  { id: 17367, seed: 668, prompt: "a plain clear glass soda bottle with a blue glass marble inside, standing on a sunny school rooftop railing under a blue summer sky, crisp anime background art, no label, absolutely no people, no figures, no text, no letters" },
  { id: 17539, seed: 302, prompt: "a pointed witch hat and a broom resting on a beginner's spellbook with a golden aura, bright fantasy illustration, absolutely no people, no text" },
  { id: 12473, seed: 841, prompt: "a sleek orbital space station above a desert earth with glowing data streams, cel-shaded 3d sci-fi illustration, absolutely no people, no text" },
  { id: 14032, seed: 159, prompt: "a glowing chrome cybernetic arm lying on a metal workbench in a dark garage lit by magenta and cyan lights, vivid cyberpunk comic illustration, no signs, absolutely no people, no figures, no text, no letters" },
  { id: 11196, seed: 497, prompt: "an old treasure map and a magic compass on a desk in a magic academy library, colorful game art, absolutely no people, no text" },
  { id: 17108, seed: 725, prompt: "a lone lighthouse on a distant island seen across a calm turquoise sea at dawn, nostalgic watercolor, absolutely no people, no text" },
  { id: 16852, seed: 384, prompt: "a ringing vintage rotary telephone resting on cracked ground in a desolate ruined wasteland under a strange swirling sky, gritty dystopian illustration, absolutely no people, no figures, no text, no letters" },
  { id: 13286, seed: 916, prompt: "three customized motorcycles parked under a tokyo highway at night, gritty manga-style ink illustration, empty scene, absolutely no riders, no people, no text" },
  { id: 17314, seed: 271, prompt: "a giant mecha robot standing on a futuristic launch pad at sunset, retro mecha poster art, absolutely no people, no text" },
  { id: 17026, seed: 281, prompt: "fireflies glowing over a dark calm river with a single small paper lantern floating on the water, taisho-era romantic painting, absolutely no people, no figures, no text, no letters" },
  { id: 16708, seed: 143, prompt: "gold coins and glowing crystals spilling from an open wizard's ledger with blank pages, comedic fantasy illustration, absolutely no people, no figures, no text, no letters" },
  { id: 15285, seed: 579, prompt: "a sleek mercenary spaceship docked at a space station overlooking a cozy planet dotted with small houses, space-opera illustration, absolutely no people, no text" },
  { id: 16716, seed: 806, prompt: "a vintage tank parked in a snowy field with a teacup resting on its hatch, detailed military diorama illustration, absolutely no people, no text" },
  { id: 17365, seed: 322, prompt: "a steam locomotive racing through a snowy hokkaido forest with a golden glint in the smoke, dramatic japanese woodblock print, absolutely no people, no text" },
  { id: 17586, seed: 467, prompt: "a sword made of shimmering ice crystals floating above a frozen academy courtyard, cold blue fantasy digital painting, absolutely no people, no text" },
  { id: 13957, seed: 698, prompt: "a battle standard flag and a jeweled tiara on a medieval war table map, classical oil painting, absolutely no people, no text" },
  { id: 16635, seed: 251, prompt: "a shiny bicycle bell and a police whistle on an empty sidewalk with dramatic manga speed lines, comedic manga style, no signs, absolutely no people, no figures, no text, no letters" },
  { id: 15978, seed: 934, prompt: "a soccer ball on a pristine green pitch under stadium lights with a blue goal net, dynamic sports illustration, absolutely no people, no text" },
  { id: 16906, seed: 186, prompt: "an ominous dark throne in a ruined fantasy castle glowing with violet wings of light, epic jrpg boss arena concept art, absolutely no people, no text" },
  { id: 17813, seed: 543, prompt: "two matching sparkly magic compacts shaped like a heart and a star on a pastel vanity, cute magical girl illustration, absolutely no people, no text" },
  { id: 15574, seed: 772, prompt: "a lakeside fortress castle under a night sky filled with countless star-shaped lanterns, classic jrpg painted illustration, absolutely no people, no text" },
  { id: 17229, seed: 315, prompt: "a tiny green wooden club and a glowing question mark lantern in a dungeon cave, humorous fantasy illustration, absolutely no people, no creatures, no text" },
  { id: 17344, seed: 609, prompt: "a steaming kettle and a splash of cold water in a chinese martial arts dojo courtyard, retro 80s anime background art, absolutely no people, no animals, no text" },
  { id: 16454, seed: 488, prompt: "a grand pipe organ in an empty gothic theater with black roses lying on the organ bench, dawn light, no audience, dark elegant illustration, absolutely no people, no figures, no text, no letters" },
  { id: 16294, seed: 861, prompt: "a surreal melting carnival mask on a checkered floor, unsettling art-nouveau grotesque illustration, absolutely no people, no text" },
  { id: 17850, seed: 227, prompt: "a cherry blossom tree at night over a traditional japanese mansion with hidden spy gadgets on the porch, stylish action illustration, absolutely no people, no text" },
  { id: 17025, seed: 694, prompt: "a tiny empty shrine altar holding a single offering coin in a vast fantasy temple, humorous light fantasy illustration, absolutely no people, no text" },
  { id: 15872, seed: 408, prompt: "a pair of ornate lacquered hair combs and a cherry blossom resting on taisho-era kimono fabric, delicate romantic watercolor, absolutely no people, no text" },
  { id: 16942, seed: 975, prompt: "the towering kegon waterfall in nikko under a blood-red moon, dark japanese sumi ink painting with red accents, absolutely no people, no text" },
  { id: 16912, seed: 136, prompt: "a small toy spaceship and a military star badge on a low table in a tatami room, playful retro cartoon, absolutely no people, no creatures, no text" },
  { id: 16796, seed: 527, prompt: "a glowing demonic crest emblem etched onto a futuristic VR headset on a dark desk, tech-horror illustration, absolutely no people, no text" },
  { id: 16646, seed: 362, prompt: "a pair of dice and an engagement ring on a velvet card table in an aristocratic salon, elegant romantic illustration, absolutely no people, no text" },
  { id: 17818, seed: 748, prompt: "a glowing tree sprouting from cracked stone in a dim street under a perpetually dark sky, melancholic dark fantasy painting, absolutely no people, no text" },
  { id: 16301, seed: 205, prompt: "a black five-leaf clover glowing above a stone castle on a stormy evening, bold shonen fantasy illustration, absolutely no people, no text" },
  { id: 17295, seed: 691, prompt: "an armored wheelchair with tank treads standing on an industrial city street, gritty action comic illustration, absolutely no people, no text" },
  { id: 17851, seed: 434, prompt: "a cute toy tank decorated with heart stickers on a pastel school desk, chibi cartoon illustration, absolutely no people, no text" },
  { id: 12204, seed: 853, prompt: "a glowing portal tower piercing the clouds above a magic academy, sleek fantasy digital art, absolutely no people, no text" },
  { id: 17132, seed: 298, prompt: "a purple summoning circle glowing on the floor of a cozy dorm room with a romance novel on the bed, comedic dark fantasy illustration, absolutely no people, no text" },
  { id: 17636, seed: 617, prompt: "a giant golden beast-shaped super robot head on a launch platform, 70s super robot anime poster style, absolutely no people, no text" },
  { id: 17635, seed: 166, prompt: "a heavy blacksmith hammer resting on an anvil beside a glowing hot sword blade in an empty forge with floating sparks, vivid korean webtoon style, no hands, absolutely no people, no figures, no text, no letters" },
  { id: 17547, seed: 583, prompt: "a pair of wired earphones and an old music player lying on an empty park bench covered with autumn leaves, close-up, quiet romantic slice-of-life illustration, absolutely no people, no figures, no text, no letters" },
  { id: 17068, seed: 534, prompt: "a plain glass dish of caramel pudding on a purple velvet cushion under swirling cosmic galaxies, colorful illustration, no creatures, absolutely no people, no figures, no text, no letters" },
  { id: 17600, seed: 352, prompt: "a frost-covered silver ring on the snowy windowsill of a quiet japanese house, gentle winter watercolor, absolutely no people, no text" },
  { id: 17627, seed: 786, prompt: "seven different knightly shields leaning against a horse-chestnut tree in a sunny kingdom, storybook illustration, absolutely no people, no text" },
  { id: 16593, seed: 247, prompt: "an elegant hotel reception bell and brass room keys on a marble counter beside a hidden pistol, stylish noir illustration, absolutely no people, no text" },
  { id: 16703, seed: 636, prompt: "a cute fluffy plush toy peeking out of a leather business briefcase on an office desk, warm comedic illustration, absolutely no people, no text" },
  { id: 17071, seed: 172, prompt: "a giant white computer mouse cursor arrow floating over a sunny town street, playful flat vector illustration, absolutely no people, no text" },
  { id: 17297, seed: 509, prompt: "a glowing portal opening above an otherworldly forest with a dropped schoolbag on the grass, 90s shoujo fantasy watercolor, absolutely no people, no text" },
  { id: 16806, seed: 882, prompt: "a dusty glass display case of creepy curiosities in a dark antique shop, eerie gothic illustration, absolutely no people, no text" },
  { id: 17039, seed: 318, prompt: "a battered grey armored mech standing in the haze of a desert battlefield, gritty 80s real-robot anime art, absolutely no people, no text" },
  { id: 13731, seed: 659, prompt: "a sinister black biomechanical engine glowing red in a dark factory, dark sci-fi concept art, absolutely no people, no text" },
  { id: 16295, seed: 438, prompt: "a vermilion lacquered mask resting on a dark stage floor under a single spotlight, dramatic theatrical illustration, absolutely no people, no text" },
  { id: 17589, seed: 767, prompt: "a pink hair clip left on an empty school desk at sunset, bittersweet soft illustration, warm orange light, absolutely no people, no text" },
  { id: 16570, seed: 225, prompt: "a tennis racket and ball on a world cup stadium court with colorful flags, dynamic sports manga illustration, absolutely no people, no text" },
  { id: 17316, seed: 594, prompt: "a witch's broom leaning against a small flower shop in a cozy japanese provincial town, bright idol pop illustration, absolutely no people, no text" },
  { id: 17556, seed: 381, prompt: "a cracked holy chalice with dripping crimson candle wax on a cathedral altar, dark gothic illustration, absolutely no people, no text" },
  { id: 18218, seed: 846, prompt: "a pair of blue legendary daggers crossed over a blank weathered parchment, epic fantasy illustration, absolutely no people, no figures, no text, no letters" },
  { id: 17853, seed: 153, prompt: "a baseball resting on the pitcher's mound of a diamond-shaped field at golden hour, dramatic sports illustration, absolutely no people, no text" },
  { id: 16335, seed: 672, prompt: "a basket of freshly baked bread loaves with one loaf missing, cozy children's picture-book illustration, absolutely no people, no animals, no text" },
  { id: 18106, seed: 419, prompt: "a lucky golden horseshoe resting on a soft pastel racetrack lawn with tiny flags, soft cute chibi illustration, no animals, absolutely no people, no figures, no text, no letters" },
  { id: 17935, seed: 958, prompt: "a tiny cushioned pet bed under a red palace pavilion in a quiet empty courtyard, chinese gongbi painting, no signs, no animals, absolutely no people, no figures, no text, no letters" },
  { id: 15716, seed: 287, prompt: "glowing trading cards swirling in a storm above a floating sky island, vivid card-game fantasy art, absolutely no people, no text" },
  { id: 17942, seed: 646, prompt: "a floating dreamlike amusement park among pastel clouds at twilight, surreal dreamy illustration, absolutely no people, no text" },
  { id: 17352, seed: 132, prompt: "a single green leaf and an acorn on a mossy forest stump with two tiny trails of footprints, cute picture-book illustration, absolutely no people, no animals, no text" },
  { id: 14745, seed: 503, prompt: "a brass lion-head door knocker on an old wooden academy door glowing in golden savannah sunset light, close-up, rich fantasy painting, absolutely no people, no figures, no text, no letters" },
  { id: 17136, seed: 761, prompt: "an ancient chinese capital rooftop skyline at night with paper lanterns floating in the sky, empty streets, chinese ink painting, absolutely no people, no figures, no text, no letters" },
  { id: 17329, seed: 344, prompt: "a fluffy white cushion with a blue sailor ribbon on a seaside wooden deck, soft kawaii illustration, absolutely no people, no animals, no text" },
  { id: 18233, seed: 896, prompt: "two star-shaped hair pins resting on opposite ends of a pastel bridge, cute magical illustration, absolutely no people, no text" },
  { id: 17356, seed: 221, prompt: "a large plain paper kite with no markings flying in strong wind over kyoto rooftops at dawn, dynamic historical illustration, absolutely no people, no figures, no text, no letters" },
  { id: 18102, seed: 627, prompt: "a single cracked trading card and a gavel in a dark courtroom with dramatic light, dark card-game illustration, absolutely no people, no text" },
  { id: 12433, seed: 456, prompt: "an old brass naval compass and anchor drifting in deep space among stars and nebulae, classic 70s space-opera painting, absolutely no people, no text" },
  { id: 18059, seed: 192, prompt: "a tiny knitted red vest hanging on a wooden peg, simple children's picture-book illustration, absolutely no people, no animals, no text" },
  { id: 18237, seed: 813, prompt: "a peach blossom branch with crimson petals falling under a dark sky, dramatic japanese ink illustration, absolutely no people, no text" },
  { id: 18152, seed: 364, prompt: "a tiny glowing purple circle of stars drawn on a notebook page next to a pencil, cute mini sketch style, absolutely no people, no figures, no text, no letters" },
  { id: 18208, seed: 739, prompt: "a bamboo steamer full of dumplings and a red paper lantern on a wooden table, close-up, cozy flat illustration, plain background, absolutely no people, no figures, no text, no letters" },
  { id: 18281, seed: 268, prompt: "a small herbal medicine pouch and a cup of tea on a palace windowsill, cute chibi gouache, absolutely no people, no animals, no text" },
  { id: 17803, seed: 584, prompt: "a soft illustrated encyclopedia opened to doodles of round cute shapes, gentle crayon illustration, absolutely no people, no text" },
  { id: 17997, seed: 911, prompt: "an adventurer's backpack, compass and treasure map on a hilltop at sunrise, bright adventure poster art, absolutely no people, no text" },
  { id: 18000, seed: 247, prompt: "a cozy japanese family living room with scattered toys and a kotatsu table, warm flat illustration, absolutely no people, no text" },
  { id: 17180, seed: 655, prompt: "a spooky glowing jack-o-lantern in a moonlit pumpkin patch beside a farm fence, claymation style, absolutely no people, no animals, no text" },
  { id: 17698, seed: 398, prompt: "a vintage red sports car parked on an empty moonlit cobblestone bridge with banknotes fluttering in the air, stylish 70s heist illustration, no signs, absolutely no people, no figures, no text, no letters" },
  { id: 18277, seed: 726, prompt: "a tiny chibi coffee cup with a little heart doodle, cute mini sketch style, pastel background, absolutely no people, no text" },
  { id: 17168, seed: 117, prompt: "colorful soap bubbles popping over a tiny toy town with confetti, playful 3d cartoon, absolutely no people, no creatures, no text" },
  { id: 17785, seed: 539, prompt: "a small wooden magic wand glowing on an open storybook in an attic bedroom, whimsical european animation style, absolutely no people, no text" },
  { id: 18217, seed: 873, prompt: "a small glowing toy robot on a windowsill under a starry night sky, gentle soft illustration, absolutely no people, no text" },
  { id: 18160, seed: 336, prompt: "a tiny chaotic toy city of crooked buildings with chocolate-colored roofs seen from above, empty streets, quirky doodle illustration, absolutely no people, no figures, no text, no letters" },
  { id: 17983, seed: 482, prompt: "a hawaiian beach at sunset with a ukulele and a scratched surfboard, tropical illustration, absolutely no people, no creatures, no text" },
  { id: 18197, seed: 695, prompt: "a single rose and a chess knight piece resting on a sealed velvet letter, elegant still life painting, absolutely no people, no text" },
  { id: 17433, seed: 254, prompt: "a glowing card deck beneath a starry constellation of fate, dynamic card-game fantasy art, absolutely no people, no text" },
  { id: 18128, seed: 617, prompt: "a little green sprout pushing through cracked asphalt under bright sunshine, cheerful encouraging cartoon, absolutely no people, no text" },
  { id: 18207, seed: 348, prompt: "a miniature dollhouse with colorful rainbow furniture in a sunny garden, soft toy-photography illustration, absolutely no people, no animals, no text" },
  { id: 18263, seed: 783, prompt: "a witch's hat overflowing with candy and confetti instead of spells, zany comedic illustration, absolutely no people, no text" },
  { id: 18192, seed: 165, prompt: "a tiny leather biker jacket and a sunflower seed beside a hamster wheel, comedic cute illustration, absolutely no people, no animals, no text" },
  { id: 18221, seed: 477, prompt: "sparkling jewels spilling from an open steel safe onto dark velvet in moonlight, close-up, stylish heist illustration, absolutely no people, no figures, no text, no letters" },
  { id: 18267, seed: 431, prompt: "tiny sparkling heart charms and ribbons floating on a pastel cloud, cute kawaii illustration, absolutely no people, no creatures, no text" },
  { id: 17862, seed: 568, prompt: "a giant shiny metal fishing lure shaped like a fish with robotic joints glowing under a calm lake surface, energetic illustration, no robots, absolutely no people, no figures, no text, no letters" },
  { id: 18058, seed: 214, prompt: "a vintage typewriter on a round cafe table with a lavender sprig in a sunlit empty provence courtyard, close-up, french watercolor, absolutely no people, no figures, no text, no letters" },
  { id: 18270, seed: 657, prompt: "a sparkling crown floating among pink nebulae and planets, vibrant retro space pop art, absolutely no people, no text" },
  { id: 18283, seed: 389, prompt: "a glowing teardrop gemstone hovering over a twilight city skyline with stars, magical fantasy illustration, absolutely no people, no text" },
  { id: 17358, seed: 742, prompt: "squishy colorful jelly blobs bouncing on a toy table, cute 3d cartoon, absolutely no people, no faces, no text" },
  { id: 18278, seed: 296, prompt: "a tiny chibi battle flag planted on a sandcastle, cute mini comic style, absolutely no people, no text" },
  { id: 17363, seed: 851, prompt: "a glass slipper and a red apple on a tiny storybook stage, chibi fairy-tale illustration, absolutely no people, no text" },
  { id: 18223, seed: 437, prompt: "a glowing moss-covered coffee shop interior lit by warm lamps, cozy fantasy illustration, absolutely no people, no text" },
  { id: 18205, seed: 168, prompt: "a whirlpool of magenta flower petals swirling over a calm garden pond, decorative pop illustration, absolutely no people, no text" },
  { id: 16282, seed: 603, prompt: "a tall red and white striped top hat resting on a cozy armchair on a rainy day, whimsical storybook illustration, absolutely no people, no animals, no text" },
  { id: 18222, seed: 924, prompt: "an elegant parisian salon with an antique globe and perfume bottles, refined art deco illustration, absolutely no people, no text" },
  { id: 18210, seed: 376, prompt: "a glowing pumpkin carriage lantern in front of a fairy-tale castle at midnight, dreamy storybook illustration, absolutely no people, no text" },
  { id: 18290, seed: 512, prompt: "a feather duster leaning beside a half-open palace door with light spilling through the keyhole, comedic cartoon, absolutely no people, no text" },
  { id: 18196, seed: 785, prompt: "a colorful toy rescue vehicle on a cinema stage with confetti, bright kids 3d animation style, absolutely no people, no faces, no text" },
  { id: 18292, seed: 664, prompt: "a generic metal spinning top whirling with bright sparks in a round toy battle arena, dynamic toy-battle illustration, absolutely no people, no figures, no text, no letters" },
  { id: 18291, seed: 243, prompt: "a pile of peaches with tiny horns on a cute picnic blanket, kawaii chibi illustration, absolutely no people, no faces, no text" },
];

// 生成元が返すのはPNG/JPEG。そのまま置くと1枚40KB以上になり、スマホの初期表示で
// 数枚ぶんの帯域（実測: トップページで152KB）を装飾画像に取られる。同じ寸法のまま
// WebPに変換すると実測で39%小さくなり、**見た目は変わらない**（2026-09-04）。
// sharpはこのリポジトリの依存に入れていない（Vercelのビルドに載せたくない）ので、
// 生成するときだけ `npm install --no-save sharp` を先に実行する。
function loadSharp() {
  try {
    return require("sharp");
  } catch {
    console.error(
      "sharp が見つからない。先に `npm install --no-save sharp` を実行すること\n" +
        "（依存には入れない＝本番ビルドを重くしないため。詳細は CLAUDE.md）。"
    );
    process.exit(1);
  }
}

const HORDE = "https://aihorde.net/api/v2";
const HORDE_HEADERS = {
  "Content-Type": "application/json",
  apikey: "0000000000", // 匿名キー（AI Hordeが公開している共通キー。秘密ではない）
  "Client-Agent": "animedia-thumbnails:2.0:https://animedia-khaki.vercel.app",
};
const MODEL = "Flux.1-Schnell fp8 (Compact)";
// 共有のボランティア資源なので控えめにする（実測: 匿名で1枚12分）。
const CONCURRENCY = 3;
// これを過ぎても終わらない依頼は取り消して失敗扱いにする（次回の実行で再挑戦される）。
const JOB_TIMEOUT_MS = 60 * 60 * 1000;
const POLL_MS = 20 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function hordeJson(method, url, body) {
  // 一時的な失敗（429・5xx・通信断）だけ指数バックオフで再試行する。
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers: HORDE_HEADERS,
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) return json;
      const transient = res.status === 429 || res.status >= 500;
      if (!transient || attempt >= 5) throw new Error(`${res.status} ${json.message ?? ""}`);
    } catch (e) {
      if (attempt >= 5 || /^\d{3} /.test(e.message)) throw e;
    }
    await sleep(Math.min(5000 * 2 ** attempt, 120000));
  }
}

async function genOne(sharp, { id, prompt, seed }) {
  const file = path.join(OUT_DIR, `${id}.webp`);
  const t0 = Date.now();
  let jobId;
  try {
    // FLUXは64の倍数を要求するので 640×384 で作り、上下を12pxずつ切って 640×360 にする。
    const sub = await hordeJson("POST", `${HORDE}/generate/async`, {
      prompt,
      models: [MODEL],
      nsfw: false,
      censor_nsfw: true,
      params: { width: 640, height: 384, steps: 4, cfg_scale: 1, sampler_name: "k_euler", seed: String(seed), n: 1 },
    });
    jobId = sub.id;
    if (!jobId) throw new Error(`依頼IDが返らない: ${JSON.stringify(sub)}`);
    for (;;) {
      await sleep(POLL_MS);
      const c = await hordeJson("GET", `${HORDE}/generate/check/${jobId}`);
      // is_possible:false は「いまこのモデルを動かしているワーカーが居ない」だけで、依頼は列に残り
      // ワーカーが戻れば処理される。即失敗にすると、ワーカーが数十分抜けただけで残り全部を
      // 取りこぼす（2026-10-10の初回実行で135件中42件がこれで落ちた）。時間切れまで待つ。
      if (c.faulted) throw new Error("生成側で失敗（faulted）");
      if (c.done) break;
      if (Date.now() - t0 > JOB_TIMEOUT_MS) throw new Error("時間切れ");
    }
    const st = await hordeJson("GET", `${HORDE}/generate/status/${jobId}`);
    jobId = undefined; // 取り出したら取り消し不要
    const g = st.generations?.[0];
    if (!g?.img) throw new Error("画像が返らない");
    // 検閲に掛かった画像は警告画像に差し替えられて返る＝使えない。
    if (g.censored) throw new Error("検閲で差し替えられた");
    const res = await fetch(g.img);
    if (!res.ok) throw new Error(`画像の取得 ${res.status}`);
    const buf = await sharp(Buffer.from(await res.arrayBuffer()))
      .resize(640, 360, { fit: "cover" })
      .webp({ quality: 78, effort: 6 })
      .toBuffer();
    if (buf.length < 1000) throw new Error("画像が小さすぎる");
    fs.writeFileSync(file, buf);
    console.log(`  ✓ ${id}: ${(buf.length / 1024).toFixed(0)}KB（${Math.round((Date.now() - t0) / 60000)}分）`);
    return true;
  } catch (e) {
    console.log(`  ✗ ${id}: ${e.message}`);
    if (jobId) await hordeJson("DELETE", `${HORDE}/generate/status/${jobId}`).catch(() => {});
    return false;
  }
}

async function main() {
  const sharp = loadSharp();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const only = process.argv.slice(2).map(Number).filter((n) => Number.isInteger(n));
  const unknown = only.filter((id) => !PROMPTS.some((p) => p.id === id));
  if (unknown.length) {
    console.error(`PROMPTS に無い作品ID: ${unknown.join(", ")}`);
    process.exit(1);
  }
  const targets = only.length
    ? PROMPTS.filter((p) => only.includes(p.id))
    : PROMPTS.filter((p) => !fs.existsSync(path.join(OUT_DIR, `${p.id}.webp`)));
  console.log(`生成開始（${targets.length}件 / 定義${PROMPTS.length}件）…`);
  let failed = 0;
  const queue = [...targets];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let p; (p = queue.shift()); ) {
        if (!(await genOne(sharp, p))) failed++;
      }
    })
  );
  if (failed) console.log(`失敗 ${failed}件（もう一度実行すると失敗分だけ生成する）`);
  // public/works にある画像IDを走査して manifest を更新する。
  const ids = fs
    .readdirSync(OUT_DIR)
    .filter((f) => f.endsWith(".webp"))
    .map((f) => Number(f.replace(".webp", "")))
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b);
  const body =
    "// 自動生成（scripts/gen-thumbnails.js）。AI独断解釈サムネ（public/works/{id}.webp）が\n" +
    "// 存在する作品IDの一覧。カード・作品ページはこの集合で画像の有無を判定する。\n" +
    `export const WORK_IMAGE_IDS = new Set<number>([${ids.join(", ")}]);\n`;
  fs.writeFileSync(MANIFEST, body);
  console.log(`manifest更新: ${ids.length}件 → ${MANIFEST}`);
}

main();

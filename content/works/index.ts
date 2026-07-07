// 作品ごとに人力で用意する補足コンテンツ（あらすじ・見どころ・出版社）の一覧。
// Annict に構造化データが無いため、公式サイト等の一次情報を確認しながら
// content/works/{annictId}.json を1作品1ファイルで追加し、ここに1行ずつ登録する。
// 未登録の作品IDは WORK_DETAILS に存在しない＝表示側で単純に省略する
// （「配信情報なし」と同じ方針。推測では埋めない）。
import type { WorkDetailContent } from "@/lib/types";

export const WORK_DETAILS: Record<number, WorkDetailContent> = {
  // 例: 13010: require("./13010.json"),
};

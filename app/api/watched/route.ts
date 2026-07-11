// ログインユーザーの「視聴済み」作品ID一覧の取得・追加・削除。
// お気に入り（localStorageのみ・ログイン不要）とは別機能。
// 認可はSupabaseの行レベルセキュリティ（RLS、public.watchedテーブル）に委ねており、
// このルート自身はセッションCookie経由のユーザーIDでフィルタするだけで、
// 他ユーザーの行を読み書きできないことをRLS側が保証する。
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export async function GET() {
  // Supabase未設定（外部セットアップ未完了）の間は未ログインと同じ扱いにする。
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ workIds: [] });
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 未ログイン時は匿名閲覧を壊さないよう、エラーではなく空配列を返す。
  if (!user) {
    return NextResponse.json({ workIds: [] });
  }

  const { data, error } = await supabase.from("watched").select("work_id").eq("user_id", user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ workIds: data.map((row) => row.work_id) });
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "ログイン機能は準備中です。" }, { status: 503 });
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  }

  const { workId } = await request.json();
  if (typeof workId !== "number") {
    return NextResponse.json({ error: "workIdが不正です。" }, { status: 400 });
  }

  const { error } = await supabase.from("watched").insert({ user_id: user.id, work_id: workId });
  // 23505 = unique_violation。既に登録済みなら冪等に成功扱いにする
  // （RLSはinsert/select/deleteのみ許可しており、upsert相当のupdate経路は使わない）。
  if (error && error.code !== "23505") {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "ログイン機能は準備中です。" }, { status: 503 });
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  }

  const { workId } = await request.json();
  if (typeof workId !== "number") {
    return NextResponse.json({ error: "workIdが不正です。" }, { status: 400 });
  }

  const { error } = await supabase
    .from("watched")
    .delete()
    .eq("user_id", user.id)
    .eq("work_id", workId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

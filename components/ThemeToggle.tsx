"use client";

import { useEffect, useState } from "react";

const THEME_KEY = "anime-haishin:theme";

// ダーク（既定・SAOテイスト）とライトを切り替える。選択は localStorage に保存し、
// app/layout.tsx のインラインスクリプトが次回訪問時に <html data-theme="light"> を
// 描画前に付け直すことで、切り替えたテーマがちらつかずに反映される。
export default function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
    setTheme(current);
  }, []);

  function toggle() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    if (next === "light") {
      document.documentElement.setAttribute("data-theme", "light");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // 保存できなくても切り替え自体は機能させる
    }
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      aria-pressed={theme === "light"}
      onClick={toggle}
    >
      {theme === "light" ? "LIGHT" : "DARK"}
    </button>
  );
}

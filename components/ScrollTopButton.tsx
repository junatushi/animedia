"use client";

import { useEffect, useState } from "react";

// ある程度スクロールしたら現れ、押すと最上部へなめらかに戻るボタン。
// 長い一覧を下まで見たあと、シーズン/検索の操作パネルへ素早く戻れるようにする。
export default function ScrollTopButton() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 480);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function toTop() {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  }

  return (
    <button
      type="button"
      className="scroll-top"
      data-show={show}
      onClick={toTop}
      aria-label="ページ上部へ戻る"
      title="上部へ戻る"
    >
      <span className="scroll-top-arrow" aria-hidden="true" />
    </button>
  );
}

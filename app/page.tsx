"use client";

import { Suspense } from "react";
import SeasonExplorer from "@/components/SeasonExplorer";

// useSearchParams を使うコンポーネントは Suspense 境界の内側に置く必要がある
// （Next.js App Router の要件）。
export default function Page() {
  return (
    <Suspense fallback={<div className="wrap" />}>
      <SeasonExplorer />
    </Suspense>
  );
}

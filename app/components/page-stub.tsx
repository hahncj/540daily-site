import type { ReactNode } from "react";

/** Placeholder body for a page a later stage builds. Honest about what is not built yet. */
export function PageStub({ title, lane, children }: { title: string; lane: string; children?: ReactNode }) {
  return (
    <section aria-labelledby="page-title">
      <h1 id="page-title">{title}</h1>
      {children}
      <p className="notice muted">This page is not built yet. It arrives in {lane}.</p>
    </section>
  );
}

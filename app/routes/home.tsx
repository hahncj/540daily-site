import type { Route } from "./+types/home";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "540 Daily" },
    { name: "description", content: "News and research, organized by category." },
  ];
}

// The public category dashboard is built in lane 2B on top of the Stage 1 core.
export default function Home() {
  return (
    <section aria-labelledby="page-title">
      <h1 id="page-title">540 Daily</h1>
      <p className="notice muted">No stories have been published yet. Category panels appear here once they are.</p>
    </section>
  );
}

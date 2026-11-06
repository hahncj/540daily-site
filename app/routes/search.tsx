import { PageStub } from "../components/page-stub";
import type { Route } from "./+types/search";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Search · 540 Daily" }];
}

export default function Search() {
  return (
    <PageStub title="Search" lane="lane 2B (public reading)">
      <p className="muted">Date filters use the app publication date, in America/Chicago time.</p>
    </PageStub>
  );
}

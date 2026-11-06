import { PageStub } from "../components/page-stub";
import type { Route } from "./+types/categories";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Categories · 540 Daily" }];
}

export default function Categories() {
  return <PageStub title="Categories" lane="lane 2B (public reading)" />;
}

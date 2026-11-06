import { PageStub } from "../components/page-stub";
import type { Route } from "./+types/category";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Category · 540 News" }];
}

export default function Category({ params }: Route.ComponentProps) {
  return <PageStub title={`Category: ${params.slug}`} lane="lane 2B (public reading)" />;
}

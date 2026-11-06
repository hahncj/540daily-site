import { requireRolePage } from "../access.server";
import { PageStub } from "../components/page-stub";
import { servicesContext } from "../context";
import type { Route } from "./+types/saved";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Saved · 540 Daily" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  await requireRolePage(request, context.get(servicesContext), "reader");
  return null;
}

export default function Saved() {
  return <PageStub title="Saved" lane="lane 3B (reader features)" />;
}

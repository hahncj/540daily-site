import { requireRolePage } from "../access.server";
import { PageStub } from "../components/page-stub";
import { servicesContext } from "../context";
import type { Route } from "./+types/owner";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Owner · 540 Daily" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  await requireRolePage(request, context.get(servicesContext), "owner");
  return null;
}

export default function Owner() {
  return <PageStub title="Owner" lane="lane 3A (account and owner console)" />;
}

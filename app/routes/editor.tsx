import { requireRolePage } from "../access.server";
import { PageStub } from "../components/page-stub";
import { servicesContext } from "../context";
import type { Route } from "./+types/editor";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Editor · 540 Daily" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  await requireRolePage(request, context.get(servicesContext), "editor");
  return null;
}

export default function Editor() {
  return <PageStub title="Editor" lane="lane 2C (editor workspace)" />;
}

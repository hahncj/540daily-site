import { requireRolePage } from "../access.server";
import { PageStub } from "../components/page-stub";
import { servicesContext } from "../context";
import type { Route } from "./+types/account";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Account · 540 Daily" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const viewer = await requireRolePage(request, context.get(servicesContext), "reader");
  return { email: viewer.email, role: viewer.role };
}

export default function Account({ loaderData }: Route.ComponentProps) {
  return (
    <PageStub title="Account" lane="lane 3A (account and owner console)">
      <p>
        Signed in as <strong>{loaderData.email}</strong> ({loaderData.role}).
      </p>
    </PageStub>
  );
}

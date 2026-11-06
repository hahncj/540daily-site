import { PageStub } from "../components/page-stub";
import type { Route } from "./+types/consent";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Connect an agent · 540 News" }];
}

// The MCP OAuth consent screen is built in lane 2A.
export default function Consent() {
  return <PageStub title="Connect an agent" lane="lane 2A (agent interfaces)" />;
}

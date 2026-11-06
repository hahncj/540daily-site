import type { Route } from "./+types/publication";

// Publication detail is built in lane 2B. Until then, no publication exists, so every ID is "not found".
export async function loader(_: Route.LoaderArgs) {
  throw new Response("Not found", { status: 404 });
}

export default function Publication() {
  return null;
}

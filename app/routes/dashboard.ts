import { redirect } from "react-router";

/** The personal dashboard is now the home page; its settings live at /settings. Old links still work. */
export function loader() {
  return redirect("/", 301);
}

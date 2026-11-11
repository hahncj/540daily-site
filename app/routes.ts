import { type RouteConfig, index, route } from "@react-router/dev/routes";

// Explicit route table. Every page from REQUIREMENTS.md section 5 is registered here in Stage 0,
// so later lanes fill in their own route files without editing this shared file.
export default [
  index("routes/home.tsx"),
  route("categories", "routes/categories.tsx"),
  route("categories/:slug", "routes/category.tsx"),
  route("publications/:id/:slug?", "routes/publication.tsx"),
  route("search", "routes/search.tsx"),
  route("dashboard", "routes/dashboard.ts"),
  route("settings", "routes/settings.tsx"),
  route("saved", "routes/saved.tsx"),
  route("sign-in", "routes/sign-in.tsx"),
  route("consent", "routes/consent.tsx"),
  route("editor", "routes/editor.tsx"),
  route("editor/new", "routes/editor.new.tsx"),
  route("editor/homepage", "routes/editor.homepage.tsx"),
  route("editor/attachments", "routes/editor.attachments.ts"),
  route("editor/publications/:id", "routes/editor.publication.tsx"),
  route("editor/publications/:id/history", "routes/editor.history.tsx"),
  route("account", "routes/account.tsx"),
  route("owner/*", "routes/owner.tsx"),
  route("sitemap.xml", "routes/sitemap.ts"),
  route("robots.txt", "routes/robots.ts"),
] satisfies RouteConfig;

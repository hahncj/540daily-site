import { Form, Link, redirect, useNavigation } from "react-router";
import { fail } from "../../server/core/result";
import { EditorNav, ErrorNotice, Flash, StatusBadge, Time, editorLinks, NOINDEX_META } from "../components/editor/shared";
import { servicesContext } from "../context";
import type { Route } from "./+types/editor.history";
import { failure, positiveInt, requireEditorPage, requireEditorWrite } from "./editor.server";

export const links = editorLinks;

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: `History${loaderData ? `: ${loaderData.publication.title}` : ""} · Editor · 540 Daily` }, NOINDEX_META];
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const services = context.get(servicesContext);
  const actor = await requireEditorPage(request, services);
  const publication = await services.publications.getForEditor(actor, params.id);
  if (!publication) throw new Response("Publication not found.", { status: 404 });
  const history = await services.publications.history(actor, params.id);
  if (!history.ok) throw new Response(history.message, { status: 404 });

  const search = new URL(request.url).searchParams;
  const wanted = positiveInt(search.get("revision"));
  let selected = null;
  if (wanted) {
    const r = await services.publications.getRevision(actor, params.id, wanted);
    if (r.ok) {
      const c = r.value.content;
      selected = {
        revision: r.value.revision,
        status: r.value.status,
        content: { ...c, sourcePublishedAt: c.sourcePublishedAt?.toISOString().slice(0, 10) ?? null },
        html: await services.publications.renderBody(c),
      };
    }
  }
  const from = positiveInt(search.get("from"));
  return {
    publication: { id: publication.id, title: publication.title, revision: publication.revision, status: publication.status },
    revisions: history.value,
    selected,
    missingRevision: wanted !== null && !selected,
    flash: search.get("done") === "restored" && from ? `Revision ${from} restored as revision ${publication.revision}. Visibility did not change.` : null,
  };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const services = context.get(servicesContext);
  const actor = await requireEditorWrite(request, services);
  const form = await request.formData();
  const revision = positiveInt(form.get("revision"));
  const expectedRevision = positiveInt(form.get("expectedRevision"));
  if (!revision || !expectedRevision) return failure(fail("invalid", "The form is incomplete. Reload the page."), {});
  const result = await services.publications.restoreRevision(actor, params.id, revision, expectedRevision);
  if (!result.ok) return failure(result, {});
  const here = `/editor/publications/${encodeURIComponent(params.id)}/history`;
  throw redirect(`${here}?revision=${result.value.revision}&done=restored&from=${revision}`);
}

export default function History({ loaderData, actionData }: Route.ComponentProps) {
  const { publication: p, revisions, selected } = loaderData;
  const busy = useNavigation().state === "submitting";
  const base = `/editor/publications/${encodeURIComponent(p.id)}`;
  return (
    <section aria-labelledby="page-title" className="editor">
      <EditorNav />
      <h1 id="page-title">History</h1>
      <p>
        <Link to={base}>{p.title}</Link> · now at revision {p.revision} · <StatusBadge status={p.status} />
      </p>
      <Flash message={actionData ? null : loaderData.flash} />
      <ErrorNotice message={actionData && !actionData.ok ? actionData.message : null}>
        {actionData && !actionData.ok && actionData.currentRevision ? <p>The page now shows the latest history.</p> : null}
      </ErrorNotice>
      {loaderData.missingRevision ? <p className="notice notice--error">That revision does not exist.</p> : null}

      <div className="history-layout">
        <section aria-labelledby="revisions-title">
          <h2 id="revisions-title">Revisions</h2>
          <p className="field-hint">Every save and visibility change adds a revision. Restoring adds a new one; nothing is erased.</p>
          <ol className="revision-list" reversed>
            {revisions.map((r) => (
              <li key={r.revision} className={selected?.revision === r.revision ? "is-selected" : undefined}>
                <Link to={`?revision=${r.revision}`} aria-current={selected?.revision === r.revision ? "true" : undefined}>
                  Revision {r.revision}
                </Link>{" "}
                <StatusBadge status={r.status} />
                {r.revision === p.revision ? <span className="muted"> (current)</span> : null}
                <div className="muted">
                  {r.actor.kind === "agent" && r.actor.label ? `${r.actor.name} via ${r.actor.label}` : r.actor.name} · <Time value={r.createdAt} />
                </div>
              </li>
            ))}
          </ol>
        </section>

        {selected ? (
          <section aria-labelledby="revision-title" className="panel revision-view">
            <h2 id="revision-title">Revision {selected.revision}</h2>
            {selected.revision === p.revision ? (
              <p className="muted">This is the current version.</p>
            ) : (
              <Form method="post">
                <input type="hidden" name="revision" value={selected.revision} />
                <input type="hidden" name="expectedRevision" value={p.revision} />
                <button type="submit" className="button button--primary" disabled={busy}>
                  Restore revision {selected.revision}
                </button>
                <p className="field-hint">Restoring copies this content into a new revision. It does not change whether the item is public.</p>
              </Form>
            )}
            <dl className="publication-facts">
              <div>
                <dt>Type</dt>
                <dd>{selected.content.type === "story" ? "Story" : "Report"}</dd>
              </div>
              <div>
                <dt>Category</dt>
                <dd>{selected.content.category}</dd>
              </div>
              <div>
                <dt>Tags</dt>
                <dd>{selected.content.tags.length ? selected.content.tags.join(", ") : "None"}</dd>
              </div>
              <div>
                <dt>Source date</dt>
                <dd>{selected.content.sourcePublishedAt ?? "None"}</dd>
              </div>
            </dl>
            <h3>{selected.content.title}</h3>
            <p>{selected.content.summary}</p>
            {selected.html ? <div className="prose" dangerouslySetInnerHTML={{ __html: selected.html }} /> : <p className="muted">No body.</p>}
            {selected.content.sources.length ? (
              <>
                <h4>Sources</h4>
                <ul>
                  {selected.content.sources.map((s) => (
                    <li key={s.url}>
                      <a href={s.url} rel="nofollow noopener noreferrer ugc">
                        {s.label || s.url}
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>
        ) : (
          <p className="muted">Choose a revision to see its content and restore it.</p>
        )}
      </div>
    </section>
  );
}

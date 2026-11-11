# Operating guide for the owner and editors

How to run 540 Daily day to day. Everything here is done in the browser at `https://540daily.com`. No command line is needed except where marked.

## 1. Roles in one table

| Role | Can do |
| --- | --- |
| Visitor (not signed in) | Read and search everything that is published |
| Reader (invited) | Plus: a personal dashboard, saved items, theme saved to the account, read-only MCP connections |
| Editor | Plus: write, edit, publish, unpublish, restore, see history, set the public homepage, create API keys |
| Owner (one person, from `OWNER_EMAIL`) | Plus: invite people, change roles, disable accounts, revoke anyone's keys and connections, see publishing failures, clean up old uploads |

Agents act as the member who connected them. A reader's agent can only read. An editor's or owner's agent can create stories and update its member's own stories, nothing else.

## 2. Owner tasks (`/owner`)

### Invite someone

1. Enter their exact Google email address and choose **Invite reader**.
2. Copy the sign-in link shown and send it to them yourself (there is no invitation email).
3. They sign in with that Google account. The email must match (capital letters do not matter; Gmail dots and `+` aliases are **not** treated as the same address).

Everyone starts as a reader. Someone who signs in with Google without an invitation is refused.

To cancel an invitation that has not been used, choose **Revoke** next to it.

### Change a role

Pick the new role next to a member and choose **Change role**. The change applies on their next page load or agent call. You cannot remove the last active owner; make someone else owner first.

### Disable an account

Choose **Disable**. Their sessions end at once, and their agents stop at the next call. Public pages stay readable for them like any visitor. **Enable** restores the account. You cannot disable yourself.

### Keys and connections

`/owner` lists every member's API keys and MCP connections. **Revoke** a key or **Disconnect** a client to stop that agent immediately. Members can do the same for their own on `/account`.

### Publishing failures

The **Recent publishing failures** list shows agent creates and updates that failed in the last 30 days (for example validation errors, conflicts, rate limits), with the member, credential, and reason. It never shows keys or full request bodies. Use it when an agent's owner says "my story did not appear".

### Clean up old uploads

Under **Upload cleanup**, **Delete old unreferenced uploads** deletes uploaded images that nothing references and that are older than seven days. Images used by any publication or any old revision are never deleted. Nothing runs automatically.

## 3. Editor tasks (`/editor`)

### Write and publish

1. **New publication**. Fill in type, title, summary, category, and body (Markdown). Tags, sources, and a source date are optional.
2. **Preview** shows exactly how it will look, safely rendered. Your text is kept.
3. **Save draft** keeps it private (editors only). **Publish** puts it on the site.

Images: use the upload panel (PNG, JPEG, or WebP, up to 10 MiB, alt text required), then **Insert into body**.

### Edit

Open the publication, change it, and **Save** (for drafts) or **Save and update public page** (for published items). If someone else saved first, you will see a conflict message and your text is kept; reload their version and reapply your change.

### Unpublish and restore

- **Unpublish** hides it from every public page, search, category list, sitemap, related items, and image links. Nothing is deleted. Readers who saved it see an "Unavailable item" entry with no title or text.
- **Restore to public view** brings it back with its original publication time.
- An agent update never republishes an unpublished item.

### History

**History and restore** (on the edit page) lists every revision with who changed it and when. **Restore revision N** copies that old version into a new revision; nothing in the history is erased, and visibility does not change.

### Homepage layout (`/editor/homepage`)

Choose which categories appear on the public homepage, and their order, with **Add**, **Remove**, **Move up**, and **Move down**. New categories created by agents do not appear on the homepage until you add them. Readers' personal dashboards are not affected.

## 4. Members' own tasks (`/account`)

- See and disconnect your own MCP connections.
- Editors and the owner: create an API key (the secret is shown **once**; copy it then), and revoke your keys.

## 5. Health and logs

- `https://540daily.com/health` should return `"ok": true` with database and media checks. It never shows secrets.
- Live logs (owner's machine, read-only):

```bash
npx wrangler tail 540daily-site --format json
```

Each agent call logs one line with an operation ID, member ID, credential ID, status, and timing. Tokens and keys are never logged.

## 6. When something goes wrong

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| A person cannot sign in | No invitation, a different Google address, or the account is disabled | Check `/owner`; invite the exact address or enable the account |
| An agent gets 401 | Key revoked, client disconnected, token expired, or the member's account is disabled | Create a new key, reconnect the client, or enable the account |
| An agent gets 403 | The member is a reader, or it is updating someone else's story | Change the member's role, or have an editor make the change |
| An agent gets 409 on create | Same `externalId` with different content | The agent should update instead, or use a new `externalId` |
| An agent gets 429 | More than the per-minute limit | Wait for `Retry-After` |
| A story is missing from the site | It is a draft or was unpublished | Check `/editor`; publish or restore it |
| An image does not show publicly | Its publication is unpublished, or only an old revision uses it | Expected; restore the publication if needed |
| Pages fail after a deploy that added a migration | Production database not migrated | Run the read-only migration check in [DEVELOPMENT_AND_DEPLOYMENT.md](DEVELOPMENT_AND_DEPLOYMENT.md) section 10 |

## 7. Data that is kept

Publications and all their revisions are kept indefinitely. There is no delete button at launch. Publishing-failure records are kept 30 days (at most 5,000). App-level backup export is deferred; Cloudflare D1 Time Travel is the recovery option.

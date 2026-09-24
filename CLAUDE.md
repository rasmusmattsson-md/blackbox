@AGENTS.md

# BlackBox MCP

An MCP server giving an AI assistant read access to the operator's own Google
Analytics and BigQuery. It ships to clients who host it themselves.

## Setting it up

**`INSTALL.md` is the guide, and it is written in the order the steps must
happen.** Do not reorder it and do not let a client skip ahead. Auth0 surfaces
exactly one error at a time and each one hides the next, so a skipped step
produces a message pointing somewhere else entirely — the troubleshooting table
at the end of `INSTALL.md` maps every error back to the step that causes it.

Setup needs an **Auth0 tenant**, a **Google Cloud project**, and somewhere to run
Node. There is no database.

### Tell the client to install the Auth0 CLI

`brew install auth0` (or `scoop`, or the install script), then `auth0 login`.
It is not optional:

- Some settings are hard to reach in the dashboard and easy to mistake for one
  another — the Management API and the My Account API in particular.
- `INSTALL.md` §11 is a verification script that reports the whole tenant state
  in one run. Reach for it before changing anything.

### When helping with a broken setup

**Read `Auth0 → Monitoring → Logs` before changing any setting.** Expanded
entries record the connection used, the scopes actually granted and the audience
issued. This answers in one step what guessing at dashboard toggles does not.
Failing that, `auth0 api get …` reads the real configuration.

Three things learned the expensive way:

- **Logging in and connecting are different flows.** `/auth/login` authenticates.
  `/auth/connect` writes Google's refresh token into Token Vault. A working login
  with an empty vault is the normal failure, not a contradiction.
- **The My Account API must be activated before an MRRT policy naming it can be
  saved.** Auth0 accepts the write and silently discards the policy otherwise, so
  the wrong order looks like the setting simply not sticking.
- **`auth0 api patch connections/…` replaces `options` wholesale.** Sending only
  `scope` wipes the Google client id and secret. Read, merge, write back.

## Architecture

```
proxy.ts               Auth0's /auth/* routes and the session (Next 16: proxy, not middleware)
lib/auth0.ts           the Auth0 client, the Google scopes, the connect link
lib/google.ts          two token exchanges: console (session) and MCP (bearer)
lib/mcp-auth.ts        verifies inbound bearer tokens on /api/mcp
lib/config.ts          APP_URL. Four things derive from it and must agree.
lib/connectors/        one file per data source, plus the registry
lib/{ga4,bigquery}/    the APIs themselves, with no opinion about who is asking
```

Auth0 is both the authorization server for `/api/mcp` and the vault holding
Google's refresh token. Nothing durable is stored here; every credential this
server touches expires on its own.

The load-bearing idea is the **token exchange**: a caller's own Auth0 token is
exchanged for their Google token, so identity and credential cannot drift apart.

### Adding a data source

One file in `lib/connectors/` implementing `Connector`, plus one line in
`lib/connectors/index.ts`. It then appears in both the console and the MCP
server; neither keeps its own list. Declare the Google scopes it needs on the
connector — the registry asks for the union, because one Google account and one
consent screen sit behind all of them. Adding a scope also means adding it to the
Auth0 connection and to the Google consent screen.

## Conventions

- **User-facing text is Swedish.** The console, `README.md` and `INSTALL.md`.
  Code, comments and this file are English.
- Tool failures go back to the model as `isError` results, not thrown errors, so
  it can correct a rejected field name and retry.
- BigQuery queries are capped by `maximumBytesBilled` (default 5 GB). The caller
  is a language model and `select *` on a partitioned table is a plausible first
  attempt with a real invoice attached.

# Noto AI Connector MCP

Read-only MCP server for connecting an external AI chat to a Noto project.

The connector does not write to the app. It only reads the prepared `/projects/:id/ai-context` endpoint from `backend-api`. Project-scoped AI tokens are limited by the access map configured in the app.

## Tools

- `list_projects` - lists projects for a regular web session token. With a project-scoped AI token it only returns the configured project placeholder.
- `get_project_context` - returns the full sanitized AI context with configurable sections and limits.
- `get_project_changes` - returns new and changed project data since an ISO date/time.
- `get_project_summary` - returns project info, members, counters and response limits.
- `list_project_tasks` - returns tasks without loading workspace blocks. Supports filters by state, assignee, search text and archive.
- `list_project_calendar` - returns calendar events only. Kanban deadlines are not included.
- `list_project_reminders` - returns project reminders with optional date filtering.
- `list_project_inbox` - returns project Inbox notes, ideas and quick tasks with their text blocks.
- `list_project_workspace` - returns folders, pages, kanban boards and optionally page blocks.
- `search_project_context` - searches tasks, events, reminders, Inbox items, responsibility areas, workspace nodes and optionally page blocks.

## Recommended Setup

Use a project-scoped AI token from the app:

1. Open a project.
2. Go to `Settings -> Administrator -> AI`.
3. In `MCP tokens`, choose an access preset or configure the access map manually.
4. Create a token.
5. Copy the secret immediately. It is shown only once.
6. Copy the generated `MCP config` into Claude Desktop, Codex, or another MCP-compatible client.

The project-scoped token can read only `/projects/:id/ai-context` for its own project. It is not a user session and does not allow editing.

## Environment Variables

- `AI_CONNECTOR_API_URL` - backend API URL, for example `https://api.example.com`.
- `AI_CONNECTOR_AUTH_TOKEN` - project-scoped AI token, for example `noto_ai_...`.
- `AI_CONNECTOR_PROJECT_ID` - project id for project-scoped mode.
- `AI_CONNECTOR_AUTH_HEADER` - optional full authorization header, for example `Bearer ...`. If set, it overrides `AI_CONNECTOR_AUTH_TOKEN`.
- `AI_CONNECTOR_REQUEST_TIMEOUT_MS` - optional backend request timeout. Default: `15000`.

## Ready Configs

- `configs/claude-desktop.example.json` - Claude Desktop and Claude Code JSON example.
- `configs/codex.config.example.toml` - Codex `config.toml` example.
- `INSTALL.md` - complete Windows and Linux setup, checks, and troubleshooting.

The app generates both config formats with the selected project id, API URL, token, operating system, and connector path.

## MCP Config Example

```json
{
  "mcpServers": {
    "noto-ai-connector": {
      "command": "node",
      "args": ["/opt/noto/ai-connector-mcp/src/server.js"],
      "env": {
        "AI_CONNECTOR_API_URL": "https://api.example.com",
        "AI_CONNECTOR_AUTH_TOKEN": "noto_ai_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "AI_CONNECTOR_PROJECT_ID": "2"
      }
    }
  }
}
```

## Checks

Syntax check:

```bash
npm run check
```

Protocol smoke test without API access:

```bash
npm run smoke
```

Real API smoke test:

```bash
AI_CONNECTOR_API_URL="https://api.example.com" \
AI_CONNECTOR_AUTH_TOKEN="noto_ai_xxx" \
AI_CONNECTOR_PROJECT_ID="2" \
npm run smoke
```

On Windows PowerShell:

```powershell
$env:AI_CONNECTOR_API_URL="https://api.example.com"
$env:AI_CONNECTOR_AUTH_TOKEN="noto_ai_xxx"
$env:AI_CONNECTOR_PROJECT_ID="2"
npm run smoke
```

Expected result:

```text
OK tools/list: 10 tools
OK get_project_summary: project=2
OK list_project_tasks: 3 tasks
OK list_project_calendar: 0 events
OK list_project_reminders: 0 reminders
OK list_project_inbox: 0 items
OK list_project_workspace: 20 nodes
OK search_project_context: 3 results
OK get_project_context: scope=summary
OK get_project_changes: changed=3
```

If token variables are not set, the smoke test still checks MCP protocol and tool registration, then skips real API access.

## Safety Notes

- Token secrets are stored by `backend-api` as hashes.
- A secret is visible only once after creation.
- Revoke leaked tokens in `Settings -> Administrator -> AI`.
- Access presets and manual access maps are enforced on the backend, not only in the frontend.
- MCP calls are recorded in the AI Connector access log with token name, tool name, scope and returned item counts.

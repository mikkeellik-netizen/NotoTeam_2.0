# Noto AI Connector: installation

The connector is a small local Node.js process. Claude or Codex starts it through STDIO, and the connector reads the deployed Noto backend over HTTPS. It does not need to run as a separate public service.

## Requirements

- Node.js 18 or newer on the computer where Claude or Codex runs.
- A deployed and reachable Noto backend URL, for example `https://api.example.com`.
- An AI Connector token created in `Project settings -> Administrator -> AI`.
- Outbound HTTPS access from the computer to the Noto backend.

Do not use the frontend URL as `AI_CONNECTOR_API_URL`. Use the backend API URL. For production, prefer HTTPS.

## Windows

1. Copy the `ai-connector-mcp` directory to a permanent location, for example `C:\noto\ai-connector-mcp`.
2. Open PowerShell in that directory.
3. Run the checks:

```powershell
node --version
npm run check
npm run smoke
```

4. In Noto, create a project-scoped token and copy its secret.
5. Enter the public backend URL and the absolute path to `src\server.js` in the Noto AI panel.
6. Select `Claude` or `Codex`, select `Windows`, and copy the generated configuration.

Claude Desktop configuration file:

```text
%APPDATA%\Claude\claude_desktop_config.json
```

Merge the generated `noto-ai-connector` entry into an existing `mcpServers` object. Do not overwrite unrelated servers. Restart Claude Desktop after saving.

Codex configuration file:

```text
%USERPROFILE%\.codex\config.toml
```

Append the generated TOML block and restart Codex. The Codex app, CLI, and IDE extension share this configuration.

## Linux

1. Copy the connector to a permanent location, for example `/opt/noto/ai-connector-mcp`.
2. Run:

```bash
cd /opt/noto/ai-connector-mcp
node --version
npm run check
npm run smoke
```

3. Create a project-scoped token in Noto.
4. In the Noto AI panel, select the client and `Linux`, then enter the real backend URL and connector path.

Codex configuration file:

```text
~/.codex/config.toml
```

For Claude Code, save the generated JSON as `.mcp.json` in the working project or add the server with the Claude Code MCP command. Keep a token-bearing `.mcp.json` out of Git.

## Real connection test

The `npm run smoke` command checks only MCP startup when no credentials are set. To test the deployed backend too, run the following in the connector directory.

Windows PowerShell:

```powershell
$env:AI_CONNECTOR_API_URL="https://api.example.com"
$env:AI_CONNECTOR_AUTH_TOKEN="noto_ai_replace_with_project_token"
$env:AI_CONNECTOR_PROJECT_ID="1"
npm run smoke
```

Linux:

```bash
AI_CONNECTOR_API_URL="https://api.example.com" \
AI_CONNECTOR_AUTH_TOKEN="noto_ai_replace_with_project_token" \
AI_CONNECTOR_PROJECT_ID="1" \
npm run smoke
```

You can also use `Проверить связь` in the Noto AI panel. It checks the entered backend URL, token, project scope, and reports round-trip latency.

## Troubleshooting

- `AI_CONNECTOR_API_URL is required`: set the public backend API URL in the generated configuration.
- `Cannot reach Noto API`: verify DNS, HTTPS certificate, firewall, and `/health` on the backend.
- `401`: the token is incorrect, expired, or revoked.
- `403`: the token belongs to another project or its access policy blocks the requested section.
- `404`: the deployed backend is older than the AI Connector routes or the wrong API URL was used.
- `Connection closed`: verify the absolute `server.js` path and that `node` is available to the desktop client.

## Security

- AI tokens are read-only and scoped to one project.
- The backend stores only token hashes; the raw secret is shown once.
- Never commit a real token to Git or send it in screenshots.
- Revoke old or leaked tokens in the Noto AI panel and create a new one.
- Use the smallest access preset that is sufficient for the task.

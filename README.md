# Domain Checker MCP

**Public Instance:** `https://mcp.domainchecker.itestit.de/mcp`

Remote MCP server that checks domain availability via the Skrime API.

## Installation

```bash
npm install
npm start
```

The server runs on port `3000` (configurable via `PORT`).

## Endpoints

- `POST /mcp` – MCP endpoint for Claude
- `GET /health` – Healthcheck

## Add to Claude.ai

Host the server behind HTTPS (e.g. nginx + Let's Encrypt), then in Claude.ai go to **Settings → Connectors → Add custom connector**:

- **URL:** `https://mcp.domainchecker.itestit.de/mcp`

## Tool

- `check_domain(domain)` – returns whether the domain is available and whether it is a premium domain.

# Domain Checker MCP

Remote MCP-Server, der über die Skrime-API prüft, ob eine Domain frei ist.

## Installation

```bash
npm install
npm start
```

Server läuft dann auf Port `3000` (über `PORT` änderbar).

## Endpoints

- `POST /mcp` – MCP-Endpoint für Claude
- `GET /health` – Healthcheck

## In Claude.ai einbinden

Server hinter HTTPS hosten (z. B. mit nginx + Let's Encrypt), dann in Claude.ai unter **Settings → Connectors → Add custom connector**:

- **URL:** `https://deine-domain.tld/mcp`

## Tool

- `check_domain(domain)` – gibt zurück, ob die Domain verfügbar und ob sie Premium ist.

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

## Tools

### Availability
- `check_domain(domain)` – returns whether the domain is available and whether it is a premium domain.
- `check_domains(domains, concurrency?)` – bulk-checks up to 50 domains in parallel via the Skrime API.
- `suggest_domains(keyword, tlds?, limit?, check_availability?)` – generates domain name ideas based on a keyword using the Datamuse API. Optionally checks availability of each suggestion via the Skrime API.

### DNS
- `dns_lookup(domain, type?)` – DNS lookup for a single record type: `A`, `AAAA`, `MX`, `TXT`, `NS`, `CNAME`, `SOA`, `CAA`, `SRV`, or `PTR`. Defaults to `A`.
- `dns_records(domain)` – fetches all common DNS records (A, AAAA, MX, TXT, NS, CNAME, SOA, CAA, SRV) for a domain in parallel.
- `reverse_dns(ip)` – PTR lookup for an IPv4 or IPv6 address.
- `check_nameservers(domain, timeout_ms?)` – advanced nameserver audit: NS list, IPv4/IPv6 per NS, /24 + /48 subnet diversity, direct per-NS SOA queries to verify serial consistency, TCP/53 reachability and response times.

### Registration & Mail
- `whois_lookup(domain)` – WHOIS / registration data via the public RDAP service (registrar, status, creation/expiry dates, nameservers).
- `check_email_security(domain, dkim_selectors?)` – inspects MX, SPF, DMARC and probes common DKIM selectors, flagging missing or weak configuration.

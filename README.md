# Domain Checker MCP

**Public Instance:** `https://mcp.domainchecker.itestit.de/mcp`

Remote MCP server that checks domain availability via the Skrime API.

## Installation

```bash
npm install
npm start
```

The server runs on port `3000` (configurable via `PORT`).

### Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `RATE_LIMIT_CAPACITY` | `60` | Token bucket capacity per client IP |
| `RATE_LIMIT_REFILL_PER_SEC` | `1` | Tokens refilled per second |
| `MAX_BODY_SIZE` | `64kb` | Maximum JSON body size on `/mcp` |

## Abuse protection

Because this server is intended to be exposed publicly, several mitigations are in place:

- **Per-IP token-bucket rate limit** with weighted tool costs (e.g. `check_nameservers` = 10 tokens, `check_domain` = 1). Exceeding the bucket returns HTTP `429` with a `Retry-After` header and `X-RateLimit-*` response headers. `trust proxy` is enabled so the real client IP is read from `X-Forwarded-For` when running behind nginx.
- **Body size limit** on `/mcp` (default 64 kB, returns HTTP `413`).
- **SSRF guard**: `reverse_dns`, `dns_lookup` with `type=PTR`, and the TCP/53 + per-NS SOA probes in `check_nameservers` refuse private / loopback / link-local / CGNAT / multicast / ULA addresses (IPv4 and IPv6, including IPv4-mapped form), preventing the server from being used to scan internal networks.
- **Fan-out caps**: `check_domains` ≤ 50 domains and concurrency ≤ 20, `suggest_domains` ≤ 30 ideas, `check_nameservers` probes at most 10 NS, `check_email_security` probes at most 10 DKIM selectors.
- **Per-NS timeout** in `check_nameservers` is bounded (default 3 s, max 10 s).

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

#!/usr/bin/env node
import express from "express";
import { randomUUID } from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  isInitializeRequest,
} from "@modelcontextprotocol/sdk/types.js";

const PORT = Number(process.env.PORT) || 3000;
const SKRIME_API_URL = "https://skrime.eu/api/domain/check";
const DATAMUSE_API_URL = "https://api.datamuse.com/words";
const RDAP_API_URL = "https://rdap.org/domain";
const DEFAULT_TLDS = ["com", "net", "org", "io", "app", "dev", "ai", "co", "de"];
const DNS_RECORD_TYPES = ["A", "AAAA", "MX", "TXT", "NS", "CNAME", "SOA", "CAA", "SRV"];

function createMcpServer() {
  const server = new Server(
    { name: "domain-checker", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "check_domain",
        description: "Checks domain availability via the Skrime API.",
        inputSchema: {
          type: "object",
          properties: {
            domain: {
              type: "string",
              description: "Domain including TLD, e.g. 'example.com'",
            },
          },
          required: ["domain"],
        },
      },
      {
        name: "check_domains",
        description:
          "Checks availability of multiple domains in parallel via the Skrime API.",
        inputSchema: {
          type: "object",
          properties: {
            domains: {
              type: "array",
              items: { type: "string" },
              description:
                "List of domains including TLD, e.g. ['a.com','b.io']. Max 50.",
            },
            concurrency: {
              type: "number",
              description: "Max parallel requests (default 5, max 20).",
            },
          },
          required: ["domains"],
        },
      },
      {
        name: "dns_lookup",
        description:
          "Performs a DNS lookup for a single record type (A, AAAA, MX, TXT, NS, CNAME, SOA, CAA, SRV, PTR).",
        inputSchema: {
          type: "object",
          properties: {
            domain: {
              type: "string",
              description: "Domain or IP (for PTR), e.g. 'example.com'.",
            },
            type: {
              type: "string",
              description:
                "Record type: A, AAAA, MX, TXT, NS, CNAME, SOA, CAA, SRV, or PTR. Defaults to 'A'.",
            },
          },
          required: ["domain"],
        },
      },
      {
        name: "dns_records",
        description:
          "Fetches all common DNS records (A, AAAA, MX, TXT, NS, CNAME, SOA, CAA, SRV) for a domain in parallel.",
        inputSchema: {
          type: "object",
          properties: {
            domain: {
              type: "string",
              description: "Domain, e.g. 'example.com'.",
            },
          },
          required: ["domain"],
        },
      },
      {
        name: "whois_lookup",
        description:
          "Returns WHOIS / registration information for a domain via the public RDAP service (registrar, status, creation/expiry dates, nameservers).",
        inputSchema: {
          type: "object",
          properties: {
            domain: {
              type: "string",
              description: "Domain, e.g. 'example.com'.",
            },
          },
          required: ["domain"],
        },
      },
      {
        name: "check_email_security",
        description:
          "Inspects a domain's email-related DNS records (MX, SPF, DMARC, common DKIM selectors) and flags missing/weak configuration.",
        inputSchema: {
          type: "object",
          properties: {
            domain: {
              type: "string",
              description: "Domain, e.g. 'example.com'.",
            },
            dkim_selectors: {
              type: "array",
              items: { type: "string" },
              description:
                "Optional list of DKIM selectors to probe (e.g. ['default','google','selector1']).",
            },
          },
          required: ["domain"],
        },
      },
      {
        name: "check_nameservers",
        description:
          "Advanced nameserver audit: lists NS, resolves each to IPv4/IPv6, checks subnet diversity, queries each NS directly for the SOA to verify serial consistency, and probes TCP/53 reachability with response times.",
        inputSchema: {
          type: "object",
          properties: {
            domain: {
              type: "string",
              description: "Domain, e.g. 'example.com'.",
            },
            timeout_ms: {
              type: "number",
              description:
                "Per-nameserver query/probe timeout in ms (default 3000, max 10000).",
            },
          },
          required: ["domain"],
        },
      },
      {
        name: "reverse_dns",
        description: "Reverse DNS lookup (PTR) for an IPv4 or IPv6 address.",
        inputSchema: {
          type: "object",
          properties: {
            ip: {
              type: "string",
              description: "IPv4 or IPv6 address.",
            },
          },
          required: ["ip"],
        },
      },
      {
        name: "suggest_domains",
        description:
          "Generates domain name ideas based on a keyword using the Datamuse API. Optionally checks availability of each suggestion via the Skrime API.",
        inputSchema: {
          type: "object",
          properties: {
            keyword: {
              type: "string",
              description: "Seed keyword or topic, e.g. 'coffee' or 'fast car'",
            },
            tlds: {
              type: "array",
              items: { type: "string" },
              description:
                "Optional list of TLDs (without dot), e.g. ['com','io']. Defaults to common TLDs.",
            },
            limit: {
              type: "number",
              description: "Maximum number of suggestions (default 10, max 30).",
            },
            check_availability: {
              type: "boolean",
              description: "If true, each suggestion is checked via Skrime API.",
            },
          },
          required: ["keyword"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;

    if (toolName === "check_domain") {
      return handleCheckDomain(request.params.arguments);
    }
    if (toolName === "check_domains") {
      return handleCheckDomains(request.params.arguments);
    }
    if (toolName === "suggest_domains") {
      return handleSuggestDomains(request.params.arguments);
    }
    if (toolName === "dns_lookup") {
      return handleDnsLookup(request.params.arguments);
    }
    if (toolName === "dns_records") {
      return handleDnsRecords(request.params.arguments);
    }
    if (toolName === "whois_lookup") {
      return handleWhoisLookup(request.params.arguments);
    }
    if (toolName === "check_email_security") {
      return handleCheckEmailSecurity(request.params.arguments);
    }
    if (toolName === "reverse_dns") {
      return handleReverseDns(request.params.arguments);
    }
    if (toolName === "check_nameservers") {
      return handleCheckNameservers(request.params.arguments);
    }
    return {
      content: [{ type: "text", text: `Unknown tool: '${toolName}'` }],
      isError: true,
    };
  });

  return server;
}

async function checkDomainAvailability(domain) {
  const response = await fetch(SKRIME_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ domain }),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const payload = await response.json();
  if (payload?.state !== "success" || !payload?.data) {
    throw new Error(`API did not report success: ${JSON.stringify(payload)}`);
  }
  return payload.data;
}

async function handleCheckDomain(args) {
  const domain = String(args?.domain ?? "").trim().toLowerCase();

  if (!domain || !domain.includes(".") || /\s/.test(domain)) {
    return {
      content: [{ type: "text", text: `Invalid domain: '${domain}'` }],
      isError: true,
    };
  }

  try {
    const data = await checkDomainAvailability(domain);
    const status = data.available
      ? `✅ '${data.domain}' is AVAILABLE.`
      : `❌ '${data.domain}' is NOT available.`;
    const premium = data.premium ? "\n💎 Premium domain." : "";
    return { content: [{ type: "text", text: status + premium }] };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: ${err.message}` }],
      isError: true,
    };
  }
}

function isValidDomain(d) {
  return typeof d === "string" && d.includes(".") && !/\s/.test(d);
}

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

async function handleCheckDomains(args) {
  const raw = Array.isArray(args?.domains) ? args.domains : [];
  const domains = [...new Set(raw.map((d) => String(d ?? "").trim().toLowerCase()).filter(Boolean))];

  if (domains.length === 0) {
    return {
      content: [{ type: "text", text: "Missing 'domains' (non-empty array)." }],
      isError: true,
    };
  }
  if (domains.length > 50) {
    return {
      content: [{ type: "text", text: `Too many domains (${domains.length}). Max 50.` }],
      isError: true,
    };
  }

  const concurrency = Math.min(Math.max(Number(args?.concurrency) || 5, 1), 20);

  const results = await runWithConcurrency(domains, concurrency, async (domain) => {
    if (!isValidDomain(domain)) {
      return { domain, line: `⚠️  ${domain} (invalid)` };
    }
    try {
      const data = await checkDomainAvailability(domain);
      const icon = data.available ? "✅" : "❌";
      const premium = data.premium ? " 💎" : "";
      return {
        domain,
        available: data.available,
        premium: !!data.premium,
        line: `${icon} ${data.domain}${premium}`,
      };
    } catch (err) {
      return { domain, error: err.message, line: `⚠️  ${domain} (${err.message})` };
    }
  });

  const available = results.filter((r) => r.available).length;
  const taken = results.filter((r) => r.available === false).length;
  const errors = results.filter((r) => r.error || r.line.startsWith("⚠️")).length;

  const summary = `Checked ${results.length} domain(s): ✅ ${available} available · ❌ ${taken} taken · ⚠️ ${errors} error(s)`;
  const body = results.map((r) => r.line).join("\n");

  return {
    content: [{ type: "text", text: `${summary}\n\n${body}` }],
  };
}

function sanitizeLabel(word) {
  return word
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9-\s]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function handleSuggestDomains(args) {
  const keyword = String(args?.keyword ?? "").trim();
  if (!keyword) {
    return {
      content: [{ type: "text", text: "Missing 'keyword'." }],
      isError: true,
    };
  }

  const limit = Math.min(Math.max(Number(args?.limit) || 10, 1), 30);
  const tlds = Array.isArray(args?.tlds) && args.tlds.length > 0
    ? args.tlds.map((t) => String(t).replace(/^\./, "").toLowerCase())
    : DEFAULT_TLDS;
  const checkAvailability = Boolean(args?.check_availability);

  let words = [];
  try {
    const url = `${DATAMUSE_API_URL}?ml=${encodeURIComponent(keyword)}&max=50`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    words = json
      .map((entry) => sanitizeLabel(entry?.word ?? ""))
      .filter((w) => w && w.length >= 3 && w.length <= 24);
  } catch (err) {
    return {
      content: [{ type: "text", text: `Datamuse error: ${err.message}` }],
      isError: true,
    };
  }

  const seed = sanitizeLabel(keyword);
  const labels = new Set();
  if (seed) labels.add(seed);
  for (const w of words) {
    if (labels.size >= limit) break;
    labels.add(w);
    if (seed && w !== seed && labels.size < limit) {
      labels.add(`${seed}${w}`);
      if (labels.size < limit) labels.add(`${w}${seed}`);
      if (labels.size < limit) labels.add(`get${w}`);
    }
  }

  const suggestions = [];
  for (const label of labels) {
    if (suggestions.length >= limit) break;
    const tld = tlds[suggestions.length % tlds.length];
    suggestions.push(`${label}.${tld}`);
  }

  if (!checkAvailability) {
    const list = suggestions.map((d) => `• ${d}`).join("\n");
    return {
      content: [
        {
          type: "text",
          text: `💡 Domain ideas for '${keyword}':\n${list}`,
        },
      ],
    };
  }

  const results = await Promise.all(
    suggestions.map(async (domain) => {
      try {
        const data = await checkDomainAvailability(domain);
        const icon = data.available ? "✅" : "❌";
        const premium = data.premium ? " 💎" : "";
        return `${icon} ${domain}${premium}`;
      } catch (err) {
        return `⚠️  ${domain} (${err.message})`;
      }
    })
  );

  return {
    content: [
      {
        type: "text",
        text: `💡 Domain ideas for '${keyword}':\n${results.join("\n")}`,
      },
    ],
  };
}

function normalizeHostname(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");
}

function isValidHostname(host) {
  if (!host || host.length > 253) return false;
  if (/\s/.test(host)) return false;
  if (!host.includes(".")) return false;
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(host);
}

function formatDnsAnswer(type, records) {
  if (!records || records.length === 0) return "  (no records)";
  if (type === "MX") {
    return records
      .sort((a, b) => a.priority - b.priority)
      .map((r) => `  ${r.priority} ${r.exchange}`)
      .join("\n");
  }
  if (type === "TXT") {
    return records.map((parts) => `  "${parts.join("")}"`).join("\n");
  }
  if (type === "SOA") {
    const r = records;
    return [
      `  primary:  ${r.nsname}`,
      `  hostmaster: ${r.hostmaster}`,
      `  serial:   ${r.serial}`,
      `  refresh:  ${r.refresh}`,
      `  retry:    ${r.retry}`,
      `  expire:   ${r.expire}`,
      `  minTTL:   ${r.minttl}`,
    ].join("\n");
  }
  if (type === "CAA") {
    return records.map((r) => `  ${r.critical} ${r.issue ?? r.issuewild ?? r.iodef ?? ""}`).join("\n");
  }
  if (type === "SRV") {
    return records.map((r) => `  ${r.priority} ${r.weight} ${r.port} ${r.name}`).join("\n");
  }
  return records.map((r) => `  ${typeof r === "string" ? r : JSON.stringify(r)}`).join("\n");
}

async function resolveType(domain, type) {
  if (type === "TXT") return dns.resolveTxt(domain);
  if (type === "MX") return dns.resolveMx(domain);
  if (type === "NS") return dns.resolveNs(domain);
  if (type === "CNAME") return dns.resolveCname(domain);
  if (type === "SOA") return dns.resolveSoa(domain);
  if (type === "CAA") return dns.resolveCaa(domain);
  if (type === "SRV") return dns.resolveSrv(domain);
  if (type === "A") return dns.resolve4(domain);
  if (type === "AAAA") return dns.resolve6(domain);
  if (type === "PTR") return dns.reverse(domain);
  throw new Error(`Unsupported record type: ${type}`);
}

async function handleDnsLookup(args) {
  const rawType = String(args?.type ?? "A").trim().toUpperCase();
  const isReverse = rawType === "PTR";
  const target = isReverse
    ? String(args?.domain ?? "").trim()
    : normalizeHostname(args?.domain);

  if (!target) {
    return {
      content: [{ type: "text", text: "Missing 'domain'." }],
      isError: true,
    };
  }
  if (isReverse && net.isIP(target) === 0) {
    return {
      content: [{ type: "text", text: `PTR requires an IP address, got '${target}'.` }],
      isError: true,
    };
  }
  if (!isReverse && !isValidHostname(target)) {
    return {
      content: [{ type: "text", text: `Invalid domain: '${target}'.` }],
      isError: true,
    };
  }

  try {
    const records = await resolveType(target, rawType);
    const body = formatDnsAnswer(rawType, records);
    return {
      content: [{ type: "text", text: `🔎 ${rawType} ${target}\n${body}` }],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: `⚠️  ${rawType} ${target}: ${err.code ?? err.message}`,
        },
      ],
      isError: true,
    };
  }
}

async function handleDnsRecords(args) {
  const domain = normalizeHostname(args?.domain);
  if (!isValidHostname(domain)) {
    return {
      content: [{ type: "text", text: `Invalid domain: '${domain}'.` }],
      isError: true,
    };
  }

  const lookups = await Promise.all(
    DNS_RECORD_TYPES.map(async (type) => {
      try {
        const records = await resolveType(domain, type);
        const hasResults = Array.isArray(records) ? records.length > 0 : !!records;
        return { type, records, ok: hasResults };
      } catch (err) {
        return { type, error: err.code ?? err.message, ok: false };
      }
    })
  );

  const sections = lookups.map((l) => {
    if (l.error && l.error !== "ENODATA" && l.error !== "ENOTFOUND") {
      return `📄 ${l.type}\n  ⚠️  ${l.error}`;
    }
    if (!l.ok) return `📄 ${l.type}\n  (none)`;
    return `📄 ${l.type}\n${formatDnsAnswer(l.type, l.records)}`;
  });

  const summary = `🌐 DNS records for ${domain}`;
  return {
    content: [{ type: "text", text: `${summary}\n\n${sections.join("\n\n")}` }],
  };
}

function formatRdapDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toISOString().slice(0, 10);
}

async function handleWhoisLookup(args) {
  const domain = normalizeHostname(args?.domain);
  if (!isValidHostname(domain)) {
    return {
      content: [{ type: "text", text: `Invalid domain: '${domain}'.` }],
      isError: true,
    };
  }

  try {
    const res = await fetch(`${RDAP_API_URL}/${encodeURIComponent(domain)}`, {
      headers: { Accept: "application/rdap+json" },
    });
    if (res.status === 404) {
      return {
        content: [{ type: "text", text: `❔ No RDAP record found for '${domain}'. Possibly unregistered.` }],
      };
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();

    const events = data.events ?? [];
    const evt = (action) =>
      formatRdapDate(events.find((e) => e.eventAction === action)?.eventDate);

    const registrarEntity = (data.entities ?? []).find((e) =>
      (e.roles ?? []).includes("registrar")
    );
    const registrarName =
      registrarEntity?.vcardArray?.[1]?.find((f) => f[0] === "fn")?.[3] ??
      registrarEntity?.handle ??
      "(unknown)";

    const status = (data.status ?? []).join(", ") || "(none)";
    const nameservers = (data.nameservers ?? [])
      .map((ns) => ns.ldhName ?? ns.unicodeName)
      .filter(Boolean);

    const lines = [
      `🪪 WHOIS / RDAP for ${data.ldhName ?? domain}`,
      `  Handle:     ${data.handle ?? "(unknown)"}`,
      `  Registrar:  ${registrarName}`,
      `  Status:     ${status}`,
      `  Created:    ${evt("registration") ?? "(unknown)"}`,
      `  Updated:    ${evt("last changed") ?? "(unknown)"}`,
      `  Expires:    ${evt("expiration") ?? "(unknown)"}`,
      `  Nameservers:`,
      ...(nameservers.length ? nameservers.map((ns) => `    • ${ns}`) : ["    (none)"]),
    ];

    return { content: [{ type: "text", text: lines.join("\n") }] };
  } catch (err) {
    return {
      content: [{ type: "text", text: `RDAP error: ${err.message}` }],
      isError: true,
    };
  }
}

async function safeResolveTxt(host) {
  try {
    return (await dns.resolveTxt(host)).map((parts) => parts.join(""));
  } catch {
    return [];
  }
}

async function handleCheckEmailSecurity(args) {
  const domain = normalizeHostname(args?.domain);
  if (!isValidHostname(domain)) {
    return {
      content: [{ type: "text", text: `Invalid domain: '${domain}'.` }],
      isError: true,
    };
  }

  const selectors = Array.isArray(args?.dkim_selectors) && args.dkim_selectors.length > 0
    ? args.dkim_selectors.map((s) => String(s).trim()).filter(Boolean)
    : ["default", "google", "selector1", "selector2", "mail", "k1"];

  const [mxRecords, rootTxt, dmarcTxt, ...dkimResults] = await Promise.all([
    dns.resolveMx(domain).catch(() => []),
    safeResolveTxt(domain),
    safeResolveTxt(`_dmarc.${domain}`),
    ...selectors.map((sel) => safeResolveTxt(`${sel}._domainkey.${domain}`).then((txt) => ({ sel, txt }))),
  ]);

  const spf = rootTxt.find((t) => t.toLowerCase().startsWith("v=spf1"));
  const dmarc = dmarcTxt.find((t) => t.toLowerCase().startsWith("v=dmarc1"));
  const dkimHits = dkimResults.filter((r) => r.txt.some((t) => t.toLowerCase().includes("v=dkim1")));

  const lines = [`📧 Email security for ${domain}`, ""];

  if (mxRecords.length === 0) {
    lines.push("❌ MX:    no MX records — domain cannot receive mail");
  } else {
    lines.push("✅ MX:");
    mxRecords
      .sort((a, b) => a.priority - b.priority)
      .forEach((mx) => lines.push(`    ${mx.priority} ${mx.exchange}`));
  }

  lines.push("");
  if (!spf) {
    lines.push("❌ SPF:   missing");
  } else {
    const policy = spf.match(/[~\-+?]all\b/)?.[0] ?? "(no -all/~all)";
    const icon = policy === "-all" ? "✅" : policy === "~all" ? "🟡" : "⚠️ ";
    lines.push(`${icon} SPF:   ${spf}`);
    lines.push(`         policy: ${policy}`);
  }

  lines.push("");
  if (!dmarc) {
    lines.push("❌ DMARC: missing (_dmarc TXT not found)");
  } else {
    const policy = dmarc.match(/p=([a-z]+)/i)?.[1]?.toLowerCase() ?? "(none)";
    const icon = policy === "reject" ? "✅" : policy === "quarantine" ? "🟡" : "⚠️ ";
    lines.push(`${icon} DMARC: ${dmarc}`);
    lines.push(`         policy: p=${policy}`);
  }

  lines.push("");
  if (dkimHits.length === 0) {
    lines.push(`⚠️  DKIM:  no records found for selectors [${selectors.join(", ")}]`);
    lines.push("         (DKIM selectors are publisher-defined — absence isn't proof of misconfiguration)");
  } else {
    lines.push("✅ DKIM:");
    for (const hit of dkimHits) {
      lines.push(`    ${hit.sel}._domainkey present`);
    }
  }

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

async function handleReverseDns(args) {
  const ip = String(args?.ip ?? "").trim();
  if (net.isIP(ip) === 0) {
    return {
      content: [{ type: "text", text: `Invalid IP: '${ip}'.` }],
      isError: true,
    };
  }
  try {
    const names = await dns.reverse(ip);
    if (names.length === 0) {
      return { content: [{ type: "text", text: `🔁 PTR ${ip}\n  (no records)` }] };
    }
    return {
      content: [
        { type: "text", text: `🔁 PTR ${ip}\n${names.map((n) => `  ${n}`).join("\n")}` },
      ],
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: `⚠️  PTR ${ip}: ${err.code ?? err.message}` }],
      isError: true,
    };
  }
}

function ipv4Subnet24(ip) {
  const parts = ip.split(".");
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.0/24` : null;
}

function ipv6Subnet48(ip) {
  try {
    const expanded = ip.includes("::")
      ? (() => {
          const [left, right] = ip.split("::");
          const l = left ? left.split(":") : [];
          const r = right ? right.split(":") : [];
          const missing = 8 - (l.length + r.length);
          return [...l, ...Array(missing).fill("0"), ...r];
        })()
      : ip.split(":");
    if (expanded.length !== 8) return null;
    return expanded.slice(0, 3).map((g) => g.padStart(4, "0")).join(":") + "::/48";
  } catch {
    return null;
  }
}

function probeTcp(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = new net.Socket();
    let settled = false;
    const finish = (ok, error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ ok, ms: Date.now() - started, error });
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false, "timeout"));
    socket.once("error", (e) => finish(false, e.code ?? e.message));
    socket.connect(port, host);
  });
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout`)), ms)
    ),
  ]);
}

async function querySoaViaResolver(ip, domain, timeoutMs) {
  const resolver = new dns.Resolver({ timeout: timeoutMs, tries: 1 });
  resolver.setServers([net.isIP(ip) === 6 ? `[${ip}]` : ip]);
  const started = Date.now();
  const soa = await withTimeout(resolver.resolveSoa(domain), timeoutMs + 500, "SOA");
  return { soa, ms: Date.now() - started };
}

async function handleCheckNameservers(args) {
  const domain = normalizeHostname(args?.domain);
  if (!isValidHostname(domain)) {
    return {
      content: [{ type: "text", text: `Invalid domain: '${domain}'.` }],
      isError: true,
    };
  }
  const timeoutMs = Math.min(Math.max(Number(args?.timeout_ms) || 3000, 500), 10000);

  let nsNames = [];
  try {
    nsNames = await dns.resolveNs(domain);
  } catch (err) {
    return {
      content: [{ type: "text", text: `No NS records for '${domain}': ${err.code ?? err.message}` }],
      isError: true,
    };
  }
  nsNames = [...new Set(nsNames.map((n) => n.toLowerCase().replace(/\.$/, "")))].sort();

  let parentSoa = null;
  try {
    parentSoa = await dns.resolveSoa(domain);
  } catch {}

  const perNs = await Promise.all(
    nsNames.map(async (ns) => {
      const [a4, a6] = await Promise.all([
        dns.resolve4(ns).catch(() => []),
        dns.resolve6(ns).catch(() => []),
      ]);
      const ips = [...a4.map((ip) => ({ ip, family: 4 })), ...a6.map((ip) => ({ ip, family: 6 }))];

      const probes = await Promise.all(
        ips.map(async ({ ip, family }) => {
          const tcp = await probeTcp(ip, 53, timeoutMs);
          let soa = null;
          let soaError = null;
          let soaMs = null;
          try {
            const r = await querySoaViaResolver(ip, domain, timeoutMs);
            soa = r.soa;
            soaMs = r.ms;
          } catch (e) {
            soaError = e.code ?? e.message;
          }
          return { ip, family, tcp, soa, soaError, soaMs };
        })
      );
      return { ns, ips, probes };
    })
  );

  const allIps = perNs.flatMap((n) => n.probes.map((p) => ({ ip: p.ip, family: p.family })));
  const v4 = allIps.filter((x) => x.family === 4);
  const v6 = allIps.filter((x) => x.family === 6);
  const subnets4 = new Set(v4.map((x) => ipv4Subnet24(x.ip)).filter(Boolean));
  const subnets6 = new Set(v6.map((x) => ipv6Subnet48(x.ip)).filter(Boolean));

  const serials = new Set();
  for (const n of perNs) {
    for (const p of n.probes) {
      if (p.soa?.serial !== undefined) serials.add(p.soa.serial);
    }
  }
  const serialConsistent = serials.size <= 1;

  const lines = [`🛰️  Nameserver audit for ${domain}`, ""];
  lines.push(`NS records (${nsNames.length}):`);
  for (const ns of nsNames) lines.push(`  • ${ns}`);
  lines.push("");
  lines.push("Diversity:");
  lines.push(`  IPv4 addresses: ${v4.length}   unique /24 subnets: ${subnets4.size}`);
  lines.push(`  IPv6 addresses: ${v6.length}   unique /48 subnets: ${subnets6.size}`);
  if (subnets4.size < 2 && nsNames.length > 1) {
    lines.push("  ⚠️  All IPv4 NS share a /24 — single-network risk.");
  }
  if (v6.length === 0) {
    lines.push("  🟡 No IPv6 nameservers (consider AAAA glue for resilience).");
  }
  lines.push("");
  lines.push(`SOA consistency: ${
    serialConsistent
      ? `✅ all NS agree (serial ${[...serials][0] ?? "n/a"})`
      : `❌ MISMATCH — serials seen: ${[...serials].join(", ")}`
  }`);
  if (parentSoa) {
    lines.push(`  Recursive view: serial ${parentSoa.serial}, primary ${parentSoa.nsname}`);
  }
  lines.push("");
  lines.push("Per-nameserver:");
  for (const n of perNs) {
    lines.push(`  ${n.ns}`);
    if (n.probes.length === 0) {
      lines.push("    ⚠️  no IPs (missing glue or unresolvable)");
      continue;
    }
    for (const p of n.probes) {
      const proto = p.family === 6 ? "IPv6" : "IPv4";
      const tcp = p.tcp.ok ? `TCP/53 ✅ ${p.tcp.ms}ms` : `TCP/53 ❌ ${p.tcp.error}`;
      const soaPart = p.soa
        ? `SOA serial=${p.soa.serial} (${p.soaMs}ms)`
        : `SOA ❌ ${p.soaError}`;
      lines.push(`    ${proto} ${p.ip}  ${tcp}  ${soaPart}`);
    }
  }

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));

const transports = new Map();

app.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  let transport;

  if (sessionId && transports.has(sessionId)) {
    transport = transports.get(sessionId);
  } else if (!sessionId && isInitializeRequest(req.body)) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => transports.set(sid, transport),
    });
    transport.onclose = () => {
      if (transport.sessionId) transports.delete(transport.sessionId);
    };
    const server = createMcpServer();
    await server.connect(transport);
  } else {
    return res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Bad Request" },
      id: null,
    });
  }

  await transport.handleRequest(req, res, req.body);
});

async function handleSession(req, res) {
  const sessionId = req.headers["mcp-session-id"];
  if (!sessionId || !transports.has(sessionId)) {
    return res.status(400).send("Invalid session ID");
  }
  await transports.get(sessionId).handleRequest(req, res);
}

app.get("/mcp", handleSession);
app.delete("/mcp", handleSession);

app.listen(PORT, () => {
  console.log(`Domain Checker MCP running on port ${PORT}`);
});

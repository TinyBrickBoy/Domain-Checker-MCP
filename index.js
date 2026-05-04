#!/usr/bin/env node
import express from "express";
import { randomUUID } from "node:crypto";
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
const DEFAULT_TLDS = ["com", "net", "org", "io", "app", "dev", "ai", "co", "de"];

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
    if (toolName === "suggest_domains") {
      return handleSuggestDomains(request.params.arguments);
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

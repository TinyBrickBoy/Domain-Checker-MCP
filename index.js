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

function createMcpServer() {
  const server = new Server(
    { name: "domain-checker", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "check_domain",
        description: "Prüft die Verfügbarkeit einer Domain über die Skrime-API.",
        inputSchema: {
          type: "object",
          properties: {
            domain: {
              type: "string",
              description: "Domain inkl. TLD, z. B. 'beispiel.de'",
            },
          },
          required: ["domain"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const domain = String(request.params.arguments?.domain ?? "").trim().toLowerCase();

    if (!domain || !domain.includes(".") || /\s/.test(domain)) {
      return {
        content: [{ type: "text", text: `Ungültige Domain: '${domain}'` }],
        isError: true,
      };
    }

    try {
      const response = await fetch(SKRIME_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain }),
      });

      if (!response.ok) {
        return {
          content: [{ type: "text", text: `API-Fehler: HTTP ${response.status}` }],
          isError: true,
        };
      }

      const payload = await response.json();
      const data = payload?.data;

      if (payload?.state !== "success" || !data) {
        return {
          content: [{ type: "text", text: `API meldet keinen Erfolg: ${JSON.stringify(payload)}` }],
          isError: true,
        };
      }

      const status = data.available
        ? `✅ '${data.domain}' ist VERFÜGBAR.`
        : `❌ '${data.domain}' ist NICHT verfügbar.`;
      const premium = data.premium ? "\n💎 Premium-Domain." : "";

      return {
        content: [{ type: "text", text: status + premium }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Verbindungsfehler: ${err.message}` }],
        isError: true,
      };
    }
  });

  return server;
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
    return res.status(400).send("Ungültige Session-ID");
  }
  await transports.get(sessionId).handleRequest(req, res);
}

app.get("/mcp", handleSession);
app.delete("/mcp", handleSession);

app.listen(PORT, () => {
  console.log(`Domain Checker MCP läuft auf Port ${PORT}`);
});

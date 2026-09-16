#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { statSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const server = new McpServer({ name: pkg.name, version: pkg.version });

const ledger = { events: [], budget: 0, start: Date.now() };

function tokensFromChars(chars) {
  return Math.max(1, Math.round(chars / 4));
}

function addEvent(kind, tokens, chars, note) {
  ledger.events.push({ ts: new Date().toISOString(), kind, tokens, chars: chars || 0, note: note || "" });
}

function totals() {
  const t = ledger.events.reduce((a, e) => a + (e.tokens || 0), 0);
  const c = ledger.events.reduce((a, e) => a + (e.chars || 0), 0);
  const byKind = ledger.events.reduce((a, e) => ((a[e.kind] = (a[e.kind] || 0) + (e.tokens || 0)), a), {});
  return { tokens: t, chars: c, events: ledger.events.length, byKind, budget: ledger.budget, remaining: ledger.budget ? ledger.budget - t : null };
}

server.registerTool(
  "context.log",
  {
    description: "Record a token spend event into the session ledger. Call this after a read, a tool call, or a model turn so the budget report stays truthful.",
    inputSchema: {
      kind: z.enum(["read", "tool", "model", "write", "other"]).default("other").describe("What kind of work consumed the tokens"),
      tokens: z.number().int().min(0).describe("Tokens consumed"),
      chars: z.number().int().min(0).optional().describe("Characters read or produced"),
      note: z.string().optional().describe("What was spent on"),
    },
  },
  async ({ kind, tokens, chars, note }) => {
    addEvent(kind, tokens, chars, note);
    return { content: [{ type: "text", text: JSON.stringify(totals(), null, 2) }] };
  }
);

server.registerTool(
  "context.report",
  {
    description: "Return the current session token spend: totals, spend by kind, budget, and remaining budget.",
    inputSchema: {},
  },
  async () => ({ content: [{ type: "text", text: JSON.stringify({ started: new Date(ledger.start).toISOString(), ...totals() }, null, 2) }] })
);

server.registerTool(
  "context.estimate",
  {
    description: "Estimate the token cost of reading a file before reading it, and compare it with cheaper alternatives such as a graph query. Use this before a large read to protect the budget.",
    inputSchema: {
      path: z.string().describe("Path to the file that would be read"),
      alternativeCost: z.number().int().min(0).optional().describe("Estimated token cost of the cheaper alternative, for example a graph query"),
    },
  },
  async ({ path, alternativeCost }) => {
    const p = resolve(path);
    try {
      const size = statSync(p).size;
      const chars = Math.min(size, 500000);
      const tokens = tokensFromChars(chars);
      const savings = alternativeCost !== undefined ? tokens - alternativeCost : null;
      const verdict = alternativeCost !== undefined && savings > 0 ? `READ_COSTS_MORE` : "READ_REASONABLE";
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                file: p,
                bytes: size,
                estimatedTokens: tokens,
                alternativeCost: alternativeCost ?? null,
                savingsIfCheaper: savings !== null && savings > 0 ? savings : null,
                verdict,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch {
      return { content: [{ type: "text", text: JSON.stringify({ error: "file not found", file: p }) }] };
    }
  }
);

server.registerTool(
  "context.limit",
  {
    description: "Set or read the token budget for the session. With maxTokens set, stores the budget; without, returns the current budget and remaining tokens.",
    inputSchema: {
      maxTokens: z.number().int().min(0).optional().describe("Budget in tokens. Omit to read the current budget."),
    },
  },
  async ({ maxTokens }) => {
    if (maxTokens !== undefined) ledger.budget = maxTokens;
    const t = totals();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { budget: t.budget, spent: t.tokens, remaining: t.remaining, overBudget: t.remaining !== null && t.remaining < 0 },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.registerTool(
  "context.check",
  {
    description: "Check whether the session has gone over its token budget. Returns a boolean the agent can gate on before continuing.",
    inputSchema: {},
  },
  async () => {
    const t = totals();
    const over = t.remaining !== null && t.remaining < 0;
    return { content: [{ type: "text", text: JSON.stringify({ overBudget: over, spent: t.tokens, budget: t.budget, remaining: t.remaining, verdict: over ? "OVER_BUDGET" : "WITHIN_BUDGET" }) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
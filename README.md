# token-gate-mcp

Token and context budget for AI agents. Tracks session spend, estimates the cost of a read before it happens, and tells an agent the cheaper path before it burns its budget.

Built as an MCP server, so it works in any platform that speaks Model Context Protocol.

## Why

Agents discover their budget is gone after it is gone. A single file dump can cost more than an entire task was worth. Context makes spend visible and measurable, and warns before the expensive read.

## Tools

* `context.log` record a token spend event by kind: read, tool, model, write, other
* `context.report` the session totals, spend by kind, budget, and remaining
* `context.estimate` estimate the token cost of reading a file and compare it with a cheaper alternative such as a graph query
* `context.limit` set or read the session budget
* `context.check` a boolean the agent can gate on: within budget or over budget

Estimates assume roughly four characters per token.

## Usage

```bash
npm install -g token-gate-mcp
```

```json
{
  "mcpServers": {
    "token-gate": {
      "command": "token-gate-mcp",
      "args": []
    }
  }
}
```

## License

MIT. Part of the Tawakkul Labs MCP family.
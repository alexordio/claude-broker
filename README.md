# claude-broker

MCP server that acts as a message broker between Claude Code sessions working on different repos. Enables cross-repo communication for features that span multiple services.

## How it works

```
┌──────────────────┐     ┌──────────────┐     ┌──────────────────┐
│ Claude Code       │     │ claude-broker│     │ Claude Code       │
│ (backend-api)     │────▶│ (MCP server) │◀────│ (frontend-app)    │
│                   │     │   SQLite DB  │     │                   │
│ publish_task      │     │              │     │ get_pending       │
│ get_result        │     │              │     │ submit_result     │
└──────────────────┘     └──────────────┘     └──────────────────┘
```

Each Claude Code session connects to the same MCP server. Sessions register with a repo identity and can send/receive tasks through the broker.

## Setup

### 1. Install & build

```bash
cd claude-broker
npm install
npm run build
```

### 2. Configure in Claude Code

Add to your **global** Claude Code MCP settings (`~/.claude/settings.json`) so it's available across all repos:

```json
{
  "mcpServers": {
    "broker": {
      "command": "node",
      "args": ["/absolute/path/to/claude-broker/dist/index.js"],
      "env": {
        "BROKER_DB_PATH": "/absolute/path/to/claude-broker/data/broker.sqlite"
      }
    }
  }
}
```

> **Tip:** Use a shared `BROKER_DB_PATH` so all sessions read/write the same database.

### 3. Verify

In any Claude Code session:
```
> list sessions on the broker
```

## Tools

| Tool | Description |
|------|-------------|
| `register_session` | Register as a repo (e.g., "backend-api"). Do this first. |
| `list_sessions` | See all registered repos |
| `publish_task` | Send a task to a specific repo |
| `broadcast_task` | Send a task to ALL other repos |
| `get_pending` | Check for tasks waiting for your repo |
| `claim_task` | Mark a task as in-progress |
| `submit_result` | Submit results after completing a task |
| `fail_task` | Mark a task as failed with a reason |
| `get_result` | Check status/result of a task you sent |
| `get_history` | See recent task history for a repo |

## Usage flow

### Session A (backend-api)

```
You: register as backend-api on the broker

You: I just added POST /api/v2/invoices. Publish a contract to frontend-app
     with the request/response schema so they can update the client.

Claude: [calls publish_task with the endpoint schema as payload]
        Task published! ID: abc-123
```

### Session B (frontend-app)

```
You: register as frontend-app and check for pending tasks

Claude: [calls register_session, then get_pending]
        You have 1 pending task from backend-api:
        "New endpoint POST /api/v2/invoices - update client and types"

You: claim it and implement the changes

Claude: [calls claim_task, implements changes, calls submit_result]
```

### Back in Session A

```
You: check the result of task abc-123

Claude: [calls get_result]
        frontend-app completed the task. They updated:
        - src/api/invoices.ts (new client methods)
        - src/types/invoice.ts (new types)
        - src/hooks/useInvoices.ts (new hook)
```

## Task types

- **`contract`** — API/schema change that another repo needs to implement against
- **`request`** — Action needed from another repo (fix, feature, refactor)
- **`broadcast`** — Info that affects all repos (breaking change, shared types update)
- **`notify`** — FYI, no action required

## Data

All data persists in a SQLite database at `data/broker.sqlite` (configurable via `BROKER_DB_PATH` env var). Delete it to reset.

## Development

```bash
npm run dev   # Run with tsx (hot reload)
npm run build # Compile TypeScript
npm start     # Run compiled version
```

#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BrokerStore } from "./store.js";
const DB_PATH = process.env.BROKER_DB_PATH ?? undefined;
const store = new BrokerStore(DB_PATH);
const server = new McpServer({
    name: "claude-broker",
    version: "0.1.0",
});
// ─── register_session ───────────────────────────────────────────────
// Register this Claude Code session as a specific repo identity.
server.tool("register_session", "Register this Claude Code session as a repo. Call this first so the broker knows who you are.", {
    repo: z
        .string()
        .describe('Short repo identifier, e.g. "backend-api", "frontend-app", "shared-lib"'),
}, async ({ repo }) => {
    const session = store.registerSession(repo);
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({
                    ok: true,
                    message: `Session registered as "${repo}"`,
                    session,
                }, null, 2),
            },
        ],
    };
});
// ─── list_sessions ──────────────────────────────────────────────────
// See who's registered in the broker.
server.tool("list_sessions", "List all registered repo sessions and when they were last active.", {}, async () => {
    const sessions = store.listSessions();
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({ sessions }, null, 2),
            },
        ],
    };
});
// ─── publish_task ───────────────────────────────────────────────────
// Send a task to a specific repo.
server.tool("publish_task", "Send a task to another repo session. Use this when you need another repo to do something (update types, add endpoint, sync schema, etc).", {
    from_repo: z.string().describe("Your repo identifier (must be registered)"),
    to_repo: z.string().describe("Target repo identifier"),
    type: z
        .enum(["contract", "request", "broadcast", "notify"])
        .describe("Task type: contract (schema/API change), request (action needed), broadcast (info for all), notify (FYI)"),
    title: z.string().describe("Short description of what needs to happen"),
    payload: z
        .string()
        .describe("JSON string with details: schemas, endpoints, file paths, instructions, etc."),
}, async ({ from_repo, to_repo, type, title, payload }) => {
    // Validate JSON payload
    try {
        JSON.parse(payload);
    }
    catch {
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        ok: false,
                        error: "payload must be a valid JSON string",
                    }),
                },
            ],
        };
    }
    const task = store.createTask({ from_repo, to_repo, type, title, payload });
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({
                    ok: true,
                    message: `Task published to "${to_repo}"`,
                    task_id: task.id,
                    task,
                }, null, 2),
            },
        ],
    };
});
// ─── broadcast_task ─────────────────────────────────────────────────
// Send a task to ALL other registered repos.
server.tool("broadcast_task", "Send a task to ALL other registered repos. Use for breaking changes, shared type updates, or announcements that affect everyone.", {
    from_repo: z.string().describe("Your repo identifier"),
    type: z
        .enum(["contract", "request", "broadcast", "notify"])
        .describe("Task type"),
    title: z.string().describe("Short description"),
    payload: z.string().describe("JSON string with details"),
}, async ({ from_repo, type, title, payload }) => {
    try {
        JSON.parse(payload);
    }
    catch {
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        ok: false,
                        error: "payload must be a valid JSON string",
                    }),
                },
            ],
        };
    }
    const tasks = store.broadcastTask({ from_repo, type, title, payload });
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({
                    ok: true,
                    message: `Broadcast sent to ${tasks.length} repo(s)`,
                    task_ids: tasks.map((t) => ({ id: t.id, to: t.to_repo })),
                }, null, 2),
            },
        ],
    };
});
// ─── get_pending ────────────────────────────────────────────────────
// Check for pending tasks addressed to your repo.
server.tool("get_pending", "Check for pending tasks addressed to your repo. Call this to see if other repos need you to do something.", {
    repo: z.string().describe("Your repo identifier"),
}, async ({ repo }) => {
    const tasks = store.getPending(repo);
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({
                    ok: true,
                    pending_count: tasks.length,
                    tasks,
                }, null, 2),
            },
        ],
    };
});
// ─── claim_task ─────────────────────────────────────────────────────
// Mark a task as in-progress so other sessions know you're working on it.
server.tool("claim_task", "Mark a pending task as in-progress. Call this before you start working on a task.", {
    task_id: z.string().describe("The task ID to claim"),
}, async ({ task_id }) => {
    const task = store.claimTask(task_id);
    if (!task) {
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        ok: false,
                        error: "Task not found or already claimed",
                    }),
                },
            ],
        };
    }
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({ ok: true, task }, null, 2),
            },
        ],
    };
});
// ─── submit_result ──────────────────────────────────────────────────
// Submit the result of a completed task.
server.tool("submit_result", "Submit the result after completing a task. Include what you changed, files modified, any notes for the requesting repo.", {
    task_id: z.string().describe("The task ID you completed"),
    result: z
        .string()
        .describe("JSON string with results: files changed, summary of work, any follow-up needed"),
}, async ({ task_id, result }) => {
    try {
        JSON.parse(result);
    }
    catch {
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        ok: false,
                        error: "result must be a valid JSON string",
                    }),
                },
            ],
        };
    }
    const task = store.completeTask(task_id, result);
    if (!task) {
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ ok: false, error: "Task not found" }),
                },
            ],
        };
    }
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({ ok: true, message: "Task completed", task }, null, 2),
            },
        ],
    };
});
// ─── fail_task ──────────────────────────────────────────────────────
// Mark a task as failed with a reason.
server.tool("fail_task", "Mark a task as failed if you can't complete it. Include the reason so the requesting repo can adjust.", {
    task_id: z.string().describe("The task ID that failed"),
    reason: z.string().describe("Why the task failed"),
}, async ({ task_id, reason }) => {
    const task = store.failTask(task_id, reason);
    if (!task) {
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ ok: false, error: "Task not found" }),
                },
            ],
        };
    }
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({ ok: true, message: "Task marked as failed", task }, null, 2),
            },
        ],
    };
});
// ─── get_result ─────────────────────────────────────────────────────
// Check the result of a task you published.
server.tool("get_result", "Check the status and result of a task you published. Use the task_id you got from publish_task.", {
    task_id: z.string().describe("The task ID to check"),
}, async ({ task_id }) => {
    const task = store.getResult(task_id);
    if (!task) {
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ ok: false, error: "Task not found" }),
                },
            ],
        };
    }
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({ ok: true, task }, null, 2),
            },
        ],
    };
});
// ─── get_history ────────────────────────────────────────────────────
// See recent task history for a repo.
server.tool("get_history", "Get recent task history for a repo (both sent and received).", {
    repo: z.string().describe("Repo identifier"),
    limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(20)
        .describe("Max number of tasks to return"),
}, async ({ repo, limit }) => {
    const tasks = store.getTasksByRepo(repo, limit);
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({ ok: true, count: tasks.length, tasks }, null, 2),
            },
        ],
    };
});
// ─── Start server ───────────────────────────────────────────────────
async function main() {
    await store.init();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("claude-broker MCP server running on stdio");
}
main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map
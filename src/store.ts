import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface Session {
  id: string;
  repo: string;
  registered_at: string;
  last_seen: string;
}

export interface Task {
  id: string;
  from_repo: string;
  to_repo: string;
  type: "contract" | "request" | "broadcast" | "notify";
  title: string;
  payload: string;
  status: "pending" | "in_progress" | "done" | "failed";
  result: string | null;
  created_at: string;
  updated_at: string;
}

export class BrokerStore {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const resolvedPath =
      dbPath ?? join(__dirname, "..", "data", "broker.sqlite");
    const dir = dirname(resolvedPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(resolvedPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        repo TEXT NOT NULL UNIQUE,
        registered_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_seen TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        from_repo TEXT NOT NULL,
        to_repo TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('contract', 'request', 'broadcast', 'notify')),
        title TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'done', 'failed')),
        result TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_tasks_to_repo_status ON tasks(to_repo, status)",
    );
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_tasks_from_repo ON tasks(from_repo)",
    );
  }

  async init(): Promise<void> {
    // No-op, kept for API compatibility. DB is initialized in constructor.
  }

  // --- Sessions ---

  registerSession(repo: string): Session {
    const id = crypto.randomUUID();
    this.db
      .prepare(
        `INSERT INTO sessions (id, repo) VALUES (?, ?)
       ON CONFLICT(repo) DO UPDATE SET last_seen = datetime('now')`,
      )
      .run(id, repo);
    return this.getSession(repo)!;
  }

  getSession(repo: string): Session | undefined {
    return this.db
      .prepare("SELECT * FROM sessions WHERE repo = ?")
      .get(repo) as Session | undefined;
  }

  listSessions(): Session[] {
    return this.db
      .prepare("SELECT * FROM sessions ORDER BY last_seen DESC")
      .all() as Session[];
  }

  touchSession(repo: string): void {
    this.db
      .prepare("UPDATE sessions SET last_seen = datetime('now') WHERE repo = ?")
      .run(repo);
  }

  // --- Tasks ---

  createTask(params: {
    from_repo: string;
    to_repo: string;
    type: Task["type"];
    title: string;
    payload: string;
  }): Task {
    const id = crypto.randomUUID();
    this.db
      .prepare(
        `INSERT INTO tasks (id, from_repo, to_repo, type, title, payload)
       VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        params.from_repo,
        params.to_repo,
        params.type,
        params.title,
        params.payload,
      );
    return this.getTask(id)!;
  }

  broadcastTask(params: {
    from_repo: string;
    type: Task["type"];
    title: string;
    payload: string;
  }): Task[] {
    const sessions = this.listSessions().filter(
      (s) => s.repo !== params.from_repo,
    );
    const tasks: Task[] = [];
    for (const session of sessions) {
      tasks.push(
        this.createTask({
          ...params,
          to_repo: session.repo,
        }),
      );
    }
    return tasks;
  }

  getTask(id: string): Task | undefined {
    return this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as
      | Task
      | undefined;
  }

  getPending(repo: string): Task[] {
    this.touchSession(repo);
    return this.db
      .prepare(
        "SELECT * FROM tasks WHERE to_repo = ? AND status = 'pending' ORDER BY created_at ASC",
      )
      .all(repo) as Task[];
  }

  getTasksByRepo(repo: string, limit = 20): Task[] {
    return this.db
      .prepare(
        `SELECT * FROM tasks
       WHERE from_repo = ? OR to_repo = ?
       ORDER BY created_at DESC LIMIT ?`,
      )
      .all(repo, repo, limit) as Task[];
  }

  claimTask(id: string): Task | undefined {
    this.db
      .prepare(
        "UPDATE tasks SET status = 'in_progress', updated_at = datetime('now') WHERE id = ? AND status = 'pending'",
      )
      .run(id);
    return this.getTask(id);
  }

  completeTask(id: string, result: string): Task | undefined {
    this.db
      .prepare(
        "UPDATE tasks SET status = 'done', result = ?, updated_at = datetime('now') WHERE id = ?",
      )
      .run(result, id);
    return this.getTask(id);
  }

  failTask(id: string, reason: string): Task | undefined {
    this.db
      .prepare(
        "UPDATE tasks SET status = 'failed', result = ?, updated_at = datetime('now') WHERE id = ?",
      )
      .run(reason, id);
    return this.getTask(id);
  }

  getResult(taskId: string): Task | undefined {
    return this.getTask(taskId);
  }

  close(): void {
    this.db.close();
  }
}

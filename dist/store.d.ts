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
export declare class BrokerStore {
    private db;
    constructor(dbPath?: string);
    init(): Promise<void>;
    registerSession(repo: string): Session;
    getSession(repo: string): Session | undefined;
    listSessions(): Session[];
    touchSession(repo: string): void;
    createTask(params: {
        from_repo: string;
        to_repo: string;
        type: Task["type"];
        title: string;
        payload: string;
    }): Task;
    broadcastTask(params: {
        from_repo: string;
        type: Task["type"];
        title: string;
        payload: string;
    }): Task[];
    getTask(id: string): Task | undefined;
    getPending(repo: string): Task[];
    getTasksByRepo(repo: string, limit?: number): Task[];
    claimTask(id: string): Task | undefined;
    completeTask(id: string, result: string): Task | undefined;
    failTask(id: string, reason: string): Task | undefined;
    getResult(taskId: string): Task | undefined;
    close(): void;
}
//# sourceMappingURL=store.d.ts.map
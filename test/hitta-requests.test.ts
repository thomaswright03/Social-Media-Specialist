import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import {
  checkReadOnly,
  checkTables,
  claudeAnswerer,
  libsqlQueryDb,
  handleHittaRequests,
  spokenAnswer,
  type HittaRequest,
} from "../src/hitta-requests.ts";

type Call = { url: string; init: RequestInit };

function fakeHitta(requests: unknown, opts: { listStatus?: number; answerStatus?: number } = {}) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    if (url.endsWith("/requests")) {
      return new Response(JSON.stringify(requests), { status: opts.listStatus ?? 200 });
    }
    return new Response("{}", { status: opts.answerStatus ?? 200 });
  }) as unknown as typeof fetch;
  const answers = () =>
    calls
      .filter((c) => c.init.method === "POST")
      .map((c) => ({ url: c.url, answer: (JSON.parse(String(c.init.body)) as { answer: string }).answer }));
  return { fetchImpl, calls, answers };
}

const req = (id: string, request: string, asked_at: string, kind: "question" | "task" = "question"): HittaRequest => ({ id, kind, request, asked_at });

describe("Hitta requests", () => {
  const saved = process.env.HITTA_API_KEY;
  beforeEach(() => {
    process.env.HITTA_API_KEY = "test-key";
  });
  afterEach(() => {
    process.env.HITTA_API_KEY = saved;
  });

  it("answers every request, oldest first, with the key as a bearer token", async () => {
    const hitta = fakeHitta({
      requests: [req("req_2", "second", "2026-10-15T10:05:00Z"), req("req_1", "first", "2026-10-15T10:00:00Z")],
    });
    const result = await handleHittaRequests({ answerer: async (r) => `**Answer** to ${r.request}`, fetch: hitta.fetchImpl });
    expect(result).toEqual({ answered: 2, unanswered: [], fetchError: null });
    expect(hitta.calls[0]!.url).toBe("https://34-67-123-90.sslip.io/requests");
    expect((hitta.calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    expect(hitta.answers()).toEqual([
      { url: "https://34-67-123-90.sslip.io/requests/req_1/answer", answer: "Answer to first" },
      { url: "https://34-67-123-90.sslip.io/requests/req_2/answer", answer: "Answer to second" },
    ]);
  });

  it("still answers when the request can't be done, saying why", async () => {
    const hitta = fakeHitta({ requests: [req("req_1", "do it", "2026-10-15T10:00:00Z", "task")] });
    await handleHittaRequests({
      answerer: async () => {
        throw new Error("the database is down.");
      },
      fetch: hitta.fetchImpl,
    });
    expect(hitta.answers()[0]!.answer).toBe("Sorry, I couldn't do that because the database is down.");
  });

  it("reports when the requests can't be read, without the key", async () => {
    const hitta = fakeHitta({}, { listStatus: 401 });
    const result = await handleHittaRequests({ answerer: async () => "x", fetch: hitta.fetchImpl });
    expect(result.fetchError).toContain("401");
    expect(result.fetchError).not.toContain("test-key");
    expect(hitta.answers()).toEqual([]);
  });

  it("counts an answer Hitta didn't take", async () => {
    const hitta = fakeHitta({ requests: [req("req_1", "q", "2026-10-15T10:00:00Z")] }, { answerStatus: 500 });
    const result = await handleHittaRequests({ answerer: async () => "ok", fetch: hitta.fetchImpl });
    expect(result).toEqual({ answered: 0, unanswered: ["req_1"], fetchError: null });
  });

  it("needs the key", async () => {
    delete process.env.HITTA_API_KEY;
    const result = await handleHittaRequests({ answerer: async () => "x", fetch: fakeHitta({ requests: [] }).fetchImpl });
    expect(result.fetchError).toBe("HITTA_API_KEY isn't set");
  });
});

describe("spoken answers", () => {
  it("drops markdown, lists and links", () => {
    expect(spokenAnswer("## Today\n- **12** emails sent\n- see https://x.test\n")).toBe("Today 12 emails sent see");
  });

  it("keeps long answers short, at a sentence", () => {
    const answer = spokenAnswer("This is one sentence of a long answer. ".repeat(40));
    expect(answer.length).toBeLessThanOrEqual(700);
    expect(answer.endsWith(".")).toBe(true);
  });
});

describe("read-only queries", () => {
  it("allows one SELECT", () => {
    expect(checkReadOnly(`SELECT count(*) FROM "Lead" WHERE note = 'drop table';`)).toBe(`SELECT count(*) FROM "Lead" WHERE note = 'drop table'`);
    expect(checkReadOnly("with x as (select 1) select * from x")).toContain("with");
  });

  it("refuses writes, second statements and dangerous functions", () => {
    expect(() => checkReadOnly(`DELETE FROM "Lead"`)).toThrow();
    expect(() => checkReadOnly(`SELECT 1; DROP TABLE "Lead"`)).toThrow();
    expect(() => checkReadOnly(`WITH d AS (DELETE FROM "Lead" RETURNING *) SELECT * FROM d`)).toThrow();
    expect(() => checkReadOnly(`SELECT * INTO copy FROM "Lead"`)).toThrow();
    expect(() => checkReadOnly(`SELECT set_config('default_transaction_read_only', 'off', false)`)).toThrow();
    expect(() => checkReadOnly(`SELECT pg_terminate_backend(1)`)).toThrow();
  });
});

describe("tables Hitta may read (security check, 2026-11-21)", () => {
  const all = ["SocialPost", "SocialToken", "_secret"];
  it("refuses a table outside the list however it's written", () => {
    expect(() => checkTables(`SELECT * FROM "SocialPost"`, all, ["SocialPost"])).not.toThrow();
    expect(() => checkTables(`SELECT * FROM SocialToken`, all, ["SocialPost"])).toThrow(/SocialToken/);
    expect(() => checkTables(`SELECT * FROM 'SocialToken'`, all, ["SocialPost"])).toThrow(/SocialToken/);
    expect(() => checkTables(`SELECT * FROM [_secret]`, all, ["SocialPost"])).toThrow(/_secret/);
    expect(() => checkTables(`SELECT * FROM pragma_table_list`, all, ["SocialPost"])).toThrow();
    expect(() => checkTables(`SELECT name FROM pragma_table_info('SocialPost')`, all, ["SocialPost"])).toThrow();
  });

  it("knows the tables whose names start with _ too", async () => {
    const client = createClient({ url: ":memory:" });
    await client.execute(`CREATE TABLE "SocialPost" ("id" TEXT)`);
    await client.execute(`CREATE TABLE "_secret" ("v" TEXT)`);
    await client.execute(`INSERT INTO "_secret" VALUES ('x')`);
    const db = libsqlQueryDb(client, ["SocialPost"], "");
    await db.load();
    await expect(db.query(`SELECT * FROM "_secret"`)).rejects.toThrow(/_secret/);
    await expect(db.query(`SELECT * FROM 'SocialPost'`)).resolves.toEqual([]);
    expect(db.describe).not.toContain("_secret");
  });
});

describe("answering with Claude", () => {
  const request = req("req_1", "How many emails did you send today?", "2026-10-15T18:00:00Z");

  it("looks things up, then answers from the results", async () => {
    const prompts: string[] = [];
    const replies = [
      JSON.stringify({ queries: [{ db: "main", sql: "SELECT count(*) AS n FROM sends" }] }),
      JSON.stringify({ answer: "I sent 42 emails today.", action: null }),
    ];
    const queries: string[] = [];
    const answerer = claudeAnswerer({
      role: "You are a test employee.",
      facts: async () => ({ paused: false }),
      databases: { main: { describe: "sends(id)", query: async (sql) => (queries.push(sql), [{ n: 42 }]) } },
      actions: {},
      ask: async (prompt) => (prompts.push(prompt), replies.shift()!),
    });
    expect(await answerer(request)).toBe("I sent 42 emails today.");
    expect(queries).toEqual(["SELECT count(*) AS n FROM sends"]);
    expect(prompts[0]).toContain("How many emails did you send today?");
    expect(prompts[1]).toContain('[{"n":42}]');
  });

  it("does a task only through a listed action", async () => {
    const done: unknown[] = [];
    const make = (reply: object) =>
      claudeAnswerer({
        role: "r",
        facts: async () => ({}),
        databases: {},
        actions: { pause: { description: "pause", run: async (args) => (done.push(args), "Paused.") } },
        ask: async () => JSON.stringify(reply),
      });
    expect(await make({ answer: "Paused it.", action: { name: "pause", args: { a: 1 } } })(request)).toBe("Paused it.");
    expect(done).toEqual([{ a: 1 }]);
    expect(await make({ answer: "Deleted.", action: { name: "delete_everything" } })(request)).toContain("isn't something I'm allowed to do");
  });

  it("says so when the action fails", async () => {
    const answerer = claudeAnswerer({
      role: "r",
      facts: async () => ({}),
      databases: {},
      actions: {
        pause: {
          description: "pause",
          run: async () => {
            throw new Error("the switch is stuck");
          },
        },
      },
      ask: async () => JSON.stringify({ answer: "Paused.", action: { name: "pause" } }),
    });
    expect(await answerer(request)).toBe("I tried, but it didn't work: the switch is stuck.");
  });

  it("refuses a write query and tells Claude why", async () => {
    const prompts: string[] = [];
    const replies = [JSON.stringify({ queries: [{ db: "main", sql: "DELETE FROM sends" }] }), JSON.stringify({ answer: "I can't.", action: null })];
    const answerer = claudeAnswerer({
      role: "r",
      facts: async () => ({}),
      databases: { main: { describe: "", query: async () => [] } },
      actions: {},
      ask: async (prompt) => (prompts.push(prompt), replies.shift()!),
    });
    expect(await answerer(request)).toBe("I can't.");
    expect(prompts[1]).toContain("error: only SELECT queries are allowed");
  });

  it("gives up when Claude never answers", async () => {
    const answerer = claudeAnswerer({ role: "r", facts: async () => ({}), databases: {}, actions: {}, ask: async () => "no json here" });
    await expect(answerer(request)).rejects.toThrow("couldn't work out an answer");
  });
});

describe("Claude subprocesses (security check, 2026-11-21)", () => {
  it("get only what the CLI needs, never the run's secrets", async () => {
    const { claudeEnv, claudeArgs } = await import("../src/hitta-requests.ts");
    const env = claudeEnv({
      PATH: "/bin", HOME: "/home/runner", CLAUDE_CODE_OAUTH_TOKEN: "oauth", LANG: "C.UTF-8",
      VAULT_DATABASE_AUTH_TOKEN: "v", VAULT_DATABASE_URL: "u", INSTAGRAM_ACCESS_TOKEN: "i", HITTA_API_KEY: "h", YOUTUBE_REFRESH_TOKEN: "y",
      YOUTUBE_CLIENT_SECRET: "c", META_APP_SECRET: "m", ELEVENLABS_API_KEY: "e", GITHUB_TOKEN: "g", ACTIONS_RUNTIME_TOKEN: "a", SOCIAL_SEAL_KEY: "s",
    });
    expect(Object.keys(env).sort()).toEqual(["CLAUDE_CODE_OAUTH_TOKEN", "HOME", "LANG", "PATH"]);
    // No tools unless named; Read never reaches the process files.
    expect(claudeArgs({ model: "sonnet" })).toEqual(expect.arrayContaining(["--tools", ""]));
    const read = claudeArgs({ model: "sonnet", tools: ["Read"], maxTurns: 40 });
    expect(read.join(" ")).toMatch(/--tools Read --allowedTools Read --disallowedTools Read\(\/\/proc\/\*\*\)/);
  });
});

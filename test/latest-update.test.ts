import { describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import { readFileSync } from "node:fs";
import { LATEST_UPDATE_FILE, parseLatestUpdate, syncLatestUpdate } from "../src/latest-update.ts";
import { Vault } from "../src/vault.ts";

describe("the Latest Update box", () => {
  it("the repo's LATEST_UPDATE.json is well formed", () => {
    const u = parseLatestUpdate(readFileSync(LATEST_UPDATE_FILE, "utf8"));
    expect(u.frontend.length).toBeGreaterThan(0);
    expect(() => parseLatestUpdate(`{"date":"x","summary":"y","frontend":"no"}`)).toThrow(/frontend/);
  });

  it("goes into the Vault under its own id, only when it changed, without touching the run's status", async () => {
    const db = createClient({ url: ":memory:" });
    const vault = new Vault(db);
    await vault.ensureTables();
    expect(await syncLatestUpdate(vault)).toBe(true);
    expect(await syncLatestUpdate(vault)).toBe(false);
    const rs = await db.execute(`SELECT "id", "snapshot" FROM "SocialStatus"`);
    expect(rs.rows.map((r) => r.id)).toEqual(["latest-update"]);
    expect(JSON.parse(String(rs.rows[0]?.snapshot)).date).toBeTruthy();
    expect(await vault.latestStatus()).toBeNull();
  });
});

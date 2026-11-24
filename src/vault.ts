// The Social Media Specialist's place in the Vault's database (Turso). It
// creates these tables if they're missing (Turso can't run `prisma migrate
// deploy`); the Vault's prisma/schema.prisma has the same tables, and the
// Vault creates them too (src/lib/social.ts), so its page works before the
// specialist's first run.
//
//   SocialPost      one row per post, from draft to published:
//                     draft       waiting for Thomas on the Vault page
//                     approved    Thomas said yes; goes out at scheduledFor
//                     publishing  being sent to Instagram right now
//                     published   on Instagram (permalink, then likes and reach)
//                     failed      Instagram refused it (error says why); Thomas can try again
//                     rejected    Thomas said no (note is his reason, which the next drafts learn from)
//   SocialIdea      "make a post about…" from Thomas (Hitta or the page), used first
//   SocialSettings  paused, posts a week, which days and what time, his brief, products left out
//   SocialStatus    the latest run, for the Vault page (one row, id "social")
//   SocialAlert     reports already sent, so each goes out once
//   SocialToken     the Instagram token after its last refresh, sealed (never shown to Hitta or the page)
//   SocialAction    the history: every change it makes on Instagram and every step it takes
//                   (posted, drafted, diagnosed, a gate passed or failed), newest first on the page
//   SocialStage     the content pipeline's stage results (pipeline/README.md): what each stage
//                   produced and the result of its gate, one row per attempt
//   SocialLesson    what the pipeline has learned: winning patterns, things to avoid, and the
//                   checks stage 8 adds to stages 3 to 6
//
// It also reads the Vault's Product table, never writing to it.
import { createHash, createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { createClient, type Client, type InValue, type Row } from "@libsql/client";

export type PostState = "draft" | "approved" | "publishing" | "published" | "failed" | "rejected";
export type PostKind = "screenshot" | "card" | "reel";
export const THEMES = ["ink", "ocean", "sunset", "forest", "sand"] as const;
export type Theme = (typeof THEMES)[number];

export type Post = {
  id: string;
  platform: string;
  productId: string | null;
  productName: string | null;
  ideaId: string | null;
  kind: PostKind;
  angle: string | null;
  headline: string;
  subline: string | null;
  caption: string;
  hashtags: string[];
  theme: Theme;
  sourceUrl: string | null;
  mediaToken: string;
  state: PostState;
  note: string | null;
  scheduledFor: string | null;
  approvedAt: string | null;
  decidedAt: string | null;
  publishedAt: string | null;
  igMediaId: string | null;
  permalink: string | null;
  error: string | null;
  attempts: number;
  likes: number | null;
  comments: number | null;
  reach: number | null;
  saves: number | null;
  shares: number | null;
  views: number | null;
  statsAt: string | null;
  createdAt: string;
};

export type Idea = { id: string; text: string; productId: string | null; source: string; createdAt: string; usedAt: string | null; postId: string | null };

export type Product = { id: string; name: string; description: string | null; url: string };

export type SocialSettings = {
  paused: boolean;
  postsPerWeek: number;
  /** Days posts go out, 0 = Sunday … 6 = Saturday, Arizona time. */
  postDays: number[];
  /** "HH:MM", Arizona time. */
  postTime: string;
  /** Thomas's steer: voice, audience, what to push. */
  brief: string | null;
  /** Vault Product ids he doesn't want posted about. */
  leftOut: string[];
};
export const DEFAULT_SETTINGS: SocialSettings = { paused: false, postsPerWeek: 3, postDays: [1, 3, 5], postTime: "11:30", brief: null, leftOut: [] };

export type SocialSnapshot = {
  checkedAt: string;
  /** The Instagram account the token belongs to, when it could be read. */
  account: { username: string; followers: number | null; posts: number | null } | null;
  instagramOk: boolean;
  instagramError?: string;
  tokenExpiresAt: string | null;
  drafted: number;
  waiting: number;
  scheduled: number;
  published30d: number;
  error?: string;
  notes: string[];
};

// The Vault's copies of these statements (src/lib/social.ts) must match.
export const CREATE_TABLES = [
  `CREATE TABLE IF NOT EXISTS "SocialPost" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "platform" TEXT NOT NULL DEFAULT 'instagram',
  "productId" TEXT,
  "productName" TEXT,
  "ideaId" TEXT,
  "kind" TEXT NOT NULL DEFAULT 'screenshot',
  "angle" TEXT,
  "headline" TEXT NOT NULL,
  "subline" TEXT,
  "caption" TEXT NOT NULL,
  "hashtags" TEXT NOT NULL DEFAULT '[]',
  "theme" TEXT NOT NULL DEFAULT 'ink',
  "sourceUrl" TEXT,
  "image" BLOB,
  "imageType" TEXT NOT NULL DEFAULT 'image/jpeg',
  "mediaToken" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'draft',
  "note" TEXT,
  "scheduledFor" DATETIME,
  "approvedAt" DATETIME,
  "decidedAt" DATETIME,
  "publishedAt" DATETIME,
  "igContainerId" TEXT,
  "igMediaId" TEXT,
  "permalink" TEXT,
  "error" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "likes" INTEGER,
  "comments" INTEGER,
  "reach" INTEGER,
  "saves" INTEGER,
  "shares" INTEGER,
  "views" INTEGER,
  "statsAt" DATETIME,
  "createdAt" DATETIME NOT NULL,
  "updatedAt" DATETIME NOT NULL
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "SocialPost_mediaToken_key" ON "SocialPost"("mediaToken")`,
  `CREATE INDEX IF NOT EXISTS "SocialPost_state_scheduledFor_idx" ON "SocialPost"("state", "scheduledFor")`,
  `CREATE TABLE IF NOT EXISTS "SocialIdea" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "text" TEXT NOT NULL,
  "productId" TEXT,
  "source" TEXT NOT NULL DEFAULT 'vault',
  "createdAt" DATETIME NOT NULL,
  "usedAt" DATETIME,
  "postId" TEXT
)`,
  `CREATE TABLE IF NOT EXISTS "SocialSettings" (
  "id" INTEGER NOT NULL PRIMARY KEY,
  "paused" BOOLEAN NOT NULL DEFAULT false,
  "postsPerWeek" INTEGER NOT NULL DEFAULT 3,
  "postDays" TEXT NOT NULL DEFAULT '1,3,5',
  "postTime" TEXT NOT NULL DEFAULT '11:30',
  "brief" TEXT,
  "leftOut" TEXT NOT NULL DEFAULT '[]',
  "updatedAt" DATETIME NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS "SocialStatus" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "ok" BOOLEAN NOT NULL DEFAULT true,
  "snapshot" TEXT NOT NULL,
  "updatedAt" DATETIME NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS "SocialAlert" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "urgency" TEXT NOT NULL,
  "sentAt" DATETIME NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS "SocialToken" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sealed" TEXT NOT NULL,
  "seed" TEXT NOT NULL,
  "expiresAt" DATETIME,
  "refreshedAt" DATETIME NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS "SocialAction" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "kind" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "detail" TEXT,
  "target" TEXT,
  "onInstagram" BOOLEAN NOT NULL DEFAULT false,
  "ok" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL
)`,
  `CREATE INDEX IF NOT EXISTS "SocialAction_createdAt_idx" ON "SocialAction"("createdAt")`,
  `CREATE TABLE IF NOT EXISTS "SocialStage" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "stage" INTEGER NOT NULL,
  "subject" TEXT NOT NULL DEFAULT 'account',
  "attempt" INTEGER NOT NULL DEFAULT 1,
  "passed" BOOLEAN NOT NULL DEFAULT false,
  "output" TEXT NOT NULL,
  "gate" TEXT NOT NULL,
  "input" TEXT,
  "createdAt" DATETIME NOT NULL
)`,
  `CREATE INDEX IF NOT EXISTS "SocialStage_stage_createdAt_idx" ON "SocialStage"("stage", "createdAt")`,
  `CREATE TABLE IF NOT EXISTS "SocialLesson" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "kind" TEXT NOT NULL,
  "stage" INTEGER,
  "text" TEXT NOT NULL,
  "evidence" TEXT,
  "source" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL
)`,
];

export type ActionKind = "posted" | "post_failed" | "drafted" | "token_refreshed" | "settings" | "idea" | "turned_down" | "stage" | "lesson" | "instagram";
export type ActionEntry = { id: string; kind: string; summary: string; detail: string | null; target: string | null; onInstagram: boolean; ok: boolean; createdAt: string };
export type StageRecord = { id: string; stage: number; subject: string; attempt: number; passed: boolean; output: unknown; gate: unknown; createdAt: string };
export type LessonKind = "pattern" | "avoid" | "check";
export type Lesson = { id: string; kind: LessonKind; stage: number | null; text: string; evidence: string | null; source: string; createdAt: string };

/** Dates the way the Vault (Prisma) stores them, so text comparisons sort right. */
export function vaultNow(date = new Date()): string {
  return date.toISOString().replace("Z", "+00:00");
}

const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
function iso(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const t = typeof v === "number" ? v : Date.parse(String(v));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
export function jsonList(v: unknown): string[] {
  try {
    const parsed = JSON.parse(String(v ?? "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function rowToPost(r: Row): Post {
  return {
    id: String(r.id),
    platform: String(r.platform ?? "instagram"),
    productId: str(r.productId),
    productName: str(r.productName),
    ideaId: str(r.ideaId),
    kind: r.kind === "card" || r.kind === "reel" ? r.kind : "screenshot",
    angle: str(r.angle),
    headline: String(r.headline ?? ""),
    subline: str(r.subline),
    caption: String(r.caption ?? ""),
    hashtags: jsonList(r.hashtags),
    theme: (THEMES as readonly string[]).includes(String(r.theme)) ? (String(r.theme) as Theme) : "ink",
    sourceUrl: str(r.sourceUrl),
    mediaToken: String(r.mediaToken),
    state: String(r.state) as PostState,
    note: str(r.note),
    scheduledFor: iso(r.scheduledFor),
    approvedAt: iso(r.approvedAt),
    decidedAt: iso(r.decidedAt),
    publishedAt: iso(r.publishedAt),
    igMediaId: str(r.igMediaId),
    permalink: str(r.permalink),
    error: str(r.error),
    attempts: Number(r.attempts ?? 0),
    likes: num(r.likes),
    comments: num(r.comments),
    reach: num(r.reach),
    saves: num(r.saves),
    shares: num(r.shares),
    views: num(r.views),
    statsAt: iso(r.statsAt),
    createdAt: iso(r.createdAt) ?? new Date(0).toISOString(),
  };
}

// Every column but the image, which is only read to serve it.
const POST_COLUMNS = `"id","platform","productId","productName","ideaId","kind","angle","headline","subline","caption","hashtags","theme","sourceUrl","mediaToken","state","note","scheduledFor","approvedAt","decidedAt","publishedAt","igMediaId","permalink","error","attempts","likes","comments","reach","saves","shares","views","statsAt","createdAt"`;

export type NewPost = Pick<Post, "productId" | "productName" | "ideaId" | "kind" | "angle" | "headline" | "subline" | "caption" | "hashtags" | "theme" | "sourceUrl">;

// The key that seals the Instagram token in the database. SOCIAL_SEAL_KEY is
// the specialist's own secret (security check, 2026-11-21): with it set, the
// shared Vault database token alone no longer opens the stored Instagram token.
// Without it, the old key (made from the database token) keeps working.
export function legacySealKey(): Buffer {
  const secret = process.env.VAULT_DATABASE_AUTH_TOKEN?.trim() || process.env.VAULT_DATABASE_URL?.trim() || "";
  return createHash("sha256").update(`social-media-specialist:${secret}`).digest();
}

export function sealKey(): Buffer {
  const own = process.env.SOCIAL_SEAL_KEY?.trim();
  return own ? createHash("sha256").update(`social-seal:${own}`).digest() : legacySealKey();
}

/** Opens a stored token with the current key, or the old one; says when it needs sealing again. */
export function unsealStored(sealed: string): { token: string; reseal: boolean } | null {
  const token = unseal(sealed);
  if (token !== null) return { token, reseal: false };
  if (!process.env.SOCIAL_SEAL_KEY?.trim()) return null;
  const old = unseal(sealed, legacySealKey());
  return old === null ? null : { token: old, reseal: true };
}

export function seal(text: string, key = sealKey()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString("base64")).join(".");
}

export function unseal(sealed: string, key = sealKey()): string | null {
  try {
    const [iv, tag, body] = sealed.split(".").map((p) => Buffer.from(p, "base64"));
    if (!iv || !tag || !body) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Which pasted secret a stored token came from, without storing the secret. */
export const seedOf = (token: string) => createHash("sha256").update(token).digest("hex").slice(0, 16);

export type ReelStarted = {
  subject: string;
  format: string;
  productId: string | null;
  finalists: string[];
  /** Each finalist with how it ends and, for an explainer, the news items it's built on. */
  picks: { sentence: string; answer: string; news: number[] }[];
  /** The explainer's news list from stage 2. */
  news: { n: number; headline: string; publisher: string; url: string; published: string; summary: string }[];
  /** A series episode (src/pipeline/series.ts), or null. */
  series: { id: string; episode: number } | null;
  at: string;
};

export class Vault {
  private ready = false;
  constructor(private db: Client) {}

  static connect(url: string, authToken?: string): Vault {
    return new Vault(createClient({ url, authToken }));
  }

  get client(): Client {
    return this.db;
  }

  close(): void {
    this.db.close();
  }

  async ensureTables(): Promise<void> {
    if (this.ready) return;
    for (const sql of CREATE_TABLES) await this.db.execute(sql);
    this.ready = true;
  }

  // --- The Vault's own data (read-only) --------------------------------------

  /** Active products with a website, the ones it can post about. */
  async products(): Promise<Product[]> {
    // Active products only, and never one whose project Thomas retired (a
    // Product row can stay "active" after its project is retired).
    const rs = await this.db
      .execute(
        `SELECT "id", "name", "description", "url" FROM "Product" p WHERE "status" = 'active' AND "url" IS NOT NULL AND "url" != '' AND NOT EXISTS (SELECT 1 FROM "Project" r WHERE r."retiredAt" IS NOT NULL AND lower(trim(r."name")) = lower(trim(p."name"))) ORDER BY "name"`,
      )
      .catch(() => this.db.execute(`SELECT "id", "name", "description", "url" FROM "Product" WHERE "status" = 'active' AND "url" IS NOT NULL AND "url" != '' ORDER BY "name"`).catch(() => null));
    return (rs?.rows ?? []).map((r) => ({ id: String(r.id), name: String(r.name), description: str(r.description), url: String(r.url) }));
  }

  // --- Posts -----------------------------------------------------------------

  async posts(where = "1=1", args: InValue[] = []): Promise<Post[]> {
    await this.ensureTables();
    const rs = await this.db.execute({ sql: `SELECT ${POST_COLUMNS} FROM "SocialPost" WHERE ${where} ORDER BY "createdAt" DESC`, args });
    return rs.rows.map(rowToPost);
  }

  async post(id: string): Promise<Post | null> {
    return (await this.posts(`"id" = ?`, [id]))[0] ?? null;
  }

  async addPost(p: NewPost, image: Buffer, now = new Date()): Promise<Post> {
    await this.ensureTables();
    const id = randomUUID();
    const t = vaultNow(now);
    await this.db.execute({
      sql: `INSERT INTO "SocialPost" ("id","platform","productId","productName","ideaId","kind","angle","headline","subline","caption","hashtags","theme","sourceUrl","image","imageType","mediaToken","state","createdAt","updatedAt") VALUES (?,'instagram',?,?,?,?,?,?,?,?,?,?,?,?,'image/jpeg',?,'draft',?,?)`,
      args: [id, p.productId, p.productName, p.ideaId, p.kind, p.angle, p.headline, p.subline, p.caption, JSON.stringify(p.hashtags), p.theme, p.sourceUrl, image, randomBytes(16).toString("hex"), t, t],
    });
    return (await this.post(id))!;
  }

  async updatePost(id: string, data: Record<string, InValue>, now = new Date()): Promise<void> {
    const cols = Object.keys(data);
    await this.db.execute({
      sql: `UPDATE "SocialPost" SET ${cols.map((c) => `"${c}" = ?`).join(", ")}, "updatedAt" = ? WHERE "id" = ?`,
      args: [...cols.map((c) => data[c]!), vaultNow(now), id],
    });
  }

  /** Moves an approved post to publishing, only if nothing else did first. True when this run owns it. */
  async claimForPublishing(id: string, now = new Date()): Promise<boolean> {
    const rs = await this.db.execute({
      sql: `UPDATE "SocialPost" SET "state" = 'publishing', "attempts" = "attempts" + 1, "updatedAt" = ? WHERE "id" = ? AND "state" = 'approved'`,
      args: [vaultNow(now), id],
    });
    return rs.rowsAffected === 1;
  }

  /** Approved posts whose time has come, oldest first. */
  async duePosts(now = new Date()): Promise<Post[]> {
    const due = await this.posts(`"state" = 'approved' AND "scheduledFor" IS NOT NULL AND "scheduledFor" <= ?`, [vaultNow(now)]);
    return due.sort((a, b) => (a.scheduledFor ?? "").localeCompare(b.scheduledFor ?? ""));
  }

  // --- Ideas -----------------------------------------------------------------

  async openIdeas(): Promise<Idea[]> {
    await this.ensureTables();
    const rs = await this.db.execute(`SELECT * FROM "SocialIdea" WHERE "usedAt" IS NULL ORDER BY "createdAt" ASC`);
    return rs.rows.map((r) => ({ id: String(r.id), text: String(r.text), productId: str(r.productId), source: String(r.source), createdAt: iso(r.createdAt) ?? "", usedAt: null, postId: null }));
  }

  async addIdea(text: string, productId: string | null, source: string, now = new Date()): Promise<string> {
    await this.ensureTables();
    const id = randomUUID();
    await this.db.execute({ sql: `INSERT INTO "SocialIdea" ("id","text","productId","source","createdAt") VALUES (?,?,?,?,?)`, args: [id, text, productId, source, vaultNow(now)] });
    return id;
  }

  async useIdea(id: string, postId: string, now = new Date()): Promise<void> {
    await this.db.execute({ sql: `UPDATE "SocialIdea" SET "usedAt" = ?, "postId" = ? WHERE "id" = ?`, args: [vaultNow(now), postId, id] });
  }

  // --- Settings, status, alerts ----------------------------------------------

  async settings(): Promise<SocialSettings> {
    await this.ensureTables();
    const rs = await this.db.execute(`SELECT * FROM "SocialSettings" WHERE "id" = 1`);
    const r = rs.rows[0];
    if (!r) return { ...DEFAULT_SETTINGS };
    const days = String(r.postDays ?? "")
      .split(",")
      .map((d) => Number(d.trim()))
      .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    const time = /^\d{1,2}:\d{2}$/.test(String(r.postTime ?? "")) ? String(r.postTime) : DEFAULT_SETTINGS.postTime;
    return {
      paused: Boolean(Number(r.paused ?? 0)) || r.paused === "true",
      postsPerWeek: Math.min(Math.max(Number(r.postsPerWeek) || DEFAULT_SETTINGS.postsPerWeek, 1), 14),
      postDays: days.length ? days : DEFAULT_SETTINGS.postDays,
      postTime: time,
      brief: str(r.brief),
      leftOut: jsonList(r.leftOut),
    };
  }

  async saveSettings(patch: Partial<SocialSettings>, now = new Date()): Promise<void> {
    const s = { ...(await this.settings()), ...patch };
    await this.db.execute({
      sql: `INSERT INTO "SocialSettings" ("id","paused","postsPerWeek","postDays","postTime","brief","leftOut","updatedAt") VALUES (1,?,?,?,?,?,?,?)
            ON CONFLICT("id") DO UPDATE SET "paused" = excluded."paused", "postsPerWeek" = excluded."postsPerWeek", "postDays" = excluded."postDays", "postTime" = excluded."postTime", "brief" = excluded."brief", "leftOut" = excluded."leftOut", "updatedAt" = excluded."updatedAt"`,
      args: [s.paused ? 1 : 0, s.postsPerWeek, s.postDays.join(","), s.postTime, s.brief, JSON.stringify(s.leftOut), vaultNow(now)],
    });
  }

  async saveStatus(ok: boolean, snapshot: SocialSnapshot, now = new Date()): Promise<void> {
    await this.ensureTables();
    await this.db.execute({
      sql: `INSERT INTO "SocialStatus" ("id","ok","snapshot","updatedAt") VALUES ('social',?,?,?) ON CONFLICT("id") DO UPDATE SET "ok" = excluded."ok", "snapshot" = excluded."snapshot", "updatedAt" = excluded."updatedAt"`,
      args: [ok ? 1 : 0, JSON.stringify(snapshot), vaultNow(now)],
    });
  }

  /**
   * The Latest Update box on the specialist's Vault page (security check, 2026-11-21): the repo's
   * LATEST_UPDATE.json, kept in SocialStatus under its own id. Writes only when it changed.
   */
  async saveLatestUpdate(json: string, now = new Date()): Promise<boolean> {
    await this.ensureTables();
    const rs = await this.db.execute(`SELECT "snapshot" FROM "SocialStatus" WHERE "id" = 'latest-update'`);
    if (rs.rows[0] && String(rs.rows[0].snapshot) === json) return false;
    await this.db.execute({
      sql: `INSERT INTO "SocialStatus" ("id","ok","snapshot","updatedAt") VALUES ('latest-update',1,?,?) ON CONFLICT("id") DO UPDATE SET "snapshot" = excluded."snapshot", "updatedAt" = excluded."updatedAt"`,
      args: [json, vaultNow(now)],
    });
    return true;
  }

  /** Any SocialStatus row by id (the platforms report and the like), as saved. */
  async statusRow(id: string): Promise<{ ok: boolean; snapshot: string; updatedAt: string } | null> {
    await this.ensureTables();
    const rs = await this.db.execute({ sql: `SELECT "ok","snapshot","updatedAt" FROM "SocialStatus" WHERE "id" = ?`, args: [id] });
    const r = rs.rows[0];
    return r ? { ok: Boolean(Number(r.ok)), snapshot: String(r.snapshot), updatedAt: String(r.updatedAt) } : null;
  }

  async saveStatusRow(id: string, ok: boolean, snapshot: string, now = new Date()): Promise<void> {
    await this.ensureTables();
    await this.db.execute({
      sql: `INSERT INTO "SocialStatus" ("id","ok","snapshot","updatedAt") VALUES (?,?,?,?) ON CONFLICT("id") DO UPDATE SET "ok" = excluded."ok", "snapshot" = excluded."snapshot", "updatedAt" = excluded."updatedAt"`,
      args: [id, ok ? 1 : 0, snapshot, vaultNow(now)],
    });
  }

  async latestStatus(): Promise<{ ok: boolean; snapshot: SocialSnapshot; updatedAt: string } | null> {
    await this.ensureTables();
    const rs = await this.db.execute(`SELECT * FROM "SocialStatus" WHERE "id" = 'social'`);
    const r = rs.rows[0];
    if (!r) return null;
    try {
      return { ok: Boolean(Number(r.ok)), snapshot: JSON.parse(String(r.snapshot)) as SocialSnapshot, updatedAt: iso(r.updatedAt) ?? "" };
    } catch {
      return null;
    }
  }

  async alreadyReported(key: string): Promise<boolean> {
    await this.ensureTables();
    const rs = await this.db.execute({ sql: `SELECT 1 FROM "SocialAlert" WHERE "key" = ?`, args: [key] });
    return rs.rows.length > 0;
  }

  async markReported(key: string, title: string, urgency: string, now = new Date()): Promise<void> {
    await this.ensureTables();
    await this.db.execute({
      sql: `INSERT INTO "SocialAlert" ("key","title","urgency","sentAt") VALUES (?,?,?,?) ON CONFLICT("key") DO NOTHING`,
      args: [key, title, urgency, vaultNow(now)],
    });
  }

  // --- History ---------------------------------------------------------------

  /**
   * Records one thing it did, for the History on the Vault page. Everything
   * that changes Instagram goes through here (onInstagram), and so does every
   * pipeline step. A failure to record never stops the work it records.
   */
  async logAction(a: { kind: ActionKind; summary: string; detail?: string | null; target?: string | null; onInstagram?: boolean; ok?: boolean }, now = new Date()): Promise<void> {
    try {
      await this.ensureTables();
      await this.db.execute({
        sql: `INSERT INTO "SocialAction" ("id","kind","summary","detail","target","onInstagram","ok","createdAt") VALUES (?,?,?,?,?,?,?,?)`,
        args: [randomUUID(), a.kind, a.summary.slice(0, 500), a.detail?.slice(0, 4000) ?? null, a.target ?? null, a.onInstagram ? 1 : 0, a.ok === false ? 0 : 1, vaultNow(now)],
      });
    } catch {
      // The history is a record, not a gate.
    }
  }

  async actions(limit = 100): Promise<ActionEntry[]> {
    await this.ensureTables();
    const rs = await this.db.execute({ sql: `SELECT * FROM "SocialAction" ORDER BY "createdAt" DESC LIMIT ?`, args: [limit] });
    return rs.rows.map((r) => ({ id: String(r.id), kind: String(r.kind), summary: String(r.summary), detail: str(r.detail), target: str(r.target), onInstagram: Boolean(Number(r.onInstagram)), ok: Boolean(Number(r.ok)), createdAt: iso(r.createdAt) ?? "" }));
  }

  // --- The content pipeline --------------------------------------------------

  async saveStage(r: { stage: number; subject?: string; attempt: number; passed: boolean; output: unknown; gate: unknown; input?: unknown }, now = new Date()): Promise<string> {
    await this.ensureTables();
    const id = randomUUID();
    await this.db.execute({
      sql: `INSERT INTO "SocialStage" ("id","stage","subject","attempt","passed","output","gate","input","createdAt") VALUES (?,?,?,?,?,?,?,?,?)`,
      args: [id, r.stage, r.subject ?? "account", r.attempt, r.passed ? 1 : 0, JSON.stringify(r.output ?? null), JSON.stringify(r.gate ?? null), r.input === undefined ? null : JSON.stringify(r.input), vaultNow(now)],
    });
    return id;
  }

  /** Every passed stage 2 (one per Reel in the making): its format, product and finalists, newest first. */
  async reelsStarted(limit = 50): Promise<ReelStarted[]> {
    await this.ensureTables();
    const rs = await this.db.execute({ sql: `SELECT "subject", "input", "output", "createdAt" FROM "SocialStage" WHERE "stage" = 2 AND "passed" = 1 AND "subject" LIKE 'reel:%' ORDER BY "createdAt" DESC LIMIT ?`, args: [limit] });
    // The first try saves the input; later tries don't, so read it from the reel's first row.
    const out: ReelStarted[] = [];
    for (const r of rs.rows) {
      const subject = String(r.subject);
      const first = await this.db.execute({ sql: `SELECT "input" FROM "SocialStage" WHERE "stage" = 2 AND "subject" = ? AND "input" IS NOT NULL ORDER BY "createdAt" ASC LIMIT 1`, args: [subject] });
      let input: { format?: string; productId?: string | null; news?: ReelStarted["news"]; series?: ReelStarted["series"] } = {};
      let output: { pitches?: { id?: number; sentence?: string; answer?: string; news?: number[] }[]; finalists?: number[] } = {};
      try {
        input = JSON.parse(String(first.rows[0]?.input ?? "{}"));
      } catch {}
      try {
        output = JSON.parse(String(r.output ?? "{}"));
      } catch {}
      const picks = (output.finalists ?? [])
        .map((id) => output.pitches?.find((p) => p.id === id))
        .filter((p) => p?.sentence)
        .map((p) => ({ sentence: p!.sentence!, answer: p!.answer ?? "", news: p!.news ?? [] }));
      out.push({ subject, format: input.format ?? "story", productId: input.productId ?? null, finalists: picks.map((p) => p.sentence), picks, news: input.news ?? [], series: input.series?.id && Number.isInteger(input.series.episode) ? { id: input.series.id, episode: input.series.episode } : null, at: iso(r.createdAt) ?? "" });
    }
    return out;
  }

  /** How many Reels the pipeline started since `since` (each Reel's first stage-2 try). */
  /** A series' Reels that passed stage 2: which episode each was and whether it was posted (a "posted" action on it). */
  async seriesReels(id: string): Promise<{ subject: string; episode: number; postedAt: string | null }[]> {
    await this.ensureTables();
    const rs = await this.db.execute({
      sql: `SELECT s."subject", s."input", (SELECT MIN(a."createdAt") FROM "SocialAction" a WHERE a."target" = s."subject" AND a."kind" = 'posted') AS "postedAt" FROM "SocialStage" s WHERE s."stage" = 2 AND s."subject" LIKE 'reel:%' AND s."input" LIKE ? AND s."subject" IN (SELECT "subject" FROM "SocialStage" WHERE "stage" = 2 AND "passed" = 1)`,
      args: [`%"series":%`],
    });
    const out: { subject: string; episode: number; postedAt: string | null }[] = [];
    for (const r of rs.rows) {
      let input: { series?: { id?: string; episode?: number } } = {};
      try {
        input = JSON.parse(String(r.input ?? "{}"));
      } catch {}
      if (input.series?.id !== id || !Number.isInteger(input.series.episode)) continue;
      if (out.some((o) => o.subject === String(r.subject))) continue;
      out.push({ subject: String(r.subject), episode: input.series.episode!, postedAt: r.postedAt == null ? null : iso(r.postedAt) ?? null });
    }
    return out;
  }

  async reelsTriedSince(since: Date): Promise<number> {
    await this.ensureTables();
    const rs = await this.db.execute({ sql: `SELECT COUNT(DISTINCT "subject") AS n FROM "SocialStage" WHERE "stage" = 2 AND "subject" LIKE 'reel:%' AND "createdAt" >= ?`, args: [vaultNow(since)] });
    return Number(rs.rows[0]?.n ?? 0);
  }

  /** The latest result of a stage (passed or not), or the latest that passed. */
  async latestStage(stage: number, opts: { passedOnly?: boolean; subject?: string } = {}): Promise<StageRecord | null> {
    await this.ensureTables();
    const rs = await this.db.execute({
      sql: `SELECT * FROM "SocialStage" WHERE "stage" = ? AND "subject" = ? ${opts.passedOnly ? `AND "passed" = 1` : ""} ORDER BY "createdAt" DESC, "attempt" DESC LIMIT 1`,
      args: [stage, opts.subject ?? "account"],
    });
    const r = rs.rows[0];
    if (!r) return null;
    const parse = (v: unknown) => {
      try {
        return JSON.parse(String(v));
      } catch {
        return null;
      }
    };
    return { id: String(r.id), stage: Number(r.stage), subject: String(r.subject), attempt: Number(r.attempt), passed: Boolean(Number(r.passed)), output: parse(r.output), gate: parse(r.gate), createdAt: iso(r.createdAt) ?? "" };
  }

  async lessons(kind?: LessonKind): Promise<Lesson[]> {
    await this.ensureTables();
    const rs = await this.db.execute({ sql: `SELECT * FROM "SocialLesson" WHERE "active" = 1 ${kind ? `AND "kind" = ?` : ""} ORDER BY "createdAt" ASC`, args: kind ? [kind] : [] });
    return rs.rows.map((r) => ({ id: String(r.id), kind: String(r.kind) as LessonKind, stage: num(r.stage), text: String(r.text), evidence: str(r.evidence), source: String(r.source), createdAt: iso(r.createdAt) ?? "" }));
  }

  /** Adds a lesson unless the same text is already there. True when it was new. */
  async addLesson(l: { kind: LessonKind; stage?: number | null; text: string; evidence?: string | null; source: string }, now = new Date()): Promise<boolean> {
    await this.ensureTables();
    const text = l.text.trim().slice(0, 600);
    const same = await this.db.execute({ sql: `SELECT 1 FROM "SocialLesson" WHERE "kind" = ? AND lower("text") = lower(?) AND "active" = 1`, args: [l.kind, text] });
    if (same.rows.length) return false;
    await this.db.execute({
      sql: `INSERT INTO "SocialLesson" ("id","kind","stage","text","evidence","source","active","createdAt") VALUES (?,?,?,?,?,?,1,?)`,
      args: [randomUUID(), l.kind, l.stage ?? null, text, l.evidence ?? null, l.source, vaultNow(now)],
    });
    return true;
  }

  /**
   * Retires the active lessons of one kind that came from the given sources
   * (they stay in the table, switched off). Returns how many.
   */
  async retireLessons(kind: LessonKind, sources: string[]): Promise<number> {
    await this.ensureTables();
    if (!sources.length) return 0;
    const rs = await this.db.execute({ sql: `UPDATE "SocialLesson" SET "active" = 0 WHERE "active" = 1 AND "kind" = ? AND "source" IN (${sources.map(() => "?").join(",")})`, args: [kind, ...sources] });
    return rs.rowsAffected;
  }

  // --- The Instagram token ---------------------------------------------------

  async storedToken(): Promise<{ token: string; seed: string; expiresAt: string | null; refreshedAt: string } | null> {
    await this.ensureTables();
    const rs = await this.db.execute(`SELECT * FROM "SocialToken" WHERE "id" = 'instagram'`);
    const r = rs.rows[0];
    if (!r) return null;
    const opened = unsealStored(String(r.sealed));
    if (!opened) return null;
    if (opened.reseal) {
      // Sealed with the old key: lock it again with SOCIAL_SEAL_KEY.
      await this.db.execute({ sql: `UPDATE "SocialToken" SET "sealed" = ? WHERE "id" = 'instagram'`, args: [seal(opened.token)] });
    }
    return { token: opened.token, seed: String(r.seed), expiresAt: iso(r.expiresAt), refreshedAt: iso(r.refreshedAt) ?? "" };
  }

  async saveToken(token: string, seed: string, expiresAt: Date | null, now = new Date()): Promise<void> {
    await this.ensureTables();
    await this.db.execute({
      sql: `INSERT INTO "SocialToken" ("id","sealed","seed","expiresAt","refreshedAt") VALUES ('instagram',?,?,?,?)
            ON CONFLICT("id") DO UPDATE SET "sealed" = excluded."sealed", "seed" = excluded."seed", "expiresAt" = excluded."expiresAt", "refreshedAt" = excluded."refreshedAt"`,
      args: [seal(token), seed, expiresAt ? vaultNow(expiresAt) : null, vaultNow(now)],
    });
  }
}

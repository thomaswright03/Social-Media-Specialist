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
//
// It also reads the Vault's Product table, never writing to it.
import { createHash, createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { createClient, type Client, type InValue, type Row } from "@libsql/client";

export type PostState = "draft" | "approved" | "publishing" | "published" | "failed" | "rejected";
export type PostKind = "screenshot" | "card";
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
];

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
    kind: r.kind === "card" ? "card" : "screenshot",
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

// The key that seals the Instagram token in the database: only the
// specialist's run (which has the database's own token) can open it.
function sealKey(): Buffer {
  const secret = process.env.VAULT_DATABASE_AUTH_TOKEN?.trim() || process.env.VAULT_DATABASE_URL?.trim() || "";
  return createHash("sha256").update(`social-media-specialist:${secret}`).digest();
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
    const rs = await this.db.execute(`SELECT "id", "name", "description", "url" FROM "Product" WHERE "status" = 'active' AND "url" IS NOT NULL AND "url" != '' ORDER BY "name"`).catch(() => null);
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

  // --- The Instagram token ---------------------------------------------------

  async storedToken(): Promise<{ token: string; seed: string; expiresAt: string | null; refreshedAt: string } | null> {
    await this.ensureTables();
    const rs = await this.db.execute(`SELECT * FROM "SocialToken" WHERE "id" = 'instagram'`);
    const r = rs.rows[0];
    if (!r) return null;
    const token = unseal(String(r.sealed));
    return token ? { token, seed: String(r.seed), expiresAt: iso(r.expiresAt), refreshedAt: iso(r.refreshedAt) ?? "" } : null;
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

// The Social Media Specialist's answers to Hitta's requests (hitta-requests.ts):
// what it knows, what it may look up, and the few things it may do when
// Thomas asks. Approving a post happens only on the Vault page, where he sees
// the image; by phone he can ask for a post, turn one down, or pause.
// Run first in every workflow run (`social requests`), and every hour.
import { siteProducts } from "./site.ts";
import { feedImagePostsOn } from "./social.ts";
import { claudeAnswerer, type Action, type Answerer, type QueryDb } from "./hitta-requests.ts";
import { vaultNow, type Post, type Vault } from "./vault.ts";

const ROLE = [
  "You are the Social Media Specialist of Wright AI Solutions, Thomas's AI employee that runs his business Instagram account.",
  "Every morning you draft Instagram posts about his products (from the Vault's Product table) or about ideas he gave you: a caption, hashtags, and an image with a headline and a screenshot of the product's own site. Each draft waits for Thomas on the Social Media Specialist page in the Vault. When he approves one there, it takes the next open one of the day's five posting times (7:20 and 10:20 AM, 1:20, 4:20 and 7:20 PM Arizona), and the hourly run posts it through Instagram's API. At the times nothing he approved has taken, the pipeline makes and posts its own Reel, so it's five a day.",
  "The one exception is the Reels pipeline's own Reels: five a day (7, 10, 13, 16 and 19 Arizona time; explainers, satisfying clips and one ad), each posted on its own to Instagram and the Facebook Page only when it passed every quality check. Thomas lifted his approval for those on 2026-11-21. Pausing stops them too.",
  "Drafts on the Vault page still need him: you can't approve or post one by phone, because he needs to see it. If he asks you to approve or post one, tell him to tap Approve on the page.",
  "Posts are in the Vault table SocialPost: state (draft = waiting for him, approved = scheduled for scheduledFor, published, failed = Instagram refused it, error says why, rejected = he turned it down, note says why), productName, headline, caption, likes, comments, reach after it's out. Ideas he asked for are in SocialIdea. Settings (postsPerWeek = drafts kept waiting or scheduled, brief, paused) in SocialSettings; its postDays and postTime are no longer used.",
  "There's also the Reels content pipeline (stages 0 to 8, each with a gate of checks). SocialStage has each stage's output and gate result (stage 0 is the Insights diagnosis: three reasons the posts underperformed, with numbers). SocialLesson has what it learned (pattern, avoid, check). SocialAction is the History of everything it did (kind, summary, onInstagram, ok, createdAt).",
  "When you read posts to Thomas, say the product and the headline in one sentence each, without links or ids. Times are Arizona time.",
].join("\n");

/** Thomas asking, in his own words, for it to start again after a pause. */
export const ASKS_TO_RESUME = /\b(resume|unpause|un-pause|turn (it |that |posting )?(back )?on|back on|start (it |posting |again|back)|restart|keep posting|carry on)\b/i;

export const VAULT_TABLES = ["SocialPost", "SocialIdea", "SocialSettings", "SocialStatus", "SocialStage", "SocialLesson", "SocialAction"];

/** The post Thomas means: by id, else the one whose headline, product and caption best match his words. */
export function pickPost(posts: Post[], ref: string): Post | null {
  const r = ref.trim().toLowerCase();
  if (!r) return null;
  const byId = posts.find((p) => p.id.toLowerCase() === r);
  if (byId) return byId;
  const words = r.split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  let best: Post | null = null;
  let bestScore = 0;
  for (const p of posts) {
    const hay = `${p.headline} ${p.productName ?? ""} ${p.angle ?? ""} ${p.caption.slice(0, 200)}`.toLowerCase();
    const s = words.filter((w) => hay.includes(w)).length + (r.includes(p.headline.toLowerCase()) ? 3 : 0);
    if (s > bestScore) {
      best = p;
      bestScore = s;
    }
  }
  return bestScore >= 1 ? best : null;
}

const az = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-US", { timeZone: "America/Phoenix", weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }) : null;

export function socialAnswerer(opts: { vault: Vault; vaultQueryDb: QueryDb; runNow?: () => Promise<{ ok: boolean; message: string }>; ask?: (prompt: string) => Promise<string>; now?: () => Date }): Answerer {
  const { vault } = opts;
  const now = opts.now ?? (() => new Date());
  const actions: Record<string, Action> = {
    request_post: {
      description: "Queues an idea Thomas asked for (a topic, a product, an offer, a message) for an upcoming Reel. Only when he asks for a post or Reel about something.",
      args: '{"about": "what the post should say or be about, in his words", "product": "the product name if he named one, or null"}',
      async run(args) {
        const about = String(args.about ?? "").trim().slice(0, 500);
        if (!about) throw new Error("I didn't catch what the post should be about");
        const named = String(args.product ?? "").trim().toLowerCase();
        const product = named ? (await siteProducts().catch(() => [])).find((p) => p.name.toLowerCase().includes(named) || named.includes(p.name.toLowerCase())) : undefined;
        await vault.addIdea(about, product?.id ?? null, "hitta", now());
        return feedImagePostsOn()
          ? `Got it. I'll draft that post${product ? ` for ${product.name}` : ""} tomorrow morning, and it'll wait on the Vault page for your OK.`
          : `Got it. I saved that idea${product ? ` for ${product.name}` : ""} for an upcoming Reel.`;
      },
    },
    turn_down: {
      description: "Turns down one draft so it never goes out, with his reason, which later drafts learn from. Only when he clearly says no to a specific draft.",
      args: '{"post": "its id from the facts, or its headline in his words", "reason": "why, in his words, or null"}',
      async run(args) {
        const p = pickPost(await vault.posts(`"state" IN ('draft','approved','failed')`), String(args.post ?? ""));
        if (!p) throw new Error("I couldn't tell which post you meant");
        await vault.updatePost(p.id, { state: "rejected", note: typeof args.reason === "string" && args.reason ? args.reason.slice(0, 300) : "Turned down through Hitta.", scheduledFor: null, decidedAt: vaultNow(now()) }, now());
        return `Turned down the post "${p.headline}". It won't go out.`;
      },
    },
    posts_per_week: {
      description: "Sets how many posts a week it aims for (1 to 14). Only when he asks for more or fewer posts.",
      args: '{"count": 3}',
      async run(args) {
        const count = Math.round(Number(args.count));
        if (!Number.isFinite(count) || count < 1 || count > 14) throw new Error("pick between 1 and 14 posts a week");
        await vault.saveSettings({ postsPerWeek: count }, now());
        return `I'll aim for ${count} ${count === 1 ? "post" : "posts"} a week.`;
      },
    },
    pause: {
      description: "Pauses the Social Media Specialist: no drafts and nothing posted, even approved posts (requests are still answered). Only when he asks to pause or stop it.",
      async run() {
        await vault.saveSettings({ paused: true }, now());
        return "Paused. Nothing will be drafted or posted until you resume it.";
      },
    },
    resume: {
      description: "Resumes it after a pause. Only when he asks to resume.",
      async run(_args, request) {
        // Only Thomas's own words turn it back on, never text Claude read (security check, 2026-11-21).
        if (request !== undefined && !ASKS_TO_RESUME.test(request)) throw new Error("only you can turn it back on, so ask me to resume it in those words");
        await vault.saveSettings({ paused: false }, now());
        return "Back on. Approved posts go out at their times, and new drafts come tomorrow morning.";
      },
    },
  };
  if (opts.runNow) {
    const runNow = opts.runNow;
    actions.draft_now = {
      description: "Starts the morning run now (drafts posts if fewer than a week's worth are waiting) instead of tomorrow morning. Only when he asks for drafts now.",
      async run() {
        const r = await runNow();
        if (!r.ok) throw new Error(r.message);
        return "I'm drafting now. They'll be on the Social Media Specialist page in about ten minutes.";
      },
    };
  }
  // Everything done for Thomas through Hitta goes into the History too.
  for (const [name, action] of Object.entries(actions)) {
    const run = action.run.bind(action);
    action.run = async (args, request) => {
      const done = await run(args, request);
      await vault.logAction({ kind: name === "request_post" ? "idea" : name === "turn_down" ? "turned_down" : "settings", summary: `Through Hitta: ${done}`, detail: JSON.stringify(args ?? {}).slice(0, 500) }, now());
      return done;
    };
  }
  return claudeAnswerer({
    role: ROLE,
    facts: async () => {
      const [latest, posts, settings, ideas, platforms] = await Promise.all([vault.latestStatus(), vault.posts(), vault.settings(), vault.openIdeas(), vault.statusRow("platforms").catch(() => null)]);
      const brief = (p: Post) => ({ id: p.id, product: p.productName, headline: p.headline, caption: p.caption.slice(0, 160) });
      return {
        lastRun: latest ? { at: latest.snapshot.checkedAt, instagram: latest.snapshot.account ?? latest.snapshot.instagramError ?? null, tokenGoodUntil: latest.snapshot.tokenExpiresAt, notes: latest.snapshot.notes } : "it hasn't run yet",
        settings: { postsPerWeek: settings.postsPerWeek, brief: settings.brief, paused: settings.paused, leftOut: settings.leftOut, postingTimes: "7:20 and 10:20 AM, 1:20, 4:20 and 7:20 PM Arizona, every day" },
        // Instagram, the Facebook Page, YouTube Shorts and TikTok: connected or not, and their numbers (src/platforms.ts).
        platforms: platforms ? { readAt: platforms.updatedAt, ...(JSON.parse(platforms.snapshot) as object) } : "not read yet",
        waitingForThomas: posts.filter((p) => p.state === "draft").map(brief),
        scheduled: posts.filter((p) => p.state === "approved").map((p) => ({ ...brief(p), goesOut: az(p.scheduledFor) })),
        failed: posts.filter((p) => p.state === "failed").map((p) => ({ ...brief(p), error: p.error })),
        lastPublished: posts
          .filter((p) => p.state === "published")
          .slice(0, 10)
          .map((p) => ({ product: p.productName, headline: p.headline, postedAt: az(p.publishedAt), likes: p.likes, comments: p.comments, reach: p.reach })),
        ideasQueued: ideas.map((i) => i.text),
      };
    },
    databases: { vault: opts.vaultQueryDb },
    actions,
    ask: opts.ask,
    now: opts.now,
  });
}

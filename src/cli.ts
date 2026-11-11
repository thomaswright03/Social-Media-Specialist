// `social <command>`. Run on GitHub Actions by .github/workflows/social.yml
// (every morning, approved posts and Hitta's requests every hour, and by hand
// from the Actions tab), or locally with a .env file.
//
//   requests        answers Hitta's open requests (run first, every time)
//   run             the morning run (see social.ts): token, stats, drafts, Hitta
//   publish         posts every approved post whose time has come
//   preview         drafts one post and saves its image to preview.jpg; saves nothing to the Vault, posts nothing
//   instagram-test  reads the Instagram account (and the Facebook Page, with a Facebook token); posts nothing
//   hitta-test      sends Hitta a low-urgency test report
//   diagnose        stage 0 of the content pipeline (pipeline/README.md): reads Insights for
//                   everything posted and names the top 3 reasons it underperformed
//   research        stage 1: studies the Reels of the accounts Thomas admires
//                   (RESEARCH_ACCOUNTS, or usernames after the command) and saves what works
import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { buildDraftPrompt, fullCaption, pickNext, readSite, screenDraft } from "./draft.ts";
import { sendHittaReport, HITTA_PROJECT } from "./hitta.ts";
import { askClaude, handleHittaRequests, libsqlQueryDb } from "./hitta-requests.ts";
import { crosspostOn, facebookPageClient } from "./facebook.ts";
import { currentToken, instagramClient } from "./instagram.ts";
import { playwrightRenderer } from "./render.ts";
import { socialAnswerer, VAULT_TABLES } from "./requests.ts";
import { publishDue, runDaily } from "./social.ts";
import { runDiagnose } from "./pipeline/diagnose.ts";
import { runResearch } from "./pipeline/research.ts";
import { Vault } from "./vault.ts";

const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);

function need(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`${name} isn't set. Add it to the Social-Media-Specialist repo's Actions secrets (see README.md).`);
    process.exit(2);
  }
  return value;
}

const connect = () => Vault.connect(need("VAULT_DATABASE_URL"), process.env.VAULT_DATABASE_AUTH_TOKEN?.trim() || undefined);

// Starts this repo's own workflow (for "draft now" from Hitta), with the
// run's GITHUB_TOKEN, which may start workflows in its own repo.
async function runNow(): Promise<{ ok: boolean; message: string }> {
  const token = process.env.GITHUB_TOKEN?.trim();
  const repo = process.env.GITHUB_REPOSITORY?.trim();
  if (!token || !repo) return { ok: false, message: "I can only start a run from GitHub Actions" };
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/social.yml/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json", "User-Agent": "social-media-specialist" },
    body: JSON.stringify({ ref: "main", inputs: { command: "run" } }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  return res && (res.status === 204 || res.ok) ? { ok: true, message: "started" } : { ok: false, message: `GitHub wouldn't start the run (${res?.status ?? "no answer"})` };
}

async function main() {
  const command = process.argv[2] ?? "run";

  if (command === "hitta-test") {
    const result = await sendHittaReport({
      project: HITTA_PROJECT,
      title: "Test from your Social Media Specialist",
      summary: "This is a test report from the Social Media Specialist. If you hear this, it can tell you when Instagram posts are waiting for your OK. Nothing needs you.",
      urgency: "low",
    });
    log(result.message);
    process.exit(result.ok ? 0 : 1);
  }

  if (command === "requests") {
    const vault = connect();
    try {
      await vault.ensureTables();
      const vaultQueryDb = libsqlQueryDb(vault.client, VAULT_TABLES, "SQLite (the Vault, Turso). SocialPost (every Instagram post from draft to published; skip the image column), SocialIdea (posts Thomas asked for), SocialSettings, SocialStatus (your latest run, as JSON), SocialStage (content pipeline stage results and gates), SocialLesson (what the pipeline learned), SocialAction (your History of everything you did). Times are ISO text like '2026-10-27T18:30:00.000+00:00' (UTC).");
      await vaultQueryDb.load().catch((err) => log(`Couldn't read the Vault's tables: ${err instanceof Error ? err.message : err}`));
      const result = await handleHittaRequests({ answerer: socialAnswerer({ vault, vaultQueryDb, runNow }), log });
      if (result.fetchError) await reportRequestsFailure(vault, result.fetchError);
      if (result.unanswered.length > 0) process.exitCode = 1;
    } finally {
      vault.close();
    }
    return;
  }

  if (command === "instagram-test") {
    const vault = connect();
    try {
      const token = await currentToken(vault, { log });
      if (!token) {
        console.error("INSTAGRAM_ACCESS_TOKEN isn't set.");
        process.exit(2);
      }
      const a = await instagramClient(token.token).account();
      log(`Instagram: @${a.username}, ${a.followers ?? "?"} followers, ${a.posts ?? "?"} posts.${token.expiresAt ? ` Token good until ${token.expiresAt.slice(0, 10)}.` : ""}`);
      const page = facebookPageClient(token.token);
      if (page) {
        const p = await page.info();
        log(`Facebook Page: ${p.name}, ${p.followers ?? "?"} followers${p.instagramId ? "; Instagram linked" : "; Instagram NOT linked to it"}. Approved posts ${crosspostOn() ? "also go to the Page" : "stay Instagram-only (FACEBOOK_CROSSPOST=off)"}.`);
      } else {
        log("This is an Instagram-login token, so the Facebook Page isn't reachable. Use a Facebook-login token (README) to manage the Page too.");
      }
      log(process.env.VAULT_PUBLIC_URL?.trim() ? `Images will be served from ${process.env.VAULT_PUBLIC_URL.trim()}/api/social/media/…` : "VAULT_PUBLIC_URL isn't set: approved posts can't go out until it is.");
    } finally {
      vault.close();
    }
    return;
  }

  if (command === "preview") {
    const vault = connect();
    const renderer = await playwrightRenderer();
    try {
      const [products, ideas, posts, settings] = await Promise.all([vault.products(), vault.openIdeas(), vault.posts(), vault.settings()]);
      const [pick] = pickNext(products, ideas, posts, settings, 1);
      if (!pick) throw new Error("No active products with a website in the Vault, and no ideas queued.");
      const site = pick.product ? await readSite(pick.product.url) : null;
      const screened = screenDraft(await askClaude(buildDraftPrompt({ pick, site, settings, history: posts })), { ...pick, site });
      if (!screened.ok) throw new Error(`The draft couldn't be used: ${screened.reason}`);
      const p = screened.post;
      const shot = p.kind === "screenshot" && p.sourceUrl ? await renderer.screenshot(p.sourceUrl).catch(() => null) : null;
      const image = await renderer.image({ kind: shot ? p.kind : "card", theme: p.theme, headline: p.headline, subline: p.subline, productName: p.productName, host: p.sourceUrl ? new URL(p.sourceUrl).host : null, screenshot: shot });
      await writeFile("preview.jpg", image);
      console.log(`\n${p.productName ?? "Wright AI Solutions"}: ${p.headline}\n${p.subline ?? ""}\n\n${fullCaption(p)}\n\nImage saved to preview.jpg (nothing saved to the Vault, nothing posted).`);
    } finally {
      await renderer.close();
      vault.close();
    }
    return;
  }

  if (command === "diagnose") {
    const vault = connect();
    try {
      const token = await currentToken(vault, { log });
      if (!token) {
        console.error("INSTAGRAM_ACCESS_TOKEN isn't set, so Insights can't be read.");
        process.exit(2);
      }
      const r = await runDiagnose({ vault, ig: instagramClient(token.token), ask: askClaude, log });
      if (r.passed) {
        console.log(`\n${r.diagnosis?.summary ?? ""}\n`);
        for (const [i, reason] of (r.diagnosis?.reasons ?? []).entries()) console.log(`${i + 1}. ${reason.reason}\n   Fix: ${reason.fix}`);
        const result = await sendHittaReport({
          project: HITTA_PROJECT,
          title: "Your Instagram diagnosis is ready",
          summary: `The Social Media Specialist read the Insights for everything posted. ${(r.diagnosis?.reasons ?? []).map((x, i) => `${i + 1}: ${x.reason}`).join(" ")} The details are on its Vault page.`.slice(0, 900),
          urgency: "low",
        });
        log(result.message);
      } else {
        console.error(`\nThe diagnosis didn't pass its gate after ${r.tries} tries:`);
        for (const c of r.gate.checks.filter((x) => !x.passed)) console.error(`- ${c.name}${c.detail ? `: ${c.detail}` : ""}`);
        process.exitCode = 1;
      }
    } finally {
      vault.close();
    }
    return;
  }

  if (command === "research") {
    const fromArgs = process.argv.slice(3);
    const accounts = (fromArgs.length ? fromArgs : (process.env.RESEARCH_ACCOUNTS ?? "").split(/[\s,]+/))
      .map((a) => a.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/\/.*$/, ""))
      .filter(Boolean);
    if (!accounts.length) {
      console.error("No accounts to study. Set RESEARCH_ACCOUNTS (comma separated) or name them after the command.");
      process.exit(2);
    }
    const vault = connect();
    try {
      const token = await currentToken(vault, { log });
      if (!token) {
        console.error("INSTAGRAM_ACCESS_TOKEN isn't set.");
        process.exit(2);
      }
      const me = await instagramClient(token.token).account();
      const r = await runResearch({ vault, token: token.token, igUserId: me.id, accounts, log });
      if (r.passed) {
        const patterns = r.research?.patterns ?? [];
        console.log(`\nStudied ${r.measured.length} Reels from ${accounts.map((a) => `@${a}`).join(", ")}.\n`);
        for (const [i, p] of patterns.entries()) console.log(`${i + 1}. ${p.pattern}`);
        const result = await sendHittaReport({
          project: HITTA_PROJECT,
          title: "Your Instagram research is ready",
          summary: `The Social Media Specialist studied ${r.measured.length} Reels from ${accounts.join(", ")}. ${patterns.slice(0, 3).map((p, i) => `${i + 1}: ${p.pattern}`).join(" ")} The details are on its Vault page.`.slice(0, 900),
          urgency: "low",
        });
        log(result.message);
      } else {
        console.error(`\nThe research didn't pass its gate${r.tries ? ` after ${r.tries} tries` : ""}:`);
        for (const c of r.gate.checks.filter((x) => !x.passed)) console.error(`- ${c.name}${c.detail ? `: ${c.detail}` : ""}`);
        process.exitCode = 1;
      }
    } finally {
      vault.close();
    }
    return;
  }

  if (command === "publish") {
    const vault = connect();
    try {
      const r = await publishDue({ vault, hitta: (x) => sendHittaReport(x), log });
      log(r.skipped ? `Nothing posted: ${r.skipped}.` : `Posted ${r.published.length}, failed ${r.failed.length}.`);
      if (r.failed.length) process.exitCode = 1;
    } finally {
      vault.close();
    }
    return;
  }

  if (command !== "run") {
    console.error(`Unknown command "${command}". Use requests, run, publish, preview, diagnose, research, instagram-test or hitta-test.`);
    process.exit(2);
  }

  const vault = connect();
  try {
    const { snapshot, alertError } = await runDaily({ vault, hitta: (r) => sendHittaReport(r), log, ask: askClaude, renderer: playwrightRenderer });
    log(`Done: ${snapshot.drafted} drafted, ${snapshot.waiting} waiting for Thomas, ${snapshot.scheduled} scheduled, ${snapshot.published30d} posted in 30 days.`);
    // Anything already approved and due goes out now too.
    const r = await publishDue({ vault, hitta: (x) => sendHittaReport(x), log });
    if (!r.skipped) log(`Posted ${r.published.length}, failed ${r.failed.length}.`);
    if (alertError) {
      console.error(`Hitta didn't take the report: ${alertError}`);
      process.exitCode = 1;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await vault
      .saveStatus(false, { checkedAt: new Date().toISOString(), account: null, instagramOk: false, tokenExpiresAt: null, drafted: 0, waiting: 0, scheduled: 0, published30d: 0, notes: [], error: message })
      .catch(() => {});
    await reportFailure(vault, message);
    throw err;
  } finally {
    vault.close();
  }
}

// A failed run, once a day at most.
async function reportFailure(vault: Vault, message: string) {
  const key = `run-failed:${new Date().toISOString().slice(0, 10)}`;
  if (await vault.alreadyReported(key).catch(() => true)) return;
  const title = "Your Social Media Specialist's morning run failed";
  const result = await sendHittaReport({
    project: HITTA_PROJECT,
    title,
    summary: `The Social Media Specialist stopped with this error: ${message.slice(0, 200)}. No new Instagram drafts were made today. The run log is in the Social-Media-Specialist repo's Actions tab.`,
    urgency: "normal",
  });
  if (result.ok) await vault.markReported(key, title, "normal").catch(() => {});
}

// Hitta's requests couldn't be read: Thomas hears about it once a day.
async function reportRequestsFailure(vault: Vault, error: string) {
  if (!process.env.HITTA_API_KEY?.trim()) return;
  const key = `hitta-requests-failed:${new Date().toISOString().slice(0, 10)}`;
  if (await vault.alreadyReported(key).catch(() => true)) return;
  const title = "Your Social Media Specialist can't read your requests from Hitta";
  const result = await sendHittaReport({
    project: HITTA_PROJECT,
    title,
    summary: `The Social Media Specialist tried to fetch the questions and tasks you sent through Hitta, but it failed: ${error}. Until this is fixed, it can't answer them. The run log is in the Social-Media-Specialist repo's Actions tab.`,
    urgency: "normal",
  });
  log(`Told Hitta that its requests couldn't be read: ${result.message}`);
  if (result.ok) await vault.markReported(key, title, "normal").catch(() => {});
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});

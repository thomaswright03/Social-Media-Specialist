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
//   ideas           stage 2: picks the next Reel's format (80% entertainment, 20% ads) and keeps 3 ideas
//                   (REEL_FORMAT or a format after the command picks one by hand)
//   script          stages 3 and 4: the first 3 seconds, then the full script, for the newest Reel
//                   that passed stage 2
//   produce         stage 5: turns the newest passed script into reel/reel.mp4 (voice, drawings,
//                   captions, our own sound) and judges it against the benchmark Reels; posts nothing
//   voice-test      has the ElevenLabs voice read one line into voice-test.mp3; posts nothing
//   diagnose        stage 0 of the content pipeline (pipeline/README.md): reads Insights for
//                   everything posted and names the top 3 reasons it underperformed
//   research        stage 1: for each format (or the one named after the command, or REEL_FORMAT),
//                   compares the winning Reels of the accounts in pipeline/research/accounts.json
//                   with the same accounts' average Reels; "story: name1, name2" after the command
//                   (or RESEARCH_RUN_ACCOUNTS) studies other accounts for one run; posts nothing
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { buildDraftPrompt, fullCaption, pickNext, readSite, screenDraft } from "./draft.ts";
import { sendHittaReport, HITTA_PROJECT } from "./hitta.ts";
import { askClaude, handleHittaRequests, libsqlQueryDb } from "./hitta-requests.ts";
import { crosspostOn, facebookPageClient } from "./facebook.ts";
import { currentToken, instagramClient } from "./instagram.ts";
import { playwrightRenderer } from "./render.ts";
import { socialAnswerer, VAULT_TABLES } from "./requests.ts";
import { siteProducts } from "./site.ts";
import { publishDue, runDaily } from "./social.ts";
import { runDiagnose } from "./pipeline/diagnose.ts";
import { askClaudeWithFiles, runResearch, summaryText, type ResearchResult } from "./pipeline/research.ts";
import { RESEARCH_FORMATS, accountsFor, parseAccounts } from "./pipeline/research-accounts.ts";
import { runIdeas } from "./pipeline/ideas.ts";
import { runScript } from "./pipeline/script.ts";
import { benchmarkCovers, runProduce } from "./pipeline/produce.ts";
import { ENTERTAINMENT, isFormat, type Format } from "./pipeline/formats.ts";
import { Vault } from "./vault.ts";
import { soundEffect, speak } from "./voice.ts";

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

  if (command === "ideas") {
    const wanted = (process.argv[3] ?? process.env.REEL_FORMAT ?? "").trim().toLowerCase();
    if (wanted && wanted !== "ad" && !(ENTERTAINMENT as readonly string[]).includes(wanted)) {
      console.error(`"${wanted}" isn't a format. Use ad, ${ENTERTAINMENT.join(", ")}, or leave it empty to follow the 80/20 mix.`);
      process.exit(2);
    }
    const vault = connect();
    try {
      const products = await siteProducts().catch((err) => {
        log(`Couldn't read the products from the website: ${err instanceof Error ? err.message : err}`);
        return [];
      });
      const r = await runIdeas({ vault, products, ask: askClaude, log, format: (wanted || undefined) as Format | undefined });
      if (r.passed) {
        console.log(`\n${r.choice.format}${r.choice.product ? ` for ${r.choice.product.name}` : ""}: the 3 kept ideas\n`);
        for (const [i, s] of r.finalists.entries()) console.log(`${i + 1}. ${s}`);
      } else {
        console.error(`\nThe ideas didn't pass their gate after ${r.tries} tries:`);
        for (const c of r.gate.checks.filter((x) => !x.passed)) console.error(`- ${c.name}${c.detail ? `: ${c.detail}` : ""}`);
        process.exitCode = 1;
      }
    } finally {
      vault.close();
    }
    return;
  }

  if (command === "script") {
    const vault = connect();
    try {
      const products = await siteProducts().catch(() => []);
      const r = await runScript({ vault, products, ask: askClaude, log });
      if (r.passed && r.script) {
        console.log(`\n${r.premise}\n`);
        for (const s of r.script.shots ?? []) console.log(`${s.start}-${s.end} s  ${s.visual ?? ""}${s.onScreenText ? `\n         text: ${s.onScreenText}` : ""}${s.line ? `\n         voice: ${s.line}` : ""}`);
        console.log(`\nPayoff: ${r.script.payoff}\nCaption: ${r.script.caption}`);
      } else {
        console.error(`\n${r.problem ?? `Stage ${r.stage} didn't pass its gate`}:`);
        for (const c of r.gate.checks.filter((x) => !x.passed)) console.error(`- ${c.name}${c.detail ? `: ${c.detail}` : ""}`);
        process.exitCode = 1;
      }
    } finally {
      vault.close();
    }
    return;
  }

  if (command === "produce") {
    const vault = connect();
    try {
      const token = await currentToken(vault, { log }).catch(() => null);
      const me = token ? await instagramClient(token.token).account().catch(() => null) : null;
      const accounts = (process.env.RESEARCH_ACCOUNTS || "stickmanstorys22").split(/[\s,]+/).map((a) => a.trim().replace(/^@/, "")).filter(Boolean);
      const { chromium } = await import("playwright");
      const r = await runProduce({
        vault,
        ask: askClaude,
        judge: (dir) => askClaudeWithFiles(dir),
        speak,
        sfx: process.env.REEL_SFX === "off" ? undefined : soundEffect,
        browser: () => chromium.launch(),
        benchmarks: (dir) => (token && me ? benchmarkCovers({ token: token.token, igUserId: me.id, accounts, dir }) : Promise.resolve([])),
        outDir: "reel",
        subject: process.argv[3] || undefined,
        log,
      });
      if (r.video) log(`The Reel is under this run's Artifacts as "reel" (${r.seconds.toFixed(1)} s). Nothing was posted.`);
      if (!r.passed) {
        console.error(`\n${r.problem ?? "Stage 5 didn't pass its gate"}:`);
        for (const c of r.gate.checks.filter((x) => !x.passed)) console.error(`- ${c.name}${c.detail ? `: ${c.detail}` : ""}`);
        if (r.fixFirst) console.error(`Fix first: ${r.fixFirst}`);
        process.exitCode = 1;
      } else if (r.fixFirst) log(`The judge's biggest gap: ${r.fixFirst}`);
    } finally {
      vault.close();
    }
    return;
  }

  if (command === "voice-test") {
    // Takes to compare (Thomas, 2026-11-19: "it needs to sound more up beat").
    // The same upbeat creator line, read with different settings and voices.
    const plain = "Okay, imagine you run a bakery, and the orders start coming in at two in the morning. Most of you said keep sleeping. Here's what actually happened.";
    const tagged = "[excited] Okay, imagine you run a bakery, and the orders start coming in at two in the morning! [laughs] Most of you said keep sleeping. [curious] But here's what actually happened.";
    const own = process.env.ELEVENLABS_VOICE_ID?.trim();
    const takes: { name: string; text: string; stability: number; voiceId?: string }[] = [
      { name: "1-your-voice-calm", text: plain, stability: 0.5 },
      { name: "2-your-voice-tags", text: tagged, stability: 0.5 },
      { name: "3-your-voice-tags-creative", text: tagged, stability: 0 },
      // ElevenLabs' own upbeat voices, to hear whether the voice or the settings are the problem.
      { name: "4-liam-tags-creative", text: tagged, stability: 0, voiceId: "TX3LPaxmHKxFdv7VOQHJ" },
      { name: "5-jessica-tags-creative", text: tagged, stability: 0, voiceId: "cgSgspJ2msm6clMCkdW9" },
    ];
    await mkdir("voice-test", { recursive: true });
    for (const t of takes) {
      try {
        const s = await speak(t.text, { stability: t.stability, voiceId: t.voiceId ?? own });
        await writeFile(`voice-test/${t.name}.mp3`, s.audio);
        log(`Take ${t.name}: ${s.words.length} words, ${s.words.at(-1)?.end.toFixed(1) ?? "?"} s.`);
      } catch (e) {
        log(`Take ${t.name} failed: ${(e as Error).message}`);
      }
    }
    log(`The takes are under this run's Artifacts as "voice-test".`);
    return;
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
      const [products, ideas, posts, settings] = await Promise.all([siteProducts(), vault.openIdeas(), vault.posts(), vault.settings()]);
      const [pick] = pickNext(products, ideas, posts, settings, 1);
      if (!pick) throw new Error("No products on the website, and no ideas queued.");
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
    // `research [format … | all] [accounts]`: a format's name picks it, anything else is accounts.
    const args = process.argv.slice(3);
    const isName = (a: string) => a.toLowerCase() === "all" || isFormat(a.toLowerCase());
    const named = [...args.filter(isName), ...(args.some(isName) ? [] : [process.env.REEL_FORMAT?.trim() ?? ""].filter(isName))].map((a) => a.toLowerCase());
    const typed = [args.filter((a) => !isName(a)).join(" "), process.env.RESEARCH_RUN_ACCOUNTS ?? ""].filter((t) => t.trim()).join("; ");
    const typedFor = Object.keys(parseAccounts(typed)) as Format[];
    const plain = Boolean(typed.trim()) && Object.keys(parseAccounts(typed, "story")).length > typedFor.length;
    const formats: Format[] = named.includes("all") ? [...RESEARCH_FORMATS] : named.length ? [...new Set(named as Format[])] : typedFor.length ? typedFor : plain ? ["story"] : [...RESEARCH_FORMATS];
    if (plain && formats.length > 1) {
      console.error(`Say which format those accounts are for, like "story: name1, name2; ad: name3".`);
      process.exit(2);
    }
    if (plain && !named.length) log("No format was named, so these accounts are studied as story Reels.");
    const vault = connect();
    try {
      const token = await currentToken(vault, { log });
      if (!token) {
        console.error("INSTAGRAM_ACCESS_TOKEN isn't set.");
        process.exit(2);
      }
      const me = await instagramClient(token.token).account();
      const results: ResearchResult[] = [];
      for (const format of formats) {
        const accounts = accountsFor(format, typed);
        log(`Research, ${format}: studying ${accounts.map((a) => `@${a}`).join(", ") || "no accounts (none are listed for it)"}.`);
        const r = await runResearch({ vault, token: token.token, igUserId: me.id, format, accounts, log });
        results.push(r);
        console.log(`\n${r.report}\n`);
        if (r.reportFile) log(`The ${format} report is saved as ${r.reportFile}.`);
      }
      const passed = results.filter((r) => r.passed);
      const failed = results.filter((r) => !r.passed);
      if (passed.length) {
        const result = await sendHittaReport({
          project: HITTA_PROJECT,
          title: "Your Instagram research is ready",
          summary: `The Social Media Specialist compared other accounts' winning Reels with their average ones. ${results.map((r) => summaryText(r.findings, r.passed)).join(" ")} The full report is on its Vault page's History and in the run's files.`.slice(0, 900),
          urgency: "low",
        });
        log(result.message);
      }
      for (const r of failed) {
        console.error(`\nThe ${r.format} research didn't pass its gate:`);
        for (const c of r.gate.checks.filter((x) => !x.passed)) console.error(`- ${c.name}${c.detail ? `: ${c.detail}` : ""}`);
      }
      if (failed.length) process.exitCode = 1;
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
    console.error(`Unknown command "${command}". Use requests, run, publish, preview, diagnose, research, ideas, script, voice-test, instagram-test or hitta-test.`);
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

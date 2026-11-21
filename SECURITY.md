# Security

This repo is public. It runs Thomas's Instagram account, his Facebook Page and
(once turned on) his YouTube channel, so a weakness here can post in his name.

## Reporting a problem

Please don't open a public issue for a security problem. Use GitHub's
**Report a vulnerability** button on this repo's Security tab (private
vulnerability reporting). If that button isn't there, open an issue that says
only "security problem, please get in touch", with no details. We aim to answer
within a week.

## What protects the accounts

- **Approval.** Drafts on the Vault page post only after Thomas approves them
  (`publishDue` in `src/social.ts`). The pipeline's own Reels post on their
  own only when every stage-6 check passes (`mayAutoPost` in
  `src/pipeline/gates.ts`), including the check that an automatic post holds
  no outside links, web addresses, @handles, emails, phone numbers or "DM us"
  asks.
- **Pause.** The Pause on the Vault page (or "pause" through Hitta) stops
  every post, the YouTube backfill included. Only Thomas's own words turn it
  back on through Hitta.
- **Outside text is data.** News articles and other creators' captions and
  transcripts reach the prompts only as marked, cleaned-up data.
- **Secrets.** Claude runs with only its own sign-in in its environment, no
  tools but reading its own working folder, and no MCP servers. Installs run
  without any secrets and without install scripts. Tokens made at run time are
  masked in the public logs. The stored Instagram token is sealed with
  `SOCIAL_SEAL_KEY`.
- **Supply chain.** GitHub Actions are pinned to commit SHAs and the Claude
  CLI to a version; Dependabot proposes updates as pull requests.

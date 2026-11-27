# Profile checklists

Prompts for getting each of our profiles into shape: what a business profile
should look like in every way, which the Specialist works through before it
makes profile changes. Each file keeps the prompt between `<!-- prompt -->`
markers, the same way `pipeline/stages/*.md` do, so code can read it with the
same pattern later.

- `instagram.md`: the Instagram business profile (15 items).
- Facebook Page: next, not written yet.

## Not wired up yet

Nothing reads these files yet, and nothing changes the profile. The rules in
`CLAUDE.md` still apply when it is wired: nothing goes out without Thomas's
approval, and every change is recorded with `vault.logAction`.

## What Instagram's API can do for each item

Instagram's API (graph.instagram.com, or graph.facebook.com with Facebook
Login, `src/instagram.ts`) reads the profile's username, name, bio, website,
profile picture, follower and post counts, and every post with its caption,
type and thumbnail. It has **no call that edits the profile**: name, username,
bio, link, photo, category, buttons, highlights and pins are all changed by
hand in the app. So the checklist is mostly an audit plus drafts plus a list
of taps for Thomas.

| # | Item | Read (check it) | Change it via API |
|---|------|-----------------|-------------------|
| 1 | Account type, linked Page, category | Yes: business account and linked Page; the category comes from the Page | No |
| 2 | Name field | Yes | No: drafts only |
| 3 | Username | Yes; other platforms by checking their pages | No |
| 4 | Profile photo | Yes (picture URL; compare with the Page's picture) | No |
| 5 | Bio | Yes | No: 3 drafted options for Thomas to pick and paste |
| 6 | Link | Yes, and the page itself can be fetched to test it works, has UTM tags and loads fast | No |
| 7 | Contact and action buttons | No: not exposed | No |
| 8 | Highlights | No | No: the Specialist can make the covers and slides as images; adding them to highlights is by hand (and posting the Stories they need conflicts with "Never post" unless Thomas approves it) |
| 9 | Pinned posts | No | No: it can pick the 3 and say which order |
| 10 | Grid look | Yes, from the latest 12 thumbnails | No: hiding or archiving is by hand |
| 11 | Content mix | Yes, from post dates and our own records of each Reel's format | Posting more is the existing pipeline |
| 12 | Trust signals | Yes (bio, link, captions) | No |
| 13 | Discoverability | Partly: captions and keywords yes; "Suggested for others" and location no | Alt text only on new image posts as they're published, not on existing posts |
| 14 | Messaging | No | Partly: Ice Breakers (up to 4 starter questions) can be set with the messaging permission; saved replies and away messages only in the app or Meta Business Suite |
| 15 | Consistency with Page and website | Yes (Page name, about, website, picture through the Page token; the website by fetching it) | No on Instagram |

## What it would take to run

1. A `npx social profile` command that reads the profile, the latest posts and
   the Facebook Page, fills this prompt with what it read, and asks Claude for
   the report.
2. The report goes on the Vault page (scored table, drafts to approve, taps to
   do), and the run is logged with `vault.logAction`.
3. Approve-then-apply only where an API exists: in practice Ice Breakers. That
   needs the `instagram_business_manage_messages` permission (Meta app review
   for advanced access). Everything else stays a draft Thomas pastes in.
4. The re-check at the end is the same read run again after Thomas has done
   the taps.

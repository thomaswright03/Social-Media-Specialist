# The Social Media Specialist

Thomas's AI employee that runs the Wright AI Solutions Instagram account.
It reports to Thomas through Hitta.

## What it does

- Every morning it drafts Instagram feed posts until a week's worth is
  waiting or scheduled (3 a week by default, at most 3 drafts a morning):
  - about the active products in the Vault that have a website (Products
    Thomas leaves out on the page are skipped), the one posted about longest
    ago first, or about an idea Thomas asked for, which always comes first;
  - a caption (a hook, 60 to 150 words, a call to action that the link is in
    the bio) and 3 to 10 hashtags;
  - a 1080x1350 image: headline, a line under it, and a real screenshot of a
    page on the product's own site, or just the words.
- It only claims what the product's own site says. Drafts with links,
  guarantees, "#1" style claims or any mention of Hitta are dropped.
- It learns from the posts Thomas turns down (his reason goes into the next
  drafts) and from how the published ones did (likes, comments, reach).
- Every hour it posts the approved posts whose time has come, then reads
  them back, and every morning it reads how the last 30 days' posts did.

## What it never does

- It never posts anything Thomas didn't approve on the Vault page. Approving
  can't be done by phone, because he needs to see the image.
- It never retries a failed post on its own (a retry could post it twice).
- It doesn't reply to comments or messages, follow or unfollow anyone, run
  ads, or post to any other network.

## How Thomas decides

On the Vault's AI Employees → Social Media Specialist page: **Approve**
(next posting slot), **Post now**, edit the caption or hashtags first, or
**Turn down** with a reason. A failed post has **Try again**. He can ask for
a post about anything, and set posts a week, posting days and time, a brief
every post follows, and products to leave out.

## When Hitta calls

Never urgent. Normal:
- new drafts are waiting for his OK (once a morning, when there are new ones)
- an approved post Instagram refused (once a post)
- approved posts are due but the setup isn't done (once a day)
- Instagram can't be reached or the token runs out within a week
- a failed morning run, or Hitta's requests can't be read (once a day)

## What it may do for Thomas through Hitta

- Answer questions about drafts, what's scheduled, and how posts did
- Queue a post he asks for ("make a post about our fall offer")
- Turn down a draft, with his reason
- Set posts a week; draft now; pause and resume (paused: no drafts and
  nothing posted, even approved posts)

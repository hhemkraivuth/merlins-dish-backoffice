# Merlin's Dish BOH (back office web)

Read this first. It holds the rules every session on this repo needs, so nobody has to hunt for a handover.

## Who and how
- Owner: Lily (Hemvalee), Bangkok, runs Merlin's Dish alone, no coding background. Plain words, answer first, steps she can follow in a browser.
- Australian English, DD/MM/YYYY, Thai Baht (฿). No dashes joining clauses. Address her as "you".
- Never say "I haven't checked". Check, then tell her. When she says fix, fix in the same turn. Never claim something works until one real test proves it.
- Standing permission (26/11/2026): you may push and merge BOH and bot code, and edit scheduled tasks, without asking again. Check this file, the Project docs and memory for a yes before asking. System safety checks still apply. Say what was done afterwards.
- BOH web is her main channel. The private BOH LINE group is secondary. Anything built for LINE needs a web way to do it too.
- BOH pages: very little text, detail one tap away, same kind of item in one box, compact on a phone.

## The repo
- Node and Express, deployed on Railway. Repo: hhemkraivuth/merlins-dish-backoffice (main). Data lives in Google Sheets through a service account.
- Tests: `node --test` from the repo root (563 passing on 28/11/2026). After any scripted edit of a `public/*.js` page file run `node --check public/<file>.js`. A syntax error once froze the Content Plan page.
- Pushing: if `git push` returns 403, call add_repo for this repo with access push, then push again. Commit messages end with the attribution lines the session reminder gives.
- The order app is a separate repo, hhemkraivuth/merlins-dish-bot. Nothing here may put customer ordering at risk.

## Data rules
- Claude Log sheet (id 1LppBqlumD7H112QyJfORiXSxCprH21mjBYarxlaFzvo) is where BOH reads and writes. Tabs include Ledger, Expense Log, Ingredient Lots, Cook Log, Cook Log Lines, Grab Day Totals, Closed Days, Content Queue, Cloud Inbox, App State.
- Merlin's numbers sheet (id 1uyJUnNE9K6No8Vxe0tsTjN6pFguRqc0BI5yHU4oHAA8) is the old living bible and is READ ONLY. Anything before 01/10/2026 comes from there, 01/10/2026 onwards from the Claude Log. Never ask her where a number lives.
- Grams (and ml) only for ingredients. Greyed cells in Merlin's numbers are not in use.
- The shop is closed every Saturday and Sunday. A weekend with sales means she opened specially. A day with no sales means no sales. Closed days are logged in the Closed Days tab.
- Food cost is booked per batch at cook time, not at sale. Batch dishes get cost from the batch, not per order.

## Grab handover (the file that went to the wrong folder on 27/11/2026)
- The 16:05 task saves each finished day into Drive folder "Ready for BOH" (id 1ROkt1rRBoA1cjcyuYqa22Kh2jjgzWiwy). BOH imports it within about 15 minutes and moves it to "Imported" (id 1yTEh025MAPFufxXv3fxE2p7k0imk5jaN). A file saved straight into Imported is never read.
- Two files a day: `merlins_dish_claude_log_DD_MM_YYYY.csv` (orders) and `grab_totals_DD_MM_YYYY.csv` with columns Date,Orders,Gross,Store promo,Commission,Marketing fee,Net,Advertising fee. In the totals file the advertising fee is a positive amount and Net is before ads.
- The Audit has a Missing days check (Grab 3 days late, LINE 2) and, since 28/11/2026, a Grab files check that flags a file sitting in Imported with no matching rows.

## Cloud Inbox
Cloud tasks cannot open the BOH page, so they append rows to the Cloud Inbox tab (ID, Created, Kind, Payload JSON, Status `new`). BOH checks every 3 minutes and writes Status done or error with a Result. Kinds: content-week, brief-update, marketing-note, marketing-report, recipe-sync. `CLOUD_INBOX_AUTO=off` in Railway stops it. A recipe-sync row with `"force": true` replaces a BOH recipe with the Google Doc version.

## Receipts typed in BOH or the BOH LINE group
Date line, shop line, then `item qty price` lines. The price is the total for the lot. `ea` or `each` means the price is per pack. The word `total` is accepted before or after the price. `undo receipt` removes the latest receipt.

## Scheduled tasks (cloud, Bangkok time)
- Publisher, hourly 07:02 to 21:02: trig_01NZEPxtVhvgiFR8DGCtBCZt
- Hourly content review of Lily's drop: trig_01HS5CxCiCUjzsVNzuS91Vt5 (Lily set the times herself, 10, 13, 16, 19, 22)
- Daily content briefs 09:23: trig_01XanUDP7HvodPvyUdxoBPkM
- Daily Grab order logging 16:05: trig_018Vd7LUgNHae7Z2ewQLdKva
- Weekly recipe sync, Mondays 07:41: trig_01BmknUodToxagRtEJt9vSHu
- Weekly competitor check, Sundays 23:00: trig_01U6uCjJy2oFcpM1S6mbxea8 (reads Instagram in a browser, so it needs her computer)
- One offs: lamb shank decision reminder 13/01/2027 09:30 (trig_01KrZpRAfXTRfv3HVcS61zFv), Price Log names edit 09/12/2026 10:00 (trig_01AR49NTf7ZXeiaXiksV3D7B)
- Switched off, not deleted: trig_01AvM3hd7yPs5i44uKGMkiTm

## Keys
ANTHROPIC_API_KEY on the BOH Railway service powers receipt photo reading, the caption grammar check and the Merlin's voice check. If a check says the key is missing or unavailable, look at the Console credit balance first (the key does not expire).

## Where the rest lives
The claude.ai Project "Merlin's Dish" holds the living handovers. Start with `claude/start-here.md`, then `claude/boh-living.md`.

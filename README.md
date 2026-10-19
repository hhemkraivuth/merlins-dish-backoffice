# Merlin's Dish — Back of House

Batch-processes Grab order screenshots and shopping receipts using Claude's vision
API, and tracks batch-cook lot costing (fixed portion counts per size, decremented
as orders come in) and packaging/dry-goods stock counts.

Separate service from `merlins-dish-bot` (the customer-facing LINE ordering app) —
same Railway project, own deploy, so a problem in one never affects the other.

## Local setup

```
npm install
cp .env.example .env
# fill in .env with real values
npm start
```

Open http://localhost:3001

## Environment variables

See `.env.example` for the full list. You'll need:
- `ANTHROPIC_API_KEY` — for the vision extraction calls
- `GOOGLE_SERVICE_ACCOUNT_JSON` — same service account as the LINE bot (sheet-logger@merlins-dish-bot.iam.gserviceaccount.com), full JSON key as one line
- `CLAUDE_LOG_SHEET_ID` — the Claude Log spreadsheet (defaults to the existing one)

## Google Sheet tabs required

These must exist in the Claude Log sheet before the app can write to them:
- `Expense Log`
- `Recipe Templates`
- `Batch Lots`
- `Batch Lot Sizes`
- `Batch Lot Ingredients`
- `Stock Counts`
- `Claude Log` (existing — Daily Orders writes here)

See the project notes for exact column headers for each tab.

## Deploying to Railway

1. Push this repo to GitHub
2. In Railway, open the same project as `merlins-dish-bot`
3. Click "+ New" → "GitHub Repo" → select this repo
4. In the new service's Variables tab, add the environment variables above
   (you can copy `GOOGLE_SERVICE_ACCOUNT_JSON` and `CLAUDE_LOG_SHEET_ID` straight
   from the existing merlins-dish-bot service if they're already set there)
5. Railway auto-deploys on push to the default branch
6. Once deployed, Railway gives you a public URL — open it on your phone to use


## Back of house LINE group (cook notes and receipts)

Send cook notes and receipt photos to a private LINE group. The app costs each batch from the
live Merlin's numbers sheet (read only) and logs it to the Claude Log.

**Cook note** (any time, several batches per message are fine):

```
7/10
Bolo
Meat 1000
O 446
G 60
Cl 234
C 230
yield 21
```

- The date and dish keyword come first. Dish words match the customer bot's (bolo, ragu, tpb, rws, dbs, chix, brocs).
- Ingredients you list replace the recipe quantity. Everything you leave out stays at the recipe quantity from that dish's tab.
- Cups and reheating are set to the yield. Cost per portion is total batch cost divided by the yield.
- Prices are the latest purchase **on or before the cook date**, from the live Price Log plus the Expense Log.
  A blank date cell in the Price Log counts as the same shopping trip as the row above it.
- Added to the Claude Log: `Cook Log` (one row per batch) and `Cook Log Lines` (every line, with the price date used).
- The same note sent twice is logged once.
- `Shorthand` tab (created automatically): add your own keywords as `Type | Short | Full name`
  (Type is `Dish` or `Ingredient`). `Meat` always means the first ingredient line of the dish's tab.

**Receipt (typed):** a date line, then one line per item with the quantity and a price ending in `thb`, `baht` or `฿`:

```
18/10
minced pork 1000g 110thb
onion 2kg 90thb
```

- Items are added to the `Expense Log` (the live Price Log is never written to), with the date you typed.
- Names are matched to the Price Tracker in any word order, so "minced pork" becomes "Pork - minced". An item that does not match is still logged under the name you typed and flagged.
- A batch cooked on or after that date uses the price. A batch cooked before it does not.
- Where you shopped: a line like `at Makro` (or `shop Makro`) under the date. It applies to the items below it until the next shop or date line, and goes in the Expense Log's Shopped at column. It is optional.
- No date line means the day you sent the message, and the reply says so.
- Commas are fine (`celery 2kg, 138thb`), the price can end in `thb`, `baht` or `฿` or simply follow a comma (`pelati, 2550g, 275`), and things counted by the container work (`campbells - mushroom 4 cans, 520`).
- Catching up on an old receipt? Add a line `prices only` and it logs the prices for costing past batches but adds no stock lots, so stock does not show as unused when it was cooked long ago.
- The same page is on the Weekly Receipts tab of the website.

### Stock lots (first in, first out)

Every countable ingredient you buy becomes a **lot** (date, quantity, price) in the `Ingredient Lots` tab of the Claude Log.
A batch takes its grams from the oldest lot first, using only lots bought on or before the cook date. A batch that spans
two lots is costed as the blend of the two prices. When a lot is used up, the next one takes over.

- **New purchases:** typed receipts create lots automatically.
- **Starting stock (one off):** `opening 19/10` then lines like `minced pork 2000g 220thb` (total price paid for that quantity). An ingredient that already has lots is skipped.
- **Check:** send `lots` to see what is left, oldest first.
- **Correct the quantity:** `count minced pork 3000g`. Lower than the books reduces the oldest lots. Higher adds an adjustment lot at the newest price.
- **Condiments:** names in the `Untracked Ingredients` tab (starts with Black pepper, Salt, All purpose flour) never get lots and keep using the latest price. Add more rows there any time.
- **Running short:** if a batch needs more than the lots hold, the rest is costed at the latest price and the reply says so. If an ingredient has no lots at all, it uses the latest price as before.
- `Lot Usage` tab records which lot each batch line took grams from. Lots are only reduced once a batch is actually logged, so a duplicate or a note with no yield takes nothing.
- The web Batch Cook page shows latest prices in its preview. The logged cost uses the lots.

**Receipt photos** are switched off. To turn them back on, set `RECEIPT_PHOTOS` to `on` in Railway and add `ANTHROPIC_API_KEY`. A photo sent while they are off gets a reminder to type the receipt instead.

Type `help` in the group for a reminder. Type `groupid` before `BOH_GROUP_ID` is set to find the group's id.

### Setup

1. LINE Developers: create a **new** Messaging API channel for back of house (do not reuse the customer bot's).
   Turn off auto reply and greeting messages. Turn on "Allow bot to join group chats".
   Webhook URL: `https://<this-service>.up.railway.app/webhook/line`, then press Verify.
2. Create a new private LINE group with only this bot and yourself.
3. In Railway, on this service only, set `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`,
   and the Google variables. (`ANTHROPIC_API_KEY` is only needed if you turn receipt photos on.)
4. Share the live Merlin's numbers sheet with the service account as **Viewer**; share the Claude Log as **Editor**.
5. Send `groupid` in the new group, then set the id it replies with as `BOH_GROUP_ID` and redeploy.

Run the tests with `npm test`.

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
- **Free samples:** `free 4/11` then lines like `knorr cube 2 boxes of 6` (boxes are turned into pieces: 12). The lot is added to stock but nothing goes in the Expense Log, so prices do not move. Free stock is costed at ฿0, so batches that use it come out cheaper. Set `FREE_STOCK_VALUE=last` in Railway if you ever want free stock valued at the last price paid instead. The Numbers page day view shows time, customer and New / RT status for every order, plus orders by hour.
- **Check:** send `lots` to see what is left, oldest first.
- **Correct the quantity:** `count minced pork 3000g`. Lower than the books reduces the oldest lots. Higher adds an adjustment lot at the newest price.
- **Condiments:** names in the `Untracked Ingredients` tab (starts with Black pepper, Salt, All purpose flour) never get lots and keep using the latest price. Add more rows there any time.
- **Running short:** if a batch needs more than the lots hold, the rest is costed at the latest price and the reply says so. If an ingredient has no lots at all, it uses the latest price as before.
- `Lot Usage` tab records which lot each batch line took grams from. Lots are only reduced once a batch is actually logged, so a duplicate or a note with no yield takes nothing.
- The web Batch Cook page shows latest prices in its preview. The logged cost uses the lots.

**Receipt photos** are switched off. To turn them back on, set `RECEIPT_PHOTOS` to `on` in Railway and add `ANTHROPIC_API_KEY`. A photo sent while they are off gets a reminder to type the receipt instead.

Type `help` in the group for a reminder. Type `groupid` before `BOH_GROUP_ID` is set to find the group's id.

## Numbers: Ledger, weekly and monthly reports, handoffs, huddle

One `Ledger` tab in the Claude Log holds every sale from both channels in one shape. The weekly and monthly reports, the team
inbox and the daily huddle are all built from it, with plain code (no AI, no tokens).

**Open the Numbers page** (link in the Back of House header, or `/reports.html`):

- **Import Grab CSV**: choose the nightly CSV (the 12 column Claude Log format). Importing replaces any Grab rows already
  stored for the days in that file, so a corrected CSV can be imported again safely and nothing doubles up.
  Rows with `XXXXXX` are kept and flagged.
- **Sync LINE orders**: reads the customer bot's `Orders` tab (read only) and adds any new orders, one row per item. Address and
  phone are not copied. Running it twice adds nothing.
- **Update report tabs in the sheet**: rebuilds the `Weekly Report` and `Monthly Report` tabs in the Claude Log.

**How the numbers are worked out** (this follows accounting-rules, so nothing is counted twice):

- Net income = Grab (gross sales, less discounts, commission, marketing fee) + LINE (gross sales less promo discounts).
- Batch dishes (stews, braises, Bolognese, Ragu, soups): cost lands on the **cook date**, from the Cook Log.
- Pasta, Bacon Steak and drinks: cost is the Recipe row on the Grab order. LINE orders have no Recipe rows, so their cost is
  **estimated** from the most recent Grab Recipe cost for the same item. An item with no Grab cost yet is listed in the
  `Checks` column instead of being guessed.
- **Delivery:** what the customer paid for delivery is income (it comes from the bot's Orders tab, as `Delivery` rows; free
  delivery logs nothing). What you actually paid the rider is a cost, typed into the back of house LINE group:
  `rider 001 55` (order #001 today), `rider 001 55 3/11` (another day), `rider 001,002 80` (one trip, two orders, split evenly).
  Send a fee again to correct it. Once you have logged your first rider fee, finished days with a LINE order and no rider fee
  show up in the Handoffs tab.
- Ingredient purchases from the Expense Log are shown as a **memo column** and never added to cost.
- Margin is after the rider fees you paid and after the **overheads you bought** that period (pots, bags, knives, the cash spent). Advertising is not in the system yet.

**Team handoffs** (`Handoffs` tab): the four teams are App sales (Grab), Direct sales (LINE), Operations (cooking) and
Purchasing. Notes are raised automatically: stock older than 5 days (flash sale), a dish sold out, a dish down to 3 portions or
fewer, portions sold beyond what the cook notes cover, and an ingredient price move of 10% or more. Type in the Reply column
and set Status to Done if you want to close one yourself. A note whose situation has cleared closes itself.

**Daily huddle**: type `huddle` in the back of house LINE group for the summary (yesterday, the week so far, stock left, open
handoffs). `week` and `month` show the income and cost summary, and `sync` pulls in the latest LINE orders.
To send the huddle automatically every night, set `HUDDLE_AUTO` to `on` in Railway (time is `HUDDLE_TIME`, Bangkok time,
default `21:30`). A call to `POST /api/huddle/run` with the header `x-huddle-token` set to `HUDDLE_TOKEN` also runs it.

New Railway variables on this service: `ORDERS_SHEET_ID` (same value as `GOOGLE_SHEET_ID` in merlins-dish-bot), and
optionally `HUDDLE_AUTO`, `HUDDLE_TIME`, `HUDDLE_TOKEN`. Nothing changes in merlins-dish-bot.

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

## All commands on one page
Open `/commands.html` (linked as Commands in the header) for every command, for both the customer bot and the BOH group.

## Best Prices tab
Every receipt refreshes the `Best Prices` tab in the Claude Log: the cheapest price per unit ever paid for each ingredient (Price Log plus Expense Log), written like the Price Tracker remark, for example `best price: 105.25/900g`, with the date and shop. Free stock never counts. To see it in the Price Tracker, put `=IFERROR(VLOOKUP(B77, IMPORTRANGE("<Claude Log sheet URL>","Best Prices!A:B"),2,FALSE),"")` in a spare column (column E stays yours).

Spelling slips in typed receipts (one wrong or swapped letter) are matched to the nearest ingredient and listed in the reply.

## Overheads
Pots, paper bags, knives and other non-ingredients: put an `overhead` line (or `overhead equipment`, `overhead packaging` to tag it) under the date in a typed receipt, then `pot 7lt, 2575thb` lines. They are written to the `Overheads` tab in the Claude Log and nowhere else. The Numbers page and Weekly and Monthly Report tabs show them in an `Overheads bought` column. They count as that period's spending: the Numbers page shows Margin before overheads, Overheads bought and Margin after overheads. They are never counted as food cost and never taken off stock (paper bags are not tracked per order).

## Brands
Put a brand in brackets after the ingredient name in a typed receipt: `tomato paste (Mica) 560g, 12pcs, 816thb`. Matching ignores it, the Expense Log Remarks column says `Brand: Mica`, and the Best Prices tab shows it, for example `best price: 816/6720g, Mica`.

## Condiments counted in unopened packs
Condiments on the Untracked Ingredients tab (salt, flour, pepper) are not costed from stock lots. Instead, count the unopened packs: `stock add Salt, pack, 3`. After that, a receipt line adds the packs bought (`salt, 1000g, 18thb` is 1 pack, `flour 1000g, 2pcs, 74thb` is 2). Cook notes never take packs off, because the open bag is not counted. `stock salt 2` sets the real number. A pack count of 1 or less shows RUNNING LOW in `stock` and in the huddle.

## Size then count
`worcestershire sauce, 290ml, 8bottles, 1168` stores 2320ml. Whether a line is stored as total weight or volume, or as pieces, follows the Unit column of the Price Tracker. The Pack Sizes tab is only needed when a line has no size (`2 bottles` alone).

## Condiments in grams, and low alerts
To track a condiment (salt, flour, pepper) by grams like any other ingredient, delete it from the `Untracked Ingredients` tab. Receipts then make lots, cook notes take grams off (recipe quantity when a line is left out), and `count salt 400g` corrects it when a bag runs out early or has leftovers. Set an alert with `low salt 500g` (stored in the `Reorder Levels` tab). `low` lists what is below its level, `lots` marks it LOW and the nightly huddle includes it.

## Undo, short names and one receipt path
Every typed receipt gets an ID (for example R261104-153211), shown in the reply and written into the Remarks of the Expense Log and Overheads rows and the Note of the stock lots. `undo receipt` removes the latest receipt, `undo receipt <ID>` an older one. Lots a batch has already used from are kept.
`alias en ziero = <full name>` saves a short name in the Shorthand tab (Type Ingredient). The catalogue for matching is the Price Tracker plus every ingredient already in the Price Log.
The Weekly Receipts page and the LINE group now share one set of dependencies (`server/lib/receiptDeps.js`), so both do the same thing. The Daily Orders page is gone; Grab CSVs go in through the Numbers page. The Stock Counts page also shows ingredient stock from the lots (read only).


## Weekly export to Google Drive (Sundays)

Every Sunday at 20:00 Bangkok time the app saves last week's data to Drive as CSV files. A week is Sunday to Saturday,
so a Saturday night shop is in that week and anything bought on the Sunday itself counts in the next one.
Files go in `<weekly folder>/<year>/<dd-mm>/`, named for the Sunday they were saved (`08-11` holds Sunday 01/11 to Saturday 07/11).
Files: Weekly Receipts, Batch Cook, Batch Cook Lines, Marketing Sales, Marketing Notes, Numbers Ledger,
Numbers Weekly Report, Numbers Monthly Report. Running it again for the same week replaces the files.
It runs on Railway, so no computer needs to be on. If Railway was down on Sunday it catches up on the next check.

Set in Railway:
- `DRIVE_WEEKLY_FOLDER_ID`: the Drive folder, shared with the service account email as Editor
- `WEEKLY_EXPORT_AUTO=on`: turns the Sunday timer on
- `BOT_URL`: the customer bot address (for example https://merlins-dish-bot.up.railway.app). BOH reads its public menu feed, read only, at 03:00 Bangkok time (change with `STOCK_SNAPSHOT_TIME`) to fill the Stock left box on Home. Nothing is ever written to the bot.
- `WEEKLY_EXPORT_TIME`: optional, Bangkok time HH:MM (default 20:00)

Test it any time with "Save last week to Drive now" on the Numbers page (saves the last finished Sunday to Saturday week).
If Drive says the service account has no storage quota, put the folder in a Shared Drive.

## Shopping plan

`GET /api/shopping/plan` (cached 5 minutes, `?refresh=1` to rebuild). Shown on the Receipts page and in a box on Home.
Demand is portions sold per batch dish (Merlin's numbers Master Log for August, Sheet1 and Ledger after), averaged over normal months only (October is left out), plus 10%.
Amounts per portion come from real batches in Cook Log Lines. Fresh items (onion, celery, carrot, mushroom, milk) are bought about every 10 days and never kept past 14. Everything else is one bulk trip covering 30 days, grouped by the cheapest recent shop.
To change a shelf life, add a `Shelf Life` tab (Ingredient | Days) to the Claude Log sheet or Merlin's numbers. 30 days or more counts as bulk.
Stock now is estimated from receipts minus usual daily use, so keep logging receipts.

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

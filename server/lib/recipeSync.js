// Keeps the Recipes page in step with Lily's Google Doc "Recipe: Mein Hans Edition". A weekly cloud task reads the doc and sends one
// Cloud Inbox row per recipe (kind recipe-sync). This module decides what to do, with the same save path as the Recipes page.
//
//   payload: { title: "Dark Beer Beef Stew (Target: 7R + 4L)", updated: "25/11", text: "<everything under the title>", force?: true }
//
// Never overwrites a recipe Lily edited on the BOH page after the doc: that one is reported instead, and stays as she left it.
// "Edited on the BOH page" is known from a fingerprint saved at each sync (App State, recipe_sync_state), so a sync never
// mistakes its own earlier save for a hand edit.
const crypto = require('crypto');

const STATE_KEY = 'recipe_sync_state';
const keyOf = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '');

// Doc names that differ from the dish name the BOH keeps (the BOH name links to the cook log tabs, so it stays).
const RENAMES = [[/^bacon pomodoro/i, 'Spicy Rosso'], [/lamb shank/i, 'Slow-Braised Lamb Shank']];

// Google's export escapes characters and numbers lists its own way. This puts it in the style the Recipes page already shows.
function tidyText(raw) {
  return String(raw || '')
    .replace(/\r\n/g, '\n').replace(/[\u2028\u2029]/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\\([.~+_\-()#!])/g, '$1')
    .split('\n').map((l) => l.replace(/\s+$/, ''))
    .map((l) => l.replace(/^\s*[-*•]\s+/, '* ').replace(/^\s*(\d+)\s*[.)]\s*/, '$1. '))
    .filter((l) => l.trim()).join('\n');
}
const cleanTitle = (t) => String(t || '').replace(/\\([+~.])/g, '$1').replace(/^[*_#\s]+|[*_\s]+$/g, '').replace(/\*\*/g, '').trim();
const fingerprint = (text) => crypto.createHash('sha1').update(String(text || '').toLowerCase().replace(/[\\*_`~•\-]/g, ' ').replace(/(^|\n)\s*\d+\s*[.)]\s*/g, '$1').replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 16);

// "Dark Beer Beef Stew (Target: 7R + 4L)" -> the existing dish it belongs to, or null.
function findDish(title, dishes) {
  const base = String(title || '').replace(/\(.*?\)/g, '').trim();
  const k = keyOf(base);
  if (!k) return null;
  const exact = dishes.find((d) => keyOf(d.dish) === k); if (exact) return exact;
  const ren = RENAMES.find(([re]) => re.test(base)); if (ren) { const d = dishes.find((x) => keyOf(x.dish) === keyOf(ren[1])); if (d) return d; }
  const near = dishes.filter((d) => { const dk = keyOf(d.dish); return k.length >= 8 && dk.length >= 8 && (dk.startsWith(k) || k.startsWith(dk)); });
  return near.length === 1 ? near[0] : null;
}

// "25/11" -> Date (year of `now`, or the year before when that would be in the future).
function docDate(s, now) {
  const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/); if (!m) return null;
  let y = m[3] ? Number(m[3]) : now.getUTCFullYear(); if (y < 100) y += 2000;
  let d = new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[1]), 23, 59, 59));
  if (!m[3] && d > new Date(now.getTime() + 86400000)) d = new Date(Date.UTC(y - 1, Number(m[2]) - 1, Number(m[1]), 23, 59, 59));
  return d;
}

async function sync(payload, deps = {}) {
  const recipeStore = require('./recipeStore');
  const load = deps.load || (() => recipeStore.load(require('../data/recipes.json')));
  const save = deps.save || ((o) => recipeStore.save(require('../data/recipes.json'), o));
  const appState = deps.appState || require('./appState');
  const now = deps.now ? deps.now() : new Date();

  const title = cleanTitle(payload.title);
  if (!title) throw new Error('recipe-sync needs a title.');
  let body = String(payload.text || '');
  // The text may start with the title line again; drop it so the same words are not saved twice.
  const first = body.split('\n').find((l) => l.trim());
  if (first && keyOf(cleanTitle(first)) === keyOf(title)) body = body.slice(body.indexOf(first) + first.length);
  const text = tidyText(body);
  if (text.length < 80) throw new Error(`"${title}" came through with almost no text (${text.length} characters). Nothing saved.`);

  const doc = await load();
  const dish = findDish(title, doc.dishes);
  const name = dish ? dish.dish : title.replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
  const fp = fingerprint(text);
  const current = dish ? (dish.lines || []).join('\n') : '';
  if (dish && fingerprint(current) === fp) { await remember(appState, name, fp); return { dish: name, result: 'unchanged' }; }

  if (dish && !payload.force) {
    let state = {}; try { state = JSON.parse(await appState.getState(STATE_KEY) || '{}') || {}; } catch (e) { state = {}; }
    const known = state[keyOf(name)];
    const dd = docDate(payload.updated, now);
    const savedAt = dish.saved ? new Date(dish.saved) : null;
    const handEdited = known ? fingerprint(current) !== known : Boolean(savedAt && dd && savedAt > dd);
    if (handEdited) return { dish: name, result: 'kept the BOH version', why: `edited on the Recipes page${savedAt ? ` (${savedAt.toISOString().slice(0, 10)})` : ''} after the doc's version, so it was not overwritten. Send it again with force true to use the doc.` };
  }
  await save({ dish: name, category: dish ? dish.category : undefined, title, text });
  await remember(appState, name, fp);
  return { dish: name, result: dish ? 'updated from the doc' : 'new recipe added from the doc', docUpdate: payload.updated || '' };
}

async function remember(appState, name, fp) {
  let state = {}; try { state = JSON.parse(await appState.getState(STATE_KEY) || '{}') || {}; } catch (e) { state = {}; }
  if (state[keyOf(name)] === fp) return;
  state[keyOf(name)] = fp;
  await appState.setState(STATE_KEY, JSON.stringify(state));
}

module.exports = { sync, tidyText, findDish, fingerprint, docDate, cleanTitle, STATE_KEY };

// Thin LINE Messaging API helpers (uses Node's built-in fetch, Node 18+).

const crypto = require('crypto');

function verifySignature(rawBody, signature, channelSecret) {
  if (!rawBody || !signature || !channelSecret) return false;
  const expected = crypto.createHmac('sha256', channelSecret).update(rawBody).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function chunk(text, size = 4800) {
  const out = [];
  let rest = String(text);
  while (rest.length > size) {
    let cut = rest.lastIndexOf('\n', size);
    if (cut < size / 2) cut = size;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, '');
  }
  out.push(rest);
  return out.slice(0, 5);
}

async function post(path, body, token) {
  const res = await fetch(`https://api.line.me${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`LINE ${path} ${res.status}: ${await res.text()}`);
}

const asMessages = (text) => chunk(text).map((t) => ({ type: 'text', text: t }));

async function reply(replyToken, text, token) {
  return post('/v2/bot/message/reply', { replyToken, messages: asMessages(text) }, token);
}

async function push(to, text, token) {
  return post('/v2/bot/message/push', { to, messages: asMessages(text) }, token);
}

async function getContent(messageId, token) {
  const res = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`LINE content ${res.status}`);
  return { buffer: Buffer.from(await res.arrayBuffer()), mime: res.headers.get('content-type') || 'image/jpeg' };
}

module.exports = { verifySignature, reply, push, getContent, chunk };

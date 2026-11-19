// A map pin typed by hand: "13.7368, 100.5603", or a Google Maps link that carries the coordinates.
// Returns { lat, lng }, or null when the text is empty. Throws a plain message when it cannot be read.
// The check keeps pins inside Thailand, which also catches latitude and longitude typed the wrong way round.

function parsePin(text) {
  const t = String(text === undefined || text === null ? '' : text).trim();
  if (!t) return null;
  let m = /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/.exec(t)
    || /[?&](?:q|ll|query|destination)=(-?\d+(?:\.\d+)?)(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/i.exec(t)
    || /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(t)
    || /^\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(t);
  if (!m) {
    if (/^https?:\/\//i.test(t)) throw new Error('That map link has no coordinates in it (short links like maps.app.goo.gl do not). Open it, then copy the numbers, like 13.7368, 100.5603.');
    throw new Error('Type the map pin as latitude, longitude, like 13.7368, 100.5603, or paste a Google Maps link.');
  }
  const lat = Number(m[1]); const lng = Number(m[2]);
  if (!(lat >= 5 && lat <= 21 && lng >= 97 && lng <= 106)) throw new Error(`${lat}, ${lng} is outside Thailand. Check the numbers, latitude comes first (about 13.7 for Bangkok), then longitude (about 100.5).`);
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
}

module.exports = { parsePin };

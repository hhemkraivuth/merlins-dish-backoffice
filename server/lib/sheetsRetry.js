// Google Sheets allows about 60 read requests and 60 write requests per minute per user. A long cook note (many batches
// in one message) goes over that. A 429 means Google did not run the call, so waiting and trying again is always safe.
// Delays: about 7s, 12s, then 40s each, so a call keeps trying for roughly two minutes, longer than the one minute window.
const SHEETS_RETRY = {
  retry: Number(process.env.SHEETS_RETRY_COUNT || 6),
  retryDelay: Number(process.env.SHEETS_RETRY_DELAY_MS || 5000),
  retryDelayMultiplier: 5,
  maxRetryDelay: Number(process.env.SHEETS_RETRY_MAX_MS || 40000),
  totalTimeout: 300000,
  statusCodesToRetry: [[429, 429]],
  httpMethodsToRetry: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'POST', 'DELETE'],
};
module.exports = { SHEETS_RETRY };

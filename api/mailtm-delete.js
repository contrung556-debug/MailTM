// ============================================================
// TEMP MAIL OTP INTEGRATION - VERSION 1.0.4
// File: api/mailtm-delete.js
// ============================================================
const BASES = { 'mail.tm': 'https://api.mail.tm', 'mail.gw': 'https://api.mail.gw' };
function json(res, status, data) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify(data));
}
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  }
  const token = String(req.body?.token || '').trim();
  const accountId = String(req.body?.account_id || '').trim();
  const provider = BASES[req.body?.provider] ? req.body.provider : 'mail.tm';
  if (!token || !accountId) return json(res, 400, { ok: false, error: 'TOKEN_AND_ACCOUNT_ID_REQUIRED' });
  try {
    const response = await fetch(`${BASES[provider]}/accounts/${encodeURIComponent(accountId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
    });
    if (response.status === 204) return json(res, 200, { ok: true, deleted: true, provider });
    const text = await response.text();
    return json(res, response.status, { ok: false, provider, error: 'DELETE_FAILED', upstream_status: response.status, details: text.slice(0, 1200) });
  } catch (err) {
    return json(res, 502, { ok: false, provider, error: 'TEMP_MAIL_UPSTREAM_ERROR', details: String(err?.message || err) });
  }
};

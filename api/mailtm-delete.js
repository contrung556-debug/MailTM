// ============================================================
// MAIL.TM TEMP MAIL INTEGRATION - VERSION 1.0.0
// File: api/mailtm-delete.js
// Purpose: Delete the current temporary Mail.tm account.
// ============================================================

const MAILTM_BASE = 'https://api.mail.tm';

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

  if (!token || !accountId) {
    return json(res, 400, { ok: false, error: 'TOKEN_AND_ACCOUNT_ID_REQUIRED' });
  }

  try {
    const response = await fetch(`${MAILTM_BASE}/accounts/${encodeURIComponent(accountId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.status === 204) {
      return json(res, 200, { ok: true, deleted: true });
    }

    const text = await response.text();
    return json(res, response.status, {
      ok: false,
      error: 'DELETE_FAILED',
      upstream_status: response.status,
      details: text,
    });
  } catch (err) {
    return json(res, 502, { ok: false, error: 'MAILTM_ERROR', details: String(err?.message || err) });
  }
};

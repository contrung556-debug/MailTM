// ============================================================
// MAIL.TM TEMP MAIL INTEGRATION - VERSION 1.0.0
// File: api/mailtm-create.js
// Purpose: Create a Mail.tm mailbox and return credentials/token.
// Runtime: Vercel Node.js Serverless Function (Node 18+)
// ============================================================

const MAILTM_BASE = 'https://api.mail.tm';

function json(res, status, data) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify(data));
}

function randomString(length = 12) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function strongPassword(length = 20) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

async function mailtmFetch(path, options = {}) {
  const response = await fetch(`${MAILTM_BASE}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const err = new Error(`Mail.tm HTTP ${response.status}`);
    err.status = response.status;
    err.data = data;
    throw err;
  }

  return data;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const domainsData = await mailtmFetch('/domains?page=1');
    const domains = Array.isArray(domainsData?.['hydra:member'])
      ? domainsData['hydra:member']
      : [];

    const usable = domains.filter((d) => d?.isActive !== false && d?.domain);
    if (!usable.length) {
      return json(res, 503, { ok: false, error: 'NO_ACTIVE_DOMAIN' });
    }

    // Randomly choose among active domains to reduce collisions/load concentration.
    const domain = usable[Math.floor(Math.random() * usable.length)].domain;

    // Optional prefix from request body; sanitized and still randomized.
    const requestedPrefix = String(req.body?.prefix || '')
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, '')
      .slice(0, 20);

    let created = null;
    let address = '';
    let password = '';

    // Retry username collisions a few times.
    for (let attempt = 0; attempt < 4; attempt++) {
      const local = `${requestedPrefix || 'nk'}${requestedPrefix ? '-' : ''}${randomString(10)}`;
      address = `${local}@${domain}`;
      password = strongPassword(20);

      try {
        created = await mailtmFetch('/accounts', {
          method: 'POST',
          body: JSON.stringify({ address, password }),
        });
        break;
      } catch (err) {
        if (err.status === 422 && attempt < 3) continue;
        throw err;
      }
    }

    if (!created?.id) {
      return json(res, 502, { ok: false, error: 'ACCOUNT_CREATE_FAILED' });
    }

    const tokenData = await mailtmFetch('/token', {
      method: 'POST',
      body: JSON.stringify({ address, password }),
    });

    if (!tokenData?.token) {
      return json(res, 502, { ok: false, error: 'TOKEN_CREATE_FAILED' });
    }

    return json(res, 201, {
      ok: true,
      version: '1.0.0',
      provider: 'mail.tm',
      account_id: created.id,
      address,
      password,
      token: tokenData.token,
      created_at: created.createdAt || new Date().toISOString(),
    });
  } catch (err) {
    const status = err?.status === 429 ? 429 : 502;
    return json(res, status, {
      ok: false,
      error: err?.status === 429 ? 'MAILTM_RATE_LIMITED' : 'MAILTM_ERROR',
      upstream_status: err?.status || null,
      details: err?.data || String(err?.message || err),
    });
  }
};

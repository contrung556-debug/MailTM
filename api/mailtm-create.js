// ============================================================
// TEMP MAIL OTP INTEGRATION - VERSION 1.0.4
// File: api/mailtm-create.js
// Primary: Mail.tm | Fallback: Mail.gw
// ============================================================

const PROVIDERS = [
  { key: 'mail.tm', base: 'https://api.mail.tm' },
  { key: 'mail.gw', base: 'https://api.mail.gw' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function json(res, status, data) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify(data));
}

function randomString(length = 12) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

const FIXED_PASSWORD = 'Cuong123@';

async function fetchJson(base, path, options = {}, stage = 'request', retries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(`${base}${path}`, {
        ...options,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...(options.headers || {}),
        },
      });

      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; }
      catch { data = text ? { raw: text.slice(0, 1200) } : null; }

      if (response.ok) return data;

      const err = new Error(`Upstream HTTP ${response.status}`);
      err.status = response.status;
      err.data = data;
      err.stage = stage;
      lastError = err;

      // Retry only transient server/rate-limit errors.
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === retries) throw err;
      await sleep(450 * (attempt + 1));
    } catch (err) {
      lastError = err;
      if (err.status && ![429, 500, 502, 503, 504].includes(err.status)) throw err;
      if (attempt === retries) throw err;
      await sleep(450 * (attempt + 1));
    }
  }
  throw lastError || new Error('Unknown upstream error');
}

async function createOnProvider(provider, requestedPrefix) {
  const domainsData = await fetchJson(provider.base, '/domains?page=1', {}, 'domains', 2);
  let domains = Array.isArray(domainsData?.['hydra:member']) ? domainsData['hydra:member'] : [];

  domains = domains.filter((d) => d?.domain && d?.isActive !== false && d?.isPrivate !== true);
  if (!domains.length) {
    const err = new Error('No active public domains');
    err.stage = 'domains';
    err.status = 503;
    throw err;
  }

  // Try several different domains; one domain can be temporarily unhealthy even when listed active.
  domains = domains.slice().sort(() => Math.random() - 0.5).slice(0, 6);
  let lastError = null;

  for (const item of domains) {
    for (let collisionTry = 0; collisionTry < 2; collisionTry++) {
      const local = `${requestedPrefix || 'nk'}${requestedPrefix ? '-' : ''}${randomString(12)}`;
      const address = `${local}@${item.domain}`;
      const password = FIXED_PASSWORD;

      try {
        const created = await fetchJson(provider.base, '/accounts', {
          method: 'POST',
          body: JSON.stringify({ address, password }),
        }, 'accounts', 1);

        if (!created?.id) {
          const e = new Error('Account created without id');
          e.stage = 'accounts';
          throw e;
        }

        const tokenData = await fetchJson(provider.base, '/token', {
          method: 'POST',
          body: JSON.stringify({ address, password }),
        }, 'token', 2);

        if (!tokenData?.token) {
          const e = new Error('Token response missing token');
          e.stage = 'token';
          throw e;
        }

        return {
          provider: provider.key,
          account_id: created.id,
          address,
          password,
          token: tokenData.token,
          created_at: created.createdAt || new Date().toISOString(),
        };
      } catch (err) {
        lastError = err;
        // 422 is usually username/domain validation/collision: try another address/domain.
        if (err?.status === 422) continue;
        // 5xx can be domain-specific: move to the next domain.
        if ([500, 502, 503, 504].includes(err?.status)) break;
        throw err;
      }
    }
  }

  throw lastError || Object.assign(new Error('All domains failed'), { stage: 'accounts' });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  const requestedPrefix = String(req.body?.prefix || '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, 20);

  const failures = [];

  for (const provider of PROVIDERS) {
    try {
      const account = await createOnProvider(provider, requestedPrefix);
      return json(res, 201, {
        ok: true,
        version: '1.0.4',
        fallback_used: provider.key !== 'mail.tm',
        ...account,
      });
    } catch (err) {
      failures.push({
        provider: provider.key,
        stage: err?.stage || 'unknown',
        upstream_status: err?.status || null,
        details: err?.data || String(err?.message || err),
      });
    }
  }

  return json(res, 502, {
    ok: false,
    version: '1.0.4',
    error: 'ALL_TEMP_MAIL_PROVIDERS_FAILED',
    failures,
  });
};

// ============================================================
// TEMP MAIL OTP INTEGRATION - VERSION 1.0.4
// File: api/mailtm-otp.js
// Supports Mail.tm and Mail.gw accounts created by this project.
// ============================================================

const BASES = {
  'mail.tm': 'https://api.mail.tm',
  'mail.gw': 'https://api.mail.gw',
};
const MAX_MESSAGES_TO_INSPECT = 8;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function json(res, status, data) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify(data));
}

async function fetchJson(base, path, token, retries = 1) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(`${base}${path}`, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
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
      last = err;
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === retries) throw err;
      await sleep(400 * (attempt + 1));
    } catch (err) {
      last = err;
      if (err.status && ![429, 500, 502, 503, 504].includes(err.status)) throw err;
      if (attempt === retries) throw err;
      await sleep(400 * (attempt + 1));
    }
  }
  throw last;
}

function decodeHtmlEntities(s) {
  return String(s || '')
    .replace(/&amp;/gi, '&').replace(/&#38;/g, '&')
    .replace(/&quot;/gi, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
}
function stripHtml(html) {
  return decodeHtmlEntities(String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim();
}
function normalizeHtml(html) { return Array.isArray(html) ? html.join('\n') : String(html || ''); }
function extractLinks(raw) {
  const text = decodeHtmlEntities(String(raw || ''));
  const found = new Set();
  let m;
  const hrefRe = /href\s*=\s*["'](https?:\/\/[^"']+)["']/gi;
  while ((m = hrefRe.exec(text))) found.add(m[1]);
  const urlRe = /https?:\/\/[^\s"'<>]+/gi;
  while ((m = urlRe.exec(text))) found.add(m[0].replace(/[),.;]+$/g, ''));
  return [...found].slice(0, 20);
}
function extractOtp(text) {
  const src = String(text || '');
  const contextual = [
    /(?:otp|verification\s*code|verify\s*code|security\s*code|confirmation\s*code|mã\s*(?:xác\s*minh|xac\s*minh|otp|bảo\s*mật|bao\s*mat))[^0-9]{0,50}([0-9]{4,8})/i,
    /([0-9]{4,8})[^\n]{0,50}(?:otp|verification\s*code|security\s*code|mã\s*(?:xác\s*minh|xac\s*minh|otp))/i,
  ];
  for (const re of contextual) {
    const m = src.match(re);
    if (m?.[1]) return m[1];
  }
  const all = src.match(/(?<!\d)\d{4,8}(?!\d)/g) || [];
  return all.find((v) => !(v.length === 4 && Number(v) >= 1900 && Number(v) <= 2100)) || null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  const token = String(req.body?.token || '').trim();
  const provider = BASES[req.body?.provider] ? req.body.provider : 'mail.tm';
  const base = BASES[provider];
  const fromFilter = String(req.body?.from || '').trim().toLowerCase();
  const subjectFilter = String(req.body?.subject || '').trim().toLowerCase();
  const after = req.body?.after ? new Date(req.body.after) : null;

  if (!token) return json(res, 400, { ok: false, error: 'TOKEN_REQUIRED' });
  if (after && Number.isNaN(after.getTime())) return json(res, 400, { ok: false, error: 'INVALID_AFTER_DATE' });

  try {
    const list = await fetchJson(base, '/messages?page=1', token, 1);
    let messages = Array.isArray(list?.['hydra:member']) ? list['hydra:member'] : [];

    messages = messages.filter((msg) => {
      if (fromFilter) {
        const a = String(msg?.from?.address || '').toLowerCase();
        const n = String(msg?.from?.name || '').toLowerCase();
        if (!a.includes(fromFilter) && !n.includes(fromFilter)) return false;
      }
      if (subjectFilter && !String(msg?.subject || '').toLowerCase().includes(subjectFilter)) return false;
      if (after) {
        const created = new Date(msg?.createdAt || 0);
        if (!created.getTime() || created < after) return false;
      }
      return true;
    }).sort((a, b) => new Date(b?.createdAt || 0) - new Date(a?.createdAt || 0)).slice(0, MAX_MESSAGES_TO_INSPECT);

    if (!messages.length) return json(res, 200, { ok: true, found: false, provider, status: 'waiting', message: 'Chưa có thư phù hợp.' });

    for (const summary of messages) {
      const detail = await fetchJson(base, `/messages/${encodeURIComponent(summary.id)}`, token, 1);
      const html = normalizeHtml(detail?.html);
      const plain = String(detail?.text || '');
      const combinedText = `${detail?.subject || ''}\n${plain}\n${stripHtml(html)}`;
      const combinedRaw = `${plain}\n${html}`;
      const otp = extractOtp(combinedText);
      const links = extractLinks(combinedRaw);

      if (otp || links.length) {
        return json(res, 200, {
          ok: true, found: true, version: '1.0.4', provider,
          message_id: detail?.id || summary.id,
          from: detail?.from || summary?.from || null,
          subject: detail?.subject || summary?.subject || '',
          created_at: detail?.createdAt || summary?.createdAt || null,
          otp, link: links[0] || null, links,
          text_preview: combinedText.slice(0, 500),
        });
      }
    }

    return json(res, 200, {
      ok: true, found: false, provider, status: 'mail_found_but_no_otp_or_link',
      newest_message: { id: messages[0]?.id || null, from: messages[0]?.from || null, subject: messages[0]?.subject || '', created_at: messages[0]?.createdAt || null },
    });
  } catch (err) {
    const status = err?.status === 401 ? 401 : err?.status === 429 ? 429 : 502;
    return json(res, status, {
      ok: false, provider,
      error: err?.status === 401 ? 'INVALID_OR_EXPIRED_TOKEN' : err?.status === 429 ? 'TEMP_MAIL_RATE_LIMITED' : 'TEMP_MAIL_UPSTREAM_ERROR',
      upstream_status: err?.status || null,
      details: err?.data || String(err?.message || err),
    });
  }
};

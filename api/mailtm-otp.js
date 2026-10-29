// ============================================================
// MAIL.TM TEMP MAIL INTEGRATION - VERSION 1.0.0
// File: api/mailtm-otp.js
// Purpose: Read newest Mail.tm messages and extract OTP + verification links.
// Runtime: Vercel Node.js Serverless Function (Node 18+)
// ============================================================

const MAILTM_BASE = 'https://api.mail.tm';
const MAX_MESSAGES_TO_INSPECT = 8;

function json(res, status, data) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify(data));
}

async function mailtmFetch(path, token) {
  const response = await fetch(`${MAILTM_BASE}${path}`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
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

function decodeHtmlEntities(s) {
  return String(s || '')
    .replace(/&amp;/gi, '&')
    .replace(/&#38;/g, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function stripHtml(html) {
  return decodeHtmlEntities(
    String(html || '')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
  ).trim();
}

function extractLinks(raw) {
  const text = decodeHtmlEntities(String(raw || ''));
  const found = new Set();

  // href="..."
  const hrefRe = /href\s*=\s*["'](https?:\/\/[^"']+)["']/gi;
  let m;
  while ((m = hrefRe.exec(text))) found.add(m[1]);

  // Plain URL fallback.
  const urlRe = /https?:\/\/[^\s"'<>]+/gi;
  while ((m = urlRe.exec(text))) found.add(m[0].replace(/[),.;]+$/g, ''));

  return [...found].slice(0, 20);
}

function extractOtp(text) {
  const src = String(text || '');

  // Prefer numbers near common verification-code keywords.
  const contextual = [
    /(?:otp|verification\s*code|verify\s*code|security\s*code|confirmation\s*code|mã\s*(?:xác\s*minh|xac\s*minh|otp|bảo\s*mật|bao\s*mat))[^0-9]{0,40}([0-9]{4,8})/i,
    /([0-9]{4,8})[^\n]{0,40}(?:otp|verification\s*code|security\s*code|mã\s*(?:xác\s*minh|xac\s*minh|otp))/i,
  ];

  for (const re of contextual) {
    const m = src.match(re);
    if (m?.[1]) return m[1];
  }

  // Fallback: standalone 4-8 digit code. Avoid years where possible.
  const all = src.match(/(?<!\d)\d{4,8}(?!\d)/g) || [];
  const filtered = all.filter((v) => !(v.length === 4 && Number(v) >= 1900 && Number(v) <= 2100));
  return filtered[0] || null;
}

function normalizeHtml(html) {
  if (Array.isArray(html)) return html.join('\n');
  return String(html || '');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  const token = String(req.body?.token || '').trim();
  const fromFilter = String(req.body?.from || '').trim().toLowerCase();
  const subjectFilter = String(req.body?.subject || '').trim().toLowerCase();
  const after = req.body?.after ? new Date(req.body.after) : null;

  if (!token) {
    return json(res, 400, { ok: false, error: 'TOKEN_REQUIRED' });
  }

  if (after && Number.isNaN(after.getTime())) {
    return json(res, 400, { ok: false, error: 'INVALID_AFTER_DATE' });
  }

  try {
    const list = await mailtmFetch('/messages?page=1', token);
    let messages = Array.isArray(list?.['hydra:member']) ? list['hydra:member'] : [];

    messages = messages
      .filter((msg) => {
        if (fromFilter) {
          const fromAddress = String(msg?.from?.address || '').toLowerCase();
          const fromName = String(msg?.from?.name || '').toLowerCase();
          if (!fromAddress.includes(fromFilter) && !fromName.includes(fromFilter)) return false;
        }

        if (subjectFilter) {
          const subject = String(msg?.subject || '').toLowerCase();
          if (!subject.includes(subjectFilter)) return false;
        }

        if (after) {
          const created = new Date(msg?.createdAt || 0);
          if (!created.getTime() || created < after) return false;
        }

        return true;
      })
      .sort((a, b) => new Date(b?.createdAt || 0) - new Date(a?.createdAt || 0))
      .slice(0, MAX_MESSAGES_TO_INSPECT);

    if (!messages.length) {
      return json(res, 200, {
        ok: true,
        found: false,
        status: 'waiting',
        message: 'Chưa có thư phù hợp.',
      });
    }

    // Read newest matching messages until we find OTP or link.
    for (const summary of messages) {
      const detail = await mailtmFetch(`/messages/${encodeURIComponent(summary.id)}`, token);
      const html = normalizeHtml(detail?.html);
      const plain = String(detail?.text || '');
      const combinedText = `${detail?.subject || ''}\n${plain}\n${stripHtml(html)}`;
      const combinedRaw = `${plain}\n${html}`;

      const otp = extractOtp(combinedText);
      const links = extractLinks(combinedRaw);

      if (otp || links.length) {
        return json(res, 200, {
          ok: true,
          found: true,
          version: '1.0.0',
          message_id: detail?.id || summary.id,
          from: detail?.from || summary?.from || null,
          subject: detail?.subject || summary?.subject || '',
          created_at: detail?.createdAt || summary?.createdAt || null,
          otp,
          link: links[0] || null,
          links,
          text_preview: combinedText.slice(0, 500),
        });
      }
    }

    return json(res, 200, {
      ok: true,
      found: false,
      status: 'mail_found_but_no_otp_or_link',
      newest_message: {
        id: messages[0]?.id || null,
        from: messages[0]?.from || null,
        subject: messages[0]?.subject || '',
        created_at: messages[0]?.createdAt || null,
      },
    });
  } catch (err) {
    const status = err?.status === 401 ? 401 : err?.status === 429 ? 429 : 502;
    const code = err?.status === 401
      ? 'INVALID_OR_EXPIRED_TOKEN'
      : err?.status === 429
        ? 'MAILTM_RATE_LIMITED'
        : 'MAILTM_ERROR';

    return json(res, status, {
      ok: false,
      error: code,
      upstream_status: err?.status || null,
      details: err?.data || String(err?.message || err),
    });
  }
};

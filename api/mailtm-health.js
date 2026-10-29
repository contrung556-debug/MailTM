// TEMP MAIL OTP INTEGRATION - VERSION 1.0.4
const PROVIDERS = [
  { key: 'mail.tm', base: 'https://api.mail.tm' },
  { key: 'mail.gw', base: 'https://api.mail.gw' },
];
module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok:false, error:'METHOD_NOT_ALLOWED' });
  const checks = [];
  for (const p of PROVIDERS) {
    const started = Date.now();
    try {
      const r = await fetch(`${p.base}/domains?page=1`, { headers:{ Accept:'application/json', 'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' } });
      const text = await r.text();
      let count = null;
      try { const d = JSON.parse(text); count = d?.['hydra:totalItems'] ?? d?.['hydra:member']?.length ?? null; } catch {}
      checks.push({ provider:p.key, ok:r.ok, status:r.status, ms:Date.now()-started, domains:count });
    } catch (e) {
      checks.push({ provider:p.key, ok:false, status:null, ms:Date.now()-started, error:String(e?.message || e) });
    }
  }
  res.setHeader('Cache-Control','no-store');
  return res.status(200).json({ ok:checks.some(x=>x.ok), version:'1.0.4', checks });
};

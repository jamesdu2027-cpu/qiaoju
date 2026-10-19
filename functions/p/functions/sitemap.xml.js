
she hu <hutou12345@gmail.com>
上午3:41 (0 分鐘前)
寄給 我

const SB = 'https://gkqmxdmywcfpttrbgfig.supabase.co';
const KEY = 'sb_publishable_1NGnx5BbQkV3dCmQZLcPJg_eI4zSNyF';

export async function onRequest() {
  let rows = [];
  try {
    const r = await fetch(`${SB}/rest/v1/posts?status=eq.public&select=id,created_at,updated_at&order=created_at.desc&limit=5000`, { headers: { apikey: KEY } });
    if (r.ok) rows = await r.json();
  } catch (e) {}
  const urls = ['<url><loc>https://tiannanhaibei.com/</loc></url>'].concat(rows.map(p => {
    const d = (p.updated_at || p.created_at || '').slice(0, 10);
    return `<url><loc>https://tiannanhaibei.com/p/${p.id}</loc>${d ? `<lastmod>${d}</lastmod>` : ''}</url>`;
  }));
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
}

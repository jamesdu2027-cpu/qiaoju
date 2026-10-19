const SB = 'https://gkqmxdmywcfpttrbgfig.supabase.co';
const KEY = 'sb_publishable_1NGnx5BbQkV3dCmQZLcPJg_eI4zSNyF';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function onRequest({ request, params, env }) {
  const id = parseInt(params.id, 10);
  const shell = await env.ASSETS.fetch(new URL('/', request.url));
  let post = null;
  if (id > 0) {
    try {
      const r = await fetch(`${SB}/rest/v1/posts?id=eq.${id}&status=eq.public&select=id,title,body,category,author_name,created_at&limit=1`, { headers: { apikey: KEY } });
      if (r.ok) post = (await r.json())[0] || null;
    } catch (e) {}
  }
  const H = { 'Content-Type': 'text/html; charset=utf-8' };
  if (!post) return new Response(shell.body, { status: 404, headers: H });

  const url = 'https://tiannanhaibei.com/p/' + post.id;
  const desc = esc(String(post.body || '').replace(/\s+/g, ' ').slice(0, 150));
  const title = esc(post.title) + ' - 天南海北';
  const article = `<article><h1>${esc(post.title)}</h1><p>${esc(post.category)} · ${esc(post.author_name)} · ${esc((post.created_at || '').slice(0, 10))}</p><div style="white-space:pre-wrap">${esc(post.body)}</div></article>`;
  const meta = `<link rel="canonical" href="${url}"><meta name="description" content="${desc}"><meta property="og:title" content="${title}"><meta property="og:description" content="${desc}"><meta property="og:url" content="${url}"><meta property="og:type" content="article">`;

  return new HTMLRewriter()
    .on('title', { element(e) { e.setInnerContent(post.title + ' - 天南海北'); } })
    .on('head', { element(e) { e.prepend('<base href="/">', { html: true }); e.append(meta, { html: true }); } })
    .on('#app', { element(e) { e.setInnerContent(article, { html: true }); } })
    .transform(new Response(shell.body, { headers: { ...H, 'Cache-Control': 'public, max-age=300' } }));
}

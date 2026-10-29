export async function onRequest({ request }) {
  const url = new URL(request.url);
  const id = (url.searchParams.get('id') || '').trim();
  const creator = url.searchParams.get('kreator') || '';
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeId) return Response.redirect(new URL('/', url.origin), 302);

  const esc = (v='') => String(v).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
  const field = (fields, key) => {
    const x = fields?.[key];
    if (!x) return '';
    return x.stringValue ?? (x.integerValue != null ? x.integerValue : '');
  };

  let title = 'Karya KomiNovel';
  let teaser = 'Baca komik dan novel online gratis di KomiNovel.';
  let cover = 'https://i.ibb.co.com/SDTthJ7m/Gemini-Generated-Image-fhupt4fhupt4fhup.jpg';
  try {
    const endpoint = `https://firestore.googleapis.com/v1/projects/manzcodewebsite/databases/(default)/documents/works/${encodeURIComponent(safeId)}?key=AIzaSyDmAEREMEbxAFFBXGzwC25C6_Fty_3x7h0`;
    const res = await fetch(endpoint, { headers: { accept: 'application/json' } });
    if (res.ok) {
      const doc = await res.json();
      const f = doc.fields || {};
      title = field(f, 'title') || title;
      teaser = field(f, 'teaser') || field(f, 'description') || teaser;
      cover = field(f, 'coverURL') || cover;
    }
  } catch (_) {}

  const reader = new URL(`/reader/${encodeURIComponent(safeId)}`, url.origin);
  if (creator) reader.searchParams.set('kreator', creator);
  const pageTitle = `${title} | KomiNovel`;
  const desc = String(teaser).slice(0, 250);
  const html = `<!doctype html><html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(pageTitle)}</title><meta name="description" content="${esc(desc)}">
<meta property="og:site_name" content="KomiNovel"><meta property="og:type" content="article">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url.href)}"><meta property="og:image" content="${esc(cover)}">
<meta property="og:image:alt" content="Sampul ${esc(title)}"><meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(cover)}"><meta http-equiv="refresh" content="0;url=${esc(reader.href)}">
<script>location.replace(${JSON.stringify(reader.href)});</script></head>
<body><p>Membuka <a href="${esc(reader.href)}">${esc(title)}</a> di KomiNovel…</p></body></html>`;
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=60, s-maxage=300',
      'x-content-type-options': 'nosniff'
    }
  });
}

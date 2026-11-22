// Tropa Club docs: static site builder. No dependencies. `node build.mjs` writes ./public.
// Pages live in src/pages/*.html as fragments (first line: <!--meta {...}-->). The shell (header, nav,
// TOC, prev/next, footer) is added here so every page stays consistent.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'public');
const BRAND = path.join(ROOT, '..', '..', 'brand');
const SITE = 'https://docs.tropaclub.xyz';
const MAIN_SITE = 'https://tropaclub.xyz';
const X_URL = 'https://x.com/tropaclubxyz';
// One set of rule values, shared with the web copy (web/lib/site.ts reads the same file).
const RULES = JSON.parse(fs.readFileSync(path.join(ROOT, '..', 'web', 'lib', 'rules.json'), 'utf8'));
// {{playUsd}}, nested keys such as {{caps.played}}, and a fixed number of decimals: {{caps.played:2}} -> 1.00.
// An unknown key fails the build, so a renamed rule cannot slip through as a literal placeholder.
const fillRules = (t) =>
  t.replace(/\{\{([\w.]+)(?::(\d))?\}\}/g, (m, k, dp) => {
    const v = k.split('.').reduce((o, p) => (o != null && typeof o === 'object' && p in o ? o[p] : undefined), RULES);
    if (v === undefined || (typeof v === 'object' && v !== null)) throw new Error(`rules.json has no value for ${m}`);
    return dp != null && typeof v === 'number' ? v.toFixed(Number(dp)) : String(v);
  });

const NAV = [
  { group: 'Get started', items: ['index'] },
  { group: 'Data', items: ['the-ground', 'data-feed'] },
  { group: 'Product', items: ['buying-and-safety', 'scoring-and-seasons'] },
  { group: 'Evidence and partners', items: ['retention-evidence', 'partners'] },
  { group: 'Policy and history', items: ['compliance', 'changelog'] },
];
const ORDER = NAV.flatMap((g) => g.items);

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', nbsp: ' ', middot: '·', ndash: '–', mdash: '—', times: '×', minus: '−' };
const stripTags = (s) => s.replace(/<[^>]+>/g, '').replace(/&([a-z]+);/g, (m, n) => ENT[n] ?? m);
const slugify = (s) =>
  stripTags(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/* ------------------------------------------------------------ brand svgs */
function inlineSvg(file, cls) {
  let svg = fs.readFileSync(path.join(BRAND, file), 'utf8');
  svg = svg.replace(/<title>[\s\S]*?<\/title>/, '');
  svg = svg.replace(/ width="\d+" height="\d+"/, '').replace(/ role="img"/, ' aria-hidden="true" focusable="false"');
  svg = svg.replace(/fill="#121037"/g, 'fill="currentColor"');
  return svg.replace('<svg ', `<svg class="${cls}" `);
}
const LOCKUP = inlineSvg('logo-lockup.svg', 'logo-lockup');
const MARK = inlineSvg('logo-mark.svg', 'logo-mark');
const LOCKUP_FOOT = inlineSvg('logo-lockup.svg', 'logo-lockup-foot');

/* ------------------------------------------------------------ highlighting */
const KW = {
  ts: 'export|interface|type|const|let|import|from|await|async|function|return|null|boolean|number|string|true|false|undefined|new|for|of|if',
  json: 'true|false|null',
  bash: 'curl|jq|echo',
  text: '(?!)',
};
function highlight(code, lang) {
  const kw = KW[lang] ?? KW.text;
  const comment = lang === 'bash' ? '#.*$' : lang === 'ts' ? '\/\/.*$' : '(?!)';
  const re = new RegExp(
    `(${comment})|("(?:[^"\\\\\\n]|\\\\.)*"(?=\\s*:))|("(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\\\n]|\\\\.)*'|\`(?:[^\`\\\\]|\\\\.)*\`)|\\b(${kw})\\b|(-?\\b\\d[\\d_,.]*\\b)`,
    'gm',
  );
  let out = '';
  let last = 0;
  for (const m of code.matchAll(re)) {
    out += esc(code.slice(last, m.index));
    const cls = m[1] ? 'c' : m[2] ? 'p' : m[3] ? 's' : m[4] ? 'k' : 'n';
    out += `<span class="tk-${cls}">${esc(m[0])}</span>`;
    last = m.index + m[0].length;
  }
  return out + esc(code.slice(last));
}

/* ------------------------------------------------------------ page processing */
function loadPages() {
  const pages = {};
  for (const f of fs.readdirSync(path.join(SRC, 'pages'))) {
    if (!f.endsWith('.html')) continue;
    let raw = fs.readFileSync(path.join(SRC, 'pages', f), 'utf8').replace(/\r\n/g, '\n');
    const m = raw.match(/^<!--meta (\{[\s\S]*?\})-->\n?/);
    if (!m) throw new Error(`${f}: missing meta line`);
    const meta = JSON.parse(m[1]);
    raw = fillRules(raw.slice(m[0].length));
    const lede = (raw.match(/<p class="lede">([\s\S]*?)<\/p>/) || [])[1] || '';
    raw = raw.replace(/<p class="lede">[\s\S]*?<\/p>\n?/, '');
    pages[meta.slug] = { ...meta, body: raw, lede };
  }
  return pages;
}

function processBody(body) {
  const pres = [];
  body = body.replace(/<pre data-lang="(\w+)"(?: data-title="([^"]*)")?>\n?([\s\S]*?)\n?<\/pre>/g, (_, lang, title, code) => {
    const html = `<div class="pre-wrap">${title ? `<div class="pre-title">${esc(title)}</div>` : ''}<pre tabindex="0"><code>${highlight(code, lang)}</code></pre></div>`;
    pres.push(html);
    return `\u0000PRE${pres.length - 1}\u0000`;
  });
  body = body.replace(/<callout(?: kind="(\w+)")?(?: title="([^"]*)")?>([\s\S]*?)<\/callout>/g, (_, kind = 'note', title = '', inner) => {
    return `<div class="callout ${kind}" role="note">${title ? `<p class="callout-title">${title}</p>` : ''}${inner}</div>`;
  });
  const toc = [];
  const used = new Set();
  body = body.replace(/<(h[23])(?: id="([^"]+)")?>([\s\S]*?)<\/\1>/g, (_, tag, id, inner) => {
    let slug = id || slugify(inner);
    let n = 2;
    while (used.has(slug)) slug = `${id || slugify(inner)}-${n++}`;
    used.add(slug);
    toc.push({ level: tag === 'h2' ? 2 : 3, id: slug, text: stripTags(inner) });
    return `<${tag} id="${slug}">${inner}<a class="anchor" href="#${slug}" aria-label="Link to ${esc(stripTags(inner))}">#</a></${tag}>`;
  });
  body = body.replace(/<table/g, '<div class="table-wrap" tabindex="0" role="region" aria-label="Table, scrolls sideways on small screens"><table').replace(/<\/table>/g, '</table></div>');
  body = body.replace(/\u0000PRE(\d+)\u0000/g, (_, i) => pres[+i]);
  return { html: body, toc };
}

/* ------------------------------------------------------------ shell */
const ICON = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  menu: '<svg class="i-menu" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  close: '<svg class="i-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  moon: '<svg class="i-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z"/></svg>',
  sun: '<svg class="i-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
};

function searchBox(id) {
  return `<div class="search" id="${id}" role="search"><label class="search-field"><span class="sr-only" style="position:absolute;left:-9999px">Search the docs</span>${ICON.search}<input type="search" placeholder="Search the docs" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="false" aria-controls="${id}-list" aria-autocomplete="list"><kbd aria-hidden="true">/</kbd></label><ul class="search-results" id="${id}-list" role="listbox" aria-label="Search results" hidden></ul></div>`;
}

function navHtml(pages, current) {
  const groups = NAV.map(
    (g) =>
      `<div class="nav-group"><h2>${esc(g.group)}</h2><ul>${g.items
        .map((s) => `<li><a href="${href(s)}"${s === current ? ' aria-current="page"' : ''}>${esc(pages[s].nav)}</a></li>`)
        .join('')}</ul></div>`,
  ).join('');
  const extra = `<div class="nav-extra"><a href="${MAIN_SITE}">tropaclub.xyz</a><a href="${X_URL}" rel="noopener">@tropaclubxyz on X</a><a href="https://storage.googleapis.com/tropaclub-data/public/index.json" rel="noopener">index.json (live feed)</a></div>`;
  return groups + extra;
}

const href = (slug) => (slug === 'index' ? 'index.html' : `${slug}.html`);
const canon = (slug) => (slug === 'index' ? `${SITE}/` : `${SITE}/${slug}`);

function shell(pages, p, content, toc) {
  const i = ORDER.indexOf(p.slug);
  const prev = i > 0 ? pages[ORDER[i - 1]] : null;
  const next = i >= 0 && i < ORDER.length - 1 ? pages[ORDER[i + 1]] : null;
  const title = p.slug === 'index' ? 'Tropa Club Docs' : `${p.title} · Tropa Club Docs`;
  const tocList = toc
    .map((t) => `<li class="${t.level === 3 ? 'sub' : ''}"><a href="#${t.id}">${esc(t.text)}</a></li>`)
    .join('');
  const tocInline = toc.length ? `<nav class="toc-inline" aria-label="On this page"><h2>On this page</h2><ol>${tocList}</ol></nav>` : '';
  const tocSide = toc.length ? `<aside class="toc-side" aria-label="On this page"><h2>On this page</h2><ol>${tocList}</ol></aside>` : '';
  const pager = `<nav class="pager" aria-label="Previous and next page">${
    prev ? `<a class="prev" href="${href(prev.slug)}" rel="prev"><small>Previous</small><strong>${esc(prev.nav)}</strong></a>` : '<span></span>'
  }${next ? `<a class="next" href="${href(next.slug)}" rel="next"><small>Next</small><strong>${esc(next.nav)}</strong></a>` : '<span></span>'}</nav>`;
  const ogImg = `${SITE}/assets/og.png`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(p.description)}">
<meta name="theme-color" content="#121037">
<link rel="canonical" href="${canon(p.slug)}">
<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">
<link rel="icon" href="assets/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="assets/apple-touch-icon.png">
<meta property="og:site_name" content="Tropa Club Docs">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(p.description)}">
<meta property="og:url" content="${canon(p.slug)}">
<meta property="og:image" content="${ogImg}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Tropa Club Docs">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@tropaclubxyz">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(p.description)}">
<meta name="twitter:image" content="${ogImg}">
<script>try{var t=localStorage.getItem('tropa-docs-theme');if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t)}catch(e){}</script>
<link rel="preload" href="assets/fonts/bsc-700.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="assets/style.css">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <div class="site-header-in">
    <button class="icon-btn menu-btn" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="sidebar">${ICON.menu}${ICON.close}</button>
    <a class="brand" href="index.html" aria-label="Tropa Club Docs, home">${LOCKUP}${MARK}<span class="brand-tag">Docs</span></a>
    <div class="header-spacer"></div>
    ${searchBox('hs')}
    <button class="icon-btn theme-btn" type="button" aria-label="Switch theme">${ICON.moon}${ICON.sun}</button>
  </div>
</header>
<div class="layout">
  <nav class="sidebar" id="sidebar" aria-label="Documentation">
    ${searchBox('ms')}
    ${navHtml(pages, p.slug)}
  </nav>
  <main class="doc" id="main">
    <article class="article">
      <h1>${esc(p.title)}</h1>
      <p class="lede">${p.lede}</p>
      <p class="page-meta">Updated ${esc(p.updated || 'Nov 22 2026')}</p>
      ${tocInline}
      ${content}
      ${pager}
    </article>
    ${tocSide}
  </main>
</div>
<footer class="site-footer">
  <div class="footer-in">
    <div class="footer-brand">
      ${LOCKUP_FOOT}
      <p>Tropa Club shows who really holds each Coinbase stock token on Base, and helps your group chat each buy about $10 a week from your own wallets. It never holds your money.</p>
    </div>
    <div class="footer-cols">
      <div><h2>Tropa Club</h2><ul><li><a href="${MAIN_SITE}">tropaclub.xyz</a></li><li><a href="${MAIN_SITE}/attendance">Stock rankings</a></li><li><a href="${X_URL}" rel="noopener">@tropaclubxyz on X</a></li></ul></div>
      <div><h2>Docs</h2><ul><li><a href="index.html">Overview</a></li><li><a href="the-ground.html">Grounds and real holders</a></li><li><a href="data-feed.html">Public data feed</a></li></ul></div>
      <div><h2>Product</h2><ul><li><a href="buying-and-safety.html">Buying and safety</a></li><li><a href="scoring-and-seasons.html">Scoring and seasons</a></li><li><a href="compliance.html">Compliance and limits</a></li></ul></div>
      <div><h2>Work with us</h2><ul><li><a href="partners.html">For partners</a></li><li><a href="retention-evidence.html">Retention evidence</a></li><li><a href="${X_URL}" rel="noopener">DM @tropaclubxyz</a></li></ul></div>
    </div>
    <div class="footer-fine">
      <p>Not investment advice. Stock tokens track the share price. They are not shares, carry no vote and give no claim on the company. Past performance does not predict future results. A ground such as the &ldquo;NVIDIA ground&rdquo; is a drawing of a token&rsquo;s holders. Tropa Club is not affiliated with or endorsed by the companies.</p>
      <p>${fillRules('{{regionLine}}')} &copy; 2026 Tropa Club.</p>
    </div>
  </div>
</footer>
<script src="assets/search-index.js"></script>
<script src="assets/app.js"></script>
</body>
</html>
`;
}

/* ------------------------------------------------------------ run */
function build() {
  const pages = loadPages();
  for (const s of ORDER) if (!pages[s]) throw new Error(`page ${s} missing`);
  fs.mkdirSync(path.join(OUT, 'assets'), { recursive: true });

  const searchIndex = [];
  for (const s of ORDER) {
    const p = pages[s];
    const { html, toc } = processBody(p.body);
    fs.writeFileSync(path.join(OUT, href(s)), shell(pages, p, html, toc));
    searchIndex.push({ t: p.nav, p: p.description, u: href(s), h: false });
    for (const t of toc) searchIndex.push({ t: t.text, p: p.nav, u: `${href(s)}#${t.id}`, h: true });
  }
  fs.writeFileSync(path.join(OUT, 'assets', 'search-index.js'), `window.DOCS_INDEX=${JSON.stringify(searchIndex)};\n`);

  for (const f of ['style.css', 'app.js', 'og.png', 'favicon-32.png', 'apple-touch-icon.png']) fs.copyFileSync(path.join(SRC, 'assets', f), path.join(OUT, 'assets', f));
  fs.cpSync(path.join(SRC, 'assets', 'fonts'), path.join(OUT, 'assets', 'fonts'), { recursive: true });
  // favicon: the brand mark on Marigold (same as the web app's icon)
  fs.copyFileSync(path.join(ROOT, '..', 'web', 'app', 'icon.svg'), path.join(OUT, 'assets', 'favicon.svg'));
  fs.copyFileSync(path.join(BRAND, 'logo-lockup.svg'), path.join(OUT, 'assets', 'tropa-club-lockup.svg'));

  // 404
  const nf = {
    slug: '404',
    nav: 'Not found',
    title: 'Page not found',
    description: 'This page does not exist in the Tropa Club docs.',
    lede: 'The page you asked for is not here. Try the search, or start from the overview.',
    updated: 'Nov 22 2026',
    body: '<p><a href="index.html">Go to the overview</a>, or pick a page from the menu.</p>',
  };
  const nfp = { ...pages, '404': nf };
  fs.writeFileSync(path.join(OUT, '404.html'), shell(nfp, nf, processBody(nf.body).html, []).replace('rel="canonical" href="https://docs.tropaclub.xyz/404"', 'rel="canonical" href="https://docs.tropaclub.xyz/"').replace('</head>', '<meta name="robots" content="noindex">\n</head>'));

  fs.writeFileSync(
    path.join(OUT, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${ORDER.map((s) => `  <url><loc>${canon(s)}</loc></url>`).join('\n')}\n</urlset>\n`,
  );
  fs.writeFileSync(path.join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
  console.log(`built ${ORDER.length} pages + 404 -> ${OUT}`);
}
build();

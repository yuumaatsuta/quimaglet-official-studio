// quimaglet のサイトの中身（文章・お知らせ・グッズ）を出し入れするバックエンド（Cloudflare Workers）。
// 同じコードを 2 つの Worker として動かす（wrangler.toml）。
//   public（quimaglet-api）  … サイトが読む。GET /api/content（公開中のお知らせだけ）、GET /images/…（アップロードした画像）
//   admin（quimaglet-admin） … 管理画面（admin/ の静的ファイル）と、書き換えの API。Worker ごと Cloudflare Access で守る。
//     Access を通ってきた人だけが使える（Cf-Access-Jwt-Assertion を確かめる）
//
// 中身は D1 の content 表に JSON 1 つで持つ（版番号つき。保存のたびに revisions に版を残す）。
// 画像も D1 の images 表に持つ（管理画面で長い辺 1600px までの WebP に縮めてから送るので、1 枚数百 KB）。
// 形は public/content.json と同じ { pages: { about, works, goods, contact }, news: [...] }。
// お知らせ 1 件：{ id, date, title, body, image, status: 'published' | 'draft', publishAt: ISO 文字列 か '' }

const MAX_DOC = 1_000_000; // 中身の JSON の上限（バイト）
const MAX_IMAGE = 1_900_000; // D1 の 1 行の上限（2MB）より少し小さく
const KEEP_REVISIONS = 300;
const IMAGE_TYPES = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif' };

export default {
  async fetch(request, env) {
    try {
      return roleOf(request, env) === 'admin' ? await admin(request, env) : await publicApi(request, env);
    } catch (err) {
      console.error(err);
      return json({ error: 'server_error' }, 500);
    }
  },
};

// 手元で動かすとき（ROLE=dev）は 1 つの Worker で両方を受ける（サイトが読む所だけ公開側）
function roleOf(request, env) {
  if (env.ROLE !== 'dev') return env.ROLE;
  const path = new URL(request.url).pathname;
  return path === '/api/content' || path.startsWith('/images/') ? 'public' : 'admin';
}

// ---------- サイトが読む ----------

async function publicApi(request, env) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
  if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'method_not_allowed' }, 405, cors());

  if (url.pathname === '/api/content') {
    const row = await env.DB.prepare('SELECT data, version FROM content WHERE id = 1').first();
    if (!row) return json({ error: 'empty' }, 404, cors());
    const doc = publicView(JSON.parse(row.data));
    return json(doc, 200, { ...cors(), 'Cache-Control': 'public, max-age=30' });
  }

  if (url.pathname.startsWith('/images/')) {
    const key = decodeURIComponent(url.pathname.slice('/images/'.length));
    if (!/^[\w\-/]+\.(webp|jpg|png|gif)$/.test(key)) return json({ error: 'not_found' }, 404, cors());
    const obj = await env.DB.prepare('SELECT type, data FROM images WHERE key = ?').bind(key).first();
    if (!obj) return json({ error: 'not_found' }, 404, cors());
    const bytes = obj.data instanceof ArrayBuffer ? new Uint8Array(obj.data) : Uint8Array.from(obj.data);
    return new Response(request.method === 'HEAD' ? null : bytes, {
      headers: {
        ...cors(),
        'Content-Type': obj.type,
        'Cache-Control': 'public, max-age=31536000, immutable', // 画像の名前は毎回新しいので、ずっと覚えてよい
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  return json({ error: 'not_found' }, 404, cors());
}

// 公開してよいものだけ：下書きと、公開日時がまだ来ていないお知らせを外し、内部の項目を落とす
export function publicView(doc, now = Date.now()) {
  const news = (doc.news ?? [])
    .filter((n) => n.status !== 'draft' && (!n.publishAt || Date.parse(n.publishAt) <= now))
    .map(({ date = '', title = '', body = '', image = '' }) => ({ date, title, body, image }));
  return { pages: doc.pages ?? {}, news };
}

// ---------- 管理画面 ----------

async function admin(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

  // 設定用：Access を通ってきたときの JWT から、AUD とチームのドメイン（iss）を読んで見せる（署名は確かめない。
  // どちらも秘密の値ではなく、これで中身を読み書きはできない）。ACCESS_AUD を設定する前に、ダッシュボードで値を探さずに済むように
  if (url.pathname === '/api/admin/access-info') {
    const token = request.headers.get('Cf-Access-Jwt-Assertion');
    if (!token) return json({ error: 'Cloudflare Access を通っていません（Access の設定が有効か確かめてください）' }, 400);
    try {
      const p = JSON.parse(b64text(token.split('.')[1]));
      return json({ ACCESS_TEAM_DOMAIN: p.iss, ACCESS_AUD: Array.isArray(p.aud) ? p.aud[0] : p.aud, email: p.email });
    } catch {
      return json({ error: 'bad_token' }, 400);
    }
  }

  const user = await accessUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  // 別のサイトから書き換えさせない（同じ所から来た書き換えだけ受ける）
  if (request.method !== 'GET') {
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) return json({ error: 'bad_origin' }, 403);
  }

  const route = `${request.method} ${url.pathname}`;
  if (route === 'GET /api/admin/me') return json({ email: user, site: env.SITE_URL ?? '', publicBase: env.PUBLIC_BASE ?? '' });

  if (route === 'GET /api/admin/content') {
    const row = await env.DB.prepare('SELECT data, version, updated_at, updated_by FROM content WHERE id = 1').first();
    if (!row) return json({ doc: { pages: {}, news: [] }, version: 0 });
    return json({ doc: JSON.parse(row.data), version: row.version, updatedAt: row.updated_at, updatedBy: row.updated_by });
  }

  if (route === 'PUT /api/admin/content') {
    if (!(request.headers.get('Content-Type') ?? '').includes('application/json')) return json({ error: 'bad_type' }, 415);
    const text = await request.text();
    if (text.length > MAX_DOC) return json({ error: 'too_large' }, 413);
    let input;
    try {
      input = JSON.parse(text);
    } catch {
      return json({ error: 'bad_json' }, 400);
    }
    const doc = cleanDoc(input.doc);
    if (!doc) return json({ error: 'bad_doc' }, 400);
    const base = Number(input.baseVersion ?? 0);
    const now = new Date().toISOString();
    const cur = await env.DB.prepare('SELECT data, version FROM content WHERE id = 1').first();
    // ほかの人が先に保存していたら上書きしない
    if ((cur?.version ?? 0) !== base) return json({ error: 'conflict', version: cur?.version ?? 0 }, 409);
    const next = base + 1;
    const data = JSON.stringify(doc);
    const stmts = [];
    if (cur) {
      stmts.push(
        env.DB.prepare('UPDATE content SET data = ?, version = ?, updated_at = ?, updated_by = ? WHERE id = 1 AND version = ?').bind(
          data,
          next,
          now,
          user,
          base,
        ),
      );
    } else {
      stmts.push(env.DB.prepare('INSERT INTO content (id, data, version, updated_at, updated_by) VALUES (1, ?, ?, ?, ?)').bind(data, next, now, user));
    }
    stmts.push(env.DB.prepare('INSERT INTO revisions (version, data, at, by) VALUES (?, ?, ?, ?)').bind(next, data, now, user));
    stmts.push(env.DB.prepare('DELETE FROM revisions WHERE id NOT IN (SELECT id FROM revisions ORDER BY id DESC LIMIT ?)').bind(KEEP_REVISIONS));
    const [res] = await env.DB.batch(stmts);
    if (cur && !res.meta.changes) return json({ error: 'conflict' }, 409);
    return json({ ok: true, version: next, updatedAt: now });
  }

  if (route === 'GET /api/admin/revisions') {
    const { results } = await env.DB.prepare('SELECT id, version, at, by FROM revisions ORDER BY id DESC LIMIT 100').all();
    return json({ revisions: results });
  }
  const rev = url.pathname.match(/^\/api\/admin\/revisions\/(\d+)$/);
  if (request.method === 'GET' && rev) {
    const row = await env.DB.prepare('SELECT id, version, data, at, by FROM revisions WHERE id = ?').bind(Number(rev[1])).first();
    if (!row) return json({ error: 'not_found' }, 404);
    return json({ ...row, data: JSON.parse(row.data) });
  }

  if (route === 'POST /api/admin/images') {
    const type = (request.headers.get('Content-Type') ?? '').split(';')[0].trim();
    const ext = IMAGE_TYPES[type];
    if (!ext) return json({ error: 'bad_type' }, 415);
    const buf = await request.arrayBuffer();
    if (!buf.byteLength || buf.byteLength > MAX_IMAGE) return json({ error: 'too_large' }, 413);
    if (sniff(new Uint8Array(buf, 0, Math.min(16, buf.byteLength))) !== ext) return json({ error: 'bad_image' }, 415);
    const d = new Date();
    const key = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}.${ext}`;
    await env.DB.prepare('INSERT INTO images (key, type, data, at, by) VALUES (?, ?, ?, ?, ?)')
      .bind(key, type, buf, new Date().toISOString(), user)
      .run();
    return json({ url: `${(env.PUBLIC_BASE ?? '').replace(/\/$/, '')}/images/${key}`, key });
  }

  return json({ error: 'not_found' }, 404);
}

// 受け取った中身を、決まった形にそろえる（知らない項目は捨てる）
export function cleanDoc(doc) {
  if (!doc || typeof doc !== 'object') return null;
  const s = (v, max = 20000) => String(v ?? '').slice(0, max);
  const p = doc.pages ?? {};
  const page = (x) => ({ title: s(x?.title, 200), body: s(x?.body) });
  const news = Array.isArray(doc.news) ? doc.news.slice(0, 500) : [];
  const goods = p.goods ?? {};
  return {
    pages: {
      about: { title: s(p.about?.title, 200), main: s(p.about?.main), fill: (Array.isArray(p.about?.fill) ? p.about.fill : []).slice(0, 300).map((w) => s(w, 300)) },
      works: page(p.works),
      goods: {
        ...page(goods),
        items: (Array.isArray(goods.items) ? goods.items : []).slice(0, 200).map((it) => ({
          name: s(it?.name, 200),
          status: s(it?.status, 50),
          price: s(it?.price, 100),
          note: s(it?.note, 4000),
          image: url(it?.image),
          url: url(it?.url),
        })),
      },
      contact: page(p.contact),
    },
    news: news.map((n) => ({
      id: /^[\w-]{1,64}$/.test(n?.id ?? '') ? n.id : crypto.randomUUID(),
      date: s(n?.date, 40),
      title: s(n?.title, 300),
      body: s(n?.body),
      image: url(n?.image),
      status: n?.status === 'draft' ? 'draft' : 'published',
      publishAt: n?.publishAt && !Number.isNaN(Date.parse(n.publishAt)) ? new Date(n.publishAt).toISOString() : '',
    })),
  };
}

// 画像やリンクに使ってよいもの：http(s) の URL か、サイトの中のパス（images/…）
function url(v) {
  const t = String(v ?? '').trim().slice(0, 2000);
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) return t;
  if (/^[\w\-./]+$/.test(t) && !t.includes('..')) return t;
  return '';
}

function sniff(b) {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
  return '';
}

// ---------- Cloudflare Access ----------
// Access を通ってきたリクエストには、署名つきの JWT（Cf-Access-Jwt-Assertion）が付く。
// チームの公開鍵で署名を確かめ、この管理画面用（ACCESS_AUD）で期限内なら、そのメールアドレスを返す

let certs = { at: 0, keys: [] };

async function accessUser(request, env) {
  if (env.DEV_AUTH_BYPASS === '1') return 'dev@localhost'; // 手元で動かすときだけ（.dev.vars）
  const team = (env.ACCESS_TEAM_DOMAIN ?? '').replace(/\/$/, '');
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || !team || !env.ACCESS_AUD) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let header;
  let payload;
  try {
    header = JSON.parse(b64text(parts[0]));
    payload = JSON.parse(b64text(parts[1]));
  } catch {
    return null;
  }
  if (header.alg !== 'RS256') return null;
  let jwk = (await teamKeys(team)).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await teamKeys(team, true)).find((k) => k.kid === header.kid); // 鍵が替わった直後
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64bytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) return null;
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  const now = Date.now() / 1000;
  if (!aud.includes(env.ACCESS_AUD) || payload.iss !== team || !(payload.exp > now) || (payload.nbf && payload.nbf > now + 60)) return null;
  return payload.email || payload.sub || null;
}

async function teamKeys(team, force = false) {
  if (!force && certs.keys.length && Date.now() - certs.at < 3600_000) return certs.keys;
  const res = await fetch(`${team}/cdn-cgi/access/certs`);
  if (!res.ok) return certs.keys;
  const body = await res.json();
  certs = { at: Date.now(), keys: body.keys ?? [] };
  return certs.keys;
}

function b64bytes(s) {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
function b64text(s) {
  return new TextDecoder().decode(b64bytes(s));
}

// ---------- 返事 ----------

function cors() {
  return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Max-Age': '86400' };
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', ...headers },
  });
}

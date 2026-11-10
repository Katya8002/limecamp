/* Табір Лайм — бекенд на Cloudflare Pages (режим _worker.js).
   Прив'язки: DB (D1), PHOTOS (KV). Секрети: ADMIN_PASSWORD, SESSION_SECRET.
   Усе безкоштовне в межах free-плану Cloudflare, без картки. */

const enc = new TextEncoder();

/* ---------- відповіді ---------- */
const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extra,
    },
  });
const fail = (status, message) => json({ error: message }, status);

/* ---------- крипто-помічники ---------- */
function b64url(buf) {
  let s = "";
  new Uint8Array(buf).forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function hmac(secret, data) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");
const randomId = () => hex(crypto.getRandomValues(new Uint8Array(8)));

/* ---------- сесія адміна (підписана кукі) ---------- */
const COOKIE = "lime_admin";
const SESSION_SECONDS = 12 * 3600;

async function makeToken(env) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const sig = b64url(await hmac(env.SESSION_SECRET, "admin." + exp));
  return exp + "." + sig;
}
async function isAdmin(request, env) {
  if (!env.SESSION_SECRET) return false;
  const m = /(?:^|;\s*)lime_admin=([0-9]+)\.([A-Za-z0-9_-]+)/.exec(request.headers.get("Cookie") || "");
  if (!m) return false;
  const exp = Number(m[1]);
  if (!(exp > Date.now() / 1000)) return false;
  const good = enc.encode(b64url(await hmac(env.SESSION_SECRET, "admin." + exp)));
  return safeEqual(good, enc.encode(m[2]));
}
function cookieHeader(value, maxAge, secure) {
  return `${COOKIE}=${value}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${maxAge}` + (secure ? "; Secure" : "");
}

/* ---------- обмеження частоти (в D1) ---------- */
async function clientKey(request, env, prefix) {
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  return prefix + ":" + hex((await hmac(env.SESSION_SECRET || "dev", ip)).slice(0, 8));
}
async function hit(env, key, limit, windowSec) {
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare("SELECT n, reset FROM rate WHERE k = ?").bind(key).first();
  if (!row || row.reset <= now) {
    await env.DB.prepare("INSERT OR REPLACE INTO rate (k, n, reset) VALUES (?, 1, ?)").bind(key, now + windowSec).run();
    return true;
  }
  if (row.n >= limit) return false;
  await env.DB.prepare("UPDATE rate SET n = n + 1 WHERE k = ?").bind(key).run();
  return true;
}

/* ---------- валідація ---------- */
const clean = (s, max) =>
  String(s == null ? "" : s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, max);

async function readJson(request, max = 20000) {
  const len = Number(request.headers.get("Content-Length") || 0);
  if (len > max) throw new Error("big");
  const text = await request.text();
  if (text.length > max) throw new Error("big");
  try { return JSON.parse(text); } catch (e) { throw new Error("bad"); }
}

/* Тип зображення визначаємо за змістом файлу, а не за тим, що вказав клієнт */
function sniff(u8) {
  if (u8.length > 12 && u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46 &&
      u8[8] === 0x57 && u8[9] === 0x45 && u8[10] === 0x42 && u8[11] === 0x50) return "image/webp";
  if (u8.length > 3 && u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) return "image/jpeg";
  if (u8.length > 8 && u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) return "image/png";
  return null;
}

const CONTACT_RE = /^(@?[A-Za-z0-9_]{4,32}|\+?[\d\s()\-]{7,20})$/;

/* ---------- прайс (один JSON-документ у таблиці settings) ---------- */
const SETTINGS_DDL =
  "CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT NOT NULL, " +
  "updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))";
const PRICE_KINDS = ["lime", "hog", "jungle"];

/* Читаємо збережений прайс; якщо таблиці чи запису ще немає, повертаємо null (сайт покаже вбудований прайс) */
async function loadPrices(env) {
  try {
    const row = await env.DB.prepare("SELECT v FROM settings WHERE k = 'prices'").first();
    return row ? JSON.parse(row.v) : null;
  } catch (e) {
    return null;
  }
}

/* Перевіряємо й чистимо прайс від адмінки: жодних довільних полів, обмежені довжини й кількості */
function normalizePrices(d) {
  if (!d || typeof d !== "object" || Array.isArray(d)) return { error: "Некоректні дані прайсу" };
  const arr = (v) => (Array.isArray(v) ? v : []);
  const shiftsIn = arr(d.shifts), plansIn = arr(d.plans);
  if (shiftsIn.length > 8) return { error: "Не більше 8 змін" };
  if (plansIn.length < 1 || plansIn.length > 4) return { error: "Потрібно від 1 до 4 типів ціни" };

  const shifts = [];
  for (const s of shiftsIn) {
    const name = clean(s && s.name, 40);
    if (!name) return { error: "У кожної зміни має бути назва" };
    shifts.push({
      name,
      theme: clean(s.theme, 60),
      kind: PRICE_KINDS.includes(s.kind) ? s.kind : "",
      dates: clean(s.dates, 40),
      length: clean(s.length, 30),
    });
  }

  const plans = [];
  for (const p of plansIn) {
    const name = clean(p && p.name, 40);
    if (!name) return { error: "У кожного типу ціни має бути назва" };
    const colsIn = arr(p.columns);
    if (colsIn.length < 1 || colsIn.length > 6) return { error: "У кожному типі ціни має бути від 1 до 6 колонок" };
    const columns = colsIn.map((c) => clean(c, 60));
    if (columns.some((c) => !c)) return { error: "Назва колонки не може бути порожньою" };
    const cells = (row) => columns.map((_, j) => clean(arr(row)[j], 30));
    const pricesIn = arr(p.prices);
    const prices = shifts.map((_, i) => cells(pricesIn[i]));
    const extrasIn = arr(p.extras);
    if (extrasIn.length > 6) return { error: "Не більше 6 додаткових рядків" };
    const extras = [];
    for (const e of extrasIn) {
      const en = clean(e && e.name, 60);
      if (!en) return { error: "У кожного додаткового рядка має бути назва" };
      extras.push({ name: en, sub: clean(e.sub, 80), prices: cells(e.prices) });
    }
    plans.push({ name, hint: clean(p.hint, 200), columns, prices, extras });
  }

  const bookUrl = clean(d.bookUrl, 300);
  if (bookUrl && !/^https:\/\/[^\s"'<>]+$/.test(bookUrl)) return { error: "Посилання для бронювання має починатися з https://" };

  return {
    doc: {
      v: 1,
      title: clean(d.title, 100) || "Ціни",
      intro: clean(d.intro, 300),
      currency: clean(d.currency, 10),
      note: clean(d.note, 500),
      bookUrl,
      shifts,
      plans,
    },
  };
}

/* ---------- маршрутизатор ---------- */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not found", { status: 404 });
    }
    try {
      return await route(request, env, url);
    } catch (e) {
      if (e && e.message === "big") return fail(413, "Забагато даних");
      if (e && e.message === "bad") return fail(400, "Некоректний запит");
      console.error(e && e.stack || e);
      return fail(500, "Помилка сервера");
    }
  },
};

async function route(request, env, url) {
  const method = request.method;
  const path = url.pathname.replace(/\/+$/, "");
  const secure = url.protocol === "https:";

  /* захист від чужих сайтів: запити, що змінюють дані, лише з нашого домену */
  if (method !== "GET" && method !== "HEAD") {
    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin) return fail(403, "Заборонено");
  }

  /* --- перевірка, що бекенд підключено --- */
  if (path === "/api/ping") {
    return json({ ok: !!env.DB, admin: !!(env.DB && env.PHOTOS && env.ADMIN_PASSWORD && env.SESSION_SECRET) });
  }
  if (!env.DB) return fail(503, "База даних не підключена");

  /* ================= ПУБЛІЧНЕ ================= */

  if (path === "/api/leads" && method === "POST") {
    const d = await readJson(request);
    if (d.website) return json({ ok: true }); /* пастка для ботів */
    const name = clean(d.name, 80), contact = clean(d.contact, 80);
    let age = parseInt(d.child_age, 10);
    if (!name || !CONTACT_RE.test(contact)) return fail(400, "Перевірте ім'я та контакт");
    if (!(age >= 3 && age <= 18)) age = null;
    if (!(await hit(env, await clientKey(request, env, "lead"), 5, 3600))) return fail(429, "Забагато спроб, спробуйте пізніше");
    await env.DB.prepare("INSERT INTO leads (name, contact, child_age) VALUES (?, ?, ?)").bind(name, contact, age).run();
    return json({ ok: true }, 201);
  }

  if (path === "/api/reviews" && method === "POST") {
    const d = await readJson(request);
    if (d.website) return json({ ok: true });
    const name = clean(d.name, 60), text = clean(d.text, 1200);
    if (!name || text.length < 10) return fail(400, "Перевірте ім'я та текст відгуку");
    if (!(await hit(env, await clientKey(request, env, "rev"), 3, 3600))) return fail(429, "Забагато спроб, спробуйте пізніше");
    await env.DB.prepare("INSERT INTO reviews (name, text, status) VALUES (?, ?, 'pending')").bind(name, text).run();
    return json({ ok: true }, 201);
  }

  if (path === "/api/reviews" && method === "GET") {
    const r = await env.DB.prepare("SELECT name, text FROM reviews WHERE status = 'approved' ORDER BY created_at ASC, id ASC").all();
    return json(r.results, 200, { "Cache-Control": "public, max-age=60" });
  }

  if (path === "/api/photos" && method === "GET") {
    const year = parseInt(url.searchParams.get("year"), 10);
    if (!(year >= 2020 && year <= 2100)) return fail(400, "Вкажіть рік");
    const r = await env.DB.prepare("SELECT id, year, shift, width, height FROM photos WHERE year = ? ORDER BY created_at ASC, id ASC").bind(year).all();
    return json(r.results, 200, { "Cache-Control": "public, max-age=60" });
  }

  if (path === "/api/prices" && method === "GET") {
    return json(await loadPrices(env), 200, { "Cache-Control": "public, max-age=30" });
  }

  let m = /^\/api\/img\/([a-f0-9]{16}(?:-t)?)$/.exec(path);
  if (m && method === "GET") {
    if (!env.PHOTOS) return fail(503, "Сховище не підключене");
    const { value, metadata } = await env.PHOTOS.getWithMetadata(m[1], { type: "arrayBuffer" });
    if (!value) return fail(404, "Не знайдено");
    return new Response(value, {
      headers: {
        "Content-Type": (metadata && metadata.type) || "image/webp",
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  }

  /* ================= АДМІНКА ================= */

  if (path === "/api/admin/login" && method === "POST") {
    if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) return fail(503, "Адмінку ще не налаштовано (секрети)");
    const key = await clientKey(request, env, "login");
    if (!(await hit(env, key, 8, 900))) return fail(429, "Забагато спроб. Зачекайте 15 хвилин.");
    const d = await readJson(request, 2000);
    const a = await hmac(env.SESSION_SECRET, "pw." + String(d.password || ""));
    const b = await hmac(env.SESSION_SECRET, "pw." + env.ADMIN_PASSWORD);
    if (!safeEqual(a, b)) return fail(401, "Невірний пароль");
    await env.DB.prepare("DELETE FROM rate WHERE k = ?").bind(key).run();
    await env.DB.prepare("DELETE FROM rate WHERE reset < ?").bind(Math.floor(Date.now() / 1000)).run();
    return json({ ok: true }, 200, { "Set-Cookie": cookieHeader(await makeToken(env), SESSION_SECONDS, secure) });
  }

  if (path.startsWith("/api/admin/")) {
    if (!(await isAdmin(request, env))) return fail(401, "Потрібен вхід");
    if (method !== "GET" && request.headers.get("X-Lime-Admin") !== "1") return fail(403, "Заборонено");

    if (path === "/api/admin/me" && method === "GET") return json({ ok: true });
    if (path === "/api/admin/logout" && method === "POST") {
      return json({ ok: true }, 200, { "Set-Cookie": cookieHeader("", 0, secure) });
    }

    /* --- заявки --- */
    if (path === "/api/admin/leads" && method === "GET") {
      const r = await env.DB.prepare("SELECT * FROM leads ORDER BY created_at DESC, id DESC").all();
      return json(r.results);
    }
    m = /^\/api\/admin\/leads\/(\d+)$/.exec(path);
    if (m && method === "PATCH") {
      const d = await readJson(request, 500);
      if (d.status !== "new" && d.status !== "done") return fail(400, "Некоректний статус");
      await env.DB.prepare("UPDATE leads SET status = ? WHERE id = ?").bind(d.status, Number(m[1])).run();
      return json({ ok: true });
    }
    if (m && method === "DELETE") {
      await env.DB.prepare("DELETE FROM leads WHERE id = ?").bind(Number(m[1])).run();
      return json({ ok: true });
    }

    /* --- відгуки --- */
    if (path === "/api/admin/reviews" && method === "GET") {
      const r = await env.DB.prepare("SELECT * FROM reviews ORDER BY created_at DESC, id DESC").all();
      return json(r.results);
    }
    if (path === "/api/admin/reviews" && method === "POST") {
      const d = await readJson(request);
      const name = clean(d.name, 60), text = clean(d.text, 1200);
      if (!name || text.length < 10) return fail(400, "Перевірте ім'я та текст");
      await env.DB.prepare("INSERT INTO reviews (name, text, status) VALUES (?, ?, 'approved')").bind(name, text).run();
      return json({ ok: true }, 201);
    }
    m = /^\/api\/admin\/reviews\/(\d+)$/.exec(path);
    if (m && method === "PATCH") {
      const d = await readJson(request, 500);
      if (!["pending", "approved", "hidden"].includes(d.status)) return fail(400, "Некоректний статус");
      await env.DB.prepare("UPDATE reviews SET status = ? WHERE id = ?").bind(d.status, Number(m[1])).run();
      return json({ ok: true });
    }
    if (m && method === "DELETE") {
      await env.DB.prepare("DELETE FROM reviews WHERE id = ?").bind(Number(m[1])).run();
      return json({ ok: true });
    }

    /* --- прайс --- */
    if (path === "/api/admin/prices" && method === "GET") return json(await loadPrices(env));
    if (path === "/api/admin/prices" && method === "PUT") {
      const r = normalizePrices(await readJson(request, 40000));
      if (r.error) return fail(400, r.error);
      await env.DB.prepare(SETTINGS_DDL).run();
      await env.DB.prepare(
        "INSERT INTO settings (k, v, updated_at) VALUES ('prices', ?, strftime('%Y-%m-%dT%H:%M:%SZ','now')) " +
        "ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at"
      ).bind(JSON.stringify(r.doc)).run();
      return json({ ok: true, doc: r.doc });
    }
    if (path === "/api/admin/prices" && method === "DELETE") {
      try { await env.DB.prepare("DELETE FROM settings WHERE k = 'prices'").run(); } catch (e) { /* таблиці ще немає, нічого видаляти */ }
      return json({ ok: true });
    }

    /* --- фото --- */
    if (path === "/api/admin/photos" && method === "GET") {
      const r = await env.DB.prepare("SELECT id, year, shift, width, height, created_at FROM photos ORDER BY year DESC, shift ASC, created_at ASC").all();
      return json(r.results);
    }
    if (path === "/api/admin/photos" && method === "POST") {
      if (!env.PHOTOS) return fail(503, "Сховище фото не підключене");
      if (Number(request.headers.get("Content-Length") || 0) > 4 * 1024 * 1024) return fail(413, "Файл завеликий");
      const form = await request.formData();
      const year = parseInt(form.get("year"), 10);
      let shift = parseInt(form.get("shift"), 10);
      if (!(year >= 2020 && year <= 2100)) return fail(400, "Вкажіть рік");
      if (!(shift >= 1 && shift <= 4)) shift = null;
      const full = form.get("full"), thumb = form.get("thumb");
      if (!full || !thumb || typeof full === "string" || typeof thumb === "string") return fail(400, "Немає файлів");
      if (full.size > 1.5 * 1024 * 1024 || thumb.size > 500 * 1024) return fail(413, "Файл завеликий");
      const fb = new Uint8Array(await full.arrayBuffer()), tb = new Uint8Array(await thumb.arrayBuffer());
      const ft = sniff(fb), tt = sniff(tb);
      if (!ft || !tt) return fail(400, "Підтримуються лише JPG, PNG та WebP");
      const id = randomId();
      await env.PHOTOS.put(id, fb, { metadata: { type: ft } });
      await env.PHOTOS.put(id + "-t", tb, { metadata: { type: tt } });
      const w = Math.min(Math.max(parseInt(form.get("width"), 10) || 0, 0), 5000) || null;
      const h = Math.min(Math.max(parseInt(form.get("height"), 10) || 0, 0), 5000) || null;
      await env.DB.prepare("INSERT INTO photos (id, year, shift, width, height) VALUES (?, ?, ?, ?, ?)").bind(id, year, shift, w, h).run();
      return json({ ok: true, id }, 201);
    }
    m = /^\/api\/admin\/photos\/([a-f0-9]{16})$/.exec(path);
    if (m && method === "DELETE") {
      if (env.PHOTOS) { await env.PHOTOS.delete(m[1]); await env.PHOTOS.delete(m[1] + "-t"); }
      await env.DB.prepare("DELETE FROM photos WHERE id = ?").bind(m[1]).run();
      return json({ ok: true });
    }
  }

  return fail(404, "Не знайдено");
}

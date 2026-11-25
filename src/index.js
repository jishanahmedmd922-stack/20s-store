
function json(data, status = 200, extraHeaders = {}) {
  return Response.json(data, {
    status,
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders
    }
  });
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function sign(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  return base64url(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(value)
    )
  );
}

async function isAdmin(request, env) {
  if (!env.ADMIN_PASSWORD) return false;

  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/20s_admin=([^;]+)/);

  if (!match) return false;

  const parts = match[1].split(".");
  if (parts.length !== 2) return false;

  const [payload, signature] = parts;
  const expected = await sign(payload, env.ADMIN_PASSWORD);

  if (signature !== expected) return false;

  try {
    const expiry = Number(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/"))
    );

    return expiry > Date.now();
  } catch {
    return false;
  }
}

async function ensureProductsTable(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      price REAL NOT NULL DEFAULT 0,
      image TEXT DEFAULT '',
      category TEXT DEFAULT 'Shirts',
      collection TEXT DEFAULT 'THE ESSENTIALS',
      description TEXT DEFAULT '',
      sizes TEXT DEFAULT 'S,M,L,XL',
      stock INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": url.origin,
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        }
      });
    }

    if (path === "/api/health") {
      return json({
        success: true,
        message: "20's Store API is running",
        status: "online"
      });
    }

    if (path === "/api/products" && method === "GET") {
      try {
        await ensureProductsTable(env);

        const result = await env.DB.prepare(
          "SELECT * FROM products ORDER BY created_at DESC"
        ).all();

        return json({
          success: true,
          products: result.results || []
        });
      } catch {
        return json({
          success: false,
          message: "Could not load products"
        }, 500);
      }
    }

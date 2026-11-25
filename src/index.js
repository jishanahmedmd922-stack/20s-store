
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

    // Admin login
    if (path === "/api/admin/login" && method === "POST") {
      try {
        if (!env.ADMIN_PASSWORD) {
          return json({
            success: false,
            message: "Admin password is not configured"
          }, 500);
        }

        const data = await request.json();

        if (data.password !== env.ADMIN_PASSWORD) {
          return json({
            success: false,
            message: "Incorrect password"
          }, 401);
        }

        const expiry = Date.now() + 7 * 24 * 60 * 60 * 1000;

        const payload = btoa(String(expiry))
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");

        const signature = await sign(
          payload,
          env.ADMIN_PASSWORD
        );

        return json({
          success: true,
          message: "Login successful"
        }, 200, {
          "Set-Cookie":
            `20s_admin=${payload}.${signature}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800`
        });
      } catch {
        return json({
          success: false,
          message: "Login failed"
        }, 400);
      }
    }

    // Admin logout
    if (path === "/api/admin/logout" && method === "POST") {
      return json({
        success: true,
        message: "Logged out"
      }, 200, {
        "Set-Cookie":
          "20s_admin=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0"
      });
    }

    // Check admin login
    if (path === "/api/admin/me" && method === "GET") {
      const valid = await isAdmin(request, env);

      return json({
        success: valid
      }, valid ? 200 : 401);
    }

    // Admin product management
    if (path.startsWith("/api/admin/products")) {
      if (!(await isAdmin(request, env))) {
        return json({
          success: false,
          message: "Unauthorized"
        }, 401);
      }

      try {
        await ensureProductsTable(env);

        // Product list
        if (path === "/api/admin/products" && method === "GET") {
          const result = await env.DB.prepare(
            "SELECT * FROM products ORDER BY created_at DESC"
          ).all();

          return json({
            success: true,
            products: result.results || []
          });
        }

        // Add product
        if (path === "/api/admin/products" && method === "POST") {
          const data = await request.json();

          if (!data.name || data.price === undefined) {
            return json({
              success: false,
              message: "Product name and price are required"
            }, 400);
          }

          const id = crypto.randomUUID();

          await env.DB.prepare(`
            INSERT INTO products (
              id, name, price, image, category,
              collection, description, sizes, stock
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            id,
            String(data.name),
            Number(data.price),
            String(data.image || ""),
            String(data.category || "Shirts"),
            String(data.collection || "THE ESSENTIALS"),
            String(data.description || ""),
            String(data.sizes || "S,M,L,XL"),
            Number(data.stock || 0)
          ).run();

          return json({
            success: true,
            message: "Product added",
            id
          }, 201);
        }

        // Edit or delete product
        if (path.startsWith("/api/admin/products/")) {
          const id = decodeURIComponent(
            path.substring("/api/admin/products/".length)
          );

          if (!id) {
            return json({
              success: false,
              message: "Product ID required"
            }, 400);
          }

          if (method === "PUT") {
            const data = await request.json();

            await env.DB.prepare(`
              UPDATE products SET
                name = ?, price = ?, image = ?, category = ?,
                collection = ?, description = ?, sizes = ?, stock = ?
              WHERE id = ?
            `).bind(
              String(data.name || ""),
              Number(data.price || 0),
              String(data.image || ""),
              String(data.category || "Shirts"),
              String(data.collection || "THE ESSENTIALS"),
              String(data.description || ""),
              String(data.sizes || "S,M,L,XL"),
              Number(data.stock || 0),
              id
            ).run();

            return json({ success: true, message: "Product updated" });
          }

          if (method === "DELETE") {
            await env.DB.prepare(
              "DELETE FROM products WHERE id = ?"
            ).bind(id).run();

            return json({ success: true, message: "Product deleted" });
          }
        }

        return json({
          success: false,
          message: "Admin route not found"
        }, 404);

      } catch {
        return json({
          success: false,
          message: "Product operation failed"
        }, 500);
      }
    }

    // Existing order system
    if (path === "/api/orders" && method === "POST") {
      try {
        const data = await request.json();

        const required = [
          "id",
          "customer_name",
          "phone",
          "address"
        ];

        for (const field of required) {
          if (!data[field]) {
            return json({
              success: false,
              message: `Missing field: ${field}`
            }, 400);
          }
        }

        await env.DB.prepare(`
          INSERT INTO orders (
            id, customer_name, phone, address,
            total_amount, delivery_charge, weight_kg,
            payment_method, sender_number, transaction_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          String(data.id),
          String(data.customer_name),
          String(data.phone),
          String(data.address),
          Number(data.total_amount || 0),
          Number(data.delivery_charge || 0),
          Number(data.weight_kg || 1),
          data.payment_method || null,
          data.sender_number || null,
          data.transaction_id || null
        ).run();

        return json({
          success: true,
          message: "Order submitted successfully",
          order_id: data.id,
          status: "Pending Payment"
        }, 201);

      } catch {
        return json({
          success: false,
          message: "Could not submit order"
        }, 500);
      }
    }

    if (path.startsWith("/api/")) {
      return json({
        success: false,
        message: "API route not found"
      }, 404);
    }

    return env.ASSETS.fetch(request);
  }
};

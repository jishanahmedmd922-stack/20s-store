
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const headers = {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    if (url.pathname === "/api/health") {
      return Response.json({
        success: true,
        message: "20's Store API is running",
        status: "online"
      }, { headers });
    }

    if (url.pathname === "/api/orders" && request.method === "POST") {
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
            return Response.json({
              success: false,
              message: `Missing field: ${field}`
            }, { status: 400, headers });
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

        return Response.json({
          success: true,
          message: "Order submitted successfully",
          order_id: data.id,
          status: "Pending Payment"
        }, { status: 201, headers });

      } catch (error) {
        return Response.json({
          success: false,
          message: "Could not submit order"
        }, { status: 500, headers });
      }
    }

    if (url.pathname.startsWith("/api/")) {
      return Response.json({
        success: false,
        message: "API route not found"
      }, { status: 404, headers });
    }

    return env.ASSETS.fetch(request);
  }
};



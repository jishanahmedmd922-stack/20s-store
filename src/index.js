
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // API Health Check
    if (url.pathname === "/api/health") {
      return Response.json(
        {
          success: true,
          message: "20's Store API is running",
          status: "online"
        },
        {
          headers: {
            "Cache-Control": "no-store"
          }
        }
      );
    }

    // Unknown API Route
    if (url.pathname.startsWith("/api/")) {
      return Response.json(
        {
          success: false,
          message: "API route not found"
        },
        { status: 404 }
      );
    }

    // Load Website Assets
    return env.ASSETS.fetch(request);
  }
};

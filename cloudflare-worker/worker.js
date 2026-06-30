export default {
  async fetch(request, env, ctx) {
    // 1. Handle CORS Preflight for the browser extension
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*", // Or restrict to chrome-extension://[your-id]
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        }
      });
    }

    const url = new URL(request.url);
    const domain = url.searchParams.get('domain');

    if (!domain) {
      return new Response(JSON.stringify({ error: "Missing domain parameter" }), { 
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }

    // 2. Access the hidden API Key from Cloudflare Environment Variables (Secrets)
    const THREAT_API_KEY = env.THREAT_API_KEY; 
    
    // Example: Forwarding to a real Threat API (like Google Safe Browsing or PhishTank)
    const THREAT_API_URL = `https://api.real-threat-service.com/v1/check?domain=${encodeURIComponent(domain)}`;

    try {
      // 3. Proxy the request
      const apiResponse = await fetch(THREAT_API_URL, {
        headers: {
          "Authorization": `Bearer ${THREAT_API_KEY}`
        }
      });

      if (!apiResponse.ok) {
        throw new Error(`Upstream returned ${apiResponse.status}`);
      }

      const data = await apiResponse.json();
      
      // 4. Return the parsed result securely back to the extension
      return new Response(JSON.stringify({ status: data.isSafe ? "safe" : "unsafe" }), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      });
      
    } catch (err) {
      // Graceful fallback on API failure
      return new Response(JSON.stringify({ error: "Upstream API failure", status: "unknown" }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }
  }
};

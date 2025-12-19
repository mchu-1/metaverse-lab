/**
 * GEMINI LIVE API SECURE PROXY (Cloudflare Worker)
 * 
 * Purpose:
 * Acts as a secure middleware between the client application and Google's Gemini API.
 * This prevents the Gemini API Key from being exposed in the client-side code.
 * 
 * Architecture:
 * 1. WebSocket Proxy: Intercepts WebSocket connections at the root path (wss://<worker>/).
 *    - Validates the request (optional origin check).
 *    - Injects the GEMINI_API_KEY from Cloudflare Secrets.
 *    - Establishes a connection to the Gemini Live API.
 *    - Pipes messages bi-directionally between Client and Gemini.
 * 
 * 2. Vision Proxy: Intercepts POST requests at /vision.
 *    - Accepts JSON payload with { image: "base64...", prompt: "..." }.
 *    - Forwards request to Gemini Flash (Multimodal) REST API with the secure key.
 *    - Returns the text description.
 * 
 * Setup:
 * - Ensure `GEMINI_API_KEY` is set in Cloudflare Secrets (`wrangler secret put GEMINI_API_KEY`).
 * - Deploy using `wrangler deploy`.
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. WebSocket Proxy (for Live API)
    if (request.headers.get("Upgrade") === "websocket") {
      return handleWebSocket(request, env);
    }

    // 2. Vision Proxy (for Multimodal)
    if (url.pathname === "/vision" && request.method === "POST") {
      return handleVision(request, env);
    }
    
    // 3. CORS Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    return new Response("Gemini Secure Proxy Running", { status: 200 });
  }
};

async function handleWebSocket(clientRequest, env) {
  if (!env.GEMINI_API_KEY) {
    return new Response("Missing GEMINI_API_KEY secret", { status: 500 });
  }

  // Connect to Gemini Live API
  const host = "generativelanguage.googleapis.com";
  // Updated model to match client code
  const model = "models/gemini-2.5-flash-native-audio-preview-12-2025"; 
  const targetUrl = `wss://${host}/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${env.GEMINI_API_KEY}`;

  // Create a WebSocket pair for the Client <-> Worker connection
  const { 0: clientWebSocket, 1: serverWebSocket } = new WebSocketPair();

  // Accept the client connection
  clientWebSocket.accept();

  // Connect the Worker to the Gemini API
  try {
      // NOTE: Cloudflare Workers cannot directly 'new WebSocket(url)' to external hosts in every environment 
      // without upgrade headers or using specific behavior, but standard fetch with Upgrade often works or 
      // typically we use a fetch to upgrade.
      // However, for standard Proxying, we usually need to establish the backend socket.
      // Cloudflare's `fetch` can handle WebSocket upgrades.
      
      const upstreamResponse = await fetch(targetUrl, {
          headers: {
              "Upgrade": "websocket"
          }
      });
      
      if (upstreamResponse.status !== 101) {
          clientWebSocket.close(1011, "Failed to connect to upstream Gemini API");
          return new Response("Upstream Error", { status: 502 });
      }

      const upstreamWebSocket = upstreamResponse.webSocket;
      upstreamWebSocket.accept();

      // Pipe Data: Client -> Upstream
      clientWebSocket.addEventListener("message", (event) => {
          upstreamWebSocket.send(event.data);
      });
      
      // Pipe Data: Upstream -> Client
      upstreamWebSocket.addEventListener("message", (event) => {
          clientWebSocket.send(event.data);
      });

      // Handle Close
      clientWebSocket.addEventListener("close", (event) => {
          upstreamWebSocket.close(event.code, event.reason);
      });
      upstreamWebSocket.addEventListener("close", (event) => {
          clientWebSocket.close(event.code, event.reason);
      });
      
      // Handle Errors
      clientWebSocket.addEventListener("error", (e) => console.log("Client WS Error", e));
      upstreamWebSocket.addEventListener("error", (e) => console.log("Upstream WS Error", e));

      return new Response(null, {
          status: 101,
          webSocket: clientWebSocket,
      });

  } catch (e) {
      console.error("Worker Proxy Error:", e);
      return new Response("Internal Proxy Error: " + e.message, { status: 500 });
  }
}

async function handleVision(request, env) {
  if (!env.GEMINI_API_KEY) {
    return new Response(JSON.stringify({ error: "Missing API Key" }), { 
        status: 500,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } 
    });
  }

  try {
      const body = await request.json();
      const { image, prompt } = body; // Expect base64 image (no header) and prompt

      if (!image) {
          throw new Error("No image data provided");
      }

      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${env.GEMINI_API_KEY}`;
      
      const payload = {
        contents: [{
          parts: [
            { text: prompt || "Describe this image." },
            {
              inline_data: {
                mime_type: "image/jpeg",
                data: image
              }
            }
          ]
        }]
      };

      const upstreamRes = await fetch(geminiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
      });

      if (!upstreamRes.ok) {
          const errText = await upstreamRes.text();
          throw new Error(`Gemini API Error: ${upstreamRes.status} ${errText}`);
      }

      const data = await upstreamRes.json();
      let text = "No description.";
      if (data.candidates && data.candidates[0].content && data.candidates[0].content.parts) {
          text = data.candidates[0].content.parts[0].text;
      }

      return new Response(JSON.stringify({ text }), {
          headers: { 
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*" 
          }
      });

  } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { 
          status: 500,
          headers: { 
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*" 
          } 
      });
  }
}

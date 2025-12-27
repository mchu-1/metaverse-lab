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
import { createClient } from '@supabase/supabase-js';

/**
 * GEMINI LIVE API SECURE PROXY (Cloudflare Worker)
 * 
 * Features:
 * - Supabase Authentication (Token Verification)
 * - Role-Based Access (Admin vs User)
 * - 1-Hour Time Limit for Free Users
 * - Rate Limiting (Basic IP based)
 * - Logging
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. Handle Options (CORS)
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    // 2. Authentication Middleware
    // Extract Token from Query Param (WebSocket) or Header (REST)
    let token = url.searchParams.get("auth_token");
    if (!token && request.headers.get("Authorization")) {
        token = request.headers.get("Authorization").replace("Bearer ", "");
    }

    if (!token) {
        return new Response("Unauthorized: No token provided", { status: 401 });
    }

    // Initialize Supabase Admin Client
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
        return new Response("Server Misconfiguration: Missing Supabase Keys", { status: 500 });
    }
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

    // Verify Token
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
        return new Response("Unauthorized: Invalid Token", { status: 401 });
    }

    const clientIp = request.headers.get("CF-Connecting-IP") || "0.0.0.0";
    const email = user.email;
    const adminEmails = (env.ADMIN_EMAILS || "").split(",").map(e => e.trim());
    const isAdmin = adminEmails.includes(email);

    // 3. Access Control (Non-Admins)
    if (!isAdmin) {
        // A. Rate Limiting (Token Bucket via KV)
        if (env.RATE_LIMITS) {
            const ipKey = `rate:${clientIp}`;
            const count = await env.RATE_LIMITS.get(ipKey, { type: "json" }) || 0;
            if (count > 20) { // 20 requests per minute
                 // Log Block
                 ctx.waitUntil(logAccess(supabase, user.id, email, clientIp, "BLOCKED_RATE_LIMIT"));
                 return new Response("Rate Limit Exceeded", { status: 429 });
            }
            await env.RATE_LIMITS.put(ipKey, count + 1, { expirationTtl: 60 });
        }

        // B. 1-Hour Usage Limit
        const { data: usage, error: usageError } = await supabase
            .from('user_usage')
            .select('trial_start_at')
            .eq('user_id', user.id)
            .single();
        
        // Setup initial usage record if missing
        let trialStart = usage?.trial_start_at;
        
        if (!usage && !usageError) {
             // Record didn't exist? (Or single() error) - Insert
             const now = new Date().toISOString();
             await supabase.from('user_usage').insert({ user_id: user.id, trial_start_at: now });
             trialStart = now;
        } else if (!trialStart) {
             // Existed but no start time (unlikely with default logic, but safe to handle)
             const now = new Date().toISOString();
             await supabase.from('user_usage').update({ trial_start_at: now }).eq('user_id', user.id);
             trialStart = now;
        }

        // Check Expiry
        if (trialStart) {
            const startTime = new Date(trialStart).getTime();
            const nowTime = Date.now();
            const oneHour = 60 * 60 * 1000;
            
            if (nowTime - startTime > oneHour) {
                ctx.waitUntil(logAccess(supabase, user.id, email, clientIp, "BLOCKED_TIME_LIMIT"));
                return new Response("Free Trial Expired (1 Hour Limit Reached)", { status: 403 });
            }
        }
    }

    // Log Successful Access (Async)
    ctx.waitUntil(logAccess(supabase, user.id, email, clientIp, url.pathname === "/vision" ? "VISION_REQUEST" : "WS_CONNECT"));


    // 4. Route Handling
    
    // WebSocket Proxy (for Live API)
    if (request.headers.get("Upgrade") === "websocket") {
      return handleWebSocket(request, env, user);
    }

    // Vision Proxy
    if (url.pathname === "/vision" && request.method === "POST") {
      return handleVision(request, env);
    }
    
    return new Response("Gemini Secure Proxy Running. Authenticated as " + email, { status: 200 });
  }
};

async function logAccess(supabase, uid, email, ip, action) {
    try {
        await supabase.from('access_logs').insert({
            user_id: uid,
            email: email,
            ip_address: ip,
            action: action
        });
    } catch (e) {
        console.error("Logging failed:", e);
    }
}

async function handleWebSocket(clientRequest, env, user) {
  if (!env.GEMINI_API_KEY) {
    console.error("Missing GEMINI_API_KEY secret");
    return new Response("Missing GEMINI_API_KEY secret", { status: 500 });
  }

  // Connect to Gemini Live API
  const host = "generativelanguage.googleapis.com";
  const model = "models/gemini-2.5-flash-native-audio-preview-12-2025"; 
  const targetUrl = `https://${host}/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${env.GEMINI_API_KEY}`;
  
  console.log(`[Proxy] New WebSocket Request: ${clientRequest.url}`);

  const { 0: clientWebSocket, 1: serverWebSocket } = new WebSocketPair();
  serverWebSocket.accept();

  try {
      const upstreamResponse = await fetch(targetUrl, {
          headers: { "Upgrade": "websocket" }
      });
      
      if (upstreamResponse.status !== 101) {
          console.error(`[Proxy] Upstream Failed: ${await upstreamResponse.text()}`);
          serverWebSocket.close(1011, "Failed to connect to upstream");
          return new Response("Upstream Error", { status: 502 });
      }

      const upstreamWebSocket = upstreamResponse.webSocket;
      upstreamWebSocket.accept();

      let isFirstMessage = true;

      // Pipe Data: Client (via Server Socket) -> Upstream
      serverWebSocket.addEventListener("message", (event) => {
          if (isFirstMessage) {
              isFirstMessage = false;
              try {
                  const msg = JSON.parse(event.data);
                  if (msg.setup) {
                      console.log("[Proxy] Intercepting Setup Message to inject System Instruction...");
                      if (!msg.setup.systemInstruction) {
                          msg.setup.systemInstruction = { parts: [] };
                      }
                      if (!msg.setup.systemInstruction.parts) {
                          msg.setup.systemInstruction.parts = [];
                      }
                      
                      // Inject Environment Description
                      msg.setup.systemInstruction.parts.push({ text: ENVIRONMENT_PROMPT });
                      
                      upstreamWebSocket.send(JSON.stringify(msg));
                      return;
                  }
              } catch (e) {
                  console.error("[Proxy] Failed to parse first message, sending as is.", e);
              }
          }
          upstreamWebSocket.send(event.data);
      });
      
      // Pipe Data: Upstream -> Client
      upstreamWebSocket.addEventListener("message", (event) => {
          serverWebSocket.send(event.data);
      });

      // Handle Close
      serverWebSocket.addEventListener("close", (event) => upstreamWebSocket.close(event.code, event.reason));
      upstreamWebSocket.addEventListener("close", (event) => serverWebSocket.close(event.code, event.reason));
      
      // Handle Errors
      serverWebSocket.addEventListener("error", (e) => console.error("[Proxy] Client WS Error", e));
      upstreamWebSocket.addEventListener("error", (e) => console.error("[Proxy] Upstream WS Error", e));

      return new Response(null, {
          status: 101,
          webSocket: clientWebSocket,
      });

  } catch (e) {
      console.error("Worker Proxy Error:", e);
      return new Response("Internal Proxy Error: " + e.message, { status: 500 });
  }
}

const ENVIRONMENT_PROMPT = `
# Metaverse Lab Environment Description

## 1. Overview

The **Metaverse Lab** is a prototype "Cloud Lab" designed for the Network State. It represents a shift from legacy, centralized scientific institutions to a decentralized, agile, and automated infrastructure. This facility operates as an "API for Matter," allowing researchers to run experiments via code rather than manual manipulation, aiming to solve the scientific replication crisis through automation and immutable ledgers.

## 2. Visual & Physical Environment

Based on visual analysis of \`nslab-world.png\`:

- **Setting**: A modern, sterile, windowless facility designed for 24/7 "Dark Lab" operation (light-independent).
- **Layout**:
  - **Open Plan**: A rectangular room with a dedicated control station and modular laboratory benching lining the walls.
  - **Ceiling**: Industrial open ceiling with exposed red piping and bright linear LED track lighting, ensuring high visibility for remote monitoring.
  - **Flooring**: Warm wood-tone plank flooring, providing a contrast to the sterile white equipment.
- **Key Zones**:
  - **Control Station**: Located on the left, featuring a high-performance **Custom Workstation** (PC tower with dual monitors) used for controlling the lab API and running MinKNOW.
    - **Automation Core**: Dominating the right bench is the **Opentrons Flex**, a large (approx. 87cm wide), transparent-walled liquid handling robot.
    - **Sequencing & Analysis**: Adjacent to the robot are molecular biology modules (PCR, shakers) and the **PromethION 2 Solo** sequencer (a compact benchtop device).
    - **Sample Storage**: The **Stirling ULT25NEU** (a portable 25L chest freezer) is likely located on a bench or under-counter, distinct from any large upright refrigeration units if present.
  - **Monitoring**: **Ubiquiti G5 Flex** cameras are mounted on the ceiling relative to the benches, providing remote visual verification (the "eyes" of the remote scientist).

## 3. Infrastructure & Equipment Level

The lab is equipped for end-to-end automated molecular biology and sequencing.

### Automation & Compute

- **Robot**: **Opentrons Flex** ($24,000) - The central "hands" of the lab. Features a touchscreen, WiFi, and API access.
  - _Accessories_: Flex Gripper (for transporting labware), 8-Channel & 1-Channel Pipettes (Air displacement).
- **Compute**: **Custom Workstation** ($4,500) - i9 Processor, 64GB RAM, RTX 4090 GPU. Runs the local control stack throughout the facility.

### Integrated Modules (On-Deck/Bench)

- **Sterility**: **HEPA/UV Module** ($14,000) - Sits atop the Opentrons Flex, creating an ISO 5 environment and replacing the need for a large walk-in biosafety cabinet.

* **Incubation/PCR**: **Thermocycler GEN2** ($9,750) - On-deck automated PCR with auto-lid (4-99°C).
* **Culture/Vortex**: **Heater-Shaker GEN1** ($3,750) - 37-95°C mixing up to 3000 rpm.
* **Purification**: **Magnetic Block** ($1,750) - High-strength passive block for DNA/RNA extraction.

### Analysis & Support

- **Sequencing**: **PromethION 2 Solo** ($10,455) - Compact high-throughput Nanopore sequencer (580Gb yield), connects via USB-C to the Host PC.
- **Storage**: **Stirling ULT25NEU** ($7,500) - Portable -86°C chest freezer (25L) with SenseAnywhere IoT monitoring. Small footprint (approx. 27" length), suitable for benchtop or under-bench use.
- **Sterilization**: **Enbio S Autoclave** ($2,499) - Class B flash autoclave (7 min cycle). Modern, streamlined white design, significantly smaller than traditional autoclaves.

## 4. Legal & Regulatory Framework

The facility is fully compliant with Malaysian biosafety and corporate laws, established to legally handle Genetically Modified Organisms (LMOs).

- **Corporate Entity**: Incorporated as a **Sdn Bhd** under the _Companies Act 2016 (SSM)_.
- **Biosafety Registration**:
  - **Form G**: Registered Institutional Biosafety Committee (IBC) with the NBB.
  - **Form E**: Notification for "Contained Use," allowing work with LMOs like **HEK293T**.
  - **Validation**: IBC Assessment Report confirming PC2 specification compliance.
- **Operations**:
  - **Waste**: Registered as a waste generator (Code SW 404) with the DOE (eSWIS).
  - **Safety**: Certificate of Fitness from DOSH/JKKP for the autoclave pressure vessel.

## 5. Philosophical Mandate

This environment is built upon the "Civilizational Shift" towards the Network State.

- **The Problem**: Legacy science is slow, bureaucratic, and suffers from low reproducibility due to human variability ("the hands of the scientist").
- **The Solution**: Dissociation of the scientist from the bench.
  - **Sovereignty via Automation**: Owning the "industrial substrate" allows for functional sovereignty.
  - **Code-Driven**: Replacing manual protocols with **Symbolic Lab Language (SLL)** ensures exact execution and high reproducibility.
  - **Trustless Verification**: Measurements are recorded on a blockchain (DeSci) for immutability.
  - **Regulatory Arbitrage**: Future iterations aim for Special Economic Zones (e.g., Próspera) to enable "permissionless innovation," bypassing traditional regulatory bottlenecks (like the FDA) to accelerate discovery speeds to the limits of physics.
`;

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

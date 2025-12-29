/**
 * GEMINI LIVE API Client
 * Manages Connection using Native WebSocket to avoid SDK Browser Auth issues
 */

export class LiveClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.session = null;
    this.onAudio = null;
    this.onClose = null;
    this.videoInterval = null;
    // Use the latest experimental model for native vision support
    this.model = "models/gemini-2.0-flash-exp";
  }

  async connect(systemInstruction = "") {
    // Check for existing session to resume
    const savedHandle = localStorage.getItem("GEMINI_SESSION_HANDLE");
    if (savedHandle) {
      console.log("Resuming session with handle:", savedHandle);
    }

    // Construct Setup Message
    const setupMessage = {
      setup: {
        model: this.model,
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } },
          },
        },
        systemInstruction: {
          parts: [{ text: systemInstruction }],
        },
        tools: [
          {
            functionDeclarations: [
              {
                name: "look_at",
                description:
                  "Rotates the camera to look at a specific point on the map. (x, y) are normalized coordinates (0.0-1.0) on the equirectangular map.",
                parameters: {
                  type: "OBJECT",
                  properties: {
                    x: {
                      type: "NUMBER",
                      description: "Horizontal position (0.0=left, 1.0=right).",
                    },
                    y: {
                      type: "NUMBER",
                      description: "Vertical position (0.0=top, 1.0=bottom).",
                    },
                  },
                  required: ["x", "y"],
                },
              },
              {
                name: "reset_view",
                description:
                  "Resets the camera view to the default starting position.",
                parameters: { type: "OBJECT", properties: {} },
              },
              {
                name: "move",
                description:
                  "Moves the agent forward or backward by a specific distance in meters.",
                parameters: {
                  type: "OBJECT",
                  properties: {
                    distance: {
                      type: "NUMBER",
                      description: "Distance to move in meters. Positive for forward, negative for backward.",
                    },
                  },
                  required: ["distance"],
                },
              },
            ],
          },
        ],
      },
    };

    // Determine URI: Direct vs Proxy
    const host = "generativelanguage.googleapis.com";
    let uri;
    if (this.apiKey && this.apiKey.startsWith("wss://")) {
      // 1. Secure Proxy URL provided directly as "apiKey" or config
      uri = this.apiKey;
    } else if (this.apiKey && this.apiKey.startsWith("AIza")) {
      // 2. Direct API Key (Legacy/Dev)
      uri = `wss://${host}/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${this.apiKey}`;
    } else if (this.apiKey && this.apiKey.startsWith("http")) {
      // 3. HTTP/HTTPS Proxy (Convert to WSS)
      const urlObj = new URL(this.apiKey);
      urlObj.protocol = urlObj.protocol === "https:" ? "wss:" : "ws:";
      uri = urlObj.toString();
    } else {
      // 4. Ephemeral Token or Fallback
      uri = `wss://${host}/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=${this.apiKey}`;
    }

    // Append Access Token (Supabase) if provided (for Proxy Auth)
    if (this.accessToken && uri.includes('workers.dev')) {
        const separator = uri.includes('?') ? '&' : '?';
        uri = `${uri}${separator}auth_token=${this.accessToken}`;
    }

    console.log(`[LiveClient] Connecting to: ${uri}...`); // Masked for security in logs if needed
    console.log(`[LiveClient] Model: ${this.model}`);

    try {
      this.session = new WebSocket(uri);

      this.session.onopen = (event) => {
        console.log("Connected to Gemini Live API");
        // Send Setup Message
        this.send(setupMessage);
        console.log("Session setup sent.");
        
        // Start Video Streaming
        this.startVideoStreaming();
      };

      this.session.onmessage = async (event) => {
        let data = event.data;
        // Handle Blob if binary
        if (data instanceof Blob) {
          data = await data.text();
        }

        try {
          const message = JSON.parse(data);
          this.handleMessage(message);
        } catch (e) {
          console.error("Error parsing message:", e, data);
        }
      };

      this.session.onclose = (event) => {
        console.log(
          `Session Closed: Code=${event.code} Reason=${event.reason} WasClean=${event.wasClean}`
        );
        this.stopVideoStreaming();
        if (this.onClose) this.onClose();
      };

      this.session.onerror = (error) => {
        console.error("Session Error:", error);
        this.stopVideoStreaming();
      };
    } catch (e) {
      console.error("Failed to connect:", e);
      throw e;
    }
  }

  async handleMessage(message) {
    // 0. Log Transcriptions
    if (message.serverContent?.modelTurn?.parts) {
      const parts = message.serverContent.modelTurn.parts;
      for (const part of parts) {
        if (part.text) {
          console.log("[GEMINI]", part.text);
        }
        if (part.executableCode) {
          console.log("[GEMINI] Executable Code:", part.executableCode);
        }
        if (part.codeExecutionResult) {
          console.log("[GEMINI] Code Result:", part.codeExecutionResult);
        }

        // --- LEGACY TOOL USE HANDLING (Backup) ---
        if (part.functionCall) {
          console.warn(
            "[GEMINI] Received legacy inline functionCall. Preferring top-level toolCall if available."
          );
          await this.handleToolCalls([part.functionCall]);
        }

        if (part.inlineData && part.inlineData.data) {
          if (this.onAudio) {
            this.onAudio(part.inlineData.data);
          }
        }
      }
    }

    // --- NEW TOOL USE HANDLING (Top-Level) ---
    if (message.toolCall) {
      console.log("[GEMINI] Tool Call:", message.toolCall);
      const functionCalls = message.toolCall.functionCalls; // Array of {id, name, args}
      await this.handleToolCalls(functionCalls);
    }

    // Handle Turn Complete / Interruption (Server signals)
    if (message.serverContent?.interrupted) {
      console.log("[GEMINI] Interrupted");
      const event = new CustomEvent("gemini-interrupted");
      window.dispatchEvent(event);
    }

    if (message.serverContent?.turnComplete) {
      // Turn complete
    }
  }

  async handleToolCalls(functionCalls) {
    if (!functionCalls || functionCalls.length === 0) return;

    const functionResponses = [];

    for (const call of functionCalls) {
      const { id, name, args } = call;
      let result = {};

      console.log(`[LiveClient] Executing tool: ${name}`, args);

      // We expect window.labControl to be present for execution
      if (window.labControl) {
        try {
          if (name === "look_at") {
            window.labControl.lookAtCoordinate(args.x, args.y);
            result = { result: "ok" };
          } else if (name === "reset_view") {
            window.labControl.reset();
            result = { result: "ok" };
          } else if (name === "move") {
            window.labControl.move(args.distance);
            result = { result: "ok" };
          } else {
            console.warn("Unknown tool:", name);
            result = { error: "Unknown tool" };
          }
        } catch (e) {
          console.error("Tool execution failed:", e);
          result = { error: e.message };
        }
      } else {
        console.error("window.labControl not found!");
        result = { error: "Client capability missing" };
      }

      functionResponses.push({
        id: id,
        name: name,
        response: { result: result }, // Wrapping in 'result' key often expected
      });
    }

    // Send Consolidated Response
    const toolResponse = {
      toolResponse: {
        functionResponses: functionResponses,
      },
    };

    this.send(toolResponse);
    console.log("[LiveClient] Sent tool response:", toolResponse);
  }

  send(data) {
    if (this.session && this.session.readyState === WebSocket.OPEN) {
      this.session.send(JSON.stringify(data));
    }
  }

  sendAudio(base64PCM) {
    // Send RealtimeInput
    const msg = {
      realtimeInput: {
        mediaChunks: [
          {
            mimeType: "audio/pcm;rate=16000",
            data: base64PCM,
          },
        ],
      },
    };
    this.send(msg);
  }

  sendImage(base64Image) {
    const msg = {
      realtimeInput: {
        mediaChunks: [
          {
            mimeType: "image/jpeg",
            data: base64Image,
          },
        ],
      },
    };
    this.send(msg);
    // console.log("[LiveClient] Sent Image Context");
  }

  sendTextContext(text) {
    const msg = {
      clientContent: {
        turns: [
          {
            role: "user",
            parts: [{ text: text }],
          },
        ],
        turnComplete: false,
      },
    };
    this.send(msg);
  }

  disconnect() {
    this.stopVideoStreaming();
    if (this.session) {
      try {
        this.session.close();
      } catch (e) {
        console.log("Error closing session", e);
      }
      this.session = null;
    }
  }

  // --- Helper Methods for Vision ---

  startVideoStreaming() {
    this.stopVideoStreaming(); // Ensure no duplicates

    // 1 FPS (1000ms) or 2 FPS (500ms). Let's try 1 FPS to be safe with bandwidth/latency trade-off initially.
    this.videoInterval = setInterval(async () => {
        if (!this.session || this.session.readyState !== WebSocket.OPEN) return;
        
        try {
            const base64 = await this.captureScene();
            this.sendImage(base64);
        } catch (e) {
            console.error("Video stream capture failed:", e);
        }
    }, 1000);
    
    console.log("[LiveClient] Video streaming started (1 FPS)");
  }

  stopVideoStreaming() {
    if (this.videoInterval) {
        clearInterval(this.videoInterval);
        this.videoInterval = null;
        console.log("[LiveClient] Video streaming stopped");
    }
  }

  async captureScene() {
    return new Promise((resolve, reject) => {
      const scene = document.querySelector("a-scene");
      // Since we removed A-Frame in main.tsx (scene=null), we must adapt.
      // But wait! main.tsx says:
      // "const scene = null; // A-Frame removed"
      // "const cameraEntity = null; // A-Frame removed"
      // AND
      // "root.render(<LabWorld />);" which uses React Three Fiber.
      
      // So document.querySelector("a-scene") will FAIL.
      // We need to capture from the React Three Fiber Canvas.
      
      const canvas = document.querySelector('canvas');
      
      // Debug
      if (!canvas) {
        // console.warn("[LiveClient] No canvas found for vision!");
        reject(new Error("No canvas found"));
        return;
      }
      
      try {
          // React Three Fiber usually creates a WebGL context with preserveDrawingBuffer: false by default
          // If we can't read from it, we might need to change gl={{ preserveDrawingBuffer: true }} in LabWorld.tsx
          // Let's try standard toDataURL first.
          const dataURL = canvas.toDataURL("image/jpeg", 0.6); // Lower quality for stream
          resolve(dataURL.split(",")[1]);
      } catch (e) {
        // console.error("[LiveClient] Capture failed:", e);
        reject(e);
      }
    });
  }

  getAccessibilityLayerData() {
    // Helper to scrape the text content of the hidden layer
    const accLayer = document.getElementById("accessibility-tree");
    if (accLayer) {
      // Just get the list of annotations effectively
      const annotations = document.getElementById("annotations-list");
      return annotations ? annotations.innerText : "No accessibility data.";
    }
    return "No accessibility data.";
  }
}

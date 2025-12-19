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
    // Restore original model (ensure models/ prefix)
    this.model = 'models/gemini-2.5-flash-native-audio-preview-12-2025'; 
  }

  async connect(systemInstruction = "") {
    // Check for existing session to resume
    const savedHandle = localStorage.getItem('GEMINI_SESSION_HANDLE');
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
                    voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } }
                }
            },
            systemInstruction: {
                parts: [{ text: systemInstruction }]
            },
            tools: [{
                functionDeclarations: [
                    {
                        name: "look_at",
                        description: "Rotates the camera to look at a specific direction (yaw and pitch).",
                        parameters: {
                            type: "OBJECT",
                            properties: {
                                yaw: { type: "NUMBER", description: "Yaw angle in degrees (0-360)." },
                                pitch: { type: "NUMBER", description: "Pitch angle in degrees (-90 to 90)." }
                            },
                            required: ["yaw", "pitch"]
                        }
                    },
                    {
                        name: "get_visual_context",
                        description: "Captures a screenshot of the user's current view and provides a visual description of the scene.",
                        parameters: { type: "OBJECT", properties: {} }
                    },
                    {
                        name: "reset_view",
                        description: "Resets the camera view to the default starting position.",
                        parameters: { type: "OBJECT", properties: {} }
                    }
                ]
            }]
        }
    };
    
    // Determine URI: Direct vs Proxy
    const host = "generativelanguage.googleapis.com";
    let uri;
    if (this.apiKey && this.apiKey.startsWith('wss://')) {
        // 1. Secure Proxy URL provided directly as "apiKey" or config
        uri = this.apiKey; 
    } else if (this.apiKey && this.apiKey.startsWith('AIza')) {
        // 2. Direct API Key (Legacy/Dev)
        uri = `wss://${host}/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${this.apiKey}`;
    } else if (this.apiKey && this.apiKey.startsWith('http')) {
        // 3. HTTP/HTTPS Proxy (Convert to WSS)
        const urlObj = new URL(this.apiKey);
        urlObj.protocol = urlObj.protocol === 'https:' ? 'wss:' : 'ws:';
        uri = urlObj.toString();
    } else {
        // 4. Ephemeral Token or Fallback
         uri = `wss://${host}/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=${this.apiKey}`;
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
             console.log(`Session Closed: Code=${event.code} Reason=${event.reason} WasClean=${event.wasClean}`);
             if (this.onClose) this.onClose();
        };

        this.session.onerror = (error) => {
             console.error("Session Error:", error);
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
                   console.warn("[GEMINI] Received legacy inline functionCall. Preferring top-level toolCall if available.");
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
          const event = new CustomEvent('gemini-interrupted');
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
                      window.labControl.setRotation(args.yaw, args.pitch);
                      result = { result: "ok" };
                  } else if (name === "reset_view") {
                      window.labControl.reset();
                      result = { result: "ok" };
                  } else if (name === "get_visual_context") {
                      // 1. Capture Screenshot
                      const base64Image = await this.captureScene();
                      // 2. Query Vision Model
                      const visionDescription = await this.queryVisionModel(base64Image);
                      // 3. Get Hidden Accessibility Data
                      const accessData = this.getAccessibilityLayerData();
                      
                      result = { 
                          visual_description: visionDescription,
                          accessibility_data: accessData
                      };
                  } else {
                      console.warn("Unknown tool:", name);
                      result = { error: "Unknown tool" };
                  }
              } catch(e) {
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
              response: { result: result } // Wrapping in 'result' key often expected
          });
      }

      // Send Consolidated Response
      const toolResponse = {
          toolResponse: {
              functionResponses: functionResponses
          }
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
              mediaChunks: [{
                  mimeType: "audio/pcm;rate=16000",
                  data: base64PCM
              }]
          }
      };
      this.send(msg);
  }

  sendTextContext(text) {
      const msg = {
          clientContent: {
              turns: [{
                  role: "user",
                  parts: [{ text: text }]
              }],
              turnComplete: false
          }
      };
      this.send(msg);
  }

  disconnect() {
      if (this.session) {
          try {
             this.session.close();
          } catch(e) { console.log("Error closing session", e);}
          this.session = null;
      }
  }

  // --- Helper Methods for Vision ---

  async captureScene() {
      return new Promise((resolve, reject) => {
          const scene = document.querySelector('a-scene');
          
          // Debug A-Scene state
          if (!scene) {
               console.error("[LiveClient] No a-scene found!");
               reject(new Error("No a-scene found"));
               return;
          }
          if (!scene.components.screenshot) {
               console.error("[LiveClient] Screenshot component missing!");
               reject(new Error("Screenshot component missing"));
               return;
          }

          // Use A-Frame's built-in screenshot component which handles perspective/projection
          try {
              // 'perspective' is usually the main camera view
              const canvas = scene.components.screenshot.getCanvas('perspective');
              if (canvas) {
                  // Quality 0.8 to keep size reasonable
                  const dataURL = canvas.toDataURL('image/jpeg', 0.8);
                  
                  // Debug: Log basic stats about the image
                  console.log(`[LiveClient] Captured Screenshot. Data URL length: ${dataURL.length}`);
                  
                  resolve(dataURL.split(',')[1]);
              } else {
                  console.error("[LiveClient] getCanvas returned null");
                  // Fallback to raw canvas if component fails (unlikely if component exists)
                  if (scene.canvas) {
                       console.log("[LiveClient] Fallback to raw scene.canvas");
                       const rawDataURL = scene.canvas.toDataURL('image/jpeg', 0.8);
                       resolve(rawDataURL.split(',')[1]);
                  } else {
                       reject(new Error("No canvas found via component or direct access"));
                  }
              }
          } catch (e) {
              console.error("[LiveClient] Capture failed:", e);
              reject(e);
          }
      });
  }

  async queryVisionModel(base64Image) {
      if (!this.apiKey) return "Error: No API Key available for vision query.";
      
      const prompt = "Describe this scene concisely. Identify key objects and the setting.";
      
      // Check for Proxy Usage
      // If apiKey looks like a URL, it's a Proxy URL
      if (this.apiKey && (this.apiKey.startsWith('http') || this.apiKey.startsWith('wss'))) {
           // Resolve Vision Endpoint from Proxy Base
           let proxyBase = this.apiKey;
           if (proxyBase.startsWith('wss:')) proxyBase = proxyBase.replace('wss:', 'https:');
           if (proxyBase.startsWith('ws:')) proxyBase = proxyBase.replace('ws:', 'http:');
           
           // If the proxy url was the websocket endpoint directly (root), append /vision
           const url = new URL(proxyBase);
           url.pathname = '/vision'; 
           
           const payload = {
               image: base64Image,
               prompt: prompt
           };
           
           try {
               const response = await fetch(url.toString(), {
                   method: 'POST',
                   headers: { 'Content-Type': 'application/json' },
                   body: JSON.stringify(payload)
               });
               
               if (!response.ok) {
                    const errText = await response.text();
                    return `Vision Proxy Error: ${errText}`;
               }
               
               const data = await response.json();
               return data.text || "No description available.";
           } catch(e) {
               return `Vision Proxy Failed: ${e.message}`;
           }

      } else if (this.apiKey.startsWith('auth_tokens/')) {
          // Use Legacy Backend Proxy (Python server)
          const url = '/vision';
          const payload = {
              image: base64Image,
              prompt: prompt
          };
          
          try {
              const response = await fetch(url, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(payload)
              });
              
              if (!response.ok) {
                   const errText = await response.text();
                   return `Vision Proxy Error: ${errText}`;
              }
              
              const data = await response.json();
              return data.text || "No description available.";
          } catch(e) {
              return `Vision Proxy Failed: ${e.message}`;
          }

      } else {
          // Standard API Key - Direct Call
          const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${this.apiKey}`;
          
          const payload = {
            contents: [{
              parts: [
                { text: prompt },
                {
                  inline_data: {
                    mime_type: "image/jpeg",
                    data: base64Image
                  }
                }
              ]
            }]
          };

          try {
              const response = await fetch(url, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(payload)
              });
              
              if (!response.ok) {
                  const err = await response.text();
                  console.error("Vision API Error:", err);
                  return `Vision API Error: ${response.statusText}`;
              }
              
              const data = await response.json();
              if (data.candidates && data.candidates[0].content && data.candidates[0].content.parts) {
                  return data.candidates[0].content.parts[0].text;
              }
              return "No description available.";
          } catch (e) {
              console.error("Vision Query Failed:", e);
              return "Failed to query vision model.";
          }
      }
  }

  getAccessibilityLayerData() {
      // Helper to scrape the text content of the hidden layer
      const accLayer = document.getElementById('accessibility-tree');
      if (accLayer) {
          // Just get the list of annotations effectively
          const annotations = document.getElementById('annotations-list');
          return annotations ? annotations.innerText : "No accessibility data.";
      }
      return "No accessibility data.";
  }
}

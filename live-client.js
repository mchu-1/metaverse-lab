/**
 * GEMINI LIVE API Client
 * Manages WebSocket connection and Bidi Protocol
 */

export class LiveClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.ws = null;
    this.onAudio = null;
    this.onClose = null;
    this.model = "gemini-2.0-flash-exp"; // or "gemini-2.0-flash-exp" as per availability
    this.host = "generativelanguage.googleapis.com";
    this.url = `wss://${this.host}/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${this.apiKey}`;
  }

  connect(systemInstruction = "") {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);
      } catch (e) {
        reject(e);
      }

      this.ws.onopen = () => {
        console.log("WS Connected");
        // Send Setup Message
        const setupMsg = {
          setup: {
            model: "models/" + this.model,
            generationConfig: {
              responseModalities: ["AUDIO", "TEXT"],
              speechConfig: {
                  voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } }
              }
            },
            systemInstruction: {
                parts: [{ text: systemInstruction }]
            }
          }
        };
        this.send(setupMsg);
        resolve();
      };

      this.ws.onmessage = async (event) => {
        let msg;
        if (event.data instanceof Blob) {
            const text = await event.data.text();
            msg = JSON.parse(text);
        } else {
            msg = JSON.parse(event.data);
        }
        
        // Log "Server Turn" or meaningful events to Remote Log
        if (msg.serverContent) {
            if (msg.serverContent.modelTurn) {
                console.log("[GEMINI] Model is speaking/responding...");
            }
            if (msg.serverContent.turnComplete) {
                console.log("[GEMINI] Turn Complete.");
            }
        }
        
        // Un-comment to see raw if needed, but it's spammy with audio chunks
        // console.log("RAW:", JSON.stringify(msg).substring(0, 100));

        this.handleMessage(msg);
      };

      this.ws.onerror = (err) => {
        console.error("WS Error:", err);
      };

      this.ws.onclose = (evt) => {
        console.log("WS Closed:", evt);
        if (this.onClose) this.onClose();
      };
    });
  }

  handleMessage(msg) {
    // console.log("Received:", msg); // Verbose logging

    // Handle Audio (serverContent -> modelTurn -> parts -> inlineData)
    if (msg.serverContent?.modelTurn?.parts) {
      for (const part of msg.serverContent.modelTurn.parts) {
        if (part.inlineData && part.inlineData.mimeType.startsWith("audio/")) {
            if (this.onAudio) {
                this.onAudio(part.inlineData.data); 
            }
        } else if (part.text) {
            console.log("[GEMINI]", part.text);
        }
      }
    }

    // Handle Turn Complete (useful for UI state)
    if (msg.serverContent?.turnComplete) {
       // console.log("Turn complete");
    }
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  sendAudio(base64PCM) {
    const msg = {
      realtimeInput: {
        mediaChunks: [
          {
            mimeType: "audio/pcm;rate=16000",
            data: base64PCM
          }
        ]
      }
    };
    this.send(msg);
  }

  sendTextContext(text) {
    // We inject contextual "System" updates as ClientContent
    const msg = {
      clientContent: {
        turns: [
          {
            role: "user",
            parts: [{ text: text }]
          }
        ],
        turnComplete: false // We are just adding info, not necessarily yielding the floor, but usually user turn implies yield.
      }
    };
    this.send(msg);
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

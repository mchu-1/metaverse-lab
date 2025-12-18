import { GoogleGenAI } from 'https://esm.sh/@google/genai';

/**
 * GEMINI LIVE API Client
 * Manages Connection using Official @google/genai SDK
 */

export class LiveClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.client = new GoogleGenAI({ apiKey: this.apiKey });
    this.session = null;
    this.onAudio = null;
    this.onClose = null;
    this.model = 'gemini-2.5-flash-native-audio-preview-12-2025';
  }

  async connect(systemInstruction = "") {
    const config = {
      responseModalities: ["AUDIO"], // We can add "TEXT" if the model supports it, but per docs it says AUDIO
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } }
      },
      systemInstruction: {
        parts: [{ text: systemInstruction }]
      }
    };

    try {
        console.log("Connecting to Gemini Live API...");
        this.session = await this.client.media.connect({
            model: this.model,
            config: config,
        });
        
        console.log("Session created. Setting up listeners.");

        // Handle Incoming Messages
        this.session.on('message', (message) => {
            this.handleMessage(message);
        });

        this.session.on('close', (event) => {
            console.log("Session Closed:", event);
            if (this.onClose) this.onClose();
        });

        this.session.on('error', (error) => {
            console.error("Session Error:", error);
        });

    } catch (e) {
        console.error("Failed to connect:", e);
        throw e;
    }
  }

  handleMessage(message) {
      // 1. Handle Interruption
      if (message.serverContent && message.serverContent.interrupted) {
          console.log("[GEMINI] Interrupted");
          // Clear audio buffer
          if (this.onAudio) {
               // We send null or a specialized signal if we want, or just expose a clear method on visualizer
               // But our callback is strictly "receive PCM".
               // Let's assume onAudio has a .clear() method or we access the player directly.
               // Actually, the caller (index.html) binds this.
          }
           // Dispatch Event for UI to handle clearing
           const event = new CustomEvent('gemini-interrupted');
           window.dispatchEvent(event);
           return;
      }

      // 2. Handle Text (if any)
      if (message.serverContent?.modelTurn?.parts) {
          for (const part of message.serverContent.modelTurn.parts) {
              if (part.text) {
                  console.log("[GEMINI]", part.text);
              }
              if (part.inlineData && part.inlineData.data) {
                  if (this.onAudio) {
                      this.onAudio(part.inlineData.data);
                  }
              }
          }
      }
      
      // 3. Handle Turn Complete
      if (message.serverContent?.turnComplete) {
           // console.log("Turn complete");
      }
  }

  sendAudio(base64PCM) {
      if (!this.session) return;
      this.session.sendRealtimeInput({
          mimeType: "audio/pcm;rate=16000",
          data: base64PCM
      });
  }

  sendTextContext(text) {
      if (!this.session) return;
      this.session.send({
          clientContent: {
              turns: [
                  {
                      role: "user",
                      parts: [{ text: text }]
                  }
              ],
              turnComplete: false
          }
      });
  }

  disconnect() {
      if (this.session) {
          // The SDK might not have a disconnect/close method explicitly exposed in early alpha?
          // Checking docs/types... usually .close() or we just let it GC.
          // Based on snippet: onclose event exists. 
          // Explicit close might be:
          try {
             // this.session.close(); // Hypothetical
             // If not available, we just drop the reference.
             // We can end the session by sending a "end" message? No.
             // Usually websockets have close.
             // Let's assume it behaves like a WS wrapper.
             if (this.session.close) this.session.close();
          } catch(e) { console.log("Error closing session", e);}
          this.session = null;
      }
  }
}

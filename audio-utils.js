/**
 * AudioUtils
 * Handles recording (with downsampling to 16kHz) and playback (from 24kHz)
 * for the Gemini Live API.
 */

export class AudioRecorder {
  constructor(sampleRate = 16000) {
    this.targetSampleRate = sampleRate;
    this.audioContext = null;
    this.mediaStream = null;
    this.workletNode = null;
    this.onDataAvailable = null;
  }

  async start(onDataAvailable) {
    this.onDataAvailable = onDataAvailable;
    // Note: We don't force sampleRate in constructor here because strict browser support varies.
    // Instead we accept whatever the system gives us (e.g. 48000Hz) and decimate manually.
    // 0. Environment Checks
    console.log(`[Mic] System Check: Secure=${window.isSecureContext}, Protocol=${location.protocol}, Host=${location.hostname}`);
    
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.error("[Mic] navigator.mediaDevices is missing! This likely means you are on HTTP (not localhost) or a non-secure context.");
        throw new Error("Secure Context Required");
    }

    // 1. Simple Request (Nuclear Option)
    try {
      console.log("[Mic] Requesting (audio: true)...");
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log("[Mic] Access Granted.");
    } catch (e) {
         console.error(`[Mic] Failed: ${e.name} - ${e.message}`);
         // Enumeration check
         try {
             const devices = await navigator.mediaDevices.enumerateDevices();
             const audioInputs = devices.filter(d => d.kind === 'audioinput');
             console.log(`[Mic] Device Enumeration (${audioInputs.length}):`);
             audioInputs.forEach(d => console.log(`  - ${d.label} (${d.deviceId})`));
         } catch(e2) {
             console.error("[Mic] Enumeration failed:", e2);
         }
         throw e;
    }

    // 2. Initialize Audio Context AFTER permission granted
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }

    const source = this.audioContext.createMediaStreamSource(this.mediaStream);
    const processor = this.audioContext.createScriptProcessor(4096, 1, 1);
    
    // Resampling state
    const sourceRate = this.audioContext.sampleRate;
    const targetRate = this.targetSampleRate; // 16000
    // Simple decimation ratio (not perfect but likely 48000 -> 16000 = 3)
    // We should do a basic accumulator.
    
    let bufferCache = []; 
    
    processor.onaudioprocess = (e) => {
      if (!this.onDataAvailable) return;

      const inputData = e.inputBuffer.getChannelData(0);
      
      // Downsampling logic
      if (sourceRate === targetRate) {
          this.sendData(inputData);
      } else {
          // Naive decimation/resampling
          // We need to compress inputData (length N) into outputData (length N * 16k/48k)
          const ratio = sourceRate / targetRate;
          const outputLength = Math.floor(inputData.length / ratio);
          const downsampled = new Float32Array(outputLength);
          
          for (let i = 0; i < outputLength; i++) {
              const offset = Math.floor(i * ratio);
              // Basic averaging (box filter) for anti-aliasing (primitive)
              // or just nearest neighbor (sample[offset]). 
              // Averaging is safer for downsampling.
              let sum = 0;
              let count = 0;
              // Average samples from [offset] to [next_offset]
              const nextOffset = Math.floor((i + 1) * ratio);
              for (let j = offset; j < nextOffset && j < inputData.length; j++) {
                  sum += inputData[j];
                  count++;
              }
              downsampled[i] = count > 0 ? sum / count : inputData[offset];
          }
          this.sendData(downsampled);
      }
    };

    source.connect(processor);
    processor.connect(this.audioContext.destination);

    this.processor = processor;
    this.source = source;
  }
  
  sendData(float32Data) {
      // Convert float32 [-1, 1] to Int16
      const pcm16 = new Int16Array(float32Data.length);
      for (let i = 0; i < float32Data.length; i++) {
        let s = Math.max(-1, Math.min(1, float32Data[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }

      // Convert buffer to base64
      const buffer = pcm16.buffer;
      let binary = "";
      const bytes = new Uint8Array(buffer);
      const len = bytes.byteLength;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);
      this.onDataAvailable(base64);
      
      // Visual Debug: Calculate approximate volume
      let sum = 0;
      // Use float32Data, not inputData (which is undefined here)
      const debugLimit = Math.min(float32Data.length, 1000); // Check first 1000 samples
      for (let i = 0; i < debugLimit; i += 10) { 
          sum += Math.abs(float32Data[i]);
      }
      const avg = sum / (debugLimit / 10);
      
      // Update CSS custom property for voice-synced animation
      const btnConnect = document.getElementById('btn-connect');
      if (btnConnect) {
        // Normalize and clamp voice activity (0-1)
        const voiceActivity = Math.min(1, avg * 8); // Scale up for visibility
        btnConnect.style.setProperty('--voice-activity', voiceActivity.toFixed(3));
      }
      
      // Log occasionally to prove mic is working
      if (!this.frameCount) this.frameCount = 0;
      this.frameCount++;
      if (this.frameCount % 50 === 0) { // Every ~2 seconds
         if (avg > 0.01) { 
             console.log(`[MIC] Level: ${(avg*100).toFixed(1)}%`); 
         }
      }
  }

  stop() {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
    }
    if (this.audioContext) {
      this.audioContext.close();
    }
  }
}

export class AudioStreamPlayer {
  constructor(sampleRate = 24000) {
    this.sampleRate = sampleRate;
    this.audioContext = null;
    this.nextStartTime = 0;
    this.queue = [];
    this.isPlaying = false;
  }

  async initialize() {
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: this.sampleRate,
    });
    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }
    this.nextStartTime = this.audioContext.currentTime;
    this.activeSources = [];
  }

  addPCM16(base64Data) {
    if (!this.audioContext) return;

    console.log(`[AudioPlayer] Received ${base64Data.length} bytes of base64`);

    // Decode Base64
    const binaryString = atob(base64Data);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const int16 = new Int16Array(bytes.buffer);

    // Convert Int16 to Float32
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768.0;
    }

    const buffer = this.audioContext.createBuffer(
      1,
      float32.length,
      this.sampleRate
    );
    buffer.getChannelData(0).set(float32);

    this.scheduleBuffer(buffer);
  }

  scheduleBuffer(buffer) {
    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.audioContext.destination);

    // Ensure seamless playback
    const currentTime = this.audioContext.currentTime;
    // If we fell behind, jump to current time (latency catchup)
    // small buffer (0.05s) to avoid glitches
    if (this.nextStartTime < currentTime) {
      this.nextStartTime = currentTime + 0.05;
    }

    source.start(this.nextStartTime);
    this.nextStartTime += buffer.duration;

    // Track source
    this.activeSources.push(source);
    source.onended = () => {
      this.activeSources = this.activeSources.filter(s => s !== source);
    };
  }

  clear() {
    this.queue = [];
    
    // Stop all currently playing sources
    if (this.activeSources) {
        this.activeSources.forEach(source => {
            try {
                source.stop();
            } catch (e) {
                // Ignore errors if already stopped
            }
        });
        this.activeSources = [];
    }

    // Reset timing
    this.nextStartTime = this.audioContext ? this.audioContext.currentTime : 0;
  }
}

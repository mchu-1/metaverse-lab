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
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();

    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          // We can ask for 16k, but if the device doesn't support it, we get 48k.
          // Better to handle resampling ourself to be safe.
        },
      });
    } catch (e) {
      console.error("Mic access denied:", e);
      throw e;
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
  }

  addPCM16(base64Data) {
    if (!this.audioContext) return;

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
  }
}

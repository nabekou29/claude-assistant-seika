import * as http from 'http';
import * as https from 'https';

export interface TTSConfig {
  apiUrl: string;
  apiKey?: string;
  voiceId?: string;
  speed?: number;
  pitch?: number;
  volume?: number;
}

export class TTSClient {
  constructor(private config: TTSConfig) {}

  async speak(text: string): Promise<void> {
    const url = new URL(this.config.apiUrl);
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;

    const requestData = JSON.stringify({
      text,
      voiceId: this.config.voiceId,
      speed: this.config.speed || 1.0,
      pitch: this.config.pitch || 1.0,
      volume: this.config.volume || 1.0,
    });

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestData),
        ...(this.config.apiKey && { 'Authorization': `Bearer ${this.config.apiKey}` })
      }
    };

    return new Promise((resolve, reject) => {
      const req = client.request(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            console.log('TTS request successful');
            resolve();
          } else {
            reject(new Error(`TTS request failed with status ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.write(requestData);
      req.end();
    });
  }
}
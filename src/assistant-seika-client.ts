import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as https from "https";
import * as http from "http";
const player = require("play-sound")();

export interface AssistantSeikaConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  cid: number; // Character ID (e.g., 60041 for 結月ゆかり)
  effects?: {
    speed?: number; // 0.5～2.0
    volume?: number; // 0.0～2.0
    pitch?: number; // 0.5～2.0
    intonation?: number; // 0.0～2.0
  };
  emotions?: {
    [key: string]: number; // e.g., { "喜び": 0.5, "怒り": 0.0 }
  };
  tempDir?: string;
  playCommand?: string; // カスタム再生コマンド
  maxTextLength?: number; // 一度に読み上げる最大文字数（デフォルト: 200）
}

export interface AvatorInfo {
  cid: number;
  name: string;
}

export class AssistantSeikaClient {
  private auth: string;
  private tempDir: string;

  constructor(private config: AssistantSeikaConfig) {
    // Basic認証のヘッダーを準備
    const credentials = `${config.username}:${config.password}`;
    this.auth = Buffer.from(credentials).toString("base64");

    // 一時ファイル保存用ディレクトリ
    this.tempDir = config.tempDir || path.join(os.tmpdir(), "claude-yukari");
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  async speak(text: string): Promise<void> {
    try {
      // 長い文章は分割して読み上げ
      const chunks = this.splitText(text);

      if (chunks.length > 1) {
        console.log(
          `\n📝 テキストを${chunks.length}個に分割しました（最大${this.config.maxTextLength || 100}文字）`,
        );
        chunks.forEach((chunk, index) => {
          console.log(
            `  [${index + 1}/${chunks.length}] ${chunk.substring(0, 50)}...（${chunk.length}文字）`,
          );
        });
      }

      for (const chunk of chunks) {
        // 音声ファイルを生成
        const audioBuffer = await this.generateSpeech(chunk);

        // 一時ファイルに保存
        const tempFile = path.join(this.tempDir, `speech_${Date.now()}.wav`);
        fs.writeFileSync(tempFile, audioBuffer);

        // 音声を再生
        await this.playAudio(tempFile);

        // 一時ファイルを削除
        fs.unlinkSync(tempFile);

        // 次のチャンクまで少し間を空ける
        if (chunks.length > 1 && chunk !== chunks[chunks.length - 1]) {
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }
    } catch (error) {
      throw new Error(`Failed to speak: ${error}`);
    }
  }

  private splitText(text: string): string[] {
    const maxLength = this.config.maxTextLength || 100;

    // 短い文章はそのまま返す
    if (text.length <= maxLength && !text.includes("。")) {
      return [text];
    }

    const chunks: string[] = [];

    // まず句点で分割
    const sentences = text.split(/(?<=[。！？])/);

    for (const sentence of sentences) {
      // 空文字列はスキップ
      if (!sentence.trim()) continue;

      // 一文が最大文字数以下ならそのまま追加
      if (sentence.length <= maxLength) {
        chunks.push(sentence.trim());
      } else {
        // 長すぎる場合は読点でさらに分割
        const subSentences = sentence.split(/(?<=[、,])/);
        let currentChunk = "";

        for (const subSentence of subSentences) {
          if (currentChunk.length + subSentence.length <= maxLength) {
            currentChunk += subSentence;
          } else {
            if (currentChunk) {
              chunks.push(currentChunk.trim());
            }
            
            // それでも長すぎる場合は強制的に分割
            if (subSentence.length > maxLength) {
              const words = subSentence.match(new RegExp(`.{1,${maxLength}}`, 'g')) || [];
              chunks.push(...words.map(w => w.trim()));
              currentChunk = "";
            } else {
              currentChunk = subSentence;
            }
          }
        }
        
        if (currentChunk) {
          chunks.push(currentChunk.trim());
        }
      }
    }

    return chunks.filter(chunk => chunk.length > 0);
  }

  async generateSpeech(text: string): Promise<Buffer> {
    const requestData = JSON.stringify({
      talktext: text,
      effects: this.config.effects,
      emotions: this.config.emotions,
    });

    const options = {
      hostname: this.config.host,
      port: this.config.port,
      path: `/SAVE2/${this.config.cid}`,
      method: "POST",
      headers: {
        Authorization: `Basic ${this.auth}`,
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(requestData),
        Accept: "audio/wav",
      },
    };

    return new Promise((resolve, reject) => {
      const client = this.config.port === 443 ? https : http;
      const chunks: Buffer[] = [];

      const req = client.request(options, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
          return;
        }

        res.on("data", (chunk) => {
          chunks.push(chunk);
        });

        res.on("end", () => {
          const buffer = Buffer.concat(chunks);
          resolve(buffer);
        });
      });

      req.on("error", (error) => {
        reject(error);
      });

      req.write(requestData);
      req.end();
    });
  }

  private playAudio(filePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const playCommand = this.config.playCommand;

      if (playCommand) {
        // カスタムコマンドを使用
        const { exec } = require("child_process");
        exec(`${playCommand} "${filePath}"`, (error: any) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      } else {
        // play-soundを使用（macOS: afplay, Linux: aplay/mpg123/mpg321）
        player.play(filePath, (err: any) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      }
    });
  }

  async getAvators(): Promise<AvatorInfo[]> {
    const options = {
      hostname: this.config.host,
      port: this.config.port,
      path: "/AVATOR2",
      method: "GET",
      headers: {
        Authorization: `Basic ${this.auth}`,
        Accept: "application/json",
      },
    };

    return new Promise((resolve, reject) => {
      const client = this.config.port === 443 ? https : http;
      let data = "";

      const req = client.request(options, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
          return;
        }

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          try {
            const avators = JSON.parse(data);
            resolve(avators);
          } catch (error) {
            reject(new Error(`Failed to parse response: ${error}`));
          }
        });
      });

      req.on("error", (error) => {
        reject(error);
      });

      req.end();
    });
  }

  async testConnection(): Promise<string> {
    const options = {
      hostname: this.config.host,
      port: this.config.port,
      path: "/VERSION",
      method: "GET",
      headers: {
        Authorization: `Basic ${this.auth}`,
      },
    };

    return new Promise((resolve, reject) => {
      const client = this.config.port === 443 ? https : http;
      let data = "";

      const req = client.request(options, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
          return;
        }

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          resolve(data.trim());
        });
      });

      req.on("error", (error) => {
        reject(error);
      });

      req.end();
    });
  }
}


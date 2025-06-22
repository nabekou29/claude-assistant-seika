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

interface QueueTask {
  id: string;
  text: string;
  chunks?: string[];
  currentChunkIndex: number;
  priority: number;
  dynamicSpeed?: number;
}

export class AssistantSeikaClient {
  private auth: string;
  private tempDir: string;
  private speakQueue: QueueTask[] = [];
  private currentTaskId?: string;
  private isSpeaking = false;
  private shouldSkipRemainingChunks = false;

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
    return this.queueSpeak(text);
  }

  private async queueSpeak(text: string): Promise<void> {
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // キューの長さと文字数から動的速度を計算
    const dynamicSpeed = this.calculateDynamicSpeed(text, this.speakQueue.length);
    
    const task: QueueTask = {
      id: taskId,
      text,
      currentChunkIndex: 0,
      priority: 1,
      dynamicSpeed
    };

    return new Promise((resolve, reject) => {
      this.speakQueue.push(task);
      
      // 動的速度が設定されている場合は通知
      if (dynamicSpeed && dynamicSpeed > 1.0) {
        console.log(`⚡ 読み上げ速度を${dynamicSpeed.toFixed(1)}倍に調整`);
      }
      
      // キューの処理を開始（既に処理中でなければ）
      if (!this.isSpeaking) {
        this.processQueue().then(resolve).catch(reject);
      } else {
        // 既に処理中の場合は、そのタスクの完了を待つ
        const checkInterval = setInterval(() => {
          const taskInQueue = this.speakQueue.find(t => t.id === taskId);
          if (!taskInQueue && this.currentTaskId !== taskId) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 100);
      }
    });
  }

  private calculateDynamicSpeed(text: string, queueLength: number): number | undefined {
    const baseSpeed = this.config.effects?.speed || 1.0;
    let speedMultiplier = 1.0;

    // キューの長さに基づく速度調整
    if (queueLength > 0) {
      speedMultiplier = Math.min(1.5, 1.0 + (queueLength * 0.1));
    }

    // 文字数に基づく速度調整
    const textLength = text.length;
    if (textLength > 200) {
      speedMultiplier = Math.max(speedMultiplier, 1.4);
    } else if (textLength > 100) {
      speedMultiplier = Math.max(speedMultiplier, 1.2);
    }

    // 基本速度と掛け合わせて、上限を2.0に制限
    const finalSpeed = Math.min(2.0, baseSpeed * speedMultiplier);
    
    // 基本速度と変わらない場合はundefinedを返す
    return finalSpeed !== baseSpeed ? finalSpeed : undefined;
  }

  private async processQueue(): Promise<void> {
    while (this.speakQueue.length > 0) {
      const task = this.speakQueue.shift()!;
      this.currentTaskId = task.id;
      this.isSpeaking = true;
      this.shouldSkipRemainingChunks = false;

      try {
        // テキストを分割
        if (!task.chunks) {
          task.chunks = this.splitText(task.text);
          
          if (task.chunks.length > 1) {
            console.log(
              `\n📝 テキストを${task.chunks.length}個に分割しました（最大${this.config.maxTextLength || 100}文字）`,
            );
            task.chunks.forEach((chunk, index) => {
              console.log(
                `  [${index + 1}/${task.chunks!.length}] ${chunk.substring(0, 50)}...（${chunk.length}文字）`,
              );
            });
          }
        }

        // チャンクを順次処理
        for (let i = task.currentChunkIndex; i < task.chunks.length; i++) {
          // スキップフラグが立っている場合は即座に中断
          if (this.shouldSkipRemainingChunks) {
            console.log(`⏭️  残り${task.chunks.length - i}個のチャンクをスキップ`);
            break;
          }

          const chunk = task.chunks[i];
          
          // 動的速度を適用した音声ファイルを生成
          const audioBuffer = await this.generateSpeech(chunk, task.dynamicSpeed);

          // 最初のチャンクの音声生成が完了したら、キューに他のタスクがある場合はスキップフラグを立てる
          if (i === 0 && this.speakQueue.length > 0) {
            this.shouldSkipRemainingChunks = true;
            console.log('⏭️  新しいメッセージの準備ができたため、現在の読み上げの残りをスキップします');
          }

          // スキップフラグを再度チェック（音声生成中に新しいタスクが来た場合）
          if (this.shouldSkipRemainingChunks) {
            // 現在のチャンクは最後まで再生するため、次のチャンクからスキップ
            if (i < task.chunks.length - 1) {
              console.log(`⏭️  次のチャンクからスキップ（残り${task.chunks.length - i - 1}個）`);
            }
          }

          // 一時ファイルに保存
          const tempFile = path.join(this.tempDir, `speech_${Date.now()}.wav`);
          fs.writeFileSync(tempFile, audioBuffer);

          // 音声を再生
          try {
            await this.playAudio(tempFile);
          } catch (error) {
            // 再生エラーは無視（スキップされた可能性がある）
            console.log('⚠️  音声再生がスキップまたはエラー:', error);
          } finally {
            // 一時ファイルを削除
            if (fs.existsSync(tempFile)) {
              fs.unlinkSync(tempFile);
            }
          }

          task.currentChunkIndex = i + 1;

          // 次のチャンクまで少し間を空ける（最後のチャンクでない場合）
          if (task.chunks.length > 1 && i < task.chunks.length - 1 && !this.shouldSkipRemainingChunks) {
            await new Promise((resolve) => setTimeout(resolve, 200));
          }
        }
      } catch (error) {
        console.error(`タスク ${task.id} の処理中にエラー:`, error);
      }

      this.currentTaskId = undefined;
    }

    this.isSpeaking = false;
  }

  private splitText(text: string): string[] {
    const maxLength = this.config.maxTextLength || 100;

    // 文字数が上限以下ならそのまま返す
    if (text.length <= maxLength) {
      return [text];
    }

    const chunks: string[] = [];
    let currentChunk = "";

    // まず改行で分割（段落単位）
    const paragraphs = text.split(/\n+/);
    
    for (let i = 0; i < paragraphs.length; i++) {
      const paragraph = paragraphs[i].trim();
      if (!paragraph) continue;

      // 現在のチャンクに段落を追加できるか確認
      const potentialChunk = currentChunk 
        ? currentChunk + "\n" + paragraph 
        : paragraph;

      if (potentialChunk.length <= maxLength) {
        // 追加してもmaxLength以下なら現在のチャンクに追加
        currentChunk = potentialChunk;
      } else {
        // 現在のチャンクを保存して新しいチャンクを開始
        if (currentChunk) {
          chunks.push(currentChunk);
          currentChunk = "";
        }

        // 段落自体がmaxLengthを超える場合は句点で分割
        if (paragraph.length > maxLength) {
          const sentences = paragraph.split(/(?<=[。！？])/);
          
          for (const sentence of sentences) {
            const trimmedSentence = sentence.trim();
            if (!trimmedSentence) continue;

            // 文がまだ長すぎる場合
            if (trimmedSentence.length > maxLength) {
              // 現在のチャンクがあれば保存
              if (currentChunk) {
                chunks.push(currentChunk);
                currentChunk = "";
              }

              // 読点で分割を試みる
              const phrases = trimmedSentence.split(/(?<=[、,])/);
              let tempChunk = "";

              for (const phrase of phrases) {
                if (tempChunk.length + phrase.length <= maxLength) {
                  tempChunk += phrase;
                } else {
                  if (tempChunk) {
                    chunks.push(tempChunk.trim());
                  }
                  
                  // それでも長い場合は強制分割
                  if (phrase.length > maxLength) {
                    const forcedSplits = phrase.match(new RegExp(`.{1,${maxLength}}`, "g")) || [];
                    chunks.push(...forcedSplits.map(s => s.trim()));
                    tempChunk = "";
                  } else {
                    tempChunk = phrase;
                  }
                }
              }

              if (tempChunk) {
                currentChunk = tempChunk.trim();
              }
            } else {
              // 文を現在のチャンクに追加できるか確認
              const potentialWithSentence = currentChunk 
                ? currentChunk + trimmedSentence 
                : trimmedSentence;

              if (potentialWithSentence.length <= maxLength) {
                currentChunk = potentialWithSentence;
              } else {
                if (currentChunk) {
                  chunks.push(currentChunk);
                }
                currentChunk = trimmedSentence;
              }
            }
          }
        } else {
          currentChunk = paragraph;
        }
      }
    }

    // 最後のチャンクを追加
    if (currentChunk) {
      chunks.push(currentChunk);
    }

    return chunks.filter(chunk => chunk.length > 0);
  }

  async generateSpeech(text: string, dynamicSpeed?: number): Promise<Buffer> {
    // 動的速度が指定されている場合は、エフェクトの速度を上書き
    const effects = dynamicSpeed ? {
      ...this.config.effects,
      speed: dynamicSpeed
    } : this.config.effects;
    
    const requestData = JSON.stringify({
      talktext: text,
      effects: effects,
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
          let errorData = '';
          res.on('data', (chunk) => {
            errorData += chunk;
          });
          res.on('end', () => {
            reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage} - ${errorData}`));
          });
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
        reject(new Error(`HTTP Request failed: ${error.message}`));
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
          let errorData = '';
          res.on('data', (chunk) => {
            errorData += chunk;
          });
          res.on('end', () => {
            reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage} - ${errorData}`));
          });
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
        reject(new Error(`HTTP Request failed: ${error.message}`));
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
          let errorData = '';
          res.on('data', (chunk) => {
            errorData += chunk;
          });
          res.on('end', () => {
            reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage} - ${errorData}`));
          });
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
        reject(new Error(`HTTP Request failed: ${error.message}`));
      });

      req.end();
    });
  }
}

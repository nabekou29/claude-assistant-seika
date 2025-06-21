import * as fs from 'fs';
import { EventEmitter } from 'events';

export interface LogEntry {
  parentUuid: string;
  isSidechain: boolean;
  userType: string;
  cwd: string;
  sessionId: string;
  version: string;
  message?: {
    id: string;
    type: string;
    role: string;
    model: string;
    content: Array<{
      type: string;
      text?: string;
    }>;
    stop_reason: string | null;
    stop_sequence: string | null;
    usage: any;
  };
  requestId?: string;
  type: string;
  uuid: string;
  timestamp: string;
}

export class LogWatcher extends EventEmitter {
  private filePosition = 0;
  private watcher?: fs.FSWatcher;

  constructor(private logFilePath: string) {
    super();
  }

  start(): void {
    // 現在のファイルサイズを記録
    const stats = fs.statSync(this.logFilePath);
    this.filePosition = stats.size;

    // ファイルの変更を監視
    this.watcher = fs.watch(this.logFilePath, (eventType) => {
      if (eventType === 'change') {
        this.readNewLines();
      }
    });

    console.log(`Watching log file: ${this.logFilePath}`);
  }

  private readNewLines(): void {
    const stream = fs.createReadStream(this.logFilePath, {
      encoding: 'utf8',
      start: this.filePosition
    });

    let buffer = '';

    stream.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      
      // 最後の行は不完全かもしれないので、バッファに残す
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.trim()) {
          try {
            const entry: LogEntry = JSON.parse(line);
            this.processLogEntry(entry);
          } catch (error) {
            console.error('Failed to parse log line:', error);
          }
        }
      }
    });

    stream.on('end', () => {
      // ファイルポジションを更新
      const stats = fs.statSync(this.logFilePath);
      this.filePosition = stats.size;
    });
  }

  private processLogEntry(entry: LogEntry): void {
    // assistantの発言で、textコンテンツがある場合のみ処理
    if (entry.type === 'assistant' && 
        entry.message?.role === 'assistant' && 
        entry.message?.content) {
      
      for (const content of entry.message.content) {
        if (content.type === 'text' && content.text) {
          this.emit('assistantMessage', content.text);
        }
      }
    }
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = undefined;
    }
  }
}
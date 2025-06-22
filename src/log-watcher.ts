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
          // コードブロックを除外したテキストを生成
          const textWithoutCode = this.removeCodeBlocks(content.text);
          
          // コードブロックを除外した結果が空でない場合のみ発行
          if (textWithoutCode.trim()) {
            this.emit('assistantMessage', textWithoutCode);
          }
        }
      }
    }
  }

  private removeCodeBlocks(text: string): string {
    // コードブロックの前後に説明がある場合の処理を考慮
    let processedText = text;
    
    // フェンスドコードブロック（```）を処理
    // コードブロックの前に「以下のようなコード」的な文言がある場合も考慮
    processedText = processedText.replace(
      /((?:以下の|次の|こんな|このような)?(?:コード|実装|例)?[:：]?\s*\n)?```[\s\S]*?```/g, 
      (_match, prefix) => {
        // 前置きがある場合は「コードブロックです」的な置換
        if (prefix && prefix.trim()) {
          return 'コードブロックがあります。';
        }
        // 前置きがない場合は改行のみ
        return '\n';
      }
    );
    
    // インラインコードは読み上げるのでそのまま残す
    
    // 連続する改行を2つまでに制限
    processedText = processedText.replace(/\n{3,}/g, '\n\n');
    
    // 最初と最後の空白を削除
    return processedText.trim();
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = undefined;
    }
  }
}
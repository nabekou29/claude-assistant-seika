#!/usr/bin/env node
import * as path from 'path';
import * as os from 'os';
import { LogWatcher } from './log-watcher';

// プロジェクトディレクトリからログファイルパスを構築
const projectDir = process.cwd();
// スラッシュ、アンダースコア、ドットをハイフンに置換
const projectDirEncoded = projectDir.replace(/[/_.]/g, '-');
const claudeProjectsDir = path.join(os.homedir(), '.config', 'claude', 'projects', projectDirEncoded);

// セッションIDは現在のセッションのもの
const sessionId = '34c3c3e4-9c09-4050-a9be-4f3590591022';
const logFilePath = path.join(claudeProjectsDir, `${sessionId}.jsonl`);

console.log('Starting log watcher test...');
console.log('Log file:', logFilePath);

const watcher = new LogWatcher(logFilePath);

watcher.on('assistantMessage', (text: string) => {
  console.log('\n=== New Assistant Message ===');
  console.log(text);
  console.log('===========================\n');
});

watcher.start();

// Ctrl+Cで終了
process.on('SIGINT', () => {
  console.log('\nStopping watcher...');
  watcher.stop();
  process.exit(0);
});
#!/usr/bin/env node
import { Command } from 'commander';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { LogWatcher } from './log-watcher';
import { AssistantSeikaClient } from './assistant-seika-client';
import { loadConfig } from './config';

const program = new Command();

program
  .name('claude-yukari')
  .description('Claude Codeの会話ログを監視してHTTP API経由で読み上げを行うCLIツール')
  .version('1.0.0');

program
  .command('watch')
  .description('会話ログを監視して自動読み上げを開始')
  .option('-s, --session-id <id>', 'セッションID')
  .option('-p, --project-dir <dir>', 'プロジェクトディレクトリ', process.cwd())
  .action(async (options) => {
    const config = loadConfig();
    
    // オプションで設定を上書き
    if (options.sessionId) {
      config.sessionId = options.sessionId;
    }
    if (options.projectDir) {
      config.projectDir = options.projectDir;
    }

    // プロジェクトディレクトリからログファイルパスを構築
    const projectDirEncoded = config.projectDir!.replace(/[/_.]/g, '-');
    const claudeProjectsDir = path.join(os.homedir(), '.config', 'claude', 'projects', projectDirEncoded);

    let logFilePath: string;
    
    if (config.sessionId) {
      // セッションIDが指定されている場合
      logFilePath = path.join(claudeProjectsDir, `${config.sessionId}.jsonl`);
    } else {
      // セッションIDが指定されていない場合は最新のファイルを探す
      try {
        const files = fs.readdirSync(claudeProjectsDir)
          .filter(f => f.endsWith('.jsonl'))
          .map(f => ({
            name: f,
            path: path.join(claudeProjectsDir, f),
            mtime: fs.statSync(path.join(claudeProjectsDir, f)).mtime
          }))
          .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

        if (files.length === 0) {
          console.error('ログファイルが見つかりません');
          process.exit(1);
        }

        logFilePath = files[0].path;
        console.log(`最新のセッションを使用: ${files[0].name}`);
      } catch (error) {
        console.error('ログファイルの検索に失敗しました:', error);
        process.exit(1);
      }
    }

    console.log('設定:');
    console.log('- AssistantSeika Host:', `${config.tts.host}:${config.tts.port}`);
    console.log('- Character ID:', config.tts.cid);
    console.log('- Log file:', logFilePath);
    console.log('');

    // AssistantSeikaクライアントを初期化
    const ttsClient = new AssistantSeikaClient({
      host: config.tts.host!,
      port: config.tts.port!,
      username: config.tts.username!,
      password: config.tts.password!,
      cid: config.tts.cid!,
      effects: {
        speed: config.tts.speed,
        volume: config.tts.volume,
        pitch: config.tts.pitch,
        intonation: config.tts.intonation
      },
      emotions: config.tts.emotions,
      tempDir: config.tts.tempDir,
      playCommand: config.tts.playCommand,
      maxTextLength: config.tts.maxTextLength
    });

    // ログウォッチャーを開始
    const watcher = new LogWatcher(logFilePath);
    
    watcher.on('assistantMessage', async (text: string) => {
      console.log('\n--- ゆかりさんの発言 ---');
      console.log(text);
      console.log('------------------------\n');
      
      try {
        await ttsClient.speak(text);
      } catch (error) {
        console.error('読み上げエラー:', error);
      }
    });

    watcher.start();
    console.log('監視を開始しました。Ctrl+Cで終了します。\n');

    // Ctrl+Cで終了
    process.on('SIGINT', () => {
      console.log('\n監視を終了します...');
      watcher.stop();
      process.exit(0);
    });
  });

program
  .command('test')
  .description('テキストを読み上げてAPIの動作確認')
  .argument('<text>', '読み上げるテキスト')
  .action(async (text) => {
    const config = loadConfig();
    const ttsClient = new AssistantSeikaClient({
      host: config.tts.host!,
      port: config.tts.port!,
      username: config.tts.username!,
      password: config.tts.password!,
      cid: config.tts.cid!,
      effects: {
        speed: config.tts.speed,
        volume: config.tts.volume,
        pitch: config.tts.pitch,
        intonation: config.tts.intonation
      },
      emotions: config.tts.emotions,
      tempDir: config.tts.tempDir,
      playCommand: config.tts.playCommand,
      maxTextLength: config.tts.maxTextLength
    });
    
    console.log('読み上げテスト中...');
    console.log('Text:', text);
    console.log('Host:', `${config.tts.host}:${config.tts.port}`);
    console.log('Character ID:', config.tts.cid);
    
    try {
      await ttsClient.speak(text);
      console.log('読み上げ成功！');
    } catch (error) {
      console.error('読み上げ失敗:', error);
      process.exit(1);
    }
  });

program
  .command('config')
  .description('現在の設定を表示')
  .action(() => {
    const config = loadConfig();
    console.log(JSON.stringify(config, null, 2));
  });

program
  .command('avators')
  .description('利用可能な話者一覧を表示')
  .action(async () => {
    const config = loadConfig();
    const ttsClient = new AssistantSeikaClient({
      host: config.tts.host!,
      port: config.tts.port!,
      username: config.tts.username!,
      password: config.tts.password!,
      cid: config.tts.cid!,
    });
    
    try {
      console.log('AssistantSeikaに接続中...');
      const version = await ttsClient.testConnection();
      console.log('接続成功! Version:', version);
      console.log('');
      
      const avators = await ttsClient.getAvators();
      console.log('利用可能な話者:');
      console.log('CID\t名前');
      console.log('---\t----');
      for (const avator of avators) {
        console.log(`${avator.cid}\t${avator.name}`);
      }
    } catch (error) {
      console.error('エラー:', error);
      process.exit(1);
    }
  });

program.parse();
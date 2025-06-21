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
  // AssistantSeika設定
  .option('--host <host>', 'AssistantSeikaのホスト')
  .option('--port <port>', 'AssistantSeikaのポート', parseInt)
  .option('--username <username>', 'AssistantSeikaのユーザー名')
  .option('--password <password>', 'AssistantSeikaのパスワード')
  .option('--cid <cid>', '話者ID (60041: 結月ゆかり)', parseInt)
  // エフェクト設定
  .option('--speed <speed>', '話速 (0.5～2.0)', parseFloat)
  .option('--pitch <pitch>', '高さ (0.5～2.0)', parseFloat)
  .option('--volume <volume>', '音量 (0.0～2.0)', parseFloat)
  .option('--intonation <intonation>', '抑揚 (0.0～2.0)', parseFloat)
  // その他
  .option('--max-text-length <length>', '最大文字数', parseInt)
  .option('--config <path>', '設定ファイルのパス')
  .option('--no-config', '設定ファイルを無視してデフォルト設定を使用')
  .action(async (options) => {
    let config = loadConfig();
    
    // カスタム設定ファイルの読み込み
    if (options.config && fs.existsSync(options.config)) {
      try {
        const customConfig = JSON.parse(fs.readFileSync(options.config, 'utf-8'));
        config = {
          ...config,
          tts: {
            ...config.tts,
            ...customConfig.tts
          },
          sessionId: customConfig.sessionId || config.sessionId,
          projectDir: customConfig.projectDir || config.projectDir
        };
      } catch (error) {
        console.error('設定ファイルの読み込みに失敗しました:', error);
        process.exit(1);
      }
    }
    
    // --no-configオプションの場合はデフォルト設定を使用
    if (options.config === false) {
      config = {
        tts: {
          host: 'localhost',
          port: 7180,
          username: 'SeikaServerUser', 
          password: 'SeikaServerPassword',
          cid: 60041,
          speed: 1.0,
          pitch: 1.0,
          volume: 1.0,
          intonation: 1.0
        },
        projectDir: process.cwd()
      };
    }
    
    // 初回実行時のヘルプ（--no-configでない場合のみ）
    if (options.config !== false && !fs.existsSync('.env') && !fs.existsSync(path.join(os.homedir(), '.config', 'claude-yukari', 'config.json'))) {
      console.log('📝 設定ファイルが見つかりません。デフォルト設定で実行します。');
      console.log('');
      console.log('カスタマイズする場合は以下のいずれかを作成してください：');
      console.log('1. .env ファイル（cp .env.example .env）');
      console.log('2. ~/.config/claude-yukari/config.json');
      console.log('');
    }
    
    // コマンドラインオプションで設定を上書き
    if (options.sessionId) config.sessionId = options.sessionId;
    if (options.projectDir) config.projectDir = options.projectDir;
    if (options.host) config.tts.host = options.host;
    if (options.port) config.tts.port = options.port;
    if (options.username) config.tts.username = options.username;
    if (options.password) config.tts.password = options.password;
    if (options.cid !== undefined) config.tts.cid = options.cid;
    if (options.speed !== undefined) config.tts.speed = options.speed;
    if (options.pitch !== undefined) config.tts.pitch = options.pitch;
    if (options.volume !== undefined) config.tts.volume = options.volume;
    if (options.intonation !== undefined) config.tts.intonation = options.intonation;
    if (options.maxTextLength !== undefined) config.tts.maxTextLength = options.maxTextLength;

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
      } catch (error: any) {
        console.error('読み上げエラー:', error.message || error);
        if (error.cause) {
          console.error('原因:', error.cause);
        }
        if (error.errors) {
          console.error('詳細エラー:', error.errors);
        }
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
  // AssistantSeika設定
  .option('--host <host>', 'AssistantSeikaのホスト')
  .option('--port <port>', 'AssistantSeikaのポート', parseInt)
  .option('--username <username>', 'AssistantSeikaのユーザー名')
  .option('--password <password>', 'AssistantSeikaのパスワード')
  .option('--cid <cid>', '話者ID (60041: 結月ゆかり)', parseInt)
  // エフェクト設定
  .option('--speed <speed>', '話速 (0.5～2.0)', parseFloat)
  .option('--pitch <pitch>', '高さ (0.5～2.0)', parseFloat)
  .option('--volume <volume>', '音量 (0.0～2.0)', parseFloat)
  .option('--intonation <intonation>', '抑揚 (0.0～2.0)', parseFloat)
  // その他
  .option('--max-text-length <length>', '最大文字数', parseInt)
  .option('--config <path>', '設定ファイルのパス')
  .option('--no-config', '設定ファイルを無視してデフォルト設定を使用')
  .action(async (text, options) => {
    let config = loadConfig();
    
    // カスタム設定ファイルの読み込み
    if (options.config && fs.existsSync(options.config)) {
      try {
        const customConfig = JSON.parse(fs.readFileSync(options.config, 'utf-8'));
        config = {
          ...config,
          tts: {
            ...config.tts,
            ...customConfig.tts
          }
        };
      } catch (error) {
        console.error('設定ファイルの読み込みに失敗しました:', error);
        process.exit(1);
      }
    }
    
    // --no-configオプションの場合はデフォルト設定を使用
    if (options.config === false) {
      config = {
        tts: {
          host: 'localhost',
          port: 7180,
          username: 'SeikaServerUser', 
          password: 'SeikaServerPassword',
          cid: 60041,
          speed: 1.0,
          pitch: 1.0,
          volume: 1.0,
          intonation: 1.0
        }
      };
    }
    
    // コマンドラインオプションで設定を上書き
    if (options.host) config.tts.host = options.host;
    if (options.port) config.tts.port = options.port;
    if (options.username) config.tts.username = options.username;
    if (options.password) config.tts.password = options.password;
    if (options.cid !== undefined) config.tts.cid = options.cid;
    if (options.speed !== undefined) config.tts.speed = options.speed;
    if (options.pitch !== undefined) config.tts.pitch = options.pitch;
    if (options.volume !== undefined) config.tts.volume = options.volume;
    if (options.intonation !== undefined) config.tts.intonation = options.intonation;
    if (options.maxTextLength !== undefined) config.tts.maxTextLength = options.maxTextLength;
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
    } catch (error: any) {
      console.error('読み上げ失敗:', error.message || error);
      if (error.cause) {
        console.error('原因:', error.cause);
      }
      if (error.errors) {
        console.error('詳細エラー:', error.errors);
      }
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
  .command('init')
  .description('設定ファイルを作成')
  .action(() => {
    const envExamplePath = path.join(__dirname, '..', '.env.example');
    const envPath = '.env';
    
    if (fs.existsSync(envPath)) {
      console.log('⚠️  .env ファイルは既に存在します。');
      return;
    }
    
    try {
      // .env.example が存在する場合はコピー
      if (fs.existsSync(envExamplePath)) {
        fs.copyFileSync(envExamplePath, envPath);
      } else {
        // 存在しない場合は基本的な内容を作成
        const defaultEnv = `# AssistantSeika設定
SEIKA_HOST=localhost
SEIKA_PORT=7180
SEIKA_USERNAME=SeikaServerUser
SEIKA_PASSWORD=SeikaServerPassword
SEIKA_CID=60041  # 結月ゆかり

# エフェクト設定
SEIKA_SPEED=1.0      # 話速 (0.5～2.0)
SEIKA_PITCH=1.0      # 高さ (0.5～2.0)
SEIKA_VOLUME=1.0     # 音量 (0.0～2.0)
SEIKA_INTONATION=1.0 # 抑揚 (0.0～2.0)

# その他の設定
# SEIKA_MAX_TEXT_LENGTH=100  # 一度に読み上げる最大文字数（デフォルト: 100）
`;
        fs.writeFileSync(envPath, defaultEnv);
      }
      
      console.log('✅ .env ファイルを作成しました。');
      console.log('');
      console.log('次のステップ:');
      console.log('1. .env ファイルを編集して、AssistantSeikaの接続情報を設定');
      console.log('2. claude-yukari test "テスト" で接続確認');
      console.log('3. claude-yukari watch でClaude Codeの監視を開始');
    } catch (error) {
      console.error('❌ ファイルの作成に失敗しました:', error);
    }
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
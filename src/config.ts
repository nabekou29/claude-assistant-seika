import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as dotenv from 'dotenv';

export interface Config {
  tts: {
    // AssistantSeika設定
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    cid?: number;
    
    // エフェクト設定
    speed?: number;
    pitch?: number;
    volume?: number;
    intonation?: number;
    
    // 感情設定
    emotions?: {
      [key: string]: number;
    };
    
    // その他
    tempDir?: string;
    playCommand?: string;
  };
  sessionId?: string;
  projectDir?: string;
}

export function loadConfig(): Config {
  // .envファイルを読み込む
  dotenv.config();

  // デフォルト設定
  const defaultConfig: Config = {
    tts: {
      host: process.env.SEIKA_HOST || 'localhost',
      port: parseInt(process.env.SEIKA_PORT || '7180'),
      username: process.env.SEIKA_USERNAME || 'SeikaServerUser',
      password: process.env.SEIKA_PASSWORD || 'SeikaServerPassword',
      cid: parseInt(process.env.SEIKA_CID || '60041'), // 結月ゆかり
      speed: parseFloat(process.env.SEIKA_SPEED || '1.0'),
      pitch: parseFloat(process.env.SEIKA_PITCH || '1.0'),
      volume: parseFloat(process.env.SEIKA_VOLUME || '1.0'),
      intonation: parseFloat(process.env.SEIKA_INTONATION || '1.0'),
      tempDir: process.env.SEIKA_TEMP_DIR,
      playCommand: process.env.SEIKA_PLAY_COMMAND,
    },
    sessionId: process.env.CLAUDE_SESSION_ID,
    projectDir: process.env.CLAUDE_PROJECT_DIR || process.cwd(),
  };
  
  // 感情設定を環境変数から読み込む
  if (process.env.SEIKA_EMOTIONS) {
    try {
      defaultConfig.tts.emotions = JSON.parse(process.env.SEIKA_EMOTIONS);
    } catch (error) {
      console.warn('Failed to parse SEIKA_EMOTIONS:', error);
    }
  }

  // ユーザー設定ファイルのパス
  const configPaths = [
    path.join(process.cwd(), '.claude-yukari.json'),
    path.join(os.homedir(), '.config', 'claude-yukari', 'config.json'),
  ];

  // 設定ファイルを読み込む
  for (const configPath of configPaths) {
    if (fs.existsSync(configPath)) {
      try {
        const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        return mergeConfig(defaultConfig, fileConfig);
      } catch (error) {
        console.error(`Failed to load config from ${configPath}:`, error);
      }
    }
  }

  return defaultConfig;
}

function mergeConfig(defaultConfig: Config, fileConfig: Partial<Config>): Config {
  return {
    tts: {
      ...defaultConfig.tts,
      ...fileConfig.tts,
    },
    sessionId: fileConfig.sessionId || defaultConfig.sessionId,
    projectDir: fileConfig.projectDir || defaultConfig.projectDir,
  };
}
# Claude with Yukari-san

Claude Codeの会話ログを監視して、AssistantSeika経由で結月ゆかりさんに読み上げてもらうCLIツールです。

## インストール

```bash
npm install
npm run build
npm link  # グローバルにインストール
```

## 設定

### 環境変数

`.env`ファイルを作成して設定できます：

```bash
cp .env.example .env
```

主な設定項目：
- `SEIKA_HOST`: AssistantSeikaのホスト（デフォルト: localhost）
- `SEIKA_PORT`: AssistantSeikaのポート（デフォルト: 7180）
- `SEIKA_USERNAME`: 認証ユーザー名
- `SEIKA_PASSWORD`: 認証パスワード
- `SEIKA_CID`: 使用する話者ID（60041: 結月ゆかり）
- `SEIKA_SPEED`: 話速 (0.5～2.0)
- `SEIKA_PITCH`: 高さ (0.5～2.0)
- `SEIKA_VOLUME`: 音量 (0.0～2.0)
- `SEIKA_INTONATION`: 抑揚 (0.0～2.0)

### 設定ファイル

以下の場所に設定ファイルを配置できます：
- `./.claude-yukari.json`（プロジェクトルート）
- `~/.config/claude-yukari/config.json`（ユーザーホーム）

## 使い方

### 会話ログの監視を開始

```bash
# 最新のセッションを自動的に監視
claude-yukari watch

# セッションIDを指定
claude-yukari watch --session-id <SESSION_ID>

# プロジェクトディレクトリを指定
claude-yukari watch --project-dir /path/to/project
```

### 読み上げテスト

```bash
claude-yukari test "こんにちは、ゆかりです"
```

### 設定の確認

```bash
claude-yukari config
```

### 利用可能な話者一覧

```bash
claude-yukari avators
```

## 開発

```bash
# 開発モード（ホットリロード）
npm run dev watch

# タイプチェック
npm run typecheck

# リント
npm run lint
```
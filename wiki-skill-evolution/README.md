# WikiSkill Evolution Plugin for Hermes Agent

Hermes Agent における **自律進化ループ（Raw/Error → Wiki/Knowledge → Skill）** を実装するプラグインです。  
ツールの実行エラーを自動検知して教訓（ナレッジ）を抽出し、既存のスキル定義（`SKILL.md`）へフィードバック・自動更新を行います。

---

## 🎯 背景とコンセプト

AI エージェントが日々のタスクを実行する中で遭遇するエラー（Python の ImportError、ファイルパスエラー、タイムアウト、権限エラーなど）を無駄にせず、**永続的なスキルやナレッジへと自動昇華（自律進化）** させる仕組みを提供します。

```
[ ツール実行エラー発生 ]
          │
          ▼
┌─────────────────────────────────────────┐
│ Hook: post_tool_call                   │
│ ・エラー内容、対象ツール、時刻を即時収集│
└─────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────┐
│ 自律進化サイクル (run_wiki_skill_evolution) │
│ 1. エラーパターンの分類・教訓抽出       │
│ 2. Wiki/ナレッジへの追記                │
│ 3. 対象スキル (SKILL.md) へのパッチ適用 │
│ 4. ゴールデンタスク検証 (Gating)        │
└─────────────────────────────────────────┘
          │
          ▼
[ 次回以降のセッションで同じエラーを回避 ]
```

---

## 🌟 主な機能

1. **ツールエラーのリアルタイム自動捕捉 (`post_tool_call` フック)**
   - エージェントがツールを実行しエラーが発生した際、エラーメッセージとコンテキストをメモリ内に自動蓄積（直近50件）。
2. **エラー分析と教訓の自動抽出**
   - パス解決（ImportError, FileNotFoundError）、ネットワーク（Timeout）、OS権限（PermissionDenied）などの典型的なエラーパターンを判定し、再発防止の知見を生成。
3. **スキルの自動更新・パッチ適用**
   - `~/.hermes/skills/<skill_name>/SKILL.md`（またはアクティブプロファイルのスキル）へ知見を自動追記。
4. **ドライラン（Dry-Run）対応**
   - 実際にファイルを変更する前に、どのようなパッチが適用されるかをシミュレーション確認可能。

---

## 🛠️ 提供されるツール (Agent Tools)

### `run_wiki_skill_evolution`

自律進化サイクルを実行します。エージェント自身が自律的に呼び出すことも、ユーザーが指示して実行させることも可能です。

| パラメータ | 型 | デフォルト値 | 説明 |
| :--- | :--- | :--- | :--- |
| `skill_name` | string | `"default_skill"` | 進化・更新対象のスキル名 |
| `hours` | integer | `6` | 遡って分析するエラーログの期間（時間） |
| `dry_run` | boolean | `false` | `true` の場合、実際のファイル変更やコミットを行わずパッチ内容のみを出力 |

---

## 📁 ディレクトリ構成

```text
wiki_skill_evolution/
├── __init__.py      # プラグイン登録・エントリポイント
├── main.py          # 自律進化ロジック、エラー分析、スキルパッチ生成
├── plugin.yaml      # プラグインマニフェスト
└── README.md        # 本ドキュメント
```

---

## 🚀 インストールと設定

### 1. プラグインの配置

Hermes Agent のプラグインディレクトリ `~/.hermes/plugins/` に配置します。

```bash
mkdir -p ~/.hermes/plugins

# コピーして配置する場合
cp -r ./wiki_skill_evolution ~/.hermes/plugins/

# またはシンボリックリンクで配置する場合（推奨）
ln -s "$(pwd)/wiki_skill_evolution" ~/.hermes/plugins/wiki_skill_evolution
```

### 2. プロファイルで有効化

使用するプロファイル設定（`~/.hermes/config.yaml` または `~/.hermes/profiles/<profile_name>.yaml`）の `plugins` セクションに追加します：

```yaml
plugins:
  - wiki_skill_evolution
```

### 3. Hermes Agent の再起動

Hermes Agent を再起動するとプラグインが読み込まれ、フックおよび `run_wiki_skill_evolution` ツールが有効になります。

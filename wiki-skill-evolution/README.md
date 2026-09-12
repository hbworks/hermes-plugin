# WikiSkill Evolution Plugin for Hermes Agent

[ English | [日本語](#japanese) ]

An autonomous evolution plugin implementing the **Raw/Error → Wiki/Knowledge → Skill** feedback loop for Hermes Agent.  
Automatically intercepts runtime tool errors, distills actionable lessons, and synthesizes updates directly into skill definitions (`SKILL.md`).

---

## 🎯 Concept & Architecture

Ensures that errors encountered during real-world agent execution (e.g., Python `ImportError`, file path resolution failures, network timeouts, permission issues) are systematically captured and transformed into **permanent, reusable knowledge and enhanced skills**.

```
[ Tool Execution Error Occurs ]
                 │
                 ▼
┌─────────────────────────────────────────┐
│ Hook: post_tool_call                    │
│ ・Captures error message, tool, timestamp│
└─────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│ Evolution Cycle (run_wiki_skill_evolution)│
│ 1. Pattern classification & lesson rules│
│ 2. Distill knowledge into wiki store   │
│ 3. Patch skill definitions (SKILL.md)   │
│ 4. Golden task verification (Gating)    │
└─────────────────────────────────────────┘
                 │
                 ▼
[ Future Sessions Avoid the Same Failure ]
```

---

## 🌟 Key Features

1. **Automatic Error Interception (`post_tool_call` hook)**
   - Listens to tool execution failures across sessions, caching recent errors (up to 50 entries) in memory.
2. **Error Pattern Classification & Distillation**
   - Built-in heuristic rules for path imports, missing files, network timeouts, and OS permissions to formulate concrete prevention patches.
3. **Automated Skill Patching**
   - Automatically injects actionable lessons into `~/.hermes/skills/<skill_name>/SKILL.md` (or the active profile's skill directory).
4. **Dry-Run Mode**
   - Inspect proposed skill modifications and diffs prior to saving or committing changes.

---

## 🛠️ Provided Tools (Agent Tools)

### `run_wiki_skill_evolution`

Triggers the autonomous evolution cycle. Can be invoked directly by the user or triggered autonomously by the agent.

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `skill_name` | string | `"default_skill"` | Name of the skill to evolve |
| `hours` | integer | `6` | Error log lookback window in hours |
| `dry_run` | boolean | `false` | When `true`, returns proposed patches without applying file changes |

---

## 📁 Directory Structure

```text
wiki-skill-evolution/
├── __init__.py      # Plugin registration & entrypoint
├── main.py          # Evolution loop logic, error classifiers, patching
├── plugin.yaml      # Plugin manifest
└── README.md        # Documentation
```

---

## 🚀 Installation & Setup

### 1. Place the Plugin

Install into Hermes Agent's plugin directory `~/.hermes/plugins/`:

```bash
mkdir -p ~/.hermes/plugins

# Option A: Copy
cp -r ./wiki-skill-evolution ~/.hermes/plugins/

# Option B: Symlink (Recommended)
ln -s "$(pwd)/wiki-skill-evolution" ~/.hermes/plugins/wiki-skill-evolution
```

### 2. Enable in Profile Configuration

Add `wiki-skill-evolution` to `~/.hermes/config.yaml` or `~/.hermes/profiles/<profile_name>.yaml`:

```yaml
plugins:
  - wiki-skill-evolution
```

### 3. Restart Hermes Agent

Restart Hermes Agent to activate the hooks and make `run_wiki_skill_evolution` available.

<br>

---
<a id="japanese"></a>

# WikiSkill Evolution Plugin for Hermes Agent (日本語)

[ [English](#wikiskill-evolution-plugin-for-hermes-agent) | 日本語 ]

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
wiki-skill-evolution/
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
cp -r ./wiki-skill-evolution ~/.hermes/plugins/

# またはシンボリックリンクで配置する場合（推奨）
ln -s "$(pwd)/wiki-skill-evolution" ~/.hermes/plugins/wiki-skill-evolution
```

### 2. プロファイルで有効化

使用するプロファイル設定（`~/.hermes/config.yaml` または `~/.hermes/profiles/<profile_name>.yaml`）の `plugins` セクションに追加します：

```yaml
plugins:
  - wiki-skill-evolution
```

### 3. Hermes Agent の再起動

Hermes Agent を再起動するとプラグインが読み込まれ、フックおよび `run_wiki_skill_evolution` ツールが有効になります。

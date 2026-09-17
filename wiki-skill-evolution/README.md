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

## ⚖️ Design Approach: Why Heuristics? (vs Heavy Prompt Evolution)

Unlike heavy prompt evolution frameworks (e.g., DSPy + GEPA in `self-evolution`), WikiSkill Evolution is intentionally built around **deterministic, rule-based heuristics** for immediate runtime self-healing:

- **80% of Real-World Agent Failures are Environmental**:
  In production, agents rarely fail due to subtle prompt nuances; they fail on `ImportError`, incorrect file paths, timeouts, and missing OS permissions.
- **Zero Token Cost & Millisecond Turnaround**:
  Running iterative LLM reflection loops or genetic algorithms for simple environment-level fixes is expensive overkill. WikiSkill patches skills deterministically in milliseconds with **zero LLM API cost**.
- **Deterministic & Safe**:
  Eliminates the regression risks common in probabilistic prompt generation, acting as a lightweight **first-line of defense** for daily operations.

---

## 🌟 Key Features

1. **Automatic Error Interception (`post_tool_call` hook)**
   - Listens to tool execution failures across sessions, caching recent errors (up to 50 entries) in memory and appending them to `~/.hermes/profiles/<profile_name>/logs/evolution_errors.jsonl`.
   - The log is read across restarts for the requested lookback window and rotated at 5 MB (one `.1` backup is retained).
2. **Error Pattern Classification & Distillation**
   - Built-in heuristic rules for path imports, missing files, network timeouts, and OS permissions to formulate concrete prevention patches.
3. **Automated Skill Patching**
   - Automatically injects actionable lessons into `~/.hermes/skills/<skill_name>/SKILL.md` (or the active profile's skill directory).
4. **Dry-Run Mode**
   - Inspect proposed skill modifications and diffs prior to saving or committing changes.
5. **Context-aware Skill Mapping**
   - `git_*` failures target `git_workflow`; Python execution failures target the skill found in the command path when possible.
   - Explicit `skill_name` always takes precedence, with `default_skill` as the final fallback.

---

## 🛠️ Provided Tools (Agent Tools)

### `run_wiki_skill_evolution`

Triggers the autonomous evolution cycle. Can be invoked directly by the user or triggered autonomously by the agent.

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `skill_name` | string | `"default_skill"` | Name of the skill to evolve |
| `hours` | integer | `6` | Error log lookback window in hours |
| `dry_run` | boolean | `false` | When `true`, returns proposed patches without applying file changes |

When `skill_name` is omitted, the plugin infers the target from the error's tool name and command context.

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

### Dependencies and Platform

This plugin has no external Python package dependencies and uses only the Python standard library. Log-file locking uses the standard-library `fcntl` module, so the plugin currently targets POSIX systems such as macOS and Linux.

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

## ⚖️ 設計アプローチ：なぜルールベース（Heuristics）なのか？

公式の `self-evolution`（DSPy + GEPA）のような高度なプロンプト最適化フレームワークに対し、本プラグインは**「Fast-path（即時自己修復）」** に特化して設計されています。

- **現場エラーの8割は環境・実行起因**:
  実務でエージェントがスタックする最大の要因は、プロンプトの微細なニュアンスではなく `ImportError`、パス解決ミス、タイムアウト、権限エラーといった**機械的な環境エラー**です。
- **ミリ秒修復 & APIコストゼロ**:
  これらの定型エラーに対して重いLLM推論ループや遺伝的アルゴリズムを回すのは過剰装備（オーバーキル）です。本プラグインはルールベースで決定論的にパッチを適用するため、**推論API代は一切かからず、エラー発生の瞬間にミリ秒で修復**されます。
- **決定論的で安全（リグレッションなし）**:
  確率的なプロンプト書き換えに伴う「以前動いていたプロンプトの劣化（先祖返り）」リスクがありません。日々の運用を支える**「低コスト・即効性の第1防衛ライン」**として機能します。

---

## 🌟 主な機能

1. **ツールエラーのリアルタイム自動捕捉 (`post_tool_call` フック)**
   - エージェントがツールを実行しエラーが発生した際、エラーメッセージとコンテキストをメモリ（直近50件）と `~/.hermes/profiles/<profile_name>/logs/evolution_errors.jsonl` に保存。
   - 再起動後も指定時間内（既定6時間）のログを読み出し、ログは5MBでローテーション。
2. **エラー分析と教訓の自動抽出**
   - パス解決（ImportError, FileNotFoundError）、ネットワーク（Timeout）、OS権限（PermissionDenied）などの典型的なエラーパターンを判定し、再発防止の知見を生成。
3. **スキルの自動更新・パッチ適用**
   - `~/.hermes/skills/<skill_name>/SKILL.md`（またはアクティブプロファイルのスキル）へ知見を自動追記。
4. **ドライラン（Dry-Run）対応**
   - 実際にファイルを変更する前に、どのようなパッチが適用されるかをシミュレーション確認可能。
5. **コンテキストに基づくスキル自動判定**
   - `git_*` は `git_workflow`、Python実行はコマンド内のスキルパスを優先して対象を判定。
   - `skill_name` の明示指定、該当なしの場合の `default_skill` フォールバックにも対応。

---

## 🛠️ 提供されるツール (Agent Tools)

### `run_wiki_skill_evolution`

自律進化サイクルを実行します。エージェント自身が自律的に呼び出すことも、ユーザーが指示して実行させることも可能です。

| パラメータ | 型 | デフォルト値 | 説明 |
| :--- | :--- | :--- | :--- |
| `skill_name` | string | 自動判定 | 進化・更新対象のスキル名。省略時はツール名・実行コマンドから判定 |
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

### 依存関係と対応OS

外部Pythonパッケージへの依存はなく、Python標準ライブラリのみで動作します。ログファイルのロックには標準ライブラリの `fcntl` を使用するため、現時点ではmacOSやLinuxなどのPOSIX系OSを対象とします。

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

# WikiSkill Evolution Plugin for Hermes Agent

[ English | [日本語](#japanese) ]

An autonomous evolution plugin for Hermes Agent. It records failed tool calls, extracts lessons from known error patterns with fixed rules, and — when `run_wiki_skill_evolution` is called — adds those lessons to skill definitions (`SKILL.md`).  
The plugin does not write to a wiki and does not change skills at the moment an error occurs.

---

## 🎯 Concept & Architecture

Ensures that errors encountered during real-world agent execution (e.g., Python `ImportError`, file path resolution failures, network timeouts, permission issues) are systematically captured and transformed into **permanent, reusable knowledge and enhanced skills**.

```
[ Tool Execution Error Occurs ]
                 │
                 ▼
┌─────────────────────────────────────────┐
│ Hook: post_tool_call                    │
│ ・Records error text, tool, skill, time │
│   (credentials masked; no raw args)     │
└─────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│ Evolution Cycle (run_wiki_skill_evolution)│
│ 1. Rule-based lesson extraction         │
│ 2. Patch skill definitions (SKILL.md)   │
│ 3. Hermes frontmatter check + gating    │
│ 4. Optional Git commit (commit=true)    │
└─────────────────────────────────────────┘
                 │
                 ▼
[ Later Sessions Read the Updated Skill ]
```

---

## ⚖️ Design Approach: Why Heuristics? (vs Heavy Prompt Evolution)

Unlike heavy prompt evolution frameworks (e.g., DSPy + GEPA in `self-evolution`), WikiSkill Evolution is intentionally built around **deterministic, rule-based heuristics** for the errors it can recognize:

- **Many Real-World Agent Failures are Environmental**:
  Agents often fail on `ImportError`, incorrect file paths, timeouts, and missing OS permissions. The rules cover these and a few Hermes skill-format errors.
- **No LLM Cost for Lesson Extraction**:
  Rule matching uses no LLM calls. Errors the rules do not recognize are recorded but never turned into skill text.
- **Deterministic & Gated**:
  Skill changes are checked against Hermes' own frontmatter rules and a section gate before they are kept.

---

## 🌟 Key Features

1. **Error Recording (`post_tool_call` hook)**
   - Records failed tool calls. Each record keeps the error text (with credentials masked), the tool name, and the resolved skill name. Raw tool arguments are **not** stored.
   - Stored per Hermes profile in `<profile home>/logs/evolution_errors.jsonl`, where the profile home is the one Hermes assigns to the call (`hermes_constants.get_hermes_home()`).
   - The log is created owner-only (`0600`, directory `0700`), read back across restarts for the lookback window, and rotated at 5 MB (one `.1` backup is kept).
2. **Rule-based Lesson Extraction**
   - Built-in rules for missing modules, missing files, timeouts, permission errors, `patch` match failures, Hermes skill-format errors, and non-zero terminal exits.
   - Non-zero exits are judged on the exit number Hermes reports (`exit 2`, or `終了コード 2` in the Japanese locale). Informational exits such as `git diff` / `diff` / `grep` returning 1 are not treated as failures.
3. **Skill Update (on `run_wiki_skill_evolution` only)**
   - Lessons are applied when the tool is called, not at the moment an error occurs. Nothing is written to a wiki.
   - Existing skills get the lesson appended to a supported section (or a new `## Pitfalls & Lessons` section).
   - A new skill is generated with valid `name` / `description` frontmatter. It is written only after Hermes' own `skill_manage` frontmatter check passes.
   - Gating checks the result against that same frontmatter check and requires a supported section. A failed gate restores the previous bytes (or removes a newly created skill).
   - Writes never go through a symlink, and a path that resolves outside the profile's `skills/` directory is refused.
4. **Dry-Run Mode**
   - `dry_run: true` reports what would change without writing any file.
5. **Opt-in Git Commit**
   - With `commit: true`, a successful change is committed. A new skill becomes its own Git repository. For an existing skill, the commit happens only if the skill directory is the root of its own repository; otherwise the change is left uncommitted and reported as such.
   - The default is `commit: false`: files are written and nothing is committed.
6. **Context-aware Skill Mapping**
   - `git_*` failures target `git_workflow`; Python execution failures target the skill found in the command path when possible.
   - Explicit `skill_name` always takes precedence. Otherwise the target comes from the most recent error, and `default_skill` is the final fallback.

---

## 🛠️ Provided Tools (Agent Tools)

### `run_wiki_skill_evolution`

Triggers the evolution cycle. Can be invoked directly by the user or triggered by the agent.

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `skill_name` | string | inferred from the latest error | Name of the skill to evolve |
| `hours` | integer | `6` | Error log lookback window in hours |
| `dry_run` | boolean | `false` | When `true`, reports the proposed change and writes nothing |
| `commit` | boolean | `false` | When `true`, commits the change to Git after gating passes |

When `skill_name` is omitted, the plugin infers the target from the most recent recorded error's tool name and command context.

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

Hermes Agent における **ツール実行エラーの記録と、ルールに基づくスキル改善** を行うプラグインです。  
ツールの実行エラーを記録し、既知のエラーパターンから固定ルールで教訓を抽出します。`run_wiki_skill_evolution` を呼んだときに、その教訓を既存のスキル定義（`SKILL.md`）へ追記します。  
Wiki への書き込みは行わず、エラー発生の瞬間にスキルを変更することもありません。

---

## 🎯 背景とコンセプト

AI エージェントが日々のタスクを実行する中で起きるエラー（Python の ImportError、ファイルパスエラー、タイムアウト、権限エラーなど）を記録し、既知のパターンに当たるものについてスキルへ改善を反映します。

```
[ ツール実行エラー発生 ]
          │
          ▼
┌─────────────────────────────────────────┐
│ Hook: post_tool_call                    │
│ ・エラー内容・ツール・スキル・時刻を記録│
│   （秘密値はマスク、生の引数は保存しない）│
└─────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────┐
│ 自律進化サイクル (run_wiki_skill_evolution) │
│ 1. ルールに基づく教訓抽出               │
│ 2. 対象スキル (SKILL.md) へのパッチ適用 │
│ 3. Hermes の形式検査 + Gating           │
│ 4. 任意で Git コミット (commit=true)    │
└─────────────────────────────────────────┘
          │
          ▼
[ 以降のセッションで更新済みのスキルを読む ]
```

---

## ⚖️ 設計アプローチ：なぜルールベース（Heuristics）なのか？

公式の `self-evolution`（DSPy + GEPA）のような高度なプロンプト最適化フレームワークに対し、本プラグインは**認識できるエラーに対して決定論的にスキルを更新する**ことに絞って設計されています。

- **環境起因のエラーが多い**:
  `ImportError`、パス解決ミス、タイムアウト、権限エラーといった機械的なエラーを対象にしています。Hermes のスキル形式エラーと終了コードも扱います。
- **教訓の抽出に LLM を使わない**:
  ルール照合に LLM 呼び出しはありません。ルールに当たらないエラーは記録されますが、スキル文面にはなりません。
- **決定論的で検査付き**:
  スキルの変更は Hermes 自身の frontmatter 検査と、セクションの Gating を通ったものだけを残します。

---

## 🌟 主な機能

1. **エラーの記録 (`post_tool_call` フック)**
   - 失敗したツール呼び出しを記録します。エラー本文（秘密値はマスク）、ツール名、判定したスキル名を保存し、**生の引数は保存しません**。
   - 保存先は Hermes がその呼び出しに割り当てたプロファイルのホーム（`hermes_constants.get_hermes_home()`）配下の `logs/evolution_errors.jsonl` です。プロファイルごとに分かれます。
   - ログは所有者のみ読み書き（ファイル `0600`、ディレクトリ `0700`）で作成し、再起動後も指定時間内のログを読み出します。5MB でローテーションし、`.1` を 1 世代残します。
2. **ルールに基づく教訓の抽出**
   - ライブラリ不足、ファイル不在、タイムアウト、権限エラー、`patch` の一致失敗、Hermes のスキル形式エラー、terminal の非ゼロ終了に対するルールを持ちます。
   - 非ゼロ終了は、Hermes が報告する終了コード（英語 `exit 2`、日本語ロケール `終了コード 2`）で判定します。`git diff` / `diff` / `grep` が 1 を返す情報的な終了は失敗として扱いません。
3. **スキルの更新（`run_wiki_skill_evolution` 実行時のみ）**
   - 教訓は、エラーが起きた瞬間ではなくツールを呼んだときに反映します。Wiki への書き込みは行いません。
   - 既存スキルには、対応するセクション（無ければ新規の `## Pitfalls & Lessons`）へ教訓を追記します。
   - 新規スキルは `name` / `description` を持つ有効な frontmatter で生成し、Hermes 自身の `skill_manage` の形式検査を通った場合にだけ書き込みます。
   - Gating も同じ frontmatter 検査と、対応セクションの有無で判定します。失敗した場合は元のバイト列に戻し、新規作成したスキルは削除します。
   - symlink を経由した書き込みは行わず、プロファイルの `skills/` の外へ解決されるパスは拒否します。
4. **ドライラン（Dry-Run）**
   - `dry_run: true` のときは、どのような変更になるかを報告するだけで、ファイルは書き込みません。
5. **任意の Git コミット（opt-in）**
   - `commit: true` のときだけ、成功した変更をコミットします。新規スキルは専用の Git リポジトリとして初期化されます。既存スキルは、そのスキルディレクトリ自体がリポジトリのルートである場合にだけコミットし、そうでなければ未コミットのまま報告します。
   - 既定は `commit: false` で、ファイルは書き込むがコミットはしません。
6. **コンテキストに基づくスキル自動判定**
   - `git_*` は `git_workflow`、Python 実行はコマンド内のスキルパスを優先して判定します。
   - `skill_name` の明示指定が常に優先されます。指定が無いときは直近のエラーから判定し、それも無理なら `default_skill` にフォールバックします。

---

## 🛠️ 提供されるツール (Agent Tools)

### `run_wiki_skill_evolution`

進化サイクルを実行します。ユーザーが指示して実行させることも、エージェントが呼び出すことも可能です。

| パラメータ | 型 | デフォルト値 | 説明 |
| :--- | :--- | :--- | :--- |
| `skill_name` | string | 直近のエラーから判定 | 進化・更新対象のスキル名。省略時は直近の記録されたエラーのツール名・実行コマンドから判定 |
| `hours` | integer | `6` | 遡って分析するエラーログの期間（時間） |
| `dry_run` | boolean | `false` | `true` の場合、変更内容を報告するだけで、ファイルを書き込まない |
| `commit` | boolean | `false` | `true` の場合、Gating 成功後に変更を Git コミットする |

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

# WikiSkill Compiler プラグイン仕様書 (Specification)

## 1. 概要と背景 (Overview & Motivation)

### 1.1 背景
Hermes Agent の自己進化において、リアルタイムに動作する `wiki-skill-evolution`（Fast-path）は、ツールエラーをミリ秒・API コストゼロで即時パッチする第 1 防衛ラインとして機能します。  
しかし、長期間運用すると以下の課題が生じます：
1. **ルールの外にある複雑な未知エラー**（推論ミス、複数ツールの複合シーケンス失敗など）が学習されない。
2. スキル定義（`SKILL.md`）の末尾に箇条書き（`- xxxに注意する`）がつぎはぎで蓄積され、プロンプトが肥大化・劣化する。
3. Google Research の元論文 **WikiSkill (arXiv:2608.27454)** が提唱した**「Wiki（永続知識）の複利蓄積」**が実現できていない。

### 1.2 目的
本プラグイン `wiki-skill-compiler`（Slow-path）は、日中の対話・実行を妨げない**オフライン／バックグラウンド専門のコンパイラ**として動作します。  
専用に指定した**ローカル LLM（Ollama / HAI 等）**を直接駆動し、エラーログから根本原因を「Wiki ナレッジ」へ蒸留し、つぎはぎになった `SKILL.md` を洗練されたプロンプトへとリファクタリング（再編）します。

---

## 2. 2-Speed 協調アーキテクチャ (Architecture Overview)

2 つのプラグインがファイルシステム（ログとスキルディレクトリ）を介して疎結合に連携します。

```text
┌────────────────────────────────────────────────────────────────────────┐
│ [日中・リアルタイム] wiki-skill-evolution (Fast-path / 常駐型)          │
│ ・フック: post_tool_call によるエラー捕捉                              │
│ ・既知エラー: ルールベースで即時パッチ (ミリ秒・API代ゼロ)            │
│ ・出力: profiles/<profile>/logs/evolution_errors.jsonl (秘密値マスク済)│
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼ (ログファイルを介した疎結合)
┌────────────────────────────────────────────────────────────────────────┐
│ [夜間・オフライン] wiki-skill-compiler (Slow-path / バッチ型)            │
│ ・フックなし (ツール呼び出し時のみ起動)                                │
│ ・モデル: ローカル LLM 専用 (Ollama 等の独立エンドポイント直結)        │
│                                                                        │
│ 1. Raw 収集   : evolution_errors.jsonl の未知・反復エラーを集計       │
│ 2. Wiki 蒸留  : ローカル LLM が patterns を references/wiki.md に追記 │
│                 ★ この Wiki は絶対にロールバックしない (複利蓄積)      │
│ 3. Skill 清書 : Wiki をもとに SKILL.md をリファクタリング (プロンプト整理) │
│ 4. Gating     : Hermes frontmatter 検査 ＆ 自動ロールバック            │
└────────────────────────────────────────────────────────────────────────┘
```

### 論文の重要知見の具現化（Wiki 隔離）
論文のアブレーション実験（Gemini-3.5-Flash 等）により、**「Wiki を日中の推論エージェントに見せるとコンテキスト圧迫で精度低下 (-2.8 pp)、改善役 (Proposer) にのみ見せるのが最善 (+15.0 pp)」** であることが判明しています。

Hermes では、エージェントが実行時にプロンプトとして読み込むのは `SKILL.md` のみであり、`references/` 配下は明示要求がない限りコンテキストに入りません。  
Wiki ナレッジを `references/wiki.md` に格納することで、**設定やコードによる複雑なコンテキスト隠蔽を行わずとも、自然に論文の最適構成が実現**します。

---

## 3. ディレクトリ・ファイル構成 (File Structure)

```text
wiki-skill-compiler/
├── plugin.yaml              # プラグインマニフェスト
├── __init__.py              # プラグイン登録・エントリポイント
├── main.py                  # コンパイルパイプライン実装 (ローカルLLM呼び出し、Gating)
├── prompts.py               # Wiki Maintainer & Skill Proposer 用プロンプト定義
├── README.md                # ユーザー向けドキュメント
└── tests/                   # ユニットテスト (モックLLMによる検証)
```

対象スキルのファイル配置（Hermes プロファイル配下）：
```text
~/.hermes/profiles/<profile>/
├── logs/
│   └── evolution_errors.jsonl       # 【Raw層】生エラーログ（不変）
└── skills/<category>/<skill>/
    ├── SKILL.md                     # 【Skill層】推論エージェント用プロンプト（清書対象）
    └── references/
        └── wiki.md                  # 【Wiki層】永続ナレッジベース（ロールバック不可）
```

---

## 4. プラグイン設定仕様 (`plugin.yaml` & `config.yaml`)

### 4.1 プラグインマニフェスト (`plugin.yaml`)
```yaml
name: wiki-skill-compiler
version: "1.0.0"
description: >
  ローカル LLM を用いた WikiSkill オフライン進化コンパイラ。
  エラーログから永続ナレッジ (Wiki) を蒸留し、SKILL.md をリファクタリングします。
author: masato
provides_tools:
  - compile_wiki_skills
provides_hooks: []  # フックは一切持たず、日中の Hermes 実行を阻害しない
```

### 4.2 Hermes 設定 (`~/.hermes/config.yaml` またはプロファイル設定)
日常の対話モデル（Nous, Claude, Gemini 等）とは完全に切り離し、専用エンドポイントを定義します。

```yaml
plugins:
  - wiki-skill-evolution
  - wiki-skill-compiler

wiki_skill_compiler:
  # ローカル LLM の OpenAI 互換エンドポイント (Ollama, vLLM, HAI 等)
  base_url: "http://localhost:11434/v1"
  model: "qwen2.5-coder:14b"
  timeout_seconds: 600
  # 1回の実行で処理するエラーログの最大件数
  max_errors_per_run: 50
  # Gating 成功時に自動 Git コミットを行うか
  auto_commit: false
```

---

## 5. 提供ツール仕様 (`compile_wiki_skills`)

### 5.1 ツール定義 (Agent Tool Schema)
```json
{
  "name": "compile_wiki_skills",
  "description": "Trigger offline WikiSkill compilation using a local LLM: distills lessons into references/wiki.md and refactors SKILL.md.",
  "parameters": {
    "type": "object",
    "properties": {
      "skill_name": {
        "type": "string",
        "description": "Target skill to compile. If omitted or 'all', compiles all skills that have recent errors."
      },
      "hours": {
        "type": "integer",
        "description": "Lookback window in hours for error logs (default: 24).",
        "default": 24
      },
      "dry_run": {
        "type": "boolean",
        "description": "If true, simulates the compilation and outputs diffs without modifying files.",
        "default": false
      },
      "commit": {
        "type": "boolean",
        "description": "If true, commits the updated SKILL.md to Git after gating passes.",
        "default": false
      }
    }
  }
}
```

---

## 6. パイプライン詳細フロー (Pipeline Execution Flow)

`compile_wiki_skills` が呼び出された際の処理フローは以下の 4 ステージです。

```text
[ 開始 ]
   │
   ▼
【Stage 1: エラー収集とトリアージ】
・profile/logs/evolution_errors.jsonl から指定時間（hours）のログを読み出す
・対象スキルごとにエラーをグルーピング
・既知の定型エラーだけでなく、Fast-path でスキップされた未知エラーもすべて対象
   │
   ▼
【Stage 2: Wiki Maintainer (知識の蒸留)】
・対象スキルの既存 `references/wiki.md` と直近のエラー群をローカル LLM に入力
・新規パターン、根本原因、環境要因、解決手順を抽出
・`references/wiki.md` に構造化 Markdown として追記
★ 重要: この書き込みはコミット／ロールバックの対象外とし、永続保持する
   │
   ▼
【Stage 3: Skill Proposer (プロンプトの清書・再編)】
・現行の `SKILL.md` と、更新後の `references/wiki.md` をローカル LLM に入力
・箇条書きの重複や肥大化を統合し、簡潔で洗練されたワークフローにリファクタリング
・Hermes の規約（YAML frontmatter、先頭57文字のトリガー）を厳密に維持
   │
   ▼
【Stage 4: Gating 検証 ＆ ロールバック】
・Hermes 公式 validator（`_validate_frontmatter`）による構文・文字数チェック
・必須セクション（## Workflow / ## 実行手順 等）の存在確認
├─ [合格] SKILL.md を更新 (commit=true の場合は Git コミット)
└─ [不合格] SKILL.md を直前の状態にロールバック (wiki.md は残る)
```

---

## 7. LLM プロンプト設計 (Prompts Specification)

外部ライブラリに頼らず、標準の Python `urllib.request` または軽量クライアントから叩けるプロンプトを定義します。

### 7.1 Wiki Maintainer プロンプト
```markdown
You are a Senior Software Knowledge Architect acting as the Wiki Maintainer.
Analyze the following tool execution failure logs for skill "{skill_name}".

## Current Persistent Wiki ({wiki_path}):
{existing_wiki_content}

## Recent Error Logs:
{error_logs}

## Task:
Identify recurrent patterns, root causes, and robust preventative measures.
Synthesize new insights and append them to the Knowledge Wiki.
Do NOT delete existing valid knowledge; consolidate and append.

## Output Format:
Markdown format containing:
### Pattern: [Pattern Name]
- **Symptoms / Error Signatures**: ...
- **Root Cause**: ...
- **Resolution / Prevention**: ...
```

### 7.2 Skill Proposer プロンプト
```markdown
You are an Expert Prompt Engineer and Skill Architect acting as the Skill Proposer.
Refactor the agent skill definition (`SKILL.md`) using the updated Persistent Wiki.

## Target Skill: {skill_name}

## Current SKILL.md:
{current_skill_content}

## Knowledge Wiki (references/wiki.md):
{wiki_content}

## Strict Constraints:
1. Preserve the YAML frontmatter exactly, including the self-contained trigger in the first 57 characters of `description`.
2. Consolidate fragmented bullet points and ad-hoc patches into clean, structured instructions.
3. Keep the prompt concise, authoritative, and actionable. Do not bloat context unnecessarily.
4. Output ONLY the complete updated SKILL.md file content.
```

---

## 8. 安全性・フェイルセーフ設計 (Security & Safety)

1. **二重クレデンシャルマスキング**:
   - `evolution_errors.jsonl` はすでに Fast-path 側でマスクされていますが、ローカル LLM に送信する直前にも正規表現で二重チェックを実施。
2. **パストラバーサル防御**:
   - `references/wiki.md` および `SKILL.md` の読み書きは、対象スキルのディレクトリ境界（`~/.hermes/profiles/<profile>/skills/`）内に厳密に限定。シンボリックリンク経由の脱出を遮断。
3. **独立ロールバックの保証（最重要）**:
   - `SKILL.md` の Gating 失敗時、`SKILL.md` は以前のバイト列に完全復帰しますが、`references/wiki.md` の追記内容は**決して破棄しません**。次回のコンパイル時にその知識が再活用されます。
4. **非侵襲性**:
   - フックを持たないため、日常の会話でエージェントが思考・ツール実行する際のレイテンシ増加は 0 ミリ秒です。

---

## 9. 運用方法 (Operations & Automation)

### 9.1 手動実行
日中の作業終了時や、特定のスキルを磨きたい場合にエージェントまたは人間が実行：
```text
compile_wiki_skills(skill_name="my-research-skill", hours=24, dry_run=true)
```

### 9.2 Hermes cron による完全自動化
深夜 3:00 に自動起動し、前日のエラーから知識を蒸留して翌朝に備える：
```yaml
# ~/.hermes/cron/wiki_compiler.yaml
schedule: "0 3 * * *"
command: "run compile_wiki_skills(hours=24, commit=true)"
```

---

## 10. まとめ

| 観点 | `wiki-skill-evolution` (Fast-path) | `wiki-skill-compiler` (Slow-path) |
| :--- | :--- | :--- |
| **起動契機** | エラー発生時（リアルタイム） | 深夜 cron / 手動バッチ |
| **処理時間** | 1〜5 ミリ秒 | 数十秒〜数分 |
| **エンジン** | 正規表現・固定ルール | ローカル LLM (Ollama 等) |
| **API コスト** | **0 円** | **0 円** (ローカル推論) |
| **責務** | クラッシュ防止の応急手当 | 知識の永続蓄積 ＆ プロンプト清書 |
| **成果物** | `SKILL.md` への暫定追記 | `references/wiki.md` ＋ 洗練された `SKILL.md` |

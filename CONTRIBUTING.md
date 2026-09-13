# Contributing to Hermes Plugin / コントリビューションガイド

[ [English](#english) | [日本語](#japanese) ]

---

<a id="japanese"></a>
## 日本語

Hermes Plugin コレクションへのコントリビューションをご検討いただきありがとうございます！  
本プロジェクトは、運用の安定性と依存関係トラブルのゼロ化を最重視しています。PR（プルリクエスト）やIssueを作成する前に、以下の最低限のルールをご確認ください。

### 1. 設計原則（必須）
新しいプラグインの追加や既存コードの改修を行う際は、以下の設計思想を厳守してください：

- **ゼロ外部依存（Zero External Dependencies / Python標準ライブラリ限定）**
  - Agentプラグイン（Python）は、**Python標準ライブラリ（`sqlite3`, `re`, `urllib`, `dataclasses` など）のみ** で実装してください。
  - サードパーティの `pip` パッケージを追加するPRは、特別な理由がない限りマージされません。
- **軽量・高速かつ決定論的な処理**
  - 不必要なLLM呼び出しや重いアルゴリズムを避け、ルールベースや効率的なロジックを優先してください。
- **Desktopプラグイン（JavaScript）**
  - Hermes Desktopプラグインは標準の ES Modules (ESM) で記述し、不要なビルドステップを増やさないようにしてください。

### 2. ローカルでのテスト実行
既存のテストを壊していないか、追加したコードにテストがあるかを確認してください。外部ツール（pytest等）のインストールは不要で、標準の `unittest` で実行できます。

```bash
# Credential Safety のテスト
python3 -m unittest discover -s credential-safety/tests

# SQLite Memory のテスト
python3 -m unittest discover -s sqlite-memory/tests

# WikiSkill Evolution のテスト
python3 -m unittest discover -s wiki-skill-evolution/tests

# 全テストを一括実行
python3 -m unittest discover -s credential-safety/tests && \
python3 -m unittest discover -s sqlite-memory/tests && \
python3 -m unittest discover -s wiki-skill-evolution/tests
```

### 3. プルリクエスト（PR）の流れ
1. リポジトリをフォークし、フィーチャーブランチ（例: `feature/new-pattern` や `fix/redaction-boundary`）を作成します。
2. 変更をコミットし、上記の単体テストがすべて `OK` で通ることを確認します。
3. PRを作成し、変更内容・動機・動作確認結果を簡潔に記載してください。

---

<a id="english"></a>
## English

Thank you for your interest in contributing to the Hermes Plugin collection!  
We prioritize production reliability and zero maintenance overhead. Please review these essential guidelines before submitting PRs or issues.

### 1. Core Principles (Required)
When adding plugins or modifying code, adhere strictly to our design philosophy:

- **Zero External Dependencies (Python stdlib First)**
  - Agent plugins must rely **only on the Python standard library** (`sqlite3`, `re`, `urllib`, `dataclasses`, etc.).
  - PRs introducing third-party `pip` dependencies will generally not be accepted.
- **Fast-path & Deterministic Reliability**
  - Favor lightweight, rule-based heuristics over unnecessary LLM calls or bloated algorithms.
- **Desktop Plugins (JavaScript)**
  - Write clean ES Modules (ESM) without adding heavy build pipelines.

### 2. Running Tests
Verify your changes do not break existing functionality. All tests run via Python's built-in `unittest` (no pip installs needed):

```bash
# Credential Safety tests
python3 -m unittest discover -s credential-safety/tests

# SQLite Memory tests
python3 -m unittest discover -s sqlite-memory/tests

# WikiSkill Evolution tests
python3 -m unittest discover -s wiki-skill-evolution/tests

# Run all test suites
python3 -m unittest discover -s credential-safety/tests && \
python3 -m unittest discover -s sqlite-memory/tests && \
python3 -m unittest discover -s wiki-skill-evolution/tests
```

### 3. Submitting a Pull Request
1. Fork the repo and create a branch (e.g. `feature/my-enhancement`).
2. Commit your changes and ensure all tests pass.
3. Open a PR with a concise description of changes and motivations.

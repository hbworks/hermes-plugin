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

### 3. Hermes Agent 現行フレームワークの検証

2026年9月16日以降の Hermes Agent では、`hermes plugins validate` がロード可能なエントリポイント、Python依存宣言、インストール時セキュリティスキャンまで検証します。現行の Agent プラグインは標準ライブラリのみで動作するため、`python_dependencies` や `pyproject.toml` の依存宣言は追加していません。外部依存を導入する場合は、マニフェストの `python_dependencies`（または `pyproject.toml` の `[project].dependencies`）に PEP 508 形式で明示してください。

```bash
for plugin in credential-safety sqlite-memory wiki-skill-evolution; do
  hermes plugins validate "./$plugin"
  hermes plugins doctor --ci "./$plugin"
  hermes plugins compat "./$plugin"
done

node --check preview-language-override/plugin.js
node --test preview-language-override/tests/plugin-lifecycle.test.mjs
```

`credential-safety` の検証では、検出用テストフィクスチャにより security scan が `caution` を報告する場合がありますが、検証自体が成功していることを確認してください。`dangerous` や `doctor --ci` の失敗は無視せず、実際のコード・ドキュメントに秘密情報がないか修正します。Standalone Desktop プラグインには Agent 用 `plugin.yaml` がないため、`validate`/`doctor` の対象にせず、Node.js の構文・回帰テストを実行します。

### 4. プルリクエスト（PR）の流れ
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

### 3. Verifying against the current Hermes Agent plugin framework

Since the September 16, 2026 Hermes Agent update, `hermes plugins validate` also checks loadable entrypoints, declared Python dependencies, and the install-time security scan. The Agent plugins in this repository intentionally remain standard-library-only, so they do not declare `python_dependencies` or a `pyproject.toml` dependency list. If a third-party dependency is introduced, declare it as a PEP 508 requirement in `python_dependencies` (or `[project].dependencies` in `pyproject.toml`).

```bash
for plugin in credential-safety sqlite-memory wiki-skill-evolution; do
  hermes plugins validate "./$plugin"
  hermes plugins doctor --ci "./$plugin"
  hermes plugins compat "./$plugin"
done

node --check preview-language-override/plugin.js
node --test preview-language-override/tests/plugin-lifecycle.test.mjs
```

`credential-safety` may report a `caution` security-scan warning because its test fixtures intentionally contain token-shaped samples; the validation must still pass. Do not ignore a `dangerous` verdict or a failing `doctor --ci`; remove real secrets and address the reported code or documentation. Standalone Desktop plugins do not need an Agent `plugin.yaml`, so validate them with the Node.js syntax and regression checks above instead.

### 4. Submitting a Pull Request
1. Fork the repo and create a branch (e.g. `feature/my-enhancement`).
2. Commit your changes and ensure all tests pass.
3. Open a PR with a concise description of changes and motivations.

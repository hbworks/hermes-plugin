# Hermes Plugin Collection

[ English | [日本語](#japanese) ]

A collection of feature plugins for the Hermes AI Agent ([Hermes Agent](https://github.com/NousResearch/hermes-agent)) and the **Hermes Desktop** client.  
Providing production-grade enhancements for security (credential redaction), backend concurrency and slot management, real-time activity monitoring, persistent memory, and autonomous skill evolution.

---

## 💡 Design Philosophy

Rather than chasing an exhaustive list of features or unnecessary algorithmic complexity, plugins in this repository are built with a laser focus on **production reliability, zero maintenance overhead, and immediate real-world impact**.

1. **Zero External Dependencies (Python stdlib First)**
   - All Agent plugins rely strictly on the standard Python library (`sqlite3`, `re`, `urllib`, `dataclasses`, etc.).
   - Eliminates dependency hell, pip package conflicts, and security vulnerabilities introduced by bloated supply chains. Works right out of the box.
2. **Core Essentials Focused**
   - Instead of 20+ peripheral plugins that clutter the environment, we concentrate exclusively on solving the fatal pain points every Hermes operator encounters: credential exposure, desktop profile-switch lockups, and heavyweight DB overhead.
3. **Fast-path & Deterministic Reliability**
   - We prioritize fast, predictable, rule-based heuristics over expensive multi-turn LLM loops for routine operational tasks. Fixes run in milliseconds with **zero token cost**.
4. **Defense in Depth at the I/O Boundary**
   - Credential Safety doesn't just match known token formats (what `core/redact.py` does). It catches **natural-language meta-discussion** — when an agent says *"I changed the password from `sk-abc...` to `sk-xyz...`"* — using Shannon entropy analysis, character-class verification, and placeholder detection to avoid false positives. This directly solves the systemic failure reported in [GitHub Issue #20785](https://github.com/NousResearch/hermes-agent/issues/20785) where the core redactor's regex-only approach consistently misses secrets embedded in explanations.
5. **Transparent Observability over Black-box Evolution**
   - Where others use opaque DSPy+GEPA pipelines (offline, GPU-heavy, hours-long), our WikiSkill Evolution provides **instant, deterministic, auditable** skill patches triggered by real tool errors — no LLM calls, no token cost, full git traceability.

---

## 📦 Available Plugins

| Plugin | Target Environment | Language | Description | Documentation |
| :--- | :--- | :--- | :--- | :--- |
| **[Agent Active Manager](./agent-active-manager/)** | Hermes Desktop | JS (ESM) | Optimizes backend slot limits and inference states to eliminate profile-switch timeouts | [Read README](./agent-active-manager/README.md) |
| **[Agent Activity Monitor](./agent-monitor/)** | Hermes Desktop | JS (ESM) | Real-time visualizer and event monitor for agent inference, tool runs, and gateway events | [Read README](./agent-monitor/README.md) |
| **[Credential Safety](./credential-safety/)** | Hermes Agent | Python | Multi-layer secret redaction across tools, LLMs, and terminal logs with offline DB/log auditing | [Read README](./credential-safety/README.md) |
| **[SQLite Memory](./sqlite-memory/)** | Hermes Agent / Desktop | Python / JS | Zero-dependency SQLite FTS5 long-term memory with automatic recall. Bundles Web API & Desktop GUI (Unified Package) | [Read README](./sqlite-memory/README.md) |
| **[WikiSkill Evolution](./wiki-skill-evolution/)** | Hermes Agent | Python | Autonomous evolution loop capturing tool errors and distilling lessons into skills (`SKILL.md`) | [Read README](./wiki-skill-evolution/README.md) |

---

## 🧩 Plugin Types & Installation Targets

Plugins in this repository are divided into **Hermes Desktop Plugins (UI extensions)** and **Hermes Agent Plugins (Core / Python extensions)**.

```
hermes-plugin/
├── [Hermes Desktop Plugins] (UI / JavaScript ESM)
│   ├── agent-active-manager/  ──> ~/.hermes/desktop-plugins/agent-active-manager/
│   └── agent-monitor/         ──> ~/.hermes/desktop-plugins/agent-monitor/
│
└── [Hermes Agent Plugins] (Backend / Python)
    ├── credential-safety/     ──> ~/.hermes/plugins/credential-safety/
    ├── sqlite-memory/         ──> ~/.hermes/plugins/sqlite-memory/ (Unified Package: Desktop GUI bundled)
    └── wiki-skill-evolution/  ──> ~/.hermes/plugins/wiki-skill-evolution/
```

---

## 🚀 Quick Start Guide

Using **symbolic links** is recommended for easy development and keeping plugins up to date.

### 1. Hermes Desktop Plugins

The desktop plugins directory is `~/.hermes/desktop-plugins/`.

```bash
mkdir -p ~/.hermes/desktop-plugins

# Install Agent Active Manager
ln -s "$(pwd)/agent-active-manager" ~/.hermes/desktop-plugins/agent-active-manager

# Install Agent Activity Monitor
ln -s "$(pwd)/agent-monitor" ~/.hermes/desktop-plugins/agent-monitor
```

> [!TIP]
> Hermes Desktop supports hot-reloading and will recognize plugins immediately upon creation. If a plugin does not appear, verify that it is enabled in **Settings → Plugins**.

---

### 2. Hermes Agent Plugins

The agent plugins directory is `~/.hermes/plugins/`.

```bash
mkdir -p ~/.hermes/plugins

# Install Credential Safety
ln -s "$(pwd)/credential-safety" ~/.hermes/plugins/credential-safety

# Install SQLite Memory (Unified Package: Desktop GUI is automatically recognized)
ln -s "$(pwd)/sqlite-memory" ~/.hermes/plugins/sqlite-memory

# Install WikiSkill Evolution
ln -s "$(pwd)/wiki-skill-evolution" ~/.hermes/plugins/wiki-skill-evolution
```

#### Enabling Plugins in Agent Configuration (`config.yaml`)

Add the installed plugins to your agent profile configuration (`~/.hermes/config.yaml` or `~/.hermes/profiles/<profile_name>.yaml`):

```yaml
# Enable plugins
plugins:
  - credential-safety
  - wiki-skill-evolution

# Memory provider settings (when using sqlite-memory)
memory:
  memory_enabled: true
  provider: sqlite-memory
  sqlite-memory:
    db_path: "~/.hermes/memory.db"
    auto_extract: true
    max_recall: 5
```

---

## 📁 Repository Structure

```text
hermes-plugin/
├── README.md                  # Root documentation (Overview & Installation Guide)
│
├── agent-active-manager/      # [Desktop] Slot & backend concurrency manager
│   ├── plugin.js
│   └── README.md
│
├── agent-monitor/             # [Desktop] Real-time inference & event stream monitor
│   ├── plugin.js
│   └── README.md
│
├── credential-safety/         # [Agent] 4-layer secret redactor & offline scanner
│   ├── hooks.py
│   ├── patterns.py
│   ├── plugin.yaml
│   ├── scan_credentials.py
│   ├── tests/
│   └── README.md
│
├── sqlite-memory/             # [Agent/Desktop] Zero-dependency SQLite FTS5 memory & Desktop GUI
│   ├── __init__.py
│   ├── plugin.yaml
│   ├── dashboard/             # Web dashboard integration
│   ├── desktop/               # Desktop GUI (Unified Package)
│   ├── tests/                 # Unit tests (FTS5 search, remember, forget)
│   └── README.md
│
└── wiki-skill-evolution/      # [Agent] Tool error capture & skill evolution loop
    ├── main.py
    ├── plugin.yaml
    ├── tests/                 # Unit tests (rules, patching, dry-run)
    └── README.md
```

---

## 🧪 Testing & Validation

```bash
# Run all unit tests across all plugins
python3 credential-safety/tests/test_credential_safety.py -v
python3 sqlite-memory/tests/test_sqlite_memory.py -v
python3 wiki-skill-evolution/tests/test_evolution.py -v

# Run offline secret leak audit on databases and logs
python3 credential-safety/scan_credentials.py
```

<br>

---
<a id="japanese"></a>

# Hermes プラグインコレクション (日本語)

[ [English](#hermes-plugin-collection) | 日本語 ]

Hermes AI エージェント（[Hermes Agent](https://github.com/NousResearch/hermes-agent)）およびデスクトップクライアント（**Hermes Desktop**）向けの機能拡張プラグイン集です。  
セキュリティ強化、セッション・スロット管理、リアルタイム監視、長期記憶、自己進化ループなど、実践的な運用を支援するプラグインを提供しています。

---

## 💡 設計思想 (Design Philosophy)

本リポジトリのプラグイン群は、機能の網羅性や無用なアルゴリズムの複雑さを競うのではなく、**「実用性・壊れにくさ（ゼロ保守）・現場の即効性」** を最優先に設計されています。

1. **Zero External Dependencies（Python標準ライブラリ主義）**
   - すべての Agent プラグインは Python 標準ライブラリ（`sqlite3`, `re`, `urllib` 等）のみで完結。
   - 外部 pip パッケージの依存関係衝突（Dependency Hell）やサプライチェーンリスクを原理的に排除。導入した瞬間から確実に動作します。
2. **Core Essentials Focused（厳選された高密度コア機能）**
   - 雑多な周辺プラグインを増やして肥大化させるのではなく、Hermes 運用で誰もが直面する致命的な痛み（認証情報漏洩、スロット枯渇/フリーズ、重い外部DB不要の記憶管理）に極限まで集中しています。
3. **Fast-path & Deterministic（即効性・決定論的アプローチ）**
   - 過剰に重い機械学習モデルや反復的な LLM 呼び出しに頼らず、予測可能で高速・安全なヒューリスティック制御を採用。余計な API コストを発生させず、ミリ秒単位で現場のエラーを解決します。
4. **I/O 境界での多層防御（Defense in Depth）**
   - Credential Safety は、既知のトークン形式マッチング（`core/redact.py` の正規表現）だけではすり抜けてしまう **自然言語中のメタディスカッション** を捕捉します。エージェントが「パスワードを `sk-abc...` から `sk-xyz...` に変更しました」と説明する際に漏洩する秘密情報を、シャノンエントロピー分析・文字クラス検証・プレースホルダー検出の組み合わせで検出し、誤検知なくブロックします。これは [GitHub Issue #20785](https://github.com/NousResearch/hermes-agent/issues/20785) で報告された、コアのリダクター（redactor）だけでは防げない構造的課題を根本から解決します。
5. **ブラックボックスを排した、透明で監査可能な自己進化**
   - DSPy+GEPA パイプライン（オフライン・GPU必須・数時間の学習）を用いる公式 self-evolution とは異なり、当プラグインの WikiSkill Evolution は、**即時・決定論的・高い監査性** を備えたスキルパッチを提供します。実際のツールエラーをトリガーとして動作し、LLM 呼び出し不要、トークンコストゼロ、完全な git トレーサビリティを実現します。

---

## 📦 収録プラグイン一覧

| プラグイン名 | 対象環境 | 言語 | 概要 | ドキュメント |
| :--- | :--- | :--- | :--- | :--- |
| **[Agent Active Manager](./agent-active-manager/)** | Hermes Desktop | JS (ESM) | バックエンド同時起動スロット枠と推論状態を最適化し、プロファイル切替時のタイムアウトを防止 | [詳細 README](./agent-active-manager/README.md) |
| **[Agent Activity Monitor](./agent-monitor/)** | Hermes Desktop | JS (ESM) | ボットの推論・ツール実行状態や Gateway イベントをリアルタイムに可視化・監視 | [詳細 README](./agent-monitor/README.md) |
| **[Credential Safety](./credential-safety/)** | Hermes Agent | Python | ツール入出力・LLM推論・ターミナル出力から認証情報を自動マスクする多層防御。過去DB監査ツール同梱 | [詳細 README](./credential-safety/README.md) |
| **[SQLite Memory](./sqlite-memory/)** | Hermes Agent / Desktop | Python / JS | ゼロ依存・SQLite FTS5による長期記憶＆自動想起。Web API および Desktop GUI（Unified Package）を同梱 | [詳細 README](./sqlite-memory/README.md) |
| **[WikiSkill Evolution](./wiki-skill-evolution/)** | Hermes Agent | Python | ツール実行エラーを自動収集・分析し、教訓を Wiki ナレッジやスキル定義（`SKILL.md`）へ自律反映 | [詳細 README](./wiki-skill-evolution/README.md) |

---

## 🧩 プラグイン種別と導入先

本リポジトリのプラグインは、**Hermes Desktop 向け（UI拡張）** と **Hermes Agent 向け（コア機能・ツール拡張）** の2種類に分かれます。

```
hermes-plugin/
├── 【Hermes Desktop 向けプラグイン】（UI / JS）
│   ├── agent-active-manager/  ──> ~/.hermes/desktop-plugins/agent-active-manager/
│   └── agent-monitor/         ──> ~/.hermes/desktop-plugins/agent-monitor/
│
└── 【Hermes Agent 向けプラグイン】（Python）
    ├── credential-safety/     ──> ~/.hermes/plugins/credential-safety/
    ├── sqlite-memory/         ──> ~/.hermes/plugins/sqlite-memory/ (※Desktop GUI同梱)
    └── wiki-skill-evolution/  ──> ~/.hermes/plugins/wiki-skill-evolution/
```

---

## 🚀 クイックスタート (導入手順)

開発時や最新コードを追従する場合、**シンボリックリンク** を使用して配置することを推奨します。

### 1. Hermes Desktop 向けプラグインの導入

Hermes Desktop のプラグインディレクトリは `~/.hermes/desktop-plugins/` です。

```bash
mkdir -p ~/.hermes/desktop-plugins

# Agent Active Manager の配置
ln -s "$(pwd)/agent-active-manager" ~/.hermes/desktop-plugins/agent-active-manager

# Agent Activity Monitor の配置
ln -s "$(pwd)/agent-monitor" ~/.hermes/desktop-plugins/agent-monitor
```

> [!TIP]
> Hermes Desktop はホットリロードに対応しているため、配置後すぐに認識されます。画面に反映されない場合は **Settings → Plugins** で有効化状態を確認してください。

---

### 2. Hermes Agent 向けプラグインの導入

Hermes Agent のプラグインディレクトリは `~/.hermes/plugins/` です。

```bash
mkdir -p ~/.hermes/plugins

# Credential Safety の配置
ln -s "$(pwd)/credential-safety" ~/.hermes/plugins/credential-safety

# SQLite Memory の配置（Unified Package: Desktop GUI も自動認識されます）
ln -s "$(pwd)/sqlite-memory" ~/.hermes/plugins/sqlite-memory

# WikiSkill Evolution の配置
ln -s "$(pwd)/wiki-skill-evolution" ~/.hermes/plugins/wiki-skill-evolution
```

#### プロファイル設定の有効化 (`config.yaml`)

エージェント設定ファイル（`~/.hermes/config.yaml` または `~/.hermes/profiles/<profile_name>.yaml`）にプラグインを追加します：

```yaml
# プラグインの有効化
plugins:
  - credential-safety
  - wiki-skill-evolution

# メモリプロバイダの設定（sqlite-memory を利用する場合）
memory:
  memory_enabled: true
  provider: sqlite-memory
  sqlite-memory:
    db_path: "~/.hermes/memory.db"
    auto_extract: true
    max_recall: 5
```

---

## 📁 リポジトリ構成

```text
hermes-plugin/
├── README.md                  # 本ドキュメント（全体概要・導入ガイド）
│
├── agent-active-manager/      # [Desktop] スロット管理・プロファイル切替最適化
│   ├── plugin.js
│   └── README.md
│
├── agent-monitor/             # [Desktop] エージェント推論状態リアルタイム監視
│   ├── plugin.js
│   └── README.md
│
├── credential-safety/         # [Agent] 認証情報漏洩防止・4層サニタイズ＆過去ログ監査
│   ├── hooks.py
│   ├── patterns.py
│   ├── plugin.yaml
│   ├── scan_credentials.py
│   ├── tests/
│   └── README.md
│
├── sqlite-memory/             # [Agent/Desktop] ゼロ依存 SQLite FTS5 永続メモリ & Desktop GUI
│   ├── __init__.py
│   ├── plugin.yaml
│   ├── dashboard/             # Webダッシュボード用定義
│   ├── desktop/               # Desktop GUI (Unified Package)
│   ├── tests/                 # ユニットテスト（FTS5想起・記憶・削除）
│   └── README.md
│
└── wiki-skill-evolution/      # [Agent] ツールエラー捕捉・スキル自律進化ループ
    ├── main.py
    ├── plugin.yaml
    ├── tests/                 # ユニットテスト（分類ルール・パッチ・ドライラン）
    └── README.md
```

---

## 🧪 テスト・品質検証

```bash
# 全プラグインのユニットテストを一括実行 (35テスト)
python3 credential-safety/tests/test_credential_safety.py -v
python3 sqlite-memory/tests/test_sqlite_memory.py -v
python3 wiki-skill-evolution/tests/test_evolution.py -v

# 過去の会話DB・ログの認証情報監査スキャン
python3 credential-safety/scan_credentials.py
```

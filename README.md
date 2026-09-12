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
│   └── README.md
│
└── wiki-skill-evolution/      # [Agent] Tool error capture & skill evolution loop
    ├── main.py
    ├── plugin.yaml
    └── README.md
```

---

## 🧪 Testing & Validation

```bash
# Run Credential Safety unit tests
python3 credential-safety/tests/test_credential_safety.py -v

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
│   └── README.md
│
└── wiki-skill-evolution/      # [Agent] ツールエラー捕捉・スキル自律進化ループ
    ├── main.py
    ├── plugin.yaml
    └── README.md
```

---

## 🧪 テスト・品質検証

```bash
# Credential Safety のユニットテスト実行
python3 credential-safety/tests/test_credential_safety.py -v

# 過去の会話DB・ログの認証情報監査スキャン
python3 credential-safety/scan_credentials.py
```

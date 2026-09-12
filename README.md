# Hermes Plugin Collection

[ English | [日本語](#japanese) ]

A collection of feature plugins for the Hermes AI Agent ([Hermes Agent](https://github.com/NousResearch/hermes-agent)) and the **Hermes Desktop** client.  
Providing production-grade enhancements for security (credential redaction), backend concurrency and slot management, real-time activity monitoring, persistent memory, and autonomous skill evolution.

---

## 📦 Available Plugins

| Plugin | Target Environment | Language | Description | Documentation |
| :--- | :--- | :--- | :--- | :--- |
| **[Agent Active Manager](./agent-active-manager/)** | Hermes Desktop | JS (ESM) | Optimizes backend slot limits and inference states to eliminate profile-switch timeouts | [Read README](./agent-active-manager/README.md) |
| **[Agent Activity Monitor](./agent-monitor/)** | Hermes Desktop | JS (ESM) | Real-time visualizer and event monitor for agent inference, tool runs, and gateway events | [Read README](./agent-monitor/README.md) |
| **[Credential Safety](./credential-safety/)** | Hermes Agent | Python | Multi-layer secret redaction across tools, LLMs, and terminal logs with offline DB/log auditing | [Read README](./credential-safety/README.md) |
| **[SQLite Memory](./sqlite_memory/)** | Hermes Agent / Desktop | Python / JS | Zero-dependency SQLite FTS5 long-term memory with automatic recall. Bundles Web API & Desktop GUI | [Read README](./sqlite_memory/README.md) |
| **[SQLite Memory GUI](./sqlite-memory-gui/)** | Hermes Desktop | JS (ESM) | Standalone Master/Detail GUI for searching, adding, editing, and deleting memories | [Read README](./sqlite-memory-gui/README.md) |
| **[WikiSkill Evolution](./wiki_skill_evolution/)** | Hermes Agent | Python | Autonomous evolution loop capturing tool errors and distilling lessons into skills (`SKILL.md`) | [Read README](./wiki_skill_evolution/README.md) |

---

## 🧩 Plugin Types & Installation Targets

Plugins in this repository are divided into **Hermes Desktop Plugins (UI extensions)** and **Hermes Agent Plugins (Core / Python extensions)**.

```
hermes-plugin/
├── [Hermes Desktop Plugins] (UI / JavaScript ESM)
│   ├── agent-active-manager/  ──> ~/.hermes/desktop-plugins/agent-active-manager/
│   ├── agent-monitor/         ──> ~/.hermes/desktop-plugins/agent-monitor/
│   └── sqlite-memory-gui/     ──> ~/.hermes/desktop-plugins/sqlite_memory/
│
└── [Hermes Agent Plugins] (Backend / Python)
    ├── credential-safety/     ──> ~/.hermes/plugins/credential-safety/
    ├── sqlite_memory/         ──> ~/.hermes/plugins/sqlite_memory/ (Includes Desktop GUI)
    └── wiki_skill_evolution/  ──> ~/.hermes/plugins/wiki_skill_evolution/
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

# Install SQLite Memory GUI (Note: Directory name must be sqlite_memory)
ln -s "$(pwd)/sqlite-memory-gui" ~/.hermes/desktop-plugins/sqlite_memory
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
ln -s "$(pwd)/sqlite_memory" ~/.hermes/plugins/sqlite_memory

# Install WikiSkill Evolution
ln -s "$(pwd)/wiki_skill_evolution" ~/.hermes/plugins/wiki_skill_evolution
```

#### Enabling Plugins in Agent Configuration (`config.yaml`)

Add the installed plugins to your agent profile configuration (`~/.hermes/config.yaml` or `~/.hermes/profiles/<profile_name>.yaml`):

```yaml
# Enable plugins
plugins:
  - credential-safety
  - wiki_skill_evolution

# Memory provider settings (when using sqlite_memory)
memory:
  memory_enabled: true
  provider: sqlite_memory
  sqlite_memory:
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
├── sqlite_memory/             # [Agent/Desktop] Zero-dependency SQLite FTS5 memory
│   ├── __init__.py
│   ├── plugin.yaml
│   ├── dashboard/             # Web dashboard integration
│   ├── desktop/               # Desktop GUI (Unified Package)
│   └── README.md
│
├── sqlite-memory-gui/         # [Desktop] Standalone Memory Management GUI
│   ├── plugin.js
│   └── README.md
│
└── wiki_skill_evolution/      # [Agent] Tool error capture & skill evolution loop
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

## 📦 収録プラグイン一覧

| プラグイン名 | 対象環境 | 言語 | 概要 | ドキュメント |
| :--- | :--- | :--- | :--- | :--- |
| **[Agent Active Manager](./agent-active-manager/)** | Hermes Desktop | JS (ESM) | バックエンド同時起動スロット枠と推論状態を最適化し、プロファイル切替時のタイムアウトを防止 | [詳細 README](./agent-active-manager/README.md) |
| **[Agent Activity Monitor](./agent-monitor/)** | Hermes Desktop | JS (ESM) | ボットの推論・ツール実行状態や Gateway イベントをリアルタイムに可視化・監視 | [詳細 README](./agent-monitor/README.md) |
| **[Credential Safety](./credential-safety/)** | Hermes Agent | Python | ツール入出力・LLM推論・ターミナル出力から認証情報を自動マスクする多層防御。過去DB監査ツール同梱 | [詳細 README](./credential-safety/README.md) |
| **[SQLite Memory](./sqlite_memory/)** | Hermes Agent / Desktop | Python / JS | ゼロ依存・SQLite FTS5による長期記憶＆自動想起。Web API および Desktop GUI（Unified Package）を同梱 | [詳細 README](./sqlite_memory/README.md) |
| **[SQLite Memory GUI](./sqlite-memory-gui/)** | Hermes Desktop | JS (ESM) | SQLite 長期記憶の閲覧・検索・新規作成・編集・削除を行うマスター/ディテール GUI | [詳細 README](./sqlite-memory-gui/README.md) |
| **[WikiSkill Evolution](./wiki_skill_evolution/)** | Hermes Agent | Python | ツール実行エラーを自動収集・分析し、教訓を Wiki ナレッジやスキル定義（`SKILL.md`）へ自律反映 | [詳細 README](./wiki_skill_evolution/README.md) |

---

## 🧩 プラグイン種別と導入先

本リポジトリのプラグインは、**Hermes Desktop 向け（UI拡張）** と **Hermes Agent 向け（コア機能・ツール拡張）** の2種類に分かれます。

```
hermes-plugin/
├── 【Hermes Desktop 向けプラグイン】（UI / JS）
│   ├── agent-active-manager/  ──> ~/.hermes/desktop-plugins/agent-active-manager/
│   ├── agent-monitor/         ──> ~/.hermes/desktop-plugins/agent-monitor/
│   └── sqlite-memory-gui/     ──> ~/.hermes/desktop-plugins/sqlite_memory/
│
└── 【Hermes Agent 向けプラグイン】（Python）
    ├── credential-safety/     ──> ~/.hermes/plugins/credential-safety/
    ├── sqlite_memory/         ──> ~/.hermes/plugins/sqlite_memory/ (※Desktop GUI同梱)
    └── wiki_skill_evolution/  ──> ~/.hermes/plugins/wiki_skill_evolution/
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

# SQLite Memory GUI の配置（※フォルダ名は sqlite_memory に指定）
ln -s "$(pwd)/sqlite-memory-gui" ~/.hermes/desktop-plugins/sqlite_memory
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
ln -s "$(pwd)/sqlite_memory" ~/.hermes/plugins/sqlite_memory

# WikiSkill Evolution の配置
ln -s "$(pwd)/wiki_skill_evolution" ~/.hermes/plugins/wiki_skill_evolution
```

#### プロファイル設定の有効化 (`config.yaml`)

エージェント設定ファイル（`~/.hermes/config.yaml` または `~/.hermes/profiles/<profile_name>.yaml`）にプラグインを追加します：

```yaml
# プラグインの有効化
plugins:
  - credential-safety
  - wiki_skill_evolution

# メモリプロバイダの設定（sqlite_memory を利用する場合）
memory:
  memory_enabled: true
  provider: sqlite_memory
  sqlite_memory:
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
├── sqlite_memory/             # [Agent/Desktop] ゼロ依存 SQLite FTS5 永続メモリ
│   ├── __init__.py
│   ├── plugin.yaml
│   ├── dashboard/             # Webダッシュボード用定義
│   ├── desktop/               # Desktop GUI (Unified Package)
│   └── README.md
│
├── sqlite-memory-gui/         # [Desktop] SQLite メモリ管理 GUI（単体パッケージ）
│   ├── plugin.js
│   └── README.md
│
└── wiki_skill_evolution/      # [Agent] ツールエラー捕捉・スキル自律進化ループ
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

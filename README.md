# Hermes Plugin Collection

Hermes AI エージェント（[Hermes Agent](https://github.com/NousResearch/hermes-agent)）およびデスクトップクライアント（**Hermes Desktop**）向けの機能拡張プラグイン集です。  
セキュリティ強化、セッション・スロット管理、リアルタイム監視、長期記憶、自己進化ループなど、実践的な運用を支援するプラグインを提供しています。

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
├── sqlite-memory/             # [Agent/Desktop] ゼロ依存 SQLite FTS5 永続メモリ
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

各 Python プラグインには単体テストや検証スクリプトが用意されています。

```bash
# Credential Safety のユニットテスト実行
python3 credential-safety/tests/test_credential_safety.py -v

# 過去の会話DB・ログの認証情報監査スキャン
python3 credential-safety/scan_credentials.py
```

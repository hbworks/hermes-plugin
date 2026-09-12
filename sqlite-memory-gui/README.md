# Hermes Desktop - SQLite Memory GUI Plugin

Hermes Desktop 向けの SQLite 永続メモリ管理用 GUI プラグインです。
保存された記憶（長期記憶・設定・ルール）の検索、閲覧、新規作成、編集、削除を Hermes Desktop 上で直感的に行うことができます。

---

## 🌟 主な機能

1. **マスター・ディテール 2カラム UI**
   - Hermes 公式の Skills / Toolsets ページと統一されたデザイン。
   - 左側にカテゴリ一覧 & 記憶カード一覧、右側に選択された記憶の詳細プレビュー。
2. **リアルタイム検索 & カテゴリ絞り込み**
   - SQLite FTS5 全文検索に対応したインクリメンタル検索。
   - カテゴリ別（`general`, `preference`, `fact`, `rule` 等）でのフィルタリング。
3. **直感的な記憶の管理 (CRUD)**
   - **新規作成 (Add Memory)**: カテゴリと内容を入力して即時保存。
   - **編集 (Edit)**: 記憶内容やカテゴリのインライン更新。
   - **削除 (Delete)**: 不要になった記憶の削除。
4. **自動想起・メタ情報の確認**
   - セッションIDやソース（`manual` / `agent_auto` 等）、作成日時・更新日時の確認。

---

## 🚀 インストール手順

Hermes Desktop のプラグインディレクトリ `~/.hermes/desktop-plugins/sqlite_memory/` に配置します。

> [!IMPORTANT]
> プラグインID（`sqlite_memory`）と配置先ディレクトリ名を一致させる必要があります。ディレクトリ名は `sqlite-memory-gui` ではなく **`sqlite_memory`** にしてください。

### コピーして配置する場合

```bash
mkdir -p ~/.hermes/desktop-plugins/sqlite_memory
cp ./sqlite-memory-gui/plugin.js ~/.hermes/desktop-plugins/sqlite_memory/plugin.js
```

### シンボリックリンクで配置する場合（推奨）

```bash
mkdir -p ~/.hermes/desktop-plugins
ln -s "$(pwd)/sqlite-memory-gui" ~/.hermes/desktop-plugins/sqlite_memory
```

> [!TIP]
> **Unified Package をご利用の場合:**
> Hermes Agent 側のプラグイン `sqlite_memory/`（Unified Package）を `~/.hermes/plugins/sqlite_memory/` に導入している場合、`desktop/plugin.js` が自動認識されるため、本ディレクトリの個別配置は不要です。

> [!NOTE]
> - Hermes Desktop はホットリロードに対応しているため、配置後すぐにサイドバーに「Memory」アイコンが表示されます。
> - 本プラグインのバックエンド API は、Hermes Agent の `sqlite_memory` プラグイン（または Hermes サーバーの `/api/plugins/sqlite_memory/`）と連携して動作します。

---

## 📁 ディレクトリ構成

```text
sqlite-memory-gui/
├── plugin.js       # プラグイン本体（ESM形式 / @hermes/plugin-sdk 対応）
└── README.md       # 本ドキュメント
```

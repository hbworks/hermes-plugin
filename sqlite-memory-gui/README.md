# Hermes Desktop - SQLite Memory GUI Plugin

Hermes Desktop 向けの SQLite 永続メモリ管理用 GUI プラグインです。
保存された記憶（長期記憶・設定・ルール）の検索、閲覧、新規作成、編集、削除を Hermes Desktop 上で行うことができます。

---

## 🌟 主な機能

1. **マスター・ディテール 2カラム UI**
   - Hermes 公式の Skills / Toolsets ページと統一されたデザイン。
   - 左側にカテゴリ一覧 & 記憶カード一覧、右側に選択された記憶の詳細プレビュー。
2. **リアルタイム検索 & カテゴリ絞り込み**
   - SQLite FTS5 全文検索に対応したインクリメンタル検索。
   - カテゴリ別（general, preference, fact, rule 等）でのフィルタリング。
3. **直感的な記憶の管理 (CRUD)**
   - **新規作成 (Add Memory)**: カテゴリと内容を入力して保存。
   - **編集 (Edit)**: 記憶内容やカテゴリの即時更新。
   - **削除 (Delete)**: 不要になった記憶の削除。
4. **自動想起・ソースの確認**
   - セッションIDやソース（manual / agent_auto 等）、作成日時・更新日時の確認。

---

## 🚀 インストール手順

Hermes Desktop のプラグインディレクトリ `~/.hermes/desktop-plugins/sqlite-memory-gui/` に `plugin.js` を配置します。

### コピー用コマンド

```bash
# プラグイン配置先へディレクトリごとコピー
mkdir -p ~/.hermes/desktop-plugins
cp -r ./sqlite-memory-gui ~/.hermes/desktop-plugins/

# または個別コピー
# mkdir -p ~/.hermes/desktop-plugins/sqlite-memory-gui
# cp ./sqlite-memory-gui/plugin.js ~/.hermes/desktop-plugins/sqlite-memory-gui/plugin.js
```

> **Note:**
> - Hermes Desktop はホットリロードに対応しているため、配置後すぐにサイドバーに「Memory」アイコンが表示されます。
> - 本プラグインのバックエンド API は、Hermes Agent の `sqlite_memory` プラグイン（または Hermes サーバーの `/api/plugins/sqlite_memory/`）と連携して動作します。

---

## 📁 ディレクトリ構成

```text
hermes-plugin/
└── sqlite-memory-gui/
    ├── plugin.js       # プラグイン本体（ESM形式 / @hermes/plugin-sdk 対応）
    └── README.md       # 本ドキュメント
```

# Agent Active Manager (Hermes Desktop Plugin)

[ English | [日本語](#japanese) ]

A smart Hermes Desktop plugin to **monitor and manage local backend concurrency slots and inference states**, completely eliminating profile-switch timeout errors.

---

## 🎯 Background & Motivation

Hermes Desktop maintains a pool of running backend Python processes to enable rapid switching between agent profiles.

However, several architectural constraints often led to frustrating profile-switch timeouts (`timed out while waiting for a free slot`):
1. **Slot Limit**: Concurrently active backends are capped at a default limit (typically **3**).
2. **LRU Eviction Delay**: Backends that communicated within the last 4 minutes are protected from automatic eviction to preserve active sessions.
3. **All-Busy Deadlock**: After interacting with 3 agents, switching to a 4th agent encounters a "3/3 busy" state, blocking for 30 seconds before failing with a timeout error.
4. **Hover Prewarm Trap**: Merely hovering over profile items in the sidebar triggers a 120ms prewarm timer that prematurely spins up backends, draining available slots without user intent.

**Agent Active Manager** tracks agent activity in real time, intercepts prewarm timers, and provides interactive safeguards when slot limits are reached.

---

## 🌟 Key Features

### 1. Real-time Slot Gauge & Quick Tuning
* Visualizes active backend instances (e.g., `3 / 3 Active`) with dynamic color indicators.
* Quick adjustment buttons (`+1` / `-1` Slot) to instantly expand or shrink concurrency limits.
* One-click idle expiration presets (`2m` / `5m` / `10m`) to quickly adjust LRU retirement timing.

### 2. Automatic Hover Prewarm Suppression
* Hooks into the desktop runtime to neutralize the 120ms hover-intent prewarm timers (`useProfilePrewarm`), preventing accidental backend spin-ups.

### 3. Recent Inference History Tracking
* Displays the last action for each active agent with execution duration and timestamps (e.g., `⏱ Last: 15s ago (4s / Tool: search)`).
* Highlights agents actively running inference or executing tools in real time.

### 4. Safe Switch Confirmation Dialog
* When switching to another agent while all configured slots are busy running active workloads:
  * Prevents abrupt task interruption and timeout errors by displaying a warning dialog.
  * Shows which agent is running and for how long, offering three safe options:
    * **[+1 Slot & Safe Switch]**: Temporarily expands the slot limit to launch concurrently without timeouts.
    * **[Force Switch (Risk of Timeout)]**: Proceeds immediately despite timeout risk.
    * **[Cancel]**: Waits for ongoing work to complete.

### 5. One-Click Safe Switching
* Clean transitions to desired agents via `Switch ➔` or `Open` buttons when idle slots or capacities are available.

---

## 🚀 Installation

Place the folder into the Hermes Desktop plugins directory `~/.hermes/desktop-plugins/`.

### Option A: Copy Files

```bash
mkdir -p ~/.hermes/desktop-plugins
cp -r ./agent-active-manager ~/.hermes/desktop-plugins/
```

### Option B: Symbolic Link (Recommended for Development)

```bash
mkdir -p ~/.hermes/desktop-plugins
ln -s "$(pwd)/agent-active-manager" ~/.hermes/desktop-plugins/agent-active-manager
```

After launching (or reloading) Hermes Desktop, access the plugin from the right sidebar pane (Width: `330px`, Title: `Active Manager`) or via the route `/active-manager`.

---

## 📁 Directory Structure

```text
agent-active-manager/
├── plugin.js       # Plugin implementation (ESM / @hermes/plugin-sdk)
└── README.md       # Documentation
```

<br>

---
<a id="japanese"></a>

# Agent Active Manager (日本語)

[ [English](#agent-active-manager-hermes-desktop-plugin) | 日本語 ]

Hermes Desktop における **「ローカルバックエンドの同時起動枠（スロット制限）」と「直前の推論状態」をスマートに管理・監視し、プロファイル切り替え時のタイムアウトエラーを完全に防止する** プラグインです。

---

## 🎯 背景・開発理由

Hermes Desktop は複数のエージェントを高速に切り替えるため、各プロファイルのバックエンド（Python プロセス）を起動したまま保持するプール機能を持っています。

しかし、以下の仕様によりプロファイル切り替えがタイムアウト（`timed out while waiting for a free slot`）する問題がありました：

1. 同時に起動できるバックエンドの上限数（スロット枠）がデフォルトで **3** に制限されている。
2. 直近4分以内に通信があったバックエンドはセッション保護のため自動終了（LRU 退避）されない。
3. 3つのエージェントを操作した後に別のエージェントに切り替えようとすると、**「空きスロットがない（3/3 busy）」状態になり、30秒待機した末にタイムアウトエラーになる**。
4. サイドバー等のプロファイル一覧にカーソルを合わせただけでバックエンドが先行起動（Hover-intent prewarm）してしまい、意図せずスロットが枯渇する。

この **Agent Active Manager** は、エージェントの活動状態をリアルタイムに把握し、枠の逼迫や全枠ビジーを検知して安全な切り替えを支援します。

---

## 🌟 主な機能

### 1. スロット枠 ＆ 使用状況のリアルタイム表示
* 現在起動しているバックエンド数（例: `3 / 3 Active`）をカラーゲージで可視化。
* スロット枠のクイック調整（`+1` / `-1` ボタン）が可能。
* アイドル自動解放時間（`idleMs`）をワンクリック（`2m` / `5m` / `10m`）で即座に変更可能。

### 2. ホバー先行起動（Prewarm）の自動抑止
* プロファイルホバー時にバックエンドが無駄に先行起動されてスロットが埋まるのを自動フックして抑止します。

### 3. 直前の推論履歴の追跡
* どのアクティブエージェントが「いつ、何秒間、どんな処理（推論またはツール実行）」を完了したかをタイムスタンプ付き（例: `⏱ Last: 15s ago (4s / Tool: search)`）で表示。
* 現在リアルタイムに推論・ツール実行中のエージェントはハイライト表示。

### 4. 全枠ビジー時の安全確認ダイアログ
* 設定されているスロット枠（例: 3枠）の**すべてでエージェントが推論・ツール実行中**の状態で別のエージェントへ切り替えようとした場合：
  * 勝手に切り替えて作業を中断させたり、タイムアウトエラーを起こさせたりせず、**警告ダイアログを表示**します。
  * 実行中のエージェント名と経過時間を明示し、以下の安全な選択肢を提供します：
    * **[+1 Slot & Safe Switch]**（スロットを一時拡張してタイムアウトを防止し並行起動）
    * **[Force Switch (Risk of Timeout)]**（強制切り替え）
    * **[Cancel]**（作業完了を待つ）

### 5. ワンクリック安全切り替え（Switch ➔）
* スロットに空きがあるかアイドル中のエージェントが存在する場合は、`Switch ➔` または `Open` ボタンからスムーズに目的のエージェントへと遷移します。

---

## 🚀 インストール手順

Hermes Desktop のプラグインディレクトリ `~/.hermes/desktop-plugins/` に配置することで自動認識されます。

### コピーして導入する場合

```bash
mkdir -p ~/.hermes/desktop-plugins
cp -r ./agent-active-manager ~/.hermes/desktop-plugins/
```

### シンボリックリンクで導入する場合（開発・更新が即反映）

```bash
mkdir -p ~/.hermes/desktop-plugins
ln -s "$(pwd)/agent-active-manager" ~/.hermes/desktop-plugins/agent-active-manager
```

Hermes Desktop を起動（または再読み込み）すると、右側ペイン（幅 330px、タイトル: `Active Manager`）またはルーティング URL `/active-manager` から利用できます。

---

## 📁 ディレクトリ構成

```text
agent-active-manager/
├── plugin.js       # プラグイン本体（ESM形式 / @hermes/plugin-sdk 対応）
└── README.md       # 本ドキュメント
```

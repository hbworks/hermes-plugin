# Agent Active Manager (Hermes Desktop Plugin)

[ English | [日本語](#japanese) ]

A smart Hermes Desktop plugin to **monitor and manage local backend concurrency slots and inference states**, completely eliminating profile-switch timeout errors.

---

## 🎯 Background & Motivation

Hermes Desktop maintains a pool of running backend Python processes to enable rapid switching between agent profiles.

However, several architectural constraints often led to frustrating profile-switch timeouts (`timed out while waiting for a free slot`):
1. **Slot Limit**: Concurrently active backends are capped at a default limit (typically **3**).
2. **LRU Eviction Delay**: Backends that communicated recently are protected from automatic eviction to preserve active sessions.
3. **All-Busy Deadlock**: After interacting with several agents, switching to another agent encounters an all-busy state, blocking for 30 seconds before failing with a timeout error.
4. **Sudden Concurrency Exhaustion**: Running long reasoning or tool chains across multiple profiles simultaneously drains available slots without clear visual feedback.

**Agent Active Manager** tracks agent activity in real time, visualizes backend slot consumption, enables one-click forced session termination to free slots, and provides interactive safeguards when slot limits are reached.

---

## 🌟 Key Features

### 1. Real-time Slot Gauge & Quick Tuning
* Visualizes active backend instances (e.g., `3 / 3 Active`) with dynamic color indicators.
* Quick adjustment buttons (`+1` / `-1` Slot) to instantly expand or shrink concurrency limits.
* One-click idle expiration presets (`2m` / `5m` / `10m`) to quickly adjust LRU retirement timing.

### 2. Backend Force Stop & Slot Liberation
* Dedicated `↺ Reset & Free Slot` button per agent to explicitly send `session.stop` (`abort: true`) with exact runtime session IDs, immediately freeing occupied backend slots.
* Global `↺ Reset All` button to parallelly terminate all busy sessions when a deadlock occurs.

### 3. Recent Inference History Tracking
* Displays the last action for each active agent with execution duration and timestamps (e.g., `⏱ Last: 15s ago (4s / Tool: search)`).
* Real-time indicators for agents currently running reasoning (`🧠 Busy`) or executing tools (`⚡ tool_name`).

### 4. All-Busy Safe Switch Guard & Dialog
* When switching to another agent while all configured slots are busy running active workloads:
  * Prevents abrupt task interruption and timeout errors by displaying an interactive warning dialog.
  * Shows which agent is running and for how long, offering three safe options:
    * **[+1 Slot & Safe Switch]**: Temporarily expands the slot limit to launch concurrently without timeouts, then automatically reverts.
    * **[Force Switch (Risk of Timeout)]**: Proceeds immediately despite timeout risk.
    * **[Cancel]**: Waits for ongoing work to complete.

### 5. One-Click Safe Switching
* Clean transitions to desired agents via `Switch ➔` or `Open` buttons when idle slots or capacities are available, adhering strictly to official SDK contracts.

---

## ⚙️ Compatibility & Desktop Internal API Requirements

* **Recommended Environment**: **Hermes Desktop 2026.1+**
* **Desktop Internal API Dependency**:
  * Dynamic slot limit expansion/reduction and idle eviction duration adjustments rely on Hermes Desktop's internal IPC interface (`window.hermesDesktop.setPoolLimits`).
* **Automatic Fallback (Estimated 3-Slot Safe Mode)**:
  * When running on non-supported desktop builds, web environments, or where `window.hermesDesktop.setPoolLimits` is unavailable, the plugin automatically falls back to an **Estimated 3-Slot Mode**.
  * Slot adjustment buttons are safely disabled with a descriptive tooltip, while all core monitoring, inference history tracking, session stop (`session.stop`), and all-busy switch protection features continue to function seamlessly via official `@hermes/plugin-sdk`.
* **Zero Monkey-Patching / Strict SDK Conformance**:
  * The plugin strictly adheres to official PluginContext contracts. It does **NOT** monkey-patch shared SDK objects (`host.warmProfile`), timers (`window.setTimeout`), or DOM pointer events, guaranteeing zero side effects or interference with other plugins and core Hermes features.

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
2. 直近に通信があったバックエンドはセッション保護のため自動終了（LRU 退避）されない。
3. 3つのエージェントを操作した後に別のエージェントに切り替えようとすると、**「空きスロットがない（3/3 busy）」状態になり、30秒待機した末にタイムアウトエラーになる**。
4. 複数プロファイルで推論やツール実行が重なると、現在のスロット消費状況が把握できず意図せずデッドロックに陥る。

この **Agent Active Manager** は、エージェントの活動状態をリアルタイムに把握し、枠の逼迫や全枠ビジーを検知して安全な切り替えを支援します。

---

## 🌟 主な機能

### 1. スロット枠 ＆ 使用状況のリアルタイム表示
* 現在起動しているバックエンド数（例: `3 / 3 Active`）をカラーゲージで可視化。
* スロット枠のクイック調整（`+1` / `-1` ボタン）が可能。
* アイドル自動解放時間（`idleMs`）をワンクリック（`2m` / `5m` / `10m`）で即座に変更可能。

### 2. バックエンド強制停止 ＆ スロット即時解放
* エージェントごとの `↺ Reset & Free Slot` ボタンにより、対象のランタイムセッションIDを明示して `session.stop`（`abort: true`）を発行し、占有されたスロットを確実に解放。
* 全エージェントがビジー状態の際に一括で停止・解放を行う `↺ Reset All` ボタンを装備。

### 3. 直前の推論履歴の追跡
* どのアクティブエージェントが「いつ、何秒間、どんな処理（推論またはツール実行）」を完了したかをタイムスタンプ付き（例: `⏱ Last: 15s ago (4s / Tool: search)`）で表示。
* 現在リアルタイムに推論中（`🧠 Busy`）またはツール実行中（`⚡ tool_name`）のエージェントをハイライト表示。

### 4. 全枠ビジー時の安全確認ダイアログ
* 設定されているスロット枠（例: 3枠）の**すべてでエージェントが推論・ツール実行中**の状態で別のエージェントへ切り替えようとした場合：
  * 勝手に切り替えて作業を中断させたり、タイムアウトエラーを起こさせたりせず、**警告ダイアログを表示**します。
  * 実行中のエージェント名と経過時間を明示し、以下の安全な選択肢を提供します：
    * **[+1 Slot & Safe Switch]**（スロットを一時拡張してタイムアウトを防止し並行起動、切り替え完了後に自動復元）
    * **[Force Switch (Risk of Timeout)]**（強制切り替え）
    * **[Cancel]**（作業完了を待つ）

### 5. ワンクリック安全切り替え（Switch ➔）
* スロットに空きがあるかアイドル中のエージェントが存在する場合は、公式 SDK 契約に準拠した安全な手順で目的のエージェントへと遷移します。

---

## ⚙️ 互換性および Desktop 内部 API について

* **推奨環境**: **Hermes Desktop 2026.1 以降**
* **Desktop 内部 API の利用について**:
  * スロット上限数（`maxBackends`）およびアイドル退避時間（`idleMs`）の動的変更機能は、Hermes Desktop の内部 Electron IPC（`window.hermesDesktop.setPoolLimits`）を利用しています。
* **自動フォールバック動作（推定 3 スロット安全モード）**:
  * 内部 API が非提供の環境（Web 版や将来の内部仕様変更時など）では、自動的に **推定 3 スロット安全モード** へフォールバックします。
  * スロット変更ボタンは安全のため無効化（ツールチップで案内）されますが、エージェント監視・推論履歴追跡・セッション停止（`session.stop`）・全枠ビジー警告ダイアログ等の安全機能は公式 `@hermes/plugin-sdk` のみで完全に動作し続けます。
* **モンキーパッチ排除・公式 SDK 契約への厳格な準拠**:
  * 共有 SDK オブジェクト（`host.warmProfile` 等）の書き換えやグローバルタイマー（`window.setTimeout`）、マウスイベントの改変は一切行っていません。他のプラグインや Hermes 本体の動作に副作用を及ぼすことなく、安全に共存できます。

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

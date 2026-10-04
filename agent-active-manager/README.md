# Agent Active Manager (Hermes Desktop Plugin)

[ English | [日本語](#japanese) ]

A smart Hermes Desktop plugin to **estimate backend concurrency usage, monitor inference state, and manage safe profile switching**.

---

## 🎯 Background & Motivation

Hermes Desktop maintains a pool of running backend Python processes to enable rapid switching between agent profiles.

However, several architectural constraints can lead to profile-switch timeouts (`timed out while waiting for a free slot`):
1. **Slot Limit**: Concurrently active backends are capped at a default limit (typically **3**).
2. **LRU Eviction Delay**: Backends that communicated recently are protected from automatic eviction to preserve active sessions.
3. **All-Busy Deadlock**: After interacting with several agents, switching to another agent encounters an all-busy state, blocking for 30 seconds before failing with a timeout error.
4. **Sudden Concurrency Exhaustion**: Running long reasoning or tool chains across multiple profiles simultaneously drains available slots without clear visual feedback.

**Agent Active Manager** estimates agent activity, visualizes estimated pool usage, provides a one-click way to interrupt a stuck turn, and offers a capacity warning. The estimates do not prevent backend slot timeouts.

---

## 🌟 Key Features

### 1. Estimated Pool Gauge & Quick Tuning
* Estimates active backend instances (e.g., `3 / 3 Active (Est.)`) from observed gateway activity and idle timeouts.
* Displays observed reasoning/tool activity as `Busy` and previously active instances as `♨️ Warm` (estimated state).
* Pool limit and idle-eviction controls are available when the optional Desktop bridge exists.

### 2. Interrupt Stuck Turns
* When an agent task runs for 120 seconds or longer (suspected freeze or deadlock), an emergency `↺ Interrupt Turn` button sends the supported `session.interrupt` RPC for its runtime session ID.
* Global `↺ Interrupt All` sends interrupts to sessions currently reported busy by the host. This interrupts turns; it does not terminate backend processes or guarantee a freed slot.

### 3. Recent Inference History Tracking
* Displays the last action for each active agent with execution duration and timestamps (e.g., `⏱ Last: 15s ago (4s / Tool: search)`).
* Real-time indicators for agents currently running reasoning (`🧠 Busy`) or executing tools (`⚡ tool_name`).

### 4. Estimated Capacity Warning
* When observed activity reaches the estimated capacity, a warning may be shown; it cannot guarantee that switching will avoid a timeout.
* With the Desktop pool-control bridge, users may temporarily increase capacity, continue despite timeout risk, or cancel. Without that bridge, switching proceeds normally; the warning cannot release a slot.

### 5. Profile Switching
* Uses the profile roster's stored session IDs and the public SDK `openSession` / routed Gateway APIs to switch profiles.

---

## ⚙️ Compatibility & Desktop Internal API Requirements

* **Recommended Environment**: A current Hermes Desktop build
* **Desktop Internal API Dependency**:
  * Dynamic slot limit and idle eviction adjustments rely on `window.hermesDesktop.setPoolLimits`.
* **Fallback when the Desktop pool bridge is unavailable**:
  * Without `window.hermesDesktop.setPoolLimits`, the plugin displays a default 3-slot limit as an estimate; pool controls are disabled.
  * Slot adjustment buttons are disabled with a descriptive tooltip. Monitoring and switch warnings remain available; turn interruption uses the `session.interrupt` Gateway RPC.
* **Tracked / Estimated Backend State**:
  * Because Hermes Desktop does not emit internal process exit events to plugins, active slots are **estimated from observed Gateway activity and idle expiration timers**. This is an estimate, not a guarantee that a backend process is still running.
  * The capacity warning is heuristic. It cannot stop a new session from timing out, and the plugin does not implement a backend process or slot-release API.
* **SDK and Gateway compatibility**:
  * UI, profile routing, and Gateway events use the public `@hermes/plugin-sdk`. Pool limit controls use the optional Desktop bridge and are feature-detected.

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

Hermes Desktop の **バックエンド枠の推定使用状況と推論状態を監視し、プロフィール切り替えを支援する** プラグインです。表示する枠数やタイムアウト回避は保証ではなく推定です。

---

## 🎯 背景・開発理由

Hermes Desktop は複数のエージェントを切り替えるため、バックエンドをプール管理します。枠数やビジー表示だけからは実際の空き状況を完全には把握できず、プロフィール切り替え時のタイムアウトを防げる保証はありません。

この **Agent Active Manager** は、Gateway イベントから活動状態を推定して表示し、応答が止まったターンを中断する手段と、推定容量に達した際の注意を提供します。バックエンドプロセスの終了やスロット解放を保証する機能ではありません。

---

## 🌟 主な機能

### 1. スロット枠 ＆ 推計使用状況の表示
* 推論イベントとLRU退避時間からアクティブバックエンド数（例: `3 / 3 Active (Est.)`）を推計し、カラーゲージで表示。
* 実行中のエージェントは `Busy`、メモリにキャッシュ保持されているエージェントは `♨️ Warm` として明確に区別して表示。
* スロット上限（`+1` / `-1`）とアイドル退避時間を変更できます。値の変更は Desktop pool-control bridge がある場合に有効です。

### 2. 応答が止まったターンの中断
* エージェントのタスク・推論が120秒以上継続した場合（フリーズ・スタック疑い）に `↺ Interrupt Turn` ボタンを表示し、対象のランタイムセッションIDを指定して、現行 Gateway が提供する `session.interrupt` を送信。
* ホストがビジーと報告する各セッションへ `session.interrupt` を並行送信する `↺ Interrupt All` ボタンを装備。停止するのは実行中ターンであり、バックエンドプロセス終了やスロット解放を保証するものではありません。

### 3. 直前の推論履歴の追跡
* どのアクティブエージェントが「いつ、何秒間、どんな処理（推論またはツール実行）」を完了したかをタイムスタンプ付き（例: `⏱ Last: 15s ago (4s / Tool: search)`）で表示。
* 現在リアルタイムに推論中（`🧠 Busy`）またはツール実行中（`⚡ tool_name`）のエージェントをハイライト表示。

### 4. 全枠ビジーと推定した場合の切り替え警告
* 観測した活動が推定容量に達した状態で切り替えようとすると、Desktop pool-control bridge がある場合に警告ダイアログを表示します。使用状況は推定であり、警告や容量の一時拡張でもタイムアウトを防げる保証はありません。
  * 実行中のエージェント名と経過時間を表示します。
  * bridge がある場合は容量を一時拡張して切り替える、リスクを承知で続ける、またはキャンセルできます。
  * bridge がない場合は警告を出さず通常どおり切り替えます。

### 5. プロフィール切り替え
* 対象プロフィールの保存済みセッションIDと公開 SDK の `openSession` / routed Gateway API を使います。プロフィール名が複数 Gateway route と一致し、所有元を確定できない場合は誤った route を選ばず切り替えを中止します。

---

## ⚙️ 互換性および Desktop 内部 API について

* **推奨環境**: 現行の Hermes Desktop
* **Desktop 内部 API の利用について**:
  * スロット上限数（`maxBackends`）とアイドル退避時間（`idleMs`）の変更機能は `window.hermesDesktop.setPoolLimits` を利用します。
* **Desktop pool bridge が利用できない場合のフォールバック**:
  * `window.hermesDesktop.setPoolLimits` が利用できない場合は、デフォルト値の3枠を推定値として表示し、スロット操作を無効にします。
  * スロット変更ボタンは無効化されます。監視と切り替え警告は継続し、実行中ターンの中断には Gateway の `session.interrupt` を利用します。
* **推計追跡（Tracked / Estimated）アーキテクチャについて**:
  * Hermes Desktop の仕様上、アイドルプロセスの内部終了イベント（kill通知）はプラグインへ公開されていません。そのため本プラグインでは、**観測した Gateway 活動とアイドル退避時間からアクティブ枠数を推計**します。バックエンドの実プロセス状態を保証するものではありません。
  * 全枠ビジーの警告は推定情報です。新しいセッションのタイムアウトを防止するものではなく、バックエンド停止やスロット解放 API を実装しているわけではありません。
* **SDK / Gateway 互換性**:
  * UI・プロフィールルーティング・Gateway イベントには公開 `@hermes/plugin-sdk` を利用します。スロット設定は任意提供の Desktop bridge capability を検出して操作します。

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

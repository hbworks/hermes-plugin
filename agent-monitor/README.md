# Hermes Desktop - Agent Activity Monitor Plugin

[ English | [日本語](#japanese) ]

A desktop plugin for Hermes Desktop to visualize, inspect, and monitor AI agent reasoning and tool activity in real time.

---

## 🌟 Key Features

1. **Real-time Inference Visualization**
   - Monitors whether each agent/session is currently active ("Thinking / Running") or "Idle".
   - Displays a live elapsed time counter since inference began.
2. **Gateway Live Event Stream**
   - Streams incoming Gateway events (thinking blocks, tool invocations, outgoing messages) in real time.
   - Provides filtering controls ("All" vs "Inference & Tools") and log clearing.
3. **Pane & Route Dual-View**
   - Dockable as a persistent right-hand sidebar pane (Width: `320px`, opened by default).
   - Also accessible via `/agent-monitor` route for dedicated full-screen monitoring.

---

## 🚀 Installation

Place the folder into the Hermes Desktop plugins directory `~/.hermes/desktop-plugins/`.

### Option A: Copy Files

```bash
mkdir -p ~/.hermes/desktop-plugins
cp -r ./agent-monitor ~/.hermes/desktop-plugins/
```

### Option B: Symbolic Link (Recommended for Development)

```bash
mkdir -p ~/.hermes/desktop-plugins
ln -s "$(pwd)/agent-monitor" ~/.hermes/desktop-plugins/agent-monitor
```

> [!NOTE]
> - Hermes Desktop supports hot-reloading and will detect the plugin immediately.
> - If the panel does not show up, go to **Settings → Plugins** to ensure `Agent Activity Monitor` is enabled.

---

## 📁 Directory Structure

```text
agent-monitor/
├── plugin.js       # Plugin implementation (ESM / @hermes/plugin-sdk)
└── README.md       # Documentation
```

<br>

---
<a id="japanese"></a>

# Hermes Desktop - Agent Activity Monitor Plugin (日本語)

[ [English](#hermes-desktop---agent-activity-monitor-plugin) | 日本語 ]

Hermes Desktop のボットモード等で各AIエージェントが推論・実行している間の状態をリアルタイムに可視化・監視するためのデスクトッププラグインです。

---

## 🌟 主な機能

1. **推論状態のリアルタイム可視化**
   - 各エージェント（セッション）が現在「推論/ツール実行中 (Thinking / Running)」か「待機中 (Idle)」かを常時監視。
   - 推論開始からの経過秒数カウンターを表示。
2. **Gateway ライブイベントストリーム**
   - Gateway から届くイベント（思考プロセス、ツール呼び出し、メッセージ送信等）をリアルタイムに一覧表示。
   - 「すべて / 推論・ツール」のフィルタリングやログのクリア機能。
3. **ペイン & ルート両対応**
   - 右ペイン（幅 320px、デフォルト表示）として常駐表示可能。
   - `/agent-monitor` ルートとしても登録されているため、独立した大画面でのモニタリングも可能。

---

## 🚀 インストール手順

Hermes Desktop のプラグインディレクトリ `~/.hermes/desktop-plugins/` に配置することで自動認識されます。

### コピーして導入する場合

```bash
mkdir -p ~/.hermes/desktop-plugins
cp -r ./agent-monitor ~/.hermes/desktop-plugins/
```

### シンボリックリンクで導入する場合（開発・更新が即反映）

```bash
mkdir -p ~/.hermes/desktop-plugins
ln -s "$(pwd)/agent-monitor" ~/.hermes/desktop-plugins/agent-monitor
```

> [!NOTE]
> - Hermes Desktop はホットリロードに対応しているため、配置後すぐに自動認識されます。
> - 画面に表示されない場合は、**Settings → Plugins** を開き、`Agent Activity Monitor` が有効になっているかご確認ください。

---

## 📁 ディレクトリ構成

```text
agent-monitor/
├── plugin.js       # プラグイン本体（ESM形式 / @hermes/plugin-sdk 対応）
└── README.md       # 本ドキュメント
```

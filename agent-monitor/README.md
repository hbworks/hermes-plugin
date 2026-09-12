# Hermes Desktop - Agent Activity Monitor Plugin

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

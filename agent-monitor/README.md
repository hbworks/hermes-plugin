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
   - 右ペイン（幅 340px）として常駐表示可能。
   - `/agent-monitor` ルートとしても登録されているため、大画面でのモニタリングも可能。

---

## 🚀 インストール手順

Hermes Desktop のプラグインディレクトリ `~/.hermes/desktop-plugins/agent-monitor/` に `plugin.js` をコピーするだけで導入できます。

### コピー用コマンド

```bash
# プラグイン配置先へディレクトリごとコピー
mkdir -p ~/.hermes/desktop-plugins
cp -r ./agent-monitor ~/.hermes/desktop-plugins/

# または個別コピー
# mkdir -p ~/.hermes/desktop-plugins/agent-monitor
# cp ./agent-monitor/plugin.js ~/.hermes/desktop-plugins/agent-monitor/plugin.js
```

> **Note:**
> Hermes Desktop はホットリロードに対応しているため、ファイルをコピーした直後に自動認識されます。
> 画面に表示されない場合は、**Settings → Plugins** を開き、`Agent Activity Monitor` が有効になっているかご確認ください。

---

## 📁 ディレクトリ構成

```text
hermes-plugin/
└── agent-monitor/
    ├── plugin.js       # プラグイン本体（ESM形式 / @hermes/plugin-sdk 対応）
    └── README.md       # 本ドキュメント
```


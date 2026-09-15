# Preview Language Override (Hermes Desktop Plugin)

[ English | [日本語](#日本語) ]

A Hermes Desktop plugin that lets you choose the language tags used by the in-app preview browser.

## Features

- Builds a configurable `Accept-Language` value for preview-browser top-level navigations.
- Overrides `navigator.language` and `navigator.languages` in the preview page.
- Attempts to use a small webview preload on subsequent reloads so the navigator override can run in the page's main world at document start.
- Applies the setting to existing preview tabs and automatically handles new preview webviews.
- Persists the language list through the plugin-scoped Hermes storage.
- Supports up to 10 BCP 47 language tags, such as `ja-JP`, `fr-FR`, and `zh-Hant-TW`.

The first tag is used as `navigator.language` and as the highest-priority HTTP language. Remaining tags receive descending quality values in the generated header. For example, `ja-JP, ja, en-US` becomes:

```text
Accept-Language: ja-JP,ja;q=0.9,en-US;q=0.8
navigator.language: ja-JP
navigator.languages: ja-JP,ja,en-US
```

## Important behavior and limitations

- The plugin targets Hermes Desktop's preview `<webview>` (`persist:hermes-preview`). It does not change the system browser, `browser_*` automation sessions, or the Hermes app renderer itself.
- Applying a setting reloads the current preview page. This is required so the first top-level request can carry the new header; unsaved state in that page may be lost.
- The header is supplied through the webview's `loadURL(..., { extraHeaders })` path for explicit address-bar/plugin navigations and Apply reloads. Page-initiated links and form submissions are not intercepted, so their HTTP method and body are preserved; those requests use Chromium's normal session header.
- The plugin assigns `preload.js` on a best-effort basis. Existing WebView guests may already have been created before the attribute changes, so the post-load fallback is authoritative for existing tabs. When the preload is accepted, it can inject into the page's main world at document start; otherwise very early scripts can observe Chromium's native values. The plugin does not claim to change every iframe's navigator object.
- The preload handoff uses a short-lived `window.name` marker containing only the selected language list; the marker is cleared after the document settles. Pages that depend on `window.name` should be tested explicitly.
- Hermes' native hard-reload action is left untouched to preserve cache-bypass and reload semantics; its request may therefore use Chromium's normal session header.
- This is a renderer-side desktop plugin workaround. A future Hermes SDK hook around `webview` creation / `webRequest.onBeforeSendHeaders` would be the stronger way to guarantee document-start navigator values and session-wide headers.

## Installation

Place the folder into the Hermes Desktop plugins directory `~/.hermes/desktop-plugins/`.

### Option A: Copy Files

```bash
mkdir -p ~/.hermes/desktop-plugins
cp -r ./preview-language-override ~/.hermes/desktop-plugins/
```

### Option B: Symbolic Link (Recommended for Development)

```bash
mkdir -p ~/.hermes/desktop-plugins
ln -s "$(pwd)/preview-language-override" ~/.hermes/desktop-plugins/preview-language-override
```

After launching (or reloading) Hermes Desktop, enable **Preview Language Override** in **Settings → Plugins**. It is opt-in (`defaultEnabled: false`) so installing it does not silently alter existing browsing. Open the **Preview Language** pane or the `/preview-language` route, enter the tags, and choose **Apply & Reload Preview**.

> [!NOTE]
> If the plugin is not listed, use **⌘K → Reload desktop plugins** and check the plugin enable state.

## Directory structure

```text
preview-language-override/
├── plugin.js
├── preload.js
└── README.md
```

## Verification

```bash
node --check preview-language-override/plugin.js
node --check preview-language-override/preload.js
```

<br>

---
<a id="japanese"></a>

# Preview Language Override (Hermes Desktop プラグイン)

[ [English](#preview-language-override-hermes-desktop-plugin) | 日本語 ]

Hermes Desktop のプレビューブラウザで、言語タグを任意に指定するためのプラグインです。

### できること

- プレビューブラウザのトップレベル遷移に付与する `Accept-Language` を設定
- プレビュー内ページの `navigator.language` と `navigator.languages` を上書き
- リロード後は WebView の preload を試行し、受理された場合はページの document-start で navigator 値を設定
- 既存タブへの適用と、新しく作られたプレビュー WebView への自動適用
- プラグイン専用ストレージへの設定保存
- `ja-JP`、`fr-FR`、`zh-Hant-TW` などの BCP 47 言語タグに対応（最大10個）

入力したリストの先頭が `navigator.language` と最優先の HTTP 言語になります。たとえば `ja-JP, ja, en-US` の場合は次の値になります。

```text
Accept-Language: ja-JP,ja;q=0.9,en-US;q=0.8
navigator.language: ja-JP
navigator.languages: ja-JP,ja,en-US
```

### 制限事項

- 対象は Hermes Desktop 内のプレビュー WebView（`persist:hermes-preview`）です。通常のシステムブラウザ、`browser_*` 自動操作セッション、Hermes 本体の UI には影響しません。
- 適用時は現在のプレビューページをリロードします。未保存のページ状態が失われる可能性があります。
- HTTP ヘッダーは WebView の `loadURL(..., { extraHeaders })` 経由で、アドレスバーやプラグインが開始する遷移、Apply 時のリロードに設定します。ページ起点のリンクやフォーム送信は HTTP メソッドと本文を壊さないため傍受せず、通常の Chromium セッションヘッダーを使います。
- `preload.js` の設定は best-effort です。既存 WebView のゲストが先に作成されている場合は post-load のフォールバックを使用します。preload が受理された場合は main world の document-start で上書きできますが、受理されない場合は非常に早いスクリプトや iframe で元の値が見える場合があります。
- preload への設定受け渡しには、選択した言語リストだけを含む短時間の `window.name` マーカーを使い、ドキュメント確定後に削除します。`window.name` に依存するページは個別に確認してください。
- Hermes 本体のハードリロード動作は、キャッシュ無視や reload semantics を壊さないため変更していません。そのリクエストでは通常の Chromium セッションヘッダーが使われる場合があります。

### 導入

Hermes Desktop のプラグインディレクトリ `~/.hermes/desktop-plugins/` に配置することで自動認識されます。

#### コピーして導入する場合

```bash
mkdir -p ~/.hermes/desktop-plugins
cp -r ./preview-language-override ~/.hermes/desktop-plugins/
```

#### シンボリックリンクで導入する場合（開発・更新が即反映）

```bash
mkdir -p ~/.hermes/desktop-plugins
ln -s "$(pwd)/preview-language-override" ~/.hermes/desktop-plugins/preview-language-override
```

Hermes Desktop を起動（または再読み込み）すると、**Settings → Plugins** から **Preview Language Override** を有効化できます。`defaultEnabled: false` のオプトイン方式のため、インストールしただけでは既存のブラウジングに影響しません。**Preview Language** ペインまたは `/preview-language` を開き、言語タグを入力して **Apply & Reload Preview** を押してください。

> [!NOTE]
> 表示されない場合は **⌘K → Reload desktop plugins** を実行し、プラグインの有効化状態を確認してください。

## 📁 ディレクトリ構成

```text
preview-language-override/
├── plugin.js       # プラグイン本体
├── preload.js      # WebView の document-start 用 preload
└── README.md       # 本ドキュメント
```

## 🔍 検証

```bash
node --check preview-language-override/plugin.js
node --check preview-language-override/preload.js
```

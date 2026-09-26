# Hermes LLM Cost JPY

Hermes Desktopのフォーカス中セッションについて、SDKが提供する使用量からLLMコストを推定または表示し、日本円へ換算するStandalone Desktop Pluginです。

## 配置

```text
$HERMES_HOME/desktop-plugins/hermes-llm-cost-jpy/plugin.js
$HERMES_HOME/desktop-plugins/hermes-llm-cost-jpy/cost.mjs
```

配置後、Hermes Desktopのプラグインを再読み込みしてください。

Runtime pluginのentrypointは`plugin.js`単体です。Hermes Desktopのloaderはentrypointから相対`./cost.mjs`を解決しないため、料金表と計算関数は`plugin.js`にも内包しています。`cost.mjs`はNode.js計算テスト用のミラーです。

## 設定

ステータスバー右側の`Cost n/a`、`¥—`、または金額をクリックし、USD/JPYレートを入力して保存します。レートはプラグイン名前空間の`ctx.storage`へ保存され、為替APIでは更新されません。

## 固定料金表

料金は公式料金または公開料金情報に基づく概算です。Batch、Flex、Fast/Priority、リージョン加算、音声・画像・動画専用料金は含めません。単位はUSD / 1M tokensです。

### OpenAI (`openai-api`)

| Provider | Model | Input / 1M | Cached input / 1M | Cache write / 1M | Output / 1M |
| --- | --- | ---: | ---: | ---: | ---: |
| `openai-api` | `gpt-6-astra` | `$10.00` | `$1.00` | `$12.50` | `$50.00` |
| `openai-api` | `gpt-5.6-sol` | `$4.00` | `$0.40` | `$5.00` | `$20.00` |
| `openai-api` | `gpt-5.6-terra` | `$2.00` | `$0.20` | `$2.50` | `$12.00` |
| `openai-api` | `gpt-5.6-luna` | `$0.20` | `$0.02` | `$0.25` | `$1.20` |
| `openai-api` | `gpt-5.5` | `$5.00` | `$0.50` | `—` | `$30.00` |
| `openai-api` | `gpt-5.5-pro` | `$30.00` | `—` | `—` | `$180.00` |
| `openai-api` | `gpt-5.4` | `$2.50` | `$0.25` | `—` | `$15.00` |
| `openai-api` | `gpt-5.4-mini` | `$0.75` | `$0.075` | `—` | `$4.50` |
| `openai-api` | `gpt-5.4-nano` | `$0.20` | `$0.02` | `—` | `$1.25` |
| `openai-api` | `gpt-5.4-pro` | `$30.00` | `—` | `—` | `$180.00` |
| `openai-api` | `gpt-5.2` | `$1.75` | `$0.175` | `—` | `$14.00` |
| `openai-api` | `gpt-5.2-pro` | `$21.00` | `—` | `—` | `$168.00` |
| `openai-api` | `gpt-5.1` | `$1.25` | `$0.125` | `—` | `$10.00` |
| `openai-api` | `gpt-5` | `$1.25` | `$0.125` | `—` | `$10.00` |
| `openai-api` | `gpt-5-mini` | `$0.25` | `$0.025` | `—` | `$2.00` |
| `openai-api` | `gpt-5-nano` | `$0.05` | `$0.005` | `—` | `$0.40` |
| `openai-api` | `gpt-5-pro` | `$15.00` | `—` | `—` | `$120.00` |
| `openai-api` | `gpt-4.1` | `$2.00` | `$0.50` | `—` | `$8.00` |
| `openai-api` | `gpt-4.1-mini` | `$0.40` | `$0.10` | `—` | `$1.60` |
| `openai-api` | `gpt-4.1-nano` | `$0.10` | `$0.025` | `—` | `$0.40` |
| `openai-api` | `gpt-4o` | `$2.50` | `$1.25` | `—` | `$10.00` |
| `openai-api` | `gpt-4o-2024-05-13` | `$5.00` | `—` | `—` | `$15.00` |
| `openai-api` | `gpt-4o-mini` | `$0.15` | `$0.075` | `—` | `$0.60` |
| `openai-api` | `o1` | `$15.00` | `$7.50` | `—` | `$60.00` |
| `openai-api` | `o1-pro` | `$150.00` | `—` | `—` | `$600.00` |
| `openai-api` | `o3-pro` | `$20.00` | `—` | `—` | `$80.00` |
| `openai-api` | `o3` | `$2.00` | `$0.50` | `—` | `$8.00` |
| `openai-api` | `o4-mini` | `$1.10` | `$0.275` | `—` | `$4.40` |
| `openai-api` | `o3-mini` | `$1.10` | `$0.55` | `—` | `$4.40` |

OpenAIの長文脈料金は、明示的に`long_context === true`または`pricing_tier === 'long'`を受け取った場合だけ使います。対象は`gpt-6-astra`、`gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-5.6-luna`、`gpt-5.5`、`gpt-5.5-pro`、`gpt-5.4`、`gpt-5.4-pro`です。Geminiのlong tierも明示フラグがある場合だけ使います。現行Hermes TUI Gatewayの`focusedUsage`は`long_context`と`pricing_tier`を送信せず、`UsageStats`もセッション累計でリクエスト単位の閾値を公開しないため、標準Desktopのライブ表示ではlong tierへ切り替わりません。

### Google Gemini (`gemini`)

| Model | Input / 1M | Cached input / 1M | Output / 1M |
| --- | ---: | ---: | ---: |
| `gemini-3.8-flash` | `$0.75` | `$0.075` | `$3.75` |
| `gemini-3.7-flash` | `$0.75` | `$0.075` | `$3.75` |
| `gemini-3.6-flash` | `$0.75` | `$0.075` | `$3.75` |
| `gemini-3.5-flash` | `$1.50` | `$0.15` | `$9.00` |
| `gemini-3.5-flash-lite` | `$0.30` | `$0.03` | `$2.50` |
| `gemini-3.1-flash-lite` | `$0.25` | `$0.025` | `$1.50` |
| `gemini-3-flash-preview` | `$0.50` | `$0.05` | `$3.00` |
| `gemini-3.1-pro-preview` | `$2.00` | `$0.20` | `$12.00` |
| `gemini-2.5-pro` | `$1.25` | `$0.125` | `$10.00` |
| `gemini-2.5-flash` | `$0.30` | `$0.03` | `$2.50` |
| `gemini-2.5-flash-lite` | `$0.10` | `$0.01` | `$0.40` |

`gemini-3.1-pro-preview`と`gemini-2.5-pro`は、明示long tierでそれぞれ`$4.00 / $0.40 / $18.00`と`$2.50 / $0.25 / $15.00`を使います。Geminiのcache storage時間料金、音声専用料金、画像・動画の専用単価はこのtoken計算へ混ぜません。

### LongCat (`longcat`)

| Model | Input / 1M | Cached input / 1M | Output / 1M |
| --- | ---: | ---: | ---: |
| `LongCat-2.0` | `$0.30` | `$0.006` | `$1.20` |

`LongCat-2.0`のキャッシュ入力は、入力料金から98%割引された`$0.006 / 1M tokens`として概算します。`longcat-2-0`のようなArtificial AnalysisのURL由来のモデル表記や、`longcat-api`プロバイダーも同じ料金へ正規化します。

### NVIDIA Nemotron (`nvidia`)

| Model | Input / 1M | Cached input / 1M | Output / 1M |
| --- | ---: | ---: | ---: |
| `Nemotron 3 Super 120B A12B` | `$0.193` | `—` | `$0.65` |

`nvidia/nemotron-3-super-120b-a12b`とURL由来の`nvidia-nemotron-3-super-120b-a12b`を同じモデルとして扱い、`nvidia-api`プロバイダーも同じ料金へ正規化します。Artificial Analysisに記載されるIntelligence Indexのタスクあたりコスト`$1.06`はベンチマーク指標のため、トークン単価の概算には使用しません。キャッシュ単価は未指定です。

### Anthropic (`anthropic`)

| Model | Input / 1M | Cache read / 1M | 5m cache write / 1M | Output / 1M |
| --- | ---: | ---: | ---: | ---: |
| `claude-fable-5-1` | `$10.00` | `$0.25` | `$12.50` | `$50.00` |
| `claude-opus-5` | `$5.00` | `$0.50` | `$6.25` | `$25.00` |
| `claude-sonnet-5` | `$2.00` | `$0.20` | `$2.50` | `$10.00` |
| `claude-haiku-4-5` | `$1.00` | `$0.10` | `$1.25` | `$5.00` |
| `claude-haiku-4-5-20251001` | `$1.00` | `$0.10` | `$1.25` | `$5.00` |

Anthropicの`cache_creation_input_tokens`は、現行schemaにTTL字段がないため5分cache writeとして計算します。1時間cache writeを自動推測しません。Claude 4.6以降の1M contextはStandard料金で扱われるため、OpenAI/Geminiのような長文脈割増tierは登録していません。

出典:

- OpenAI: <https://developers.openai.com/api/docs/pricing>
- Google Gemini: <https://ai.google.dev/gemini-api/docs/pricing>
- Anthropic: <https://platform.claude.com/docs/en/about-claude/pricing>
- LongCat: <https://artificialanalysis.ai/ja/models/longcat-2-0>
- NVIDIA Nemotron: <https://artificialanalysis.ai/ja/models/nvidia-nemotron-3-super-120b-a12b>

確認日: `2026-09-18`

料金表は固定定義です。実行時に料金API・為替API・外部ネットワークへアクセスしません。料金改定時は`plugin.js`、テスト用の`cost.mjs`、このREADMEを手動で更新してください。

## 計算ルール

- 互換usageに有限な非負数の`actual_cost_usd`があれば実績値として最優先し、`0`も有効値として扱います。次に`estimated_cost_usd`（`0`を含む）、正の旧形式`cost_usd`、ローカルのトークン推定の順に使います。旧Gatewayの`cost_usd`は`estimate_usage_cost`由来の推定値なので、実績値ではなく`estimated`として扱います。
- 標準Hermes TUI Gatewayの`_get_usage()`は[core change fd2a35b](https://github.com/NousResearch/hermes-agent/commit/fd2a35b1691138b79b606e7961d3c78f7019722b)で`cost_usd`と`cost_status`の生成が削除され、現在も`actual_cost_usd`や`estimated_cost_usd`を送信しません。契約型に一部のcostフィールドが残っていても、このproducerからは届きません。プラグインはrawな`focusedUsage`を読むため、標準Desktop経路ではこれらの互換分岐に入らず、対応モデルの有効なtoken数があれば固定料金表によるローカル推定（なければ`included`/`unknown`）になります。
- 現行SDKでproviderが取得できない場合、または取得したproviderに料金表上の一致がない場合は、モデル名が固定料金表上で一意に対応するときだけ公式API料金のproviderを補完します。`openai/gpt-5.6-luna`のようなprovider接頭辞付きモデル名は接頭辞を除いて照合します。複数providerに同名モデルがある場合や、モデルが料金表にない場合は`Cost n/a`にします。`focusedSessionProfile`をproviderとして推測しません。
- 公開されている`host.state.model`はmain modelです。フォーカス中セッションの`focusedUsage.model`が提供される場合はそれを優先し、提供されないタイルではmodelを推測せず、固定料金によるフォールバックを停止します。
- `focusedUsage.input`はキャッシュされていない入力、`focusedUsage.total`はキャッシュ読み取り・書き込みと出力を含む累計です。キャッシュ内訳が明示された入力を優先し、内訳がない現行SDKでは`total - input - output`を追加入力として復元します。`cache_hit_pct`があれば読み取りと書き込みへ分け、割合がない場合は追加分をcache writeとして扱います。Anthropicの`cache_read_input_tokens`と`cache_creation_input_tokens`も読み取ります。
- `total`やreasoning tokensは入力・出力へ重複加算しません。
- 標準TUI Gateway経由の現在の表示額はGateway実績値ではなく、セッション累計の`focusedUsage`へ固定料金表を適用したローカル推定値です。別の互換producerが上記cost fieldsを供給する場合も含め、請求画面の代替にはなりません。APIコール単位の段階料金・最低料金・モデルやproviderの切替・キャッシュやreasoning tokenの扱い・プロバイダー固有の丸めや割引が累計usageへ完全に反映されない場合、実際の請求額と乖離することがあります。正確な請求額は各プロバイダーの請求情報を確認してください。
- 固定料金表にないprovider/modelは`Cost n/a`であり、`¥0`にはしません。
- セッションIDは`focusedStoredSessionId`を優先し、永続IDがまだ確定していない場合だけruntime IDを一時キーとして使います。usageにセッションIDが含まれる場合は表示中IDと一致するときだけ保存します。有効なコストをUSDスナップショットとしてプラグインの`ctx.storage`へ最大200件保存し、履歴には最新10件を表示します。履歴表示時のJPYは現在の換算レートから再計算し、設定欄のクリア操作で削除できます。

## 検証

```bash
node hermes-llm-cost-jpy/scripts/sync-cost-runtime.mjs --check
node --check hermes-llm-cost-jpy/plugin.js
node hermes-llm-cost-jpy/test-cost.mjs
```

Desktop上では、プラグイン再読み込み、レート設定、モデル変更、セッション切替、料金未登録モデルを確認してください。

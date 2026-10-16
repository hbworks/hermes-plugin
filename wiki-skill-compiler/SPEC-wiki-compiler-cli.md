# Wiki Compiler 仕様（wiki-skill-evolution の CLI）

ステータス: **草案（実装前）**。コードは未作成です。

## 1. 目的

`wiki-skill-evolution` が記録したエラーログから、スキルごとの永続知識 `references/wiki.md` を**ローカル LLM で蒸留して追記する**。

SKILL.md の書き換えは行わない。書き換えは、`wiki.md` を参照させたフロンティアモデルの通常セッションで行う。

## 2. 決定事項

| 項目 | 決定 |
|---|---|
| 形態 | `wiki-skill-evolution/tools/compile_wiki.py` の CLI のみ |
| Hermes への登録 | しない（`register()` にツール・フックを追加しない） |
| 実行の契機 | 手動のみ（cron・自動実行なし） |
| 書き込み対象 | `skills/<...>/<skill>/references/wiki.md` と `skill-impact.md` |
| SKILL.md | 読み取りも書き込みもしない |
| LLM | ローカルのみ（既定 `http://127.0.0.1:8080/v1`、`mlx_vlm.server`） |
| 既定の動作 | 読み取りのみ（dry-run）。書き込みは `--apply` のみ |
| 既定の lookback | 6 時間（`run_wiki_skill_evolution` と同じ） |
| 複数スキル | 1 件失敗しても残りを続行し、終了コード 1 で返す |

`skill-impact.md` は WikiSkill 論文（arXiv:2608.27454）の同名ファイルを、本 CLI の文脈に翻訳したもの。
論文では「スキル変更案の採用/却下と検証スコア」を記録するが、本 CLI は SKILL.md を書き換えず検証スコアも持たないため、
**「応答検査（§6）で不合格になった蒸留案」を却下ログとして記録する**。目的は論文と同じく、
過去に却下した内容を次回 Wiki Maintainer に読ませて再提案を防ぐこと（§7.1 参照）。

`skill-impact.md` は `wiki.md` と同じく**追記のみ**で、既存内容を書き換えず、ロールバックしない。

## 3. CLI の契約

```bash
python3 tools/compile_wiki.py --hermes-home <dir> --model <name> \
  [--skill <name>] [--hours 6] [--apply] [--base-url <url>] [--reprocess]
```

### 3.1 引数

| 引数 | 必須 | 既定 | 説明 |
|---|---|---|---|
| `--hermes-home` | はい | なし | 対象プロファイルの Hermes home。プロファイルの取り違え防止のため必須 |
| `--model` | はい | 環境変数 `WIKI_COMPILER_MODEL` | `GET /v1/models` の返す名前 |
| `--skill` | いいえ | 全スキル | 指定時は 1 件のみ対象 |
| `--hours` | いいえ | `6` | エラーログの lookback 時間 |
| `--apply` | いいえ | なし | 指定時のみ `wiki.md` と状態ファイルを書く |
| `--base-url` | いいえ | `http://127.0.0.1:8080/v1` | 接続先。ホストは `127.0.0.1` / `localhost` / `::1` のみ |
| `--reprocess` | いいえ | なし | `--skill` と併用必須。そのスキルの処理済み記録を消して再処理 |

- `--reprocess` を `--skill` なしで使うと、引数エラー（終了コード 2）。
- `--apply` なしの実行は、LLM を呼び、結果を表示するが、ファイルと状態を変更しない。

### 3.2 優先順位

値の決定は次の順で行う（上ほど優先）。

1. CLI 引数
2. 環境変数（`WIKI_COMPILER_BASE_URL`、`WIKI_COMPILER_MODEL`）
3. 組み込みの既定値

`--hermes-home` には環境変数のフォールバックを設けない（取り違え防止）。

### 3.3 終了コード

| コード | 意味 |
|---|---|
| 0 | 成功。または対象なし |
| 1 | 一部のスキルが不合格（ほかは成功しうる） |
| 2 | 引数の誤り（`--hermes-home` の欠落、`--reprocess` の単独使用、非ローカルの `--base-url` など） |
| 3 | LLM サーバーに接続できない、または `--model` が応答しない |
| 4 | ロックを取得できない（別の実行が進行中） |

### 3.4 出力

- 標準出力に **JSON** を 1 つ出す。
- 内容: 実行モード（dry-run / apply）、lookback、スキルごとの対象件数、除外件数と理由（`default_skill` など）、追記の有無、不合格の理由。
- エラーログの本文と引数の値は出力しない（件数と理由のみ）。
- `skill-impact.md` への却下記録の有無と件数も JSON に含める（内容そのものは出力しない）。

## 4. 処理の流れ

```
1. 引数を検査（§3.1 / §3.3 の 2）
2. 対象ホームを確定、ロック取得（<home>/logs/wiki-skill-compiler/.lock）
3. LLM サーバーの疎通確認（GET /v1/models）
4. ログを読む（.jsonl.1 → .jsonl、壊れた行は警告して飛ばす）
5. 秘密値をマスク（wiki-skill-evolution の既存関数を使う）
6. 選別: lookback 内、skill が妥当、既存スキルがある、未処理
   除外: default_skill / unknown / __verification_probe__ など
7. スキルごとに:
   a. 件数・文字数の上限で切り詰める
   b. 既存の wiki.md と skill-impact.md（却下ログ）を合わせて LLM に渡す
   c. 応答を検査（§6）
   d. 合格 かつ --apply → wiki.md に追記 → 状態ファイルに処理済みを追加
   e. 不合格 かつ --apply → skill-impact.md に却下を記録（§7.1 の形式）
8. JSON を出力、ロック解放
```

- 状態ファイルへの記録は、**Wiki への書き込みが成功した後のみ**。
- 不合格のレコードは処理済みにしない（次回再試行）。
- `skill-impact.md` への記録も `--apply` があるときのみ。dry-run ではファイルを一切変更しない。
- 却下記録に失敗しても、そのスキルの処理自体は続行する（記録失敗は警告のみ、終了コードには含めない）。

## 5. 安全策

| 起こりうること | 対処 |
|---|---|
| 別プロファイルを誤って処理 | `--hermes-home` を必須にする |
| 誤って書き込む | 既定は dry-run。`--apply` でのみ書く |
| 同じエラーの二重蒸留 | レコードの識別子（`sha256(ts, tool, skill, マスク後 error)`）を状態ファイルに記録 |
| 二重実行による破損 | `fcntl.flock` で排他（終了コード 4） |
| LLM が既存の内容を書き換える | 追記後の全文が既存内容で始まることを検査（接頭辞の検査） |
| LLM が前置きや推論を書く | 見出し形式を検査し、不合格なら何も書かない |
| 秘密値が Wiki に入る | LLM に送る前と、書き込む前の両方でマスク |
| symlink 経由の書き込み | `wiki.md`・`references/` が symlink なら拒否。解決後のパスが `skills/` 内か検査 |
| 途中で壊れたファイル | 一時ファイルに書いてから `os.replace` |
| 非ローカル LLM への送信 | `--base-url` のホストを検査し、外れたら終了コード 2 |
| 却下案に秘密値が残る | `skill-impact.md` に書く抜粋も、書き込み前に `_mask_secrets` を通す |
| `skill-impact.md` の肥大化 | 直近の却下記録のみ保持（既定 50 件）。超過分は古い順に圧縮（§7 の数値） |
| 却下案が既存 Wiki と重複して入力が膨らむ | LLM に入れる却下ログは直近の数件に切り詰める（既定 10 件） |

## 6. 応答の検査

LLM の応答は次の順で検査し、1 つでも失敗すれば何も書かない。

1. 空でない。
2. `### Pattern:` で始まるブロックだけで構成される（前置き・後書きは除去して判定）。
3. 各ブロックに `Symptoms` / `Root Cause` / `Resolution` がある。
4. 秘密値らしき文字列が残っていない。
5. 追記後の全文が既存内容で始まる（例: 既存が `A\nB` なら、結果は `A\nB\n...` でなければならず、`A\nX\n...` は不合格）。
6. 追記量が上限（既定 4,000 文字）以内。

検査は LLM の品質を保証しない。品質は人が `wiki.md` を読んで確認する。

不合格となった場合は、**どの検査で落ちたか**を保持する。`skill-impact.md` の却下理由（§7.1）に使うため。

## 7. 仮の数値

実機で確認してから確定する。現時点では仮の値。

| 項目 | 仮の値 | 確定条件 |
|---|---|---|
| 1 回の処理件数上限 | 50 件 | 実機のコンテキスト長と処理時間 |
| エラー本文の切り詰め | 500 文字 / 件 | 実ログの長さの分布（最大は約 2,000 文字） |
| 入力全体の上限 | 12,000 文字 | 実機のコンテキスト長 |
| 追記量の上限 | 4,000 文字 / 回 | 実際の追記量 |
| LLM タイムアウト | 600 秒 | 実機の処理時間 |

### 7.1 `skill-impact.md` の仕様

`skills/<...>/<skill>/references/skill-impact.md`。却下された蒸留案の記録。追記のみ。

#### 記録フォーマット

```markdown
## Rejected: <ISO8601 UTC>
- **対象エラー件数**: 3
- **却下理由**: 応答検査 §6.<n> 不合格（<検査項目名>）
- **却下内容（抜粋・マスク済・最大 800 文字）**:
  ```
  <LLM 応答の先頭部分>
  ```
```

- 抜粋はマスク後の文字列を使う。秘密値が残っていれば書かない。
- 同名スキルの記録は追記のみ。既存の記録は消さない（`wiki.md` と同じ方針）。

#### 上限と圧縮

| 項目 | 既定 |
|---|---|
| 保持する却下記録の件数 | 直近 50 件 |
| 1 件の抜粋の上限 | 800 文字 |
| LLM に入れる却下ログ | 直近 10 件に切り詰め |

50 件を超えたら、古い記録から順に削除する（`wiki.md` 本体は対象外）。
圧縮時に `os.replace` を使い、途中で壊れたファイルを残さない。

#### LLM への読ませ方

Wiki Maintainer プロンプト（§7.2 の Wiki Maintainer プロンプト）に以下を追加する。

```markdown
## Previously Rejected Proposals (skill-impact.md):
<直近 10 件の却下記録>

## Task:
...（既存のとおり）
IMPORTANT: Do NOT re-propose content substantially similar to the rejected entries above.
```

既存ファイルがない場合はこのセクション自体を省略する（空セクションを送らない）。

## 8. 前提と未確認事項

### 8.1 既知の問題と再開条件（実装の前提条件）
- 既存ログ 88 件（2026-09-17 〜 2026-10-11）は、すべて帰属修正前の記録。内訳は `default_skill` 84 件、`unknown` 4 件、`__verification_probe__` 1 件。
- 帰属修正は commit `1997fac`（2026-10-12 00:03 JST、`fix(wiki-skill-evolution): stop falling back to default_skill for failures`）。配備コピー（`profiles/coding/plugins/` と `~/.hermes/plugins/`）は checkout と同一であることを確認済み。
- 既存 88 件は、修正後のコードで再判定しても全件 `unknown` になる。ログに引数（`args`）が保存されておらず、スキル判定の材料がないため。**既存の記録は Wiki の材料にしない。**
- 修正後の記録は、この時点で 0 件。修正が機能しているかは未検証。
- **再開条件:** 修正後に発生したエラーが `evolution_errors.jsonl` に記録され、そのスキル名が正しいことを確認する。確認できるまで、CLI の実装は開始しない。
- 再開時の確認手順: 新規レコードの `ts` が 2026-10-12 00:03 JST 以降であることを確認し、`skill` の値を目視で検証する。`default_skill` / `unknown` の割合も集計する。

### 8.2 実装前の確認（結果）

| 項目 | 結果 |
|---|---|
| `GET /v1/models` | 応答あり。`loaded: true` のモデルの `id` は**ファイルパス**（`/Users/user-name/.lmstudio/models/lmstudio-community/gemma-4-26B-A4B-it-QAT-MLX-4bit`）。`--model` にはこの値を使う |
| 応答形式 | OpenAI 互換。`choices[0].message.content` に本文。`usage` と `timings` あり |
| 推論テキストの混入 | 確認した 2 回とも `reasoning` / `reasoning_content` は空、`content` に推論は混ざらず。ただし件数は少ないため、実ログで再確認する |
| 形式の遵守 | `### Pattern:` の形式で出力。前置きなし（`temperature: 0`、指示は「Markdown のみ」） |
| 処理時間 | 入力 262 トークン・出力 281 トークンで約 7.4 秒（約 38 tokens/s）。ピークメモリ約 16GB |
| コンテキスト長 | **未確認**。大きな入力で試していないため、§7 の上限は仮のまま |
| `loaded: false` のモデル | `mlx-community/gemma-4-26B-A4B-it-assistant-bf16`。今回の対象外 |

確認に使ったリクエストの形式は、`model` に上記のパス、`temperature: 0`、`max_tokens` は出力量に合わせて指定。

確認コマンド例:

```bash
curl -s http://127.0.0.1:8080/v1/models
curl -s http://127.0.0.1:8080/v1/chat/completions -H 'Content-Type: application/json' \
  -d '{"model":"<上で得た名前>","messages":[{"role":"user","content":"1+1は？"}],"max_tokens":64}'
```

サーバーの起動は、ユーザーの端末で行う。

### 8.3 未決事項（推奨案つき）
| 項目 | 推奨案 |
|---|---|
| プロンプトの言語 | 英語の指示 + 出力は日本語。確認後に決める |
| 既存パターンへの追記方法 | 同名のパターンがあれば「Recurrence」として追記 |

## 9. 受け入れ基準

1. `default_skill` / `unknown` / `__verification_probe__` のレコードが Wiki に入らない。
2. `--apply` を付けずに実行すると、ファイルと状態が変わらない。
3. 同じログを 2 回 `--apply` しても、二重追記されない。
4. 応答が不合格なら、`wiki.md` と SKILL.md が変わらない。
5. 既存の `wiki.md` が、追記の前後で接頭辞として残る。
6. `--base-url` が非ローカルなら、終了コード 2 で拒否される。
7. SKILL.md を読み書きするコードが含まれない。
8. 単体テストが通る（モック LLM を使用）。

### 9.1 `skill-impact.md` に関する受け入れ基準

9. 応答が不合格かつ `--apply` ありの実行で、`skill-impact.md` に却下が 1 件追記される。
10. dry-run（`--apply` なし）では `skill-impact.md` も変わらない。
11. `skill-impact.md` に書かれる抜粋に秘密値が残らない（マスク後の文字列である）。
12. 既存の `skill-impact.md` の記録が、追記の前後で接頭辞として残る。
13. `skill-impact.md` がないスキルに対しても、Wiki Maintainer プロンプトが壊れずに動く（セクション省略）。
14. 却下済みの内容を再提案させようとした際、LLM に却下ログが渡っている（プロンプトに却下記録が含まれる）。

## 10. 次の手順

1. §8.2 の確認（ユーザーの端末でサーバーを起動し、`curl` で応答を確認）。
2. 結果に応じて §7 の仮の値を確定。
3. 単体テストを先に書き、その後に `tools/compile_wiki.py` を実装。
4. 既存ログの 1 スキルで dry-run、人が出力を読んで判断。
5. 合格後に `--apply`。
6. `--apply` で不合格をわざと起こし、`skill-impact.md` に却下が記録されることを確認する（§9.1）。

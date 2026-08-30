import os
import json
import datetime
import re
from hermes_tools import (
    memory,
    skill_view,
    skill_manage,
    delegate_task,
    session_search,
    sqlite_search,
    sqlite_remember,
    terminal,
)

PLUGIN_NAME = "wiki_skill_evolution"
# スキル名については、memory から取得するか、固定で設定。
# ここではデフォルトとして "default_skill" を使うが、実際は
# memory から "wiki_skill_target" を参照できるようにしてもよい。
DEFAULT_SKILL_NAME = "default_skill"


def _now_str():
    return datetime.datetime.now().isoformat(timespec='seconds')


def _count_recent_errors(hours: int = 6) -> int:
    """直近 N 時間以内にエラー系ログが何件あるかを session_search で取得"""
    # エラーを示すキーワード（簡易）
    query = "error OR fail OR exception OR panic"
    res = session_search(query=query, limit=200)
    matches = res.get("matches", [])
    # ここではタイムスタンプフィルタは省略し、件数だけ返す。
    # 必要なら matches の中に埋め込まれたタイムスタンプでフィルタ可能。
    return len(matches)


def _get_latest_error() -> str | None:
    """最新のエラーログ文字列を取得（見つからなければ None）"""
    query = "error OR fail OR exception"
    res = session_search(query=query, limit=1, around_message_id=None)
    matches = res.get("matches", [])
    if not matches:
        return None
    # 各 match は "LINE_NUM|CONTENT" 形式なので、内容部分を取得
    latest = matches[0]
    if "|" in latest:
        _, content = latest.split("|", 1)
        return content.strip()
    return latest.strip()


def _extract_lesson_from_error(error_text: str) -> str | None:
    """エラーテキストから簡易な教訓文を生成（実際はもっと洗練させても良い）"""
    # ここでは単純にパターンマッチングで教訓を作る例
    err_lower = error_text.lower()
    if "importerror" in err_lower or "module not found" in err_lower:
        return (
            "[Python/Path] ImportError が発生。"
            " 解決策: 実行スクリプトの先頭で sys.path にプロジェクトルートを明示追加する。"
        )
    if "file not found" in err_lower or "no such file" in err_lower:
        return (
            "[IO/FileNotFound] ファイルが見つからない。"
            " 解決策: ファイルパスを絶対パスに変換するか、作業ディレクトリを確認する。"
        )
    if "timeout" in err_lower:
        return (
            "[Net/Timeout] ネットワークタイムアウトが発生。"
            " 解決策: リトライロジックまたはタイムアウト値を増やす。"
        )
    # それ以外は汎用教訓
    return f"[General] 失敗: {error_text[:200]}"


def _levenshtein_ratio(a: str, b: str) -> float:
    """二文字列の類似度（0〜1）をレーベンシュタイン距離で求める（簡易実装）"""
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
    # ワグナー・フィッシャーアルゴリズム
    len_a, len_b = len(a), len(b)
    dp = list(range(len_b + 1))
    for i in range(1, len_a + 1):
        prev = dp[0]
        dp[0] = i
        for j in range(1, len_b + 1):
            cur = dp[j]
            if a[i - 1] == b[j - 1]:
                dp[j] = prev
            else:
                dp[j] = 1 + min(prev, dp[j], dp[j - 1])
            prev = cur
    distance = dp[len_b]
    max_len = max(len_a, len_b)
    return 1.0 - (distance / max_len)


def _upsert_wiki_entry(lesson: str):
    """Wiki (memory) にタグ付きエントリを追加・重複排除・バージョン付与"""
    now_tag = f"v{datetime.datetime.now():%Y%m%d-%H%M%S}"
    tagged = f"{lesson} {now_tag}"

    # 同じカテゴリ（[xxx/yyy]）で類似があるか検索
    # 教訓の先頭トークン（例: "[Python/Path]"）をヒントに検索
    first_token = lesson.split()[0] if lesson else ""
    if not first_token.startswith("[") or not first_token.endswith("]"):
        # カテゴリタグがない場合はそのまま追加
        memory.add(target='memory', content=tagged)
        return

    hint = first_token.strip("[]")
    similar_res = sqlite_search(query=hint, limit=10)
    similar_items = similar_res.get("results", [])
    best_item = None
    best_ratio = 0.0
    for item in similar_items:
        content = item.get("content", "")
        ratio = _levenshtein_ratio(content, tagged)
        if ratio > best_ratio:
            best_ratio = ratio
            best_item = item

    # 類似度が 0.8 以上なら同じとみなして更新（バージョン付与で上書き）
    if best_item and best_ratio >= 0.8:
        old_content = best_item.get("content", "")
        memory.replace(
            target='memory',
            old_text=old_content,
            new_text=tagged
        )
    else:
        memory.add(target='memory', content=tagged)


def _propose_skill_patch(skill_name: str) -> bool:
    """ナレッジを元にスキルのセクションを丸ごと置換するパッチを作成し適用"""
    # 現在のスキル全体を取得
    skill_info = skill_view(name=skill_name)
    if not skill_info or "content" not in skill_info:
        memory.add(
            target='memory',
            content=f'[{PLUGIN_NAME}] スキル "{skill_name}" が見つからない'
        )
        return False
    current_text = skill_info["content"]

    # 対象セクションを正規表現で抽出（例: ## 実行手順）
    # ここでは最初に現れる "## 実行手順" から次の "##" またはファイル終端までを対象とする
    pattern = r"(## 実行手順\n)(.*?)(?=\n## |\Z)"
    match = re.search(pattern, current_text, flags=re.DOTALL)
    if not match:
        memory.add(
            target='memory',
            content=f'[{PLUGIN_NAME}] スキルに「## 実行手順」セクションが見つからない'
        )
        return False
    old_block = match.group(0)  # 置換対象ブロック全体

    # ナレッジ全体を取得（実際はフィルタリングしても良い）
    wiki_all_raw = memory(target='memory')
    # memory 呼び出しは {content: "...", ...} 形式だが、ここではプレーンテキストを想定
    wiki_text = wiki_all_raw.get("content", "") if isinstance(wiki_all_raw, dict) else str(wiki_all_raw)

    # LLM に改善を依頼するプロンプト（簡易版）
    prompt = textwrap.dedent(f"""\
        以下はこれまで蓄積したナレッジ（Wiki）です。
        これを踏まえて、与えられた「## 実行手順」セクションを改善してください。
        出力は「## 実行手順\n」から始まる改訂版ブロックのみを返してください。
        余計な説明は入れないでください。

        --- ナレッジ開始 ---
        {wiki_text}
        --- ナレッジ終了 ---
    """)
    # ここでは delegate_task を使って LLM に問い合わせる（タスクとして「プロンプトに答える」ことを想定）
    llm_res = delegate_task(
        goal=prompt,
        context="",
        output_schema={"text": str},
        background=False,
        timeout_s=120
    )
    # delegate_task の output はテキストまたは JSON 文字列の可能性があるため、できるだけテキストを取り出す
    llm_text = ""
    if isinstance(llm_res, dict) and "output" in llm_res:
        out = llm_res["output"]
        if isinstance(out, str):
            llm_text = out.strip()
        elif isinstance(out, dict) and "text" in out:
            llm_text = out["text"].strip()
    else:
        llm_text = str(llm_res).strip()

    # 最低限の検証
    if not llm_text.startswith("## 実行手順"):
        memory.add(
            target='memory',
            content=f'[{PLUGIN_NAME}] LLM 出力が期待フォーマットではない: {llm_text[:100]}'
        )
        return False

    new_block = llm_text.strip()

    # サイズ上限チェック（行数差が 30 行を超えたら人間確認が必要とみなして中止）
    old_lines = old_block.splitlines()
    new_lines = new_block.splitlines()
    if abs(len(new_lines) - len(old_lines)) > 30:
        memory.add(
            target='memory',
            content=f'[{PLUGIN_NAME}] スキル変更が大きすぎる（{len(old_lines)}→{len(new_lines)}行）。人間レビューが必要。'
        )
        return False

    # 実際にパッチ適用
    skill_manage(
        name=skill_name,
        action='patch',
        old_string=old_block,
        new_string=new_block,
        replace_all=False
    )
    return True


def _run_gating(skill_name: str) -> dict:
    """改善前・改善後のスキルでゴールデンセット＋元タスクを実行し、結果を返す"""
    # ここでは簡易に、改善後のスキルだけを使ってデモタスクを実行し、
    # 成功すればパスとする。実際は改善前のスキル（git stash など）と比較すべき。
    # デモタスクとしては、単純に "echo hello" を実行させる。
    test_goal = "echo hello とだけ出力させる"
    test_context = ""
    delegate_res = delegate_task(
        goal=test_goal,
        context=test_context,
        output_schema={"success": bool, "output": str},
        background=False,
        timeout_s=30
    )
    success = False
    if isinstance(delegate_res, dict):
        success = delegate_res.get("success", False)
    # ここでは diff と rev はダミー
    return {"passed": success, "skill_diff": "(ダミー)", "rev": "HEAD"}


def _commit_skill(skill_name: str):
    """スキルディレクトリで git add/commit/tag を実行"""
    # スキルディレクトリのパスを取得
    skill_info = skill_view(name=skill_name)
    # skill_view にはパス情報がないので、プロファイルから推定
    profile = os.environ.get("HERMES_PROFILE", "buddy")
    base_dir = os.path.expanduser(f"~/.hermes/profiles/{profile}/skills")
    skill_dir = os.path.join(base_dir, skill_name)
    if not os.path.isdir(skill_dir):
        memory.add(
            target='memory',
            content=f'[{PLUGIN_NAME}] スキルディレクトリが見つからない: {skill_dir}'
        )
        return
    # git コミット
    terminal(command=f"cd {skill_dir} && git add SKILL.md", workdir=skill_dir)
    terminal(command=f"cd {skill_dir} && git commit -m 'WikiSkill 自律更新: {_now_str()}'", workdir=skill_dir)
    terminal(command=f"cd {skill_dir} && git tag -a v{datetime.datetime.now():%Y%m%d-%H%M%S} -m 'WikiSkill 自律更新'", workdir=skill_dir)


def _rollback_skill(skill_name: str):
    """スキルを HEAD（直前コミット）に戻す（Wiki は触らない）"""
    profile = os.environ.get("HERMES_PROFILE", "buddy")
    base_dir = os.path.expanduser(f"~/.hermes/profiles/{profile}/skills")
    skill_dir = os.path.join(base_dir, skill_name)
    if not os.path.isdir(skill_dir):
        return
    terminal(command=f"cd {skill_dir} && git checkout HEAD -- SKILL.md", workdir=skill_dir)


def _record_metrics(plugin_name: str, passed: bool):
    """成功/失敗を簡易メトリクスとして sqlite_remember に記録"""
    record = {
        "ts": _now_str(),
        "plugin": plugin_name,
        "passed": passed,
    }
    sqlite_remember(
        content=json.dumps(record, ensure_ascii=False),
        category="general"
    )


class Plugin:
    def on_agent_start(self, **kwargs):
        # エージェント起動時に特にやることはないが、
        # 必要ならスキルディレクトリの git 初期化などを行っても良い。
        pass

    def on_cron(self, **kwargs):
        # 1️⃣ ガード条件：未処理エラーがあるか？
        recent_err_cnt = _count_recent_errors(hours=6)
        if recent_err_cnt == 0:
            memory.add(
                target='memory',
                content=f'[{PLUGIN_NAME}] ガード：直近 6h にエラーログなし → 終了'
            )
            return

        # 2️⃣ 最新エラーを取得
        latest_error = _get_latest_error()
        if not latest_error:
            memory.add(
                target='memory',
                content=f'[{PLUGIN_NAME}] エラーログはあるが取得失敗 → 終了'
            )
            return

        # 3️⃣ Wiki Maintainer：ログから教訓を抽出・重複排除・バージョン付与
        lesson = _extract_lesson_from_error(latest_error)
        if lesson:
            _upsert_wiki_entry(lesson)
        else:
            memory.add(
                target='memory',
                content=f'[{PLUGIN_NAME}] 教訓抽出に失敗 → 終了'
            )
            return

        # 4️⃣ スキル名を決定（ここでは固定か、memory から取得）
        # 例: memory から "wiki_skill_target" を読む
        target_skill_mem = memory(target='memory')
        # memory 呼び出しはプレーンテキストか JSON か不定なので、簡易に文字列検索
        skill_name = DEFAULT_SKILL_NAME
        if isinstance(target_skill_mem, dict) and "content" in target_skill_mem:
            cont = target_skill_mem["content"]
            m = re.search(r'wiki_skill_target\s*[:=]\s*[\'"]([^\'"]+)[\'"]', cont)
            if m:
                skill_name = m.group(1)

        # 5️⃣ Skill Proposer：ナレッジを元にスキルパッチを作成
        patch_ok = _propose_skill_patch(skill_name)
        if not patch_ok:
            memory.add(
                target='memory',
                content=f'[{PLUGIN_NAME}] スキルパッチ提案失敗 → ループ終了'
            )
            return

        # 6️⃣ Gating & Rollback：改善前/後でテスト実行
        gate_result = _run_gating(skill_name)
        if gate_result["passed"]:
            # コミット＋タグ付け
            _commit_skill(skill_name)
            memory.add(
                target='memory',
                content=f'[{PLUGIN_NAME}] スキル更新成功・コミット (rev={gate_result["rev"]})'
            )
        else:
            # ロールバック（Wiki は触らない）
            _rollback_skill(skill_name)
            memory.add(
                target='memory',
                content=f'[{PLUGIN_NAME}] スキル更新失敗・ロールバック'
            )

        # 7️⃣ 簡易メトリクス記録
        _record_metrics(PLUGIN_NAME, gate_result["passed"])


# エントリポイントとして Plugin クラスをエクスポートする必要はないが、
# hermes 側が plugin.yaml の entrypoint: main:Plugin を読むと自動で探す。
# したがってここでは何も返す必要はない。
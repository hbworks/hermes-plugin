import os
import json
import datetime
import re
from hermes_tools import (
    memory,
    skill_view,
    skill_manage,
    session_search,
    sqlite_search,
    sqlite_remember,
    sqlite_list_memories,
    terminal,
)

PLUGIN_NAME = "wiki_skill_evolution"
DEFAULT_SKILL_NAME = "default_skill"

# Simple golden set tasks for gating (shell commands to verify skill environment)
# NOTE: 現在の Gating はシェルの基本動作およびスキル構文（## 実行手順）の健全性を担保する設計
GOLDEN_TASKS = [
    {"goal": "echo hello", "context": ""},
    {"goal": "pwd", "context": ""},
]

def _now_str():
    return datetime.datetime.now().isoformat(timespec='seconds')

def _count_recent_errors(hours: int = 6) -> int:
    """直近 N 時間以内に発生したエラー系ログ件数を session_search で取得・時刻フィルタしてカウント。"""
    cutoff = datetime.datetime.now() - datetime.timedelta(hours=hours)
    cutoff_iso = cutoff.isoformat(timespec='seconds')
    query = "error OR fail OR exception OR panic"
    res = session_search(query=query, limit=200)
    matches = res.get("matches", []) if isinstance(res, dict) else []
    count = 0
    for m in matches:
        if not m or not isinstance(m, str):
            continue
        parts = m.split("|", 1)
        if len(parts) >= 1 and parts[0].strip():
            ts_str = parts[0].strip()
            try:
                if ts_str >= cutoff_iso:
                    count += 1
            except Exception:
                count += 1
        else:
            count += 1
    return count

def _get_latest_error() -> str | None:
    """最新のエラーログ文字列を取得（見つからなければ None）"""
    query = "error OR fail OR exception"
    res = session_search(query=query, limit=1, around_message_id=None)
    matches = res.get("matches", []) if isinstance(res, dict) else []
    if not matches:
        return None
    latest = matches[0]
    if isinstance(latest, str) and "|" in latest:
        _, content = latest.split("|", 1)
        return content.strip()
    return str(latest).strip() if latest else None

def _extract_lesson_from_error(error_text: str) -> str | None:
    """エラーテキストから簡易な教訓文を生成（ルールベース）"""
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
    return f"[General] 失敗: {error_text[:200]}"

def _levenshtein_ratio(a: str, b: str) -> float:
    """二文字列の類似度（0〜1）をレーベンシュタイン距離で求める（簡易実装）"""
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
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
    first_token = lesson.split()[0] if lesson else ""
    if not first_token.startswith("[") or not first_token.endswith("]"):
        memory.add(target='memory', content=tagged)
        return
    recent = sqlite_list_memories(category='memory', limit=100)
    similar_items = recent.get("memories", []) if isinstance(recent, dict) else []
    best_item = None
    best_ratio = 0.0
    for item in similar_items:
        content = item.get("content", "")
        ratio = _levenshtein_ratio(content, tagged)
        if ratio > best_ratio:
            best_ratio = ratio
            best_item = item
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
    """ナレッジを元にスキルのセクションをルールベースで安全に改定する"""
    if not skill_name or not isinstance(skill_name, str):
        return False
    skill_info = skill_view(name=skill_name)
    if not skill_info or "content" not in skill_info:
        memory.add(
            target='memory',
            content=f'[{PLUGIN_NAME}] スキル "{skill_name}" が見つからない'
        )
        return False
    current_text = skill_info["content"]
    pattern = r"(## 実行手順\n)(.*?)(?=\n## |\Z)"
    match = re.search(pattern, current_text, flags=re.DOTALL)
    if not match:
        memory.add(
            target='memory',
            content=f'[{PLUGIN_NAME}] スキルに「## 実行手順」セクションが見つからない'
        )
        return False
    old_block = match.group(0)

    wiki_raw = sqlite_list_memories(category='memory', limit=200)
    wiki_entries = wiki_raw.get("memories", []) if isinstance(wiki_raw, dict) else []
    lessons = [entry.get("content", "") for entry in wiki_entries if entry.get("content")]

    additions = []
    seen_lessons = set()
    for lesson in lessons:
        if not lesson:
            continue
        base_lesson = lesson.split(" v")[0].strip()
        if base_lesson in seen_lessons:
            continue
        seen_lessons.add(base_lesson)

        if "[IO/FileNotFound]" in lesson or "No such file" in lesson:
            additions.append("- ファイルパスは絶対パスで指定し、FileNotFound エラーを回避する。")
        elif "[Python/Path]" in lesson or "ImportError" in lesson:
            additions.append("- 実行スクリプトの先頭で sys.path にプロジェクトルートを追加する。")
        elif "[Net/Timeout]" in lesson or "timeout" in lesson.lower():
            additions.append("- ネットワーク操作にはリトライとタイムアウト延長を設定する。")
        else:
            short = base_lesson
            if len(short) > 120:
                short = short[:117] + "..."
            additions.append(f"- {short}")

    if not additions:
        memory.add(target='memory', content=f'[{PLUGIN_NAME}] 追加すべき教訓なし → パッチ不要')
        return False

    unique_additions = []
    for line in additions:
        if line not in unique_additions and line not in old_block:
            unique_additions.append(line)

    if not unique_additions:
        memory.add(target='memory', content=f'[{PLUGIN_NAME}] 既存の実行手順に既に含まれているためパッチ不要')
        return False

    # 末尾 \n を保証して安全に結合
    new_block = old_block.rstrip("\n") + "\n" + "\n".join(unique_additions)

    old_line_count = len(old_block.splitlines())
    new_line_count = len(new_block.splitlines())
    if abs(new_line_count - old_line_count) > 30:
        memory.add(
            target='memory',
            content=f'[{PLUGIN_NAME}] スキル変更が大きすぎる（{old_line_count}→{new_line_count}行）。人間レビューが必要。'
        )
        return False

    skill_manage(
        name=skill_name,
        action='patch',
        old_string=old_block,
        new_string=new_block,
        replace_all=False
    )
    return True

def _run_gating(skill_name: str) -> dict:
    """改善後のスキルでゴールデンセットを terminal で実行し、環境および構文健全性を確認"""
    all_passed = True
    for task in GOLDEN_TASKS:
        goal = task["goal"]
        res = terminal(command=goal, workdir=None)
        exit_code = res.get("exit_code", -1) if isinstance(res, dict) else -1
        if exit_code != 0:
            all_passed = False
            break

    skill_info = skill_view(name=skill_name)
    if skill_info and "content" in skill_info:
        if "## 実行手順" not in skill_info["content"]:
            all_passed = False

    return {
        "passed": all_passed,
        "skill_diff": "(ゴールデンセット基準)",
        "rev": "HEAD"
    }

def _commit_skill(skill_name: str):
    """スキルディレクトリで git add/commit/tag を実行（workdir 指定のため cd 不要）"""
    if not skill_name or not skill_name.strip():
        return
    profile = os.environ.get("HERMES_PROFILE", "buddy")
    base_dir = os.path.expanduser(f"~/.hermes/profiles/{profile}/skills")
    skill_dir = os.path.join(base_dir, skill_name)
    if not os.path.isdir(skill_dir):
        memory.add(
            target='memory',
            content=f'[{PLUGIN_NAME}] スキルディレクトリが見つからない: {skill_dir}'
        )
        return
    terminal(command="git add SKILL.md", workdir=skill_dir)
    terminal(command=f"git commit -m 'WikiSkill 自律更新: {_now_str()}'", workdir=skill_dir)
    terminal(command=f"git tag -a v{datetime.datetime.now():%Y%m%d-%H%M%S} -m 'WikiSkill 自律更新'", workdir=skill_dir)

def _rollback_skill(skill_name: str):
    """スキルを HEAD（直前コミット）に戻す（Wiki は触らない）"""
    if not skill_name or not skill_name.strip():
        return
    profile = os.environ.get("HERMES_PROFILE", "buddy")
    base_dir = os.path.expanduser(f"~/.hermes/profiles/{profile}/skills")
    skill_dir = os.path.join(base_dir, skill_name)
    if not os.path.isdir(skill_dir):
        return
    terminal(command="git checkout HEAD -- SKILL.md", workdir=skill_dir)

def _record_metrics(plugin_name: str, passed: bool):
    """成功/失敗を簡易メトリクスとして sqlite_remember に記録"""
    record = {
        "ts": _now_str(),
        "plugin": plugin_name,
        "passed": passed,
    }
    sqlite_remember(
        content=json.dumps(record, ensure_ascii=False),
        category=plugin_name
    )

class Plugin:
    def on_agent_start(self, **kwargs):
        pass

    def on_cron(self, **kwargs):
        if not DEFAULT_SKILL_NAME or not isinstance(DEFAULT_SKILL_NAME, str):
            memory.add(
                target='memory',
                content=f'[{PLUGIN_NAME}] 無効な DEFAULT_SKILL_NAME 設定 → 終了'
            )
            return

        recent_err_cnt = _count_recent_errors(hours=6)
        if recent_err_cnt == 0:
            memory.add(
                target='memory',
                content=f'[{PLUGIN_NAME}] ガード：直近 6h にエラーログなし → 終了'
            )
            return
        latest_error = _get_latest_error()
        if not latest_error:
            memory.add(
                target='memory',
                content=f'[{PLUGIN_NAME}] エラーログはあるが取得失敗 → 終了'
            )
            return
        lesson = _extract_lesson_from_error(latest_error)
        if lesson:
            _upsert_wiki_entry(lesson)
        else:
            memory.add(
                target='memory',
                content=f'[{PLUGIN_NAME}] 教訓抽出に失敗 → 終了'
            )
            return
        skill_name = DEFAULT_SKILL_NAME
        patch_ok = _propose_skill_patch(skill_name)
        if not patch_ok:
            memory.add(
                target='memory',
                content=f'[{PLUGIN_NAME}] スキルパッチ提案失敗 → ループ終了'
            )
            return
        gate_result = _run_gating(skill_name)
        if gate_result["passed"]:
            _commit_skill(skill_name)
            memory.add(
                target='memory',
                content=f'[{PLUGIN_NAME}] スキル更新成功・コミット (rev={gate_result["rev"]})'
            )
        else:
            _rollback_skill(skill_name)
            memory.add(
                target='memory',
                content=f'[{PLUGIN_NAME}] スキル更新失敗・ロールバック'
            )
        _record_metrics(PLUGIN_NAME, gate_result["passed"])

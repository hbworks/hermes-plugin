"""WikiSkill Evolution Plugin for Hermes Agent.

Provides autonomous error-capture, knowledge distillation, and skill evolution hooks/tools.
"""

from __future__ import annotations

from typing import Any

from .main import (
    RUN_EVOLUTION_SCHEMA,
    WikiSkillEvolutionPlugin,
)


def register(ctx: Any) -> None:
    """Register WikiSkill evolution tools and hooks with Hermes Agent."""
    plugin = WikiSkillEvolutionPlugin(ctx)

    # 1. ツール登録 (LLM / ユーザーから直接実行可能)
    ctx.register_tool(
        name="run_wiki_skill_evolution",
        schema=RUN_EVOLUTION_SCHEMA,
        handler=plugin.handle_tool_call,
    )

    # 2. フック登録 (エラー検知およびセッション完了時の監視)
    ctx.register_hook("post_tool_call", plugin.on_post_tool_call)
    ctx.register_hook("session_end", plugin.on_session_end)

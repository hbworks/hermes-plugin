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

    # 1. ツール登録 (toolset 引数は Hermes 公式仕様で必須)
    ctx.register_tool(
        name="run_wiki_skill_evolution",
        toolset="wiki-skill-evolution",
        schema=RUN_EVOLUTION_SCHEMA,
        handler=plugin.handle_tool_call,
    )

    # 2. フック登録 (公式 VALID_HOOKS: post_tool_call, on_session_end)
    ctx.register_hook("post_tool_call", plugin.on_post_tool_call)
    ctx.register_hook("on_session_end", plugin.on_session_end)

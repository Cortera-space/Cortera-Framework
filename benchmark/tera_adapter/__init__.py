"""
Tera Provenance Defense Adapter for AgentDojo

This adapter integrates Tera's blast radius + taint tracking + behavioral drift detection
as a defense layer in AgentDojo's pipeline. It calls the Tera Guard Service via HTTP
for each tool invocation.
"""

import json
import logging
import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any, Optional

import httpx

from agentdojo.agent_pipeline.base_pipeline_element import BasePipelineElement
from agentdojo.functions_runtime import EmptyEnv, Env, FunctionsRuntime
from agentdojo.types import ChatMessage, get_text_content_as_str
from agentdojo.functions_runtime import FunctionCall

logger = logging.getLogger(__name__)

TERA_GUARD_SERVICE_URL = "http://localhost:3001"


@dataclass
class TeraContextEntry:
    """Represents an entry in the context trace sent to Tera."""
    content: Any
    provenance: str  # "trusted" or "untrusted_external"
    role: Optional[str] = None


@dataclass 
class TeraEvaluationResult:
    """Result from Tera guard service evaluation."""
    verdict: str  # "allow", "guarded", "block"
    containment_reason: Optional[str]  # "blast_radius_violation", "behavioral_drift", or None
    message: Optional[str] = None


class TeraProvenanceDefense(BasePipelineElement):
    """
    AgentDojo pipeline element that integrates Tera's security layer.
    
    This defense:
    1. Tracks provenance of each conversation entry (trusted vs untrusted_external)
    2. Calls Tera Guard Service on each tool call with full context trace
    3. Blocks or guards tool calls based on Tera's verdict
    4. Logs block vs guarded counts for reporting
    """
    
    name = "tera_provenance"
    
    def __init__(
        self,
        guard_service_url: str = TERA_GUARD_SERVICE_URL,
        actor_id: str = "agentdojo-agent",
        workspace_id: str = "default-workspace",
        root_action_name: Optional[str] = None,
        root_blast_radius: Optional[list[str]] = None,
    ):
        super().__init__()
        self.guard_service_url = guard_service_url.rstrip("/")
        self.actor_id = actor_id
        self.workspace_id = workspace_id
        self.root_action_name = root_action_name
        self.root_blast_radius = root_blast_radius or []
        
        # Statistics for reporting
        self.block_count = 0
        self.guarded_count = 0
        self.allow_count = 0
        
        # Track if we've seen the first tool call to set root action
        self._first_tool_call = True
    
    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=30.0)
        return self._client
    
    async def close(self):
        if self._client:
            await self._client.aclose()
            self._client = None
    
    def _build_context_trace(self, messages: Sequence[ChatMessage]) -> list[TeraContextEntry]:
        """Build context trace from conversation messages, tagging provenance."""
        trace = []
        
        for msg in messages:
            role = msg["role"]
            content = msg.get("content")
            text_content = get_text_content_as_str(content) if content else ""
            
            if role == "system":
                # System prompt is always trusted
                trace.append(TeraContextEntry(
                    content=text_content,
                    provenance="trusted",
                    role="system"
                ))
            elif role == "user":
                # Original user task is trusted
                trace.append(TeraContextEntry(
                    content=text_content,
                    provenance="trusted",
                    role="user"
                ))
            elif role == "assistant":
                # Assistant messages are trusted (they're the agent's own reasoning)
                if text_content:
                    trace.append(TeraContextEntry(
                        content=text_content,
                        provenance="trusted",
                        role="assistant"
                    ))
                # Tool calls from assistant are also trusted (agent's own decisions)
                if msg.get("tool_calls"):
                    for tc in msg["tool_calls"]:
                        trace.append(TeraContextEntry(
                            content=f"Tool call: {tc.function}({tc.args})",
                            provenance="trusted",
                            role="assistant"
                        ))
            elif role == "tool":
                # Tool outputs are where AgentDojo injects attacks - mark as untrusted_external
                trace.append(TeraContextEntry(
                    content=text_content,
                    provenance="untrusted_external",
                    role="tool"
                ))
        
        return trace
    
    def _get_tool_name_and_args(self, messages: Sequence[ChatMessage]) -> tuple[str, dict]:
        """Extract the tool name and args from the last assistant message."""
        if not messages:
            return "", {}
        
        last_msg = messages[-1]
        if last_msg["role"] != "assistant" or not last_msg.get("tool_calls"):
            return "", {}
        
        tool_call = last_msg["tool_calls"][0]
        return tool_call.function, tool_call.args
    
    def _create_refusal_message(self, tool_name: str, reason: str) -> ChatMessage:
        """Create a synthetic tool result message indicating the call was blocked."""
        return {
            "role": "tool",
            "content": f"[BLOCKED by Tera Provenance Defense] Tool '{tool_name}' was not executed: {reason}",
            "tool_call_id": str(uuid.uuid4()),
            "tool_call": {"function": tool_name, "args": {}, "id": str(uuid.uuid4())},
            "error": f"Blocked by Tera: {reason}",
        }
    
    def query(
        self,
        query: str,
        runtime: FunctionsRuntime,
        env: Env = EmptyEnv(),
        messages: Sequence[ChatMessage] = [],
        extra_args: dict = {},
    ) -> tuple[str, FunctionsRuntime, Env, Sequence[ChatMessage], dict]:
        """Process the query through Tera's security layer."""
        
        # Only process if there's a tool call to evaluate
        tool_name, tool_args = self._get_tool_name_and_args(messages)
        
        if not tool_name:
            # No tool call, pass through
            return query, runtime, env, messages, extra_args
        
        # Build context trace
        context_trace = self._build_context_trace(messages)
        
        # Set root action from first tool call if not already set
        if self._first_tool_call:
            self.root_action_name = tool_name
            self._first_tool_call = False
        
        # Evaluate with Tera
        import asyncio
        import concurrent.futures
        import json
        
        # Debug: print context trace being sent
        trace_for_debug = [
            {"content": entry.content, "provenance": entry.provenance, "role": entry.role}
            for entry in context_trace
        ]
        logger.debug(f"Tera evaluate-call payload: actor_id={self.actor_id}, tool={tool_name}, context_trace={json.dumps(trace_for_debug, default=str)}")
        
        # Run async evaluation using httpx synchronously to avoid event loop issues
        import httpx
        try:
            with httpx.Client(timeout=30.0) as client:
                payload = {
                    "actor_id": self.actor_id,
                    "actor_type": "agent",
                    "tool_name": tool_name,
                    "tool_args": tool_args,
                    "context_trace": trace_for_debug,
                    "workspace_id": self.workspace_id,
                    "root_action_name": self.root_action_name,
                    "root_blast_radius": self.root_blast_radius,
                }
                response = client.post(
                    f"{self.guard_service_url}/evaluate-call",
                    json=payload,
                )
                response.raise_for_status()
                data = response.json()
                
                from dataclasses import dataclass
                @dataclass
                class TeraEvaluationResult:
                    verdict: str
                    containment_reason: str | None
                    message: str | None = None
                
                result = TeraEvaluationResult(
                    verdict=data.get("verdict", "allow"),
                    containment_reason=data.get("containment_reason"),
                    message=data.get("message"),
                )
        except Exception as e:
            logger.error(f"Tera Guard Service request failed: {e}")
            # Fail open - allow on service failure
            from dataclasses import dataclass
            @dataclass
            class TeraEvaluationResult:
                verdict: str
                containment_reason: str | None
                message: str | None = None
            result = TeraEvaluationResult(verdict="allow", containment_reason=None)
        
        # Handle verdict
        if result.verdict == "block":
            self.block_count += 1
            logger.warning(f"Tera blocked tool '{tool_name}': {result.message}")
            refusal = self._create_refusal_message(tool_name, result.message or "Blocked by Tera provenance defense")
            return query, runtime, env, [*messages, refusal], extra_args
        
        elif result.verdict == "guarded":
            self.guarded_count += 1
            logger.warning(f"Tera guarded tool '{tool_name}': {result.message}")
            # In benchmark (no human-in-loop), treat guarded as blocked
            refusal = self._create_refusal_message(tool_name, result.message or "Guarded by Tera provenance defense")
            return query, runtime, env, [*messages, refusal], extra_args
        
        else:  # allow
            self.allow_count += 1
            return query, runtime, env, messages, extra_args
    
    def get_stats(self) -> dict:
        """Get defense statistics for reporting."""
        return {
            "block_count": self.block_count,
            "guarded_count": self.guarded_count,
            "allow_count": self.allow_count,
            "total": self.block_count + self.guarded_count + self.allow_count,
        }


def create_tera_provenance_defense(
    guard_service_url: str = TERA_GUARD_SERVICE_URL,
    actor_id: str = "agentdojo-agent",
    workspace_id: str = "default-workspace",
) -> TeraProvenanceDefense:
    """Factory function to create the Tera Provenance Defense."""
    return TeraProvenanceDefense(
        guard_service_url=guard_service_url,
        actor_id=actor_id,
        workspace_id=workspace_id,
    )


# For AgentDojo's defense registration - this will be called when module is loaded
def register_tera_defense():
    """Register the tera_provenance defense with AgentDojo."""
    from agentdojo.agent_pipeline.agent_pipeline import DEFENSES
    
    # We can't directly modify DEFENSES list, but we can make the defense
    # available via the module-to-load mechanism
    pass
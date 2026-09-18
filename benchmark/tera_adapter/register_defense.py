"""
Module to register Tera Provenance Defense with AgentDojo.

Load this module using `--module-to-load benchmark.tera_adapter.register_defense`
to make the `tera_provenance` defense available in AgentDojo benchmarks.
"""

import logging
from agentdojo.agent_pipeline.agent_pipeline import DEFENSES, AgentPipeline, PipelineConfig
from agentdojo.agent_pipeline.basic_elements import InitQuery, SystemMessage
from agentdojo.agent_pipeline.tool_execution import ToolsExecutionLoop, ToolsExecutor, tool_result_to_str
from functools import partial
import json

from . import TeraProvenanceDefense, create_tera_provenance_defense

logger = logging.getLogger(__name__)

# Add tera_provenance to the list of available defenses
if "tera_provenance" not in DEFENSES:
    DEFENSES.append("tera_provenance")
    logger.info("Registered 'tera_provenance' defense")

# Store original from_config
_original_from_config = AgentPipeline.from_config

@classmethod
def patched_from_config(cls, config: PipelineConfig):
    """Patched version of from_config that handles tera_provenance defense."""
    
    # Handle tera_provenance defense specially
    if config.defense == "tera_provenance":
        from agentdojo.agent_pipeline.llms.openai_llm import OpenAILLM
        from agentdojo.agent_pipeline.llms.anthropic_llm import AnthropicLLM
        from agentdojo.agent_pipeline.llms.cohere_llm import CohereLLM
        from agentdojo.agent_pipeline.llms.google_llm import GoogleLLM
        from agentdojo.agent_pipeline.llms.local_llm import LocalLLM
        from agentdojo.agent_pipeline.llms.prompting_llm import PromptingLLM
        from agentdojo.models import MODEL_PROVIDERS, ModelsEnum
        
        # Get the LLM
        llm = config.llm
        if isinstance(llm, str):
            from agentdojo.agent_pipeline.agent_pipeline import get_llm
            llm = get_llm(MODEL_PROVIDERS[ModelsEnum(llm)], llm, config.model_id, config.tool_delimiter)
        
        llm_name = config.llm if isinstance(config.llm, str) else llm.name
        
        assert config.system_message is not None
        system_message_component = SystemMessage(config.system_message)
        init_query_component = InitQuery()
        
        if config.tool_output_format == "json":
            tool_output_formatter = partial(tool_result_to_str, dump_fn=json.dumps)
        else:
            tool_output_formatter = tool_result_to_str
        
        # Create Tera defense
        tera_defense = create_tera_provenance_defense()
        
        # Build pipeline with Tera defense inserted before tool execution
        tools_loop = ToolsExecutionLoop([
            ToolsExecutor(tool_output_formatter),
            tera_defense,
            llm,
        ])
        
        pipeline = cls([
            system_message_component,
            init_query_component,
            llm,
            tools_loop,
        ])
        pipeline.name = f"{llm_name}-tera_provenance"
        return pipeline
    
    # For other defenses, use original logic
    return _original_from_config(config)

# Apply the patch
AgentPipeline.from_config = patched_from_config
logger.info("Patched AgentPipeline.from_config to support tera_provenance defense")


def register_tera_defense():
    """Function to call when module is loaded."""
    pass  # Registration happens on import
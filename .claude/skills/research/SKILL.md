---
name: research
description: Trigger the research agent for a given topic
---

# Research

Launches the research agent to investigate trading strategies for a topic.

## Usage

```
/research <topic>
```

This activates the research agent (`.claude/agents/research/AGENT.md`) which owns the full pipeline.

## Pre-launch

Before launching the agent, ask the user:

> Quieres que guarde las conversaciones con NotebookLM para esta sesion?

Pass the answer as `save_conversations: true/false` in the agent prompt.

## Early Stop Signals

NO_VIDEOS_FOUND, NO_NEW_VIDEOS, NO_STRATEGIES_FOUND, AUTH_ERROR, ERROR

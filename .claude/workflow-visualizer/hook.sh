#!/usr/bin/env bash
# Claude Code universal hook → GZ AI Workflow Visualizer
# Handles: PreToolUse, PostToolUse, Notification, Stop
# Non-blocking: exits immediately, curl runs in background

PAYLOAD=$(cat)

curl -s --max-time 1 \
  -X POST \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  "http://127.0.0.1:3099/event" \
  > /dev/null 2>&1 &

exit 0

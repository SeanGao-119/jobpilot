#!/bin/zsh
set -euo pipefail

REPO_DIR="${JOBPILOT_REPO:-$HOME/jobpilot}"
LOG_DIR="$HOME/.jobpilot/logs"
mkdir -p "$LOG_DIR"

cd "$REPO_DIR"
source "$REPO_DIR/.venv/bin/activate"
set -a
source "$REPO_DIR/apps/web/.env.local"
set +a

jobpilot daily >> "$LOG_DIR/daily.log" 2>> "$LOG_DIR/daily-error.log"

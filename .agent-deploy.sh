#!/usr/bin/env bash
set -euo pipefail
PATH="/home/julius/.nvm/versions/node/v24.16.0/bin:$PATH"
export PATH
cd /home/julius/projects/darts-app
node -v
DARTS_SKIP_TESTS=1 bash deploy/deploy.sh

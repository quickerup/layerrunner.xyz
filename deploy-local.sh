#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ENV_NAME="${1:-production}"
ENV_FILE="${ENV_FILE:-.env}"

require_var() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: $name" >&2
    exit 1
  fi
}

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$ENV_FILE"
  set +a
fi

require_var "CLOUDFLARE_API_TOKEN"
require_var "ACCOUNT_ID"
require_var "TELEGRAM_BOT_TOKEN"
require_var "GITHUB_TOKEN"
require_var "GITHUB_OWNER"
require_var "GITHUB_REPO"
require_var "VAULT_JETTON_WALLET"

if [[ "$GITHUB_REPO" == https://github.com/* ]]; then
  GITHUB_REPO="${GITHUB_REPO#https://github.com/}"
  GITHUB_REPO="${GITHUB_REPO##*/}"
fi

if [[ "$GITHUB_REPO" == *"/"* ]]; then
  GITHUB_REPO="${GITHUB_REPO##*/}"
fi

if [[ -z "${GITHUB_REPO_BRANCH:-}" ]]; then
  GITHUB_REPO_BRANCH="main"
fi

if [[ -z "${GITHUB_DEPLOY_WORKFLOW:-}" ]]; then
  GITHUB_DEPLOY_WORKFLOW="deploy.yml"
fi

if ! command -v npx >/dev/null 2>&1; then
  echo "npx is required but not installed." >&2
  exit 1
fi

if ! npm ls --depth=0 >/dev/null 2>&1; then
  echo "Dependencies are not installed yet. Run:" >&2
  echo "  npm install" >&2
  exit 1
fi

for key in \
  TELEGRAM_BOT_TOKEN \
  GITHUB_TOKEN \
  GITHUB_OWNER \
  GITHUB_REPO \
  VAULT_JETTON_WALLET \
  JETTON_ADDRESS \
  APP_HEALTH_URL \
  GITHUB_DEPLOY_WORKFLOW
 do
  if [[ -n "${!key:-}" ]]; then
    echo "Setting Cloudflare secret: $key"
    printf '%s' "${!key}" | npx wrangler secret put "$key" --env "$ENV_NAME" --config wrangler.toml
  fi
done

if [[ -d "$SCRIPT_DIR/out" ]]; then
  echo "Deploying Pages"
  npx wrangler pages deploy out --project-name layerrunner-xyz --branch main
else
  echo "Skipping Pages deploy because ./out does not exist yet. Run npm run build first if needed."
fi

echo "Deploying Worker"
npx wrangler deploy --env "$ENV_NAME"

echo "Deployment complete."

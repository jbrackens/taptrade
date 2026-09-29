#!/bin/bash
# Next.js 11→13 + React 18 upgrade build script
set -e

echo "=== Step 0: Ensure yarn is available ==="
if ! command -v yarn &> /dev/null; then
  echo "Installing yarn via npm..."
  npm install -g yarn
fi
echo "Using yarn: $(yarn --version)"

echo "=== Step 1: Clean node_modules + build caches ==="
rm -rf node_modules packages/office/node_modules packages/app/node_modules packages/utils/node_modules
rm -rf packages/office/.next packages/app/.next
rm -f yarn.lock package-lock.json

echo "=== Step 2: Install dependencies ==="
yarn install --ignore-engines

echo "=== Step 3: Build office package ==="
cd packages/office
yarn build:local 2>&1 || yarn build 2>&1
cd ../..

echo "=== Step 4: Build app package ==="
cd packages/app
yarn build:local 2>&1 || yarn build 2>&1
cd ../..

echo ""
echo "========================================="
echo "  BUILD COMPLETE — Next.js 13 + React 18"
echo "========================================="

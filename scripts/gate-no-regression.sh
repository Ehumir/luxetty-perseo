#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[gate] installing dependencies"
npm ci

echo "[gate] lint"
npm run lint

echo "[gate] test suite"
npm test

echo "[gate] regression suite"
npm run test:regression

echo "[gate] PASS no-regression checks completed"

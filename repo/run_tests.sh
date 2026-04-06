#!/usr/bin/env bash
# run_tests.sh — Run all TalentBridge test suites
# Usage: ./run_tests.sh [--watch] [--coverage] [--suite <name>]
#
# Suites: unit | api | browser | e2e | all (default)
#
# The test runner uses Vitest in single-thread mode to avoid Angular TestBed
# concurrency issues (multiple initTestEnvironment calls).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

WATCH=false
COVERAGE=false
SUITE="all"

for arg in "$@"; do
  case $arg in
    --watch)        WATCH=true ;;
    --coverage)     COVERAGE=true ;;
    --suite)        shift; SUITE="${1:-all}" ;;
    --suite=*)      SUITE="${arg#*=}" ;;
  esac
done

echo "======================================="
echo "  TalentBridge Test Suite"
echo "  Suite: $SUITE"
echo "  Root:  $REPO_ROOT"
echo "======================================="
echo ""

cd "$REPO_ROOT"

# ── Build gate ────────────────────────────────────────────────────────────────
echo "--- Build validation ---"
if ! npm run build --silent 2>&1; then
  echo ""
  echo "======================================="
  echo "  BUILD FAILED — tests not run"
  echo "======================================="
  exit 1
fi
echo "--- Build passed ---"
echo ""

# Build the vitest base command
VITEST_BASE=(npx ng test)
if [ "$WATCH" = true ]; then
  VITEST_BASE=(npx vitest)
  [ "$COVERAGE" = true ] && VITEST_BASE+=(--coverage)
else
  VITEST_BASE=(npx vitest run)
  [ "$COVERAGE" = true ] && VITEST_BASE+=(--coverage)
fi

run_suite() {
  local name="$1"
  local pattern="$2"
  echo "--- Running $name tests ---"
  npx vitest run "$pattern"
  echo "--- $name tests complete ---"
  echo ""
}

case "$SUITE" in
  unit)
    run_suite "Unit"    "src/app/core/services/__tests__"
    run_suite "Unit"    "unit_tests"
    ;;
  api)
    run_suite "API"     "API_tests"
    ;;
  browser)
    run_suite "Browser" "src/app/modules"
    run_suite "Browser" "browser_tests"
    ;;
  e2e)
    run_suite "E2E"     "e2e_tests"
    ;;
  all|*)
    echo "--- Running all test suites (single-thread mode) ---"
    npx vitest run
    echo ""
    echo "--- All test suites complete ---"
    ;;
esac

echo "======================================="
echo "  Done"
echo "======================================="

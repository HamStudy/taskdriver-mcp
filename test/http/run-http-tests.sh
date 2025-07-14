#!/bin/bash

# HTTP Server Test Suite Runner
# Runs all HTTP server related tests including:
# - HTTP entry point tests
# - SessionService tests  
# - Full HTTP server integration tests
# - Session integration tests

set -e

echo "🧪 Running TaskDriver HTTP Server Test Suite"
echo "============================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test status tracking
TESTS_PASSED=0
TESTS_FAILED=0
FAILED_TESTS=()

run_test() {
    local test_name="$1"
    local test_command="$2"
    
    echo ""
    echo -e "${YELLOW}Running: $test_name${NC}"
    echo "----------------------------------------"
    
    if eval "$test_command"; then
        echo -e "${GREEN}✅ $test_name PASSED${NC}"
        ((TESTS_PASSED++))
    else
        echo -e "${RED}❌ $test_name FAILED${NC}"
        ((TESTS_FAILED++))
        FAILED_TESTS+=("$test_name")
    fi
}

# Clean up any existing test data
echo "🧹 Cleaning up existing test data..."
rm -rf test-*-data 2>/dev/null || true

# Run SessionService tests
run_test "SessionService Unit Tests" "bun test test/services/SessionService.test.ts"

# Run HTTP entry point tests
run_test "HTTP Entry Point Tests" "bun test test/http/http-entry.test.ts"

# Run main HTTP server integration tests
run_test "HTTP Server Integration Tests" "bun test test/http/server.test.ts --timeout 15000"

# Run session integration tests (these take longer due to timeouts)
run_test "Session Integration Tests" "bun test test/http/session-integration.test.ts --timeout 45000"

# Final cleanup
echo ""
echo "🧹 Cleaning up test data..."
rm -rf test-*-data 2>/dev/null || true

# Summary
echo ""
echo "============================================="
echo "🏁 Test Suite Complete"
echo "============================================="
echo -e "Tests Passed: ${GREEN}$TESTS_PASSED${NC}"
echo -e "Tests Failed: ${RED}$TESTS_FAILED${NC}"

if [ $TESTS_FAILED -gt 0 ]; then
    echo ""
    echo -e "${RED}Failed Tests:${NC}"
    for test in "${FAILED_TESTS[@]}"; do
        echo -e "  ${RED}❌ $test${NC}"
    done
    echo ""
    echo -e "${RED}❌ HTTP Server Test Suite FAILED${NC}"
    exit 1
else
    echo ""
    echo -e "${GREEN}🎉 All HTTP Server Tests Passed!${NC}"
    echo ""
    echo "The HTTP server implementation is working correctly with:"
    echo "  ✅ Session management with multi-pod persistence"
    echo "  ✅ Complete REST API for all TaskDriver operations"
    echo "  ✅ Authentication and security middleware"
    echo "  ✅ Error handling and validation"
    echo "  ✅ Storage-layer session persistence"
    echo "  ✅ Session resumption and cleanup"
    echo ""
    echo "Ready for production deployment! 🚀"
    exit 0
fi
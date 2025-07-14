#!/bin/bash

# TaskDriver Complete End-to-End Test Suite
# Runs all end-to-end tests in sequence

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

# Test configuration
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$TEST_DIR/../.." && pwd)"
START_TIME=$(date +%s)

echo -e "${BOLD}${BLUE}🧪 TaskDriver Complete End-to-End Test Suite${NC}"
echo "=============================================="
echo "Test Directory: $TEST_DIR"
echo "Project Root: $PROJECT_ROOT"
echo "Start Time: $(date)"
echo ""

# Change to project root
cd "$PROJECT_ROOT"

# Function to run a test and track results
run_test() {
    local test_name="$1"
    local test_script="$2"
    local test_start=$(date +%s)
    
    echo -e "\n${BOLD}${BLUE}🚀 Running $test_name${NC}"
    echo "================================================"
    
    if bash "$test_script"; then
        local test_end=$(date +%s)
        local test_duration=$((test_end - test_start))
        echo -e "\n${GREEN}✅ $test_name PASSED${NC} (${test_duration}s)"
        return 0
    else
        local test_end=$(date +%s)
        local test_duration=$((test_end - test_start))
        echo -e "\n${RED}❌ $test_name FAILED${NC} (${test_duration}s)"
        return 1
    fi
}

# Function to check prerequisites
check_prerequisites() {
    echo -e "${BLUE}🔍 Checking Prerequisites${NC}"
    echo "================================"
    
    # Check if we're in the right directory
    if [[ ! -f "package.json" ]] || [[ ! -f "src/cli.ts" ]]; then
        echo -e "${RED}❌ Not in TaskDriver project root directory${NC}"
        exit 1
    fi
    
    # Check if bun is available
    if ! command -v bun &> /dev/null; then
        echo -e "${RED}❌ Bun is not installed or not in PATH${NC}"
        exit 1
    fi
    
    # Check if bc is available (for calculations)
    if ! command -v bc &> /dev/null; then
        echo -e "${YELLOW}⚠️  bc (calculator) not available - some performance metrics may not work${NC}"
    fi
    
    # Build the project
    echo "🔨 Building project..."
    if ! bun run build; then
        echo -e "${RED}❌ Project build failed${NC}"
        exit 1
    fi
    
    # Check if test scripts exist
    local tests=(
        "cli-workflow.sh"
        "mcp-integration.sh"
        "stress-test.sh"
        "failure-scenarios.sh"
    )
    
    for test in "${tests[@]}"; do
        if [[ ! -f "$TEST_DIR/$test" ]]; then
            echo -e "${RED}❌ Test script not found: $test${NC}"
            exit 1
        fi
        
        # Make sure test scripts are executable
        chmod +x "$TEST_DIR/$test"
    done
    
    echo -e "${GREEN}✅ All prerequisites met${NC}"
}

# Function to clean up before tests
cleanup_before_tests() {
    echo -e "\n${BLUE}🧹 Cleaning Up Before Tests${NC}"
    echo "===================================="
    
    # Remove any existing test data
    rm -rf ./data ./test-*-data 2>/dev/null || true
    rm -f /tmp/stress_*.out /tmp/agent_*.out /tmp/failure_*.out 2>/dev/null || true
    
    # Kill any running processes
    pkill -f "src/mcp.ts" 2>/dev/null || true
    pkill -f "src/cli.ts" 2>/dev/null || true
    
    echo "✓ Cleanup completed"
}

# Function to generate test report
generate_report() {
    local total_tests="$1"
    local passed_tests="$2"
    local failed_tests="$3"
    local total_duration="$4"
    
    echo -e "\n${BOLD}${BLUE}📊 Test Suite Report${NC}"
    echo "======================"
    echo ""
    echo "📈 Results Summary:"
    echo "  • Total Tests: $total_tests"
    echo "  • Passed: ${GREEN}$passed_tests${NC}"
    echo "  • Failed: ${RED}$failed_tests${NC}"
    echo "  • Success Rate: $(echo "scale=1; $passed_tests * 100 / $total_tests" | bc -l 2>/dev/null || echo "N/A")%"
    echo "  • Total Duration: ${total_duration}s"
    echo ""
    
    if [[ $failed_tests -eq 0 ]]; then
        echo -e "${BOLD}${GREEN}🎉 ALL TESTS PASSED! 🎉${NC}"
        echo -e "${GREEN}TaskDriver is fully functional and ready for production!${NC}"
    else
        echo -e "${BOLD}${RED}⚠️  SOME TESTS FAILED ⚠️${NC}"
        echo -e "${RED}Please review the test output above for details.${NC}"
    fi
    
    echo ""
    echo "Test Environment:"
    echo "  • OS: $(uname -s)"
    echo "  • Architecture: $(uname -m)"
    echo "  • Node Version: $(node --version 2>/dev/null || echo "N/A")"
    echo "  • Bun Version: $(bun --version 2>/dev/null || echo "N/A")"
    echo "  • Test Date: $(date)"
    echo ""
}

# Main test execution
main() {
    local total_tests=0
    local passed_tests=0
    local failed_tests=0
    
    # Check prerequisites
    check_prerequisites
    
    # Clean up before starting
    cleanup_before_tests
    
    echo -e "\n${BOLD}${BLUE}🎯 Starting Test Execution${NC}"
    echo "================================="
    
    # Test 1: CLI Workflow Test
    total_tests=$((total_tests + 1))
    if run_test "CLI Workflow Test" "$TEST_DIR/cli-workflow.sh"; then
        passed_tests=$((passed_tests + 1))
    else
        failed_tests=$((failed_tests + 1))
    fi
    
    # Test 2: MCP Integration Test
    total_tests=$((total_tests + 1))
    if run_test "MCP Integration Test" "$TEST_DIR/mcp-integration.sh"; then
        passed_tests=$((passed_tests + 1))
    else
        failed_tests=$((failed_tests + 1))
    fi
    
    # Test 3: Failure Scenarios Test
    total_tests=$((total_tests + 1))
    if run_test "Failure Scenarios Test" "$TEST_DIR/failure-scenarios.sh"; then
        passed_tests=$((passed_tests + 1))
    else
        failed_tests=$((failed_tests + 1))
    fi
    
    # Test 4: Stress Test (run last as it's most intensive)
    total_tests=$((total_tests + 1))
    if run_test "Stress Test" "$TEST_DIR/stress-test.sh"; then
        passed_tests=$((passed_tests + 1))
    else
        failed_tests=$((failed_tests + 1))
    fi
    
    # Calculate total duration
    local end_time=$(date +%s)
    local total_duration=$((end_time - START_TIME))
    
    # Generate final report
    generate_report "$total_tests" "$passed_tests" "$failed_tests" "$total_duration"
    
    # Clean up after tests
    echo -e "\n${BLUE}🧹 Final Cleanup${NC}"
    rm -rf ./data ./test-*-data 2>/dev/null || true
    rm -f /tmp/stress_*.out /tmp/agent_*.out /tmp/failure_*.out 2>/dev/null || true
    
    # Exit with appropriate code
    if [[ $failed_tests -eq 0 ]]; then
        exit 0
    else
        exit 1
    fi
}

# Handle interrupts gracefully
trap 'echo -e "\n${YELLOW}🛑 Test suite interrupted${NC}"; exit 130' INT TERM

# Run main function
main "$@"
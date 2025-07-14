#!/bin/bash

# TaskDriver Complete Test Suite
# Runs all tests across all interfaces: Unit, Integration, CLI, MCP, HTTP, E2E
# Usage: ./test-all.sh [--fast|--coverage|--verbose]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

# Configuration
FAST_MODE=false
COVERAGE_MODE=false
VERBOSE_MODE=false
START_TIME=$(date +%s)

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --fast)
            FAST_MODE=true
            shift
            ;;
        --coverage)
            COVERAGE_MODE=true
            shift
            ;;
        --verbose)
            VERBOSE_MODE=true
            shift
            ;;
        --help)
            echo "TaskDriver Complete Test Suite"
            echo ""
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --fast      Skip slow E2E and stress tests"
            echo "  --coverage  Generate code coverage reports"
            echo "  --verbose   Show detailed output from all tests"
            echo "  --help      Show this help message"
            echo ""
            echo "Test Categories:"
            echo "  1. Unit Tests         - Individual component testing"
            echo "  2. Integration Tests  - Cross-component testing"
            echo "  3. CLI Tests          - Command-line interface"
            echo "  4. MCP Tests          - Model Context Protocol interface"
            echo "  5. HTTP Tests         - REST API interface"
            echo "  6. E2E Tests          - End-to-end workflows"
            echo ""
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Test tracking
TOTAL_SUITES=0
PASSED_SUITES=0
FAILED_SUITES=0
FAILED_SUITE_NAMES=()

# Function to run a test suite
run_test_suite() {
    local suite_name="$1"
    local suite_command="$2"
    local suite_description="$3"
    local is_slow="${4:-false}"
    
    # Skip slow tests in fast mode
    if [[ "$FAST_MODE" == "true" && "$is_slow" == "true" ]]; then
        echo -e "${YELLOW}⏭️  Skipping $suite_name (slow test, fast mode enabled)${NC}"
        return 0
    fi
    
    TOTAL_SUITES=$((TOTAL_SUITES + 1))
    local suite_start=$(date +%s)
    
    echo -e "\n${BOLD}${BLUE}🧪 Running $suite_name${NC}"
    echo "================================================"
    echo "$suite_description"
    echo ""
    
    # Run the test suite
    local output_file="/tmp/taskdriver_test_$(echo "$suite_name" | tr ' ' '_' | tr -d '/').log"
    
    if [[ "$VERBOSE_MODE" == "true" ]]; then
        # Show output in real-time
        if eval "$suite_command"; then
            local suite_end=$(date +%s)
            local suite_duration=$((suite_end - suite_start))
            echo -e "\n${GREEN}✅ $suite_name PASSED${NC} (${suite_duration}s)"
            PASSED_SUITES=$((PASSED_SUITES + 1))
            return 0
        else
            local suite_end=$(date +%s)
            local suite_duration=$((suite_end - suite_start))
            echo -e "\n${RED}❌ $suite_name FAILED${NC} (${suite_duration}s)"
            FAILED_SUITES=$((FAILED_SUITES + 1))
            FAILED_SUITE_NAMES+=("$suite_name")
            return 1
        fi
    else
        # Capture output and show summary
        if eval "$suite_command" > "$output_file" 2>&1; then
            local suite_end=$(date +%s)
            local suite_duration=$((suite_end - suite_start))
            echo -e "${GREEN}✅ $suite_name PASSED${NC} (${suite_duration}s)"
            PASSED_SUITES=$((PASSED_SUITES + 1))
            rm -f "$output_file"
            return 0
        else
            local suite_end=$(date +%s)
            local suite_duration=$((suite_end - suite_start))
            echo -e "${RED}❌ $suite_name FAILED${NC} (${suite_duration}s)"
            echo -e "${YELLOW}📝 Output saved to: $output_file${NC}"
            FAILED_SUITES=$((FAILED_SUITES + 1))
            FAILED_SUITE_NAMES+=("$suite_name")
            return 1
        fi
    fi
}

# Function to check prerequisites
check_prerequisites() {
    echo -e "${BOLD}${BLUE}🔍 Checking Prerequisites${NC}"
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
    
    # Check Node.js for some integration tests
    if ! command -v node &> /dev/null; then
        echo -e "${YELLOW}⚠️  Node.js not available - some tests may not work${NC}"
    fi
    
    # Build the project
    echo "🔨 Building project..."
    if ! bun run build; then
        echo -e "${RED}❌ Project build failed${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✅ All prerequisites met${NC}"
}

# Function to clean up
cleanup() {
    echo -e "\n${BLUE}🧹 Cleaning up test artifacts...${NC}"
    rm -rf ./data ./test-*-data 2>/dev/null || true
    rm -f /tmp/taskdriver_test_*.log 2>/dev/null || true
    pkill -f "src/mcp.ts" 2>/dev/null || true
    pkill -f "src/http.ts" 2>/dev/null || true
    pkill -f "src/cli.ts" 2>/dev/null || true
}

# Function to generate final report
generate_report() {
    local end_time=$(date +%s)
    local total_duration=$((end_time - START_TIME))
    
    echo -e "\n${BOLD}${BLUE}📊 Complete Test Suite Report${NC}"
    echo "=================================="
    echo ""
    echo "📈 Results Summary:"
    echo "  • Total Test Suites: $TOTAL_SUITES"
    echo "  • Passed: ${GREEN}$PASSED_SUITES${NC}"
    echo "  • Failed: ${RED}$FAILED_SUITES${NC}"
    
    if [[ $TOTAL_SUITES -gt 0 ]]; then
        local success_rate=$(echo "scale=1; $PASSED_SUITES * 100 / $TOTAL_SUITES" | bc -l 2>/dev/null || echo "N/A")
        echo "  • Success Rate: ${success_rate}%"
    fi
    
    echo "  • Total Duration: ${total_duration}s"
    echo ""
    
    if [[ $FAILED_SUITES -gt 0 ]]; then
        echo -e "${RED}Failed Test Suites:${NC}"
        for suite in "${FAILED_SUITE_NAMES[@]}"; do
            echo -e "  ${RED}❌ $suite${NC}"
        done
        echo ""
    fi
    
    echo "Test Environment:"
    echo "  • OS: $(uname -s) $(uname -r)"
    echo "  • Architecture: $(uname -m)"
    echo "  • Node Version: $(node --version 2>/dev/null || echo "N/A")"
    echo "  • Bun Version: $(bun --version 2>/dev/null || echo "N/A")"
    echo "  • Test Date: $(date)"
    echo "  • Mode: $(if [[ "$FAST_MODE" == "true" ]]; then echo "Fast"; elif [[ "$COVERAGE_MODE" == "true" ]]; then echo "Coverage"; else echo "Standard"; fi)"
    echo ""
    
    if [[ $FAILED_SUITES -eq 0 ]]; then
        echo -e "${BOLD}${GREEN}🎉 ALL TEST SUITES PASSED! 🎉${NC}"
        echo -e "${GREEN}TaskDriver is fully functional across all interfaces!${NC}"
        echo ""
        echo "Validated Interfaces:"
        echo "  ✅ CLI Commands & Workflows"
        echo "  ✅ MCP Protocol Implementation"
        echo "  ✅ HTTP REST API"
        echo "  ✅ Core Business Logic"
        echo "  ✅ Storage Layer Abstractions"
        echo "  ✅ End-to-End Workflows"
        echo ""
        echo -e "${BLUE}🚀 Ready for production deployment!${NC}"
    else
        echo -e "${BOLD}${RED}⚠️  SOME TEST SUITES FAILED ⚠️${NC}"
        echo -e "${RED}Please review the test output above for details.${NC}"
        echo ""
        echo "To debug failures:"
        echo "  1. Check log files in /tmp/taskdriver_test_*.log"
        echo "  2. Run individual test suites with --verbose flag"
        echo "  3. Run specific test files directly with: bun test <file>"
    fi
    
    echo ""
}

# Main execution
main() {
    echo -e "${BOLD}${BLUE}🧪 TaskDriver Complete Test Suite${NC}"
    echo "=================================="
    echo "Testing all interfaces: CLI, MCP, HTTP, Core Services"
    echo ""
    
    if [[ "$FAST_MODE" == "true" ]]; then
        echo -e "${YELLOW}⚡ Fast mode enabled - skipping slow tests${NC}"
    fi
    
    if [[ "$COVERAGE_MODE" == "true" ]]; then
        echo -e "${BLUE}📊 Coverage mode enabled${NC}"
    fi
    
    echo ""
    
    # Check prerequisites
    check_prerequisites
    cleanup
    
    echo -e "\n${BOLD}${BLUE}🎯 Starting Test Execution${NC}"
    echo "================================="
    
    # 1. Unit Tests - Fast, core component testing
    local test_cmd="bun test test/utils/ test/config/ test/services/ test/storage/"
    if [[ "$COVERAGE_MODE" == "true" ]]; then
        test_cmd="$test_cmd --coverage"
    fi
    
    run_test_suite \
        "Unit Tests" \
        "$test_cmd" \
        "Testing individual components: services, storage, utilities, configuration"
    
    # 2. Integration Tests - Cross-component testing
    run_test_suite \
        "Integration Tests" \
        "bun test test/integration/" \
        "Testing component interactions and storage provider compatibility"
    
    # 3. MCP Interface Tests
    run_test_suite \
        "MCP Interface Tests" \
        "bun test test/mcp/ test/tools/" \
        "Testing Model Context Protocol implementation and tool handlers"
    
    # 4. HTTP Interface Tests
    run_test_suite \
        "HTTP Interface Tests" \
        "./test/http/run-http-tests.sh" \
        "Testing REST API, session management, and HTTP server"
    
    # 5. CLI Interface Tests (E2E workflow)
    run_test_suite \
        "CLI Interface Tests" \
        "./test/e2e/cli-workflow.sh" \
        "Testing command-line interface with complete workflow" \
        "false"
    
    # 6. Extended E2E Tests (slow)
    run_test_suite \
        "Extended E2E Tests" \
        "./test/e2e/run-all-tests.sh" \
        "Comprehensive end-to-end testing including stress tests and failure scenarios" \
        "true"
    
    # Generate final report
    generate_report
    
    # Clean up
    cleanup
    
    # Exit with appropriate code
    if [[ $FAILED_SUITES -eq 0 ]]; then
        exit 0
    else
        exit 1
    fi
}

# Handle interrupts gracefully
trap 'echo -e "\n${YELLOW}🛑 Test suite interrupted${NC}"; cleanup; exit 130' INT TERM

# Run main function
main "$@"
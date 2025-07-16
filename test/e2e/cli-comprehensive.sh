#!/bin/bash

# TaskDriver CLI Comprehensive Test Suite
# Tests every single CLI command to ensure proper output formatting
# This test would have caught the "System Status: ACTIVE" bug

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test configuration
PROJECT_NAME="testproject"
PROJECT_DESC="Comprehensive test project"
PROJECT_INSTRUCTIONS="Critical instructions for agents: Process data systematically. Remove PII. Follow security protocols."
CLI_CMD="bun run src/cli.ts"
TEST_DIR="./test-comprehensive-data"

echo -e "${BLUE}🧪 Starting TaskDriver CLI Comprehensive Test Suite${NC}"
echo "=================================================="

# Cleanup function
cleanup() {
    echo -e "${YELLOW}🧹 Cleaning up test data...${NC}"
    rm -rf "$TEST_DIR" ./data 2>/dev/null || true
}

# Set trap to cleanup on exit
trap cleanup EXIT

# Helper function to test command output
test_command() {
    local cmd="$1"
    local expected_patterns=("${@:2}")
    
    echo -e "\n🔍 Testing: $cmd"
    
    local output
    output=$($cmd 2>&1 || true)
    
    # Check each expected pattern
    for pattern in "${expected_patterns[@]}"; do
        if [[ $output == *"$pattern"* ]]; then
            echo "  ✓ Found expected pattern: '$pattern'"
        else
            echo -e "  ${RED}❌ Missing expected pattern: '$pattern'${NC}"
            echo -e "  ${RED}Actual output:${NC}"
            echo "$output"
            exit 1
        fi
    done
    
    echo "  ✅ Command output validated"
}

# Test 1: Health Check
echo -e "\n${BLUE}=== Testing Health Check ===${NC}"
test_command "$CLI_CMD health-check" "System Status:" "HEALTHY" "Storage:" "Healthy"

# Test 2: Create Project (with instructions)
echo -e "\n${BLUE}=== Testing Project Creation ===${NC}"
test_command "$CLI_CMD create-project '$PROJECT_NAME' '$PROJECT_DESC' --instructions '$PROJECT_INSTRUCTIONS'" \
    "✅" "Project created successfully" "$PROJECT_NAME" "Instructions:" "Process data systematically"

# Extract project ID for subsequent tests
PROJECT_OUTPUT=$($CLI_CMD create-project "tempproject" "temp desc" --instructions "temp instructions" 2>/dev/null || echo "")
PROJECT_ID=$(echo "$PROJECT_OUTPUT" | grep -o '[a-f0-9\-]\{36\}' | head -1)

# Test 3: Get Project (the critical test that would have caught the bug)
echo -e "\n${BLUE}=== Testing Get Project (Critical Test) ===${NC}"
test_command "$CLI_CMD get-project '$PROJECT_NAME'" \
    "$PROJECT_NAME" "Status:" "ACTIVE" "Instructions:" "Process data systematically" \
    "Configuration:" "Max Retries:" "Statistics:" "Total Tasks:"

# Test 4: List Projects
echo -e "\n${BLUE}=== Testing List Projects ===${NC}"
test_command "$CLI_CMD list-projects" "Projects:" "NAME" "STATUS" "TASKS" "$PROJECT_NAME"

# Test 5: Create Task Type
echo -e "\n${BLUE}=== Testing Task Type Creation ===${NC}"
TASK_TYPE_NAME="testtasktype"
test_command "$CLI_CMD create-task-type '$PROJECT_NAME' '$TASK_TYPE_NAME' --template 'Process {{filename}}' --vars filename" \
    "✅" "Task Type:" "$TASK_TYPE_NAME" "Template:" "Process {{filename}}"

# Test 6: List Task Types
echo -e "\n${BLUE}=== Testing List Task Types ===${NC}"
test_command "$CLI_CMD list-task-types '$PROJECT_NAME'" \
    "Task Types:" "NAME" "TEMPLATE" "$TASK_TYPE_NAME"

# Test 7: Get Task Type
echo -e "\n${BLUE}=== Testing Get Task Type ===${NC}"
test_command "$CLI_CMD get-task-type '$PROJECT_NAME' '$TASK_TYPE_NAME'" \
    "Task Type:" "$TASK_TYPE_NAME" "Template:" "Process {{filename}}" "Variables:"

# Test 8: Create Task
echo -e "\n${BLUE}=== Testing Task Creation ===${NC}"
test_command "$CLI_CMD create-task '$PROJECT_NAME' '$TASK_TYPE_NAME' 'Test task' --vars '{\"filename\": \"test.txt\"}'" \
    "✅" "Task created successfully" "Task:" "queued"

# Test 9: List Tasks
echo -e "\n${BLUE}=== Testing List Tasks ===${NC}"
test_command "$CLI_CMD list-tasks '$PROJECT_NAME'" \
    "Tasks:" "TASK ID" "STATUS" "ASSIGNED TO" "CREATED"

# Test 10: Get Project Stats
echo -e "\n${BLUE}=== Testing Get Project Stats ===${NC}"
test_command "$CLI_CMD get-project-stats '$PROJECT_NAME'" \
    "Statistics for Project:" "Project Statistics:" "Total Tasks:" "Completed:" "Failed:" "Queued:"

# Test 11: List Active Agents
echo -e "\n${BLUE}=== Testing List Active Agents ===${NC}"
test_command "$CLI_CMD list-active-agents '$PROJECT_NAME'" \
    "Agents:" "NAME" "STATUS" "LAST SEEN"

# Test 12: Get Lease Stats
echo -e "\n${BLUE}=== Testing Get Lease Stats ===${NC}"
test_command "$CLI_CMD get-lease-stats '$PROJECT_NAME'" \
    "Statistics for Project:" "Lease Statistics:" "Running Tasks:" "Expired Tasks:"

# Test 13: Test Error Handling - Non-existent project
echo -e "\n${BLUE}=== Testing Error Handling ===${NC}"
test_command "$CLI_CMD get-project 'nonexistentproject'" \
    "❌" "Error:" "not found"

# Test 14: Test JSON Output Format
echo -e "\n${BLUE}=== Testing JSON Output Format ===${NC}"
JSON_OUTPUT=$($CLI_CMD get-project "$PROJECT_NAME" -f json)
if [[ $JSON_OUTPUT == *"\"success\": true"* ]] && [[ $JSON_OUTPUT == *"\"instructions\":"* ]]; then
    echo "  ✓ JSON format includes success and instructions"
    echo "  ✅ JSON output validated"
else
    echo -e "  ${RED}❌ JSON format missing required fields${NC}"
    echo "$JSON_OUTPUT"
    exit 1
fi

# Test 15: Update Project (if available)
echo -e "\n${BLUE}=== Testing Project Update ===${NC}"
if $CLI_CMD update-project --help &>/dev/null; then
    test_command "$CLI_CMD update-project '$PROJECT_NAME' --description 'Updated description'" \
        "✅" "Project updated successfully" "$PROJECT_NAME"
else
    echo "  ⚠️  update-project command not available, skipping"
fi

# Final validation: Ensure the original bug scenario is fixed
echo -e "\n${BLUE}=== Final Bug Validation ===${NC}"
echo "🐛 Testing the exact scenario that caused the original bug..."
BUG_TEST_OUTPUT=$($CLI_CMD get-project "$PROJECT_NAME")
if [[ $BUG_TEST_OUTPUT == *"Instructions:"* ]] && [[ $BUG_TEST_OUTPUT != *"System Status: ACTIVE"* ]]; then
    echo "  ✅ Original bug is fixed - instructions are shown, not health check"
else
    echo -e "  ${RED}❌ Original bug still present!${NC}"
    echo "  Expected: Instructions section, NOT 'System Status: ACTIVE'"
    echo "  Actual output:"
    echo "$BUG_TEST_OUTPUT"
    exit 1
fi

# Success message
echo -e "\n${GREEN}🎉 ALL COMPREHENSIVE CLI TESTS PASSED!${NC}"
echo "=================================================="
echo -e "${GREEN}✅ Comprehensive CLI Test Suite Completed Successfully${NC}"
echo ""
echo "📊 Commands Tested:"
echo "  • health-check ✓"
echo "  • create-project (with instructions) ✓"
echo "  • get-project (critical test) ✓"
echo "  • list-projects ✓"
echo "  • create-task-type ✓"
echo "  • list-task-types ✓"
echo "  • get-task-type ✓"
echo "  • create-task ✓"
echo "  • list-tasks ✓"
echo "  • get-project-stats ✓"
echo "  • list-active-agents ✓"
echo "  • get-lease-stats ✓"
echo "  • Error handling ✓"
echo "  • JSON output format ✓"
echo "  • Original bug scenario ✓"
echo ""
echo -e "${BLUE}🚀 All CLI commands properly validate output formatting!${NC}"
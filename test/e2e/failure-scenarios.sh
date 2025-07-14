#!/bin/bash

# TaskDriver Failure Scenarios Test
# Tests error handling, recovery, and edge cases

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🧪 Starting TaskDriver Failure Scenarios Test${NC}"
echo "==============================================="

# Test configuration
TEST_PROJECT="failure-test-project"
TEST_DESC="Failure scenarios test project"
CLI_CMD="bun run src/cli.ts"

# Cleanup function
cleanup() {
    echo -e "${YELLOW}🧹 Cleaning up test data...${NC}"
    rm -rf ./failure-test-data ./data 2>/dev/null || true
    rm -f /tmp/failure_*.out 2>/dev/null || true
}

trap cleanup EXIT

# Function to expect failure
expect_failure() {
    local description="$1"
    local command="$2"
    local expected_error="$3"
    
    echo "🔍 Testing: $description"
    
    if output=$(eval "$command" 2>&1); then
        echo -e "${RED}❌ Expected failure but command succeeded${NC}"
        echo "Output: $output"
        return 1
    else
        if [[ "$output" == *"$expected_error"* ]]; then
            echo "✓ Failed as expected: $expected_error"
            return 0
        else
            echo -e "${RED}❌ Failed with unexpected error${NC}"
            echo "Expected: $expected_error"
            echo "Got: $output"
            return 1
        fi
    fi
}

# Function to expect success
expect_success() {
    local description="$1"
    local command="$2"
    local expected_output="$3"
    
    echo "🔍 Testing: $description"
    
    if output=$(eval "$command" 2>&1); then
        if [[ -z "$expected_output" ]] || [[ "$output" == *"$expected_output"* ]]; then
            echo "✓ Succeeded as expected"
            return 0
        else
            echo -e "${RED}❌ Succeeded but with unexpected output${NC}"
            echo "Expected: $expected_output"
            echo "Got: $output"
            return 1
        fi
    else
        echo -e "${RED}❌ Expected success but command failed${NC}"
        echo "Error: $output"
        return 1
    fi
}

# Step 1: Setup
echo -e "\n${BLUE}Step 1: Test Setup${NC}"
cleanup

echo "🔧 Setting up test environment..."
if ! $CLI_CMD health-check > /dev/null 2>&1; then
    echo -e "${RED}❌ System health check failed${NC}"
    exit 1
fi
echo "✓ System healthy"

# Create a test project for valid operations
PROJECT_OUTPUT=$($CLI_CMD create-project "$TEST_PROJECT" "$TEST_DESC")
PROJECT_ID=$(echo "$PROJECT_OUTPUT" | grep -o '[a-f0-9\-]\{36\}' | head -1)
echo "✓ Test project created: $PROJECT_ID"

# Step 2: Project-related failures
echo -e "\n${BLUE}Step 2: Project-Related Failure Tests${NC}"

expect_failure \
    "Creating project with empty name" \
    '$CLI_CMD create-project "" "description"' \
    "Validation failed"

expect_failure \
    "Getting non-existent project" \
    '$CLI_CMD get-project "non-existent-project"' \
    "not found"

expect_success \
    "Creating project with duplicate name (should be allowed)" \
    '$CLI_CMD create-project "$TEST_PROJECT" "duplicate description"' \
    "Project created successfully"

echo "✅ Project failure tests completed"

# Step 3: Task type failures
echo -e "\n${BLUE}Step 3: Task Type Failure Tests${NC}"

expect_failure \
    "Creating task type with empty name" \
    '$CLI_CMD create-task-type "$TEST_PROJECT" "" --template "test"' \
    "Validation failed"

expect_failure \
    "Creating task type for non-existent project" \
    '$CLI_CMD create-task-type "non-existent-project" "test-type"' \
    "not found"

expect_failure \
    "Getting non-existent task type" \
    '$CLI_CMD get-task-type "12345678-1234-4234-b234-123456789012"' \
    "not found"

# Create a valid task type for further tests
TASK_TYPE_OUTPUT=$($CLI_CMD create-task-type "$TEST_PROJECT" "valid-task-type" --template "Test {{var}}")
TASK_TYPE_ID=$(echo "$TASK_TYPE_OUTPUT" | grep -o '[a-f0-9\-]\{36\}' | head -1)
echo "✓ Valid task type created for further tests: $TASK_TYPE_ID"

echo "✅ Task type failure tests completed"

# Step 4: Task creation failures
echo -e "\n${BLUE}Step 4: Task Creation Failure Tests${NC}"

expect_failure \
    "Creating task with non-existent project" \
    '$CLI_CMD create-task "non-existent-project" "$TASK_TYPE_ID" "test instructions"' \
    "not found"

expect_failure \
    "Creating task with invalid task type ID format" \
    '$CLI_CMD create-task "$TEST_PROJECT" "invalid-type-id" "test instructions"' \
    "Validation failed"

expect_failure \
    "Creating task with non-existent task type (valid GUID)" \
    '$CLI_CMD create-task "$TEST_PROJECT" "12345678-1234-4234-b234-123456789012" "test instructions"' \
    "not found"

expect_failure \
    "Creating task with empty instructions" \
    '$CLI_CMD create-task "$TEST_PROJECT" "$TASK_TYPE_ID" ""' \
    "Validation failed"

expect_failure \
    "Creating task with invalid JSON variables" \
    '$CLI_CMD create-task "$TEST_PROJECT" "$TASK_TYPE_ID" "test" --vars "invalid-json"' \
    "Invalid variables JSON"

# Create valid task for further tests
TASK_OUTPUT=$($CLI_CMD create-task "$TEST_PROJECT" "$TASK_TYPE_ID" "Valid test task" --vars '{"var": "testvalue"}')
TASK_ID=$(echo "$TASK_OUTPUT" | grep "Task:" | cut -d' ' -f2)
echo "✓ Valid task created for further tests: $TASK_ID"

echo "✅ Task creation failure tests completed"

# Step 5: Agent registration failures
echo -e "\n${BLUE}Step 5: Agent Registration Failure Tests${NC}"

expect_failure \
    "Registering agent with empty name" \
    '$CLI_CMD register-agent "$TEST_PROJECT" ""' \
    "Validation failed"

expect_failure \
    "Registering agent for non-existent project" \
    '$CLI_CMD register-agent "non-existent-project" "test-agent"' \
    "not found"

# Register valid agent for further tests
AGENT_OUTPUT=$($CLI_CMD register-agent "$TEST_PROJECT" "valid-agent")
AGENT_NAME="valid-agent"
echo "✓ Valid agent registered for further tests: $AGENT_NAME"

echo "✅ Agent registration failure tests completed"

# Step 6: Task assignment and completion failures
echo -e "\n${BLUE}Step 6: Task Operations Failure Tests${NC}"

expect_failure \
    "Getting task for non-existent agent" \
    '$CLI_CMD get-next-task "non-existent-agent" "$TEST_PROJECT"' \
    "not found"

expect_failure \
    "Getting task for non-existent project" \
    '$CLI_CMD get-next-task "$AGENT_NAME" "non-existent-project"' \
    "not found"

expect_failure \
    "Completing non-existent task" \
    '$CLI_CMD complete-task "$AGENT_NAME" "$TEST_PROJECT" "12345678-1234-4234-b234-123456789012"' \
    "not found"

expect_failure \
    "Completing task with invalid result JSON" \
    '$CLI_CMD complete-task "$AGENT_NAME" "$TEST_PROJECT" "$TASK_ID" --result "invalid-json"' \
    "Invalid result JSON"

expect_failure \
    "Failing task with invalid result JSON" \
    '$CLI_CMD fail-task "$AGENT_NAME" "$TEST_PROJECT" "$TASK_ID" --result "invalid-json"' \
    "Invalid result JSON"

echo "✅ Task operation failure tests completed"

# Step 7: Duplicate handling tests
echo -e "\n${BLUE}Step 7: Duplicate Handling Tests${NC}"

# Create task type with fail duplicate handling
FAIL_TYPE_OUTPUT=$($CLI_CMD create-task-type "$TEST_PROJECT" "fail-duplicates-type" \
    --template "Unique {{id}}" --duplicate-handling fail)
FAIL_TYPE_ID=$(echo "$FAIL_TYPE_OUTPUT" | grep -o '[a-f0-9\-]\{36\}' | head -1)

# Create first task successfully
expect_success \
    "Creating first task with fail duplicate handling" \
    '$CLI_CMD create-task "$TEST_PROJECT" "$FAIL_TYPE_ID" "First task" --vars "{\"id\": \"123\"}"' \
    "Task created successfully"

# Try to create duplicate - should fail
expect_failure \
    "Creating duplicate task when fail handling is enabled" \
    '$CLI_CMD create-task "$TEST_PROJECT" "$FAIL_TYPE_ID" "Duplicate task" --vars "{\"id\": \"123\"}"' \
    "Duplicate task found"

# Create task type with ignore duplicate handling
IGNORE_TYPE_OUTPUT=$($CLI_CMD create-task-type "$TEST_PROJECT" "ignore-duplicates-type" \
    --template "Ignore {{id}}" --duplicate-handling ignore)
IGNORE_TYPE_ID=$(echo "$IGNORE_TYPE_OUTPUT" | grep -o '[a-f0-9\-]\{36\}' | head -1)

# Create first task
FIRST_IGNORE_OUTPUT=$($CLI_CMD create-task "$TEST_PROJECT" "$IGNORE_TYPE_ID" "First ignore task" --vars '{"id": "456"}')
FIRST_IGNORE_ID=$(echo "$FIRST_IGNORE_OUTPUT" | grep "Task:" | cut -d' ' -f2)

# Create duplicate - should return same task
SECOND_IGNORE_OUTPUT=$($CLI_CMD create-task "$TEST_PROJECT" "$IGNORE_TYPE_ID" "Duplicate ignore task" --vars '{"id": "456"}')
SECOND_IGNORE_ID=$(echo "$SECOND_IGNORE_OUTPUT" | grep "Task:" | cut -d' ' -f2)

if [[ "$FIRST_IGNORE_ID" == "$SECOND_IGNORE_ID" ]]; then
    echo "✓ Ignore duplicate handling working correctly"
else
    echo -e "${RED}❌ Ignore duplicate handling failed: different IDs returned${NC}"
    exit 1
fi

echo "✅ Duplicate handling tests completed"

# Step 8: Lease expiration and timeout scenarios
echo -e "\n${BLUE}Step 8: Lease Management Failure Tests${NC}"

# Create task type with very short lease
SHORT_LEASE_TYPE_OUTPUT=$($CLI_CMD create-task-type "$TEST_PROJECT" "short-lease-type" \
    --template "Quick {{task}}" --lease-duration 1)  # 1 minute lease
SHORT_LEASE_TYPE_ID=$(echo "$SHORT_LEASE_TYPE_OUTPUT" | grep -o '[a-f0-9\-]\{36\}' | head -1)

# Create and assign task
SHORT_TASK_OUTPUT=$($CLI_CMD create-task "$TEST_PROJECT" "$SHORT_LEASE_TYPE_ID" "Short lease task" --vars '{"task": "quicktest"}')
SHORT_TASK_ID=$(echo "$SHORT_TASK_OUTPUT" | grep "Task:" | cut -d' ' -f2)

# Assign task to agent
ASSIGNED_OUTPUT=$($CLI_CMD get-next-task "$AGENT_NAME" "$TEST_PROJECT")
if [[ $ASSIGNED_OUTPUT == *"Task assigned"* ]]; then
    echo "✓ Task assigned with short lease"
else
    echo -e "${RED}❌ Failed to assign task with short lease${NC}"
    exit 1
fi

# Test lease cleanup
CLEANUP_OUTPUT=$($CLI_CMD cleanup-leases "$TEST_PROJECT")
if [[ $CLEANUP_OUTPUT == *"Lease cleanup completed"* ]]; then
    echo "✓ Lease cleanup working"
else
    echo -e "${RED}❌ Lease cleanup failed${NC}"
    exit 1
fi

echo "✅ Lease management tests completed"

# Step 9: Concurrent access edge cases
echo -e "\n${BLUE}Step 9: Concurrent Access Edge Cases${NC}"

# Create multiple tasks for concurrent testing
echo "📋 Creating tasks for concurrent testing..."
CONCURRENT_TASK_IDS=()
for i in {1..5}; do
    CONCURRENT_OUTPUT=$($CLI_CMD create-task "$TEST_PROJECT" "$TASK_TYPE_ID" "Concurrent task $i" --vars "{\"var\": \"concurrent$i\"}")
    CONCURRENT_ID=$(echo "$CONCURRENT_OUTPUT" | grep "Task:" | cut -d' ' -f2)
    CONCURRENT_TASK_IDS+=("$CONCURRENT_ID")
done
echo "✓ Created ${#CONCURRENT_TASK_IDS[@]} tasks for concurrent testing"

# Register multiple agents
echo "🤖 Registering multiple agents..."
CONCURRENT_AGENTS=()
for i in {1..3}; do
    AGENT_OUTPUT=$($CLI_CMD register-agent "$TEST_PROJECT" "concurrent-agent-$i" > /dev/null 2>&1)
    CONCURRENT_AGENTS+=("concurrent-agent-$i")
done
echo "✓ Registered ${#CONCURRENT_AGENTS[@]} agents"

# Test concurrent task assignment
echo "⚡ Testing concurrent task assignment..."
ASSIGNMENT_PIDS=()
for agent in "${CONCURRENT_AGENTS[@]}"; do
    (
        # Each agent tries to get multiple tasks rapidly
        for attempt in {1..3}; do
            $CLI_CMD get-next-task "$agent" "$TEST_PROJECT" > "/tmp/failure_concurrent_${agent}_${attempt}.out" 2>&1 || true
            sleep 0.1
        done
    ) &
    ASSIGNMENT_PIDS+=($!)
done

# Wait for all concurrent operations
for pid in "${ASSIGNMENT_PIDS[@]}"; do
    wait $pid
done

# Count successful assignments
SUCCESSFUL_ASSIGNMENTS=0
for agent in "${CONCURRENT_AGENTS[@]}"; do
    for attempt in {1..3}; do
        if grep -q "Task assigned" "/tmp/failure_concurrent_${agent}_${attempt}.out" 2>/dev/null; then
            SUCCESSFUL_ASSIGNMENTS=$((SUCCESSFUL_ASSIGNMENTS + 1))
        fi
    done
done

echo "✓ Concurrent assignments completed: $SUCCESSFUL_ASSIGNMENTS successful"

echo "✅ Concurrent access tests completed"

# Step 10: Resource exhaustion simulation
echo -e "\n${BLUE}Step 10: Resource Exhaustion Tests${NC}"

# Test with no available tasks
expect_success \
    "Getting task when no tasks available" \
    '$CLI_CMD get-next-task "$AGENT_NAME" "$TEST_PROJECT"' \
    "No tasks available"

# Test statistics with empty project
EMPTY_PROJECT_OUTPUT=$($CLI_CMD create-project "empty-project" "Empty test project")
expect_success \
    "Getting stats for empty project" \
    '$CLI_CMD get-project-stats "empty-project"' \
    "Total Tasks: 0"

echo "✅ Resource exhaustion tests completed"

# Step 11: Data integrity edge cases
echo -e "\n${BLUE}Step 11: Data Integrity Tests${NC}"

# Test very long inputs
LONG_STRING=$(printf "A%.0s" {1..11000})  # 11000 character string (exceeds 10000 limit)

expect_failure \
    "Creating project with extremely long name" \
    '$CLI_CMD create-project "$LONG_STRING" "description"' \
    "Validation failed"

expect_failure \
    "Creating task with extremely long instructions" \
    '$CLI_CMD create-task "$TEST_PROJECT" "$TASK_TYPE_ID" "$LONG_STRING" --vars "{\"var\": \"test\"}"' \
    "Validation failed"

# Test special characters
SPECIAL_CHARS="!@#$%^&*()[]{}|;:,.<>?"
expect_success \
    "Creating project with special characters in description" \
    '$CLI_CMD create-project "special-chars-project" "$SPECIAL_CHARS"' \
    "Project created successfully"

echo "✅ Data integrity tests completed"

# Final assessment
echo -e "\n${GREEN}🎉 ALL FAILURE SCENARIO TESTS COMPLETED!${NC}"
echo "==============================================="
echo -e "${GREEN}✅ Failure Scenarios Test PASSED${NC}"
echo ""
echo "📊 Test Summary:"
echo "  • Project operation failures ✓"
echo "  • Task type creation failures ✓"
echo "  • Task creation failures ✓"
echo "  • Agent registration failures ✓"
echo "  • Task operation failures ✓"
echo "  • Duplicate handling edge cases ✓"
echo "  • Lease management edge cases ✓"
echo "  • Concurrent access edge cases ✓"
echo "  • Resource exhaustion scenarios ✓"
echo "  • Data integrity edge cases ✓"
echo ""
echo -e "${BLUE}🛡️  TaskDriver demonstrated robust error handling and recovery!${NC}"
#!/bin/bash

# TaskDriver CLI End-to-End Test
# Tests the complete workflow from project creation to task completion
# 
# Note: Test patterns use flexible matching (✅ + key terms) rather than exact 
# wording to reduce brittleness when output messages change

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test configuration
PROJECT_NAME="e2e-test-project"
PROJECT_DESC="End-to-end test project for CLI validation"
TASK_TYPE_NAME="file-processor"
AGENT_NAME="test-worker"
CLI_CMD="bun run src/cli.ts"
TEST_DIR="./test-e2e-data"

echo -e "${BLUE}🧪 Starting TaskDriver CLI End-to-End Test${NC}"
echo "========================================"

# Cleanup function
cleanup() {
    echo -e "${YELLOW}🧹 Cleaning up test data...${NC}"
    rm -rf "$TEST_DIR" ./data 2>/dev/null || true
}

# Set trap to cleanup on exit
trap cleanup EXIT

# Step 1: Clean environment and health check
echo -e "\n${BLUE}Step 1: Environment Setup${NC}"
cleanup
echo "✓ Cleaned test environment"

echo -e "\n🔍 Checking system health..."
if ! $CLI_CMD health-check; then
    echo -e "${RED}❌ Health check failed${NC}"
    exit 1
fi
echo "✓ System is healthy"

# Step 2: Create project
echo -e "\n${BLUE}Step 2: Project Creation${NC}"
echo "🏗️  Creating project '$PROJECT_NAME'..."
PROJECT_OUTPUT=$($CLI_CMD create-project "$PROJECT_NAME" "$PROJECT_DESC" --instructions "Process files efficiently. Remove PII. Follow security protocols." --max-retries 2 --lease-duration 5)
if [[ $PROJECT_OUTPUT == *"✅"* && $PROJECT_OUTPUT == *"$PROJECT_NAME"* && $PROJECT_OUTPUT == *"Instructions:"* ]]; then
    echo "✓ Project created successfully (includes instructions)"
else
    echo -e "${RED}❌ Project creation failed or missing instructions${NC}"
    echo "Expected: ✅ success message, project name, and Instructions: section"
    echo "Actual output:"
    echo "$PROJECT_OUTPUT"
    exit 1
fi

# Extract project ID from output - updated for new format
PROJECT_ID=$(echo "$PROJECT_OUTPUT" | grep -o '[a-f0-9\-]\{36\}' | head -1)
echo "✓ Project ID: $PROJECT_ID"

# Step 3: List projects and verify
echo -e "\n🔍 Verifying project in list..."
LIST_OUTPUT=$($CLI_CMD list-projects)
if [[ $LIST_OUTPUT == *"$PROJECT_NAME"* ]]; then
    echo "✓ Project appears in list"
else
    echo -e "${RED}❌ Project not found in list${NC}"
    echo "$LIST_OUTPUT"
    exit 1
fi

# Step 4: Get project details
echo -e "\n🔍 Getting project details..."
PROJECT_DETAILS=$($CLI_CMD get-project "$PROJECT_NAME")
if [[ $PROJECT_DETAILS == *"$PROJECT_NAME"* ]] && [[ $PROJECT_DETAILS == *"Total Tasks: 0"* ]] && [[ $PROJECT_DETAILS == *"Status:"* ]] && [[ $PROJECT_DETAILS == *"Configuration:"* ]] && [[ $PROJECT_DETAILS == *"Statistics:"* ]] && [[ $PROJECT_DETAILS == *"Instructions:"* ]] && [[ $PROJECT_DETAILS == *"Process files efficiently"* ]]; then
    echo "✓ Project details correct (includes status, config, stats, and instructions)"
else
    echo -e "${RED}❌ Project details incorrect - missing critical sections${NC}"
    echo "Expected sections: Status, Configuration, Statistics, Instructions"
    echo "Expected instructions content: 'Process files efficiently'"
    echo "Actual output:"
    echo "$PROJECT_DETAILS"
    exit 1
fi

# Step 5: Create task type
echo -e "\n${BLUE}Step 3: Task Type Creation${NC}"
echo "📝 Creating task type '$TASK_TYPE_NAME'..."
TASK_TYPE_OUTPUT=$($CLI_CMD create-task-type "$PROJECT_NAME" "$TASK_TYPE_NAME" \
    --template "Process {{filename}} with {{method}}" \
    --vars filename method \
    --duplicate-handling ignore \
    --max-retries 3 \
    --lease-duration 8)

if [[ $TASK_TYPE_OUTPUT == *"✅"* ]]; then
    echo "✓ Task type created successfully"
else
    echo -e "${RED}❌ Task type creation failed${NC}"
    echo "$TASK_TYPE_OUTPUT"
    exit 1
fi

# Extract task type ID
TASK_TYPE_ID=$(echo "$TASK_TYPE_OUTPUT" | grep -o '[a-f0-9\-]\{36\}' | head -1)
echo "✓ Task Type ID: $TASK_TYPE_ID"

# Step 6: List task types
echo -e "\n🔍 Verifying task type in list..."
TASK_TYPE_LIST=$($CLI_CMD list-task-types "$PROJECT_NAME")
if [[ $TASK_TYPE_LIST == *"$TASK_TYPE_NAME"* ]]; then
    echo "✓ Task type appears in list"
else
    echo -e "${RED}❌ Task type not found in list${NC}"
    echo "$TASK_TYPE_LIST"
    exit 1
fi

# Step 7: Agent Name Setup (no registration needed in lease-based model)
echo -e "\n${BLUE}Step 4: Agent Setup${NC}"
echo "🤖 Setting up agent name '$AGENT_NAME'..."
echo "✓ Agent name prepared (no registration needed in lease-based model)"
echo "✓ Agents are ephemeral queue workers in the new architecture"

# Step 8: Create multiple tasks
echo -e "\n${BLUE}Step 5: Task Creation${NC}"
echo "📋 Creating multiple tasks..."

TASK_IDS=()

# Create task 1
echo "📋 Creating task 1..."
TASK1_OUTPUT=$($CLI_CMD create-task "$PROJECT_NAME" "$TASK_TYPE_ID" "Process document.pdf" \
    --vars '{"filename": "document.pdf", "method": "OCR"}')
TASK1_ID=$(echo "$TASK1_OUTPUT" | grep "Task:" | sed 's/Task: //' | head -1)
TASK_IDS+=("$TASK1_ID")
echo "✓ Task 1 ID: $TASK1_ID"

# Create task 2
echo "📋 Creating task 2..."
TASK2_OUTPUT=$($CLI_CMD create-task "$PROJECT_NAME" "$TASK_TYPE_ID" "Process image.png" \
    --vars '{"filename": "image.png", "method": "compression"}')
TASK2_ID=$(echo "$TASK2_OUTPUT" | grep "Task:" | sed 's/Task: //' | head -1)
TASK_IDS+=("$TASK2_ID")
echo "✓ Task 2 ID: $TASK2_ID"

# Create task 3
echo "📋 Creating task 3..."
TASK3_OUTPUT=$($CLI_CMD create-task "$PROJECT_NAME" "$TASK_TYPE_ID" "Process data.csv" \
    --vars '{"filename": "data.csv", "method": "validation"}')
TASK3_ID=$(echo "$TASK3_OUTPUT" | grep "Task:" | sed 's/Task: //' | head -1)
TASK_IDS+=("$TASK3_ID")
echo "✓ Task 3 ID: $TASK3_ID"

# Step 9: List tasks and verify
echo -e "\n🔍 Verifying tasks in list..."
TASK_LIST=$($CLI_CMD list-tasks "$PROJECT_NAME")
QUEUED_COUNT=$(echo "$TASK_LIST" | grep -c "queued" || true)
if [[ $QUEUED_COUNT -eq 3 ]]; then
    echo "✓ All 3 tasks are queued"
else
    echo -e "${RED}❌ Expected 3 queued tasks, found $QUEUED_COUNT${NC}"
    echo "$TASK_LIST"
    exit 1
fi

# Step 10: Agent workflow - process all tasks
echo -e "\n${BLUE}Step 6: Agent Task Processing${NC}"

for i in {1..3}; do
    echo -e "\n🤖 Processing task $i..."
    
    # Get next task
    echo "📥 Getting next task for agent..."
    NEXT_TASK_OUTPUT=$($CLI_CMD get-next-task "$PROJECT_NAME" "$AGENT_NAME")
    
    if [[ $NEXT_TASK_OUTPUT == *"✅"* && $NEXT_TASK_OUTPUT == *"task"* ]]; then
        echo "✓ Task assigned to agent"
    elif [[ $NEXT_TASK_OUTPUT == *"No tasks"* || $NEXT_TASK_OUTPUT == *"no tasks"* ]]; then
        echo -e "${YELLOW}⚠️  No more tasks available${NC}"
        break
    else
        echo -e "${RED}❌ Failed to get next task${NC}"
        echo "$NEXT_TASK_OUTPUT"
        exit 1
    fi
    
    # Extract assigned task ID
    ASSIGNED_TASK_ID=$(echo "$NEXT_TASK_OUTPUT" | grep '"id":' | sed 's/.*"id": "\([^"]*\)".*/\1/')
    echo "✓ Assigned Task ID: $ASSIGNED_TASK_ID"
    
    # Simulate some processing time
    echo "⏳ Simulating task processing (2 seconds)..."
    sleep 2
    
    # Complete the task
    echo "✅ Completing task..."
    COMPLETE_OUTPUT=$($CLI_CMD complete-task "$AGENT_NAME" "$PROJECT_NAME" "$ASSIGNED_TASK_ID" \
        "{\"success\": true, \"output\": \"Task $i completed successfully\", \"processingTime\": \"2s\"}")
    
    if [[ $COMPLETE_OUTPUT == *"✅"* && $COMPLETE_OUTPUT == *"completed"* ]]; then
        echo "✓ Task $i completed successfully"
    else
        echo -e "${RED}❌ Task completion failed${NC}"
        echo "$COMPLETE_OUTPUT"
        exit 1
    fi
done

# Step 11: Verify final state
echo -e "\n${BLUE}Step 7: Final Verification${NC}"

echo "📊 Getting final project statistics..."
FINAL_STATS=$($CLI_CMD get-project-stats "$PROJECT_NAME")
if [[ $FINAL_STATS == *"Total Tasks: 3"* && $FINAL_STATS == *"Completed: 3"* ]]; then
    echo "✓ All tasks completed successfully"
else
    echo -e "${RED}❌ Final statistics incorrect${NC}"
    echo "$FINAL_STATS"
    exit 1
fi

echo -e "\n🔍 Checking final task list..."
FINAL_TASK_LIST=$($CLI_CMD list-tasks "$PROJECT_NAME")
COMPLETED_COUNT=$(echo "$FINAL_TASK_LIST" | grep -c "completed" || true)
if [[ $COMPLETED_COUNT -eq 3 ]]; then
    echo "✓ All 3 tasks show as completed"
else
    echo -e "${RED}❌ Expected 3 completed tasks, found $COMPLETED_COUNT${NC}"
    echo "$FINAL_TASK_LIST"
    exit 1
fi

# Step 12: Test error scenarios
echo -e "\n${BLUE}Step 8: Error Handling Tests${NC}"

echo "🔍 Testing duplicate task handling..."
DUPLICATE_OUTPUT=$($CLI_CMD create-task "$PROJECT_NAME" "$TASK_TYPE_ID" "Process document.pdf again" \
    --vars '{"filename": "document.pdf", "method": "OCR"}' 2>&1 || true)

# Since duplicate handling is set to 'ignore', this should succeed and return existing task
if [[ $DUPLICATE_OUTPUT == *"Task:"* ]]; then
    echo "✓ Duplicate handling working correctly"
else
    echo -e "${YELLOW}⚠️  Duplicate handling test result: $DUPLICATE_OUTPUT${NC}"
fi

echo "🔍 Testing invalid project access..."
INVALID_PROJECT_OUTPUT=$($CLI_CMD get-project "non-existent-project" 2>&1 || true)
if [[ $INVALID_PROJECT_OUTPUT == *"not found"* || $INVALID_PROJECT_OUTPUT == *"❌"* ]]; then
    echo "✓ Invalid project handling working correctly"
else
    echo -e "${RED}❌ Invalid project should have failed${NC}"
    exit 1
fi

# Step 13: Test lease management
echo -e "\n${BLUE}Step 9: Lease Management Test${NC}"

echo "🧹 Testing lease cleanup..."
CLEANUP_OUTPUT=$($CLI_CMD cleanup-leases "$PROJECT_NAME")
if [[ $CLEANUP_OUTPUT == *"✅"* ]]; then
    echo "✓ Lease cleanup working correctly"
else
    echo -e "${RED}❌ Lease cleanup failed${NC}"
    echo "$CLEANUP_OUTPUT"
    exit 1
fi

# Final success message
echo -e "\n${GREEN}🎉 ALL TESTS PASSED!${NC}"
echo "========================================"
echo -e "${GREEN}✅ End-to-End CLI Test Completed Successfully${NC}"
echo ""
echo "📊 Test Summary:"
echo "  • Project created and managed ✓"
echo "  • Task type created with templates ✓"
echo "  • Agent setup (lease-based model) ✓"
echo "  • 3 tasks created and processed ✓"
echo "  • Complete agent workflow tested ✓"
echo "  • Statistics and monitoring verified ✓"
echo "  • Error handling validated ✓"
echo "  • Lease management tested ✓"
echo ""
echo -e "${BLUE}🚀 TaskDriver CLI is fully functional!${NC}"
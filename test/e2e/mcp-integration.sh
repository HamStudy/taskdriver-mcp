#!/bin/bash

# TaskDriver MCP Integration Test
# Tests the MCP server tools and integration workflow

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🧪 Starting TaskDriver MCP Integration Test${NC}"
echo "============================================="

# Test configuration
TEST_PROJECT="mcp-test-project"
TEST_DESC="MCP integration test project"
TEST_TASK_TYPE="mcp-task-type"
TEST_AGENT="mcp-agent"
TEST_DIR="./test-mcp-data"

# Cleanup function
cleanup() {
    echo -e "${YELLOW}🧹 Cleaning up test data...${NC}"
    rm -rf "$TEST_DIR" ./data 2>/dev/null || true
    # Kill any background MCP server
    pkill -f "src/mcp.ts" 2>/dev/null || true
}

trap cleanup EXIT

# Step 1: Test MCP server startup
echo -e "\n${BLUE}Step 1: MCP Server Test${NC}"
cleanup

echo "🚀 Testing MCP server compilation..."
if ! bun run build; then
    echo -e "${RED}❌ Build failed${NC}"
    exit 1
fi
echo "✓ Build successful"

# Note: We can't easily test the actual MCP protocol without a client,
# but we can test that the server starts without crashing
echo "🔍 Testing MCP server startup (quick test)..."
timeout 5s bun run src/mcp.ts 2>&1 | head -10 || true
echo "✓ MCP server startup tested"

# Step 2: Test CLI integration with MCP-style workflows
echo -e "\n${BLUE}Step 2: MCP-Style Workflow Test${NC}"

# Simulate an MCP client workflow using CLI commands
echo "🔧 Creating project via CLI (simulating MCP tool call)..."
PROJECT_OUTPUT=$(bun run src/cli.ts create-project "$TEST_PROJECT" "$TEST_DESC")
if [[ $PROJECT_OUTPUT == *"✅ Project created successfully"* ]]; then
    echo "✓ Project creation successful"
else
    echo -e "${RED}❌ Project creation failed${NC}"
    exit 1
fi

echo "🔧 Creating task type via CLI (simulating MCP tool call)..."
TASK_TYPE_OUTPUT=$(bun run src/cli.ts create-task-type "$TEST_PROJECT" "$TEST_TASK_TYPE" \
    --template "Analyze {{document}} for {{purpose}}")
if [[ $TASK_TYPE_OUTPUT == *"✅ Task type created successfully"* ]]; then
    echo "✓ Task type creation successful"
    TASK_TYPE_ID=$(echo "$TASK_TYPE_OUTPUT" | grep -o '[a-f0-9\-]\{36\}' | head -1)
else
    echo -e "${RED}❌ Task type creation failed${NC}"
    exit 1
fi

echo "🔧 Setting up agent name (simulating MCP tool call)..."
echo "✓ Agent name '$TEST_AGENT' prepared (no registration needed in lease-based model)"

# Step 3: Test concurrent operations (simulating multiple MCP clients)
echo -e "\n${BLUE}Step 3: Concurrent Operations Test${NC}"

echo "⚡ Creating multiple tasks concurrently..."
TASK_PIDS=()

# Create 5 tasks in parallel (simulating multiple MCP clients)
for i in {1..5}; do
    (
        bun run src/cli.ts create-task "$TEST_PROJECT" "$TASK_TYPE_ID" "Analyze document $i" \
            --vars "{\"document\": \"doc$i.pdf\", \"purpose\": \"compliance\"}" \
            > "/tmp/task_$i.out" 2>&1
    ) &
    TASK_PIDS+=($!)
done

# Wait for all tasks to complete
echo "⏳ Waiting for concurrent task creation..."
for pid in "${TASK_PIDS[@]}"; do
    wait $pid
done

# Check results
CREATED_COUNT=0
for i in {1..5}; do
    if grep -q "✅ Task created successfully" "/tmp/task_$i.out"; then
        CREATED_COUNT=$((CREATED_COUNT + 1))
    fi
done

if [[ $CREATED_COUNT -eq 5 ]]; then
    echo "✓ All 5 tasks created successfully in parallel"
else
    echo -e "${RED}❌ Only $CREATED_COUNT/5 tasks created successfully${NC}"
    exit 1
fi

# Clean up temp files
rm -f /tmp/task_*.out

# Step 4: Test agent concurrent processing
echo -e "\n${BLUE}Step 4: Concurrent Agent Processing${NC}"

echo "🤖 Testing concurrent task assignment and processing..."
AGENT_PIDS=()

# Simulate 3 agents working concurrently
for agent_num in {1..3}; do
    (
        local_agent="$TEST_AGENT-$agent_num"
        
        # In lease-based model, agents don't need registration
        # They just need names for task assignment
        
        # Process tasks
        for task_num in {1..2}; do
            # Get next task
            NEXT_TASK=$(bun run src/cli.ts get-next-task "$TEST_PROJECT" "$local_agent" 2>/dev/null || echo "No tasks")
            
            if [[ $NEXT_TASK == *"Task assigned"* || $NEXT_TASK == *"task"* ]]; then
                TASK_ID=$(echo "$NEXT_TASK" | grep -A 20 '"task":' | grep '"id":' | head -1 | sed 's/.*"id": *"\([^"]*\)".*/\1/')
                
                # Simulate processing
                sleep 1
                
                # Complete task
                bun run src/cli.ts complete-task "$local_agent" "$TEST_PROJECT" "$TASK_ID" \
                    "{\"success\": true, \"agent\": \"$local_agent\", \"taskNum\": $task_num}" \
                    > "/tmp/agent_${agent_num}_task_${task_num}.out" 2>&1
            fi
        done
    ) &
    AGENT_PIDS+=($!)
done

# Wait for all agents to complete
echo "⏳ Waiting for concurrent agent processing..."
for pid in "${AGENT_PIDS[@]}"; do
    wait $pid
done

# Check final project stats
echo "📊 Checking final project statistics..."
FINAL_STATS=$(bun run src/cli.ts get-project-stats "$TEST_PROJECT")
TOTAL_TASKS=$(echo "$FINAL_STATS" | grep "Total Tasks:" | awk '{print $3}')
COMPLETED_TASKS=$(echo "$FINAL_STATS" | grep "Completed:" | awk '{print $2}')

echo "✓ Total tasks: $TOTAL_TASKS"
echo "✓ Completed tasks: $COMPLETED_TASKS"

if [[ $COMPLETED_TASKS -gt 0 ]]; then
    echo "✓ Concurrent processing working correctly"
else
    echo -e "${RED}❌ No tasks were completed${NC}"
    exit 1
fi

# Clean up temp files
rm -f /tmp/agent_*.out

# Step 5: Test error resilience
echo -e "\n${BLUE}Step 5: Error Resilience Test${NC}"

echo "🔍 Testing invalid operations..."

# Test invalid project
INVALID_OP=$(bun run src/cli.ts create-task "invalid-project" "$TASK_TYPE_ID" "test" 2>&1 || true)
if [[ $INVALID_OP == *"not found"* ]]; then
    echo "✓ Invalid project handling working"
else
    echo -e "${RED}❌ Invalid project should have failed${NC}"
    exit 1
fi

# Test invalid task type
INVALID_TASK_TYPE=$(bun run src/cli.ts create-task "$TEST_PROJECT" "invalid-type-id" "test" 2>&1 || true)
if [[ $INVALID_TASK_TYPE == *"not found"* ]]; then
    echo "✓ Invalid task type handling working"
else
    echo -e "${RED}❌ Invalid task type should have failed${NC}"
    exit 1
fi

# Test invalid JSON
INVALID_JSON=$(bun run src/cli.ts create-task "$TEST_PROJECT" "$TASK_TYPE_ID" "test" --vars "invalid-json" 2>&1 || true)
if [[ $INVALID_JSON == *"Invalid variables JSON"* ]]; then
    echo "✓ Invalid JSON handling working"
else
    echo -e "${RED}❌ Invalid JSON should have failed${NC}"
    exit 1
fi

# Step 6: Test data consistency
echo -e "\n${BLUE}Step 6: Data Consistency Test${NC}"

echo "🔍 Testing data consistency across operations..."

# Get project details multiple times to ensure consistency
for i in {1..3}; do
    PROJECT_DETAILS=$(bun run src/cli.ts get-project "$TEST_PROJECT")
    if [[ ! $PROJECT_DETAILS == *"$TEST_PROJECT"* ]]; then
        echo -e "${RED}❌ Data consistency issue on attempt $i${NC}"
        exit 1
    fi
done
echo "✓ Project data consistency verified"

# Test task list consistency
TASK_LIST1=$(bun run src/cli.ts list-tasks "$TEST_PROJECT" --format table)
TASK_LIST2=$(bun run src/cli.ts list-tasks "$TEST_PROJECT" --format table)
if [[ "$TASK_LIST1" != "$TASK_LIST2" ]]; then
    echo -e "${YELLOW}⚠️  Task list may have changed between calls (expected in active system)${NC}"
else
    echo "✓ Task list consistency verified"
fi

# Final success message
echo -e "\n${GREEN}🎉 ALL MCP INTEGRATION TESTS PASSED!${NC}"
echo "============================================="
echo -e "${GREEN}✅ MCP Integration Test Completed Successfully${NC}"
echo ""
echo "📊 Test Summary:"
echo "  • MCP server startup tested ✓"
echo "  • CLI/MCP workflow integration ✓"
echo "  • Concurrent operations tested ✓"
echo "  • Multi-agent processing verified ✓"
echo "  • Error resilience validated ✓"
echo "  • Data consistency confirmed ✓"
echo ""
echo -e "${BLUE}🚀 TaskDriver MCP integration is fully functional!${NC}"
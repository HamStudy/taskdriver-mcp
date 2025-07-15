#!/bin/bash

# TaskDriver Stress Test
# Tests system under load with multiple projects, agents, and tasks

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🧪 Starting TaskDriver Stress Test${NC}"
echo "===================================="

# Test configuration
NUM_PROJECTS=3
NUM_AGENTS_PER_PROJECT=2
NUM_TASK_TYPES_PER_PROJECT=2
NUM_TASKS_PER_TYPE=5
PROCESSING_DELAY=0.5
CLI_CMD="bun run src/cli.ts"

# Arrays to track created resources
PROJECT_IDS=()
TASK_TYPE_IDS=()
AGENT_NAMES=()

# Cleanup function
cleanup() {
    echo -e "${YELLOW}🧹 Cleaning up stress test data...${NC}"
    rm -rf ./stress-test-data ./data 2>/dev/null || true
    rm -f /tmp/stress_*.out /tmp/agent_*.out 2>/dev/null || true
}

trap cleanup EXIT

# Function to log with timestamp
log() {
    echo -e "[$(date '+%H:%M:%S')] $1"
}

# Step 1: Setup and health check
echo -e "\n${BLUE}Step 1: System Preparation${NC}"
cleanup

log "🔍 Performing health check..."
if ! $CLI_CMD health-check > /dev/null 2>&1; then
    echo -e "${RED}❌ System health check failed${NC}"
    exit 1
fi
log "✓ System healthy"

# Step 2: Create multiple projects
echo -e "\n${BLUE}Step 2: Creating $NUM_PROJECTS Projects${NC}"

for i in $(seq 1 $NUM_PROJECTS); do
    PROJECT_NAME="stress-project-$i"
    PROJECT_DESC="Stress test project $i"
    
    log "🏗️  Creating project $i: $PROJECT_NAME"
    
    PROJECT_OUTPUT=$($CLI_CMD create-project "$PROJECT_NAME" "$PROJECT_DESC" \
        --max-retries 3 \
        --lease-duration 5 2>/dev/null)
    
    if [[ $PROJECT_OUTPUT == *"✅ Project created successfully"* ]]; then
        PROJECT_ID=$(echo "$PROJECT_OUTPUT" | grep -o '[a-f0-9\-]\{36\}' | head -1)
        PROJECT_IDS+=("$PROJECT_ID")
        log "✓ Project $i created: $PROJECT_ID"
    else
        echo -e "${RED}❌ Project $i creation failed${NC}"
        exit 1
    fi
done

log "✅ All $NUM_PROJECTS projects created successfully"

# Step 3: Create task types for each project
echo -e "\n${BLUE}Step 3: Creating Task Types${NC}"

TASK_TYPE_COUNT=0
for i in $(seq 1 $NUM_PROJECTS); do
    PROJECT_NAME="stress-project-$i"
    
    for j in $(seq 1 $NUM_TASK_TYPES_PER_PROJECT); do
        TASK_TYPE_NAME="task-type-$i-$j"
        TEMPLATE="Process {{input}} using method {{method}} for project $i type $j"
        
        log "📝 Creating task type $TASK_TYPE_NAME"
        
        TASK_TYPE_OUTPUT=$($CLI_CMD create-task-type "$PROJECT_NAME" "$TASK_TYPE_NAME" \
            --template "$TEMPLATE" \
            --vars input method \
            --duplicate-handling allow \
            --max-retries 2 \
            --lease-duration 3 2>/dev/null)
        
        if [[ $TASK_TYPE_OUTPUT == *"✅ Task type created successfully"* ]]; then
            TASK_TYPE_ID=$(echo "$TASK_TYPE_OUTPUT" | grep -o '[a-f0-9\-]\{36\}' | head -1)
            TASK_TYPE_IDS+=("$TASK_TYPE_ID")
            TASK_TYPE_COUNT=$((TASK_TYPE_COUNT + 1))
            log "✓ Task type created: $TASK_TYPE_ID"
        else
            echo -e "${RED}❌ Task type creation failed for $TASK_TYPE_NAME${NC}"
            exit 1
        fi
    done
done

log "✅ All $TASK_TYPE_COUNT task types created successfully"

# Step 4: Prepare agent names for each project
echo -e "\n${BLUE}Step 4: Preparing Agent Names${NC}"

AGENT_COUNT=0
for i in $(seq 1 $NUM_PROJECTS); do
    PROJECT_NAME="stress-project-$i"
    
    for j in $(seq 1 $NUM_AGENTS_PER_PROJECT); do
        AGENT_NAME="stress-agent-$i-$j"
        
        log "🤖 Preparing agent name $AGENT_NAME"
        
        # In the lease-based model, agents don't need registration
        # They just need names for task assignment
        AGENT_NAMES+=("$AGENT_NAME:$PROJECT_NAME")
        AGENT_COUNT=$((AGENT_COUNT + 1))
        log "✓ Agent name prepared: $AGENT_NAME"
    done
done

log "✅ All $AGENT_COUNT agent names prepared successfully"

# Step 5: Create massive number of tasks
echo -e "\n${BLUE}Step 5: Creating Tasks (High Volume)${NC}"

TOTAL_TASKS_EXPECTED=$((NUM_PROJECTS * NUM_TASK_TYPES_PER_PROJECT * NUM_TASKS_PER_TYPE))
log "📋 Creating $TOTAL_TASKS_EXPECTED tasks across all projects..."

TASK_CREATION_START=$(date +%s)
TASKS_CREATED=0
CREATION_PIDS=()

# Create tasks in parallel for speed
for i in $(seq 1 $NUM_PROJECTS); do
    PROJECT_NAME="stress-project-$i"
    
    for j in $(seq 1 $NUM_TASK_TYPES_PER_PROJECT); do
        # Find the corresponding task type ID
        TASK_TYPE_INDEX=$(((i-1) * NUM_TASK_TYPES_PER_PROJECT + (j-1)))
        TASK_TYPE_ID="${TASK_TYPE_IDS[$TASK_TYPE_INDEX]}"
        
        # Create multiple tasks for this type in parallel
        (
            for k in $(seq 1 $NUM_TASKS_PER_TYPE); do
                TASK_DESC="Stress test task $i-$j-$k"
                VARIABLES="{\"input\": \"data-$i-$j-$k.txt\", \"method\": \"stress-test\"}"
                
                $CLI_CMD create-task "$PROJECT_NAME" "$TASK_TYPE_ID" "$TASK_DESC" \
                    --vars "$VARIABLES" > "/tmp/stress_task_${i}_${j}_${k}.out" 2>&1
                
                if grep -q "✅ Task created successfully" "/tmp/stress_task_${i}_${j}_${k}.out"; then
                    echo "1" > "/tmp/stress_task_${i}_${j}_${k}.success"
                fi
            done
        ) &
        CREATION_PIDS+=($!)
    done
done

# Wait for all task creation to complete
log "⏳ Waiting for all task creation to complete..."
for pid in "${CREATION_PIDS[@]}"; do
    wait $pid
done

# Count successful task creations
for i in $(seq 1 $NUM_PROJECTS); do
    for j in $(seq 1 $NUM_TASK_TYPES_PER_PROJECT); do
        for k in $(seq 1 $NUM_TASKS_PER_TYPE); do
            if [[ -f "/tmp/stress_task_${i}_${j}_${k}.success" ]]; then
                TASKS_CREATED=$((TASKS_CREATED + 1))
            fi
        done
    done
done

TASK_CREATION_END=$(date +%s)
CREATION_TIME=$((TASK_CREATION_END - TASK_CREATION_START))

log "✅ Task creation completed: $TASKS_CREATED/$TOTAL_TASKS_EXPECTED tasks in ${CREATION_TIME}s"

if [[ $TASKS_CREATED -lt $((TOTAL_TASKS_EXPECTED * 8 / 10)) ]]; then
    echo -e "${RED}❌ Too many task creation failures: $TASKS_CREATED/$TOTAL_TASKS_EXPECTED${NC}"
    exit 1
fi

# Step 6: Concurrent agent processing
echo -e "\n${BLUE}Step 6: Concurrent Agent Processing${NC}"

PROCESSING_START=$(date +%s)
log "🚀 Starting concurrent agent processing..."

AGENT_PIDS=()
TASKS_PROCESSED=0

# Start all agents working concurrently
for agent_info in "${AGENT_NAMES[@]}"; do
    IFS=':' read -r AGENT_NAME PROJECT_NAME <<< "$agent_info"
    
    (
        local_processed=0
        
        # Each agent will try to process up to 10 tasks
        for attempt in {1..10}; do
            # Get next task
            NEXT_TASK=$($CLI_CMD get-next-task "$PROJECT_NAME" "$AGENT_NAME" 2>/dev/null || echo "No tasks")
            
            if [[ $NEXT_TASK == *"Task assigned"* || $NEXT_TASK == *"task"* ]]; then
                # Extract task ID from JSON output
                TASK_ID=$(echo "$NEXT_TASK" | grep -A 20 '"task":' | grep '"id":' | head -1 | sed 's/.*"id": *"\([^"]*\)".*/\1/')
                echo "Agent $AGENT_NAME got task $TASK_ID" >> "/tmp/agent_${AGENT_NAME}.log"
                
                # Simulate processing time
                sleep $PROCESSING_DELAY
                
                # Complete task
                RESULT="{\"success\": true, \"agent\": \"$AGENT_NAME\", \"processed_at\": \"$(date)\", \"attempt\": $attempt}"
                
                if $CLI_CMD complete-task "$AGENT_NAME" "$PROJECT_NAME" "$TASK_ID" \
                    "$RESULT" >/dev/null 2>&1; then
                    local_processed=$((local_processed + 1))
                    echo "$local_processed" > "/tmp/agent_${AGENT_NAME}.count"
                    echo "Agent $AGENT_NAME completed task $TASK_ID" >> "/tmp/agent_${AGENT_NAME}.log"
                fi
            elif [[ $NEXT_TASK == *"No tasks"* || $NEXT_TASK == *"no tasks"* ]]; then
                # No more tasks, agent can stop
                break
            else
                # Some error occurred, but continue trying
                sleep 0.1
            fi
        done
    ) &
    AGENT_PIDS+=($!)
done

# Wait for all agents to complete their work
log "⏳ Waiting for agents to complete processing..."
for pid in "${AGENT_PIDS[@]}"; do
    wait $pid
done

# Count total processed tasks
for agent_info in "${AGENT_NAMES[@]}"; do
    IFS=':' read -r AGENT_NAME PROJECT_NAME <<< "$agent_info"
    if [[ -f "/tmp/agent_${AGENT_NAME}.count" ]]; then
        AGENT_PROCESSED=$(cat "/tmp/agent_${AGENT_NAME}.count")
        TASKS_PROCESSED=$((TASKS_PROCESSED + AGENT_PROCESSED))
    fi
done

PROCESSING_END=$(date +%s)
PROCESSING_TIME=$((PROCESSING_END - PROCESSING_START))

log "✅ Processing completed: $TASKS_PROCESSED tasks in ${PROCESSING_TIME}s"

# Step 7: Verify final system state
echo -e "\n${BLUE}Step 7: System State Verification${NC}"

log "📊 Verifying final project statistics..."

TOTAL_COMPLETED=0
TOTAL_REMAINING=0

for i in $(seq 1 $NUM_PROJECTS); do
    PROJECT_NAME="stress-project-$i"
    STATS=$($CLI_CMD get-project-stats "$PROJECT_NAME" 2>/dev/null)
    
    COMPLETED=$(echo "$STATS" | grep "Completed:" | awk '{print $2}')
    QUEUED=$(echo "$STATS" | grep "Queued:" | awk '{print $2}')
    RUNNING=$(echo "$STATS" | grep "Running:" | awk '{print $2}')
    FAILED=$(echo "$STATS" | grep "Failed:" | awk '{print $2}')
    
    TOTAL_COMPLETED=$((TOTAL_COMPLETED + COMPLETED))
    TOTAL_REMAINING=$((TOTAL_REMAINING + QUEUED + RUNNING))
    
    log "  Project $i: $COMPLETED completed, $QUEUED queued, $RUNNING running, $FAILED failed"
done

log "📈 System totals: $TOTAL_COMPLETED completed, $TOTAL_REMAINING remaining"

# Step 8: Performance metrics
echo -e "\n${BLUE}Step 8: Performance Analysis${NC}"

TOTAL_TIME=$((PROCESSING_END - TASK_CREATION_START))
TASKS_PER_SECOND=$(echo "scale=2; $TASKS_CREATED / $CREATION_TIME" | bc -l 2>/dev/null || echo "N/A")
PROCESSING_RATE=$(echo "scale=2; $TASKS_PROCESSED / $PROCESSING_TIME" | bc -l 2>/dev/null || echo "N/A")
THROUGHPUT=$(echo "scale=2; $TOTAL_COMPLETED / $TOTAL_TIME" | bc -l 2>/dev/null || echo "N/A")

log "📊 Performance Metrics:"
log "  • Task creation rate: $TASKS_PER_SECOND tasks/second"
log "  • Processing rate: $PROCESSING_RATE tasks/second"
log "  • Overall throughput: $THROUGHPUT tasks/second"
log "  • Total test time: ${TOTAL_TIME}s"
log "  • Tasks created: $TASKS_CREATED"
log "  • Tasks processed: $TASKS_PROCESSED"
log "  • Success rate: $(echo "scale=1; $TOTAL_COMPLETED * 100 / $TASKS_CREATED" | bc -l 2>/dev/null || echo "N/A")%"

# Step 9: Resource cleanup test
echo -e "\n${BLUE}Step 9: Resource Cleanup Test${NC}"

log "🧹 Testing lease cleanup across all projects..."
TOTAL_RECLAIMED=0

for i in $(seq 1 $NUM_PROJECTS); do
    PROJECT_NAME="stress-project-$i"
    CLEANUP_OUTPUT=$($CLI_CMD cleanup-leases "$PROJECT_NAME" 2>/dev/null)
    
    if [[ $CLEANUP_OUTPUT == *"Reclaimed Tasks:"* ]]; then
        RECLAIMED=$(echo "$CLEANUP_OUTPUT" | grep "Reclaimed Tasks:" | awk '{print $3}')
        TOTAL_RECLAIMED=$((TOTAL_RECLAIMED + RECLAIMED))
    fi
done

log "✓ Lease cleanup completed: $TOTAL_RECLAIMED tasks reclaimed"

# Final assessment
echo -e "\n${GREEN}🎉 STRESS TEST COMPLETED!${NC}"
echo "===================================="

# Determine test success based on metrics
SUCCESS_THRESHOLD=70  # At least 70% of tasks should be processed successfully

if [[ $TASKS_CREATED -ge $((TOTAL_TASKS_EXPECTED * 8 / 10)) ]] && 
   [[ $TOTAL_COMPLETED -ge $((TASKS_CREATED * SUCCESS_THRESHOLD / 100)) ]]; then
    echo -e "${GREEN}✅ Stress Test PASSED${NC}"
    EXIT_CODE=0
else
    echo -e "${RED}❌ Stress Test FAILED${NC}"
    EXIT_CODE=1
fi

echo ""
echo "📊 Final Summary:"
echo "  • Projects created: $NUM_PROJECTS ✓"
echo "  • Task types created: $TASK_TYPE_COUNT ✓"
echo "  • Agents registered: $AGENT_COUNT ✓"
echo "  • Tasks created: $TASKS_CREATED/$TOTAL_TASKS_EXPECTED"
echo "  • Tasks completed: $TOTAL_COMPLETED"
echo "  • Success rate: $(echo "scale=1; $TOTAL_COMPLETED * 100 / $TASKS_CREATED" | bc -l 2>/dev/null || echo "N/A")%"
echo "  • Average throughput: $THROUGHPUT tasks/second"
echo ""

if [[ $EXIT_CODE -eq 0 ]]; then
    echo -e "${GREEN}🚀 TaskDriver demonstrated excellent performance under stress!${NC}"
else
    echo -e "${RED}⚠️  TaskDriver performance needs attention under high load${NC}"
fi

exit $EXIT_CODE
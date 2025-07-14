# TaskDriver End-to-End Tests

This directory contains comprehensive end-to-end tests for the TaskDriver system. These tests validate the complete functionality from CLI operations to system integration under various conditions.

## Test Suite Overview

### 🧪 Test Scripts

1. **`cli-workflow.sh`** - Complete CLI workflow test
   - Tests the full user journey from project creation to task completion
   - Validates all CLI commands and their integration
   - Verifies data consistency and workflow correctness

2. **`mcp-integration.sh`** - MCP server integration test
   - Tests MCP server functionality and integration
   - Simulates multiple MCP clients working concurrently
   - Validates error resilience and data consistency

3. **`stress-test.sh`** - High-load performance test
   - Creates multiple projects, agents, and tasks
   - Tests concurrent operations and high throughput
   - Measures performance metrics and success rates

4. **`failure-scenarios.sh`** - Error handling and edge cases
   - Tests various failure scenarios and error conditions
   - Validates input validation and error messages
   - Tests duplicate handling and data integrity

5. **`run-all-tests.sh`** - Complete test suite runner
   - Runs all tests in sequence with proper setup/cleanup
   - Generates comprehensive test reports
   - Provides overall system validation

## Running Tests

### Quick Start

Run the complete test suite:
```bash
# From project root
bash test/e2e/run-all-tests.sh
```

### Individual Tests

Run specific tests:
```bash
# CLI workflow test
bash test/e2e/cli-workflow.sh

# MCP integration test
bash test/e2e/mcp-integration.sh

# Stress test
bash test/e2e/stress-test.sh

# Failure scenarios test
bash test/e2e/failure-scenarios.sh
```

## Test Details

### CLI Workflow Test (`cli-workflow.sh`)

**Purpose**: Validates the complete end-user workflow using the CLI interface.

**Test Scenario**:
1. ✅ System health check
2. 🏗️ Create project with custom configuration
3. 📝 Create task type with template and variables
4. 🤖 Register agent with capabilities
5. 📋 Create multiple tasks with variables
6. ⚡ Agent processes tasks (get → complete cycle)
7. 📊 Verify final statistics and project state
8. 🔍 Test error handling for invalid operations
9. 🧹 Test lease management and cleanup

**Expected Results**:
- All commands execute successfully
- Data consistency throughout workflow
- Proper error handling for invalid inputs
- Complete task lifecycle from creation to completion

### MCP Integration Test (`mcp-integration.sh`)

**Purpose**: Validates MCP server functionality and multi-client scenarios.

**Test Scenario**:
1. 🚀 MCP server startup validation
2. 🔧 CLI operations simulating MCP tool calls
3. ⚡ Concurrent operations (multiple MCP clients)
4. 🤖 Multi-agent concurrent processing
5. 🔍 Error resilience testing
6. 📊 Data consistency validation

**Expected Results**:
- MCP server starts without errors
- Concurrent operations work correctly
- No data corruption under load
- Proper error handling for invalid operations

### Stress Test (`stress-test.sh`)

**Purpose**: Tests system performance and stability under high load.

**Test Configuration**:
- 3 projects
- 2 task types per project (6 total)
- 2 agents per project (6 total)
- 5 tasks per task type (30 total tasks)
- Concurrent processing by all agents

**Test Scenario**:
1. 🏗️ Create multiple projects simultaneously
2. 📝 Create task types with templates
3. 🤖 Register multiple agents
4. 📋 Create high volume of tasks (30 tasks)
5. ⚡ Concurrent agent processing
6. 📊 Performance metrics collection
7. 🧹 Resource cleanup testing

**Performance Metrics**:
- Task creation rate (tasks/second)
- Processing rate (tasks/second)
- Overall throughput (tasks/second)
- Success rate (percentage)

**Expected Results**:
- At least 70% task completion rate
- No system crashes or data corruption
- Reasonable performance under load
- Proper cleanup of resources

### Failure Scenarios Test (`failure-scenarios.sh`)

**Purpose**: Validates error handling, edge cases, and system resilience.

**Test Categories**:
1. **Project Operations**: Invalid names, duplicates, non-existent projects
2. **Task Types**: Validation failures, invalid projects
3. **Task Creation**: Invalid inputs, JSON parsing errors
4. **Agent Operations**: Registration failures, invalid operations
5. **Task Processing**: Non-existent resources, invalid states
6. **Duplicate Handling**: Fail/ignore/allow behaviors
7. **Lease Management**: Timeout scenarios, cleanup
8. **Concurrent Access**: Race conditions, data integrity
9. **Resource Exhaustion**: Empty queues, no available tasks
10. **Data Integrity**: Long inputs, special characters

**Expected Results**:
- All invalid operations fail with appropriate error messages
- System remains stable after error conditions
- Data integrity maintained throughout
- Proper duplicate handling behaviors

## Test Environment

### Prerequisites

- **Bun Runtime**: Required for running TypeScript
- **bc Calculator**: Optional, for performance calculations
- **Unix-like Environment**: Tests use bash scripts

### Data Isolation

Each test creates isolated data directories:
- `./data` - Default storage directory
- `./test-*-data` - Test-specific data directories
- `/tmp/*_*.out` - Temporary test output files

All test data is automatically cleaned up after test completion.

### Configuration

Tests use default TaskDriver configuration with these modifications:
- Shorter lease durations for faster testing
- Reduced retry counts for quicker failure detection
- Custom project names to avoid conflicts

## Interpreting Results

### Success Indicators

✅ **All Tests Pass**: System is fully functional
- CLI operations work correctly
- MCP integration is stable
- Performance meets expectations
- Error handling is robust

### Performance Benchmarks

The stress test measures:
- **Task Creation Rate**: Should be > 10 tasks/second
- **Processing Rate**: Should be > 5 tasks/second
- **Success Rate**: Should be > 70%
- **System Stability**: No crashes or data corruption

### Common Issues

🔍 **Low Success Rate**: May indicate:
- Resource contention under load
- Timing issues with concurrent operations
- Storage provider limitations

🔍 **Test Failures**: May indicate:
- Configuration issues
- Missing dependencies
- System environment problems

## Customization

### Modifying Test Parameters

Edit the configuration variables at the top of each test script:

```bash
# In stress-test.sh
NUM_PROJECTS=3              # Number of projects to create
NUM_AGENTS_PER_PROJECT=2    # Agents per project
NUM_TASKS_PER_TYPE=5        # Tasks per task type
PROCESSING_DELAY=0.5        # Simulated processing time
```

### Adding New Tests

1. Create new test script in `test/e2e/`
2. Follow the existing pattern:
   - Use color coding for output
   - Include cleanup function
   - Set exit codes appropriately
   - Add comprehensive logging

3. Add to `run-all-tests.sh` if desired

### Storage Provider Testing

Tests work with all storage providers:
- **File Storage**: Default, no setup required
- **MongoDB**: Set `TASKDRIVER_STORAGE_PROVIDER=mongo` + connection details
- **Redis**: Set `TASKDRIVER_STORAGE_PROVIDER=redis` + connection details

## Continuous Integration

These tests are designed for CI/CD pipelines:

```yaml
# Example GitHub Actions usage
- name: Run E2E Tests
  run: |
    bun install
    bash test/e2e/run-all-tests.sh
```

The test suite:
- Returns proper exit codes (0 = success, 1 = failure)
- Provides detailed output for debugging
- Cleans up all resources automatically
- Works in headless environments

## Troubleshooting

### Test Hangs

If tests hang:
1. Check for zombie processes: `ps aux | grep taskdriver`
2. Kill processes: `pkill -f "src/cli.ts"`
3. Clean up data: `rm -rf ./data ./test-*-data`

### Permission Errors

If permission denied:
```bash
chmod +x test/e2e/*.sh
```

### Missing Dependencies

Ensure all dependencies are installed:
```bash
bun install
bun run build
```

## Contributing

When adding features:
1. Add corresponding test cases to existing scripts
2. Create new test scripts for major features
3. Update this README with new test descriptions
4. Ensure tests pass in CI environment
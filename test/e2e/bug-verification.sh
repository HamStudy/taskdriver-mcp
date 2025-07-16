#!/bin/bash

# Bug Verification Script
# This script demonstrates that the CLI test would now catch the original bug

set -e

echo "🐛 Bug Verification: Testing get-project output"
echo "=============================================="

# Clean up any existing test data
rm -rf ./data 2>/dev/null || true

# Create a test project with instructions
echo "Creating test project with instructions..."
bun run src/cli.ts create-project bugtest "Bug test project" --instructions "Critical: These instructions MUST be visible to agents" > /dev/null

# Test the get-project command
echo "Testing get-project command..."
OUTPUT=$(bun run src/cli.ts get-project bugtest)

echo "Output received:"
echo "$OUTPUT"
echo ""

# Check if the output contains what it should
if [[ $OUTPUT == *"Instructions:"* ]] && [[ $OUTPUT == *"Critical: These instructions MUST be visible to agents"* ]]; then
    echo "✅ SUCCESS: Instructions are properly displayed"
    echo "✅ The bug is FIXED - agents can see project instructions"
else
    echo "❌ FAILURE: Instructions are missing or not displayed"
    echo "❌ This would indicate the bug is still present"
    exit 1
fi

# Verify it's not showing health check instead
if [[ $OUTPUT == *"System Status: ACTIVE"* ]]; then
    echo "❌ FAILURE: Still showing health check format instead of project details"
    exit 1
else
    echo "✅ SUCCESS: Not showing health check format"
fi

# Verify all expected sections are present
EXPECTED_SECTIONS=("Status:" "Configuration:" "Statistics:" "Instructions:")
for section in "${EXPECTED_SECTIONS[@]}"; do
    if [[ $OUTPUT == *"$section"* ]]; then
        echo "✅ Found expected section: $section"
    else
        echo "❌ Missing expected section: $section"
        exit 1
    fi
done

echo ""
echo "🎉 All verification checks passed!"
echo "📝 The original bug (showing 'System Status: ACTIVE' instead of project details) has been fixed."
echo "🔍 The CLI now properly shows project instructions that agents need to see."

# Cleanup
rm -rf ./data 2>/dev/null || true
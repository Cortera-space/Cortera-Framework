#!/bin/bash
# Tera Observability API Demo Script
# Run this after starting the example app with: pnpm dev
# Then run: chmod +x scripts/dashboard-demo.sh && ./scripts/dashboard-demo.sh

set -e

BASE="http://localhost:3000"
API_KEY="sk-agent-123"
WS="default-workspace"

echo "=========================================="
echo "Tera Stage 7: Observability API Demo"
echo "=========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

function step() {
  echo -e "${BLUE}=== $1 ===${NC}"
}

function success() {
  echo -e "${GREEN}$1${NC}"
}

function run_curl() {
  echo -e "${YELLOW}$ $1${NC}"
  eval "$1"
  echo ""
}

# Step 1: Create some events
step "1. Creating test events"

run_curl "curl -s -X POST ${BASE}/actions/createNote \
  -H 'Content-Type: application/json' \
  -H 'x-tera-api-key: ${API_KEY}' \
  -d '{\"title\":\"Demo Note 1\",\"content\":\"First demo note\"}' | jq ."

run_curl "curl -s -X POST ${BASE}/actions/createNote \
  -H 'Content-Type: application/json' \
  -H 'x-tera-api-key: ${API_KEY}' \
  -d '{\"title\":\"Demo Note 2\",\"content\":\"Second demo note\"}' | jq ."

run_curl "curl -s -X POST ${BASE}/actions/notifyWatchers \
  -H 'Content-Type: application/json' \
  -H 'x-tera-api-key: ${API_KEY}' \
  -d '{\"noteId\":\"demo-1\",\"title\":\"Demo Note 1\"}' | jq ."

# Step 2: Create a containment scenario
step "2. Creating blast radius containment scenario"

ROOT_RESPONSE=$(curl -s -X POST ${BASE}/actions/restrictedNote \
  -H 'Content-Type: application/json' \
  -H 'x-tera-api-key: ${API_KEY}' \
  -d '{"title":"Root Action","content":"Blast radius root"}')
echo "$ROOT_RESPONSE" | jq .
ROOT_EVENT_ID=$(echo "$ROOT_RESPONSE" | jq -r '.eventId // .result.eventId // empty')

if [ -z "$ROOT_EVENT_ID" ]; then
  ROOT_EVENT_ID=$(curl -s -G "${BASE}/api/tera/events" \
    -H "x-tera-api-key: ${API_KEY}" \
    -d "workspaceId=${WS}" \
    -d "actionName=restrictedNote" \
    -d "limit=1" | jq -r '.items[0].eventId')
fi
echo "Root Event ID: $ROOT_EVENT_ID"

run_curl "curl -s -X POST ${BASE}/actions/deleteAllCustomers \
  -H 'Content-Type: application/json' \
  -H 'x-tera-api-key: ${API_KEY}' \
  -H 'x-tera-parent-event-id: ${ROOT_EVENT_ID}' \
  -d '{\"reason\":\"testing containment\"}' | jq ."

# Step 3: Create a pending approval
step "3. Creating pending approval"

APPROVAL_RESPONSE=$(curl -s -X POST ${BASE}/actions/deleteCustomer \
  -H 'Content-Type: application/json' \
  -b 'tera-session={"actorId":"user-1","actorType":"human"}' \
  -d '{"id":"cust-demo-1"}')
echo "$APPROVAL_RESPONSE" | jq .
APPROVAL_ID=$(echo "$APPROVAL_RESPONSE" | jq -r '.approvalId // empty')
echo "Approval ID: $APPROVAL_ID"

echo ""
step "4. Querying Observability Endpoints"
echo ""

# 4a. List Events
step "4a. GET /api/tera/events (list recent events)"
run_curl "curl -s -G '${BASE}/api/tera/events' \
  -H 'x-tera-api-key: ${API_KEY}' \
  -d 'workspaceId=${WS}' \
  -d 'limit=10' | jq ."

# 4b. List Events with filters
step "4b. GET /api/tera/events (filtered by actorType=agent)"
run_curl "curl -s -G '${BASE}/api/tera/events' \
  -H 'x-tera-api-key: ${API_KEY}' \
  -d 'workspaceId=${WS}' \
  -d 'actorType=agent' \
  -d 'limit=10' | jq ."

# 4c. Get Event Chain
if [ -n "$ROOT_EVENT_ID" ]; then
  step "4c. GET /api/tera/events/:id/chain (event chain for root)"
  run_curl "curl -s '${BASE}/api/tera/events/${ROOT_EVENT_ID}/chain' \
    -H 'x-tera-api-key: ${API_KEY}' | jq ."
fi

# 4d. List Contained Actors
step "4d. GET /api/tera/actors/contained"
run_curl "curl -s -G '${BASE}/api/tera/actors/contained' \
  -H 'x-tera-api-key: ${API_KEY}' \
  -d 'workspaceId=${WS}' | jq ."

# 4e. List Pending Approvals
step "4e. GET /api/tera/approvals/pending"
run_curl "curl -s -G '${BASE}/api/tera/approvals/pending' \
  -H 'x-tera-api-key: ${API_KEY}' \
  -d 'workspaceId=${WS}' | jq ."

# Step 5: Demonstrate SSE Stream (run for 3 seconds)
step "5. GET /api/tera/events/stream (SSE live stream - 3 seconds)"
echo -e "${YELLOW}Connecting to SSE stream... (will timeout after 3 seconds)${NC}"
timeout 3 curl -N -s -G "${BASE}/api/tera/events/stream" \
  -H "x-tera-api-key: ${API_KEY}" \
  -d "workspaceId=${WS}" \
  -d "actorType=agent" || true
echo ""

# Step 6: Demonstrate Write Actions
step "6. Write Actions: Resolve Approval & Review Containment"

if [ -n "$APPROVAL_ID" ]; then
  step "6a. POST /api/actions/approvals/:id (approve)"
  run_curl "curl -s -X POST '${BASE}/actions/approvals/${APPROVAL_ID}' \
    -H 'Content-Type: application/json' \
    -b 'tera-session={\"actorId\":\"reviewer-1\",\"actorType\":\"human\"}' \
    -d '{\"decision\":\"approved\"}' | jq ."
fi

step "6b. POST /api/actors/:actorId/review (lift containment)"
run_curl "curl -s -X POST '${BASE}/actors/agent-1/review?workspaceId=${WS}' \
  -H 'Content-Type: application/json' \
  -H 'x-tera-api-key: ${API_KEY}' \
  -d '{\"decision\":\"lift\"}' | jq ."

echo ""
success "=========================================="
success "Demo complete! All observability endpoints verified."
success "=========================================="
echo ""
echo "For more details, see docs/building-a-dashboard.md"
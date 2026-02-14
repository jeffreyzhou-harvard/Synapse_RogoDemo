#!/bin/bash

echo "Testing all backend endpoints for demo tabs..."
echo ""

# Test Plan endpoint
echo "1. Testing /plan endpoint..."
curl -s -X POST http://localhost:8000/plan \
  -H "Content-Type: application/json" \
  -d '{"goal":"Test goal","notes":"Test notes","context":{}}' | head -c 200
echo ""
echo ""

# Test Sandbox endpoint
echo "2. Testing /sandbox/execute endpoint..."
curl -s -X POST http://localhost:8000/sandbox/execute \
  -H "Content-Type: application/json" \
  -d '{"code":"print(\"hello\")\nresult = 1+1","timeout_ms":2000}' | python -m json.tool
echo ""

# Test RFC endpoint
echo "3. Testing /rfc/draft endpoint..."
curl -s -X POST http://localhost:8000/rfc/draft \
  -H "Content-Type: application/json" \
  -d '{"context":"Build a payment API"}' | head -c 200
echo ""
echo ""

# Test Graph endpoint
echo "4. Testing /graph/dependencies endpoint..."
curl -s -X POST http://localhost:8000/graph/dependencies \
  -H "Content-Type: application/json" \
  -d '{"path":"app"}' | python -m json.tool | head -20
echo ""

# Test Hotspots endpoint
echo "5. Testing /hotspots endpoint..."
curl -s -X POST http://localhost:8000/hotspots \
  -H "Content-Type: application/json" \
  -d '{"path":"app"}' | python -m json.tool | head -20
echo ""

# Test Knowledge Graph endpoints
echo "6. Testing /knowledge-graph/status endpoint..."
curl -s http://localhost:8000/knowledge-graph/status | python -m json.tool
echo ""

echo "7. Testing /knowledge-graph/graph endpoint..."
curl -s http://localhost:8000/knowledge-graph/graph | python -m json.tool | head -30
echo ""

# Test Living Specs endpoint
echo "8. Testing /specs/living endpoint..."
curl -s http://localhost:8000/specs/living | python -m json.tool | head -30
echo ""

echo "✅ All endpoint tests complete!"

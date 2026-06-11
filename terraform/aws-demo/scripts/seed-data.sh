#!/bin/bash
# =============================================================================
# Seed DynamoDB with sample products for the demo
# Usage: ./seed-data.sh [region]
# =============================================================================

set -e

REGION="${1:-us-east-1}"
TABLE="capy-pos-demo-products"

echo "🌱 Seeding DynamoDB table: $TABLE in $REGION"

# Sample products for a small café/store POS
PRODUCTS=(
  '{"id":{"S":"prod-001"},"name":{"S":"Espresso"},"price":{"N":"3.50"},"stock":{"N":"100"},"category":{"S":"beverages"}}'
  '{"id":{"S":"prod-002"},"name":{"S":"Cappuccino"},"price":{"N":"4.50"},"stock":{"N":"80"},"category":{"S":"beverages"}}'
  '{"id":{"S":"prod-003"},"name":{"S":"Croissant"},"price":{"N":"2.75"},"stock":{"N":"30"},"category":{"S":"bakery"}}'
  '{"id":{"S":"prod-004"},"name":{"S":"Sandwich"},"price":{"N":"6.00"},"stock":{"N":"20"},"category":{"S":"food"}}'
  '{"id":{"S":"prod-005"},"name":{"S":"Orange Juice"},"price":{"N":"3.00"},"stock":{"N":"50"},"category":{"S":"beverages"}}'
  '{"id":{"S":"prod-006"},"name":{"S":"Muffin"},"price":{"N":"3.25"},"stock":{"N":"25"},"category":{"S":"bakery"}}'
  '{"id":{"S":"prod-007"},"name":{"S":"Latte"},"price":{"N":"5.00"},"stock":{"N":"60"},"category":{"S":"beverages"}}'
  '{"id":{"S":"prod-008"},"name":{"S":"Cookie"},"price":{"N":"2.00"},"stock":{"N":"40"},"category":{"S":"bakery"}}'
  '{"id":{"S":"prod-009"},"name":{"S":"Water Bottle"},"price":{"N":"1.50"},"stock":{"N":"200"},"category":{"S":"beverages"}}'
  '{"id":{"S":"prod-010"},"name":{"S":"Bagel"},"price":{"N":"3.00"},"stock":{"N":"0"},"category":{"S":"bakery"}}'
)

for item in "${PRODUCTS[@]}"; do
  product_name=$(echo "$item" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['name']['S'])" 2>/dev/null || echo "product")
  echo "  📦 Adding: $product_name"
  aws dynamodb put-item \
    --table-name "$TABLE" \
    --item "$item" \
    --region "$REGION" \
    --no-cli-pager
done

echo ""
echo "✅ Seeded $TABLE with ${#PRODUCTS[@]} products"
echo ""
echo "⚠️  Note: prod-010 (Bagel) has stock=0 — perfect for triggering the"
echo "   negative stock failure scenario during the demo!"

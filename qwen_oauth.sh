#!/bin/bash

# Step 1: Generate PKCE code verifier and challenge
CODE_VERIFIER=$(openssl rand -base64 32 | tr -d '=' | tr '+/' '-_' | cut -c1-43)
CODE_CHALLENGE=$(echo -n "$CODE_VERIFIER" | openssl dgst -sha256 -binary | base64 | tr -d '=' | tr '+/' '-_')

echo "Code Verifier: $CODE_VERIFIER"
echo "Code Challenge: $CODE_CHALLENGE"
echo ""

# Step 2: Request device code with PKCE
echo "Requesting device code..."
RESPONSE=$(curl -s -X POST https://chat.qwen.ai/api/v1/oauth2/device/code \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=f0304373b74a44d2b584a3fb70ca9e56" \
  -d "scope=openid profile email model.completion" \
  -d "code_challenge=$CODE_CHALLENGE" \
  -d "code_challenge_method=S256")

echo "Device code response:"
echo "$RESPONSE" | jq '.'
echo ""

# Extract values
DEVICE_CODE=$(echo "$RESPONSE" | jq -r '.device_code')
USER_CODE=$(echo "$RESPONSE" | jq -r '.user_code')
VERIFICATION_URI=$(echo "$RESPONSE" | jq -r '.verification_uri')
INTERVAL=$(echo "$RESPONSE" | jq -r '.interval // 5')

echo "============================================"
echo "Please visit: $VERIFICATION_URI"
echo "Enter code: $USER_CODE"
echo "============================================"
echo ""
echo "Polling for authorization..."

# Step 3: Poll for token (with code_verifier for PKCE)
while true; do
  sleep "$INTERVAL"
  
  TOKEN_RESPONSE=$(curl -s -X POST https://chat.qwen.ai/api/v1/oauth2/token \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "client_id=f0304373b74a44d2b584a3fb70ca9e56" \
    -d "grant_type=urn:ietf:params:oauth:grant-type:device_code" \
    -d "device_code=$DEVICE_CODE" \
    -d "code_verifier=$CODE_VERIFIER")
  
  ERROR=$(echo "$TOKEN_RESPONSE" | jq -r '.error // empty')
  
  if [ "$ERROR" == "authorization_pending" ]; then
    echo "Still waiting for user authorization..."
    continue
  elif [ "$ERROR" == "slow_down" ]; then
    echo "Slowing down polling..."
    INTERVAL=$((INTERVAL + 5))
    continue
  elif [ -z "$ERROR" ]; then
    echo ""
    echo "✓ Authorization successful!"
    echo ""
    echo "Token response:"
    echo "$TOKEN_RESPONSE" | jq '.'
    
    # Extract tokens
    ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.access_token')
    REFRESH_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.refresh_token')
    EXPIRES_IN=$(echo "$TOKEN_RESPONSE" | jq -r '.expires_in')
    
    # Save to file
    echo "$TOKEN_RESPONSE" > qwen_tokens.json
    echo ""
    echo "Tokens saved to qwen_tokens.json"
    break
  else
    echo "Error: $ERROR"
    echo "$TOKEN_RESPONSE" | jq '.'
    exit 1
  fi
done

# Step 4: Refresh token example
echo ""
echo "============================================"
echo "To refresh your token later, use:"
echo "============================================"
cat << 'EOF'
curl -s -X POST https://chat.qwen.ai/api/v1/oauth2/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=f0304373b74a44d2b584a3fb70ca9e56" \
  -d "grant_type=refresh_token" \
  -d "refresh_token=YOUR_REFRESH_TOKEN_HERE"
EOF

echo ""
echo "Access Token: $ACCESS_TOKEN"
echo "Refresh Token: $REFRESH_TOKEN"
echo "Expires in: $EXPIRES_IN seconds"

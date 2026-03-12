#!/bin/bash

curl https://api.vapi.ai/structured-output \
  -H "Authorization: Bearer $VAPI_API_KEY" \
  -H "Content-Type: application/json" \
  -d @plumbing-call-schema.json

# LiteLLM Implementation Plan

## Overview

Implement LiteLLM as a separate ECS Fargate service to handle file uploads and provide a unified API for all LLM providers (Gemini, OpenAI, Anthropic).

## Architecture

```
ALB → Backend Service (NestJS)
    → LiteLLM Service (ECS Fargate) → Gemini/OpenAI/Anthropic
```

## Implementation Todos

### Phase 1: Research & Planning

- [ ] **litellm-1**: Research LiteLLM configuration
  - Review LiteLLM docs for file upload API (`/v1/files`)
  - Understand model routing format (`gemini/gemini-3-pro`, `openai/gpt-4`)
  - Review environment variable setup and config file options
  - Check health check endpoint (`/health`)

### Phase 2: Infrastructure (CDK)

- [ ] **litellm-2**: Add LiteLLM ECS service to `backend-stack.ts`
  - Create Fargate task definition (512MB RAM, 256 CPU)
  - Add LiteLLM container with Docker image `ghcr.io/berriai/litellm:main-latest`
  - Configure port mapping (4000)
  - Create Fargate service in same cluster
  - Set up CloudWatch logging

- [ ] **litellm-3**: Configure ALB routing
  - Create ApplicationTargetGroup for LiteLLM (port 4000)
  - Add health check path `/health`
  - Add route to HTTPS listener: `/litellm/*` → LiteLLM target group
  - Update security groups to allow ALB → LiteLLM traffic

- [ ] **litellm-4**: Set up Secrets Manager
  - Create AWS Secrets Manager secret: `remorai/llm/api-keys`
  - Store: `OPENAI_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`
  - Grant ECS task role permission to read secret
  - Update LiteLLM container to use secrets from Secrets Manager

### Phase 3: Backend Integration

- [ ] **litellm-5**: Create LiteLLMService
  - File: `apps/backend/src/shared/llm/services/litellm.service.ts`
  - Implement `uploadFile(fileBuffer: Buffer, mimeType: string): Promise<string>`
    - POST to `/v1/files` with FormData
    - Return file ID
  - Implement `ask()` method using OpenAI-compatible API
    - POST to `/v1/chat/completions`
    - Use model format: `gemini/gemini-3-pro`, `openai/gpt-4`, etc.
    - Support file attachments via `file_id` in messages
  - Implement `deleteFile(fileId: string)` for cleanup
  - Add error handling and retry logic

- [ ] **litellm-6**: Update LLMService
  - Modify `llm.service.ts` to use LiteLLMService
  - Keep provider fallback logic (if LiteLLM fails, fall back to direct providers)
  - Update model selection to use LiteLLM format (`gemini/gemini-3-pro`)
  - Handle file uploads: upload to LiteLLM first, then use file IDs

- [ ] **litellm-7**: Update LLMModule
  - Register LiteLLMService in `llm.module.ts`
  - Export LiteLLMService
  - Ensure proper dependency injection

- [ ] **litellm-8**: Add environment variables
  - Add `LITELLM_BASE_URL` to `apps/backend/src/config/env.ts`
  - Add to `.env`: `LITELLM_BASE_URL=http://localhost:4000` (local)
  - Add to `.env.production`: `LITELLM_BASE_URL=http://litellm-service:4000` (ECS internal)
  - Or use ALB URL: `LITELLM_BASE_URL=https://api.remorai.solutions/litellm`

### Phase 4: PDF Extraction Updates

- [ ] **litellm-9**: Update PDF extraction service
  - Modify `pdf-extraction.service.ts`
  - Instead of base64 attachments, upload PDF to LiteLLM
  - Use file ID in API call
  - Remove image conversion (use native PDF via LiteLLM)
  - Update prompts to work with full PDF context

### Phase 5: Testing

- [ ] **litellm-10**: Test locally
  - Run LiteLLM in Docker: `docker run -p 4000:4000 -e GEMINI_API_KEY=... ghcr.io/berriai/litellm:main-latest`
  - Test file upload API: `POST /v1/files`
  - Test chat completion with file: `POST /v1/chat/completions` with `file_id`
  - Test PDF extraction flow end-to-end
  - Verify all providers work (Gemini, OpenAI, Anthropic)

- [ ] **litellm-11**: Deploy infrastructure
  - Run `cdk deploy Remorai-Backend-dev`
  - Verify LiteLLM service starts successfully
  - Check CloudWatch logs for LiteLLM container
  - Verify ALB target group shows healthy targets

- [ ] **litellm-12**: Verify health check
  - Test `/health` endpoint through ALB: `https://api.remorai.solutions/litellm/health`
  - Ensure health check passes in target group
  - Verify service stays healthy

- [ ] **litellm-13**: Test production
  - Run PDF extraction job in production
  - Verify file upload to LiteLLM succeeds
  - Verify extraction completes successfully
  - Compare results with previous approach (should be better quality)
  - Monitor CloudWatch logs for errors

### Phase 6: Monitoring & Optimization

- [ ] **litellm-14**: Monitor and optimize
  - Check CloudWatch metrics: CPU, memory, request count
  - Review LiteLLM logs for errors or warnings
  - Adjust ECS task resources if needed (CPU/memory)
  - Set up CloudWatch alarms for LiteLLM service health
  - Document any configuration tweaks needed

## Success Criteria

- ✅ LiteLLM service running in ECS and accessible via ALB
- ✅ PDF extraction uses LiteLLM file upload (no base64)
- ✅ All 3 providers (Gemini, OpenAI, Anthropic) work through LiteLLM
- ✅ Extraction quality matches or exceeds previous results
- ✅ No timeout or payload size errors
- ✅ Full document context available (no page fragmentation)

## Rollback Plan

If LiteLLM causes issues:

1. Update `LLMService` to bypass LiteLLM (use direct providers)
2. Keep LiteLLM service running but unused
3. Revert `pdf-extraction.service.ts` to previous approach if needed

## Notes

- LiteLLM handles file storage automatically (no S3 needed for this)
- File IDs are provider-agnostic (same file works for all providers)
- LiteLLM provides unified logging/monitoring across providers
- Can add rate limiting, caching, and other features via LiteLLM config later

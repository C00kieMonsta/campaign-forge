# Campaign Forge — Architecture

Newsletter and campaign tool for Thermonique. Fully serverless on AWS.

## Stack

| Layer | Service | Code |
|-------|---------|------|
| Landing site | S3 + CloudFront | `apps/landing` |
| Admin SPA | S3 + CloudFront | `apps/frontend` |
| API | API Gateway HTTP API + Lambda | `apps/backend` |
| Database | DynamoDB (Contacts + Campaigns) | — |
| Email | SES | — |
| Auth | Cognito User Pool (admin only) | — |
| Infra-as-code | CDK | `infrastructure/` |

## Architecture

```
Route53 DNS
├── thermonique.be      → CloudFront → S3 (landing)
├── admin.thermonique.be → CloudFront → S3 (admin SPA)
└── api.thermonique.be  → API Gateway HTTP API
                             ├── /public/*   (no auth)
                             │   ├── POST /subscribe
                             │   └── GET  /unsubscribe?token=...
                             └── /admin/*    (Cognito JWT)
                                 ├── contacts CRUD + import/export
                                 └── campaigns CRUD + test + send
                                       ↓
                              DynamoDB + SES
```

## Lambdas (3 groups)

- **public** — subscribe + unsubscribe (no auth)
- **adminContacts** — list, get, create, update, import CSV, export CSV
- **adminCampaigns** — create, list, get, update, send test, send to list

## DynamoDB Tables

**Contacts** — PK: `emailLower`

| Field | Type | Notes |
|-------|------|-------|
| emailLower | string | PK, normalized |
| email | string | original case |
| firstName | string? | |
| lastName | string? | |
| status | `subscribed \| unsubscribed` | GSI partition key |
| source | `landing \| import \| admin` | |
| createdAt | ISO8601 | |
| updatedAt | ISO8601 | |
| unsubscribedAt | ISO8601? | |

GSI `byStatus`: PK = `gsi1pk` (status), SK = `gsi1sk` (emailLower)

**Campaigns** — PK: `campaignId`

| Field | Type | Notes |
|-------|------|-------|
| campaignId | string | UUID |
| subject | string | |
| html | string | raw HTML |
| status | `draft \| sent` | |
| createdAt | ISO8601 | |
| updatedAt | ISO8601 | |
| sentAt | ISO8601? | |
| sentCount | number? | |

## Repo Structure

```
campaign-forge/
├── apps/
│   ├── backend/         # Lambda handlers (Node/TS)
│   ├── frontend/        # Admin SPA (Vite React)
│   └── landing/         # Landing site (Vite React)
├── packages/
│   ├── types/           # Shared entities + DTOs (Zod)
│   ├── utils/           # Shared helpers
│   ├── core-client/     # Redux store + hooks
│   └── ui/              # Shared UI components
└── infrastructure/      # CDK stacks
```

## Auth Flow (Admin)

1. Admin clicks "Login" → redirect to Cognito Hosted UI
2. Cognito returns code to `admin.thermonique.be/auth/callback`
3. Frontend exchanges code for tokens (id_token + access_token)
4. API calls include `Authorization: Bearer <id_token>`
5. API Gateway JWT authorizer validates token on `/admin/*` routes
6. Optional allowlist in Lambda checks `claims.email`

## Send Campaign Flow

1. Admin creates campaign (subject + HTML) → saved as draft in DynamoDB
2. Admin clicks "Send" → `POST /admin/campaigns/{id}/send`
3. Lambda queries GSI for all `status=subscribed` contacts
4. For each contact: generates unsubscribe token, appends footer to HTML
5. Sends via SES with concurrency pool (~5 parallel)
6. Updates campaign: `status=sent`, `sentAt`, `sentCount`

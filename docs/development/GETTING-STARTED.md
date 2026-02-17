# Getting Started

Quick setup guide for new developers.

## Prerequisites

- Node.js 20.x
- pnpm 9.x+
- Git
- Text editor (VSCode recommended)

## Initial Setup (5 minutes)

```bash
# Clone repo
git clone <repository-url>
cd remorai-app

# Install dependencies
pnpm install

# Setup backend database
cd apps/backend
pnpm db:generate
pnpm db:push
pnpm db:seed
cd ../..

# Build packages
pnpm build:packages
```

## Running Development Servers

```bash
# In one terminal
pnpm dev:frontend        # http://localhost:8000

# In another terminal
pnpm dev:backend         # http://localhost:8001
```

## Project Structure

```
remorai-app/
├── apps/
│   ├── backend/          # NestJS API (port 8001)
│   └── frontend/         # Next.js web app (port 8000)
├── packages/
│   ├── types/            # Shared types & DTOs
│   ├── utils/            # Shared utilities & constants
│   ├── core-client/      # Redux & frontend repos
│   └── ui/               # UI components
├── docs/                 # Documentation
└── package.json
```

## Common Tasks

### First time? Read these (10 minutes)

1. [../README.md](../README.md) - Overview
2. [../ARCHITECTURE-RULES.md](../ARCHITECTURE-RULES.md) - Design patterns
3. [../CODE-STANDARDS.md](../CODE-STANDARDS.md) - Code quality

### Need a quick answer?

- **Where to put code?** → [../README.md](../README.md) "Quick Start" section
- **How to add a type?** → [../README.md](../README.md) "Common Tasks" section
- **Code quality?** → [../CODE-STANDARDS.md](../CODE-STANDARDS.md)
- **Architecture?** → [../ARCHITECTURE-RULES.md](../ARCHITECTURE-RULES.md)

### Working on a feature?

1. Read architecture rules: [../ARCHITECTURE-RULES.md](../ARCHITECTURE-RULES.md)
2. Find existing similar pattern in codebase
3. Follow the pattern
4. Self-review against checklist: [../CODE-STANDARDS.md](../CODE-STANDARDS.md#code-review-checklist)
5. Request code review

## Essential Commands

```bash
# Development
pnpm dev:frontend        # Start frontend
pnpm dev:backend         # Start backend

# Checking
pnpm type-check          # TypeScript errors
pnpm lint                # ESLint issues
pnpm lint:fix            # Fix ESLint issues

# Testing
pnpm test                # Run tests
pnpm test:watch          # Watch mode
pnpm test:coverage       # Coverage report

# Database
pnpm db:migrate          # Create migration
pnpm db:push             # Apply schema to DB
pnpm db:studio           # Open Prisma Studio

# Building
pnpm build:packages      # Build shared packages
pnpm build:all           # Build everything
```

## Database Setup

We use PostgreSQL (Supabase) + Prisma.

```bash
# Update schema
# 1. Edit apps/backend/prisma/schema.prisma
# 2. Create migration
pnpm db:migrate

# OR push directly (for dev)
pnpm db:push

# Seed database
pnpm db:seed

# Open Prisma Studio UI
pnpm db:studio
```

## Debugging

### Redux not updating?

1. Open Redux DevTools (Chrome extension)
2. Check if action dispatched
3. Verify repository calls `dispatch()`

### Component not rendering?

1. Check Redux store has data (Redux DevTools)
2. Verify `useSelector` hook is correct
3. Check `React.memo` isn't preventing re-render

### API returning error?

1. Check backend logs
2. Verify Zod schema validates request
3. Check DTO type matches API contract

### Type errors?

1. Verify type imported from `@packages/types`
2. Check import path is correct
3. Run `pnpm type-check`

## Git Workflow

```bash
# Create feature branch
git checkout -b feature/my-feature

# Work on feature
# ... make changes ...

# Before pushing - ensure:
pnpm type-check          # No type errors
pnpm lint:fix            # Fix linting
pnpm test                # Tests pass

# Commit & push
git add .
git commit -m "feat: description of change"
git push origin feature/my-feature

# Create pull request
# ... get review ...
# ... address feedback ...
# ... merge ...
```

## Code Review Checklist

Before requesting review, verify:

- [ ] Follows 8 golden rules (see [../ARCHITECTURE-RULES.md](../ARCHITECTURE-RULES.md))
- [ ] Types from @packages/types
- [ ] Constants from @packages/utils
- [ ] Functions <50 lines
- [ ] Tests added
- [ ] No `any` types
- [ ] No hardcoded values
- [ ] Structured logging
- [ ] Proper error handling
- [ ] `pnpm type-check` passes
- [ ] `pnpm lint:fix` passes
- [ ] `pnpm test` passes

## Useful VS Code Extensions

- ESLint
- Prettier
- Redux DevTools
- Prisma
- Thunder Client (API testing)

## Useful Chrome Extensions

- Redux DevTools
- React Developer Tools

## Need Help?

1. Check documentation: [../README.md](../README.md)
2. Search codebase for similar patterns
3. Check git log for context
4. Ask in team channel

## Next Steps

1. ✅ Setup complete
2. Read [../ARCHITECTURE-RULES.md](../ARCHITECTURE-RULES.md) - 15 min
3. Read [../CODE-STANDARDS.md](../CODE-STANDARDS.md) - 10 min
4. Find existing simple feature in code
5. Try adding a small utility to @packages/utils
6. Create your first feature!

---

**Welcome to the team! 🎉**

If you get stuck, the codebase is the best teacher - find similar patterns and follow them.


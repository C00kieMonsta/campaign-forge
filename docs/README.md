# Developer Documentation

Quick links to essential development information.

## 🚀 Quick Start

1. **New to the project?** → [GETTING-STARTED.md](./development/GETTING-STARTED.md)
2. **Writing code?** → [CODE-STANDARDS.md](./CODE-STANDARDS.md)
3. **Architecture questions?** → [ARCHITECTURE-RULES.md](./ARCHITECTURE-RULES.md)
4. **Deployment?** → [deployment/README.md](./deployment/README.md)
5. **Database?** → [database/README.md](./database/README.md)

## 📋 Essential Rules (Memorize These)

```typescript
// 1️⃣ TYPES → @packages/types
❌ interface MyType { } // Wrong place
✅ import { TMyType } from "@packages/types"

// 2️⃣ CONSTANTS → @packages/utils
❌ if (status === "pending") // Hardcoded
✅ if (status === STATUSES.PENDING)

// 3️⃣ FRONTEND: Fetch at page, read in components
❌ useEffect(() => fetch(...)) // In component
✅ useAppDataOrchestrator() // In page

// 4️⃣ No circular dependencies
✅ types → utils → core-client → ui → apps

// 5️⃣ Functions < 50 lines
✅ Small, focused functions

// 6️⃣ Validate all input
✅ CreateThingSchema.parse(data)

// 7️⃣ Structured logging
✅ console.log(JSON.stringify({...}))

// 8️⃣ Use repositories
✅ repository.getThing() // Not fetch()
```

## 📂 Directory Structure

```
docs/
├── README.md (you are here)
├── ARCHITECTURE-RULES.md (design patterns)
├── CODE-STANDARDS.md (quality guidelines)
├── development/
│   ├── GETTING-STARTED.md (setup & commands)
│   └── README.md (detailed dev guide)
├── database/
│   ├── README.md (schema overview)
│   └── ...
├── deployment/
│   ├── README.md (deployment guide)
│   └── ...
└── ci-cd/
    ├── README.md (CI/CD workflows)
    └── ...
```

## 🛠️ Common Tasks

### Add a new type

```typescript
// 3. Use everywhere
import { TThing } from "@packages/types";

// 1. @packages/types/src/entities/thing.ts
export interface TThing {
  id: string;
}

// 2. @packages/types/src/index.ts
export * from "./entities/thing";
```

### Add a utility function

```typescript
// 3. Import
import { formatThing } from "@packages/utils";

// 1. @packages/utils/src/helpers/thing.ts
export function formatThing(thing: TThing): string {}

// 2. @packages/utils/src/index.ts
export * from "./helpers/thing";
```

### Create backend endpoint

```typescript
// 1. DTO in @packages/types/src/dto
export const CreateThingSchema = z.object({});

// 2. Repository, Service, Controller in @apps/backend
@Controller("things")
export class ThingController {
  @Post()
  async create(@Body() body: unknown) {
    const data = CreateThingSchema.parse(body);
    return this.service.create(data);
  }
}
```

### Create frontend page

```typescript
// 1. Page in @apps/frontend/src/app
export default function ThingPage() {
  useAppDataOrchestrator({ includeThings: true });
  return <ThingContent />;
}

// 2. Redux slice in @packages/core-client/src/store/slices
const thingSlice = createSlice({
  name: 'things',
  initialState: { items: [] as TThing[] },
  reducers: { setThings: (state, action) => { state.items = action.payload; } }
});

// 3. Components read from Redux
function ThingList() {
  const things = useSelector(selectThings);
  return things.map(thing => <ThingCard key={thing.id} thing={thing} />);
}
```

## 🔧 Essential Commands

```bash
# Development
pnpm dev:frontend        # Start frontend on port 8000
pnpm dev:backend         # Start backend on port 8001

# Type checking
pnpm type-check

# Linting
pnpm lint
pnpm lint:fix

# Testing
pnpm test
pnpm test:watch

# Database
pnpm db:migrate          # Create migration
pnpm db:push             # Push schema to DB
pnpm db:studio           # Open Prisma Studio

# Building
pnpm build:packages
pnpm build:all
```

## 📚 Documentation Outline

| Document              | Purpose                        | Read if...                  |
| --------------------- | ------------------------------ | --------------------------- |
| ARCHITECTURE-RULES.md | Design patterns & architecture | Understanding app structure |
| CODE-STANDARDS.md     | Code quality standards         | Writing code                |
| GETTING-STARTED.md    | Project setup                  | First time setup            |
| development/README.md | Detailed dev guide             | Need detailed info          |
| database/README.md    | Database schema                | Working with database       |
| deployment/README.md  | Deployment process             | Deploying app               |
| ci-cd/README.md       | GitHub workflows               | Working with CI/CD          |

## ❓ Quick Answers

**Where should I put [thing]?**

- Types? → `@packages/types`
- Constants? → `@packages/utils/constants.ts`
- Shared utility? → `@packages/utils/helpers/`
- UI component? → `@packages/ui/components/` or `@apps/frontend/src/components/`
- Backend service? → `@apps/backend/src/modules/{feature}/`
- Redux state? → `@packages/core-client/src/store/slices/`

**How do I debug [problem]?**

- Redux not updating? → Check Redux DevTools, verify dispatch is called
- Component not re-rendering? → Check useSelector dependency, React.memo props
- API 400 error? → Check Zod validation, verify DTO schema
- Type errors? → Verify import from `@packages/types`

**Performance issues?**

- Frontend slow? → Use React DevTools Profiler, check for unnecessary re-renders
- Backend slow? → Check for N+1 queries, use Prisma `select` for fields
- Tests slow? → Run in parallel, mock external services

## 🆘 Getting Help

1. Check relevant documentation file
2. Search codebase for similar patterns
3. Check git history for context
4. Ask in team channel with specific error message

## 📖 Learning Path

**Day 1:**

- Read: GETTING-STARTED.md
- Setup: `pnpm install && pnpm dev`
- Explore: Project structure

**Day 2:**

- Read: ARCHITECTURE-RULES.md
- Study: Existing feature implementation
- Try: Add a small utility

**Day 3:**

- Read: CODE-STANDARDS.md
- Implement: First feature
- Code review: Check guidelines before PR

---

**Remember:** If you're unsure, look for existing patterns in the codebase and follow them!

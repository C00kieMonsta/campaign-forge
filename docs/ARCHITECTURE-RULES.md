# Architecture & Design Patterns

The 8 golden rules that keep the codebase clean and consistent.

## 1️⃣ Types → @packages/types

**Rule:** All types defined in `@packages/types`, never in apps.

```typescript
// ❌ WRONG
// @apps/backend/src/types/extraction.ts
export interface ExtractionJob { }

// ✅ RIGHT
// @packages/types/src/entities/extraction.ts
export interface TExtractionJob { }

// Then import everywhere
import { TExtractionJob } from "@packages/types";
```

**Why:** Single source of truth. Easy refactoring. Zero duplication.

---

## 2️⃣ Constants → @packages/utils

**Rule:** Never hardcode strings/numbers. Define in constants.

```typescript
// ❌ WRONG
if (job.status === "pending") { }
const ERROR = "error occurred";

// ✅ RIGHT
import { EXTRACTION_JOB_STATUSES } from "@packages/utils";
if (job.status === EXTRACTION_JOB_STATUSES.PENDING) { }

// Define in @packages/utils/constants.ts
export const EXTRACTION_JOB_STATUSES = {
  PENDING: "pending",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed"
} as const;
```

**Why:** Easy to change. Prevents typos. Type-safe.

---

## 3️⃣ Frontend: Fetch at Page, Read in Components

**Rule:** Data fetching happens at app/page level into Redux. Components read only.

```typescript
// ❌ WRONG - component fetching
function ExtractionList() {
  const [jobs, setJobs] = useState([]);
  useEffect(() => {
    fetch("/api/jobs").then(r => r.json()).then(setJobs);
  }, []);
  return <div>{jobs.map(...)}</div>;
}

// ✅ RIGHT - fetch at page level
// apps/frontend/src/app/dashboard/page.tsx
export default function DashboardPage() {
  useAppDataOrchestrator({ includeJobs: true });
  return <DashboardContent />;
}

// Read in components
function ExtractionList() {
  const jobs = useExtractionJobs(); // From Redux, read-only
  return <div>{jobs.map(...)}</div>;
}
```

**Flow:** App fetches → Redux dispatch → Components read

**Why:** Single source of truth. Consistent data. No out-of-sync states.

---

## 4️⃣ No Circular Dependencies

**Rule:** Dependency flow is one direction only.

```
CORRECT:
@packages/types (level 0)
    ↓
@packages/utils (depends on types)
    ↓
@packages/core-client (depends on types + utils)
@packages/ui (depends on types + utils)
    ↓
@apps/frontend, @apps/backend (depend on all)

WRONG:
types → utils
utils → types (circular!)
```

**Why:** Prevents import errors. Enables tree-shaking. Clean architecture.

---

## 5️⃣ Functions < 50 Lines

**Rule:** Each function does one thing, <50 lines.

```typescript
// ❌ WRONG - too many concerns
function processJobsAndNotifyUsers(jobs: TExtractionJob[]) {
  jobs.forEach(job => {
    if (job.status === "completed" && !job.notified) {
      sendEmail(job.userId, `Job ${job.id} completed`);
      updateJobNotificationStatus(job.id);
      logJobCompletion(job.id);
      incrementUserCompletedJobCount(job.userId);
      // ... more logic
    }
  });
}

// ✅ RIGHT - focused functions
function isCompletedAndNotNotified(job: TExtractionJob): boolean {
  return job.status === "completed" && !job.notified;
}

async function notifyJobCompletion(job: TExtractionJob) {
  await sendEmail(job.userId, `Job ${job.id} completed`);
}

async function updateJobNotifications(jobs: TExtractionJob[]) {
  for (const job of jobs.filter(isCompletedAndNotNotified)) {
    await notifyJobCompletion(job);
    await updateJobNotificationStatus(job.id);
  }
}
```

**Why:** Easier to test. Easier to reuse. Easier to understand.

---

## 6️⃣ Validate All Input (Zod)

**Rule:** All user input validated with Zod schemas from `@packages/types`.

```typescript
// ❌ WRONG
async function createJob(data: any) { }

// ✅ RIGHT
// @packages/types/src/dto/extraction.ts
export const CreateJobSchema = z.object({
  projectId: z.string().uuid(),
  schemaId: z.string().uuid()
});
export type TCreateJobRequest = z.infer<typeof CreateJobSchema>;

// Backend
@Post("jobs")
async create(@Body() body: unknown) {
  const data = CreateJobSchema.parse(body); // Throws if invalid
  return this.service.create(data);
}

// Frontend
useForm<TCreateJobRequest>({
  resolver: zodResolver(CreateJobSchema)
});
```

**Why:** Runtime validation. Type safety. Shared between frontend/backend.

---

## 7️⃣ Structured Logging (JSON)

**Rule:** All logs JSON stringified with context.

```typescript
// ❌ WRONG
console.log("Job processing failed");
console.log("Error:", error);

// ✅ RIGHT
console.log(JSON.stringify({
  level: "error",
  action: "jobProcessingFailed",
  jobId: job.id,
  error: error instanceof Error ? error.message : "Unknown",
  timestamp: new Date().toISOString()
}));
```

**Why:** Easier to parse. Easier to aggregate. Machine-readable.

---

## 8️⃣ Use Repositories (Not Direct API Calls)

**Rule:** All data access through repositories that handle API/DB + Redux.

```typescript
// ❌ WRONG
const [jobs, setJobs] = useState([]);
fetch("/api/jobs").then(r => r.json()).then(setJobs);

// ✅ RIGHT - Backend repository
@Injectable()
export class JobRepository {
  async getAll(): Promise<TExtractionJob[]> {
    return this.prisma.extractionJob.findMany();
  }
}

// ✅ RIGHT - Frontend repository
export class JobRepository {
  constructor(private dispatch: AppDispatch) {}
  
  async getAll(): Promise<TExtractionJob[]> {
    const response = await fetch("/api/jobs");
    const jobs = await response.json();
    this.dispatch(setJobs(jobs)); // Auto Redux
    return jobs;
  }
}

// Usage
const repository = useJobRepository();
await repository.getAll(); // Handles API + Redux
```

**Why:** Centralized logic. Easy to mock. Easy to cache.

---

## Package Structure

### @packages/types
- Entity types (TUser, TProject, TExtractionJob)
- DTOs (CreateUserSchema)
- Interfaces (IUserRepository)
- Constants

### @packages/utils
- Helper functions (formatDate, parseJobType)
- Constants exported (re-exported in types)
- Pure utilities (no React, no DB)

### @packages/core-client
- Redux slices
- Selectors
- Hooks (useCollection, useAppData)
- Repository classes

### @packages/ui
- React components (Radix-based)
- Form components
- Layout components
- Styling (Tailwind + CSS modules)

### @apps/backend (NestJS)
- Controllers (validate input, call services)
- Services (business logic)
- Repositories (database access)
- Guards (authentication, authorization)

### @apps/frontend (Next.js)
- Pages (fetch data via orchestrator)
- Components (read from Redux)
- Hooks (useCurrentUser, useFilteredJobs)
- Forms (react-hook-form + Zod)

---

## Data Flow Diagram

### Frontend (Store-First)

```
User Interaction
    ↓
Page Component
    ↓
useAppDataOrchestrator() OR useEffect(() => repository.fetch())
    ↓
Repository.getJobs() → fetch("/api/jobs")
    ↓
Dispatch setJobs(jobs) action
    ↓
Redux Store Updated
    ↓
Child Components
    ↓
useExtractionJobs() hook reads from store
    ↓
Component Renders with data
```

### Backend (Repository → Service → Controller)

```
HTTP Request (POST /jobs)
    ↓
Controller validates with Zod
    ↓
Service orchestrates business logic
    ↓
Repository queries database
    ↓
Return results
    ↓
HTTP Response (200 + data)
```

---

## Code Organization

```
@packages/
├── types/src/
│   ├── entities/          # Entity types
│   ├── dto/               # Request/response DTOs
│   ├── repositories/      # Interface contracts
│   ├── services/          # Service interfaces
│   ├── constants.ts       # All constants
│   └── index.ts

├── utils/src/
│   ├── helpers/           # Utility functions
│   ├── formatters/        # Data formatters
│   ├── constants.ts       # Re-export from types
│   └── index.ts

├── core-client/src/
│   ├── store/
│   │   ├── slices/        # Redux slices
│   │   └── selectors/     # Selectors
│   ├── hooks/             # Custom hooks
│   ├── repositories/      # API + Redux
│   └── index.ts

└── ui/src/
    ├── components/        # React components
    ├── hooks/             # UI hooks
    └── index.ts
```

---

## Common Anti-Patterns (Don't Do This)

| ❌ | ✅ | Why |
|---|---|---|
| Type in app | Type in @packages/types | Single source |
| Hardcode "pending" | Use STATUSES.PENDING | Easy refactor |
| Fetch in component | Fetch at page level | Store-first |
| Circular imports | One-direction flow | No errors |
| 200-line function | <50 line functions | Maintainability |
| any types | Proper types | Type safety |
| Direct fetch() | Use repositories | Centralized |
| No validation | Zod validation | Security |
| unstructured logs | JSON logs | Parsing |

---

## Performance Tips

**Frontend:**
- Use `useMemo` for expensive calculations
- Use `React.memo` for memoization
- Virtualize lists with 100+ items
- Check React DevTools Profiler

**Backend:**
- Use Prisma `select` for specific fields (avoid N+1)
- Wrap related updates in `$transaction`
- Add indexes for frequently queried fields
- Check slow query logs

---

## Testing Strategy

| Type | When | Duration |
|------|------|----------|
| Unit | Single function | <100ms |
| Integration | Function + dependency | <1s |
| E2E | Full request flow | 1-10s |

Test business logic, not implementation details.

---

**Remember:** These rules exist for consistency and maintainability. When in doubt, find an existing pattern and follow it!


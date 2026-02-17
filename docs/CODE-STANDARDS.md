# Code Quality Standards

Guidelines for writing clean, maintainable code.

## DRY - Don't Repeat Yourself

**Extract logic after first duplication.**

```typescript
// ❌ Before
function ProjectCard({ project }) {
  return <div className="border rounded p-4"><h3>{project.name}</h3></div>;
}

function SchemaCard({ schema }) {
  return <div className="border rounded p-4"><h3>{schema.name}</h3></div>;
}

// ✅ After
function Card({ title }: { title: string }) {
  return <div className="border rounded p-4"><h3>{title}</h3></div>;
}

function ProjectCard({ project }) {
  return <Card title={project.name} />;
}
```

---

## Single Responsibility

**One file/function = one clear job.**

```typescript
// ❌ WRONG - mixed concerns
function ExtractionDashboard() {
  const [jobs, setJobs] = useState([]);
  useEffect(() => { fetch("/api/jobs").then(setJobs); }, []);
  const filtered = jobs.filter(j => j.name.includes(filter));
  const sorted = [...filtered].sort(...);
  return <div>{sorted.map(...)}</div>;
}

// ✅ RIGHT - separated
function useFilteredJobs(jobs: TExtractionJob[], filter: string) {
  return useMemo(() => jobs.filter(j => j.name.includes(filter)), [jobs, filter]);
}

function ExtractionDashboard() {
  const jobs = useExtractionJobs();
  const filtered = useFilteredJobs(jobs, filter);
  return <div>{filtered.map(...)}</div>;
}
```

---

## Guard Clauses

**Use early returns to reduce nesting.**

```typescript
// ❌ WRONG - nested
function processJob(job: TExtractionJob | null, userId: string) {
  if (job) {
    if (job.status === "completed") {
      if (job.userId === userId) {
        return "Success";
      } else {
        return "Permission denied";
      }
    }
  } else {
    return "Job not found";
  }
}

// ✅ RIGHT - guard clauses
function processJob(job: TExtractionJob | null, userId: string) {
  if (!job) return "Job not found";
  if (job.status !== "completed") return "Job not completed";
  if (job.userId !== userId) return "Permission denied";
  return "Success";
}
```

---

## Comments

**Explain WHY, not WHAT.**

```typescript
// ❌ WRONG - obvious
function formatDate(date: Date): string {
  // Get year, month, day
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  // Return formatted string
  return `${year}-${month}-${day}`;
}

// ✅ RIGHT - explain intent
function formatDate(date: Date): string {
  // ISO 8601 format required for API compatibility
  return date.toISOString().split('T')[0];
}

// ✅ RIGHT - complex logic
const SCHEMA_CACHE_TTL = 3600000; // 1 hour
// Schemas change infrequently, so aggressive caching reduces
// compilation overhead during high-volume extractions
function getCachedSchema(id: string): TSchema | null {
  const cached = cache.get(id);
  if (!cached || isExpired(cached.ts)) return null;
  return cached.schema;
}
```

---

## Testing

### Unit Tests - Single Function

```typescript
describe('formatJobStatus', () => {
  it('should format pending status', () => {
    expect(formatJobStatus('pending')).toBe('Waiting');
  });

  it('should handle unknown status', () => {
    expect(formatJobStatus('unknown' as any)).toBe('Unknown');
  });
});
```

### Integration Tests - Function + Dependencies

```typescript
describe('ExtractionJobService', () => {
  let service: ExtractionJobService;
  let repository: ExtractionJobRepository;

  beforeEach(() => {
    const mockRepository = { create: jest.fn() };
    service = new ExtractionJobService(mockRepository as any);
    repository = mockRepository as any;
  });

  it('should create job', async () => {
    jest.spyOn(repository, 'create').mockResolvedValue({ id: '1' });
    const result = await service.createJob({ name: 'Test' });
    expect(result.id).toBe('1');
  });
});
```

### E2E Tests - Full Flow

```typescript
describe('POST /jobs (e2e)', () => {
  it('should create job', async () => {
    const response = await request(app.getHttpServer())
      .post('/jobs')
      .send({ name: 'Test' })
      .expect(201);

    expect(response.body.id).toBeDefined();
  });
});
```

---

## Type Safety

**Never use `any`. Use proper types or generics.**

```typescript
// ❌ WRONG
function process(data: any): any {
  return data.map(x => x.value);
}

// ✅ RIGHT - generic
function process<T extends { value: unknown }>(data: T[]): unknown[] {
  return data.map(x => x.value);
}

// ✅ RIGHT - explicit types
function processJobs(jobs: TExtractionJob[]): string[] {
  return jobs.map(j => j.id);
}
```

---

## Naming Conventions

**Clear, descriptive names that reveal intent.**

```typescript
// ❌ WRONG
function f(d, s) { }
const x = getData();
let temp = [];

// ✅ RIGHT
function filterJobsByStatus(data: TJob[], status: JobStatus) { }
const extractionJobs = fetchExtractionJobs();
const completedJobs = [];
```

---

## Error Handling

**Always handle errors. Log with context.**

```typescript
// ❌ WRONG
async function fetchJobs() {
  return fetch("/api/jobs").then(r => r.json());
}

// ✅ RIGHT
async function fetchJobs(): Promise<TJob[]> {
  try {
    const response = await fetch("/api/jobs");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      action: "fetchJobsFailed",
      error: error instanceof Error ? error.message : "Unknown"
    }));
    throw error;
  }
}
```

---

## Code Review Checklist

Before pushing code:

- [ ] **Architecture** - Follows 8 golden rules?
- [ ] **Types** - From @packages/types?
- [ ] **Functions** - <50 lines, single responsibility?
- [ ] **DRY** - No duplicated logic?
- [ ] **Comments** - Explain why, not what?
- [ ] **Testing** - Business logic tested?
- [ ] **Logging** - Structured JSON logs?
- [ ] **Errors** - Proper error handling?
- [ ] **Performance** - No N+1 queries, unnecessary re-renders?
- [ ] **Security** - Input validated, no hardcoded secrets?

---

## Common Mistakes

| ❌ | ✅ | Impact |
|---|---|---|
| 200-line function | <50 line functions | Hard to test/reuse |
| Mixed concerns | Single responsibility | Harder to understand |
| Deep nesting | Guard clauses | Harder to read |
| `any` types | Proper types | Type unsafe |
| No error handling | Try/catch + logging | Silent failures |
| No validation | Zod validation | Security |
| Hardcoded strings | Constants | Hard to refactor |
| No tests | Unit + integration | Regressions |
| Obvious comments | Intent comments | Noise |

---

## Performance Optimization

### Frontend

```typescript
// ❌ WRONG - recalculates every render
function JobList({ jobs, sortBy }) {
  const sorted = [...jobs].sort(...);
  return <div>{sorted.map(...)}</div>;
}

// ✅ RIGHT - memoized
function JobList({ jobs, sortBy }) {
  const sorted = useMemo(() => [...jobs].sort(...), [jobs, sortBy]);
  return <div>{sorted.map(...)}</div>;
}

// ✅ RIGHT - memoized component
export const JobCard = React.memo(function JobCard({ job }) {
  return <div>{job.name}</div>;
});
```

### Backend

```typescript
// ❌ WRONG - fetches all fields
const user = await prisma.user.findUnique({ where: { id } });

// ✅ RIGHT - fetch only needed fields
const user = await prisma.user.findUnique({
  where: { id },
  select: { id: true, name: true, email: true }
});
```

---

## Debugging Tips

**Component not rendering?**
- Check if Redux store has data
- Verify useSelector dependency
- Check if React.memo receives same props

**API returning error?**
- Check Zod validation schema
- Log request/response with JSON.stringify
- Verify DTO matches API contract

**Slow performance?**
- Use React DevTools Profiler (frontend)
- Check for N+1 queries (backend)
- Use Prisma DevTools or logs

**Type errors?**
- Verify type imported from @packages/types
- Check import path is correct
- Run `tsc --noEmit` to see all errors

---

## Useful Commands

```bash
pnpm type-check              # Check types
pnpm lint                    # Lint code
pnpm lint:fix                # Fix linting issues
pnpm test                    # Run tests
pnpm test:watch              # Tests in watch mode
pnpm test:coverage           # Check coverage
```

---

**Key Principle:** Write code that your future self (or teammates) will understand and appreciate. Keep it clean, keep it simple, keep it documented.


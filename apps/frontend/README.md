# Frontend Application

This is a Vite-based React application with TypeScript, configured for the NextJS to Vite migration.

## Configuration

### Dependencies
- **React Router**: Client-side routing
- **TanStack Query**: Data fetching and caching
- **Supabase**: Authentication and database
- **Tailwind CSS**: Styling
- **TypeScript**: Type safety
- **Workspace Utils**: Shared types from `@packages/utils`

### Path Aliases
- `@/*` → `./src/*`
- `@packages/*` → `../../packages/*`

### Environment Variables
Required environment variables (see `.env.example`):
- `VITE_API_URL` - Backend API URL
- `VITE_SUPABASE_URL` - Supabase project URL  
- `VITE_SUPABASE_ANON_KEY` - Supabase anonymous key

### Scripts
- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run type-check` - TypeScript type checking
- `npm run lint` - ESLint
- `npm run preview` - Preview production build

### Vite Configuration
- Proxy `/api` requests to `http://localhost:3000`
- Path aliases configured
- Environment variable validation
- Optimized build settings
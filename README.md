# Campaign Forge

Want i want to do next:

- make it less lawyer AI and more general for personal projects
- translate the same code for my own command center
- import the immo scraper to my own project

## Backend maintenance

Use the Node.js version in `.nvmrc` (24.22.1 or a newer patched Node.js 24 release).
Run `pnpm install --frozen-lockfile`, `pnpm build:types`, and `pnpm build:backend` before starting the API.
Run `pnpm audit:backend` to check backend production dependencies. CI and backend deployment fail on moderate or higher advisories and on audit service errors. The separate workspace report also includes frontend and development dependencies.

The API and `pnpm --filter @apps/backend migrate` verify PostgreSQL certificates and hostnames.
The bundled [RDS eu-north-1 CA certificates](https://truststore.pki.rds.amazonaws.com/eu-north-1/eu-north-1-bundle.pem) are copied into the backend build.
Set `DATABASE_SSL_CA_FILE` to an absolute CA file path for another database provider or region.
For local PostgreSQL without TLS, set `DATABASE_SSL=false`. This setting is rejected for remote hosts and in production.
Connection string TLS options cannot override certificate verification.

After building the backend, run `pnpm test:backend-http` for HTTP startup and authentication checks.
The EC2 deploy updates unsupported Node versions and checks the minimum security version before migrations and restart.

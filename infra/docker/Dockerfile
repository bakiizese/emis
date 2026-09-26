# syntax=docker/dockerfile:1.7
#
# One file, three images: build with `--target api`, `--target web` or `--target portal`.
# The API image also runs the worker (`node dist/worker.js`) and the one-off database commands.
#
#   docker build -f infra/docker/Dockerfile --target api -t emis-api .

ARG NODE_IMAGE=node:24-alpine

# --- build: install, compile everything once ---------------------------------------------------
FROM ${NODE_IMAGE} AS build
ENV HUSKY=0 CI=1 NEXT_TELEMETRY_DISABLED=1 TURBO_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
RUN pnpm build
# The API with only what it needs to run: compiled code and production dependencies.
RUN pnpm --filter @emis/api --prod deploy --legacy /out/api

# --- runtime: the base every image runs on -----------------------------------------------------------
# Node only. The package managers that ship in the base image aren't needed to run anything, and
# they carry their own dependencies (and their own advisories), so they are left out.
FROM ${NODE_IMAGE} AS runtime
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
    /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg

# --- api (and worker) ---------------------------------------------------------------------------
FROM runtime AS api
ENV NODE_ENV=production API_HOST=0.0.0.0 API_PORT=4000
WORKDIR /app
COPY --from=build --chown=node:node /out/api ./
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/v1/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]

# --- web (public website) -------------------------------------------------------------------------
FROM runtime AS web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/robots.txt').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]

# --- portal (staff) -------------------------------------------------------------------------------
FROM runtime AS portal
ENV NODE_ENV=production PORT=3001 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/portal/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/portal/.next/static ./apps/portal/.next/static
USER node
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3001/login').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/portal/server.js"]

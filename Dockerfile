FROM node:26-trixie-slim AS build
WORKDIR /opt/app/mcpicloudcalendar
COPY package.json package-lock.json tsconfig.json tsup.config.ts ./
COPY src ./src
RUN npm ci \
  && npm run build \
  && npm prune --omit=dev

FROM node:26-trixie-slim AS runtime
ENV NODE_ENV=production
WORKDIR /opt/app/mcpicloudcalendar
COPY --from=build --chown=node:node /opt/app/mcpicloudcalendar/package.json ./
COPY --from=build --chown=node:node /opt/app/mcpicloudcalendar/dist ./dist
COPY --from=build --chown=node:node /opt/app/mcpicloudcalendar/node_modules ./node_modules
RUN mkdir -p /var/lib/mcp && chown node:node /var/lib/mcp
ENV MCP_HOST=0.0.0.0
ENV MCP_PORT=8080
EXPOSE 8080
ENTRYPOINT ["sh", "-c", "mkdir -p /var/lib/mcp && chown -R node:node /var/lib/mcp && exec setpriv --reuid=node --regid=node --init-groups -- \"$@\"", "--"]
CMD ["node", "dist/http.js"]

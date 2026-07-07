FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
RUN corepack enable && pnpm install
COPY . .
RUN pnpm prisma:generate && pnpm build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
EXPOSE 4000
CMD ["node", "dist/src/server.js"]

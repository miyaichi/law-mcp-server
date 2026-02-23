FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
# Install dependencies without running lifecycle scripts yet (prepare triggers build)
RUN npm ci --ignore-scripts

# Copy source and build
COPY . .
RUN npm run build

FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /app/dist ./dist
COPY README.md LICENSE ./
ENV NODE_ENV=production
ENV TRANSPORT=sse
ENV PORT=8080
CMD ["node", "dist/src/index.js"]

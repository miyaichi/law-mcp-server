FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY README.md LICENSE ./
ENV NODE_ENV=production
ENV TRANSPORT=sse
ENV PORT=8080
CMD ["node", "dist/src/index.js"]

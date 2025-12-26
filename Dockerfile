
# Stage 1: Build the frontend and backend
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Stage 2: Production environment
FROM node:20-alpine AS production
WORKDIR /app

# Copy production dependencies' manifests
COPY package*.json ./

# Install only production dependencies
RUN npm install --omit=dev

# Copy built artifacts from the builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-server ./dist-server

# Expose the port the server will run on
EXPOSE 8080

# Start the server
CMD ["npm", "start"]

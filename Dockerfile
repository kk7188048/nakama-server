# FROM node:alpine AS node-builder

# WORKDIR /backend

# COPY package*.json .
# RUN npm install

# COPY tsconfig.json .
# COPY src/*.ts src/
# RUN npx tsc

# FROM heroiclabs/nakama:3.22.0

# COPY --from=node-builder /backend/build/*.js /nakama/data/modules/build/
# COPY local.yml /nakama/data/

# Stage 1: Build TypeScript
FROM node:alpine AS node-builder

WORKDIR /backend

COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

# Stage 2: Nakama Runtime
FROM heroiclabs/nakama:3.22.0

# Copy built files
COPY --from=node-builder /backend/build/*.js /nakama/data/modules/build/
COPY local.yml /nakama/data/

# Expose ports
EXPOSE 7349 7350 7351

# ✅ FIX: Pass database URL from local.yml
ENTRYPOINT ["/bin/sh", "-c"]
CMD ["/nakama/nakama migrate up --database.address 'postgresql://neondb_owner:npg_LOq5n6abkDCI@ep-morning-fog-adfvh5d7-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require' && exec /nakama/nakama --config /nakama/data/local.yml --database.address 'postgresql://neondb_owner:npg_LOq5n6abkDCI@ep-morning-fog-adfvh5d7-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require'"]

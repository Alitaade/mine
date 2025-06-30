# Use Node.js 20 with full Debian (not slim) to have all necessary tools
FROM node:20-bookworm

# Set working directory
WORKDIR /app

# Install system dependencies including Git and build tools
RUN apt-get update && apt-get install -y \
    git \
    python3 \
    make \
    g++ \
    libvips-dev \
    ffmpeg \
    wget \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Set npm configuration to handle legacy peer deps
RUN npm config set legacy-peer-deps true

# Install dependencies with force flag to handle conflicts
RUN npm install --legacy-peer-deps --force

# Copy the rest of the application code
COPY . .

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Expose the port
EXPOSE 3000

# Create a non-root user
RUN useradd -m -u 1001 appuser && chown -R appuser:appuser /app
USER appuser

# Start the application
CMD ["npm", "start"]

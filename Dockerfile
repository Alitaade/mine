# Use an official minimal Debian image
FROM debian:latest  

# Install curl and other required dependencies
RUN apt-get update && \
    apt-get install -y curl git python3 python3-pip ffmpeg imagemagick webp && \
    apt-get upgrade -y && \
    rm -rf /var/lib/apt/lists/*

# Install Node.js 20 (from NodeSource)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Verify Node.js, npm, and Git installation
RUN node -v && npm -v && git --version

# Set Python 3 as the default
RUN ln -sf /usr/bin/python3 /usr/bin/python

# Set a proper working directory
WORKDIR /app

# Copy package.json and package-lock.json first to optimize caching
COPY package.json ./

# Set environment variables to bypass checks and prevent API rate limits
ENV YOUTUBE_DL_SKIP_PYTHON_CHECK=1
ENV YOUTUBE_DL_EXEC_NO_UPDATE=1  
# Prevents auto-updating youtube-dl-exec

# Install Node.js dependencies (with --legacy-peer-deps to avoid conflicts)
RUN npm install --legacy-peer-deps

# Copy all remaining files (Fixes the COPY issue)
COPY . .

# Expose port 3000
EXPOSE 3000

# Start the application
CMD ["npm", "start"]

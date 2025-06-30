#!/bin/bash

# Build script for WhatsApp Bot deployment
set -e

echo "🔨 Starting build process..."

# Update system packages
echo "📦 Updating system packages..."
apt-get update && apt-get install -y \
    git \
    python3 \
    make \
    g++ \
    libvips-dev \
    ffmpeg \
    wget \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set npm configuration
echo "⚙️ Configuring npm..."
npm config set legacy-peer-deps true

# Install dependencies
echo "📋 Installing dependencies..."
npm install --legacy-peer-deps --force

echo "✅ Build completed successfully!"

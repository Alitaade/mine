#!/bin/bash

# Vercel build script for WhatsApp Bot
set -e

echo "🔨 Starting Vercel build process..."

# Set npm configuration for dependency conflicts
echo "⚙️ Configuring npm for Vercel..."
npm config set legacy-peer-deps true

# Install dependencies with legacy peer deps
echo "📋 Installing dependencies..."
npm install --legacy-peer-deps

echo "✅ Vercel build completed successfully!"

#!/bin/bash

# Redis startup script for claude_monet_v2 project
# This script checks for Redis installation and starts it locally

set -e

echo "🔍 Checking Redis installation..."

# Check if Redis is installed
if ! command -v redis-server &> /dev/null; then
    echo "❌ Redis is not installed."
    echo ""
    echo "Install Redis using one of these methods:"
    echo "  macOS (Homebrew): brew install redis"
    echo "  Ubuntu/Debian:    sudo apt-get install redis-server"
    echo "  CentOS/RHEL:      sudo yum install redis"
    echo "  Docker:           docker run -d -p 6379:6379 redis:latest"
    exit 1
fi

echo "✅ Redis found at: $(which redis-server)"

# Check if Redis is already running
if redis-cli ping &> /dev/null; then
    echo "✅ Redis is already running"
    echo "📊 Redis info:"
    redis-cli info server | grep redis_version
    redis-cli info memory | grep used_memory_human
    exit 0
fi

echo "🚀 Starting Redis server..."

# Try different startup methods based on installation
if command -v brew &> /dev/null && brew services list | grep redis &> /dev/null; then
    echo "📦 Starting Redis using Homebrew services..."
    brew services start redis

    # Wait for Redis to start
    echo "⏳ Waiting for Redis to start..."
    for i in {1..10}; do
        if redis-cli ping &> /dev/null; then
            echo "✅ Redis is now running!"
            break
        fi
        sleep 1
    done

    if ! redis-cli ping &> /dev/null; then
        echo "❌ Failed to start Redis with Homebrew services"
        exit 1
    fi
else
    echo "🔧 Starting Redis server directly..."
    # Start Redis in background
    nohup redis-server > redis.log 2>&1 &
    REDIS_PID=$!

    echo "📝 Redis PID: $REDIS_PID"
    echo "📄 Redis logs: $(pwd)/redis.log"

    # Wait for Redis to start
    echo "⏳ Waiting for Redis to start..."
    for i in {1..10}; do
        if redis-cli ping &> /dev/null; then
            echo "✅ Redis is now running!"
            break
        fi
        sleep 1
    done

    if ! redis-cli ping &> /dev/null; then
        echo "❌ Failed to start Redis"
        exit 1
    fi
fi

echo ""
echo "📊 Redis Status:"
redis-cli info server | grep redis_version
echo "🌐 Redis URL: redis://localhost:6379"
echo ""
echo "🛠️  Useful commands:"
echo "  Check status:  redis-cli ping"
echo "  Stop Redis:    brew services stop redis  (or kill the process)"
echo "  View logs:     tail -f redis.log  (if started directly)"
echo "  Redis CLI:     redis-cli"
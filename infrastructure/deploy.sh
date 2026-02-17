#!/bin/bash

# Material Extractor Deployment Script
# This script handles deployment using Prisma (not legacy Supabase migrations)

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
STAGE="${STAGE:-production}"
SKIP_TESTS="${SKIP_TESTS:-false}"
SKIP_BUILD="${SKIP_BUILD:-false}"

echo -e "${BLUE}🚀 Material Extractor Deployment Script${NC}"
echo -e "${BLUE}=======================================${NC}"
echo -e "Stage: ${YELLOW}$STAGE${NC}"
echo -e "Skip Tests: ${YELLOW}$SKIP_TESTS${NC}"
echo -e "Skip Build: ${YELLOW}$SKIP_BUILD${NC}"
echo ""

# Function to handle errors
handle_error() {
    echo -e "${RED}❌ Error on line $1${NC}"
    exit 1
}

trap 'handle_error $LINENO' ERR

# Function to run command with status
run_step() {
    local step_name="$1"
    local command="$2"
    echo -e "${BLUE}📋 $step_name...${NC}"
    if eval "$command"; then
        echo -e "${GREEN}✅ $step_name completed${NC}"
    else
        echo -e "${RED}❌ $step_name failed${NC}"
        exit 1
    fi
    echo ""
}

# Check prerequisites
echo -e "${BLUE}🔍 Checking prerequisites...${NC}"
if ! command -v pnpm &> /dev/null; then
    echo -e "${RED}❌ pnpm is required but not installed${NC}"
    exit 1
fi

if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js is required but not installed${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Prerequisites check passed${NC}"
echo ""

# Install dependencies
run_step "Installing dependencies" "pnpm install --frozen-lockfile"

# Type checking
if [ "$SKIP_TESTS" != "true" ]; then
    run_step "Type checking all packages" "pnpm type-check"
    run_step "Running linting" "pnpm lint"
    run_step "Running tests with coverage" "pnpm test:coverage"
fi

# Build packages
if [ "$SKIP_BUILD" != "true" ]; then
    run_step "Building utils package" "pnpm build:shared"
    run_step "Building all packages" "pnpm build:all"
fi

# Database deployment using Prisma (not legacy Supabase migrations)
echo -e "${BLUE}🗄️ Deploying database schema with Prisma...${NC}"
cd apps/backend

# Check if DATABASE_URL is set
if [ -z "${DATABASE_URL:-}" ]; then
    echo -e "${RED}❌ DATABASE_URL environment variable is not set${NC}"
    echo -e "${YELLOW}💡 Please set DATABASE_URL before running deployment${NC}"
    exit 1
fi

# Generate Prisma client
run_step "Generating Prisma client" "pnpm db:generate"

# Deploy database schema using Prisma migrations
run_step "Deploying database schema with migrations" "pnpm db:deploy"

# Optionally seed the database (only in non-production)
if [ "$STAGE" != "production" ]; then
    run_step "Seeding database" "pnpm db:seed"
fi

cd ../..

# Deploy infrastructure using CDK
echo -e "${BLUE}☁️ Deploying infrastructure...${NC}"
cd infrastructure

# Install CDK dependencies
run_step "Installing infrastructure dependencies" "npm install"

# Deploy CDK stacks
if [ "$STAGE" == "production" ]; then
    run_step "Deploying production infrastructure" "npx cdk deploy --all --require-approval never"
else
    run_step "Deploying development infrastructure" "npx cdk deploy --all --require-approval never --context stage=dev"
fi

cd ..

echo ""
echo -e "${GREEN}🎉 Deployment completed successfully!${NC}"
echo -e "${GREEN}===============================${NC}"
echo -e "Stage: ${YELLOW}$STAGE${NC}"
echo -e "Database: ${GREEN}✅ Schema deployed with Prisma${NC}"
echo -e "Infrastructure: ${GREEN}✅ CDK stacks deployed${NC}"
echo ""
echo -e "${BLUE}📝 Next steps:${NC}"
echo -e "1. Verify application health checks"
echo -e "2. Run smoke tests if available"
echo -e "3. Monitor application logs"
echo ""

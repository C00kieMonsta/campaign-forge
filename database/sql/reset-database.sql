-- Reset Database Script for Material Extractor
-- This script completely resets the database to a clean state
-- WARNING: This will DELETE ALL DATA in the database

-- ============================================================================
-- SAFETY CHECK: Uncomment the line below to enable the reset
-- ============================================================================
-- SET client_min_messages = WARNING;

-- ============================================================================
-- DROP ALL TABLES (in reverse dependency order)
-- ============================================================================
DROP TABLE IF EXISTS extraction_jobs CASCADE;
DROP TABLE IF EXISTS data_layers CASCADE;
DROP TABLE IF EXISTS projects CASCADE;
DROP TABLE IF EXISTS clients CASCADE;
DROP TABLE IF EXISTS invitations CASCADE;
DROP TABLE IF EXISTS organization_members CASCADE;
DROP TABLE IF EXISTS roles CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS organizations CASCADE;

-- ============================================================================
-- DROP EXTENSIONS
-- ============================================================================
DROP EXTENSION IF EXISTS "uuid-ossp";

-- ============================================================================
-- CLEAN UP PRISMA MIGRATION TRACKING
-- ============================================================================
DROP TABLE IF EXISTS _prisma_migrations CASCADE;

-- ============================================================================
-- CONFIRMATION MESSAGE
-- ============================================================================
DO $$ 
BEGIN 
    RAISE NOTICE '✅ Database has been completely reset!';
    RAISE NOTICE '📋 Next steps:';
    RAISE NOTICE '   1. Run: prisma migrate deploy';
    RAISE NOTICE '   2. Run: prisma db seed';
    RAISE NOTICE '   3. Verify with: prisma studio';
END $$;

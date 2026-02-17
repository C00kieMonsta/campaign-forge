-- Post-migration script to enable Supabase Realtime for all tables
-- This script runs after Prisma migrations to ensure all tables are configured for realtime
-- 
-- Purpose: Enable real-time updates across the entire application for instant UI synchronization
-- Usage: This script should be executed after running `prisma migrate deploy` in production

-- Function to enable realtime for all public tables
DO $$
DECLARE
    table_record RECORD;
    tables_added INTEGER := 0;
    tables_skipped INTEGER := 0;
BEGIN
    -- Log the start of realtime configuration
    RAISE NOTICE 'Starting Supabase Realtime configuration for all tables...';
    
    -- Loop through all public tables
    FOR table_record IN 
        SELECT tablename 
        FROM pg_tables 
        WHERE schemaname = 'public' 
        ORDER BY tablename
    LOOP
        -- Check if table is already in the realtime publication
        IF NOT EXISTS (
            SELECT 1 
            FROM pg_publication_tables 
            WHERE pubname = 'supabase_realtime' 
            AND tablename = table_record.tablename
        ) THEN
            -- Add table to realtime publication
            EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', table_record.tablename);
            RAISE NOTICE 'Added table % to realtime publication', table_record.tablename;
            tables_added := tables_added + 1;
        ELSE
            RAISE NOTICE 'Table % already in realtime publication', table_record.tablename;
            tables_skipped := tables_skipped + 1;
        END IF;
    END LOOP;
    
    -- Summary log
    RAISE NOTICE 'Realtime configuration complete: % tables added, % tables skipped', tables_added, tables_skipped;
    
    -- Verify the final state
    RAISE NOTICE 'Current realtime publication includes % tables', (
        SELECT COUNT(*) 
        FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime'
    );
    
END
$$;

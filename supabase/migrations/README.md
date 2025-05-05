# Migration Consolidation Documentation

## Overview

This directory contains database migrations for the RA-Scrap project. The migrations have been consolidated to simplify deployment to production.

## Recent Consolidation (May 5, 2025)

The following migrations have been consolidated into a single file (`20250505000000_consolidated_venue_crawling_updates.sql`):

- `20250503000000_update_crawl_logic.sql`
- `20250503000001_add_ra_area_id_to_cities.sql`
- `20250503000002_create_venue_crawling_status.sql`
- `20250503000004_update_get_next_venue_logic.sql`
- `20250504004306_update_locatedvenue_view.sql`

### Key Changes in the Consolidated Migration

1. Added `ra_area_id` and `is_active` columns to `cities` table
2. Created and configured the `venue_crawling_status` table
3. Updated crawl logic with simplified indices
4. Dropped unnecessary `ra_id` column from venues
5. Updated the `locatedvenue` view
6. Created helper function for deactivating venues by city

## Deployment Instructions

When deploying to production:

1. Only deploy the following files:
   - `00000000000000_init_schema.sql` (if not already deployed)
   - `20250505000000_consolidated_venue_crawling_updates.sql`

2. Skip the individual migrations that have been consolidated (all migrations from May 3-4, 2025)

## Additional Notes

- The consolidated migration preserves all functionality while removing redundant or conflicting commands
- The function `get_next_venue_to_crawl()` has been simplified to use the most efficient join patterns
- Database indices have been optimized for performance 
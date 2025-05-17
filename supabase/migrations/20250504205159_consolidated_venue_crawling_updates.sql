-- Migration: Consolidated venue crawling updates (May 5, 2025)
-- This migration consolidates and simplifies changes from multiple migrations:
-- - Adding ra_area_id to cities
-- - Creating venue_crawling_status table
-- - Updating crawl logic
-- - Updating locatedvenue view

-- 1. Add columns to cities table
ALTER TABLE public.cities
ADD COLUMN IF NOT EXISTS ra_area_id integer;

ALTER TABLE public.cities
ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT false;

-- Add index for faster lookups based on ra_area_id
CREATE INDEX IF NOT EXISTS idx_cities_ra_area_id ON public.cities(ra_area_id);

-- 2. Create venue_crawling_status table
CREATE TABLE IF NOT EXISTS public.venue_crawling_status (
    venue_id uuid NOT NULL,
    last_crawled_at timestamp with time zone,
    next_crawl_at timestamp with time zone,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT venue_crawling_status_pkey PRIMARY KEY (venue_id)
);

-- Add foreign key constraint
ALTER TABLE public.venue_crawling_status
ADD CONSTRAINT venue_crawling_status_venue_id_fkey
FOREIGN KEY (venue_id)
REFERENCES public.venues(id)
ON DELETE CASCADE;

-- Add simplified index for next_crawl_at
CREATE INDEX IF NOT EXISTS idx_venue_crawling_status_next_crawl_at ON public.venue_crawling_status(next_crawl_at ASC);

-- 3. Remove unused column from venues
ALTER TABLE public.venues DROP COLUMN IF EXISTS ra_id;

-- 4. Create or update the function to get the next venue to crawl
CREATE OR REPLACE FUNCTION public.get_next_venue_to_crawl()
RETURNS TABLE (
    venue_id uuid,
    ra_id text,
    name text
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        vcs.venue_id,
        p.ra_id,
        p.name
    FROM
        public.venue_crawling_status vcs
    JOIN
        public.pages p ON vcs.venue_id = p.id
    JOIN
        public.cities c ON p.home_city_id = c.id
    WHERE
        vcs.is_active = true
        AND c.is_active = true
        AND vcs.next_crawl_at <= now()
    ORDER BY
        vcs.next_crawl_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;
END;
$$;

-- 5. Add helper function for deactivating venues by city
CREATE OR REPLACE FUNCTION public.deactivate_venues_by_city(city_ids uuid[])
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.venue_crawling_status vcs
  SET is_active = false
  FROM public.venues v
  JOIN public.pages p ON v.id = p.id
  WHERE vcs.venue_id = v.id AND p.home_city_id = ANY(city_ids);
END;
$$;

-- 6. Update the locatedvenue view
CREATE OR REPLACE VIEW public.locatedvenue AS
SELECT 
    p.id,       
    p.name,
    p.home_city_id,
    v.map_marker,
    v.latitude,            
    v.longitude,
    vcs.is_active,
    p.ra_id
FROM
    venues v
LEFT JOIN pages p ON p.id = v.id
LEFT JOIN venue_crawling_status vcs ON v.id = vcs.venue_id; 
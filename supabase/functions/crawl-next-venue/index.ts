/// <reference types="https://esm.sh/@supabase/functions-js/src/edge-runtime.d.ts" />
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import type { Database } from '../_shared/supabase-types.d.ts';
// Import shared types and helpers
import type { Mix, EventRa, Artist, Venue, Promoter } from '../_shared/types.ts';
import { determineEventType } from '../_shared/event-helpers.ts';
import { sendSlackNotification } from '../_shared/slack-client.ts';
import { fetchAndProcessVenueEvents } from '../_shared/ra-api.ts'; // Import the new function
import { upsertScrapedData } from '../_shared/db-helpers.ts'; // Import the new DB helper

// --- Main Edge Function Logic ---
serve(async (req) => {
    const functionStartTime = Date.now(); // Start timing the function

    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
        const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
            throw new Error("Missing Supabase environment variables");
        }
        const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey);
        const supabaseAdmin = createClient<Database>(supabaseUrl, supabaseServiceRoleKey);

        const startDate = new Date();
        startDate.setHours(startDate.getHours() - 1); // Look back slightly
        const startDateString = startDate.toISOString().split('T')[0]; // YYYY-MM-DD

        // --- Step 1: Get the next *active* and *due* venue to crawl --- 
        console.log("Querying for the next active and due venue using RPC...");

        // Use the RPC function we created
        const { data: nextVenueData, error: nextVenueError } = await supabaseAdmin.rpc(
            'get_next_venue_to_crawl' // Name of the SQL function
        ).maybeSingle(); // Expect 0 or 1 result

        if (nextVenueError) {
            console.error('Error calling get_next_venue_to_crawl:', nextVenueError);
            throw new Error(`Database error fetching next venue: ${nextVenueError.message}`);
        }

        if (!nextVenueData) {
            console.log("No active venues currently due for crawling.");
            await sendSlackNotification("Crawling queue is empty.");
            return new Response(JSON.stringify({ message: "No venues due for crawling." }), {
                 headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                 status: 200, 
             });
        }

        // We have a venue! Extract necessary info (RPC returns venue_id, ra_id, name)
        const venueInfo = {
             id: nextVenueData.venue_id, // The venue's UUID in your DB
             ra_id: nextVenueData.ra_id, // The venue's ID on RA
             name: nextVenueData.name    // The venue's name (from pages table via RPC)
         };
         console.log(`Selected venue: ${venueInfo.name} (DB ID: ${venueInfo.id}, RA ID: ${venueInfo.ra_id})`);

        // --- Step 2: Fetch Data --- 
        // Pass the admin client for potential DB operations within the fetcher (like getting city ID)
        const fetchedData = await fetchAndProcessVenueEvents(venueInfo.ra_id, startDateString, supabaseAdmin);

        // --- Step 3: Process and Store Data using the DB helper --- 
        const upsertResults = await upsertScrapedData(fetchedData, supabaseAdmin);

        // --- Step 4: Update Crawling Status --- 
        const nextCrawlDelayHours = 24 * 7; // Example: crawl again in 7 days
        const next_crawl_at = new Date(Date.now() + nextCrawlDelayHours * 60 * 60 * 1000).toISOString();

        console.log(`Updating status for venue ${venueInfo.id}, next crawl at ${next_crawl_at}`);
        const { error: updateStatusError } = await supabaseAdmin
            .from('venue_crawling_status')
            .update({
                last_crawled_at: new Date().toISOString(),
                next_crawl_at: next_crawl_at,
            })
            .eq('venue_id', venueInfo.id); // Use the DB venue_id

        if (updateStatusError) {
             console.error(`Failed to update crawl status for venue ${venueInfo.id}:`, updateStatusError);
             await sendSlackNotification(`Failed to update crawl status for venue ${venueInfo.name} (ID: ${venueInfo.id})`, true);
        }

        // --- Step 5: Generate & Send Summary Report ---
        const functionEndTime = Date.now();
        const functionDurationSeconds = ((functionEndTime - functionStartTime) / 1000).toFixed(2);

        // Define the reporting period (last 6 hours)
        const reportEndDate = new Date();
        const reportStartDate = new Date(reportEndDate.getTime() - 6 * 60 * 60 * 1000);
        const reportStartISO = reportStartDate.toISOString();

        let summaryMessage = `*RA Crawl Summary for: ${venueInfo.name} (RA ID: ${venueInfo.ra_id})*\n`;
        summaryMessage += `_Function Duration: ${functionDurationSeconds} seconds_\n`;
        summaryMessage += "-------------------------------------\n";
        summaryMessage += "*Queue & Activity (Last 6 Hours):*\n";

        try {
            // Fetch Queue Depth (Current)
            const { count: currentQueueDepth, error: queueError } = await supabaseAdmin
                .from('venue_crawling_status')
                .select('venue_id', { count: 'exact', head: true })
                .eq('is_active', true)
                .lt('next_crawl_at', reportEndDate.toISOString());
            if (queueError) console.error("Error fetching queue depth for summary:", queueError);
            summaryMessage += `  - Current Queue Depth: ${currentQueueDepth ?? 'Error'}\n`;

            // Crawl Count in Period
            const { count: totalCrawledInPeriod, error: crawledError } = await supabaseAdmin
                .from('venue_crawling_status')
                .select('venue_id', { count: 'exact', head: true })
                .gte('last_crawled_at', reportStartISO);
            if (crawledError) console.error("Error fetching crawl count for summary:", crawledError);
            summaryMessage += `  - Venues Crawled in Period: ${totalCrawledInPeriod ?? 'Error'}\n`;

            summaryMessage += "*Data Changes (Last 6 Hours):*\n";
            // New Events
            const { count: newEvents, error: newEventsError } = await supabaseAdmin
                .from('events')
                .select('id', { count: 'exact', head: true })
                .gte('created_at', reportStartISO);
            if (newEventsError) console.error("Error fetching new events count for summary:", newEventsError);
            summaryMessage += `  - New Events Added: ${newEvents ?? 'Error'}\n`;

            // Updated Events - simple count of recently updated events
            const { count: updatedEvents, error: updatedEventsError } = await supabaseAdmin
                .from('events')
                .select('id', { count: 'exact', head: true })
                .gte('updated_at', reportStartISO)
                .lt('updated_at', reportEndDate.toISOString()); // Just count events updated in this period
                
            if (updatedEventsError) console.error("Error fetching updated events count for summary:", updatedEventsError);
            summaryMessage += `  - Events Updated: ${updatedEvents ?? 'Error'}\n`;

            // New Pages
            const { count: newPages, error: newPagesError } = await supabaseAdmin
                .from('pages')
                .select('id', { count: 'exact', head: true })
                .gte('created_at', reportStartISO);
            if (newPagesError) console.error("Error fetching new pages count for summary:", newPagesError);
            summaryMessage += `  - New Pages (Artist/Venue/Promoter): ${newPages ?? 'Error'}\n`;

            // New Mixes
            const { count: newMixes, error: newMixesError } = await supabaseAdmin
                .from('mixes')
                .select('id', { count: 'exact', head: true })
                .gte('created_at', reportStartISO);
            if (newMixesError) console.error("Error fetching new mixes count for summary:", newMixesError);
            summaryMessage += `  - New Mixes Added: ${newMixes ?? 'Error'}\n`;

            // Send the summary
            await sendSlackNotification(summaryMessage);

        } catch (summaryError) {
             console.error("Failed to generate or send summary report:", summaryError);
             // Don't fail the main function, but maybe send a simpler alert?
             await sendSlackNotification(`Error generating crawl summary after processing ${venueInfo.name}: ${summaryError.message}`, true);
        }

        // --- Step 6: Return Success --- 
        const responsePayload = {
            message: `Successfully crawled venue: ${venueInfo.name}`,
            venueId: venueInfo.id,
            raId: venueInfo.ra_id,
            upsertResults: upsertResults
        };

        return new Response(JSON.stringify(responsePayload), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        });

    } catch (error) {
        console.error("Unhandled error in crawlNextVenue:", error);
        // Use the shared Slack helper
        await sendSlackNotification(`Unhandled error in crawlNextVenue: ${error.message || error}`, true);
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500,
        });
    }
}); 
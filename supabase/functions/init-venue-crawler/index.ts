/// <reference types="https://esm.sh/@supabase/functions-js/src/edge-runtime.d.ts" />
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import type { Database } from '../_shared/supabase-types.d.ts';
// Import RA API helpers for fetching event lists and details
import { 
    buildEventListQuery, // Import query builder for area events
    gqlFetch,            // Import GraphQL fetch helper
    fetchAndPrepareVenueDetails, // Still needed for adding NEW venues
    buildEventDetailQuery // Import query builder for event details
} from '../_shared/ra-api.ts';
import type { Venue } from '../_shared/types.ts'; // Import Venue type if needed for prepare func
import { sendSlackNotification } from '../_shared/slack-client.ts'; // Import Slack helper

console.log("init-venue-crawler function booting up (Refactored Venue Sync)");

// WARNING: Secure this endpoint properly.
// TODO: Add security check

serve(async (req) => {
    console.log("init-venue-crawler (Refactored Venue Sync) invoked");
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }
     // Require POST for actions that modify state
     if (req.method !== 'POST') {
         return new Response(JSON.stringify({ error: 'Method Not Allowed. Use POST.' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 405,
        });
    }
    // --- TODO: Add Security Check Here ---
    console.warn("Security check for init-venue-crawler is currently disabled!");
    // --- End Security Check ---

    try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        if (!supabaseUrl || !supabaseServiceRoleKey) {
            throw new Error("Missing Supabase environment variables");
        }
        const supabaseAdmin = createClient<Database>(supabaseUrl, supabaseServiceRoleKey);

        console.log('Starting refactored venue synchronization process...');
        let totalNewVenuesAdded = 0;
        let totalVenuesActivated = 0;
        let totalVenuesDeactivated = 0;
        let totalErrors = 0;
        const newVenueSlackMessages: string[] = []; // Store messages for Slack

        // --- Step 1: Get Active Cities (with RA Area ID) ---
        const { data: activeCities, error: citiesError } = await supabaseAdmin
            .from('cities')
            .select('id, name, ra_area_id') 
            .eq('is_active', true);

        if (citiesError) throw new Error(`Error fetching active cities: ${citiesError.message}`);
        if (!activeCities || activeCities.length === 0) {
            console.log("No active cities found. Exiting.");
            return new Response(JSON.stringify({ message: "No active cities to process." }), { 
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }, 
                status: 200 
            });
        }
        console.log(`Found ${activeCities.length} active cities to process.`);

        // --- Step 2: Process each Active City ---
        for (const city of activeCities) {
            console.log(`Processing city: ${city.name} (Area ID: ${city.ra_area_id})`);
            if (typeof city.ra_area_id !== 'number') {
                console.warn(`Skipping city ${city.name}: Invalid or missing ra_area_id.`);
                continue;
            }

            // --- Step 2a: Fetch Initial DB State for this City ---
            const initialDbRaIdToUuidMap = new Map<string, string>();
            try {
                // Fetch existing VENUE pages linked to this city - Simplified query
                const { data: cityVenuePages, error: dbFetchError } = await supabaseAdmin
                    .from('pages')
                    .select('id, ra_id') // Select only id and ra_id from pages
                    .eq('home_city_id', city.id)
                    .eq('page_type', 'venue'); // Ensure we only get venue pages

                if (dbFetchError) throw dbFetchError;

                cityVenuePages?.forEach(p => {
                    if (p.ra_id && p.id) {
                        initialDbRaIdToUuidMap.set(p.ra_id, p.id);
                    }
                });
                console.log(`Found ${initialDbRaIdToUuidMap.size} existing venue page records in DB for ${city.name}.`);

            } catch (dbFetchError: any) {
                console.error(`Error fetching initial DB state for city ${city.name}: ${dbFetchError.message}`);
                totalErrors++;
                continue; // Skip city on DB error
            }

            // --- Step 2b: Discover current venues from RA events ---
            const startDate = new Date().toISOString().split('T')[0]; 
            // Store ra_id, name, latitude, and longitude discovered from event stubs
            const discoveredRaVenues = new Map<string, { ra_id: string; name: string; latitude?: number | null; longitude?: number | null;}>();
            try {
                console.log(`Fetching event list for Area ID ${city.ra_area_id} to discover venues...`);
                const eventListData = await gqlFetch(buildEventListQuery(city.ra_area_id, startDate));
                const eventListStubs = eventListData?.eventListings?.data || [];
                console.log(`Found ${eventListStubs.length} event stubs in Area ${city.ra_area_id}.`);

                for (const stub of eventListStubs) {
                    // Get the event ID from the stub
                    const eventRaId = stub?.event?.id;
                    if (!eventRaId) continue;
                    
                    // Fetch full event details to get complete venue information including location
                    try {
                        const eventDetailData = await gqlFetch(buildEventDetailQuery(eventRaId));
                        const event = eventDetailData?.event;
                        
                        if (!event || !event.venue) {
                            console.warn(`Skipping event RA ID ${eventRaId}: Missing venue details.`);
                            continue;
                        }
                        
                        const venueData = event.venue;
                        //console.log(`Venue data for event ${event.title}:`, JSON.stringify(venueData));
                        const venueRaId = venueData?.id;
                        const venueName = venueData?.name;
                        
                        // Extract location if available
                        const latitude = venueData?.location?.latitude;
                        const longitude = venueData?.location?.longitude;
                        // Log coordinates for debugging
                        console.log(`Discovered venue: ${venueName} (RA ID: ${venueRaId}) - Latitude: ${latitude}, Longitude: ${longitude}`);
                        if (venueRaId && venueName && !discoveredRaVenues.has(venueRaId)) {
                            discoveredRaVenues.set(venueRaId, { 
                                ra_id: venueRaId, 
                                name: venueName, 
                                latitude: latitude ?? null, // Store lat/lon or null
                                longitude: longitude ?? null,
                            });
                        }
                    } catch (detailError) {
                        console.error(`Error fetching details for event RA ID ${eventRaId}: ${detailError.message}`);
                        continue; // Skip this event but continue with others
                    }
                }
            } catch (fetchError: any) {
                 console.error(`Error fetching event list for Area ID ${city.ra_area_id}: ${fetchError.message}`);
                 totalErrors++;
                 continue; // Skip this city if RA event fetch fails
            }

            // --- Step 2c: Filter for NEW Venues --- 
            const newRaVenues = Array.from(discoveredRaVenues.values()).filter(
                raVenue => !initialDbRaIdToUuidMap.has(raVenue.ra_id)
            );

            if (newRaVenues.length === 0) {
                console.log(`No new venues discovered on RA for ${city.name}.`);
                continue; // Skip to the next city
            } else {
                console.log(`Discovered ${newRaVenues.length} new venues on RA for ${city.name}.`);
            }
            
            // --- Step 2d: Process & Initialize NEW Venues --- 
            console.log(`Initializing ${newRaVenues.length} new venues for ${city.name}...`);
            let cityNewVenuesAdded = 0;

            for (const newRaVenueStub of newRaVenues) {
                console.log(`Processing new venue ${newRaVenueStub.name}: ${JSON.stringify(newRaVenueStub)}`);
                // Log coordinates for debugging
                console.log(`Processing coordinates for new venue: ${newRaVenueStub.name} (RA ID: ${newRaVenueStub.ra_id}) - Latitude: ${newRaVenueStub.latitude}, Longitude: ${newRaVenueStub.longitude}`);
                
                try {
                    // --- Step 1: Fetch additional details using fetchAndPrepareVenueDetails ---
                    const venueDetails: Venue | null = await fetchAndPrepareVenueDetails(newRaVenueStub, newRaVenueStub.ra_id, new Map(), supabaseAdmin);
                    //console.log(`Venue details fetched for RA ID ${newRaVenueStub.ra_id}:`, venueDetails);

                    // Although we need details, if fetch fails, we might still proceed with stub data?
                    // Requirement implies using both. Let's proceed if venueDetails exist, log error if not.
                    if (!venueDetails) {
                        console.warn(`Could not fetch full details for new venue RA ID: ${newRaVenueStub.ra_id}. Some fields will be missing.`);
                        // Decide if we should continue or skip. For now, let's skip if details fail.
                        // If we wanted partial inserts, we'd handle nulls below.
                        totalErrors++;
                        continue; 
                    }

                    // --- Step 2: Generate UUID and Handle ---
                    const newVenueUUID = crypto.randomUUID(); 
                    // Generate handle from stub name: lowercase, replace spaces with dashes
                    const handle = venueDetails.name.toLowerCase().replace(/\s+/g, '-');
                    
                    // --- Step 3: Insert 'pages' record (Hybrid Data) ---
                    const { error: pageInsertError } = await supabaseAdmin
                        .from('pages')
                        .insert({
                            id: newVenueUUID,                   // Generated UUID
                            ra_id: venueDetails.ra_id,           // From event stub
                            name: venueDetails.name,            // From event stub
                            handle: handle,                     // Generated from stub name
                            profile_picture: venueDetails.profile_picture, // From details fetch
                            bio: venueDetails.bio,          // Not explicitly required for pages in KIGS-134
                            page_type: 'venue',                 // Fixed value
                            home_city_id: city.id,              // Current city ID
                            instagram: venueDetails.instagram,  // From details fetch
                            website: venueDetails.website,      // From details fetch
                            facebook: venueDetails.facebook,    // From details fetch
                            soundcloud: venueDetails.soundcloud, // Not required for pages 
                            twitter: venueDetails.twitter,      // From details fetch
                        });

                    if (pageInsertError) {
                        if (pageInsertError.code === '23505' && pageInsertError.message.includes('ra_id')) {
                            console.warn(`Skipping new venue ${venueDetails.name} (RA ID: ${venueDetails.ra_id}): Another process likely created a page with this RA ID already.`);
                        } else {
                            // Use name from stub in error message as venueDetails might be null if logic changed
                            console.error(`Error inserting page for new venue ${venueDetails.name} (RA ID ${venueDetails.ra_id}): ${pageInsertError.message}`);
                        }
                        totalErrors++;
                        continue; 
                    }

                    // --- Step 4: Insert 'venues' record (Hybrid Data) ---
                    const { error: venueInsertError } = await supabaseAdmin
                        .from('venues')
                        .insert({
                            id: newVenueUUID,                   // Same generated UUID
                            latitude: venueDetails.latitude,         // From event stub
                            longitude: venueDetails.longitude,       // From event stub
                            capacity: venueDetails.capacity ?? 0, // From details fetch (default 0 if null)
                        });

                    if (venueInsertError) {
                         console.error(`Error inserting venue details for new venue ${venueDetails.name} (RA ID ${venueDetails.ra_id}): ${venueInsertError.message}`);
                         // Clean up the orphaned page record
                         await supabaseAdmin.from('pages').delete().eq('id', newVenueUUID); 
                         totalErrors++;
                         continue;
                    }

                    // --- Step 5: Insert 'venue_crawling_status' record ---
                    const { error: crawlStatusInsertError } = await supabaseAdmin
                        .from('venue_crawling_status')
                        .insert({
                            venue_id: newVenueUUID,
                            is_active: true, 
                            next_crawl_at: new Date().toISOString(), 
                            last_crawled_at: null 
                         });
                    
                    if (crawlStatusInsertError) {
                        // Use name from stub in error message
                        console.error(`Error inserting venue_crawling_status for new venue ${venueDetails.name} (UUID ${newVenueUUID}): ${crawlStatusInsertError.message}`);
                        // Venue/Page exist but won't be crawled. Consider if cleanup is needed.
                        totalErrors++;
                        continue; 
                    }

                    // --- Reporting for New Venues (using hybrid data where appropriate) ---
                    console.log(`Successfully INITIALIZED new venue: ${newRaVenueStub.name} (RA ID: ${newRaVenueStub.ra_id}) - Scheduled for crawl.`);
                    cityNewVenuesAdded++;
                    // Slack message uses fetched details where available (name still from stub for consistency? KIGS-134 uses stub name)
                    const raLink = venueDetails.contentUrl ? `<${venueDetails.contentUrl}|RA Page>` : 'RA Page N/A';
                    const igLink = venueDetails.instagram ? `<${venueDetails.instagram}|Instagram>` : 'Instagram N/A'; 
                    newVenueSlackMessages.push(`- *${newRaVenueStub.name}* (${city.name}): ${raLink}, ${igLink}`); // Use stub name per KIGS-134 pages table req
                    
                } catch (processError: any) {
                    console.error(`Unexpected error processing new venue RA ID ${newRaVenueStub.ra_id} (${newRaVenueStub.name}): ${processError.message}`);
                    totalErrors++;
                }
            } // End loop for processing NEW RA venues for this city
            
            totalNewVenuesAdded += cityNewVenuesAdded;
            console.log(`Finished processing ${city.name}. Added ${cityNewVenuesAdded} new venues.`);

        } // End loop for cities

        // --- Final Report ---
        const message = `Venue Initialization Complete. Cities Processed: ${activeCities.length}. New Venues Initialized & Queued for Crawl: ${totalNewVenuesAdded}. Errors: ${totalErrors}.`; 
        console.log(message);
        
        // --- Send Slack Notification for New Venues ---
        if (newVenueSlackMessages.length > 0) {
            const slackMessage = `*${totalNewVenuesAdded} New Venues Initialized & Queued for Crawl* across ${activeCities.length} cities:\n${newVenueSlackMessages.join('\n- ')}`; // Use '- ' for Slack list items
            try {
                 const slackWebhookUrl = Deno.env.get('SLACK_WEBHOOK_URL'); 
                 if (slackWebhookUrl) {
                     await sendSlackNotification(slackMessage);
                     console.log("Sent Slack notification for new venues.");
                 } else {
                     console.warn("SLACK_WEBHOOK_URL environment variable not set. Cannot send notification.");
                 }
            } catch (slackError: any) {
                 console.error(`Failed to send Slack notification: ${slackError.message}`);
            }
        } else {
             console.log("No new venues added to the DB in this run.");
             // Send notification even when no venues are found
             try {
                 const slackWebhookUrl = Deno.env.get('SLACK_WEBHOOK_URL');
                 if (slackWebhookUrl) {
                     const statusMessage = `Venue crawler completed - No new venues found across ${activeCities.length} cities. ${totalErrors > 0 ? `Errors: ${totalErrors}` : 'No errors.'}`;
                     await sendSlackNotification(statusMessage);
                     console.log("Sent Slack notification for run with no new venues.");
                 } else {
                     console.warn("SLACK_WEBHOOK_URL environment variable not set. Cannot send notification.");
                 }
             } catch (slackError: any) {
                 console.error(`Failed to send Slack notification: ${slackError.message}`);
             }
        }


        return new Response(JSON.stringify({ message: message }), { 
             headers: { ...corsHeaders, 'Content-Type': 'application/json' }, 
             status: 200 
         });

    } catch (error: any) {
        console.error("Critical error during init-venue-crawler execution:", error);
        // Send critical error Slack notification
        try {
            const slackWebhookUrl = Deno.env.get('SLACK_WEBHOOK_URL');
            if (slackWebhookUrl) {
                await sendSlackNotification(`Critical error in init-venue-crawler: ${error.message}`, true);
            } else {
                 console.warn("SLACK_WEBHOOK_URL environment variable not set. Cannot send critical error notification.");
            }
        } catch (slackError: any) {
             console.error(`Failed to send critical error Slack notification: ${slackError.message}`);
        }

        return new Response(JSON.stringify({ error: error.message }), { 
             headers: { ...corsHeaders, 'Content-Type': 'application/json' }, 
             status: 500 
         });
    }
}); 
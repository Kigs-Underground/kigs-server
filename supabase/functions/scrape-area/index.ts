/// <reference types="https://esm.sh/@supabase/functions-js/src/edge-runtime.d.ts" />
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import type { Database } from '../_shared/supabase-types.d.ts';
import { sendSlackNotification } from '../_shared/slack-client.ts';
import { buildEventListQuery, gqlFetch, fetchAndPrepareArtistDetails, fetchAndPreparePromoterDetails, fetchAndPrepareVenueDetails, buildEventDetailQuery } from '../_shared/ra-api.ts'; // Import necessary RA helpers and buildEventDetailQuery
import { upsertScrapedData } from '../_shared/db-helpers.ts'; // Import the DB helper
import type { Artist, EventRa, Promoter, Venue } from "../_shared/types.ts";

console.log("scrape-area function booting up");

serve(async (req) => {
    console.log("scrape-area invoked");
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    let areaId: number | null = null;
    try {
        const payload = await req.json();
        areaId = parseInt(payload?.areaId, 10);
        if (isNaN(areaId)) {
             throw new Error("Missing or invalid areaId in request body");
        }
        console.log(`Processing scrape request for Area ID: ${areaId}`);

        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        if (!supabaseUrl || !supabaseServiceRoleKey) {
            throw new Error("Missing Supabase environment variables");
        }
        const supabaseAdmin = createClient<Database>(supabaseUrl, supabaseServiceRoleKey);

        // --- Fetch events for the area ---
        const startDate = new Date().toISOString().split('T')[0]; // Use current date
        let eventList: any[] = [];
        try {
            const eventListData = await gqlFetch(buildEventListQuery(areaId, startDate));
            eventList = eventListData?.eventListings?.data || [];
             console.log(`Found ${eventList.length} potential events in Area ${areaId} from ${startDate}`);
        } catch (error) {
            console.error(`Failed to fetch event list for Area ${areaId}:`, error);
            throw new Error(`Failed to fetch event list for Area ${areaId}: ${error.message}`);
        }

        // --- Process and Prepare Data --- 
        // Similar to fetchAndProcessVenueEvents but without filtering for one venue
        const processedEvents: EventRa[] = [];
        const processedArtists = new Map<string, Artist>();
        const processedVenues = new Map<string, Venue>();
        const processedPromoters = new Map<string, Promoter>();

        for (const eventStub of eventList) {
            const eventRaId = eventStub?.event?.id;
            if (!eventRaId) continue;

            try {
                const eventDetailData = await gqlFetch(buildEventDetailQuery(eventRaId)); // Need detail query definition
                const event = eventDetailData?.event;

                if (!event) {
                    console.warn(`Skipping event RA ID ${eventRaId}: Failed to fetch details.`);
                    continue;
                }
                console.log(`Processing event: ${event.title} (RA ID: ${eventRaId})`);

                // Prepare linked entities
                const venueRaIdFromEvent = event.venue?.id;
                const venueObject = venueRaIdFromEvent 
                    ? await fetchAndPrepareVenueDetails(event.venue, venueRaIdFromEvent, processedVenues, supabaseAdmin) 
                    : null;
                const artistObjects = (await Promise.all(
                    (event.artists || []).map((a: any) => fetchAndPrepareArtistDetails(a, processedArtists))
                )).filter(a => a !== null) as Artist[];
                const promoterObjects = (await Promise.all(
                    (event.promoters || []).map((p: any) => fetchAndPreparePromoterDetails(p, processedPromoters))
                )).filter(p => p !== null) as Promoter[];

                // Prepare EventRa Object
                const eventFormatted: EventRa = {
                    id: crypto.randomUUID(),
                    raId: event.id,
                    name: event.title,
                    description: event.content,
                    datePosted: event.datePosted,
                    startTime: event.startTime,
                    endTime: event.endTime,
                    image: event.flyerFront || event.images?.[0]?.filename,
                    contentUrl: "https://ra.co" + event.contentUrl,
                    venue: venueObject?.id,
                    artists: artistObjects.map(a => a.id),
                    promoters: promoterObjects.map(p => p.id),
                };
                processedEvents.push(eventFormatted);

            } catch (error) {
                 console.error(`Failed to process details for event RA ID ${eventRaId}:`, error);
                 // Continue to next event
            }
        }

        // --- Store Data ---
         const upsertResults = await upsertScrapedData({
             events: processedEvents,
             artists: Array.from(processedArtists.values()),
             venues: Array.from(processedVenues.values()),
             promoters: Array.from(processedPromoters.values()),
         }, supabaseAdmin);

        const responseMessage = `Scraped Area ${areaId}. Events processed: ${processedEvents.length}. Upsert summary: ${JSON.stringify(upsertResults)}`;
        console.log(responseMessage);

        return new Response(JSON.stringify({ message: responseMessage, results: upsertResults }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        });

    } catch (error) {
        console.error(`Error in scrape-area for Area ID ${areaId || 'unknown'}:`, error);
        await sendSlackNotification(`Error in scrape-area for Area ID ${areaId || 'unknown'}: ${error.message}`, 'SLACK_WEBHOOK_URL', true);
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500,
        });
    }
}); 
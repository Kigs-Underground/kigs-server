// RA API Interaction Logic - Adapted for Deno/Supabase Edge Functions

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { Artist, EventRa, Venue, Promoter, Mix, Page } from './types.ts'; // Use shared types
import { getSoundcloudUserID, getSoundcloudTracks } from './soundcloud-api.ts';
import type { Database } from './supabase-types.d.ts'; // Assuming this exists for Supabase client typing

const RA_GRAPHQL_URL = "https://ra.co/graphql";

// --- GraphQL Query Builders (Mostly unchanged) ---

export const buildEventListQuery = (areaId: number, date: string) => ({
    operationName: "GET_EVENT_LISTINGS",
    // ... (rest of the query object from util.ts) ... - Keeping it concise here
    variables: { filters: { areas: { eq: areaId }, listingDate: { gte: date } }, filterOptions: { genre: true, eventType: true }, pageSize: 100, page: 1, sort: { listingDate: { order: "ASCENDING" }, score: { order: "DESCENDING" }, titleKeyword: { order: "ASCENDING" } }, includeBumps: false },
    query: "query GET_EVENT_LISTINGS($filters: FilterInputDtoInput, $filterOptions: FilterOptionsInputDtoInput, $page: Int, $pageSize: Int, $sort: SortInputDtoInput, $includeBumps: Boolean!, $areaId: ID, $dateRange: DateRangeInput) { eventListings( filters: $filters filterOptions: $filterOptions pageSize: $pageSize page: $page sort: $sort ) { data { id listingDate event { ...eventListingsFields __typename } __typename } filterOptions { genre { label value count __typename } eventType { value count __typename } location { value { from to __typename } count __typename } __typename } totalResults __typename } bumps(areaId: $areaId, dateRange: $dateRange) @include(if: $includeBumps) { bumpDecision { id date eventId clickUrl impressionUrl event { ...eventListingsFields artists { id name __typename } __typename } __typename } __typename } } fragment eventListingsFields on Event { id date startTime endTime title contentUrl flyerFront isTicketed interestedCount isSaved isInterested queueItEnabled newEventForm images { id filename alt type crop __typename } pick { id blurb __typename } venue { id name contentUrl live area { id name country { id name urlCode __typename } __typename } __typename } promoters { id __typename } artists { id name __typename } tickets(queryType: AVAILABLE) { validType onSaleFrom onSaleUntil __typename } __typename }"
});

export const buildEventDetailQuery = (id: string) => ({
    operationName: "GET_EVENT_DETAIL",
    // ... (rest of the query object from util.ts) ... - Keeping it concise here
    variables: { id, isAuthenticated: false, canAccessPresale: false }, // Set isAuthenticated to false
    query: "query GET_EVENT_DETAIL($id: ID!, $isAuthenticated: Boolean!, $canAccessPresale: Boolean!) { event(id: $id) { id title flyerFront flyerBack content minimumAge cost contentUrl embargoDate date time startTime endTime interestedCount lineup isInterested isSaved isTicketed isFestival dateUpdated resaleActive newEventForm datePosted hasSecretVenue live canSubscribeToTicketNotifications images { id filename alt type crop __typename } venue { id name address contentUrl live area { id name urlName country { id name urlCode isoCode __typename } __typename } location { latitude longitude __typename } __typename } promoters { id name contentUrl live hasTicketAccess tracking(types: [PAGEVIEW]) { id code event __typename } __typename } artists { id name contentUrl urlSafeName __typename } pick { id blurb author { id name imageUrl username contributor __typename } __typename } promotionalLinks { title url __typename } tracking(types: [PAGEVIEW]) { id code event __typename } admin { id username __typename } tickets(queryType: AVAILABLE) { id title validType onSaleFrom priceRetail isAddOn currency { id code __typename } __typename } standardTickets: tickets(queryType: AVAILABLE, ticketTierType: TICKETS) { id validType __typename } userOrders @include(if: $isAuthenticated) { id rAOrderNumber __typename } playerLinks { id sourceId audioService { id name __typename } __typename } childEvents { id date isTicketed __typename } genres { id name slug __typename } setTimes { id lineup status __typename } area { ianaTimeZone __typename } presaleStatus isSignedUpToPresale @include(if: $canAccessPresale) ticketingSystem __typename } }"
});

export const buildArtistDetailQuery = (slug: string) => ({
    operationName: "GET_ARTIST_BY_SLUG",
     // ... (rest of the query object from util.ts) ... - Keeping it concise here
    variables: { slug },
    query: "query GET_ARTIST_BY_SLUG($slug: String!) { artist(slug: $slug) { id name followerCount firstName lastName aliases isFollowing coverImage contentUrl facebook soundcloud instagram twitter bandcamp discogs website urlSafeName pronouns country { id name urlCode __typename } residentCountry { id name urlCode __typename } news(limit: 1) { id __typename } reviews(limit: 1, type: ALLMUSIC) { id __typename } ...biographyFields __typename } } fragment biographyFields on Artist { id name contentUrl image biography { id blurb content discography __typename } __typename }"
});

export const buildVenueDetailQuery = (id: string) => ({
    operationName: "GET_VENUE",
    // ... (rest of the query object from util.ts) ... - Keeping it concise here
    variables: { id },
    query: "query GET_VENUE($id: ID!) { venue(id: $id) { id name logoUrl photo blurb address isFollowing contentUrl phone website followerCount capacity raSays isClosed topArtists { name contentUrl __typename } eventCountThisYear area { id name urlName country { id name urlCode isoCode __typename } __typename } __typename } }"
});

export const buildPromoterDetailsQuery = (id: string) => ({
    operationName: "GET_PROMOTER_DETAIL",
     // ... (rest of the query object from util.ts) ... - Keeping it concise here
    variables: { id },
    query: "query GET_PROMOTER_DETAIL($id: ID!) { promoter(id: $id) { id name contentUrl followerCount isFollowing website email blurb logoUrl socialMediaLinks { id link platform __typename } area { id name urlName country { id name urlCode __typename } __typename } tracking(types: [PAGEVIEW]) { id code event __typename } __typename } }"
});

// --- New Function: Fetch Venues for an RA Area ---
// NOTE: This query structure is hypothetical and needs verification.
export const buildAreaVenuesQuery = (areaId: number) => ({
    operationName: "GET_AREA_VENUES", // Hypothetical operation name
    query: `
        query GET_AREA_VENUES($areaId: Int!) {
          area(id: $areaId) {
            id
            name
            venues { # Assuming 'venues' is the field linking venues to an area
              id # RA internal ID (string)
              name
              contentUrl # Might contain the slug?
            }
          }
        }
    `,
    variables: { areaId: areaId }
});

// --- NEW: Query Builder for Venue-Specific Event Listings ---
export const buildVenueListingQuery = (venueRaId: string, startDate: string) => {
    return {
        operationName: "GET_DEFAULT_EVENTS_LISTING",
        variables: {
            indices: ["EVENT"],
            pageSize: 20,
            page: 1,
            aggregations: [],
            filters: [
                { type: "CLUB", value: venueRaId },
                { type: "DATERANGE", value: JSON.stringify({ gte: `${startDate}T00:00:00.000Z` }) }
            ],
            sortOrder: "ASCENDING",
            sortField: "DATE",
            baseFilters: [
                { type: "CLUB", value: venueRaId },
                { type: "DATERANGE", value: JSON.stringify({ gte: `${startDate}T00:00:00.000Z` }) }
            ]
        },
        query: "query GET_DEFAULT_EVENTS_LISTING($indices: [IndexType!], $aggregations: [ListingAggregationType!], $filters: [FilterInput], $pageSize: Int, $page: Int, $sortField: FilterSortFieldType, $sortOrder: FilterSortOrderType, $baseFilters: [FilterInput]) { listing( indices: $indices aggregations: [] filters: $filters pageSize: $pageSize page: $page sortField: $sortField sortOrder: $sortOrder ) { data { ...eventFragment __typename } totalResults __typename } aggregations: listing( indices: $indices aggregations: $aggregations filters: $baseFilters pageSize: 0 sortField: $sortField sortOrder: $sortOrder ) { aggregations { type values { value name __typename } __typename } __typename } } fragment eventFragment on Event { id title interestedCount isSaved isInterested date startTime contentUrl queueItEnabled flyerFront newEventForm images { id filename alt type crop __typename } artists { id name __typename } venue { id name contentUrl live area { id name urlName country { id name urlCode __typename } __typename } __typename } pick { id blurb __typename } __typename }"
    };
};

// --- Helper Functions Adapted for Deno ---

// Helper to make GraphQL requests using fetch
export async function gqlFetch(query: object): Promise<any> {
    try {
        const response = await fetch(RA_GRAPHQL_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(query),
        });
        if (!response.ok) {
            throw new Error(`GraphQL fetch error: ${response.status} ${await response.text()}`);
        }
        const jsonResponse = await response.json();
        if (jsonResponse.errors) {
             // Log GraphQL errors but try to continue if data exists
            console.error("GraphQL query errors:", JSON.stringify(jsonResponse.errors, null, 2));
        }
        if (!jsonResponse.data) {
            throw new Error("No data returned from GraphQL query.");
        }
        return jsonResponse.data;
    } catch (error) {
        console.error("Error during GraphQL fetch:", error);
        throw error; // Re-throw to be caught by the caller
    }
}

// Fetches city ID from DB - needed by getVenueDetails
export async function getCityId(cityName: string | null | undefined, supabase: SupabaseClient<Database>): Promise<string | null> {
    if (!cityName) return null;
    try {
        const { data, error } = await supabase
            .from('cities') // Assuming table name is 'cities'
            .select('id')
            .eq('name', cityName)
            .maybeSingle();

        if (error) {
            console.error(`Error fetching city ID for ${cityName}:`, error);
            return null;
        }
        return data?.id || null;
    } catch (error) {
         console.error(`Exception fetching city ID for ${cityName}:`, error);
         return null;
    }
}

// Adapting getVenueDetails
// Note: This function modifies the `existingVenues` array directly (side effect)
// It now also returns the full Venue object or null
export async function fetchAndPrepareVenueDetails(
    // Option 1: Keep signature, pass null/undefined if no initial data
    eventVenueData: any | null, 
    venueRaId: string, // Pass the target venue ID explicitly
    existingVenues: Map<string, Venue>, 
    supabase: SupabaseClient<Database>
): Promise<Venue | null> {
    if (existingVenues.has(venueRaId)) {
        return existingVenues.get(venueRaId)!;
    }
    
    // If venue data provided (e.g. from event), use it as fallback?
    const initialName = eventVenueData?.name;

    try {
        const venueDetailsData = await gqlFetch(buildVenueDetailQuery(venueRaId));
        //console.log(`Full venue details data for ID ${venueRaId}:`, venueDetailsData);
        const venueDetails = venueDetailsData?.venue;

        if (venueDetails) {
            const cityId = await getCityId(venueDetails.area?.name, supabase);
            const venueFormatted: Venue = {
                id: crypto.randomUUID(), 
                ra_id: venueRaId,
                name: venueDetails.name || initialName || 'Unknown Venue',
                handle: (venueDetails.name || initialName || `venue-${venueRaId}`).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
                page_type: 'venue',
                bio: venueDetails.blurb,
                profile_picture: venueDetails.logoUrl,
                cover_picture: venueDetails.photo,
                latitude: eventVenueData?.latitude, // Get from detail query if available
                longitude: eventVenueData?.longitude,
                home_city_id: cityId,
                capacity: venueDetails.capacity ?? 0, // Default to 0 if null/undefined
                website: venueDetails.website,
                instagram: venueDetails.instagram,
                soundcloud: venueDetails.soundcloud,
                twitter: venueDetails.twitter,
                facebook: venueDetails.facebook,
            };
            existingVenues.set(venueRaId, venueFormatted);
            return venueFormatted;
        }
    } catch (error) {
        console.error(`Failed to fetch/prepare details for venue RA ID ${venueRaId}:`, error);
    }
    return null;
}

// Adapting logic for artists
// Modifies existingArtists map, returns prepared Artist object or null
export async function fetchAndPrepareArtistDetails(
     artistData: any, // Raw data from event detail query
     existingArtists: Map<string, Artist> // Use Map for faster lookups by RA ID
): Promise<Artist | null> {
    const raId = artistData?.id;
    const slug = artistData?.urlSafeName; // Need slug for detail query

    if (!raId || !slug) return null;
    if (existingArtists.has(raId)) {
        return existingArtists.get(raId)!;
    }

     try {
         const artistDetailsData = await gqlFetch(buildArtistDetailQuery(slug));
         const artistDetails = artistDetailsData?.artist;

         if (artistDetails) {
             const soundcloudUrl = artistDetails.soundcloud;
             console.log(`Artist ${artistData.name} (RA ID: ${raId}) has SoundCloud URL: ${soundcloudUrl || 'none'}`);
             
             const soundcloudUserID = await getSoundcloudUserID(soundcloudUrl);
             console.log(`Resolved SoundCloud user ID for ${artistData.name}: ${soundcloudUserID || 'failed to resolve'}`);
             
             const soundcloudTracks = soundcloudUserID ? await getSoundcloudTracks(soundcloudUserID) : [];
             console.log(`Retrieved ${soundcloudTracks.length} tracks for ${artistData.name} from SoundCloud`);

             const artistFormatted: Artist = {
                 id: crypto.randomUUID(),
                 raId: raId,
                 name: artistDetails.name || artistData.name || 'Unknown Artist',
                 handle: slug,
                 page_type: 'artist',
                 bio: artistDetails.biography?.blurb,
                 profile_picture: artistDetails.image,
                 cover_picture: artistDetails.coverImage,
                 // Add other fields from Artist type
                 instagram: artistDetails.instagram,
                 soundcloud: soundcloudUrl,
                 soundcloudUserID: soundcloudUserID ?? undefined,
                 bandcamp: artistDetails.bandcamp,
                 discogs: artistDetails.discogs,
                 facebook: artistDetails.facebook,
                 twitter: artistDetails.twitter,
                 website: artistDetails.website,
                 lastTracks: soundcloudTracks,
             };
             existingArtists.set(raId, artistFormatted);
             return artistFormatted;
         }
     } catch (error) {
         console.error(`Failed to fetch/prepare details for artist RA ID ${raId} (slug ${slug}):`, error);
     }
     return null;
}

// Adapting logic for promoters
// Modifies existingPromoters map, returns prepared Promoter object or null
export async function fetchAndPreparePromoterDetails(
     promoterData: any, // Raw data from event detail query
     existingPromoters: Map<string, Promoter> // Use Map for faster lookups by RA ID
): Promise<Promoter | null> {
    const raId = promoterData?.id;
    if (!raId) return null;

    if (existingPromoters.has(raId)) {
        return existingPromoters.get(raId)!;
    }

     try {
         const promoterDetailsData = await gqlFetch(buildPromoterDetailsQuery(raId));
         const promoterDetails = promoterDetailsData?.promoter;

          if (promoterDetails) {
              // Promoters might not have tracks on RA/SoundCloud in the same way
              // const soundcloudUserID = await getSoundcloudUserID(promoterDetails.soundcloud); // If SC links exist
              // const soundcloudTracks = soundcloudUserID ? await getSoundcloudTracks(soundcloudUserID) : [];

             const promoterFormatted: Promoter = {
                 id: crypto.randomUUID(),
                 raId: raId,
                 name: promoterDetails.name || promoterData.name || 'Unknown Promoter',
                 handle: (promoterDetails.name || promoterData.name || `promoter-${raId}`).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
                 page_type: 'promoter',
                 bio: promoterDetails.blurb,
                 profile_picture: promoterDetails.logoUrl,
                 // cover_picture: undefined, // Promoter type doesn't guarantee cover image
                 // lastTracks: soundcloudTracks,
             };
             existingPromoters.set(raId, promoterFormatted);
             return promoterFormatted;
         }
     } catch (error) {
          console.error(`Failed to fetch/prepare details for promoter RA ID ${raId}:`, error);
     }
     return null;
}

// --- Main Exported Function ---
// Refactored to use buildVenueListingQuery

interface FetchedVenueData {
    events: EventRa[];
    artists: Artist[];
    venues: Venue[]; // Will likely only contain the target venue
    promoters: Promoter[];
}

export async function fetchAndProcessVenueEvents(
    venueRaId: string,
    startDate: string, // YYYY-MM-DD format expected by RA API
    supabase: SupabaseClient<Database> 
): Promise<FetchedVenueData> {

    console.log(`Fetching events for venue RA ID: ${venueRaId} starting from ${startDate} using venue-specific query.`);

    // --- Maps to store processed entities --- 
    const processedEvents: EventRa[] = [];
    const processedArtists = new Map<string, Artist>(); 
    const processedVenues = new Map<string, Venue>();   
    const processedPromoters = new Map<string, Promoter>();

    // --- Fetch the target venue's details once (needed for EventRa object link) --- 
    const targetVenueObject = await fetchAndPrepareVenueDetails(null, venueRaId, processedVenues, supabase);
    if (!targetVenueObject) {
        console.error(`Failed to fetch details for the target venue RA ID: ${venueRaId}. Cannot process events.`);
        return { events: [], artists: [], venues: [], promoters: [] };
    }

    // --- Fetch Events using the new Venue-Specific Query --- 
    let venueEventList: any[] = [];
    try {
        // Log the query for inspection
        const venueListingQuery = buildVenueListingQuery(venueRaId, startDate);
        const venueEventListData = await gqlFetch(venueListingQuery);
        
        // Log the API response to examine its structure
        console.log(`Venue events API response for RA ID ${venueRaId}:`, JSON.stringify(venueEventListData, null, 2));
        
        // --- Parse the response based on the actual structure ---
        venueEventList = venueEventListData?.listing?.data || []; 
        const totalResults = venueEventListData?.listing?.totalResults || venueEventList.length;
        // --- End adaptation section ---

        console.log(`Found ${venueEventList.length} potential events for Venue ${venueRaId} (Total reported: ${totalResults})`);

    } catch (error) {
        console.error(`Failed to fetch event list for Venue ${venueRaId}:`, error);
        return { events: [], artists: Array.from(processedArtists.values()), venues: Array.from(processedVenues.values()), promoters: Array.from(processedPromoters.values()) }; // Return what we have
    }

    // --- Process the fetched events --- 
    for (const eventData of venueEventList) {
        const eventRaId = eventData?.id;
        if (!eventRaId) continue;

        try {
            console.log(`Processing event: ${eventData.title} (RA ID: ${eventRaId})`);
            
            // Always fetch full event details to ensure we have all required data (especially endTime)
            const eventDetailData = await gqlFetch(buildEventDetailQuery(eventRaId));
            const eventDetail = eventDetailData?.event;
            
            if (!eventDetail) {
                console.warn(`Skipping event RA ID ${eventRaId}: Failed to fetch full details.`);
                continue;
            }
            
            // --- Prepare Linked Entities --- 
            // Target venue is already fetched (targetVenueObject)
            
            // Process artists from the full event details
            const artistObjects = (await Promise.all(
                (eventDetail.artists || []).map((a: any) => fetchAndPrepareArtistDetails(a, processedArtists))
            )).filter(a => a !== null) as Artist[];
            
            // Process promoters from the full event details
            const promoterObjects = (await Promise.all(
                (eventDetail.promoters || []).map((p: any) => fetchAndPreparePromoterDetails(p, processedPromoters))
            )).filter(p => p !== null) as Promoter[];

            // --- Prepare EventRa Object --- 
            const eventFormatted: EventRa = {
                id: crypto.randomUUID(), 
                ra_id: eventRaId,
                name: eventDetail.title,
                description: eventDetail.content || "",
                datePosted: eventDetail.datePosted || new Date().toISOString(),
                startTime: eventDetail.startTime,
                endTime: eventDetail.endTime, // This should now be available from full details
                image: eventDetail.flyerFront || eventDetail.images?.[0]?.filename,
                contentUrl: "https://ra.co" + eventDetail.contentUrl,
                venue: targetVenueObject.id,
                artists: artistObjects.map(a => a.id),
                promoters: promoterObjects.map(p => p.id),
            };
            
            // Verify we have required fields before adding to the list
            if (!eventFormatted.endTime) {
                console.warn(`Event ${eventRaId} (${eventDetail.title}) is missing endTime, using startTime + 6 hours as fallback`);
                // Create fallback endTime as startTime + 6 hours if missing
                if (eventFormatted.startTime) {
                    const startDate = new Date(eventFormatted.startTime);
                    startDate.setHours(startDate.getHours() + 6); // Default 6 hour event
                    eventFormatted.endTime = startDate.toISOString();
                } else {
                    console.warn(`Event ${eventRaId} also missing startTime, skipping`);
                    continue;
                }
            }
            
            processedEvents.push(eventFormatted);

        } catch (error) {
            console.error(`Failed to process event RA ID ${eventRaId}:`, error);
            // Continue to next event
        }
    } // End event processing loop

    console.log(`Finished processing. Returning ${processedEvents.length} events for venue ${venueRaId}.`);

    // Return all unique entities processed 
    return {
        events: processedEvents,
        artists: Array.from(processedArtists.values()),
        venues: Array.from(processedVenues.values()), // Now contains only the target venue
        promoters: Array.from(processedPromoters.values()),
    };
} 
// Shared Database Helper Functions

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { Database } from './supabase-types.d.ts';
import type { Artist, EventRa, Venue, Promoter, Mix } from './types.ts';
import { determineEventType } from './event-helpers.ts';

// Note: We no longer need to set updated_at fields as they're handled by DB triggers
interface UpsertResult {
    pages: { upserted: number, errors: number };
    venues: { upserted: number, errors: number };
    artists: { upserted: number, errors: number };
    promoters: { upserted: number, errors: number };
    events: { upserted: number, errors: number, newLinks: number };
    mixes: { upserted: number, errors: number };
}

/**
 * Upserts Pages (Venue, Artist, Promoter), their details, associated Mixes, and Events
 * based on the data fetched (e.g., from fetchAndProcessVenueEvents or scrape-area).
 * 
 * Note: updated_at fields are now handled automatically by database triggers.
 */
export async function upsertScrapedData(
    data: { venues: Venue[], artists: Artist[], promoters: Promoter[], events: EventRa[] },
    supabaseAdmin: SupabaseClient<Database>
): Promise<UpsertResult> {

    const results: UpsertResult = {
        pages: { upserted: 0, errors: 0 },
        venues: { upserted: 0, errors: 0 },
        artists: { upserted: 0, errors: 0 },
        promoters: { upserted: 0, errors: 0 },
        events: { upserted: 0, errors: 0, newLinks: 0 },
        mixes: { upserted: 0, errors: 0 },
    };

    const entityMaps = {
        venues: new Map<string, string>(), // Kigs Venue ID -> Kigs Page ID
        artists: new Map<string, string>(), // Kigs Artist ID -> Kigs Page ID
        promoters: new Map<string, string>(), // Kigs Promoter ID -> Kigs Page ID
    };

    // --- Upsert Venues (as Pages + Venue details) ---
    for (const v of data.venues) {
        // Upsert into pages WITHOUT specifying id
        const { data: pageData, error: pageError } = await supabaseAdmin
            .from('pages')
            .upsert({
                ra_id: v.ra_id,
                handle: v.handle,
                name: v.name,
                bio: v.bio,
                profile_picture: v.profile_picture,
                cover_picture: v.cover_picture,
                page_type: 'venue',
                home_city_id: v.home_city_id,
            }, { onConflict: 'ra_id', ignoreDuplicates: false })
            .select('id')
            .single();

        if (pageError) {
            console.error(`Error upserting page for venue ${v.name} (RA: ${v.ra_id}):`, pageError);
            results.pages.errors++;
            continue;
        }
        results.pages.upserted++;
        const dbPageId = pageData.id;
        entityMaps.venues.set(v.id, dbPageId); // Map Kigs Venue ID to Page ID

        const { error: venueDetailError } = await supabaseAdmin
            .from('venues')
            .upsert({
                id: dbPageId,
                latitude: v.latitude,
                longitude: v.longitude,
                capacity: v.capacity,
            }, { onConflict: 'id', ignoreDuplicates: false });

        if (venueDetailError) {
            console.error(`Error upserting details for venue ${v.name} (Page ID: ${dbPageId}):`, venueDetailError);
            results.venues.errors++;
        } else {
            results.venues.upserted++;
        }

        // Upsert Mixes for Venue
        if (v.lastTracks) {
            for (const track of v.lastTracks) {
                const { error: mixError } = await supabaseAdmin.from('mixes').upsert({
                    track_id: track.id.toString(), name: track.title, url: track.streamUrl,
                    cover_image: track.artworkUrl, venue_id: dbPageId, artist_id: null, promoter_id: null,
                }, { onConflict: 'track_id' });
                if (mixError) {
                    console.error(`Error upserting mix ${track.title} for venue ${v.name} (Page ID: ${dbPageId}):`, mixError);
                    results.mixes.errors++;
                } else {
                    results.mixes.upserted++;
                }
            }
        }
    }

    // --- Upsert Artists (as Pages) ---
    for (const a of data.artists) {
        // Log details before storing
        if (a.soundcloud || a.soundcloudUserID) {
            console.log(`About to store artist ${a.name} with soundcloud URL: ${a.soundcloud || 'none'}`);
            console.log(`About to store artist ${a.name} with soundcloudUserID: ${a.soundcloudUserID || 'none'}`);
        }
        
        const { data: pageData, error: pageError } = await supabaseAdmin
            .from('pages')
            .upsert({
                id: a.id,
                ra_id: a.raId,
                handle: a.handle,
                name: a.name,
                bio: a.bio,
                profile_picture: a.profile_picture,
                cover_picture: a.cover_picture,
                page_type: 'artist',
                // Upsert specific artist fields if they exist on the 'pages' table or a separate 'artists' table
                instagram: a.instagram,
                soundcloud: a.soundcloud,
                soundcloudUserID: a.soundcloudUserID,
                bandcamp: a.bandcamp,
                discogs: a.discogs,
                facebook: a.facebook,
                twitter: a.twitter,
                website: a.website,
            }, { onConflict: 'ra_id', ignoreDuplicates: false })
            .select('id')
            .single();

        if (pageError) {
            console.error(`Error upserting page for artist ${a.name} (ID: ${a.id}, RA: ${a.raId}):`, pageError);
            results.pages.errors++;
            results.artists.errors++; // Count error for artist processing too
            continue;
        }
        results.pages.upserted++;
        results.artists.upserted++; // Count success here for artist page
        const dbPageId = pageData.id;
        entityMaps.artists.set(a.id, dbPageId);

        // Verify data was stored correctly
        if (a.soundcloud || a.soundcloudUserID) {
            const { data: verifyData, error: verifyError } = await supabaseAdmin
                .from('pages')
                .select('soundcloud, soundcloudUserID')
                .eq('id', dbPageId)
                .single();
                
            if (verifyError) {
                console.error(`Error verifying soundcloud data for artist ${a.name} (ID: ${dbPageId}):`, verifyError);
            } else {
                console.log(`Verification - Artist ${a.name} stored with soundcloud: ${verifyData.soundcloud || 'none'}`);
                console.log(`Verification - Artist ${a.name} stored with soundcloudUserID: ${verifyData.soundcloudUserID || 'none'}`);
            }
        }

        // Upsert Mixes for Artist
        if (a.lastTracks) {
            for (const track of a.lastTracks) {
                const { error: mixError } = await supabaseAdmin.from('mixes').upsert({
                    track_id: track.id.toString(), name: track.title, url: track.streamUrl,
                    cover_image: track.artworkUrl, artist_id: dbPageId, venue_id: null, promoter_id: null,
                }, { onConflict: 'track_id' });
                 if (mixError) {
                     console.error(`Error upserting mix ${track.title} for artist ${a.name} (Page ID: ${dbPageId}):`, mixError);
                     results.mixes.errors++;
                 } else {
                     results.mixes.upserted++;
                 }
            }
        }
    }

    // --- Upsert Promoters (as Pages) ---
    for (const p of data.promoters) {
        const { data: pageData, error: pageError } = await supabaseAdmin
            .from('pages')
            .upsert({
                id: p.id,
                ra_id: p.raId,
                handle: p.handle,
                name: p.name,
                bio: p.bio,
                profile_picture: p.profile_picture,
                cover_picture: p.cover_picture,
                page_type: 'promoter',
            }, { onConflict: 'ra_id', ignoreDuplicates: false })
            .select('id')
            .single();

        if (pageError) {
            console.error(`Error upserting page for promoter ${p.name} (ID: ${p.id}, RA: ${p.raId}):`, pageError);
            results.pages.errors++;
            results.promoters.errors++;
            continue;
        }
        results.pages.upserted++;
        results.promoters.upserted++;
        const dbPageId = pageData.id;
        entityMaps.promoters.set(p.id, dbPageId);

        // Upsert Mixes for Promoter (if applicable)
        if (p.lastTracks) {
             for (const track of p.lastTracks) {
                const { error: mixError } = await supabaseAdmin.from('mixes').upsert({
                    track_id: track.id.toString(), name: track.title, url: track.streamUrl,
                    cover_image: track.artworkUrl, promoter_id: dbPageId, artist_id: null, venue_id: null,
                }, { onConflict: 'track_id' });
                if (mixError) {
                    console.error(`Error upserting mix ${track.title} for promoter ${p.name} (Page ID: ${dbPageId}):`, mixError);
                    results.mixes.errors++;
                } else {
                    results.mixes.upserted++;
                }
            }
        }
    }

    // --- Upsert Events and Links ---
    for (const e of data.events) {
        const eventType = determineEventType(e.startTime, e.endTime);
        const { data: eventData, error: eventError } = await supabaseAdmin
            .from('events') // Assuming table name is 'events'
            .upsert({
                id: e.id, // Use pre-generated Kigs ID
                ra_id: e.ra_id,
                name: e.name,
                description: e.description,
                visual: e.image,
                tickets_url: e.contentUrl,
                start_date: e.startTime,
                end_date: e.endTime,
                event_type: eventType,
                created_at: e.datePosted, // Should this be updated on conflict?
            }, { onConflict: 'ra_id', ignoreDuplicates: false })
            .select('id, updated_at, created_at') // Select created_at too
            .single();

        if (eventError) {
            console.error(`Error upserting event ${e.name} (ID: ${e.id}, RA: ${e.raId}):`, eventError);
            results.events.errors++;
            continue;
        }
        results.events.upserted++;

        const dbEventId = eventData.id;
        // Determine if it was truly a new insert vs an update
        const wasNewInsert = eventData.updated_at === null || eventData.updated_at === eventData.created_at;

        if (wasNewInsert) {
            console.log(`Inserted new event: ${e.name} (ID: ${dbEventId})`);
            let linksCreated = 0;

            // Link Venue
            if (e.venue) {
                const venuePageId = entityMaps.venues.get(e.venue);
                if (venuePageId) {
                    const { error: linkError } = await supabaseAdmin.from('event_venue').upsert({ event_id: dbEventId, venue_id: venuePageId }, { onConflict: 'event_id, venue_id'});
                    if (linkError) console.error(`Error linking venue ${venuePageId} to event ${dbEventId}:`, linkError); else linksCreated++;
                } else {
                    console.warn(`Could not find Page ID for Kigs Venue ID ${e.venue} to link event ${dbEventId}`);
                }
            }

            // Link Artists
            for (const artistId of e.artists) {
                const artistPageId = entityMaps.artists.get(artistId);
                if (artistPageId) {
                    const { error: linkError } = await supabaseAdmin.from('event_artist').upsert({ event_id: dbEventId, artist_id: artistPageId }, { onConflict: 'event_id, artist_id'});
                     if (linkError) console.error(`Error linking artist ${artistPageId} to event ${dbEventId}:`, linkError); else linksCreated++;
                } else {
                     console.warn(`Could not find Page ID for Kigs Artist ID ${artistId} to link event ${dbEventId}`);
                }
            }

            // Link Promoters
            for (const promoterId of e.promoters) {
                const promoterPageId = entityMaps.promoters.get(promoterId);
                if (promoterPageId) {
                    const { error: linkError } = await supabaseAdmin.from('event_promoter').upsert({ event_id: dbEventId, promoter_id: promoterPageId }, { onConflict: 'event_id, promoter_id'});
                    if (linkError) console.error(`Error linking promoter ${promoterPageId} to event ${dbEventId}:`, linkError); else linksCreated++;
                } else {
                    console.warn(`Could not find Page ID for Kigs Promoter ID ${promoterId} to link event ${dbEventId}`);
                }
            }
            results.events.newLinks += linksCreated;
            // TODO: Implement Post creation logic if needed here
        } else {
            console.log(`Updated existing event: ${e.name} (ID: ${dbEventId})`);
            // Optionally: Update links even for existing events if needed, although potentially expensive.
        }
    }

    console.log("Database upsert summary:", results);
    return results;
} 
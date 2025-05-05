/// <reference types="https://esm.sh/@supabase/functions-js/src/edge-runtime.d.ts" />
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import type { Database } from '../_shared/supabase-types.d.ts';
import { sendSlackNotification } from '../_shared/slack-client.ts';

console.log("clear-db function booting up");

// WARNING: Destructive operation. Secure this endpoint properly.
// TODO: Add security check (e.g., check Authorization header for a secret key/token)

async function batchDelete(supabaseAdmin: ReturnType<typeof createClient>, tableName: string, match: object = {}) {
    console.log(`Clearing table: ${tableName} (matching ${JSON.stringify(match)})`);
    let deletedCountTotal = 0;
    const BATCH_SIZE = 100; // Adjust batch size as needed

    // eslint-disable-next-line no-constant-condition
    while (true) {
        try {
             // Select IDs to delete first to avoid large IN clauses if deleting many rows
             const { data: idsToDelete, error: selectError } = await supabaseAdmin
                .from(tableName)
                .select('id')
                .match(match)
                .limit(BATCH_SIZE);

            if (selectError) {
                 console.error(`Error selecting IDs from ${tableName}:`, selectError);
                throw selectError;
            }

             if (!idsToDelete || idsToDelete.length === 0) {
                 console.log(`No more rows to delete in ${tableName}.`);
                 break; // No more rows found
             }

             const idList = idsToDelete.map(row => row.id);
             console.log(`Attempting to delete ${idList.length} rows from ${tableName}...`);

             const { count: deletedInBatch, error: deleteError } = await supabaseAdmin
                .from(tableName)
                .delete({ count: 'exact' }) // Get count of deleted rows
                .in('id', idList); // Delete by the fetched IDs

            if (deleteError) {
                console.error(`Error in batch deletion of ${tableName}:`, deleteError);
                throw deleteError; // Stop if a batch fails
            }

            const actualDeletedCount = deletedInBatch ?? 0;
            deletedCountTotal += actualDeletedCount;
            console.log(`Deleted ${actualDeletedCount} rows from ${tableName} in this batch. Total deleted: ${deletedCountTotal}`);

            if (actualDeletedCount < idList.length) {
                 console.warn(`Expected to delete ${idList.length} but only deleted ${actualDeletedCount}. Potential leftover rows or concurrent modification?`);
                 // Depending on requirements, you might want to break or retry here.
                 // For safety, we break to avoid infinite loops in weird states.
                 break;
            }

            if (actualDeletedCount < BATCH_SIZE) {
                console.log(`Deleted less than batch size (${actualDeletedCount} < ${BATCH_SIZE}), assuming finished for ${tableName}.`);
                break; // Finished if we deleted less than the batch size
            }

        } catch (error) {
             console.error(`An unexpected error occurred during batch deletion for ${tableName}:`, error);
             throw error; // Propagate the error up
        }
    }
    console.log(`Finished clearing table: ${tableName}. Total deleted: ${deletedCountTotal}`);
    return deletedCountTotal;
}


serve(async (req) => {
    console.log("clear-db invoked");
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }
     // Require POST for destructive actions
     if (req.method !== 'POST') {
         return new Response(JSON.stringify({ error: 'Method Not Allowed. Use POST.' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 405,
        });
    }

    // --- TODO: Add Security Check Here ---
    // Example: Check for a secret in headers or body
    // const authHeader = req.headers.get('Authorization');
    // if (authHeader !== `Bearer ${Deno.env.get('CLEAR_DB_SECRET')}`) {
    //     console.warn("Unauthorized clear-db attempt.");
    //     return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    // }
    console.warn("Security check for clear-db is currently disabled! Endpoint is unprotected.");
    // --- End Security Check ---


    try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        if (!supabaseUrl || !supabaseServiceRoleKey) {
            throw new Error("Missing Supabase environment variables");
        }
        const supabaseAdmin = createClient<Database>(supabaseUrl, supabaseServiceRoleKey);

        console.log("--- STARTING DATABASE CLEAR ---");

        // Deletion Order (Respecting potential FKs):
        // 1. Link Tables
        await batchDelete(supabaseAdmin, 'event_artist');
        await batchDelete(supabaseAdmin, 'event_venue');
        await batchDelete(supabaseAdmin, 'event_promoter');

        // 2. Discussions (if they link to events/pages)
        await batchDelete(supabaseAdmin, 'discussions'); // Assuming 'discussions' table exists

        // 3. Mixes (if they link to pages)
        await batchDelete(supabaseAdmin, 'mixes'); // Assuming 'mixes' table exists

        // 4. Events
        await batchDelete(supabaseAdmin, 'events');

        // 5. Venue Details (if 'venues' links to 'pages')
        await batchDelete(supabaseAdmin, 'venues'); // Assuming 'venues' table exists

        // 6. Pages (excluding 'personal' type)
        await batchDelete(supabaseAdmin, 'pages', { page_type: 'venue' });
        await batchDelete(supabaseAdmin, 'pages', { page_type: 'artist' });
        await batchDelete(supabaseAdmin, 'pages', { page_type: 'promoter' });
        // Or delete all non-personal in one go if constraints allow:
        // await batchDelete(supabaseAdmin, 'pages', { 'page_type:neq': 'personal' }); - Check syntax if needed


        const message = "Database cleared of non-personal pages, venues, events, mixes, discussions, and associated links.";
        console.log("--- DATABASE CLEAR COMPLETE ---");
        await sendSlackNotification(message, 'SLACK_WEBHOOK_URL'); // Notify on success

        return new Response(JSON.stringify({ message: message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        });

    } catch (error) {
        console.error("Error during clear-db execution:", error);
        await sendSlackNotification(`Error during clear-db: ${error.message}`, 'SLACK_WEBHOOK_URL', true); // Notify on failure
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500,
        });
    }
}); 
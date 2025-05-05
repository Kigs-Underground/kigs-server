/// <reference types="https://esm.sh/@supabase/functions-js/src/edge-runtime.d.ts" />
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import type { Database } from '../_shared/supabase-types.d.ts';
import { sendSlackNotification } from '../_shared/slack-client.ts';

console.log("trigger-city-scrape function booting up");

// TODO: Secure this endpoint, e.g., check Authorization header for a secret key

serve(async (req) => {
    console.log("trigger-city-scrape invoked");
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }
    if (req.method !== 'POST') {
         return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 405,
        });
    }

    try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        if (!supabaseUrl || !supabaseServiceRoleKey) {
            throw new Error("Missing Supabase environment variables");
        }
        const supabaseAdmin = createClient<Database>(supabaseUrl, supabaseServiceRoleKey);

        // --- Fetch active cities/areas --- 
        // Assuming a table 'cities' with 'ra_area_id' and 'is_active' columns
        console.log("Fetching active cities...");
        const { data: cities, error: cityError } = await supabaseAdmin
            .from('cities')
            .select('name, ra_area_id') // Select the RA area ID
            .eq('is_active', true);

        if (cityError) {
            throw new Error(`Error fetching cities: ${cityError.message}`);
        }

        if (!cities || cities.length === 0) {
            console.log("No active cities found to scrape.");
            return new Response(JSON.stringify({ message: "No active cities found." }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200,
            });
        }

        console.log(`Found ${cities.length} active cities. Triggering scrape tasks...`);

        // --- Asynchronously invoke scrape-area for each city --- 
        const invocationPromises = cities.map(city => {
            const areaId = city.ra_area_id;
            if (typeof areaId !== 'number') {
                console.warn(`Skipping city ${city.name}: Invalid or missing ra_area_id (${areaId})`);
                return Promise.resolve({ status: 'skipped', areaId: areaId, name: city.name }); // Resolve promise for skipped items
            }

            console.log(`Invoking scrape-area for ${city.name} (Area ID: ${areaId})`);
            // Invoke the function asynchronously. 
            // IMPORTANT: Functions need to be deployed, and invoking requires auth.
            // Using service_role key for auth between functions.
            return supabaseAdmin.functions.invoke('scrape-area', { // Function name matches directory name
                body: { areaId: areaId },
                 headers: {
                     'Authorization': `Bearer ${supabaseServiceRoleKey}`
                 }
            })
            .then(({ data, error }) => {
                if (error) {
                    console.error(`Error invoking scrape-area for Area ${areaId}:`, error);
                    return { status: 'error', areaId: areaId, name: city.name, error: error.message };
                }
                console.log(`Invocation successful for Area ${areaId}:`, data);
                return { status: 'invoked', areaId: areaId, name: city.name };
            })
            .catch(invokeError => {
                 console.error(`Unhandled error invoking scrape-area for Area ${areaId}:`, invokeError);
                 return { status: 'error', areaId: areaId, name: city.name, error: invokeError.message };
            });
        });

        // Wait for all invocations to be initiated (don't wait for completion)
        const results = await Promise.all(invocationPromises);
        const invokedCount = results.filter(r => r.status === 'invoked').length;
        const errorCount = results.filter(r => r.status === 'error').length;
        const skippedCount = results.filter(r => r.status === 'skipped').length;

        const responseMessage = `Triggered scraping for ${invokedCount}/${cities.length} active cities. Errors: ${errorCount}, Skipped: ${skippedCount}.`;
        console.log(responseMessage);

        await sendSlackNotification(responseMessage, 'SLACK_WEBHOOK_URL');

        return new Response(JSON.stringify({ message: responseMessage, details: results }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 202, // Accepted - tasks are running in the background
        });

    } catch (error) {
        console.error("Error in trigger-city-scrape:", error);
        await sendSlackNotification(`Error in trigger-city-scrape: ${error.message}`, 'SLACK_WEBHOOK_URL', true);
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500,
        });
    }
}); 
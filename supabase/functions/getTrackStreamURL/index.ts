import { serve } from 'https://deno.land/x/sift/mod.ts';
import { getTrackStreamURL } from '../_shared/soundcloud-api.ts';
import { corsHeaders } from '../_shared/cors.ts'

// SOUNDCLOUD_API_URL is now used within getTrackStreamURL in soundcloud-api.ts
// const SOUNDCLOUD_API_URL = 'https://api.soundcloud.com'; 

Deno.serve(async (req) => {
  // This is needed if you're planning to invoke your function from a browser.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'GET') {
    return new Response('Only GET method is allowed', { status: 405 });
  }

  const url = new URL(req.url);
  const track_id = url.searchParams.get('track_id');

  if (!track_id) {
    console.log("Missing track_id parameter")
    return new Response(JSON.stringify({ error: 'Missing track_id parameter' }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400 
    });
  }

  // console.log("Getting track stream URLs: " + track_id) // Logging is now in the shared function

  try {
    // Call the new function from soundcloud-api.ts
    const tracksData = await getTrackStreamURL(track_id);

    // console.log("Fetched Track Stream URLs: " + JSON.stringify(tracksData)) // Logging is now in the shared function

    return new Response(JSON.stringify(tracksData), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
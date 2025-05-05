import { serve } from 'https://deno.land/x/sift/mod.ts';
import { getAccessToken } from '../_shared/soundcloud-api.ts';
import { corsHeaders } from '../_shared/cors.ts'

const SOUNDCLOUD_API_URL = 'https://api.soundcloud.com';

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

  // if (!user_id) {
  //   console.log("Missing user_id parameter")
  //   return new Response('Missing user_id parameter', { status: 400 });
  // }

  console.log("Getting track stream URLs: " + track_id)

  try {
    const accessToken = await getAccessToken();

    // Use the search endpoint to find tracks by username
    const streamURLResponse = await fetch(
      `${SOUNDCLOUD_API_URL}/tracks/${track_id}/streams`,
      {
        headers: {
          'Authorization': `OAuth ${accessToken}`,
        },
      }
    );

    // const streamURLResponse = await fetch(
    //   `https://api.soundcloud.com/tracks/1379998423/stream`,
    //   {
    //     headers: {
    //       'Authorization': `OAuth ${accessToken}`,
    //     },
    //   }
    // );

    
    if (!streamURLResponse.ok) {
      throw new Error(`Failed to fetch tracks: ${streamURLResponse.statusText}`);
    }

    const tracksData = await streamURLResponse.json();

    console.log("Fetched Track Stream URLs: " + JSON.stringify(tracksData))


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
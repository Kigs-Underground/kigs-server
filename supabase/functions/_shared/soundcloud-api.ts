// Placeholder for SoundCloud API interactions using Deno's fetch

import { Mix } from './types.ts';

// Assume SOUNDCLOUD_API_URL and necessary credentials (like access token generation)
// are handled via Deno.env.get()
const SOUNDCLOUD_API_URL = Deno.env.get('SOUNDCLOUD_API_URL') || 'https://api.soundcloud.com';
const SOUNDCLOUD_CLIENT_ID = Deno.env.get('SOUNDCLOUD_CLIENT_ID');
const SOUNDCLOUD_CLIENT_SECRET = Deno.env.get('SOUNDCLOUD_CLIENT_SECRET');
const SOUNDCLOUD_TOKEN_URL = "https://secure.soundcloud.com/oauth/token";

let SOUNDCLOUD_ACCESS_TOKEN = "";
// let SOUNDCLOUD_REFRESH_TOKEN = ""; // Refresh token logic might be needed later if using user auth, but not for client_credentials

type AccessTokenResponse = {
  access_token: string;
  // refresh_token: string; // Not used with client_credentials
};

let accessTokenPromise: Promise<string> | undefined;

// Function to get or refresh the token if necessary
async function getAccessToken(): Promise<string | null> {
    if (!SOUNDCLOUD_CLIENT_ID || !SOUNDCLOUD_CLIENT_SECRET) {
        console.error("Missing SoundCloud Client ID or Secret in environment variables.");
        return null;
    }

    if (accessTokenPromise) {
        console.log("Returned existing promise to get token");
        return accessTokenPromise;
    }

    accessTokenPromise = new Promise<string>(async (resolve, reject) => {
        console.log("Building Promise to get token");
        if (SOUNDCLOUD_ACCESS_TOKEN) {
            console.log("Already had a token");
            resolve(SOUNDCLOUD_ACCESS_TOKEN);
            // TODO: Check token validity/expiry before resolving immediately
        } else {
            console.log("Fetching new SoundCloud access token");
            const body = new URLSearchParams({
                grant_type: "client_credentials",
            });

            const clientCredentials = `${SOUNDCLOUD_CLIENT_ID}:${SOUNDCLOUD_CLIENT_SECRET}`;
            // Use Deno's standard library for Base64 encoding
            const encodedCredentials = btoa(clientCredentials);

            try {
                const response = await fetch(SOUNDCLOUD_TOKEN_URL, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded",
                        "Authorization": `Basic ${encodedCredentials}`,
                    },
                    body,
                });

                if (!response.ok) {
                     const errorText = await response.text();
                    throw new Error(`Failed to obtain access token. Status: ${response.status} - ${response.statusText} - ${errorText}`);
                }

                const data = (await response.json()) as AccessTokenResponse;
                SOUNDCLOUD_ACCESS_TOKEN = data.access_token;
                console.log("Got new SoundCloud access token.");
                // SOUNDCLOUD_REFRESH_TOKEN = data.refresh_token; // Not applicable here
                resolve(SOUNDCLOUD_ACCESS_TOKEN);
            } catch (error) {
                console.error("Error fetching SoundCloud access token:", error);
                accessTokenPromise = undefined; // Reset promise on error
                reject(error);
            } finally {
                 // Clear promise after resolution/rejection to allow retries if needed
                 // Or implement a mechanism to reuse the promise for a certain duration
                // setTimeout(() => { accessTokenPromise = undefined; }, 3500 * 1000); // Example: Clear after ~1 hour
            }
        }
    }).finally(() => {
        // Ensure promise is cleared once settled (successfully or with error)
        // This allows subsequent calls to retry if the first one failed.
        // A more robust solution would handle token expiry time.
       // accessTokenPromise = undefined; // Consider token expiry instead of immediate clear
    });

    return accessTokenPromise;
}

export async function getSoundcloudUserID(profileUrl?: string): Promise<string | null> {
    if (!profileUrl) return null;

    const accessToken = await getAccessToken();
    if (!accessToken) {
        console.error("Failed to get SoundCloud Access Token. Cannot resolve user ID.");
        return null;
    }

    const strippedUrl = profileUrl.replace(/^(https?:\/\/)www\./i, "$1");
    const params = new URLSearchParams({ url: encodeURI(strippedUrl) });
    const urlToFetch = `${SOUNDCLOUD_API_URL}/resolve?${params.toString()}`;
    console.log(`Fetching SoundCloud user ID for URL: ${urlToFetch}`);

    try {
        const response = await fetch(urlToFetch, {
            headers: {
                // Use the obtained OAuth token
                'Authorization': `OAuth ${accessToken}`,
            },
        });

        if (!response.ok) {
            throw new Error(`SoundCloud API error: ${response.status} ${await response.text()}`);
        }

        const data = await response.json();
        const userId = data?.id;
        if (!userId) {
             console.error("Could not resolve SoundCloud URL to user ID:", profileUrl);
             return null;
        }
        console.log(`Found SoundCloud user ID: ${userId}`);
        return userId.toString();
    } catch (error) {
        console.error(`Error fetching SoundCloud user ID for ${strippedUrl}:`, error);
        return null;
    }
}

export async function getSoundcloudTracks(userId: string): Promise<Mix[]> {
    if (!userId) return [];

    const accessToken = await getAccessToken();
     if (!accessToken) {
        console.error("Failed to get SoundCloud Access Token. Cannot fetch tracks.");
        return [];
    }

    console.log(`Fetching SoundCloud tracks for user ID: ${userId}`);
    const urlToFetch = `${SOUNDCLOUD_API_URL}/users/${userId}/tracks?limit=10`; // Keep limit reasonable

    try {
         const response = await fetch(urlToFetch, {
            headers: {
                 'Authorization': `OAuth ${accessToken}`,
            },
        });

        if (!response.ok) {
            throw new Error(`SoundCloud API error: ${response.status} ${await response.text()}`);
        }

        const tracksData = await response.json();
        console.log(`Fetched SoundCloud tracks for user ID: ${userId}`);

        const mixes: Mix[] = tracksData.map((track: any) => ({
            id: track.id,
            title: track.title,
            genre: track.genre,
            duration: track.duration,
            createdAt: track.created_at,
            permalinkUrl: track.permalink_url,
            streamUrl: track.stream_url,
            artworkUrl: track.artwork_url,
            playbackCount: track.playback_count,
            // Ensure the Mix type in ./types.ts matches these fields
        }));

        console.log(`Processed ${mixes.length} tracks`);
        return mixes;

    } catch (error) {
        console.error(`Error fetching SoundCloud tracks for user ID ${userId}:`, error);
        return [];
    }
} 
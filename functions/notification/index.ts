// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "https://esm.sh/@supabase/functions-js/src/edge-runtime.d.ts"

import { Expo } from "https://esm.sh/expo-server-sdk@4.9.0";

// Create a new Expo SDK client
const expo = new Expo();

console.log("Hello from Functions!")

interface NotificationPayload {
  expoPushToken: string;
  message: string;
}

async function sendNotification(expoPushToken: string, message: string) {
  // Create the messages that you want to send to clients
  const messages = [];
  if (!Expo.isExpoPushToken(expoPushToken)) {
    throw new Error(`Push token ${expoPushToken} is not a valid Expo push token`);
  }

  messages.push({
    to: expoPushToken,
    sound: "default",
    body: message,
    data: { message },
  });

  const chunks = expo.chunkPushNotifications(messages);
  const tickets = [];

  for (const chunk of chunks) {
    try {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...ticketChunk);
    } catch (error) {
      console.error(error);
    }
  }

  return tickets;
}

Deno.serve(async (req) => {
  if (req.method === "POST") {
    const { expoPushToken, message } = await req.json() as NotificationPayload;

    if (!expoPushToken || !message) {
      return new Response(JSON.stringify({ error: "Missing expoPushToken or message" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const result = await sendNotification(expoPushToken, message);
      return new Response(JSON.stringify({ success: true, result }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: "Failed to send notification", details: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  } else {
    return new Response(JSON.stringify({ error: "Invalid request method" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }
})

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/notification' \
    --header 'Authorization: Bearer YOUR_SUPABASE_ANON_KEY' \
    --header 'Content-Type: application/json' \
    --data '{"expoPushToken":"ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]","message":"Hello, this is a test notification!"}'

*/
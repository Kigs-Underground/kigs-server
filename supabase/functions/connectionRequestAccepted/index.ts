import { createClient } from 'jsr:@supabase/supabase-js@2'
import { Expo } from 'npm:expo-server-sdk'

console.log('Connection Request Accepted Event Triggered')

interface Notification {
  id: string
  user_id: string
  body: string
}

interface WebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE'
  table: string
  record: Notification
  schema: 'public'
  old_record: null | Notification
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

Deno.serve(async (req) => {
    const payload: WebhookPayload = await req.json()

    console.log('Status: ' + payload.record.status)
    if (payload.record.status !== 'accepted') {
        console.log('Not an accepted event, skipping')
        return new Response('Not an accepted event', { status: 200 })
    }

    // Get requested's page details to inject his name in the notification
    const { data: requestedPage } = await supabase
        .from('pages')
        .select('name')
        .eq('id', payload.record.requested_page_id)
        .single()

    console.log('Looking for users of page: ' + payload.record.requester_page_id)

    const { data: pageUsers } = await supabase
        .from('user_page')
        .select('user_id')
        .eq('page_id', payload.record.requester_page_id)
    
    console.log('Users associated with this page:', pageUsers?.map(user => user.user_id))

    // Get push tokens for all users
    const userTokens = []
    for (const user of pageUsers || []) {
        const { data: pushToken } = await supabase
            .from('users_expo_push_tokens')
            .select('expo_push_token')
            .eq('user_id', user.user_id)
            .single()
        
        if (pushToken?.expo_push_token) {
            userTokens.push(pushToken.expo_push_token)
        }
    }

    console.log('Found expo tokens for users:', userTokens)

    // Create a new Expo SDK client
    const expo = new Expo({ accessToken: Deno.env.get('EXPO_ACCESS_TOKEN') })

    // Create the messages that you want to send to clients
    const messages = userTokens.map(token => {
        // Check that all your push tokens appear to be valid Expo push tokens
        if (!Expo.isExpoPushToken(token)) {
            console.error(`Push token ${token} is not a valid Expo push token`);
            return null;
        }

        return {
            to: token,
            sound: 'default',
            title: "You're connected! 🤝",
            body: `${requestedPage?.name || 'Someone'} has accepted your connection request`,
        }
    }).filter(Boolean); // Remove null messages

    try {
        const chunks = expo.chunkPushNotifications(messages);
        const tickets = [];

        // Send the chunks to the Expo push notification service
        for (let chunk of chunks) {
            try {
                const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
                console.log('Notification tickets:', ticketChunk);
                tickets.push(...ticketChunk);
            } catch (error) {
                console.error('Error sending chunk:', error);
            }
        }

        return new Response(JSON.stringify({ tickets }), {
            headers: { 'Content-Type': 'application/json' },
        })
    } catch (error) {
        console.error('Error sending notifications:', error);
        return new Response(JSON.stringify({ error: 'Failed to send notifications' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        })
    }
})
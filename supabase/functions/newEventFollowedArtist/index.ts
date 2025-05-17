import { createClient } from 'jsr:@supabase/supabase-js@2'
import { Expo } from 'npm:expo-server-sdk'

console.log('New Event From Followed Promoter Triggered')

interface EventPromoter {
  event_id: string
  artist_id: string
}

interface WebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE'
  table: string
  record: EventArtist
  schema: 'public'
  old_record: null | EventArtist
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

Deno.serve(async (req) => {
    console.log('Webhook received')
    const payload: WebhookPayload = await req.json()
    console.log('Payload:', JSON.stringify(payload))
    
    if (payload.type !== 'INSERT') {
        console.log('Not an insert event, skipping')
        return new Response('Not an insert event', { status: 200 })
    }

    const { event_id, artist_id } = payload.record
    console.log('Processing event_artist - Event:', event_id, 'Artist:', artist_id)
    
    // Get event details
    // Get event details and promoter page name
    console.log('Fetching event and artist details')
    const [{ data: event }, { data: artistPage }] = await Promise.all([
    supabase
        .from('events')
        .select('name')
        .eq('id', event_id)
        .single(),
    supabase
        .from('pages')
        .select('name')
        .eq('id', artist_id)
        .single()
    ])

    if (!event) {
        console.log('Event not found, exiting')
        return new Response('Event not found', { status: 200 })
    }
    if (!artistPage) {
        console.log('Artist page not found, exiting')
        return new Response('Promoter page not found', { status: 200 })
    }
    console.log('Found event:', event.name)
    console.log('Found artist:', artistPage.name)

    // Get all followers of this promoter
    console.log('Fetching followers for artist:', artist_id)
    const { data: followers } = await supabase
        .from('followers')
        .select('follower_page_id')
        .eq('followed_page_id', artist_id)

    console.log('Found followers:', followers)

    if (!followers?.length) {
        console.log('No followers found, exiting')
        return new Response('No followers to notify', { status: 200 })
    }

    // Get all users associated with follower pages
    console.log('Fetching users for follower pages')
    const { data: pageUsers } = await supabase
        .from('user_page')
        .select('user_id')
        .in('page_id', followers.map(f => f.follower_page_id))

    console.log('Found page users:', pageUsers)

    if (!pageUsers?.length) {
        console.log('No users associated with follower pages, exiting')
        return new Response('No users associated with follower pages', { status: 200 })
    }

    // Get push tokens for all users
    console.log('Fetching push tokens for users')
    const userTokens = []
    for (const user of pageUsers) {
        console.log('Fetching token for user:', user.user_id)
        const { data: pushToken } = await supabase
            .from('users_expo_push_tokens')
            .select('expo_push_token')
            .eq('user_id', user.user_id)
            .single()
        
        if (pushToken?.expo_push_token) {
            userTokens.push(pushToken.expo_push_token)
            console.log('Found valid token for user:', user.user_id)
        } else {
            console.log('No valid token found for user:', user.user_id)
        }
    }

    console.log('Total valid push tokens found:', userTokens.length)

    if (!userTokens.length) {
        console.log('No push tokens found, exiting')
        return new Response('No push tokens found', { status: 200 })
    }

    // Create a new Expo SDK client
    console.log('Initializing Expo client')
    const expo = new Expo({ accessToken: Deno.env.get('EXPO_ACCESS_TOKEN') })

    // Create the messages for the new event
    console.log('Creating notification messages')
    const messages = userTokens.map(token => {
        if (!Expo.isExpoPushToken(token)) {
            console.error(`Push token ${token} is not a valid Expo push token`)
            return null
        }

        return {
            to: token,
            sound: 'default',
            title: `Just announced from ${artistPage.name}`,
            body: `${event.name}`,
        }
    }).filter(Boolean)

    console.log('Created messages:', messages.length)

    try {
        console.log('Chunking notifications')
        const chunks = expo.chunkPushNotifications(messages)
        const tickets = []

        console.log('Sending notification chunks')
        for (let chunk of chunks) {
            try {
                const ticketChunk = await expo.sendPushNotificationsAsync(chunk)
                console.log('Notification chunk sent successfully:', ticketChunk)
                tickets.push(...ticketChunk)
            } catch (error) {
                console.error('Error sending chunk:', error)
            }
        }

        console.log('All notifications processed')
        return new Response(JSON.stringify({ tickets }), {
            headers: { 'Content-Type': 'application/json' },
        })
    } catch (error) {
        console.error('Error sending notifications:', error)
        return new Response(JSON.stringify({ error: 'Failed to send notifications' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        })
    }
})
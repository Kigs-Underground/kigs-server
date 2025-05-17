import { createClient } from 'jsr:@supabase/supabase-js@2'
import { Expo } from 'npm:expo-server-sdk'

console.log('New Event From Followed Promoter Triggered')

interface DiscussionParticipant {
  discussion_id: string
  participant_page_id: string
}

interface WebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE'
  table: string
  record: DiscussionParticipant
  schema: 'public'
  old_record: null | DiscussionParticipant
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

    const { discussion_id, participant_page_id } = payload.record
    console.log('Processing discussion_page - Discussion:', discussion_id, 'Participant:', participant_page_id)
    
    // Get event details
    // Get event details and promoter page name
    console.log('Fetching discussion and participant details')
    const { data: discussion } = await supabase
        .from('discussions_with_events')
        .select()
        .eq('discussion_id', discussion_id)
        .single()

    if (!discussion.event_name) {
        console.log('Discussion\'s Event Name not found, exiting')
        return new Response('Discussion\'s Event Name not found', { status: 200 })
    }
    if (!discussion.page_name) {
        console.log('Group Chat Creator page not found, exiting')
        return new Response('Group Chat Creator page not found', { status: 200 })
    }
    console.log('Found discussion\'s event name:', discussion.event_name)
    console.log('Found participant:', discussion.page_name)

    // Get all users associated with follower pages
    console.log('Fetching users for participantPage: ' + participant_page_id)
    const { data: pageUsers } = await supabase
        .from('user_page')
        .select('user_id')
        .eq('page_id', participant_page_id)

    console.log('Found page users:', pageUsers)

    if (!pageUsers?.length) {
        console.log('No users associated with participantPage, exiting')
        return new Response('No users associated with participantPage', { status: 200 })
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
            title: `${discussion.page_name}`,
            body: `Has added you to an event group chat for: ${discussion.event_name}`,
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
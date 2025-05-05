import { createClient } from 'jsr:@supabase/supabase-js@2'
import { Expo } from 'npm:expo-server-sdk'

console.log('New Message Event Triggered')

interface Message {
  id: string
  text: string
  discussion_id: string
  sender_page_id: string
  created_at: string
}

interface WebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE'
  table: string
  record: Message
  schema: 'public'
  old_record: null | Message
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

Deno.serve(async (req) => {
    const payload: WebhookPayload = await req.json()
    
    // Get author's name
    const { data: author } = await supabase
        .from('pages')
        .select('name')
        .eq('id', payload.record.sender_page_id)
        .single()

    console.log("Discussion ID: " + payload.record.discussion_id)
    console.log("sender_page_id: " + payload.record.sender_page_id)

    // Get all participants except the author
    const { data: participants } = await supabase
        .from('discussion_page')
        .select('participant_page_id')
        .eq('discussion_id', payload.record.discussion_id)
        .neq('participant_page_id', payload.record.sender_page_id)
    
    console.log('Full participants data:', JSON.stringify(participants, null, 2))
    console.log('Participants IDs to notify:', participants?.map(p => p.participant_page_id))

    // Get all users associated with participant pages in one query
    const { data: pageUsers } = await supabase
        .from('user_page')
        .select('user_id')
        .in('page_id', participants?.map(p => p.participant_page_id))
    
    console.log('Users associated with participant pages:', pageUsers?.map(user => user.user_id))

    // Get push tokens for all participants
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
        if (!Expo.isExpoPushToken(token)) {
            console.error(`Push token ${token} is not a valid Expo push token`);
            return null;
        }

        return {
            to: token,
            sound: 'default',
            title: "New Message",
            body: `${author?.name || 'Someone'} sent you a message`,
        }
    }).filter(Boolean);

    try {
        const chunks = expo.chunkPushNotifications(messages);
        const tickets = [];

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

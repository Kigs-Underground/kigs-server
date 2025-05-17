// Shared helper functions for sending messages to Slack

/**
 * Sends a notification message to the Slack webhook URL defined in the environment.
 * Reads the `SLACK_WEBHOOK_URL` environment variable directly.
 * @param message The core message content.
 * @param isError Optional flag to prepend an error emoji/prefix.
 */
export async function sendSlackNotification(
    message: string,
    isError: boolean = false
) {
    const webhookUrl = Deno.env.get('SLACK_WEBHOOK_URL');
    if (!webhookUrl) {
        console.error(`SLACK_WEBHOOK_URL environment variable not set. Cannot send Slack notification.`);
        return false;
    }

    const prefix = isError ? '🚨 Error: ' : '';
    const payload = { text: `${prefix}${message}` };

    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            console.error(`Error sending Slack notification: ${response.status} ${await response.text()}`);
            return false;
        }
        return true;
    } catch (e) {
        console.error(`Error sending Slack notification:`, e);
        return false;
    }
} 
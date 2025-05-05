// Shared helper functions related to event data

export const determineEventType = (startTime: string, endTime: string): string => {
    try {
        const start = new Date(startTime);
        const end = new Date(endTime);
        // Use UTC hours for consistency in serverless environments
        const startHour = start.getUTCHours();
        const endHour = end.getUTCHours();
        const durationHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);

        // Logic copied from crawl-next-venue/index.ts (adjust thresholds as needed)
        if (durationHours >= 24) { return 'Festival'; }
        if (startHour >= 12 && startHour < 18 && (end.getUTCDate() > start.getUTCDate() || durationHours > 8) && endHour >= 3) { return 'Day Into Night'; }
        if (((startHour >= 21 && startHour <= 23) || startHour <= 1) && endHour >= 3 && endHour <= 9) { return 'Club Night'; }
        if (startHour >= 17 && startHour < 22 && (endHour >= 22 || endHour <= 3)) { return 'Early Night'; }
        if (startHour >= 12 && startHour < 18 && (endHour >= 17 || endHour <= 1)) { return 'Day Party'; }
        if (startHour >= 4 && startHour < 11) { return 'Afters'; }

    } catch (e) {
        console.error("Error determining event type:", e);
        // Fallback to Unknown in case of date parsing errors or unexpected values
    }
    return 'Unknown';
}; 
// Shared type definitions moved from src/model.ts

export interface Mix {
    id: number;
    title: string;
    genre?: string | null; // Make optional/nullable based on usage
    duration?: number; // Make optional/nullable based on usage
    createdAt?: string; // Make optional/nullable based on usage
    permalinkUrl?: string; // Make optional/nullable based on usage
    streamUrl: string;
    artworkUrl: string | null;
    playbackCount?: number; // Make optional/nullable based on usage
}

export interface EventRa {
    id: string; // Kigs ID (UUID)
    raId: string; // RA Event ID
    name: string;
    datePosted: string; // From RA
    startTime: string;
    endTime: string;
    description: string;
    image?: string;
    contentUrl: string;
    artists: string[]; // Array of Kigs Artist Page IDs (UUIDs)
    venue?: string; // Kigs Venue Page ID (UUID)
    promoters: string[]; // Array of Kigs Promoter Page IDs (UUIDs)
}

// Represents a Page (Artist, Venue, or Promoter) in the DB
export interface Page {
    id: string; // Kigs ID (UUID)
    raId: string; // RA ID
    name: string;
    handle: string; // slug
    page_type: 'artist' | 'venue' | 'promoter';
    bio?: string | null;
    profile_picture?: string | null;
    cover_picture?: string | null;
    home_city_id?: string | null; // Foreign key to cities table
    // Add other common fields if necessary
}

// Specific details extending Page
export interface Artist extends Page {
    page_type: 'artist';
    lastTracks?: Mix[];
    // Add other specific artist fields: instagram, soundcloud etc.
    instagram?: string | null;
    soundcloud?: string | null;
    soundcloudUserID?: string | null;
    bandcamp?: string | null;
    discogs?: string | null;
    facebook?: string | null;
    twitter?: string | null;
    website?: string | null;
}

export interface Venue extends Page {
    page_type: 'venue';
    latitude: number;
    longitude: number;
    capacity?: number | null;
    lastTracks?: Mix[];
    // Add other specific venue fields
}

export interface Promoter extends Page {
    page_type: 'promoter';
    lastTracks?: Mix[];
    // Add other specific promoter fields
}

// Note: Removed Area interface as it seemed related to the old city-based crawl 
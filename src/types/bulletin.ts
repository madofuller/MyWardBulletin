import type { SongType } from '../lib/songService';

export interface AnnouncementImage {
  imageId: string;
  imageUrl?: string; // For custom Supabase images, store the public URL
  hideImageOnPrint?: boolean;
  size?: 'small' | 'medium' | 'large' | 'xlarge';
}

export interface Announcement {
  id: string;
  title: string;
  content: string;
  category: 'general' | 'baptism' | 'birthday' | 'calling' | 'activity' | 'service' | 'other';
  date?: string;
  audience?: 'ward' | 'relief_society' | 'elders_quorum' | 'youth' | 'primary' | 'stake' | 'branch' | 'district' | 'other' | string;
  customAudienceLabel?: string; // Free-text label for standalone announcements
  imageId?: string; // Optional image for flyers/announcements (legacy support)
  hideImageOnPrint?: boolean; // Hide image when printing (legacy support)
  hideOnPrint?: boolean; // Web-only announcement: shown online, excluded from the printed program
  images?: AnnouncementImage[]; // Multiple images support
}

export interface Meeting {
  id: string;
  title: string;
  time: string;
  location: string;
  description?: string;
}

export interface SpecialEvent {
  id: string;
  title: string;
  date: string;
  time: string;
  location: string;
  description: string;
  contact?: string;
}

export interface Prayers {
  opening: string;
  closing: string;
  invocation: string;
  benediction: string;
}

export interface MusicProgram {
  openingHymn: string;
  openingHymnNumber: string;
  openingHymnTitle: string;
  openingHymnType?: SongType;
  sacramentHymn: string;
  sacramentHymnNumber: string;
  sacramentHymnTitle: string;
  sacramentHymnType?: SongType;
  closingHymn: string;
  closingHymnNumber: string;
  closingHymnTitle: string;
  closingHymnType?: SongType;
}

export interface Leadership {
  presiding: string;
  conducting?: string;
  chorister: string;
  choristerLabel?: 'Chorister' | 'Music Leader';
  organist: string;
  organistLabel?: 'Organist' | 'Pianist';
  interpreter?: string;
  preludeMusic?: string;
  /** Optional video-meeting URL (e.g. Zoom) shown at the top of the program */
  meetingLink?: string;
}

export interface Speaker {
  id: string;
  name: string;
  type: 'youth' | 'adult';
}

export type AgendaItem =
  | { type: 'speaker'; id: string; name: string; speakerType: 'youth' | 'adult' | 'highCouncil'; customLabel?: string }
  | { type: 'musical'; id: string; label?: string; hymnNumber?: string; hymnTitle?: string; hymnType?: SongType; songName?: string; performers?: string }
  | { type: 'testimony'; id: string; note?: string }
  | { type: 'sacrament'; id: string }
  | { type: 'baby_blessing'; id: string; childName?: string; parentNames?: string }
  | { type: 'baptism_ordinance'; id: string; candidateName?: string; performedBy?: string }
  | { type: 'confirmation'; id: string; candidateName?: string; performedBy?: string };

export interface UnitLeadershipEntry {
  title: string;
  name: string;
  phone?: string;
}

// Legacy type alias for backward compatibility
export type WardLeadershipEntry = UnitLeadershipEntry;

export interface MissionaryEntry {
  name: string;
  phone?: string;
}

export interface UnitMissionaryEntry {
  name: string;
  mission?: string; // Mission name, or branch of service for military entries
  missionAddress?: string;
  email?: string;
  setApartDate?: string; // Date when missionary was set apart
  expectedReturnDate?: string; // Expected return date for sorting
  sortOrder?: number; // Manual sort order
  serviceType?: 'mission' | 'military'; // Defaults to 'mission'; military entries have no set apart/return dates
}

// Legacy type alias for backward compatibility
export type WardMissionaryEntry = UnitMissionaryEntry;

export interface ServiceMissionaryEntry {
  name: string; // Name(s) of service missionary (e.g., "Elder and Sister Jones")
  serviceName: string; // Name of service (e.g., "Senior Missionary Mentors", "Pathway Instructor")
}

export type BulletinStatus = 'draft' | 'scheduled' | 'active' | 'archived';

export interface BulletinData {
  wardName: string; // Will display as appropriate unit name based on terminology
  date: string;
  meetingType: string;
  theme: string;
  userTheme: string;
  bishopricMessage: string; // Will display as appropriate leadership message based on terminology
  announcements: Announcement[];
  meetings: Meeting[];
  specialEvents: SpecialEvent[];
  agenda: AgendaItem[];
  prayers: Prayers;
  musicProgram: MusicProgram;
  leadership: Leadership;
  wardLeadership: UnitLeadershipEntry[]; // Using new interface
  missionaries: MissionaryEntry[]; // Full-time missionaries assigned to ward
  wardMissionaries: UnitMissionaryEntry[]; // Full-time missionaries serving from our ward
  serviceMissionaries: ServiceMissionaryEntry[]; // Local service missionaries
  imageId?: string; // ID of selected image from LDS_IMAGES or custom images
  imageUrl?: string; // Direct URL for custom images (fetched from storage for public bulletins)
  imagePosition?: { x: number; y: number }; // Image positioning coordinates
  imageOpacity?: number; // Image opacity (0-100, default 40)
  showQRCodeOnPrint?: boolean; // Whether to show QR code on printed bulletin
  showImagesOnPrint?: boolean; // Whether to show images on printed bulletin
  /** Print font scale: 1 = normal, 1.15 = large, 1.25 = extra large. Scales all print text without shifting layout. */
  printFontScale?: number;
  /** Use tighter margins on print to fit more announcements. */
  printTightMargins?: boolean;
  // Scheduling fields
  id?: string;
  status?: BulletinStatus;
  scheduledDate?: string; // ISO string
  autoActivate?: boolean;
}
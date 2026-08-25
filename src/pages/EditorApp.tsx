import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Download, QrCode, LogIn, Menu, X, MessageSquare, Repeat, Paintbrush, Printer, Clock, Archive, Settings, Users, Mic } from 'lucide-react';
import UnitTypeSelector from '../components/TerminologyToggle';
import LanguageSelector from '../components/LanguageSelector';
import { getCurrentUnitType, isUnloadWarningSuppressed } from '../lib/config';
import { getUnitLabel, getDefaultLeadershipRoster } from '../lib/terminology';
// Lazy-loaded at PDF export time to reduce initial bundle
const loadPdfDeps = () => Promise.all([
  import('jspdf'),
  import('html2canvas'),
] as const);
import { supabase, userService, bulletinService, robustService, retryOperation } from '../lib/supabase';
import { recurringAnnouncementsService } from '../lib/recurringAnnouncementsService';
import BulletinForm from '../components/BulletinForm';
import BulletinPreview from '../components/BulletinPreview';
import QRCodeGenerator from '../components/QRCodeGenerator';
import AuthModal from '../components/AuthModal';
import UserMenu from '../components/UserMenu';
import SavedBulletinsModal from '../components/SavedBulletinsModal';
import TemplatesModal from '../components/TemplatesModal';
import { BUILT_IN_TEMPLATES, type BuiltInTemplate } from '../data/builtInTemplates';
import ThemeModal from '../components/ThemeModal';
import PrintPreviewModal from '../components/PrintPreviewModal';
import ConductingAgendaModal from '../components/ConductingAgendaModal';
import ProfileModal from '../components/ProfileModal';
import PublicBulletinView from '../components/PublicBulletinView';
import SubmissionReviewModal from '../components/SubmissionReviewModal';
import ConfirmationModal from '../components/ConfirmationModal';
import BulletinScheduler from '../components/BulletinScheduler';
import ProfileSharingModal from '../components/ProfileSharingModal';
import ChangelogModal from '../components/ChangelogModal';
import BulletinActions from '../components/BulletinActions';
import { BulletinData } from '../types/bulletin';
import { readDraft, writeDraft, clearDraft } from '../lib/draftStorage';
import { upcomingSundayISO } from '../lib/dates';
import templateService, { Template } from '../lib/templateService';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import Logo from '../components/Logo';
import BulletinPrintLayout from '../components/BulletinPrintLayout';
import { jwtDecode, JwtPayload } from 'jwt-decode';
import { useSession } from '../lib/SessionContext';
import { themes } from '../data/themes';
import { useLocation, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useProfileAccess } from '../hooks/useProfilePermissions';
import { getAllImages, ImageData } from '../data/images';


function decodeJwtExp(token: string) {
  try {
    const decoded = jwtDecode<JwtPayload & { exp?: number }>(token);
    return decoded.exp ? decoded.exp * 1000 : null;
  } catch (e) {
    return null;
  }
}

// Map i18n language codes to proper locale codes for date formatting
const localeMap: Record<string, string> = {
  'en': 'en-US',
  'zh': 'zh-TW',
  'pt': 'pt-BR',
  'es': 'es-ES',
  'fr': 'fr-FR',
  'de': 'de-DE',
  'it': 'it-IT',
  'ja': 'ja-JP',
  'ko': 'ko-KR'
};

function EditorApp() {
  const { t, i18n } = useTranslation();
  const [currentView, setCurrentView] = useState<'editor' | 'public'>('editor');
  const [publicBulletinData, setPublicBulletinData] = useState<any>(null);
  const [publicError, setPublicError] = useState('');
  const { user, profile, refreshProfile } = useSession();
  const queryClient = useQueryClient();
  const location = useLocation();
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [activeBulletinId, setActiveBulletinId] = useState<string | null>(null);
  const { sharedProfiles, loading: sharedProfilesLoading } = useProfileAccess();
  const [allImages, setAllImages] = useState<ImageData[]>([]);
  const [showDeepLinkBanner, setShowDeepLinkBanner] = useState(false);
  const [deepLinkTemplateName, setDeepLinkTemplateName] = useState('');

  // Load images when user changes
  useEffect(() => {
    loadAllImages();
  }, [user]);

  const loadAllImages = useCallback(async () => {
    // Always load images - LDS_IMAGES are available to everyone
    // Custom images are only loaded if user is logged in
    const images = await getAllImages(user?.id);
    setAllImages(images);
  }, [user?.id]);

  // Get the current profile slug (from URL or user's profile)
  // If user has shared profiles and no slug is specified, default to first shared profile
  const currentProfileSlug = slug || profile?.profile_slug;

  // Get active bulletin ID for the current profile
  // Query by status='active' and profile_slug instead of relying on active_bulletin_id
  // This is more reliable for shared profiles where multiple users might activate bulletins
  const getActiveBulletinForCurrentProfile = async (profileSlug: string) => {
    try {
      const { data: activeBulletins, error: queryError } = await supabase
        .from('bulletins')
        .select('id, status')
        .eq('profile_slug', profileSlug)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();

      if (queryError) {
        return null;
      }

      return activeBulletins?.id || null;
    } catch (error) {
      return null;
    }
  };

  useEffect(() => {
    const updateActiveBulletinId = async () => {
      if (currentProfileSlug) {
        // If we're on a shared profile, get its active bulletin
        if (currentProfileSlug !== profile?.profile_slug) {
          const activeId = await getActiveBulletinForCurrentProfile(currentProfileSlug);
          setActiveBulletinId(activeId);
        } else {
          // If we're on our own profile, use the profile's active bulletin
          // But also verify by querying for active bulletins to ensure consistency
          const activeId = await getActiveBulletinForCurrentProfile(currentProfileSlug);
          // Prefer the queried active bulletin over profile.active_bulletin_id for consistency
          setActiveBulletinId(activeId || profile?.active_bulletin_id || null);
        }
      } else if (profile?.active_bulletin_id !== undefined) {
        // No profile_slug but user has a profile - use their active_bulletin_id
        // Only update if it's different to prevent unnecessary re-renders
        if (activeBulletinId !== profile.active_bulletin_id) {
          setActiveBulletinId(profile.active_bulletin_id || null);
        }
      }
      // If no profile yet, do nothing (keep current state)
    };

    updateActiveBulletinId();
  }, [currentProfileSlug, profile?.active_bulletin_id, profile?.profile_slug]);

  // Redirect to shared profile if user has shared profiles but no slug specified
  useEffect(() => {
    if (!slug && !sharedProfilesLoading && sharedProfiles.length > 0 && user) {
      // User has shared profiles but no slug - redirect to first shared profile
      const firstSharedProfile = sharedProfiles[0];
      navigate(`/profile/${firstSharedProfile.profile_slug}`, { replace: true });
    }
  }, [slug, sharedProfiles, sharedProfilesLoading, user, navigate]);

  // Changelog modal disabled - uncomment and update CHANGELOG_VERSION to re-enable
  // useEffect(() => {
  //   if (user) {
  //     const CHANGELOG_VERSION = '2025.01'; // Update this when you want to show changelog again
  //     const VIEW_COUNT_KEY = `changelog_views_${CHANGELOG_VERSION}`;
  //     const DISMISSED_KEY = `changelog_dismissed_${CHANGELOG_VERSION}`;
  //
  //     const viewCount = parseInt(localStorage.getItem(VIEW_COUNT_KEY) || '0');
  //     const isDismissed = localStorage.getItem(DISMISSED_KEY) === 'true';
  //
  //     // Show if not dismissed and viewed less than 3 times
  //     if (!isDismissed && viewCount < 3) {
  //       setShowChangelog(true);
  //       // Increment view count
  //       localStorage.setItem(VIEW_COUNT_KEY, String(viewCount + 1));
  //     }
  //   }
  // }, [user]);

  const handleCloseChangelog = (dontShowAgain = false) => {
    const CHANGELOG_VERSION = '2025.01';
    const DISMISSED_KEY = `changelog_dismissed_${CHANGELOG_VERSION}`;

    if (dontShowAgain) {
      localStorage.setItem(DISMISSED_KEY, 'true');
    }

    setShowChangelog(false);
  };

  // Handle invitation state from InvitePage
  useEffect(() => {
    if (location.state?.showAuth) {
      setAuthModalMode(location.state.mode);
      setAuthModalPrefillEmail(location.state.prefillEmail);
      setShowAuthModal(true);
      // Clear the state to prevent re-triggering
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<'signin' | 'signup' | undefined>(undefined);
  const [authModalPrefillEmail, setAuthModalPrefillEmail] = useState<string | undefined>(undefined);
  const [showSavedBulletins, setShowSavedBulletins] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showThemeModal, setShowThemeModal] = useState(false);
  const [showPrintPreviewModal, setShowPrintPreviewModal] = useState(false);
  const [showConductingAgenda, setShowConductingAgenda] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showSubmissionReview, setShowSubmissionReview] = useState(false);
  const [showScheduler, setShowScheduler] = useState(false);
  const [showProfileSharing, setShowProfileSharing] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const [pendingSubmissionsCount, setPendingSubmissionsCount] = useState(0);
  const [currentBulletinId, setCurrentBulletinId] = useState<string | null>(null);
  const [showCreateProfileSlug, setShowCreateProfileSlug] = useState(false);
  const [newProfileSlug, setNewProfileSlug] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(() => {
    // Don't mark as having unsaved changes on initial load
    // The useEffect will handle loading saved bulletins and clearing drafts
    return false;
  });
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  
  // Confirmation modal state
  const [confirmationModal, setConfirmationModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    variant?: 'danger' | 'warning' | 'info';
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
    variant: 'warning'
  });


  // Move DEFAULT_KEYS and getDefault above useState
  const DEFAULT_KEYS: Record<
    'wardName' | 'presiding' | 'conducting' | 'chorister' | 'organist' | 'wardLeadership' | 'missionaries' | 'wardMissionaries',
    string
  > = {
    wardName: 'default_wardName',
    presiding: 'default_presiding',
    conducting: 'default_conducting',
    chorister: 'default_chorister',
    organist: 'default_organist',
    wardLeadership: 'default_wardLeadership',
    missionaries: 'default_missionaries',
    wardMissionaries: 'default_wardMissionaries',
  };
  function getDefault<K extends keyof typeof DEFAULT_KEYS, T>(key: K, fallback: T): T {
    try {
      const val = localStorage.getItem(DEFAULT_KEYS[key]);
      if (val) {
        if (key === 'wardLeadership' || key === 'missionaries' || key === 'wardMissionaries') {
          try { return JSON.parse(val) as T; } catch { return fallback; }
        }
        return val as T;
      }
      return fallback;
    } catch (e) {
      return fallback;
    }
  }

  // Helper function to ensure sacrament item exists at the top of agenda (only for sacrament meetings)
  function ensureSacramentItem(agenda: any[], meetingType: string = 'sacrament'): any[] {
    // Only add sacrament item for sacrament meetings
    if (meetingType !== 'sacrament') {
      return agenda;
    }
    
    // Check if sacrament item already exists
    const hasSacramentItem = agenda.some(item => item.type === 'sacrament');
    
    if (!hasSacramentItem) {
      // Add sacrament item at the top
      return [{ type: 'sacrament', id: crypto.randomUUID() }, ...agenda];
    }
    
    return agenda;
  }

  async function populateWithRecurringAnnouncements(bulletin: BulletinData): Promise<BulletinData> {
    try {
      if (!currentProfileSlug) return bulletin;
      
      const recurringAnnouncements = await recurringAnnouncementsService.getAnnouncementsForNewBulletin(currentProfileSlug);

      // Templates made from real bulletins already contain this week's
      // recurring announcements - don't add a second copy of the same title.
      const existingTitles = new Set(
        bulletin.announcements.map(a => (a.title || '').trim().toLowerCase())
      );
      const freshAnnouncements = recurringAnnouncements.filter(
        a => !existingTitles.has((a.title || '').trim().toLowerCase())
      );

      if (freshAnnouncements.length > 0) {
        const newAnnouncements = freshAnnouncements.map(announcement => {
          // Recurring standalone items are stored with the literal
          // 'standalone' audience; the bulletin needs the unique
          // standalone_<id> form plus the custom label, otherwise the
          // renderers print a raw "Standalone" section header.
          const isStandalone = announcement.audience === 'standalone';
          const id = Date.now().toString() + Math.random();
          return {
            id,
            title: announcement.title,
            content: announcement.content,
            category: announcement.category || 'general',
            audience: isStandalone ? `standalone_${id}` : announcement.audience,
            customAudienceLabel: isStandalone ? (announcement.custom_audience_label || '') : undefined,
            // Preserve image data from recurring announcement
            images: announcement.images
          };
        });
        
        return {
          ...bulletin,
          announcements: [...bulletin.announcements, ...newAnnouncements]
        };
      }
      
      return bulletin;
    } catch (error) {
      return bulletin;
    }
  }

  // A template is a reusable snapshot of a past bulletin. Starting a bulletin
  // from it must not inherit that week's date or lifecycle state, otherwise
  // "apply template + save" creates duplicate bulletins dated months in the past.
  function bulletinFromTemplate(data: BulletinData): BulletinData {
    return {
      ...data,
      date: upcomingSundayISO(),
      status: 'draft',
      scheduledDate: undefined,
      autoActivate: false
    };
  }

  // Helper function to get appropriate meeting type based on unit type
  const getMeetingTypeForUnit = (unitType: string): string => {
    // Both ward and branch use sacrament meetings
    return 'sacrament';
  };

  function createBlankBulletin(): BulletinData {
    const currentUnitType = getCurrentUnitType();
    return {
      wardName: getDefault('wardName', ''),
      // Programs are for Sunday meetings — default to the upcoming Sunday,
      // not the mid-week day the clerk happens to be working on.
      date: upcomingSundayISO(),
      meetingType: getMeetingTypeForUnit(currentUnitType),
      theme: '',
      userTheme: '',
      bishopricMessage: '',
      announcements: [],
      meetings: [],
      specialEvents: [],
      agenda: getMeetingTypeForUnit(currentUnitType) === 'sacrament' ? [
        { type: 'sacrament', id: crypto.randomUUID() }
      ] : [],
      prayers: {
        opening: '',
        closing: '',
        invocation: '',
        benediction: ''
      },
      musicProgram: {
        openingHymn: '',
        openingHymnNumber: '',
        openingHymnTitle: '',
        sacramentHymn: '',
        sacramentHymnNumber: '',
        sacramentHymnTitle: '',
        closingHymn: '',
        closingHymnNumber: '',
        closingHymnTitle: ''
      },
      leadership: {
        presiding: getDefault('presiding', ''),
        conducting: getDefault('conducting', ''),
        chorister: getDefault('chorister', ''),
        organist: getDefault('organist', ''),
        organistLabel: 'Organist',
        choristerLabel: 'Chorister'
      },
      wardLeadership: getDefault('wardLeadership', getDefaultLeadershipRoster()),
      missionaries: getDefault('missionaries', []),
      wardMissionaries: getDefault('wardMissionaries', []),
      serviceMissionaries: [],
      imageId: 'none',
      imagePosition: { x: 50, y: 50 }
    };
  }

  // Merge a stored draft with defaults so required fields are never missing
  // after a refresh or an app update that added new fields.
  function mergeDraftWithDefaults(parsed: BulletinData): BulletinData {
    const defaultBulletin = createBlankBulletin();
    return {
      ...defaultBulletin,
      ...parsed,
      imageId: parsed.imageId || 'none',
      imagePosition: parsed.imagePosition || { x: 50, y: 50 },
      wardMissionaries: parsed.wardMissionaries || [],
      missionaries: parsed.missionaries || [],
      wardLeadership: parsed.wardLeadership || defaultBulletin.wardLeadership,
      // Preserve date on refresh: never leave date empty when restoring from draft
      date: parsed.date && String(parsed.date).trim() ? parsed.date : defaultBulletin.date
    };
  }

  // Use a function to initialize bulletinData from localStorage defaults
  const [bulletinData, setBulletinData] = useState<BulletinData>(() => {
    // Check for draft first during initial state creation
    const draft = readDraft();
    if (draft) {
      return mergeDraftWithDefaults(draft.data);
    }
    return createBlankBulletin();
  });

  const [showQRCode, setShowQRCode] = useState(false);
  const bulletinRef = useRef<HTMLDivElement>(null);
  const printPage1Ref = useRef<HTMLDivElement>(null);
  const printPage2Ref = useRef<HTMLDivElement>(null);
  const previousDataRef = useRef<BulletinData | null>(null);
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDraftRef = useRef<BulletinData | null>(null);
  const draftRestoredNoticeShownRef = useRef(false);

  // Keep the latest bulletin id readable from stable callbacks (draft writes)
  // without forcing them to re-create on every id change.
  const currentBulletinIdRef = useRef<string | null>(null);
  useEffect(() => {
    currentBulletinIdRef.current = currentBulletinId;
  }, [currentBulletinId]);

  // Handle template loading only if no draft was loaded during initialization
  useEffect(() => {
    const initializeApp = () => {
      // Skip if we already loaded a draft during state initialization
      const hasDraft = !!readDraft();
      if (hasDraft) {
        return;
      }

      // Load template if no draft exists
      const activeId = templateService.getActiveTemplateId();
      if (activeId) {
        const tmpl = templateService.getTemplate(activeId);
        if (tmpl) {
          setBulletinData(bulletinFromTemplate(tmpl.data));
          setHasUnsavedChanges(false);
          return;
        }
      }

      // If no template and no draft, state initialization already set blank bulletin
    };

    initializeApp();
  }, []);

  // When returning to the page (e.g. after switching apps) re-check the session
  // and restore any draft from localStorage. This effect listens for focus,
  // visibilitychange, and pageshow so the draft is restored without needing
  // a manual refresh on mobile browsers like Safari.
  // Temporarily disabled visibility handler to test minimize issue
  // useEffect(() => {
  //   const handleVisibility = async () => {
  //     if (document.visibilityState === 'visible') {
  //       // Check visibility state change
  //       
  //       // First try to restore from draft
  //       const savedDraft = localStorage.getItem(DRAFT_KEY);
  //       if (savedDraft) {
  //         try {
  //           const parsed = JSON.parse(savedDraft) as BulletinData;
  //           // Restoring from draft
  //           setBulletinData(parsed);
  //           setHasUnsavedChanges(true);
  //           return; // Draft restored, we're done
  //         } catch (err) {
  //           console.error('Failed to restore draft:', err);
  //         }
  //       }
  //       
  //       // If we have unsaved changes, don't overwrite - user is actively working
  //       if (hasUnsavedChanges) {
  //         // Has unsaved changes, keeping current state
  //         return; // Keep current state
  //       }
  //       
  //       // If we have a current bulletin loaded, try to restore it
  //       if (user && currentBulletinId) {
  //         try {
  //           // Restoring current bulletin
  //           const bulletin = await bulletinService.getBulletinById(currentBulletinId);
  //           const data = convertDbBulletinToData(bulletin);
  //           setBulletinData(data);
  //           setHasUnsavedChanges(false);
  //           return; // Current bulletin restored
  //         } catch (err) {
  //           console.error('Failed to restore current bulletin on visibility change:', err);
  //         }
  //       }
  //       
  //       // No current bulletin, try to restore active bulletin if user is signed in
  //       if (user && activeBulletinId) {
  //         try {
  //           // Restoring active bulletin
  //           const bulletin = await bulletinService.getBulletinById(activeBulletinId);
  //           const data = convertDbBulletinToData(bulletin);
  //           setBulletinData(data);
  //           setCurrentBulletinId(bulletin.id);
  //           setHasUnsavedChanges(false);
  //           return; // Active bulletin restored
  //         } catch (err) {
  //           console.error('Failed to restore active bulletin on visibility change:', err);
  //         }
  //       }
  //       
  //       // Fallback: restore template or blank bulletin only if nothing else worked
  //       const activeTemplateId = templateService.getActiveTemplateId();
  //       if (activeTemplateId) {
  //         const tmpl = templateService.getTemplate(activeTemplateId);
  //         if (tmpl) {
  //           // Restoring template
  //           setBulletinData(tmpl.data);
  //           setHasUnsavedChanges(false);
  //           return;
  //         }
  //       }
  //       
  //       // Final fallback: blank bulletin
  //       // Falling back to blank bulletin
  //       setBulletinData(createBlankBulletin());
  //       setHasUnsavedChanges(false);
  //     }
  //   };
  //   document.addEventListener('visibilitychange', handleVisibility);
  //   window.addEventListener('focus', handleVisibility);
  //   window.addEventListener('pageshow', handleVisibility);
  //   return () => {
  //     document.removeEventListener('visibilitychange', handleVisibility);
  //     window.removeEventListener('focus', handleVisibility);
  //     window.removeEventListener('pageshow', handleVisibility);
  //   };
  // }, [user, activeBulletinId, hasUnsavedChanges, currentBulletinId]);

  const convertDbBulletinToData = (bulletin: any): BulletinData => {
    const meetingDate = bulletin.date || bulletin.meeting_date || '';
    const today = (() => {
      const t = new Date();
      return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    })();
    return {
    wardName: bulletin.ward_name || '',
    date: meetingDate && String(meetingDate).trim() ? meetingDate : today,
    // Include status and scheduling fields
    status: bulletin.status || 'draft',
    scheduledDate: bulletin.scheduled_date || null,
    autoActivate: bulletin.auto_activate || false,
    meetingType: bulletin.meeting_type || 'sacrament',
    theme: bulletin.theme || '',
    userTheme: bulletin.userTheme || '',
    bishopricMessage: bulletin.bishopric_message || '',
    announcements: bulletin.announcements || [],
    meetings: bulletin.meetings || [],
    specialEvents: bulletin.special_events || [],
    agenda: ensureSacramentItem(bulletin.agenda || [], bulletin.meeting_type),
    prayers: bulletin.prayers || {
      opening: '',
      closing: '',
      invocation: '',
      benediction: ''
    },
    musicProgram: bulletin.music_program || {
      openingHymn: '',
      openingHymnNumber: '',
      openingHymnTitle: '',
      sacramentHymn: '',
      sacramentHymnNumber: '',
      sacramentHymnTitle: '',
      closingHymn: '',
      closingHymnNumber: '',
      closingHymnTitle: ''
    },
    // Spread first so optional fields (meetingLink, interpreter, and any
    // added later) survive the round trip instead of being wiped on reload.
    leadership: {
      ...(bulletin.leadership || {}),
      presiding: bulletin.leadership?.presiding || '',
      chorister: bulletin.leadership?.chorister || '',
      organist: bulletin.leadership?.organist || '',
      conducting: bulletin.leadership?.conducting || '',
      preludeMusic: bulletin.leadership?.preludeMusic || '',
      organistLabel: bulletin.leadership?.organistLabel || 'Organist',
      choristerLabel: bulletin.leadership?.choristerLabel || 'Chorister'
    },
    wardLeadership: bulletin.wardLeadership || getDefaultLeadershipRoster(),
    missionaries: bulletin.missionaries || [],
    wardMissionaries: bulletin.wardMissionaries || [],
    serviceMissionaries: bulletin.serviceMissionaries || [],
    imageId: bulletin.imageId || 'none',
    imageUrl: bulletin.imageUrl, // Include the direct URL for custom images
    imagePosition: bulletin.imagePosition || { x: 50, y: 50 },
    imageOpacity: bulletin.imageOpacity ?? 40
  };
  };

  const writeDraftToStorage = useCallback((data: BulletinData) => {
    writeDraft(data, currentBulletinIdRef.current);
  }, []);

  const flushDraftSave = useCallback(() => {
    if (draftSaveTimerRef.current) {
      clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
    }
    if (pendingDraftRef.current) {
      writeDraftToStorage(pendingDraftRef.current);
      pendingDraftRef.current = null;
    }
  }, [writeDraftToStorage]);

  // Drop the local draft AND any debounced write still in flight, so a save
  // that just succeeded can't be resurrected as a stale draft 400ms later.
  const clearLocalDraft = useCallback(() => {
    if (draftSaveTimerRef.current) {
      clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
    }
    pendingDraftRef.current = null;
    clearDraft();
  }, []);

  const handleBulletinDataChange = useCallback((newData: BulletinData) => {
    if (previousDataRef.current === newData) {
      return; // Same object reference, nothing changed
    }
    previousDataRef.current = newData;

    setBulletinData(newData);
    setHasUnsavedChanges(true);

    // Debounce the multi-MB serialization + synchronous localStorage write
    // so typing stays responsive on large bulletins.
    pendingDraftRef.current = newData;
    if (draftSaveTimerRef.current) {
      clearTimeout(draftSaveTimerRef.current);
    }
    draftSaveTimerRef.current = setTimeout(flushDraftSave, 400);
  }, [flushDraftSave]);

  // Stable handlers for BulletinPreview so unrelated state changes (modals,
  // loading flags, toasts) don't hand it new function identities every render.
  // They depend on bulletinData, so they only change when the data itself does.
  const handleImagePositionChange = useCallback((position: { x: number; y: number }) => {
    // Only update if the position actually changed and is different from current
    const currentPosition = bulletinData.imagePosition || { x: 50, y: 50 };
    if (position.x !== currentPosition.x || position.y !== currentPosition.y) {
      handleBulletinDataChange({
        ...bulletinData,
        imagePosition: position
      });
    }
  }, [bulletinData, handleBulletinDataChange]);

  const handleImageOpacityChange = useCallback((opacity: number) => {
    handleBulletinDataChange({
      ...bulletinData,
      imageOpacity: opacity
    });
  }, [bulletinData, handleBulletinDataChange]);

  // Stable props for the always-mounted hidden print portal so it only
  // re-renders when the bulletin data (or profile slug) actually changes.
  const printLayoutData = useMemo(() => ({
    ...bulletinData,
    profileSlug: currentProfileSlug || 'your-profile-slug'
  }), [bulletinData, currentProfileSlug]);

  const printLayoutRefs = useMemo(() => ({
    page1: printPage1Ref,
    page2: printPage2Ref
  }), [printPage1Ref, printPage2Ref]);

  // Sync ref when bulletinData changes externally (e.g., loading a bulletin)
  useEffect(() => {
    previousDataRef.current = bulletinData;
  }, [bulletinData]);

  // Flush pending draft writes when the tab is hidden or closing, and warn
  // about unsaved changes before the page unloads.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') flushDraftSave();
    };
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      flushDraftSave();
      // Warn only when a cloud save is actually pending (signed in). For
      // signed-out users the flushed local draft fully preserves the work
      // and restores on return, so the browser dialog would be a false
      // alarm on every single tab close. App-initiated reloads (unit-type
      // switch) suppress the warning the same way — the draft survives.
      if (hasUnsavedChanges && user && !isUnloadWarningSuppressed()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      flushDraftSave();
    };
  }, [flushDraftSave, hasUnsavedChanges, user]);



  useEffect(() => {
    (async () => {
      if (!supabase) return;
      await supabase.auth.getSession();
    })();
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let intervalId: NodeJS.Timeout;
    async function checkJwtExpiration() {
      const { data } = await supabase.auth.getSession();
      const accessToken = data?.session?.access_token;
      if (!accessToken) return;
      const exp = decodeJwtExp(accessToken);
      if (!exp) return;
      const now = Date.now();
      const msLeft = exp - now;
      if (msLeft < 2 * 60 * 1000) { // less than 2 minutes left
        // Try to refresh first - supabase-js auto-refresh may simply not have
        // fired yet. Only force a sign-out when refresh fails AND the token
        // is actually expired, otherwise an idle-but-valid session gets
        // destroyed mid-edit.
        const { error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError && msLeft <= 0) {
          toast.warning(t('errors.sessionExpired', 'Session expired. Please sign in again.'));
          await supabase.auth.signOut();
          window.location.reload();
        }
      }
    }
    checkJwtExpiration();
    intervalId = setInterval(checkJwtExpiration, 30000);
    return () => clearInterval(intervalId);
  }, []);


  // Fetch status for current bulletin if missing, or update if activeBulletinId changes
  useEffect(() => {
    const fetchBulletinStatus = async () => {
      if (!user || !currentBulletinId) {
        return;
      }

      // If we have an activeBulletinId and it matches currentBulletinId, set status to active immediately
      if (activeBulletinId === currentBulletinId) {
        // Use functional update to check current status without adding it to dependencies
        setBulletinData(prev => {
          if (prev.status !== 'active') {
            return { ...prev, status: 'active' };
          }
          return prev; // Return same object if no change to prevent re-render
        });
        return;
      }

      // Use functional update to check current status
      setBulletinData(prev => {
        // If we already have a status and it's not active, and this isn't the active bulletin, don't fetch
        if (prev.status && prev.status !== 'active') {
          return prev;
        }
        // We need to fetch - but we can't do async inside setState, so we handle this separately
        return prev;
      });

      try {
        // Fetch just the status field for the current bulletin
        const { data, error } = await supabase
          .from('bulletins')
          .select('id, status')
          .eq('id', currentBulletinId)
          .single();

        if (!error && data && data.status) {
          // Update bulletinData with the status only if it changed
          setBulletinData(prev => {
            if (prev.status !== data.status) {
              return { ...prev, status: data.status };
            }
            return prev;
          });
        }
      } catch (error) {
        // Failed to fetch bulletin status
      }
    };

    fetchBulletinStatus();
  }, [user, currentBulletinId, activeBulletinId]); // Removed bulletinData.status from dependencies

  // Load active bulletin on startup or when active bulletin changes
  useEffect(() => {
    const fetchInitialBulletin = async () => {
      if (!user) return;

      // CRITICAL: On refresh, prioritize loading saved bulletins over drafts
      // Only skip if user is actively editing (hasUnsavedChanges is true AND we're not on initial load)
      // On initial load (refresh), we want to load the saved bulletin and clear any stale draft
      const isInitialLoad = !currentBulletinId && !bulletinData.wardName;
      if (hasUnsavedChanges && !isInitialLoad) {
        return;
      }

      // IMPORTANT: Check if the active bulletin has changed
      // This handles scheduled bulletins activating, or manual activation on another device
      if (currentBulletinId && activeBulletinId && currentBulletinId === activeBulletinId && !isInitialLoad) {
        return;
      }

      // Apply a freshly fetched cloud bulletin — unless unsaved local work
      // exists. A timestamped draft can only exist while work has not reached
      // the cloud (saving clears it), so it always wins. Legacy drafts of
      // unknown age lose to the cloud, which flushes out stale leftovers.
      const applyCloudBulletin = (bulletin: { id: string } & Record<string, unknown>) => {
        const draft = readDraft();
        if (draft && draft.savedAt > 0) {
          // State already shows the draft (loaded at mount). Point the editor
          // at the draft's own cloud row (or none) so Save can't silently
          // overwrite the live bulletin with unrelated work.
          setCurrentBulletinId(draft.bulletinId);
          setHasUnsavedChanges(true);
          if (!draftRestoredNoticeShownRef.current) {
            draftRestoredNoticeShownRef.current = true;
            toast.info(t('bulletin.draftRestored'), { toastId: 'draft-restored' });
          }
          return;
        }
        const data = convertDbBulletinToData(bulletin);
        setBulletinData(data);
        setCurrentBulletinId(bulletin.id);
        setHasUnsavedChanges(false);
        clearLocalDraft();
        // The cloud bulletin is now on screen - a previously applied template
        // snapshot must not shadow it on the next app start.
        templateService.setActiveTemplateId(null);
      };

      try {
        if (currentProfileSlug) {
          // If we're on a shared profile, get its active bulletin
          if (currentProfileSlug !== profile?.profile_slug) {
            const bulletin = await bulletinService.getLatestBulletinByProfileSlug(currentProfileSlug);
            if (bulletin) {
              applyCloudBulletin(bulletin);
            }
          } else if (activeBulletinId) {
            // If we're on our own profile, load the active bulletin
            // This will switch to the new active bulletin even if we were viewing a different one
            const bulletin = await bulletinService.getBulletinById(activeBulletinId);
            if (bulletin) {
              applyCloudBulletin(bulletin);
            }
          } else if (isInitialLoad) {
            // On initial load with no active bulletin, check for draft
            // But only if we don't have a currentBulletinId
            const draft = readDraft();
            if (draft) {
              setBulletinData(mergeDraftWithDefaults(draft.data));
              setCurrentBulletinId(draft.bulletinId);
              setHasUnsavedChanges(true);
            }
          }
        }
      } catch (err) {
        // If loading fails, clear the active bulletin ID to prevent infinite retries
        if (activeBulletinId) {
          await handleActiveBulletinSelect(null);
        }
      }
    };
    fetchInitialBulletin();
  }, [user, activeBulletinId, currentProfileSlug]);

  // When the user returns to a tab that has been sitting open (e.g. Sunday
  // morning, tab from last week), re-check the server for the active bulletin
  // so the editor catches scheduled activations and edits from other devices.
  // Never runs while there are unsaved local changes, so it cannot clobber
  // in-progress work. Throttled to one check per minute.
  const lastVisibleRefreshRef = useRef(0);
  useEffect(() => {
    const handleVisible = async () => {
      if (document.visibilityState !== 'visible') return;
      if (!user || hasUnsavedChanges || !currentProfileSlug) return;
      const now = Date.now();
      if (now - lastVisibleRefreshRef.current < 60 * 1000) return;
      lastVisibleRefreshRef.current = now;
      try {
        const activeId = await getActiveBulletinForCurrentProfile(currentProfileSlug);
        if (!activeId) return;
        const bulletin = await bulletinService.getBulletinById(activeId);
        if (!bulletin) return;
        setBulletinData(convertDbBulletinToData(bulletin));
        setCurrentBulletinId(bulletin.id);
        setActiveBulletinId(activeId);
        setHasUnsavedChanges(false);
        clearLocalDraft();
        templateService.setActiveTemplateId(null);
      } catch {
        // Offline or transient failure — keep showing the current state.
      }
    };
    document.addEventListener('visibilitychange', handleVisible);
    return () => document.removeEventListener('visibilitychange', handleVisible);
  }, [user, hasUnsavedChanges, currentProfileSlug, clearLocalDraft]);

  const handleCreateProfileSlug = async () => {
    if (!newProfileSlug.trim() || !user) return;
    
    try {
      await userService.updateProfileSlug(user.id, newProfileSlug.trim());
      toast.success(t('success.profileSlugCreatedSuccessfully', 'Profile slug created successfully!'));
      setShowCreateProfileSlug(false);
      setNewProfileSlug('');
      // Refresh the page to load the new profile
      window.location.reload();
    } catch (error: any) {
      toast.error(error.message || t('qrCode.failedToCreateProfileSlug', 'Failed to create profile slug'));
    }
  };

  const handleBackToEditor = () => {
    setCurrentView('editor');
    setPublicBulletinData(null);
    setPublicError('');
    // Update URL to home
    window.history.pushState({}, '', '/');
  };

  // Core cloud save. Takes the data snapshot explicitly instead of reading
  // bulletinData from the closure, so callers that just built a new state
  // object (e.g. auto-save on submission approval) can persist it without
  // waiting for a re-render.
  const saveBulletinToCloud = async (dataToSave: BulletinData) => {
    if (!user) return;

    try {
      const { data, error } = await supabase.auth.refreshSession();
      if (error || !data.session) {
        toast.error(t('errors.sessionExpired', 'Session expired. Please sign in again.'));
        setShowAuthModal(true);
        return;
      }
    } catch (err) {
      toast.error(t('errors.sessionExpired', 'Session expired. Please sign in again.'));
      setShowAuthModal(true);
      return;
    }
    setLoading(true);
    const SAVE_TIMEOUT_MS = 10000;
    let timeoutHandle: NodeJS.Timeout | null = null;
    let didTimeout = false;
    try {
      const savePromise = (async () => {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) {
        }
        const savedBulletin = await retryOperation(() => bulletinService.saveBulletin(
          dataToSave,
          user.id,
          currentBulletinId || undefined,
          currentProfileSlug || undefined
        ));
        return savedBulletin;
      })();
      const timeoutPromise = new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => {
          didTimeout = true;
          reject(new Error('Save operation timed out after 10 seconds.'));
        }, SAVE_TIMEOUT_MS);
      });
      const savedBulletin = await Promise.race([savePromise, timeoutPromise]);
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (didTimeout) return; // Already handled by catch

      // Check if this bulletin was/is active before saving
      const wasActive = currentBulletinId && currentBulletinId === activeBulletinId;

      setCurrentBulletinId(savedBulletin.id);
      setHasUnsavedChanges(false);
      // The work just reached the cloud — the local draft is no longer the
      // source of truth and must not shadow future cloud loads. Same for the
      // applied template snapshot: once the bulletin exists in the cloud, the
      // template must not replace it on the next app start.
      clearLocalDraft();
      templateService.setActiveTemplateId(null);

      // If the bulletin was active before saving, re-activate it with the new ID
      if (wasActive && savedBulletin.id !== activeBulletinId) {
        await handleActiveBulletinSelect(savedBulletin.id);
      }

      // Invalidate query cache to refresh saved bulletins modal
      queryClient.invalidateQueries({ queryKey: ['user-bulletins', user.id] });

      toast.success(currentBulletinId ? t('success.bulletinUpdated', 'Bulletin updated successfully!') : t('success.bulletinSaved', 'Bulletin saved successfully!'), {
        toastId: 'bulletin-save-success'
      });
    } catch (error) {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (didTimeout) {
        toast.error(t('errors.saveTimedOut', 'Saving took too long. Please check your connection or try again.'));
      } else {
        toast.error(t('errors.savingBulletin', 'Error saving bulletin: {{message}}', { message: (error as Error).message }));
      }
      // Try to save to localStorage as fallback
      try {
        bulletinService.saveToLocalStorage({
          id: currentBulletinId || `local_${Date.now()}`,
          ...dataToSave,
          created_by: user.id,
          created_at: new Date().toISOString()
        });
        toast.warning(t('errors.savedLocallyWillSync', 'Bulletin saved locally due to connection issues. It will sync when connection is restored.'));
      } catch (localError) {
        toast.error(t('errors.savingBulletin', 'Error saving bulletin: {{message}}', { message: (error as Error).message }));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSaveBulletin = async () => {
    if (!user) {
      // Save draft before showing auth modal
      await robustService.saveDraftBeforeAuth(bulletinData);
      setShowAuthModal(true);
      return;
    }

    // Check if there are actually changes to save
    if (!hasUnsavedChanges) {
      toast.info(t('common.noChangesToSave', 'No changes to save'), {
        toastId: 'no-changes-to-save'
      });
      return;
    }

    await saveBulletinToCloud(bulletinData);
  };

  const handleMakeActive = async () => {
    if (!user) {
      setShowAuthModal(true);
      return;
    }

    try {
      setLoading(true);

      // Auto-save the bulletin if it hasn't been saved yet
      if (!currentBulletinId) {
        const savedBulletin = await retryOperation(() => bulletinService.saveBulletin(
          bulletinData,
          user.id,
          undefined,
          currentProfileSlug || undefined
        ));
        setCurrentBulletinId(savedBulletin.id);
        setHasUnsavedChanges(false);

        // Make the newly saved bulletin active
        await handleActiveBulletinSelect(savedBulletin.id);
      } else {
        // Make existing bulletin active
        await handleActiveBulletinSelect(currentBulletinId);
      }

      toast.success(t('success.bulletinNowActive', 'Bulletin is now active on your QR code!'));
    } catch (error) {
      toast.error(t('errors.makingBulletinActive', 'Error making bulletin active: {{message}}', { message: (error as Error).message }));
    } finally {
      setLoading(false);
    }
  };


  // Signing out drops in-memory work; warn first when something is unsaved.
  const handleSignOut = async () => {
    if (hasUnsavedChanges) {
      setConfirmationModal({
        isOpen: true,
        title: t('common.unsavedChangesTitle', 'Unsaved Changes'),
        message: t('common.signOutUnsavedConfirm', 'You have unsaved changes. Sign out anyway?'),
        variant: 'warning',
        onConfirm: () => {
          supabase?.auth.signOut();
        }
      });
      return;
    }
    await supabase?.auth.signOut();
  };

  // Ctrl/Cmd+S saves instead of opening the browser's save dialog. The ref
  // keeps the listener stable while always calling the latest handler.
  const saveShortcutRef = useRef<() => void>(() => {});
  saveShortcutRef.current = () => { handleSaveBulletin(); };
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveShortcutRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleSaveAsTemplate = async () => {
    if (!user) {
      setShowAuthModal(true);
      return;
    }

    try {
      setLoading(true);
      const templateName = `${bulletinData.wardName} Template - ${new Date().toLocaleDateString(localeMap[i18n.language] || i18n.language)}`;
      const saved = templateService.saveTemplate(templateName, bulletinData);
      if (saved) {
        toast.success(t('success.bulletinSavedAsTemplate', 'Bulletin saved as template!'));
      } else {
        toast.error(t('errors.templateStorageFull', 'Could not save template: browser storage is full or unavailable. Try deleting old templates.'));
      }
    } catch (error) {
      toast.error(t('errors.savingTemplate', 'Error saving template: {{message}}', { message: (error as Error).message }));
    } finally {
      setLoading(false);
    }
  };

  const handleViewSavedBulletins = () => {
    setShowSavedBulletins(true);
  };

  const handleLoadSavedBulletin = (bulletin: any) => {
    const defaultWardLeadership = getDefaultLeadershipRoster();
    const asArray = (v: unknown) => (Array.isArray(v) ? v : []);
    const asObject = <T extends object>(v: unknown, fallback: T): T =>
      v && typeof v === 'object' && !Array.isArray(v) ? (v as T) : fallback;

    const applyLoad = () => {
      try {
        const loadedData: BulletinData = {
          wardName: bulletin.ward_name || '',
          date: bulletin.date,
          meetingType: bulletin.meeting_type,
          theme: bulletin.theme || '',
          bishopricMessage: bulletin.bishopric_message || '',
          announcements: asArray(bulletin.announcements),
          meetings: asArray(bulletin.meetings),
          specialEvents: asArray(bulletin.special_events),
          agenda: ensureSacramentItem(asArray(bulletin.agenda), bulletin.meeting_type),
          prayers: asObject(bulletin.prayers, {
            opening: '',
            closing: '',
            invocation: '',
            benediction: ''
          }),
          musicProgram: asObject(bulletin.music_program, {
            openingHymn: '',
            openingHymnNumber: '',
            openingHymnTitle: '',
            sacramentHymn: '',
            sacramentHymnNumber: '',
            sacramentHymnTitle: '',
            closingHymn: '',
            closingHymnNumber: '',
            closingHymnTitle: ''
          }),
          leadership: asObject(bulletin.leadership, {
            presiding: '',
            chorister: '',
            organist: ''
          }),
          status: bulletin.status || 'draft',
          scheduledDate: bulletin.scheduled_date,
          autoActivate: bulletin.auto_activate,
          wardLeadership: asArray(bulletin.wardLeadership).length
            ? asArray(bulletin.wardLeadership)
            : defaultWardLeadership,
          missionaries: asArray(bulletin.missionaries),
          wardMissionaries: asArray(bulletin.wardMissionaries),
          imageId: bulletin.imageId || 'none',
          imagePosition: asObject(bulletin.imagePosition, { x: 50, y: 50 })
        };

        setBulletinData(loadedData);
        setCurrentBulletinId(bulletin.id);
        setHasUnsavedChanges(false);
        clearLocalDraft();
        // Real data is on screen - a previously applied template snapshot must
        // not shadow it on the next app start.
        templateService.setActiveTemplateId(null);
        setShowSavedBulletins(false);
        setShowQRCode(false);
      } catch (err) {
        console.error('Failed to load bulletin', { id: bulletin?.id, bulletin, error: err });
        toast.error(
          t('errors.couldNotLoadBulletin', "Couldn't load this bulletin (id: {{id}}). Please contact support with this ID.", { id: bulletin?.id ?? 'unknown' })
        );
      }
    };

    if (hasUnsavedChanges) {
      setConfirmationModal({
        isOpen: true,
        title: t('common.unsavedChangesTitle', 'Unsaved Changes'),
        message: t('common.loadBulletinDiscardConfirm', 'You have unsaved changes. Loading this bulletin will discard them. Continue?'),
        onConfirm: applyLoad,
        variant: 'warning'
      });
      return;
    }

    applyLoad();
  };

  const handleTemplateSelect = async (template: Template | null, builtIn?: BuiltInTemplate) => {
    let next: BulletinData;
    if (builtIn) {
      templateService.setActiveTemplateId(null);
      const blank = createBlankBulletin();
      next = { ...blank, ...builtIn.data };
      toast.success(t(builtIn.nameKey) + ' ' + t('templates.applied', 'template applied'));
    } else if (template) {
      templateService.setActiveTemplateId(template.id);
      next = bulletinFromTemplate(template.data);
    } else {
      templateService.setActiveTemplateId(null);
      next = createBlankBulletin();
    }
    // A new bulletin starts with this week's recurring announcements already
    // in place (no-op when signed out, offline, or none are configured).
    if (user) {
      next = await populateWithRecurringAnnouncements(next);
    }
    setBulletinData(next);
    setCurrentBulletinId(null);
    setHasUnsavedChanges(false);
    clearLocalDraft();
    setShowTemplates(false);
  };

  // Deep link: ?template=builtin-sacrament etc.
  useEffect(() => {
    const templateParam = searchParams.get('template');
    if (!templateParam) return;
    const matched = BUILT_IN_TEMPLATES.find(t => t.id === templateParam);
    if (!matched) {
      navigate('/', { replace: true });
      return;
    }
    // hasUnsavedChanges is always false in this mount-time closure, even when
    // a draft was restored during state init — so check the draft directly.
    // Applying the template would overwrite that work and delete the draft.
    if (hasUnsavedChanges || readDraft()) {
      setConfirmationModal({
        isOpen: true,
        title: t('common.unsavedChangesTitle', 'Unsaved Changes'),
        message: t('templates.deepLinkConfirm', 'You have unsaved changes. Apply this template and lose your current work?'),
        variant: 'warning' as const,
        onConfirm: () => {
          handleTemplateSelect(null, matched);
          navigate('/', { replace: true });
          setConfirmationModal(prev => ({ ...prev, isOpen: false }));
        },
      });
    } else {
      handleTemplateSelect(null, matched);
      navigate('/', { replace: true });
      // Show onboarding banner if user hasn't dismissed it before
      if (!localStorage.getItem('wardbulletin_deeplink_banner_dismissed')) {
        setDeepLinkTemplateName(t(matched.nameKey));
        setShowDeepLinkBanner(true);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDeleteSavedBulletin = (bulletinId: string) => {
    // If we're currently editing the deleted bulletin, clear the current ID
    if (currentBulletinId === bulletinId) {
      setCurrentBulletinId(null);
      setHasUnsavedChanges(true); // Mark as unsaved since the saved version is gone
    }
  };

  const handleScheduleBulletin = async (scheduledDate: string, autoActivate: boolean = true) => {
    if (!user) {
      setShowAuthModal(true);
      return;
    }

    // Validate that the scheduled date/time is not in the past
    const scheduledDateTime = new Date(scheduledDate);
    const now = new Date();
    
    if (scheduledDateTime < now) {
      toast.error(t('bulletin.pastDateError', 'Cannot schedule a bulletin for a date/time in the past. Please select a future date and time.'));
      return;
    }

    try {
      setLoading(true);
      let bulletinId = currentBulletinId;

      // Auto-save the bulletin if it hasn't been saved yet
      if (!bulletinId) {
        const savedBulletin = await retryOperation(() => bulletinService.saveBulletin(
          bulletinData,
          user.id,
          undefined,
          currentProfileSlug || undefined
        ));
        setCurrentBulletinId(savedBulletin.id);
        setHasUnsavedChanges(false);
        bulletinId = savedBulletin.id;
      }

      await bulletinService.updateBulletinSchedule(bulletinId, user.id, {
        scheduledDate,
        status: 'scheduled',
        autoActivate
      });

      toast.success(t('success.bulletinScheduledFor', 'Bulletin scheduled for {{date}}', { date: new Date(scheduledDate).toLocaleDateString(localeMap[i18n.language] || i18n.language) }));
      setShowScheduler(false);
    } catch (error: any) {
      toast.error(t('errors.schedulingBulletin', 'Error scheduling bulletin: {{message}}', { message: error.message }));
    } finally {
      setLoading(false);
    }
  };

  // Check for pending submissions
  const checkPendingSubmissions = async () => {
    if (!supabase || !currentProfileSlug) return;
    
    try {
      const { data, error } = await supabase
        .from('announcement_submissions')
        .select('id')
        .eq('profile_slug', currentProfileSlug)
        .eq('status', 'pending');
      
      if (!error && data) {
        setPendingSubmissionsCount(data.length);
      }
    } catch (error) {
      // Error checking pending submissions
    }
  };

  // Check for pending submissions when user or profile changes
  useEffect(() => {
    if (user && currentProfileSlug) {
      checkPendingSubmissions();
    } else {
      setPendingSubmissionsCount(0);
    }
  }, [user, currentProfileSlug]);

  const handleNewBulletin = () => {
    if (hasUnsavedChanges) {
      setConfirmationModal({
        isOpen: true,
        title: 'Unsaved Changes',
        message: 'You have unsaved changes. Creating a new bulletin will discard them. Continue?',
        onConfirm: () => {
          setShowTemplates(true);
        },
        variant: 'warning'
      });
      return;
    }
    setShowTemplates(true);
  };

  const handleActiveBulletinSelect = async (bulletinId: string | null) => {
    if (!user) return;

    try {
      if (bulletinId) {
        // Make the bulletin active by updating its status
        await bulletinService.updateBulletinStatus(bulletinId, user.id, 'active');
        setActiveBulletinId(bulletinId);

        // Update local bulletinData status if this is the current bulletin
        if (currentBulletinId === bulletinId) {
          setBulletinData(prev => ({ ...prev, status: 'active' }));
        }

        // Refetch queries instead of invalidating to preserve data during refetch
        queryClient.refetchQueries({ 
          queryKey: ['user-bulletins', user.id],
          type: 'active'
        });
        if (currentProfileSlug && currentProfileSlug !== profile?.profile_slug) {
          queryClient.refetchQueries({ 
            queryKey: ['shared-profile-bulletins', currentProfileSlug],
            type: 'active'
          });
        }
        // Also refetch profile-related queries
        queryClient.refetchQueries({ 
          queryKey: ['user-profile', user.id],
          type: 'active'
        });
        
        // Force refresh the activeBulletinId state to ensure UI consistency
        setTimeout(async () => {
          if (currentProfileSlug !== profile?.profile_slug) {
            const activeId = await getActiveBulletinForCurrentProfile(currentProfileSlug);
            setActiveBulletinId(activeId);
          } else {
            // Refresh profile data to get updated active_bulletin_id
            const updatedProfile = await userService.getUserProfile(user.id);
            if (updatedProfile && updatedProfile.length > 0) {
              setActiveBulletinId(updatedProfile[0].active_bulletin_id || null);
            }
          }
        }, 100); // Small delay to ensure database update is complete
      } else {
        // Clear the active bulletin
        await userService.updateActiveBulletinId(user.id, null);
        
        // Update local bulletinData status if this was the active bulletin
        if (currentBulletinId === activeBulletinId) {
          setBulletinData(prev => ({ ...prev, status: 'draft' }));
        }
        setActiveBulletinId(null);

        // Invalidate ALL relevant queries to ensure real-time sync across all components
        queryClient.invalidateQueries({ queryKey: ['user-bulletins', user.id] });
        if (currentProfileSlug && currentProfileSlug !== profile?.profile_slug) {
          queryClient.invalidateQueries({ queryKey: ['shared-profile-bulletins', currentProfileSlug] });
        }
        // Also invalidate any profile-related queries
        queryClient.invalidateQueries({ queryKey: ['user-profile', user.id] });
      }
    } catch (error) {
      toast.error(t('errors.updatingActiveBulletin', 'Error updating active bulletin: {{message}}', { message: (error as Error).message }));
    }
  };

  const handleProfileChange = (newProfileSlug: string) => {
    // Navigate to the selected profile
    if (newProfileSlug) {
      navigate(`/profile/${newProfileSlug}`);
    }
  };

  const handleExportPDF = async () => {
    if (printPage1Ref.current && printPage2Ref.current) {
      try {
        // Convert cross-origin image to base64 to bypass CORS restrictions
        const convertImageToBase64 = async (img: HTMLImageElement): Promise<void> => {
          // Skip if already a data URL or same origin
          if (img.src.startsWith('data:') || img.src.startsWith(window.location.origin)) {
            return;
          }

          try {
            // Fetch the image through our origin to get around CORS
            const response = await fetch(img.src);
            const blob = await response.blob();

            return new Promise((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => {
                if (typeof reader.result === 'string') {
                  img.src = reader.result; // Replace src with base64 data URL
                }
                resolve();
              };
              reader.onerror = () => resolve(); // Continue even on error
              reader.readAsDataURL(blob);
            });
          } catch (error) {
            // Continue without converting - html2canvas will try with useCORS
          }
        };

        // Preload and convert images to ensure they're available for PDF generation
        const preloadImages = async () => {
          const imagePromises: Promise<void>[] = [];

          // Get all images in the print layout
          const images = printPage1Ref.current?.querySelectorAll('img') || [];
          images.forEach((img) => {
            // Convert cross-origin images to base64
            if (img.src && img.src.includes('supabase.co')) {
              imagePromises.push(convertImageToBase64(img));
            } else if (img.src && !img.complete) {
              const promise = new Promise<void>((resolve) => {
                img.onload = () => resolve();
                img.onerror = () => resolve(); // Continue even if image fails to load
              });
              imagePromises.push(promise);
            }
          });

          const images2 = printPage2Ref.current?.querySelectorAll('img') || [];
          images2.forEach((img) => {
            // Convert cross-origin images to base64
            if (img.src && img.src.includes('supabase.co')) {
              imagePromises.push(convertImageToBase64(img));
            } else if (img.src && !img.complete) {
              const promise = new Promise<void>((resolve) => {
                img.onload = () => resolve();
                img.onerror = () => resolve(); // Continue even if image fails to load
              });
              imagePromises.push(promise);
            }
          });

          // Wait for all images to load/convert (with timeout)
          await Promise.race([
            Promise.all(imagePromises),
            new Promise(resolve => setTimeout(resolve, 5000)) // 5 second timeout for conversions
          ]);
        };

        // Wait for images to load and convert
        await preloadImages();

        // Small delay to ensure layout is fully rendered
        await new Promise(resolve => setTimeout(resolve, 500));

        // Optimized scale for better file size while maintaining quality
        const scale = 1.5;
        const marginX = 0; // extra horizontal margin handled by centering
        const marginY = 10; // mm top/bottom padding

        const [{ default: jsPDF }, { default: html2canvas }] = await loadPdfDeps();

        // Render page 1
        const canvas1 = await html2canvas(printPage1Ref.current, {
          scale,
          useCORS: true,
          allowTaint: true,
          backgroundColor: '#ffffff',
          width: printPage1Ref.current.scrollWidth,
          height: printPage1Ref.current.scrollHeight,
          logging: false,
          removeContainer: true
        });

        // Render page 2
        const canvas2 = await html2canvas(printPage2Ref.current, {
          scale,
          useCORS: true,
          allowTaint: true,
          backgroundColor: '#ffffff',
          width: printPage2Ref.current.scrollWidth,
          height: printPage2Ref.current.scrollHeight,
          logging: false,
          removeContainer: true
        });

        // Convert to JPEG with compression for smaller file size
        const imgData1 = canvas1.toDataURL('image/jpeg', 0.85);
        const imgData2 = canvas2.toDataURL('image/jpeg', 0.85);

        const pdf = new jsPDF({ 
          orientation: 'landscape', 
          unit: 'mm', 
          format: 'letter',
          compress: true
        });
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = pdf.internal.pageSize.getHeight();

        // Page 1
        const ratio1 = Math.min(
          1,
          (pdfWidth - marginX * 2) / canvas1.width,
          (pdfHeight - marginY * 2) / canvas1.height
        );
        const imgX1 = (pdfWidth - canvas1.width * ratio1) / 2;
        const imgY1 = marginY;
        pdf.addImage(
          imgData1,
          'JPEG',
          imgX1,
          imgY1,
          canvas1.width * ratio1,
          canvas1.height * ratio1
        );

        // Page 2
        pdf.addPage('letter', 'landscape');
        const ratio2 = Math.min(
          1,
          (pdfWidth - marginX * 2) / canvas2.width,
          (pdfHeight - marginY * 2) / canvas2.height
        );
        const imgX2 = (pdfWidth - canvas2.width * ratio2) / 2;
        const imgY2 = marginY;
        pdf.addImage(
          imgData2,
          'JPEG',
          imgX2,
          imgY2,
          canvas2.width * ratio2,
          canvas2.height * ratio2
        );

        pdf.setDocumentProperties({ title: 'WardBulletin' });
        (pdf as any).viewerPreferences?.({ Duplex: 'DuplexFlipShortEdge' });
        pdf.autoPrint();
        pdf.save('Ward-Bulletin.pdf');
      } catch (error) {
        toast.error(t('errors.pdfGenerationFailed', 'There was an error generating the PDF. Please try again.'));
      }
    } else {
      toast.error(t('errors.pdfMissingPageReferences', 'PDF export failed: Missing page references. Please try again.'));
    }
  };

  // Add a Clear Local Data button for troubleshooting
  const handleClearLocalData = () => {
    if (window.confirm(t('common.clearLocalDataConfirm', 'This will clear all local data and drafts. Continue?'))) {
      try {
        localStorage.clear();
        sessionStorage.clear();
        window.location.reload();
      } catch (error) {
        toast.error(t('errors.clearLocalDataFailed', 'Failed to clear local data. Please try refreshing the page.'));
      }
    }
  };

  // If we're in public view mode, show the public bulletin
  if (currentView === 'public') {
    return (
      <PublicBulletinView
        bulletinData={publicBulletinData}
        loading={false}
        error={publicError}
        onBackToEditor={handleBackToEditor}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <header className="bg-white shadow-lg border-b-4 border-blue-600">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <a href="/" className="flex items-center space-x-3 group focus:outline-none focus:ring-2 focus:ring-blue-500 rounded transition-shadow no-underline" style={{ textDecoration: 'none' }}>
              <Logo size={40} />
              <div>
                <h1 className="text-3xl font-bold text-gray-900">WardBulletin</h1>
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm text-gray-600">{getUnitLabel()} Bulletin Creator</p>
                  {currentProfileSlug && (
                    <span className="text-xs px-2 py-0.5 bg-purple-100 text-purple-800 rounded-full font-medium" title={t('header.currentlyViewingProfile', { slug: currentProfileSlug })}>
                      {t('qrCode.profile')} {currentProfileSlug}
                    </span>
                  )}
                </div>
              </div>
            </a>
            {/* Desktop/Menu/Sign In button remains outside the clickable logo area */}
            
            {/* Desktop Menu */}
            <div className="hidden lg:flex items-center space-x-3">
              <UnitTypeSelector />
              <LanguageSelector />
              <button
                onClick={handleNewBulletin}
                className="inline-flex items-center px-4 py-2 bg-gray-600 text-white rounded-full hover:bg-gray-700 transition-colors"
              >
                <Plus className="w-4 h-4 mr-2" />
                {t('common.newBulletin')}
              </button>



              <button
                onClick={handleExportPDF}
                className="inline-flex items-center px-4 py-2 bg-green-600 text-white rounded-full hover:bg-green-700 transition-colors"
              >
                <Download className="w-4 h-4 mr-2" />
                {t('common.exportPdf')}
              </button>


              <button
                onClick={() => setShowQRCode(!showQRCode)}
                className="inline-flex items-center px-4 py-2 bg-purple-600 text-white rounded-full hover:bg-purple-700 transition-colors"
                title={t('common.share')}
              >
                <QrCode className="w-4 h-4 mr-2" />
                {t('common.share')}
              </button>
              
              {user && pendingSubmissionsCount > 0 && (
                <button
                  onClick={() => setShowSubmissionReview(true)}
                  className="inline-flex items-center px-4 py-2 bg-orange-600 text-white rounded-full hover:bg-orange-700 transition-colors"
                  title={t('bulletin.reviewSubmissions')}
                >
                  <MessageSquare className="w-4 h-4 mr-2" />
                  {t('bulletin.reviewSubmissions')} ({pendingSubmissionsCount})
                </button>
              )}
              
              
                {user ? (
                  <UserMenu
                    user={user}
                    onSignOut={handleSignOut}
                    onSaveBulletin={handleSaveBulletin}
                    onViewSavedBulletins={handleViewSavedBulletins}
                    hasUnsavedChanges={hasUnsavedChanges}
                    onOpenProfile={() => setShowProfile(true)}
                    onOpenReviewSubmissions={() => setShowSubmissionReview(true)}
                    onOpenProfileSharing={() => setShowProfileSharing(true)}
                    pendingSubmissionsCount={pendingSubmissionsCount}
                  />
              ) : (
                <button
                  onClick={() => setShowAuthModal(true)}
                  className="inline-flex items-center px-4 py-2 bg-gray-600 text-white rounded-full hover:bg-gray-700 transition-colors"
                  title={t('common.signIn')}
                >
                  <LogIn className="w-4 h-4 mr-2" />
                  {t('common.signIn')}
                </button>
              )}
            </div>

            {/* Mobile Menu Button */}
            <div className="lg:hidden">
              <button
                onClick={() => setShowMobileMenu(!showMobileMenu)}
                className="inline-flex items-center justify-center p-2 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors"
              >
                {showMobileMenu ? (
                  <X className="w-6 h-6" />
                ) : (
                  <Menu className="w-6 h-6" />
                )}
              </button>
            </div>
          </div>
          
          {/* Mobile Menu */}
          {showMobileMenu && (
            <div className="lg:hidden mt-4 pt-4 border-t border-gray-200">
              <div className="space-y-3">
                <div className="flex justify-center gap-2">
                  <UnitTypeSelector />
                  <LanguageSelector />
                </div>
                <button
                  onClick={() => {
                    handleNewBulletin();
                    setShowMobileMenu(false);
                  }}
                  className="w-full flex items-center px-4 py-2 bg-gray-600 text-white rounded-full hover:bg-gray-700 transition-colors"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  {t('common.newBulletin')}
                </button>



                <button
                  onClick={() => {
                    handleExportPDF();
                    setShowMobileMenu(false);
                  }}
                  className="w-full flex items-center px-4 py-2 bg-green-600 text-white rounded-full hover:bg-green-700 transition-colors"
                >
                  <Download className="w-4 h-4 mr-2" />
                  {t('common.exportPdf')}
                </button>



                <button
                  onClick={() => {
                    setShowQRCode(!showQRCode);
                    setShowMobileMenu(false);
                  }}
                  className="w-full flex items-center px-4 py-2 bg-purple-600 text-white rounded-full hover:bg-purple-700 transition-colors"
                >
                  <QrCode className="w-4 h-4 mr-2" />
                  {t('common.share')}
                </button>
                
                {user ? (
                  <div className="space-y-2">
                    {pendingSubmissionsCount > 0 && (
                      <button
                        onClick={() => {
                          setShowSubmissionReview(true);
                          setShowMobileMenu(false);
                        }}
                        className="w-full flex items-center px-4 py-2 bg-orange-600 text-white rounded-full hover:bg-orange-700 transition-colors"
                      >
                        <MessageSquare className="w-4 h-4 mr-2" />
                        {t('bulletin.reviewSubmissions')} ({pendingSubmissionsCount})
                      </button>
                    )}
                    <button
                      onClick={() => {
                        handleViewSavedBulletins();
                        setShowMobileMenu(false);
                      }}
                      className="w-full flex items-center px-4 py-2 bg-gray-100 text-gray-700 rounded-full hover:bg-gray-200 transition-colors"
                    >
                      {t('bulletin.myBulletins')}
                    </button>
                    <button
                      onClick={() => {
                        setShowProfile(true);
                        setShowMobileMenu(false);
                      }}
                      className="w-full flex items-center px-4 py-2 bg-gray-100 text-gray-700 rounded-full hover:bg-gray-200 transition-colors"
                    >
                      <Settings className="w-4 h-4 mr-2" />
                      {t('modals.profileSettings')}
                    </button>
                    <button
                      onClick={() => {
                        setShowProfileSharing(true);
                        setShowMobileMenu(false);
                      }}
                      className="w-full flex items-center px-4 py-2 bg-gray-100 text-gray-700 rounded-full hover:bg-gray-200 transition-colors"
                    >
                      <Users className="w-4 h-4 mr-2" />
                      {t('sharing.shareProfile')}
                    </button>
                      <button
                        onClick={async () => {
                          setShowMobileMenu(false);
                          await handleSignOut();
                        }}
                        className="w-full flex items-center px-4 py-2 bg-red-600 text-white rounded-full hover:bg-red-700 transition-colors"
                      >
                      {t('common.signOut')}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setShowAuthModal(true);
                      setShowMobileMenu(false);
                    }}
                    className="w-full flex items-center px-4 py-2 bg-gray-600 text-white rounded-full hover:bg-gray-700 transition-colors"
                  >
                    <LogIn className="w-4 h-4 mr-2" />
                    {t('common.signIn')}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </header>

      <main className={`max-w-7xl mx-auto px-2 sm:px-4 lg:px-8 py-4 sm:py-8${hasUnsavedChanges ? ' pb-24' : ''}`}>
        {/* Deep link onboarding banner */}
        {showDeepLinkBanner && (
          <div className="mb-4 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 flex items-center justify-between">
            <p className="text-sm text-blue-800">
              {t('templates.deepLinkBanner', 'Starting with {{name}} template — customize it for your ward.', { name: deepLinkTemplateName })}
            </p>
            <button
              onClick={() => {
                setShowDeepLinkBanner(false);
                localStorage.setItem('wardbulletin_deeplink_banner_dismissed', 'true');
              }}
              className="ml-4 text-blue-600 hover:text-blue-800 text-sm font-medium flex-shrink-0"
            >
              {t('common.dismiss', 'Dismiss')}
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-8">
          {/* Form Section */}
          <div className="space-y-6">
            <div className="bg-white rounded-xl shadow-lg p-4 sm:p-6">
              <h2 className="text-xl sm:text-2xl font-semibold text-gray-900 mb-4 sm:mb-6">{t('bulletin.createYourOwnBulletin')}</h2>
              <BulletinForm
                data={bulletinData}
                onChange={handleBulletinDataChange}
                profileSlug={currentProfileSlug || undefined}
                userId={user?.id}
                allImages={allImages}
                onImagesRefresh={loadAllImages}
              />
            </div>
          </div>

          {/* Preview Section — sticky and self-scrolling on desktop so the
              live preview stays visible however far down the form you edit.
              self-start is required: a stretched grid column never sticks. */}
          <div className="space-y-4 sm:space-y-6 lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
            <div className="bg-white rounded-xl shadow-lg p-4 sm:p-6">
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-6 space-y-3 sm:space-y-0">
                <h2 className="text-xl sm:text-2xl font-semibold text-gray-900">
                  {t('common.preview')}
                </h2>
                <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                  <button
                    onClick={() => setShowPrintPreviewModal(true)}
                    className="inline-flex items-center justify-center px-3 sm:px-4 py-2 bg-gray-200 text-gray-800 rounded-full hover:bg-gray-300 transition-colors text-sm sm:text-base"
                  >
                    <Printer className="w-4 h-4 mr-2" />
                    <span className="hidden sm:inline">{t('printPreview.printPreview')}</span>
                    <span className="sm:hidden">{t('common.print')}</span>
                  </button>
                  <button
                    onClick={() => setShowConductingAgenda(true)}
                    className="inline-flex items-center justify-center px-3 sm:px-4 py-2 bg-gray-200 text-gray-800 rounded-full hover:bg-gray-300 transition-colors text-sm sm:text-base"
                  >
                    <Mic className="w-4 h-4 mr-2" />
                    {t('conducting.title', 'Conducting Agenda')}
                  </button>
                  <button
                    onClick={() => setShowThemeModal(true)}
                    className="inline-flex items-center justify-center px-3 sm:px-4 py-2 bg-gray-200 text-gray-800 rounded-full hover:bg-gray-300 transition-colors text-sm sm:text-base"
                  >
                    <Paintbrush className="w-4 h-4 mr-2" />
                    {bulletinData.userTheme ? (
                      <>
                        <span className="hidden sm:inline">{t('form.theme')}: </span>
                        <span className="sm:hidden">{t('form.theme')}: </span>
                        <span style={{ fontFamily: themes.find(th => th.name === bulletinData.userTheme)?.fontFamily }}>
                          {bulletinData.userTheme.length > 8 ? bulletinData.userTheme.substring(0, 8) + '...' : bulletinData.userTheme}
                        </span>
                      </>
                    ) : (
                      t('form.theme')
                    )}
                  </button>
                </div>
              </div>
              {currentBulletinId && (
                <div className="flex flex-col sm:flex-row sm:justify-end sm:items-center gap-2 mb-4">
                  <span className="bg-green-100 text-green-800 px-2 py-1 rounded-full text-xs">
                    {t('success.saved')}
                  </span>
                  {hasUnsavedChanges && (
                    <span className="bg-orange-100 text-orange-800 px-2 py-1 rounded-full text-xs">
                      {t('common.unsavedChanges')}
                    </span>
                  )}
                </div>
              )}
              <div ref={bulletinRef}>
                <BulletinPreview
                  data={bulletinData}
                  allImages={allImages}
                  onImagePositionChange={handleImagePositionChange}
                  onImageOpacityChange={handleImageOpacityChange}
                />
              </div>

              {/* New streamlined bulletin actions */}
              {user && (
                <div className="mt-6 flex justify-center">
                  <BulletinActions
                    user={user}
                    bulletinData={bulletinData}
                    onMakeActive={handleMakeActive}
                    onSaveAsTemplate={handleSaveAsTemplate}
                    loading={loading}
                    currentStatus={
                      (currentBulletinId && currentBulletinId === activeBulletinId) 
                        ? 'active' 
                        : (bulletinData.status || 'draft')
                    }
                  />
                </div>
              )}

              {/* Save Bulletin button */}
              <div className="mt-4 flex justify-center">
                <button
                  onClick={handleSaveBulletin}
                  disabled={loading}
                  className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-full hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                  title={t('bulletin.saveBulletin')}
                >
                  {loading ? (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  ) : (
                    <Plus className="w-4 h-4 mr-2" />
                  )}
                  {loading ? t('common.saving') : (currentBulletinId ? t('bulletin.updateBulletin') : t('bulletin.saveBulletin'))}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* QR Code Modal */}
        {showQRCode && (
          <div 
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setShowQRCode(false);
              }
            }}
          >
            <div className="bg-white rounded-xl shadow-2xl p-8 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-semibold text-gray-900">{t('common.share')}</h3>
                <button
                  onClick={() => setShowQRCode(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ×
                </button>
              </div>
                {user ? (
                  <QRCodeGenerator
                    currentActiveBulletinId={activeBulletinId}
                    onActiveBulletinSelect={handleActiveBulletinSelect}
                    currentProfileSlug={currentProfileSlug}
                    onProfileChange={handleProfileChange}
                    onCreateProfileSlug={() => setShowCreateProfileSlug(true)}
                    onProfileSlugUpdate={() => {
                      // Refresh the profile data in SessionContext when profile slug is updated
                      if (refreshProfile) {
                        refreshProfile();
                      }
                    }}
                    onProfileUpdate={() => {
                      // Refresh the profile data when profile is updated
                      if (refreshProfile) {
                        refreshProfile();
                      }
                    }}
                    onLoadBulletin={handleLoadSavedBulletin}
                    onDeleteBulletin={handleDeleteSavedBulletin}
                    isOpen={showQRCode}
                  />
              ) : (
                <div className="text-center py-8">
                  <p className="text-gray-600 mb-4">{t('auth.signInDescription')}</p>
                  <button onClick={() => setShowAuthModal(true)} className="px-4 py-2 bg-blue-600 text-white rounded-full hover:bg-blue-700">{t('common.signIn')}</button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Auth Modal */}
        <AuthModal
          isOpen={showAuthModal}
          onClose={() => {
            setShowAuthModal(false);
            setAuthModalMode(undefined);
            setAuthModalPrefillEmail(undefined);
          }}
          onAuthSuccess={async () => {
            setShowAuthModal(false);
            setAuthModalMode(undefined);
            setAuthModalPrefillEmail(undefined);
            const draft = await robustService.restoreDraftAfterAuth();
            if (draft) {
              setBulletinData(draft);
              await handleSaveBulletin();
            }
          }}
          mode={authModalMode}
          prefillEmail={authModalPrefillEmail}
        />

        {/* Saved Bulletins Modal */}
        <SavedBulletinsModal
          isOpen={showSavedBulletins}
          onClose={() => setShowSavedBulletins(false)}
          onLoadBulletin={handleLoadSavedBulletin}
          onDeleteBulletin={handleDeleteSavedBulletin}
          profileSlug={currentProfileSlug || profile?.profile_slug || undefined}
          onActiveBulletinChange={handleActiveBulletinSelect}
          currentActiveBulletinId={activeBulletinId || undefined}
        />

        {/* Templates Modal */}
        <TemplatesModal
          isOpen={showTemplates}
          onClose={() => setShowTemplates(false)}
          onSelect={handleTemplateSelect}
        />

        <ThemeModal
          isOpen={showThemeModal}
          onClose={() => setShowThemeModal(false)}
          onSelectTheme={(theme) => {
            handleBulletinDataChange({ ...bulletinData, userTheme: theme.name });
            setShowThemeModal(false);
          }}
          currentUserTheme={bulletinData.userTheme}
        />

        {/* Profile Modal */}
        <ProfileModal
          isOpen={showProfile}
          onClose={() => setShowProfile(false)}
          user={user}
          onProfileUpdate={() => {
            // Optionally refresh user data or show success message
          }}
        />

        {/* Scheduler Modal */}
        <BulletinScheduler
          isOpen={showScheduler}
          onClose={() => setShowScheduler(false)}
          onSchedule={handleScheduleBulletin}
        />

        {/* Profile Sharing Modal */}
        <ProfileSharingModal
          isOpen={showProfileSharing}
          onClose={() => setShowProfileSharing(false)}
          profileSlug={currentProfileSlug || ''}
        />

        {/* Changelog Modal */}
        <ChangelogModal
          isOpen={showChangelog}
          onClose={handleCloseChangelog}
        />

        {/* Submission Review Modal */}
        <SubmissionReviewModal
          isOpen={showSubmissionReview}
          onClose={() => setShowSubmissionReview(false)}
          profileSlug={currentProfileSlug || ''}
          onSubmissionApproved={(submission) => {
            // Convert submission to announcement format. The submission form
            // never sets a category, so fall back to 'general' rather than
            // storing null on the announcement.
            const newAnnouncement = {
              id: Date.now().toString(),
              title: submission.title,
              content: submission.content,
              category: submission.category || 'general',
              audience: submission.audience,
              date: submission.date
            };

            // Check if announcement already exists to prevent duplication
            const existingAnnouncement = bulletinData.announcements.find(
              ann => ann.title === submission.title && ann.content === submission.content
            );

            if (existingAnnouncement) {
              toast.info(t('submissions.alreadyExistsInBulletin', '"{{title}}" already exists in the bulletin', { title: submission.title }));
              return;
            }

            // Add to the current bulletin through the normal edit path.
            // A bare setBulletinData left hasUnsavedChanges false and wrote
            // no local draft, so the background cloud-refresh effects (tab
            // becomes visible, active-bulletin reload) saw a "clean" editor
            // and replaced the state with the saved copy — silently deleting
            // the just-approved announcement before the user ever saved it.
            const nextData = {
              ...bulletinData,
              announcements: [...bulletinData.announcements, newAnnouncement]
            };
            handleBulletinDataChange(nextData);

            // Auto-save so the approval reaches the saved bulletin without a
            // separate Save click. On failure the unsaved-changes state and
            // local draft set above still preserve the announcement for a
            // manual save. Signed-out users have no cloud bulletin to save
            // to; the local draft covers them.
            if (user) {
              saveBulletinToCloud(nextData);
            }

            // Show success toast
            if (submission.title.trim()) {
              toast.success(t('submissions.approvedAndAddedToSection', '"{{title}}" has been approved and added to the {{audience}} section!', { title: submission.title, audience: submission.audience.replace('_', ' ') }));
            } else {
              // This is a consolidated announcement
              toast.success(t('submissions.groupApprovedAndConsolidated', '{{audience}} announcements have been consolidated and added to the bulletin!', { audience: submission.audience.replace('_', ' ') }));
            }
          }}
          onSubmissionRejected={(submission) => {
            // Show rejection toast
            toast.success(t('submissions.hasBeenRejected', '"{{title}}" has been rejected', { title: submission.title }));
          }}
          onSubmissionsChanged={checkPendingSubmissions}
        />

        {/* Confirmation Modal */}
        <ConfirmationModal
          isOpen={confirmationModal.isOpen}
          onClose={() => setConfirmationModal(prev => ({ ...prev, isOpen: false }))}
          onConfirm={confirmationModal.onConfirm}
          title={confirmationModal.title}
          message={confirmationModal.message}
          variant={confirmationModal.variant}
        />

        <PrintPreviewModal
          isOpen={showPrintPreviewModal}
          onClose={() => setShowPrintPreviewModal(false)}
          bulletinData={bulletinData}
          onUpdateData={handleBulletinDataChange}
          onExportPDF={handleExportPDF}
        />

        {/* Conducting Agenda Modal — editor-only, never on the public bulletin */}
        <ConductingAgendaModal
          isOpen={showConductingAgenda}
          onClose={() => setShowConductingAgenda(false)}
          data={bulletinData}
        />

        {/* Print source: rendered via portal as direct child of <body> so @media print can isolate it */}
        {createPortal(
          <div className="print-source-portal" style={{ position: 'absolute', left: '-9999px', top: 0 }}>
            <BulletinPrintLayout
              data={printLayoutData}
              refs={printLayoutRefs}
            />
          </div>,
          document.body
        )}
        {/* Create Profile Slug Modal */}
        {showCreateProfileSlug && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4">
              <h3 className="text-lg font-semibold mb-4">Create Profile Slug</h3>
              <p className="text-sm text-gray-600 mb-4">
                A profile slug is a unique identifier for your profile (e.g., "sunset-hills-ward").
                This will be used in URLs and for sharing your profile with others.
              </p>
              <input
                type="text"
                value={newProfileSlug}
                onChange={(e) => setNewProfileSlug(e.target.value)}
                placeholder={t('form.enterProfileSlugPlaceholder', 'Enter profile slug (e.g., sunset-hills-ward)')}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-4"
              />
              <div className="flex space-x-3">
                <button
                  onClick={() => {
                    setShowCreateProfileSlug(false);
                    setNewProfileSlug('');
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateProfileSlug}
                  disabled={!newProfileSlug.trim()}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                >
                  Create
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="text-center">
            <p className="text-gray-600">
              &copy; WardBulletin
            </p>

            <nav className="mt-4 space-x-4">
              <a href="/about" className="text-gray-600 hover:text-gray-900">{t('footer.about', 'About')}</a>
              <a href="/how-to-use" className="text-gray-600 hover:text-gray-900">{t('footer.howToUse', 'How To Use')}</a>
              <a href="/contact" className="text-gray-600 hover:text-gray-900">{t('footer.contact', 'Contact')}</a>
            </nav>
            <nav className="mt-3 space-x-4">
              <span className="text-gray-400 text-sm">{t('footer.guides', 'Guides:')}</span>
              <a href="/guide/create-ward-bulletin" className="text-sm text-gray-500 hover:text-gray-900">{t('footer.createBulletinGuide', 'Create a Bulletin')}</a>
              <a href="/guide/bulletin-templates" className="text-sm text-gray-500 hover:text-gray-900">{t('footer.templatesAndIdeas', 'Templates & Ideas')}</a>
              <a href="/guide/sacrament-meeting-program" className="text-sm text-gray-500 hover:text-gray-900">{t('footer.programGuide', 'Program Guide')}</a>
            </nav>
          </div>
        </div>
      </footer>
      
      {/* Sticky save bar (all screen sizes): the Save action stays reachable
          no matter how long the form scroll gets, and doubles as the always-
          visible "you have unsaved work" indicator. Signed-out users get the
          sign-in-to-save flow from save. */}
      {hasUnsavedChanges && (
        <div className="fixed bottom-0 inset-x-0 z-40 bg-white border-t border-gray-200 shadow-[0_-2px_10px_rgba(0,0,0,0.10)] print:hidden">
          <div className="max-w-7xl mx-auto px-4 lg:px-8 py-3 flex items-center justify-between gap-3">
            <span className="text-sm text-gray-700 flex items-center gap-2 min-w-0">
              <span aria-hidden="true" className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />
              <span className="truncate">{t('common.unsavedChangesShort', 'Unsaved changes')}</span>
            </span>
            <button
              onClick={handleSaveBulletin}
              disabled={loading}
              className="flex-shrink-0 px-5 py-2 bg-blue-600 text-white rounded-full text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition-colors"
            >
              {loading ? t('common.saving') : t('bulletin.saveBulletin')}
            </button>
          </div>
        </div>
      )}

      {/* Toast Container */}
      <ToastContainer
        position="top-right"
        autoClose={5000}
        hideProgressBar={false}
        newestOnTop={false}
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
        theme="light"
      />
    </div>
  );
}

export default EditorApp;

import React, { useEffect, useState, useRef } from 'react';
import { Plus, Trash2, Repeat, RotateCcw, GripVertical } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BulletinData, Announcement, AnnouncementImage, Meeting, SpecialEvent, AgendaItem } from '../types/bulletin';
import { getSongTitle, isValidSongNumber, searchSongsByTitle, preloadSongData, SongType } from '../lib/songService';
import { toast } from 'react-toastify';
import HtmlEditor from './HtmlEditor';
import { LDS_IMAGES, getImageById, getAllImages, deleteCustomImage } from '../data/images';
import ImageUpload from './ImageUpload';
import RecurringAnnouncementsModal from './RecurringAnnouncementsModal';
import { recurringAnnouncementsService } from '../lib/recurringAnnouncementsService';
import {
  getUnitLabel,
  getUnitLowercase,
  getHigherUnitLabel,
  getHigherUnitLowercase,
  getUnitNameLabel,
  getUnitLeadershipLabel,
  getUnitMissionariesLabel,
  getAudienceDisplayName,
  getAudienceValue,
  getTranslatedUnitLabel,
  getTranslatedUnitLowercase,
  getTranslatedHigherUnitLabel
} from '../lib/terminology';

interface BulletinFormProps {
  data: BulletinData;
  onChange: (data: BulletinData) => void;
  profileSlug?: string;
  userId?: string;
  allImages?: any[];
  onImagesRefresh?: () => void;
}

function BulletinForm({ data, onChange, profileSlug, userId, allImages: externalAllImages, onImagesRefresh }: BulletinFormProps) {
  const { t, i18n } = useTranslation();
  const currentLang = i18n.language;
  useEffect(() => { preloadSongData(currentLang); }, [currentLang]);
  const [activeTab, setActiveTab] = useState<'program' | 'announcements' | 'unitinfo'>('program');
  const [hymnSearchResults, setHymnSearchResults] = useState<Array<{number: string, title: string, type: SongType}>>([]);
  const [activeHymnSearch, setActiveHymnSearch] = useState<string | null>(null);
  const [songTypes, setSongTypes] = useState<Record<string, SongType>>({
    openingHymn: 'hymn',
    sacramentHymn: 'hymn',
    closingHymn: 'hymn'
  });
  const [organistLabel, setOrganistLabel] = useState<'Organist' | 'Pianist'>(data.leadership.organistLabel || 'Organist');
  const [choristerLabel, setChoristerLabel] = useState<'Chorister' | 'Music Leader'>(data.leadership.choristerLabel || 'Chorister');
  const [allImages, setAllImages] = useState<any[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);
  const [showRecurringAnnouncements, setShowRecurringAnnouncements] = useState(false);
  const [deleteImageConfirm, setDeleteImageConfirm] = useState<{ show: boolean; imageId: string | null }>({ show: false, imageId: null });

  // Load images on mount (only if not provided externally)
  useEffect(() => {
    if (externalAllImages) {
      setAllImages(externalAllImages);
    } else {
      const loadImages = async () => {
        const images = await getAllImages(userId);
        setAllImages(images);
      };
      loadImages();
    }
  }, [userId, externalAllImages]);

  // Helper to get image by ID from loaded images
  const getImageFromCache = (imageId: string) => {
    return allImages.find(img => img.id === imageId) || LDS_IMAGES[0];
  };

  // Generate unique ID to prevent collisions when adding items quickly
  const generateUniqueId = () => {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  };

  const updateField = (field: keyof BulletinData, value: any) => {
    onChange({ ...data, [field]: value });
  };

  // Accordion state for announcement cards. Collapsed by default so a ward
  // with 25 announcements sees a scannable list of title rows instead of 25
  // mounted Quill editors; the editor and image controls only exist in the
  // DOM while a card is expanded. Newly added announcements start expanded.
  const [expandedAnnouncements, setExpandedAnnouncements] = useState<Set<string>>(new Set());
  const isAnnouncementExpanded = (id: string) => expandedAnnouncements.has(id);
  const toggleAnnouncementExpanded = (id: string) => setExpandedAnnouncements(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const expandAnnouncement = (id: string) => setExpandedAnnouncements(prev => new Set(prev).add(id));

  // Always-current data for undo closures: a toast's Undo button fires long
  // after the render that created it, so it must not act on stale props.
  const dataRef = useRef(data);
  dataRef.current = data;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Remove a list item with a 6-second Undo toast instead of a confirm
  // dialog: no friction on intentional deletes, but mis-taps are recoverable.
  const removeWithUndo = (
    field: 'announcements' | 'meetings' | 'specialEvents' | 'agenda',
    id: string
  ) => {
    const list = dataRef.current[field] as Array<{ id: string }>;
    const index = list.findIndex(item => item.id === id);
    if (index === -1) return;
    const removed = list[index];
    onChangeRef.current({ ...dataRef.current, [field]: list.filter(item => item.id !== id) });

    const undo = () => {
      const current = dataRef.current[field] as Array<{ id: string }>;
      if (current.some(item => item.id === id)) return; // already restored
      const next = [...current];
      next.splice(Math.min(index, next.length), 0, removed);
      onChangeRef.current({ ...dataRef.current, [field]: next });
    };

    toast.info(
      ({ closeToast }) => (
        <div className="flex items-center justify-between gap-3">
          <span>{t('common.itemDeleted', 'Deleted')}</span>
          <button
            onClick={() => { undo(); closeToast?.(); }}
            className="font-semibold underline whitespace-nowrap"
          >
            {t('common.undo', 'Undo')}
          </button>
        </div>
      ),
      { autoClose: 6000, closeOnClick: false }
    );
  };

  const addAnnouncement = (audience?: string) => {
    const newAnnouncement: Announcement = {
      id: generateUniqueId(),
      title: '',
      content: '',
      category: 'general',
      audience: audience || 'ward',
      images: [] // Initialize empty images array
    };
    updateField('announcements', [...data.announcements, newAnnouncement]);
    expandAnnouncement(newAnnouncement.id);
  };

  const addAnnouncementToType = (audience: string) => {
    addAnnouncement(audience);
  };

  // For standalone announcements, generate a unique standalone ID so each is separate
  const addStandaloneAnnouncement = () => {
    const newAnnouncement: Announcement = {
      id: generateUniqueId(),
      title: '',
      content: '',
      category: 'general',
      audience: `standalone_${generateUniqueId()}` as any, // Unique audience so it won't group
      customAudienceLabel: '', // Free-text label, empty by default
      images: []
    };
    updateField('announcements', [...data.announcements, newAnnouncement]);
    expandAnnouncement(newAnnouncement.id);
  };

  const updateAnnouncement = (id: string, field: keyof Announcement, value: any) => {
    const updated = data.announcements.map(ann =>
      ann.id === id ? { ...ann, [field]: value } : ann
    );
    updateField('announcements', updated);
  };

  // Stable per-announcement content handlers so the memoized HtmlEditor's
  // props don't change identity on every parent render — that stability is
  // what lets the other 24 Quill instances skip re-rendering per keystroke.
  const updateAnnouncementRef = useRef(updateAnnouncement);
  updateAnnouncementRef.current = updateAnnouncement;
  const contentHandlersRef = useRef<Record<string, (value: string) => void>>({});
  const getAnnouncementContentHandler = (id: string) => {
    if (!contentHandlersRef.current[id]) {
      contentHandlersRef.current[id] = (value: string) =>
        updateAnnouncementRef.current(id, 'content', value || '');
    }
    return contentHandlersRef.current[id];
  };

  const removeAnnouncement = (id: string) => {
    removeWithUndo('announcements', id);
  };

  // The announcements UI is grouped by audience, but the data is one flat
  // array. Reorder must swap with the nearest SAME-audience neighbor:
  // swapping with a flat-array neighbor from another group is invisible in
  // the grouped UI and can even flip whole sections (group order is
  // first-occurrence order). Swapping two same-audience positions provably
  // leaves every other group's order and all section order untouched.
  const moveAnnouncementInGroup = (id: string, direction: -1 | 1) => {
    const list = data.announcements;
    const index = list.findIndex(a => a.id === id);
    if (index === -1) return;
    const audience = list[index].audience;
    let neighbor = -1;
    for (let i = index + direction; i >= 0 && i < list.length; i += direction) {
      if (list[i].audience === audience) { neighbor = i; break; }
    }
    if (neighbor === -1) return;
    const updated = [...list];
    [updated[index], updated[neighbor]] = [updated[neighbor], updated[index]];
    updateField('announcements', updated);
  };

  const announcementGroupPosition = (id: string): { first: boolean; last: boolean } => {
    const list = data.announcements;
    const item = list.find(a => a.id === id);
    if (!item) return { first: true, last: true };
    const group = list.filter(a => a.audience === item.audience);
    const gi = group.findIndex(a => a.id === id);
    return { first: gi === 0, last: gi === group.length - 1 };
  };

  // The display order of the whole sections (RS, EQ, Youth, …) is the
  // first-occurrence order of each audience in the flat array, matching how
  // the form and preview both group with reduce()+Object.keys.
  const groupOrder = (): string[] => {
    const order: string[] = [];
    for (const a of data.announcements) {
      const key = a.audience || 'ward';
      if (!order.includes(key)) order.push(key);
    }
    return order;
  };

  const sectionGroupPosition = (audience: string): { first: boolean; last: boolean } => {
    const order = groupOrder();
    const i = order.indexOf(audience);
    return { first: i <= 0, last: i === order.length - 1 };
  };

  // Move an entire audience section up/down past its neighboring section.
  // Rebuild the flat array following the swapped group order, keeping each
  // section's internal item order intact — so section order changes while
  // within-section order (and every other section) is preserved.
  const moveSection = (audience: string, direction: -1 | 1) => {
    const order = groupOrder();
    const index = order.indexOf(audience);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    const updated = order.flatMap(key =>
      data.announcements.filter(a => (a.audience || 'ward') === key)
    );
    updateField('announcements', updated);
  };

          const handleRecurringAnnouncementSelected = (announcement: any) => {
          // Check if this is a standalone recurring announcement
          const isStandalone = announcement.audience === 'standalone';

          const newAnnouncement: Announcement = {
            id: generateUniqueId(),
            title: announcement.title,
            content: announcement.content,
            category: 'general',
            // For standalone, create a new unique standalone audience; otherwise use the recurring announcement's audience
            audience: isStandalone ? `standalone_${generateUniqueId()}` : announcement.audience,
            // Preserve custom label for standalone announcements
            customAudienceLabel: isStandalone ? (announcement.custom_audience_label || '') : undefined,
            // Preserve image data from recurring announcement
            images: announcement.images
          };
          updateField('announcements', [...data.announcements, newAnnouncement]);
          expandAnnouncement(newAnnouncement.id);
        };

  const convertToRecurring = async (announcement: Announcement) => {
    // Recurring announcements are stored and fetched by profile slug; saving
    // under the 'default' fallback strands them somewhere no UI can ever
    // list. Without a profile this feature simply isn't available yet.
    if (!profileSlug) {
      toast.info(t('form.recurringNeedsProfile', 'Create a profile first to use recurring announcements (sign in and set a profile name).'));
      return;
    }
    try {
      const result = await recurringAnnouncementsService.convertToRecurring(announcement, profileSlug);

      if (result) {
        toast.success(t('success.convertedToRecurring', '"{{title}}" converted to recurring announcement', { title: announcement.title }));
      } else {
        toast.error(t('errors.failedToConvertToRecurring', 'Failed to convert to recurring announcement'));
      }
    } catch (error) {
      toast.error(t('errors.failedToConvertToRecurring', 'Failed to convert to recurring announcement'));
    }
  };

  const handleHymnNumberChange = (field: string, value: string) => {
    if (field.startsWith('agenda-')) {
      const id = field.replace('agenda-', '');
      const agendaSongType = songTypes[`agenda-${id}`] || 'hymn';
      updateAgendaItem(id, {
        hymnNumber: value,
        hymnTitle: isValidSongNumber(value, agendaSongType, currentLang) ? getSongTitle(value, agendaSongType, currentLang) : '',
        hymnType: agendaSongType
      });
      return;
    }

    const hymnData = { ...data.musicProgram };
    const fieldSongType = songTypes[field] || 'hymn';

    if (field === 'openingHymnNumber') {
      hymnData.openingHymnNumber = value;
      hymnData.openingHymnType = fieldSongType;
      if (isValidSongNumber(value, fieldSongType, currentLang)) {
        hymnData.openingHymnTitle = getSongTitle(value, fieldSongType, currentLang);
      }
    } else if (field === 'sacramentHymnNumber') {
      hymnData.sacramentHymnNumber = value;
      hymnData.sacramentHymnType = fieldSongType;
      if (isValidSongNumber(value, fieldSongType, currentLang)) {
        hymnData.sacramentHymnTitle = getSongTitle(value, fieldSongType, currentLang);
      }
    } else if (field === 'closingHymnNumber') {
      hymnData.closingHymnNumber = value;
      hymnData.closingHymnType = fieldSongType;
      if (isValidSongNumber(value, fieldSongType, currentLang)) {
        hymnData.closingHymnTitle = getSongTitle(value, fieldSongType, currentLang);
      }
    }

    updateField('musicProgram', hymnData);
  };

  const handleHymnTitleSearch = (field: string, searchTerm: string) => {
    if (searchTerm.length < 2) {
      setHymnSearchResults([]);
      setActiveHymnSearch(null);
      return;
    }

    const fieldSongType = songTypes[field] || 'hymn';
    const results = searchSongsByTitle(searchTerm, fieldSongType, currentLang);
    setHymnSearchResults(results);
    setActiveHymnSearch(field);
  };

  const selectHymnFromSearch = (field: string, hymnNumber: string, hymnTitle: string, songType?: SongType) => {
    const fieldSongType = songType || songTypes[field] || 'hymn';
    
    if (field.startsWith('agenda-')) {
      const id = field.replace('agenda-', '');
      updateAgendaItem(id, { hymnNumber, hymnTitle, hymnType: fieldSongType });
      setHymnSearchResults([]);
      setActiveHymnSearch(null);
      return;
    }

    const hymnData = { ...data.musicProgram };

    if (field === 'openingHymnNumber') {
      hymnData.openingHymnNumber = hymnNumber;
      hymnData.openingHymnTitle = hymnTitle;
      hymnData.openingHymnType = fieldSongType;
    } else if (field === 'sacramentHymnNumber') {
      hymnData.sacramentHymnNumber = hymnNumber;
      hymnData.sacramentHymnTitle = hymnTitle;
      hymnData.sacramentHymnType = fieldSongType;
    } else if (field === 'closingHymnNumber') {
      hymnData.closingHymnNumber = hymnNumber;
      hymnData.closingHymnTitle = hymnTitle;
      hymnData.closingHymnType = fieldSongType;
    }
    
    updateField('musicProgram', hymnData);
    setHymnSearchResults([]);
    setActiveHymnSearch(null);
  };

  const closeHymnSearch = () => {
    setHymnSearchResults([]);
    setActiveHymnSearch(null);
  };

  const setSongType = (field: string, type: SongType) => {
    setSongTypes(prev => ({ ...prev, [field]: type }));
    
    // Also update the data structure to persist the song type
    if (field === 'openingHymnNumber') {
      updateField('musicProgram', { 
        ...data.musicProgram, 
        openingHymnType: type 
      });
    } else if (field === 'sacramentHymnNumber') {
      updateField('musicProgram', { 
        ...data.musicProgram, 
        sacramentHymnType: type 
      });
    } else if (field === 'closingHymnNumber') {
      updateField('musicProgram', { 
        ...data.musicProgram, 
        closingHymnType: type 
      });
    } else if (field.startsWith('agenda-')) {
      const id = field.replace('agenda-', '');
      const updatedAgenda = data.agenda.map(item => 
        item.id === id ? { ...item, hymnType: type } : item
      );
      updateField('agenda', updatedAgenda);
    }
  };

  const getSongTypeForField = (field: string): SongType => {
    return songTypes[field] || 'hymn';
  };

  const getPlaceholderForField = (field: string): string => {
    const type = getSongTypeForField(field);
    if (type === 'childrens') {
      const examples = ['2', '4', '20a', '20b', '241a', '241b', '284a', '284b', '267a', '267b', '275a', '275b'];
      return `e.g., ${examples[Math.floor(Math.random() * examples.length)]}`;
    }
    return 'e.g., 9';
  };

  const addMeeting = () => {
    const newMeeting: Meeting = {
      id: generateUniqueId(),
      title: '',
      time: '',
      location: ''
    };
    updateField('meetings', [...data.meetings, newMeeting]);
  };

  const updateMeeting = (id: string, field: keyof Meeting, value: any) => {
    const updated = data.meetings.map(meeting => 
      meeting.id === id ? { ...meeting, [field]: value } : meeting
    );
    updateField('meetings', updated);
  };

  const removeMeeting = (id: string) => {
    removeWithUndo('meetings', id);
  };

  const addSpecialEvent = () => {
    const newEvent: SpecialEvent = {
      id: generateUniqueId(),
      title: '',
      date: '',
      time: '',
      location: '',
      description: ''
    };
    updateField('specialEvents', [...data.specialEvents, newEvent]);
  };

  const updateSpecialEvent = (id: string, field: keyof SpecialEvent, value: any) => {
    const updated = data.specialEvents.map(event => 
      event.id === id ? { ...event, [field]: value } : event
    );
    updateField('specialEvents', updated);
  };

  const removeSpecialEvent = (id: string) => {
    removeWithUndo('specialEvents', id);
  };

  // Add Section dropdown state and ref
  const [showAddSection, setShowAddSection] = useState(false);
  const addSectionRef = useRef<HTMLDivElement>(null);

  const handleAddSection = (type: 'speaker' | 'musical' | 'testimony' | 'sacrament' | 'baby_blessing' | 'baptism_ordinance' | 'confirmation') => {
    if (type === 'speaker') {
      updateField('agenda', [
        ...data.agenda,
        { id: generateUniqueId(), type: 'speaker', name: '', speakerType: 'adult' }
      ]);
    } else if (type === 'musical') {
      updateField('agenda', [
        ...data.agenda,
        { id: generateUniqueId(), type: 'musical', label: 'Musical Number' }
      ]);
    } else if (type === 'testimony') {
      updateField('agenda', [...data.agenda, { id: generateUniqueId(), type: 'testimony' }]);
    } else if (type === 'sacrament') {
      updateField('agenda', [...data.agenda, { id: generateUniqueId(), type: 'sacrament' }]);
    } else if (type === 'baby_blessing') {
      updateField('agenda', [...data.agenda, { id: generateUniqueId(), type: 'baby_blessing', childName: '' }]);
    } else if (type === 'baptism_ordinance') {
      updateField('agenda', [...data.agenda, { id: generateUniqueId(), type: 'baptism_ordinance', candidateName: '', performedBy: '' }]);
    } else if (type === 'confirmation') {
      updateField('agenda', [...data.agenda, { id: generateUniqueId(), type: 'confirmation', candidateName: '', performedBy: '' }]);
    }
    setShowAddSection(false);
  };

  useEffect(() => {
    if (!showAddSection) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (addSectionRef.current && !addSectionRef.current.contains(event.target as Node)) {
        setShowAddSection(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showAddSection]);

  // Image handlers
  const handleImageUploaded = async (imageId: string, imageUrl: string) => {
    // Immediately add the new image to the local state so it shows up right away
    const newImage = {
      id: imageId,
      name: 'Custom Image',
      url: imageUrl,
      isCustom: true,
      uploadDate: new Date().toISOString()
    };

    setAllImages(prev => [...prev, newImage]);
    updateField('imageId', imageId);

    // Also refresh from server to ensure consistency
    const images = await getAllImages(userId);
    setAllImages(images);
    onImagesRefresh?.(); // Notify parent to refresh its images too

    setImageError(null);
    toast.success(t('form.imageUploadedSuccessfully', 'Image uploaded successfully!'));
  };

  const handleImageError = (error: string) => {
    setImageError(error);
    toast.error(error);
  };

  const handleDeleteCustomImage = (imageId: string) => {
    setDeleteImageConfirm({ show: true, imageId });
  };

  const confirmDeleteImage = async () => {
    const imageId = deleteImageConfirm.imageId;
    if (!imageId) return;

    try {
      await deleteCustomImage(imageId, userId);
      const images = await getAllImages(userId);
      setAllImages(images); // Refresh the images list

      // If the deleted image was selected, reset to 'none'
      if (data.imageId === imageId) {
        updateField('imageId', 'none');
      }

      toast.success(t('form.customImageDeleted', 'Custom image deleted.'));
    } catch (error) {
      toast.error(t('errors.failedToDeleteImage', 'Failed to delete image.'));
    } finally {
      setDeleteImageConfirm({ show: false, imageId: null });
    }
  };

  // Default value keys
  const DEFAULT_KEYS = {
    wardName: 'default_wardName',
    presiding: 'default_presiding',
    conducting: 'default_conducting',
    chorister: 'default_chorister',
    organist: 'default_organist',
    interpreter: 'default_interpreter',
    preludeMusic: 'default_preludeMusic',
    wardLeadership: 'default_wardLeadership',
    missionaries: 'default_missionaries',
    wardMissionaries: 'default_wardMissionaries',
  };

  // Load defaults from localStorage on mount
  useEffect(() => {
    const newData = { ...data };
    let changed = false;
    if (!data.wardName && localStorage.getItem(DEFAULT_KEYS.wardName)) {
      newData.wardName = localStorage.getItem(DEFAULT_KEYS.wardName) || '';
      changed = true;
    }
    if (!data.leadership.presiding && localStorage.getItem(DEFAULT_KEYS.presiding)) {
      newData.leadership = { ...newData.leadership, presiding: localStorage.getItem(DEFAULT_KEYS.presiding) || '' };
      changed = true;
    }
    if (!data.leadership.conducting && localStorage.getItem(DEFAULT_KEYS.conducting)) {
      newData.leadership = { ...newData.leadership, conducting: localStorage.getItem(DEFAULT_KEYS.conducting) || '' };
      changed = true;
    }
    if (!data.leadership.chorister && localStorage.getItem(DEFAULT_KEYS.chorister)) {
      newData.leadership = { ...newData.leadership, chorister: localStorage.getItem(DEFAULT_KEYS.chorister) || '' };
      changed = true;
    }
    if (!data.leadership.organist && localStorage.getItem(DEFAULT_KEYS.organist)) {
      newData.leadership = { ...newData.leadership, organist: localStorage.getItem(DEFAULT_KEYS.organist) || '' };
      changed = true;
    }
    if (!data.leadership.interpreter && localStorage.getItem(DEFAULT_KEYS.interpreter)) {
      newData.leadership = { ...newData.leadership, interpreter: localStorage.getItem(DEFAULT_KEYS.interpreter) || '' };
      changed = true;
    }
    if (!data.leadership.preludeMusic && localStorage.getItem(DEFAULT_KEYS.preludeMusic)) {
      newData.leadership = { ...newData.leadership, preludeMusic: localStorage.getItem(DEFAULT_KEYS.preludeMusic) || '' };
      changed = true;
    }
    // Ward Leadership
    if ((!data.wardLeadership || data.wardLeadership.length === 0) && localStorage.getItem(DEFAULT_KEYS.wardLeadership)) {
      try {
        newData.wardLeadership = JSON.parse(localStorage.getItem(DEFAULT_KEYS.wardLeadership) || '[]');
        changed = true;
      } catch {}
    }
    // Missionaries
    if ((!data.missionaries || data.missionaries.length === 0) && localStorage.getItem(DEFAULT_KEYS.missionaries)) {
      try {
        newData.missionaries = JSON.parse(localStorage.getItem(DEFAULT_KEYS.missionaries) || '[]');
        changed = true;
      } catch {}
    }
    // Missionaries from our ward
    if ((!data.wardMissionaries || data.wardMissionaries.length === 0) && localStorage.getItem(DEFAULT_KEYS.wardMissionaries)) {
      try {
        newData.wardMissionaries = JSON.parse(localStorage.getItem(DEFAULT_KEYS.wardMissionaries) || '[]');
        changed = true;
      } catch {}
    }
    if (changed) onChange(newData);
    // eslint-disable-next-line
  }, []);

  // Handle clicking outside hymn search dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (activeHymnSearch && hymnSearchResults.length > 0) {
        const target = event.target as Element;
        if (!target.closest('.hymn-search-container')) {
          closeHymnSearch();
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [activeHymnSearch, hymnSearchResults]);

  // Save default handlers (to localStorage)
  const saveDefault = (key: keyof typeof DEFAULT_KEYS, value: any) => {
    if (key === 'wardLeadership' || key === 'missionaries' || key === 'wardMissionaries') {
      localStorage.setItem(DEFAULT_KEYS[key], JSON.stringify(value));
    } else {
      localStorage.setItem(DEFAULT_KEYS[key], value);
    }
    toast.success(t('form.defaultSaved', 'Default saved!'));
  };

  // Move agenda item up or down
  const moveAgendaItem = (idx: number, direction: -1 | 1) => {
    const newAgenda = [...data.agenda];
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= newAgenda.length) return;
    [newAgenda[idx], newAgenda[targetIdx]] = [newAgenda[targetIdx], newAgenda[idx]];
    updateField('agenda', newAgenda);
  };

  // Update agenda item and auto-populate hymn title if needed
  const updateAgendaItem = (id: string, changes: Partial<AgendaItem>) => {
    updateField('agenda', data.agenda.map(item => {
      if (item.id !== id) return item;
      if (item.type === 'musical' && 'hymnNumber' in changes) {
        const hymnNumber = changes.hymnNumber;
        if (hymnNumber && isValidSongNumber(hymnNumber, getSongTypeForField(`agenda-${id}`), currentLang)) {
          return { ...item, ...changes, hymnTitle: getSongTitle(hymnNumber, getSongTypeForField(`agenda-${id}`), currentLang) };
        } else {
          return { ...item, ...changes, hymnTitle: '' };
        }
      }
      return { ...item, ...changes };
    }));
  };

  // Add audience options - using translated labels
  const audienceOptions = [
    { value: getAudienceValue('unit'), label: getTranslatedUnitLabel(t) },
    { value: 'relief_society', label: t('terminology.reliefSociety') },
    { value: 'elders_quorum', label: t('terminology.eldersQuorum') },
    { value: 'young_women', label: t('terminology.youngWomen') },
    { value: 'young_men', label: t('terminology.youngMen') },
    { value: 'youth', label: t('terminology.youth') },
    { value: 'primary', label: t('terminology.primary') },
    { value: 'sunday_school', label: t('terminology.sundaySchool') },
    { value: 'gospel_doctrine', label: t('terminology.gospelDoctrine') },
    { value: getAudienceValue('higher_unit'), label: getTranslatedHigherUnitLabel(t) },
    { value: 'other', label: t('common.other') },
    { value: 'standalone', label: t('form.standaloneAnnouncement') }
  ];

  // State for showing the "Add New Type" dropdown
  const [showAddTypeDropdown, setShowAddTypeDropdown] = useState(false);
  const addTypeDropdownRef = useRef<HTMLDivElement>(null);

  // Click outside handler for the add type dropdown
  useEffect(() => {
    if (!showAddTypeDropdown) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (addTypeDropdownRef.current && !addTypeDropdownRef.current.contains(event.target as Node)) {
        setShowAddTypeDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showAddTypeDropdown]);

  // Helper to check if an audience is standalone (not grouped). Older
  // bulletins populated from recurring announcements carry the literal
  // 'standalone' audience without the _id suffix.
  const isStandaloneAudience = (audience: string) => {
    return audience === 'standalone' || audience.startsWith('standalone_');
  };

  const moveImage = (announcementId: string, imageIndex: number, direction: -1 | 1) => {
    const announcement = data.announcements.find(a => a.id === announcementId);
    if (!announcement || !announcement.images) return;
    
    const newImages = [...announcement.images];
    const targetIndex = imageIndex + direction;
    if (targetIndex < 0 || targetIndex >= newImages.length) return;
    
    [newImages[imageIndex], newImages[targetIndex]] = [newImages[targetIndex], newImages[imageIndex]];
    updateAnnouncement(announcementId, 'images', newImages);
  };

  const consolidateAnnouncements = () => {
    // Group announcements by audience
    const grouped = data.announcements.reduce((groups, announcement) => {
      const audience = announcement.audience || 'ward';
      if (!groups[audience]) {
        groups[audience] = [];
      }
      groups[audience].push(announcement);
      return groups;
    }, {} as Record<string, Announcement[]>);

    // Create consolidated announcements
    const consolidated: Announcement[] = [];
    
    Object.entries(grouped).forEach(([audience, announcements]) => {
      if (announcements.length === 1) {
        consolidated.push(announcements[0]);
        return;
      }

      // Merge multiple announcements for the same audience
      const titles = announcements.map(a => a.title).filter(t => t.trim());
      const contents = announcements.map(a => a.content).filter(c => c.trim());
      
      // Create content with original titles as headers and inline images
      const contentWithHeaders = announcements
        .filter(a => a.title.trim() || a.content.trim())
        .map(a => {
          const title = a.title.trim();
          const content = a.content.trim();
          
          // Collect images for this specific announcement
          const announcementImages: AnnouncementImage[] = [];
          if (a.imageId && a.imageId !== 'none') {
            announcementImages.push({
              imageId: a.imageId,
              hideImageOnPrint: a.hideImageOnPrint || false
            });
          }
          if (a.images && a.images.length > 0) {
            announcementImages.push(...a.images);
          }
          
          let result = '';
          if (title && content) {
            result = `<h4 style="font-size: 18px; font-weight: 600; margin-bottom: 8px; color: #111827; margin-top: 16px;">${title}</h4>${content}`;
          } else if (title) {
            result = `<h4 style="font-size: 18px; font-weight: 600; margin-bottom: 8px; color: #111827; margin-top: 16px;">${title}</h4>`;
          } else if (content) {
            result = content;
          }
          return result;
        })
        .filter(item => item)
        .join('<br><br>');

      // Collect all images from all announcements with deduplication
      const allImages: AnnouncementImage[] = [];
      const seenImageIds = new Set<string>();
      
      announcements.forEach(a => {
        // Add legacy single image if it exists
        if (a.imageId && a.imageId !== 'none' && !seenImageIds.has(a.imageId)) {
          allImages.push({
            imageId: a.imageId,
            hideImageOnPrint: a.hideImageOnPrint || false
          });
          seenImageIds.add(a.imageId);
        }
        // Add multiple images if they exist
        if (a.images && a.images.length > 0) {
          a.images.forEach(img => {
            if (!seenImageIds.has(img.imageId)) {
              allImages.push(img);
              seenImageIds.add(img.imageId);
            }
          });
        }
      });

      // Create a single consolidated announcement with both inline images and images array
      consolidated.push({
        id: generateUniqueId(),
        title: '', // Remove main title when consolidating
        content: contentWithHeaders, // Images are embedded inline in the content
        category: 'general',
        audience: audience as any,
        // Keep images array for form management (even though they're also inline)
        images: allImages,
        imageId: 'none',
        hideImageOnPrint: false,
        date: announcements[0].date || '',
      });
    });

    updateField('announcements', consolidated);
    toast.success(t('success.announcementsConsolidated', 'Consolidated {{total}} announcements into {{groups}} groups', { total: data.announcements.length, groups: consolidated.length }));
  };

  return (
    <div className="space-y-8 font-sans">
      {/* Tab Navigation */}
      <nav className="flex justify-center mb-4" aria-label="Main tabs">
        <ul role="tablist" className="flex flex-col gap-2 sm:flex-row sm:gap-3 w-full max-w-xs sm:max-w-none mx-auto justify-center items-center">
          {(['program', 'announcements', 'unitinfo'] as const).map(tab => (
            <li key={tab} role="presentation" className="w-full sm:w-auto">
              <button
                type="button"
                role="tab"
                id={`form-tab-${tab}`}
                tabIndex={activeTab === tab ? 0 : -1}
                aria-selected={activeTab === tab}
                aria-controls={`form-tab-panel-${tab}`}
                onKeyDown={(e) => {
                  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                  e.preventDefault();
                  const tabs = ['program', 'announcements', 'unitinfo'] as const;
                  const idx = tabs.indexOf(tab);
                  const next = tabs[(idx + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
                  setActiveTab(next);
                  document.getElementById(`form-tab-${next}`)?.focus();
                }}
                className={`w-full sm:w-auto px-4 sm:px-8 py-3 sm:py-4 rounded-full font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 border-2 transition-all duration-200 text-base sm:text-lg
                  ${activeTab === tab
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50 hover:border-gray-400 hover:text-gray-900'}
                `}
                onClick={() => setActiveTab(tab as typeof activeTab)}
              >
                {tab === 'program' ? t('bulletin.program') : tab === 'announcements' ? t('bulletin.announcements') : t('bulletin.unitInfo', { unit: getTranslatedUnitLabel(t) })}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      {/* Tab Content */}
      {activeTab === 'program' && (
        <div id="form-tab-panel-program" role="tabpanel" aria-labelledby="form-tab-program" className="space-y-8">
          {/* Basic Information */}
          <section className="space-y-4">
            <h3 className="text-xl font-medium text-gray-900 border-b pb-2 flex items-center justify-between">
              {t('form.basicInformation')}
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="form-ward-name" className="block text-base font-medium text-gray-700 mb-2">{t('form.wardName', { unit: getTranslatedUnitLabel(t) })}</label>
                <div className="flex gap-2 md:flex-col md:gap-0">
                  <input
                    id="form-ward-name"
                    type="text"
                    value={data.wardName || ''}
                    onChange={(e) => updateField('wardName', e.target.value)}
                    placeholder={t('form.wardNamePlaceholder', { unit: getTranslatedUnitLabel(t) })}
                    className="w-full px-3 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <button
                    type="button"
                    onClick={() => saveDefault('wardName', data.wardName)}
                    className="px-3 py-2 text-sm bg-gray-200 rounded hover:bg-gray-300 border border-gray-300 md:mt-2"
                    title={t('form.saveAsDefault')}
                  >
                    {t('form.saveAsDefault')}
                  </button>
                </div>
              </div>
              <div>
                <label htmlFor="form-date" className="block text-base font-medium text-gray-700 mb-2">{t('form.date')}</label>
                <input
                  id="form-date"
                  type="date"
                  value={data.date || ''}
                  onChange={(e) => updateField('date', e.target.value)}
                  className="w-full px-3 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>
            <div>
              <div>
                <label htmlFor="form-theme" className="block text-base font-medium text-gray-700 mb-2">{t('form.themeScripture')}</label>
                <input
                  id="form-theme"
                  type="text"
                  value={data.theme || ''}
                  onChange={(e) => updateField('theme', e.target.value)}
                  placeholder={t('form.weeklyThemePlaceholder')}
                  className="w-full px-3 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>

            {/* Image Selection */}
            <div>
              <label className="block text-base font-medium text-gray-700 mb-2">{t('form.bulletinImage')}</label>
              <div className="space-y-3">
                {/* Selected Image Display */}
                <div className="p-3 border border-gray-300 rounded-lg bg-white">
                  {data.imageId && data.imageId !== 'none' ? (
                    (() => {
                      const selectedImage = getImageFromCache(data.imageId);
                      return selectedImage.url ? (
                        <div className="flex items-center gap-3">
                          <img
                            src={selectedImage.url}
                            alt={selectedImage.name}
                            className="w-12 h-12 object-cover rounded-lg"
                          />
                          <div className="flex-1">
                            <p className="text-sm font-medium text-gray-900">{selectedImage.name}</p>
                            {selectedImage.description && (
                              <p className="text-xs text-gray-600">{selectedImage.description}</p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => updateField('imageId', 'none')}
                            className="text-red-600 hover:text-red-800 text-sm"
                          >
                            {t('common.remove')}
                          </button>
                        </div>
                      ) : (
                        <div className="text-sm text-gray-500">{t('form.noValidImageSelected')}</div>
                      );
                    })()
                  ) : (
                    <div className="text-sm text-gray-500">{t('form.noImageSelected')}</div>
                  )}
                </div>

                {/* Collapsible Image Gallery */}
                <details className="group">
                  <summary className="cursor-pointer p-3 bg-gray-50 rounded-lg border border-gray-200 hover:bg-gray-100 transition-colors">
                    <span className="text-sm font-medium text-gray-700">
                      {t('form.chooseImage')} ({allImages.length} {t('form.available')})
                    </span>
                    <span className="float-right text-gray-400 group-open:rotate-180 transition-transform">▼</span>
                  </summary>
                  
                  <div className="mt-2 p-3 border border-gray-200 rounded-lg bg-white max-h-96 overflow-y-auto">
                    {/* Upload Section */}
                    <div className="mb-4">
                      <ImageUpload
                        onImageUploaded={handleImageUploaded}
                        onError={handleImageError}
                        userId={userId}
                      />
                      {imageError && (
                        <p className="text-red-600 text-sm mt-2">{imageError}</p>
                      )}
                    </div>
                    
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
                      {/* Image Options */}
                      {allImages.map((image) => (
                        <div
                          key={image.id}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            // Update both imageId and imageUrl in a single onChange call to avoid race condition
                            const newImageUrl = (image.isCustom && image.url) ? image.url : undefined;
                            onChange({ ...data, imageId: image.id, imageUrl: newImageUrl });
                          }}
                          className={`relative cursor-pointer rounded-lg border-2 transition-all hover:scale-105 ${
                            data.imageId === image.id
                              ? 'border-blue-500 bg-blue-50'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                          title={image.description || image.name}
                        >
                          {image.url ? (
                            <img
                              src={image.url}
                              alt={image.name}
                              className="w-full h-12 object-cover rounded-t"
                            />
                          ) : (
                            <div className="w-full h-12 bg-gray-100 flex items-center justify-center rounded-t">
                              <span className="text-gray-500 text-xs">No Img</span>
                            </div>
                          )}
                          <div className="p-1">
                            <p className="text-xs text-gray-700 truncate">{image.name}</p>
                          </div>

                          {/* Delete button for custom images */}
                          {'isCustom' in image && image.isCustom && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteCustomImage(image.id);
                              }}
                              className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-xs hover:bg-red-600 transition-colors"
                              title="Delete custom image"
                            >
                              ×
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </details>
              </div>
            </div>
          </section>

          {/* Leadership */}
          <section className="space-y-4">
            <h3 className="text-xl font-medium text-gray-900 border-b pb-2">{t('form.leadership')}</h3>
            {/* First Row: 2 fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-base font-medium text-gray-700 mb-2">{t('form.presiding')}</label>
                <div className="flex gap-2 md:flex-col md:gap-0">
                  <input
                    type="text"
                    value={data.leadership.presiding || ''}
                    onChange={(e) => updateField('leadership', { ...data.leadership, presiding: e.target.value })}
                    placeholder={t('form.presidingPlaceholder')}
                    className="w-full px-3 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <button
                    type="button"
                    onClick={() => saveDefault('presiding', data.leadership.presiding)}
                    className="px-3 py-2 text-sm bg-gray-200 rounded hover:bg-gray-300 border border-gray-300 md:mt-2"
                    title={t('form.saveAsDefault')}
                  >
                    {t('form.saveAsDefault')}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-base font-medium text-gray-700 mb-2">{t('form.conducting')}</label>
                <div className="flex gap-2 md:flex-col md:gap-0">
                  <input
                    type="text"
                    value={data.leadership.conducting || ''}
                    onChange={(e) => updateField('leadership', { ...data.leadership, conducting: e.target.value })}
                    placeholder={t('form.conductingPlaceholder')}
                    className="w-full px-3 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <button
                    type="button"
                    onClick={() => saveDefault('conducting', data.leadership.conducting || '')}
                    className="px-3 py-2 text-sm bg-gray-200 rounded hover:bg-gray-300 border border-gray-300 md:mt-2"
                    title={t('form.saveAsDefault')}
                  >
                    {t('form.saveAsDefault')}
                  </button>
                </div>
              </div>
            </div>
            
            {/* Second Row: 3 fields */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-base font-medium text-gray-700 mb-2">{t('form.chorister')}</label>
                <div className="flex items-center gap-1.5 mb-2 min-h-[34px] flex-wrap">
                  <span
                    className={`text-[11px] sm:text-xs font-medium cursor-pointer px-2 py-1 rounded-full border transition-colors ${choristerLabel === 'Chorister' ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-200'}`}
                    onClick={() => {
                      setChoristerLabel('Chorister');
                      updateField('leadership', { ...data.leadership, choristerLabel: 'Chorister' });
                    }}
                  >
                    {t('form.chorister')}
                  </span>
                  <span
                    className={`text-[11px] sm:text-xs font-medium cursor-pointer px-2 py-1 rounded-full border transition-colors ${choristerLabel === 'Music Leader' ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-200'}`}
                    onClick={() => {
                      setChoristerLabel('Music Leader');
                      updateField('leadership', { ...data.leadership, choristerLabel: 'Music Leader' });
                    }}
                  >
                    {t('form.musicLeader')}
                  </span>
                </div>
                <div className="flex gap-2 md:flex-col md:gap-0">
                  <input
                    type="text"
                    value={data.leadership.chorister || ''}
                    onChange={(e) => updateField('leadership', { ...data.leadership, chorister: e.target.value })}
                    placeholder={t('form.choristerPlaceholder', { label: choristerLabel === 'Music Leader' ? t('form.musicLeader') : t('form.chorister') })}
                    className="w-full px-3 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <button
                    type="button"
                    onClick={() => saveDefault('chorister', data.leadership.chorister)}
                    className="px-3 py-2 text-sm bg-gray-200 rounded hover:bg-gray-300 border border-gray-300 md:mt-2"
                    title={t('form.saveAsDefault')}
                  >
                    {t('form.saveAsDefault')}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-base font-medium text-gray-700 mb-2">{t('form.organist')}</label>
                <div className="flex items-center gap-1.5 mb-2 min-h-[34px] flex-wrap">
                  <span
                    className={`text-[11px] sm:text-xs font-medium cursor-pointer px-2 py-1 rounded-full border transition-colors ${organistLabel === 'Organist' ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-200'}`}
                    onClick={() => {
                      setOrganistLabel('Organist');
                      updateField('leadership', { ...data.leadership, organistLabel: 'Organist' });
                    }}
                  >
                    {t('form.organist')}
                  </span>
                  <span
                    className={`text-[11px] sm:text-xs font-medium cursor-pointer px-2 py-1 rounded-full border transition-colors ${organistLabel === 'Pianist' ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-200'}`}
                    onClick={() => {
                      setOrganistLabel('Pianist');
                      updateField('leadership', { ...data.leadership, organistLabel: 'Pianist' });
                    }}
                  >
                    {t('form.pianist')}
                  </span>
                </div>
                <div className="flex gap-2 md:flex-col md:gap-0">
                  <input
                    type="text"
                    value={data.leadership.organist || ''}
                    onChange={(e) => updateField('leadership', { ...data.leadership, organist: e.target.value })}
                    placeholder={t('form.organistPlaceholder', { label: organistLabel === 'Pianist' ? t('form.pianist') : t('form.organist') })}
                    className="w-full px-3 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <button
                    type="button"
                    onClick={() => saveDefault('organist', data.leadership.organist)}
                    className="px-3 py-2 text-sm bg-gray-200 rounded hover:bg-gray-300 border border-gray-300 md:mt-2"
                    title={t('form.saveAsDefault')}
                  >
                    {t('form.saveAsDefault')}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-base font-medium text-gray-700 mb-2">{t('form.preludeMusic')}</label>
                {/* Add spacing to match toggle button height for alignment */}
                <div className="h-[34px] mb-2"></div>
                <div className="flex gap-2 md:flex-col md:gap-0">
                  <input
                    type="text"
                    value={data.leadership.preludeMusic || ''}
                    onChange={(e) => updateField('leadership', { ...data.leadership, preludeMusic: e.target.value })}
                    placeholder={t('form.hymnExamplePlaceholder')}
                    className="w-full px-3 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <button
                    type="button"
                    onClick={() => saveDefault('preludeMusic', data.leadership.preludeMusic || '')}
                    className="px-3 py-2 text-sm bg-gray-200 rounded hover:bg-gray-300 border border-gray-300 md:mt-2"
                    title={t('form.saveAsDefault')}
                  >
                    {t('form.saveAsDefault')}
                  </button>
                </div>
              </div>
            </div>

            {/* Interpreter (optional) */}
            <div>
              <label className="block text-base font-medium text-gray-700 mb-2">{t('form.interpreter')}</label>
              <div className="flex gap-2 md:flex-col md:gap-0">
                <input
                  type="text"
                  value={data.leadership.interpreter || ''}
                  onChange={(e) => updateField('leadership', { ...data.leadership, interpreter: e.target.value })}
                  placeholder={t('form.interpreterPlaceholder')}
                  className="w-full px-3 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <button
                  type="button"
                  onClick={() => saveDefault('interpreter', data.leadership.interpreter || '')}
                  className="px-3 py-2 text-sm bg-gray-200 rounded hover:bg-gray-300 border border-gray-300 md:mt-2"
                  title={t('form.saveAsDefault')}
                >
                  {t('form.saveAsDefault')}
                </button>
              </div>
            </div>

            {/* Virtual meeting link (Zoom, Google Meet, Teams, ...) */}
            <div>
              <label htmlFor="meeting-link-input" className="block text-base font-medium text-gray-700 mb-2">{t('bulletin.meetingLinkLabel')}</label>
              <input
                id="meeting-link-input"
                type="url"
                value={data.leadership.meetingLink || ''}
                onChange={(e) => updateField('leadership', { ...data.leadership, meetingLink: e.target.value })}
                placeholder="https://zoom.us/j/..."
                className="w-full px-3 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <p className="mt-1 text-sm text-gray-500">{t('bulletin.meetingLinkHelp')}</p>
            </div>
          </section>

          {/* Music Program */}
          <section className="space-y-4">
            <h3 className="text-xl font-medium text-gray-900 border-b pb-2">{t('bulletin.openingHymn')}</h3>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('bulletin.openingHymn')} {t('form.hymnNumber')}</label>
                <div className="flex gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => setSongType('openingHymnNumber', 'hymn')}
                    className={`px-4 py-2 rounded text-base font-medium transition-colors ${
                      getSongTypeForField('openingHymnNumber') === 'hymn'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  >
                    {t('form.hymns')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSongType('openingHymnNumber', 'childrens')}
                    className={`px-4 py-2 rounded text-base font-medium transition-colors ${
                      getSongTypeForField('openingHymnNumber') === 'childrens'
                        ? 'bg-green-600 text-white'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  >
                    {t('form.childrensSongs')}
                  </button>
                </div>
                <input
                  type="text"
                  value={data.musicProgram.openingHymnNumber || ''}
                  onChange={(e) => handleHymnNumberChange('openingHymnNumber', e.target.value)}
                  placeholder={getPlaceholderForField('openingHymnNumber')}
                  className={`w-full px-3 py-3 text-base border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                    Boolean(data.musicProgram.openingHymnNumber) && isValidSongNumber(data.musicProgram.openingHymnNumber, getSongTypeForField('openingHymnNumber'), currentLang) === false
                      ? 'border-red-300 bg-red-50'
                      : 'border-gray-300'
                  }`}
                />
                {Boolean(data.musicProgram.openingHymnNumber) && isValidSongNumber(data.musicProgram.openingHymnNumber, getSongTypeForField('openingHymnNumber'), currentLang) === false && (
                  <p className="text-sm text-red-600 mt-1">{getSongTypeForField('openingHymnNumber') === 'hymn' ? t('form.invalidHymnNumber') : t('form.invalidSongNumber')}</p>
                )}
              </div>
              <div className="relative hymn-search-container">
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('form.openingHymnTitle')}</label>
                <input
                  type="text"
                  value={data.musicProgram.openingHymnTitle || ''}
                  onChange={(e) => {
                    updateField('musicProgram', { ...data.musicProgram, openingHymnTitle: e.target.value });
                    handleHymnTitleSearch('openingHymnNumber', e.target.value);
                  }}
                  onFocus={() => {
                    if (data.musicProgram.openingHymnTitle && data.musicProgram.openingHymnTitle.length >= 2) {
                      handleHymnTitleSearch('openingHymnNumber', data.musicProgram.openingHymnTitle);
                    }
                  }}
                  placeholder={t('form.searchHymnPlaceholder')}
                  className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                    data.musicProgram.openingHymnNumber && isValidSongNumber(data.musicProgram.openingHymnNumber, getSongTypeForField('openingHymnNumber'), currentLang)
                      ? 'border-green-300 bg-green-50'
                      : 'border-gray-300'
                  }`}
                />
                {activeHymnSearch === 'openingHymnNumber' && hymnSearchResults.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {hymnSearchResults.map((hymn) => (
                      <button
                        key={`${hymn.type}-${hymn.number}`}
                        type="button"
                        onClick={() => selectHymnFromSearch('openingHymnNumber', hymn.number, hymn.title, hymn.type)}
                        className="w-full px-3 py-2 text-left hover:bg-gray-100 border-b border-gray-200 last:border-b-0"
                      >
                        <div className="flex items-center justify-between">
                          <div className="font-medium">#{hymn.number} - {hymn.title}</div>
                          <span className="text-sm bg-gray-200 px-3 py-2 rounded">
                            {hymn.type === 'hymn' ? 'H' : 'CS'}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('form.sacramentHymnNumber')}</label>
                <div className="flex gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => setSongType('sacramentHymnNumber', 'hymn')}
                    className={`px-4 py-2 rounded text-base font-medium transition-colors ${
                      getSongTypeForField('sacramentHymnNumber') === 'hymn'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  >
                    {t('form.hymns')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSongType('sacramentHymnNumber', 'childrens')}
                    className={`px-4 py-2 rounded text-base font-medium transition-colors ${
                      getSongTypeForField('sacramentHymnNumber') === 'childrens'
                        ? 'bg-green-600 text-white'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  >
                    {t('form.childrensSongs')}
                  </button>
                </div>
                <input
                  type="text"
                  value={data.musicProgram.sacramentHymnNumber || ''}
                  onChange={(e) => handleHymnNumberChange('sacramentHymnNumber', e.target.value)}
                  placeholder={getPlaceholderForField('sacramentHymnNumber')}
                  className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                    Boolean(data.musicProgram.sacramentHymnNumber) && isValidSongNumber(data.musicProgram.sacramentHymnNumber, getSongTypeForField('sacramentHymnNumber'), currentLang) === false
                      ? 'border-red-300 bg-red-50'
                      : 'border-gray-300'
                  }`}
                />
                {Boolean(data.musicProgram.sacramentHymnNumber) && isValidSongNumber(data.musicProgram.sacramentHymnNumber, getSongTypeForField('sacramentHymnNumber'), currentLang) === false && (
                  <p className="text-sm text-red-600 mt-1">{getSongTypeForField('sacramentHymnNumber') === 'hymn' ? t('form.invalidHymnNumber') : t('form.invalidSongNumber')}</p>
                )}
              </div>
              <div className="relative hymn-search-container">
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('form.sacramentHymnTitle')}</label>
                <input
                  type="text"
                  value={data.musicProgram.sacramentHymnTitle || ''}
                  onChange={(e) => {
                    updateField('musicProgram', { ...data.musicProgram, sacramentHymnTitle: e.target.value });
                    handleHymnTitleSearch('sacramentHymnNumber', e.target.value);
                  }}
                  onFocus={() => {
                    if (data.musicProgram.sacramentHymnTitle && data.musicProgram.sacramentHymnTitle.length >= 2) {
                      handleHymnTitleSearch('sacramentHymnNumber', data.musicProgram.sacramentHymnTitle);
                    }
                  }}
                  placeholder={t('form.searchHymnPlaceholder')}
                  className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                    data.musicProgram.sacramentHymnNumber && isValidSongNumber(data.musicProgram.sacramentHymnNumber, getSongTypeForField('sacramentHymnNumber'), currentLang)
                      ? 'border-green-300 bg-green-50'
                      : 'border-gray-300'
                  }`}
                />
                {activeHymnSearch === 'sacramentHymnNumber' && hymnSearchResults.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {hymnSearchResults.map((hymn) => (
                      <button
                        key={`${hymn.type}-${hymn.number}`}
                        type="button"
                        onClick={() => selectHymnFromSearch('sacramentHymnNumber', hymn.number, hymn.title, hymn.type)}
                        className="w-full px-3 py-2 text-left hover:bg-gray-100 border-b border-gray-200 last:border-b-0"
                      >
                        <div className="flex items-center justify-between">
                          <div className="font-medium">#{hymn.number} - {hymn.title}</div>
                          <span className="text-sm bg-gray-200 px-3 py-2 rounded">
                            {hymn.type === 'hymn' ? 'H' : 'CS'}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('form.closingHymnNumber')}</label>
                <div className="flex gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => setSongType('closingHymnNumber', 'hymn')}
                    className={`px-4 py-2 rounded text-base font-medium transition-colors ${
                      getSongTypeForField('closingHymnNumber') === 'hymn'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  >
                    {t('form.hymns')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSongType('closingHymnNumber', 'childrens')}
                    className={`px-4 py-2 rounded text-base font-medium transition-colors ${
                      getSongTypeForField('closingHymnNumber') === 'childrens'
                        ? 'bg-green-600 text-white'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  >
                    {t('form.childrensSongs')}
                  </button>
                </div>
                <input
                  type="text"
                  value={data.musicProgram.closingHymnNumber || ''}
                  onChange={(e) => handleHymnNumberChange('closingHymnNumber', e.target.value)}
                  placeholder={getPlaceholderForField('closingHymnNumber')}
                  className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                    Boolean(data.musicProgram.closingHymnNumber) && isValidSongNumber(data.musicProgram.closingHymnNumber, getSongTypeForField('closingHymnNumber'), currentLang) === false
                      ? 'border-red-300 bg-red-50'
                      : 'border-gray-300'
                  }`}
                />
                {Boolean(data.musicProgram.closingHymnNumber) && isValidSongNumber(data.musicProgram.closingHymnNumber, getSongTypeForField('closingHymnNumber'), currentLang) === false && (
                  <p className="text-sm text-red-600 mt-1">{getSongTypeForField('closingHymnNumber') === 'hymn' ? t('form.invalidHymnNumber') : t('form.invalidSongNumber')}</p>
                )}
              </div>
              <div className="relative hymn-search-container">
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('form.closingHymnTitle')}</label>
                <input
                  type="text"
                  value={data.musicProgram.closingHymnTitle || ''}
                  onChange={(e) => {
                    updateField('musicProgram', { ...data.musicProgram, closingHymnTitle: e.target.value });
                    handleHymnTitleSearch('closingHymnNumber', e.target.value);
                  }}
                  onFocus={() => {
                    if (data.musicProgram.closingHymnTitle && data.musicProgram.closingHymnTitle.length >= 2) {
                      handleHymnTitleSearch('closingHymnNumber', data.musicProgram.closingHymnTitle);
                    }
                  }}
                  placeholder={t('form.searchHymnPlaceholder')}
                  className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                    data.musicProgram.closingHymnNumber && isValidSongNumber(data.musicProgram.closingHymnNumber, getSongTypeForField('closingHymnNumber'), currentLang)
                      ? 'border-green-300 bg-green-50'
                      : 'border-gray-300'
                  }`}
                />
                {activeHymnSearch === 'closingHymnNumber' && hymnSearchResults.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {hymnSearchResults.map((hymn) => (
                      <button
                        key={`${hymn.type}-${hymn.number}`}
                        type="button"
                        onClick={() => selectHymnFromSearch('closingHymnNumber', hymn.number, hymn.title, hymn.type)}
                        className="w-full px-3 py-2 text-left hover:bg-gray-100 border-b border-gray-200 last:border-b-0"
                      >
                        <div className="flex items-center justify-between">
                          <div className="font-medium">#{hymn.number} - {hymn.title}</div>
                          <span className="text-sm bg-gray-200 px-3 py-2 rounded">
                            {hymn.type === 'hymn' ? 'H' : 'CS'}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Prayers */}
          <section className="space-y-4">
            <h3 className="text-lg font-medium text-gray-900 border-b pb-2">{t('form.prayers')}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('bulletin.invocation')}</label>
                <input
                  type="text"
                  value={data.prayers.opening || ''}
                  onChange={(e) => updateField('prayers', { ...data.prayers, opening: e.target.value })}
                  placeholder={t('form.invocationNamePlaceholder')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('bulletin.benediction')}</label>
                <input
                  type="text"
                  value={data.prayers.closing || ''}
                  onChange={(e) => updateField('prayers', { ...data.prayers, closing: e.target.value })}
                  placeholder={t('form.benedictionNamePlaceholder')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>
          </section>

          {/* Agenda */}
          <section className="space-y-4">
            <h3 className="text-lg font-medium text-gray-900 border-b pb-2">{t('form.agenda')}</h3>
            <div className="space-y-3">
            {data.agenda.map((item, idx) => (
              <div key={item.id} className="bg-gray-50 p-4 rounded-lg flex flex-wrap gap-2 items-center">
                {item.type === 'testimony' ? (
                  <div className="w-full space-y-2">
                    <span className="block w-full text-center font-bold text-lg text-gray-700 py-2">{t('bulletin.bearingOfTestimonies')}</span>
                    <input
                      type="text"
                      value={item.note || ''}
                      onChange={e => updateAgendaItem(item.id, { note: e.target.value })}
                      placeholder={t('form.youthPerformerPlaceholder')}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                ) : item.type === 'sacrament' ? (
                  <div className="w-full flex items-center justify-center">
                    <span className="block w-full text-center font-bold text-lg text-gray-700 py-2">{t('bulletin.administrationOfSacrament')}</span>
                  </div>
                ) : item.type === 'baby_blessing' ? (
                  <div className="w-full space-y-2">
                    <span className="block w-full text-center font-bold text-lg text-gray-700 py-2">{t('bulletin.babyBlessing')} {item.childName || '...'}</span>
                    <input
                      type="text"
                      value={item.childName || ''}
                      onChange={e => updateAgendaItem(item.id, { childName: e.target.value })}
                      placeholder={t('form.childNamePlaceholder')}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <input
                      type="text"
                      value={item.parentNames || ''}
                      onChange={e => updateAgendaItem(item.id, { parentNames: e.target.value })}
                      placeholder={t('form.parentNamesPlaceholder')}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                ) : item.type === 'baptism_ordinance' ? (
                  <div className="w-full space-y-2">
                    <span className="block w-full text-center font-bold text-lg text-gray-700 py-2">{t('bulletin.baptismOrdinance')} {item.candidateName || '...'}</span>
                    <input
                      type="text"
                      value={item.candidateName || ''}
                      onChange={e => updateAgendaItem(item.id, { candidateName: e.target.value })}
                      placeholder={t('form.candidateNamePlaceholder')}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <input
                      type="text"
                      value={item.performedBy || ''}
                      onChange={e => updateAgendaItem(item.id, { performedBy: e.target.value })}
                      placeholder={t('form.performedByPlaceholder')}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                ) : item.type === 'confirmation' ? (
                  <div className="w-full space-y-2">
                    <span className="block w-full text-center font-bold text-lg text-gray-700 py-2">{t('bulletin.confirmation')} {item.candidateName || '...'}</span>
                    <input
                      type="text"
                      value={item.candidateName || ''}
                      onChange={e => updateAgendaItem(item.id, { candidateName: e.target.value })}
                      placeholder={t('form.candidateNamePlaceholder')}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <input
                      type="text"
                      value={item.performedBy || ''}
                      onChange={e => updateAgendaItem(item.id, { performedBy: e.target.value })}
                      placeholder={t('form.performedByPlaceholder')}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                ) : item.type === 'speaker' ? (
                  <>
                    <input type="text" value={item.name || ''} onChange={e => updateAgendaItem(item.id, { name: e.target.value })} placeholder={t('form.speakerName')} className="flex-1 min-w-[120px] max-w-xs px-3 py-2 border border-gray-300 rounded-lg" />
                    {data.meetingType === 'baptism' ? (
                      <input
                        type="text"
                        value={item.customLabel || ''}
                        onChange={e => updateAgendaItem(item.id, { customLabel: e.target.value })}
                        placeholder={t('form.roleLabelPlaceholder')}
                        className="flex-1 min-w-[120px] max-w-xs px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    ) : (
                      <select value={item.speakerType || 'adult'} onChange={e => updateAgendaItem(item.id, { speakerType: e.target.value as 'youth' | 'adult' | 'highCouncil' })} className="px-2 py-1 border rounded-lg min-w-[120px]">
                        <option value="youth">{t('bulletin.youthSpeaker')}</option>
                        <option value="adult">{t('bulletin.speaker')}</option>
                        <option value="highCouncil">{t('bulletin.highCouncilSpeaker')}</option>
                      </select>
                    )}
                  </>
                ) : (
                  <div className="w-full space-y-3">
                    {/* Song Type Selection */}
                    <div className="flex gap-1 mb-2">
                      <button
                        type="button"
                        onClick={() => setSongType(`agenda-${item.id}`, 'hymn')}
                        className={`px-3 py-2 rounded text-sm font-medium transition-colors ${
                          getSongTypeForField(`agenda-${item.id}`) === 'hymn'
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                        }`}
                      >
                        {t('form.hymns')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setSongType(`agenda-${item.id}`, 'childrens')}
                        className={`px-3 py-2 rounded text-sm font-medium transition-colors ${
                          getSongTypeForField(`agenda-${item.id}`) === 'childrens'
                            ? 'bg-green-600 text-white'
                            : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                        }`}
                      >
                        {t('form.childrensSongs')}
                      </button>
                    </div>

                    {/* Type Selection */}
                    <div className="mb-3">
                      <select
                        value={item.label || 'Musical Number'}
                        onChange={e => updateAgendaItem(item.id, { label: e.target.value })}
                        className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        <option value="Musical Number">{t('bulletin.musicalNumber')}</option>
                        <option value="Intermediate Hymn">{t('form.intermediateHymn')}</option>
                      </select>
                    </div>

                    {/* Hymn/Song Selection */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          {getSongTypeForField(`agenda-${item.id}`) === 'hymn' ? 'Hymn' : 'Song'} Number
                        </label>
                        <input
                          type="text"
                          value={item.hymnNumber || ''}
                          onChange={e => handleHymnNumberChange(`agenda-${item.id}`, e.target.value)}
                          placeholder={getPlaceholderForField(`agenda-${item.id}`)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                      
                      <div className="relative">
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          {getSongTypeForField(`agenda-${item.id}`) === 'hymn' ? 'Hymn' : 'Song'} Title
                        </label>
                        <input
                          type="text"
                          value={item.hymnTitle || ''}
                          onChange={e => {
                            updateAgendaItem(item.id, { hymnTitle: e.target.value });
                            handleHymnTitleSearch(`agenda-${item.id}`, e.target.value);
                          }}
                          onFocus={() => {
                            if (item.hymnTitle && item.hymnTitle.length >= 2) {
                              handleHymnTitleSearch(`agenda-${item.id}`, item.hymnTitle);
                            }
                          }}
                          placeholder={`Search ${getSongTypeForField(`agenda-${item.id}`) === 'hymn' ? 'hymn' : 'song'} title...`}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          readOnly={!!item.hymnNumber}
                        />
                        {activeHymnSearch === `agenda-${item.id}` && hymnSearchResults.length > 0 && (
                          <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                            {hymnSearchResults.map(hymn => (
                              <button
                                key={`${hymn.type}-${hymn.number}`}
                                type="button"
                                onClick={() => selectHymnFromSearch(`agenda-${item.id}`, hymn.number, hymn.title, hymn.type)}
                                className="w-full px-3 py-2 text-left hover:bg-gray-100 border-b border-gray-200 last:border-b-0"
                              >
                                <div className="flex items-center justify-between">
                                  <div className="font-medium">#{hymn.number} - {hymn.title}</div>
                                  <span className="text-sm bg-gray-200 px-3 py-2 rounded">
                                    {hymn.type === 'hymn' ? 'H' : 'CS'}
                                  </span>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Additional Info */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">{t('form.songNameIfNotHymn')}</label>
                        <input
                          type="text"
                          value={item.songName || ''}
                          onChange={e => updateAgendaItem(item.id, { songName: e.target.value })}
                          placeholder={t('form.specialMusicalPlaceholder')}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">{t('form.performersOptional')}</label>
                        <input
                          type="text"
                          value={item.performers || ''}
                          onChange={e => updateAgendaItem(item.id, { performers: e.target.value })}
                          placeholder={t('form.performerPlaceholder')}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                    </div>
                  </div>
                )}
                <div className="flex flex-row items-center space-x-2">
                  <button onClick={() => moveAgendaItem(idx, -1)} disabled={idx === 0} className="px-3 py-2 text-gray-600 hover:text-black disabled:opacity-30 text-lg">↑</button>
                  <button onClick={() => moveAgendaItem(idx, 1)} disabled={idx === data.agenda.length - 1} className="px-3 py-2 text-gray-600 hover:text-black disabled:opacity-30 text-lg">↓</button>
                  <button onClick={() => removeWithUndo('agenda', item.id)} className="ml-2 px-3 py-2 text-red-600 hover:bg-red-100 rounded-full text-sm">{t('common.remove')}</button>
                </div>
              </div>
            ))}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">
              <button
                type="button"
                onClick={() => handleAddSection('speaker')}
                className="px-4 py-3 bg-blue-600 text-white rounded-lg text-base font-medium hover:bg-blue-700 transition-colors"
              >
                {t('form.addSpeaker')}
              </button>
              <button
                type="button"
                onClick={() => handleAddSection('musical')}
                className="px-4 py-3 bg-green-600 text-white rounded-lg text-base font-medium hover:bg-green-700 transition-colors"
              >
                {t('form.addMusicalNumber')}
              </button>
              <button
                type="button"
                onClick={() => handleAddSection('testimony')}
                className="px-4 py-3 bg-purple-600 text-white rounded-lg text-base font-medium hover:bg-purple-700 transition-colors"
              >
                {t('form.addTestimonies')}
              </button>
              <button
                type="button"
                onClick={() => handleAddSection('sacrament')}
                className="px-4 py-3 bg-orange-600 text-white rounded-lg text-base font-medium hover:bg-orange-700 transition-colors"
              >
                {t('form.addSacrament')}
              </button>
              <button
                type="button"
                onClick={() => handleAddSection('baby_blessing')}
                className="px-4 py-3 bg-pink-600 text-white rounded-lg text-base font-medium hover:bg-pink-700 transition-colors"
              >
                {t('form.addBabyBlessing')}
              </button>
              <button
                type="button"
                onClick={() => handleAddSection('baptism_ordinance')}
                className="px-4 py-3 bg-cyan-600 text-white rounded-lg text-base font-medium hover:bg-cyan-700 transition-colors"
              >
                {t('form.addBaptism')}
              </button>
              <button
                type="button"
                onClick={() => handleAddSection('confirmation')}
                className="px-4 py-3 bg-teal-600 text-white rounded-lg text-base font-medium hover:bg-teal-700 transition-colors"
              >
                {t('form.addConfirmation')}
              </button>
            </div>
          </section>
        </div>
      )}
      {activeTab === 'announcements' && (
        <div id="form-tab-panel-announcements" role="tabpanel" aria-labelledby="form-tab-announcements" className="space-y-8">
          {/* Announcements Section */}
          <section className="space-y-4">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="text-lg font-medium text-gray-900">{t('bulletin.announcements')}</h3>
              {data.announcements.length > 1 && (
                <button
                  onClick={consolidateAnnouncements}
                  className="px-4 py-2 text-base bg-blue-600 text-white rounded hover:bg-blue-700"
                  title={t('form.consolidateTooltip')}
                >
                  {t('form.consolidate')}
                </button>
              )}
            </div>
            
            {/* Submissions Notice */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-start space-x-3">
                <div className="flex-shrink-0">
                  <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h4 className="text-sm font-medium text-blue-900 mb-1">💡 {t('form.newMemberSubmissions', { unit: getTranslatedUnitLabel(t) })}</h4>
                  <p className="text-sm text-blue-800 mb-2">
                    {t('form.membersCanSubmit', { unit: getTranslatedUnitLabel(t), unitLower: getTranslatedUnitLowercase(t) })}
                  </p>
                  <div className="flex items-center space-x-2 text-sm text-blue-700">
                    <span>📋 {t('form.getSubmissionsLinkFromQr')}</span>
                    <span>•</span>
                    <span>✅ {t('form.reviewSubmissionsInToolbar')}</span>
                  </div>
                </div>
              </div>
            </div>
            {(() => {
              // Group announcements by audience/type (but keep standalone announcements separate)
              const grouped = data.announcements.reduce((groups, announcement) => {
                const audience = announcement.audience || 'ward';
                // Standalone announcements each get their own "group" (single item)
                if (!groups[audience]) {
                  groups[audience] = [];
                }
                groups[audience].push(announcement);
                return groups;
              }, {} as Record<string, Announcement[]>);

              // Get all used audiences and add default if empty
              const usedAudiences = Object.keys(grouped);
              if (usedAudiences.length === 0) {
                grouped['ward'] = [];
              }

              return Object.entries(grouped).map(([audience, announcements]) => {
                const isStandalone = isStandaloneAudience(audience);
                const audienceLabel = isStandalone
                  ? 'Standalone'
                  : (audienceOptions.find(opt => opt.value === audience)?.label || getAudienceDisplayName(audience));

                // Get the index of this group's first announcement in the full list for move operations
                const allAudienceKeys = Object.keys(grouped);

                return (
                  <div key={audience} className="border border-gray-200 rounded-lg p-4 mb-4 bg-white">
                    {/* Type Header */}
                    <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-200">
                      <div className="flex items-center gap-3 flex-1">
                        {/* Move the whole section up/down past its neighbor.
                            Only meaningful when more than one section exists. */}
                        {allAudienceKeys.length > 1 && (
                          <div className="flex flex-col flex-shrink-0 -my-1">
                            <button
                              type="button"
                              onClick={() => moveSection(audience, -1)}
                              disabled={sectionGroupPosition(audience).first}
                              title={t('form.moveSectionUp')}
                              aria-label={t('form.moveSectionUp')}
                              className="px-2 leading-none text-gray-500 hover:text-black disabled:opacity-30 disabled:hover:text-gray-500 transition-colors"
                            >
                              ▲
                            </button>
                            <button
                              type="button"
                              onClick={() => moveSection(audience, 1)}
                              disabled={sectionGroupPosition(audience).last}
                              title={t('form.moveSectionDown')}
                              aria-label={t('form.moveSectionDown')}
                              className="px-2 leading-none text-gray-500 hover:text-black disabled:opacity-30 disabled:hover:text-gray-500 transition-colors"
                            >
                              ▼
                            </button>
                          </div>
                        )}
                        {isStandalone ? (
                          <input
                            type="text"
                            value={announcements[0]?.customAudienceLabel || ''}
                            onChange={e => {
                              const updated = data.announcements.map(ann =>
                                ann.audience === audience ? { ...ann, customAudienceLabel: e.target.value } : ann
                              );
                              updateField('announcements', updated);
                            }}
                            placeholder={t('form.sectionLabelPlaceholder')}
                            className="text-lg font-semibold text-gray-900 border border-gray-300 bg-white rounded px-3 py-1 focus:ring-2 focus:ring-blue-500 focus:border-transparent max-w-xs"
                          />
                        ) : (
                          <>
                            <select
                              value={audience}
                              onChange={e => {
                                // Update all announcements in this group to the new audience
                                const updated = data.announcements.map(ann =>
                                  ann.audience === audience ? { ...ann, audience: e.target.value } : ann
                                );
                                updateField('announcements', updated);
                              }}
                              className="text-lg font-semibold text-gray-900 border-0 bg-transparent focus:ring-2 focus:ring-blue-500 rounded px-2 py-1"
                            >
                              {/* Stored values are terminology-dependent ('ward' vs 'branch',
                                  'stake' vs 'district/stake'), so a bulletin saved under the
                                  other unit type can hold a value not in today's options —
                                  include it so the select never renders blank. */}
                              {!audienceOptions.some(opt => opt.value === audience) && (
                                <option value={audience}>{getAudienceDisplayName(audience)}</option>
                              )}
                              {audienceOptions.filter(opt => opt.value !== 'standalone').map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                              ))}
                            </select>
                            <span className="text-sm text-gray-500">({announcements.length} {announcements.length === 1 ? t('form.announcement', 'announcement') : t('form.announcements', 'announcements')})</span>
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {!isStandalone && (
                          <button
                            type="button"
                            onClick={() => addAnnouncementToType(audience)}
                            className="inline-flex items-center px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
                          >
                            <Plus className="w-4 h-4 mr-1" />
                            {t('form.addTitle')}
                          </button>
                        )}
                        {/* Remove Type button - only for empty grouped sections */}
                        {!isStandalone && announcements.length === 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              const updated = data.announcements.filter(ann => ann.audience !== audience);
                              updateField('announcements', updated);
                            }}
                            className="px-3 py-1.5 text-red-600 text-sm rounded-lg hover:bg-red-50 transition-colors border border-red-200"
                          >
                            {t('form.removeType')}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Announcement Titles under this Type */}
                    {announcements.length === 0 ? (
                      <div className="text-center py-8 text-gray-500">
                        <p className="mb-2">{t('form.noAnnouncementsYetFor', { audience: audienceLabel })}</p>
                        <button
                          type="button"
                          onClick={() => addAnnouncementToType(audience)}
                          className="text-blue-600 hover:text-blue-800 underline"
                        >
                          {t('form.addYourFirstAnnouncement')}
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {announcements.map((announcement) => (
                          <div key={announcement.id} className="bg-gray-50 rounded-lg">
                            {/* Collapsed header: title + badges, click to expand.
                                The editor below only mounts while expanded. */}
                            <button
                              type="button"
                              onClick={() => toggleAnnouncementExpanded(announcement.id)}
                              aria-expanded={isAnnouncementExpanded(announcement.id)}
                              className="w-full flex items-center gap-2 px-4 py-3 text-left rounded-lg hover:bg-gray-100 transition-colors"
                            >
                              <svg
                                className={`w-4 h-4 text-gray-500 flex-shrink-0 transition-transform ${isAnnouncementExpanded(announcement.id) ? 'rotate-90' : ''}`}
                                fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                              <span className="flex-1 min-w-0 truncate font-medium text-gray-900">
                                {announcement.title
                                  || (announcement.content || '').replace(/<[^>]*>/g, '').trim().slice(0, 60)
                                  || t('form.untitledAnnouncement', 'Untitled announcement')}
                              </span>
                              {announcement.hideOnPrint && (
                                <span className="flex-shrink-0 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                                  {t('form.webOnly', 'Web only')}
                                </span>
                              )}
                            </button>
                            {isAnnouncementExpanded(announcement.id) && (
                            <div className="flex-1 space-y-3 px-4 pb-4">
                              {/* Title row */}
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={announcement.title}
                                  onChange={(e) => updateAnnouncement(announcement.id, 'title', e.target.value)}
                                  placeholder={t('form.announcementTitlePlaceholder')}
                                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-medium"
                                />
                              </div>
                              {/* Action buttons row */}
                              <div className="flex items-center gap-2 flex-wrap">
                                {/* Up/Down buttons - move announcement within its audience group */}
                                <button
                                  onClick={() => moveAnnouncementInGroup(announcement.id, -1)}
                                  disabled={announcementGroupPosition(announcement.id).first}
                                  className="px-2 py-1 flex items-center gap-1 text-gray-600 hover:text-black disabled:opacity-30 text-sm rounded-lg hover:bg-gray-100 transition-colors border border-gray-200"
                                  title={t('form.moveUp')}
                                >
                                  ↑ {t('form.up')}
                                </button>
                                <button
                                  onClick={() => moveAnnouncementInGroup(announcement.id, 1)}
                                  disabled={announcementGroupPosition(announcement.id).last}
                                  className="px-2 py-1 flex items-center gap-1 text-gray-600 hover:text-black disabled:opacity-30 text-sm rounded-lg hover:bg-gray-100 transition-colors border border-gray-200"
                                  title={t('form.moveDown')}
                                >
                                  ↓ {t('form.down')}
                                </button>
                                <label className="px-2 py-1 flex items-center gap-1.5 text-sm text-gray-600 rounded-lg border border-gray-200 hover:bg-gray-100 transition-colors cursor-pointer" title={t('form.webOnlyHelp', 'Shown online but left off the printed program')}>
                                  <input
                                    type="checkbox"
                                    checked={announcement.hideOnPrint || false}
                                    onChange={(e) => updateAnnouncement(announcement.id, 'hideOnPrint', e.target.checked)}
                                    className="h-3.5 w-3.5 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                                  />
                                  {t('form.webOnly', 'Web only')}
                                </label>
                                {/* Make Standalone button - only show for grouped announcements */}
                                {!isStandalone && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      // Convert this announcement to standalone
                                      const updated = data.announcements.map(ann =>
                                        ann.id === announcement.id
                                          ? { ...ann, audience: `standalone_${generateUniqueId()}`, customAudienceLabel: announcement.title || '' }
                                          : ann
                                      );
                                      updateField('announcements', updated);
                                    }}
                                    className="px-2 py-1 flex items-center gap-1 text-gray-600 hover:bg-gray-100 text-sm rounded-lg transition-colors border border-gray-200"
                                    title={t('form.makeStandalone')}
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                                    </svg>
                                    {t('form.makeStandalone')}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => convertToRecurring(announcement)}
                                  className="px-2 py-1 flex items-center gap-1 text-green-600 hover:bg-green-100 text-sm rounded-lg transition-colors border border-green-200"
                                  title={t('form.saveAsRecurring')}
                                >
                                  <RotateCcw className="w-4 h-4" />
                                  {t('form.saveAsRecurring')}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeAnnouncement(announcement.id)}
                                  className="px-2 py-1 flex items-center gap-1 text-red-600 hover:bg-red-100 text-sm rounded-lg transition-colors border border-red-200"
                                  title={t('common.delete')}
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                                  </svg>
                                  {t('common.delete')}
                                </button>
                              </div>
                              <HtmlEditor
                                value={announcement.content}
                                onChange={getAnnouncementContentHandler(announcement.id)}
                                placeholder={t('form.announcementContentPlaceholder')}
                              />
                  
                  {/* Announcement Image Section */}
                  <div className="mt-4 p-3 sm:p-4 border border-gray-200 rounded-lg bg-gray-50">
                    <label className="block text-sm font-medium text-gray-700 mb-2">{t('form.announcementImages')}</label>
                    
                    {/* Display current images */}
                    {(announcement.images && announcement.images.length > 0) || (announcement.imageId && announcement.imageId !== 'none') ? (
                      <div className="space-y-3 mb-4">
                        {/* Legacy single image - only show if no multiple images */}
                        {announcement.imageId && announcement.imageId !== 'none' && (!announcement.images || announcement.images.length === 0) && (
                          <div className="flex items-center gap-3 p-2 bg-white rounded border">
                            {(() => {
                              const selectedImage = getImageFromCache(announcement.imageId);
                              return selectedImage.url ? (
                                <img
                                  src={selectedImage.url}
                                  alt={selectedImage.name}
                                  className="w-16 h-16 object-cover rounded border"
                                />
                              ) : null;
                            })()}
                            <div className="flex-1">
                              <p className="text-sm font-medium text-gray-900">{getImageFromCache(announcement.imageId).name}</p>
                              <div className="flex items-center gap-2">
                                <label className="flex items-center text-xs">
                                  <input
                                    type="checkbox"
                                    checked={announcement.hideImageOnPrint || false}
                                    onChange={(e) => updateAnnouncement(announcement.id, 'hideImageOnPrint', e.target.checked)}
                                    className="h-3 w-3 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                                  />
                                  <span className="ml-1">{t('form.hideFromPrint')}</span>
                                </label>
                                <button
                                  type="button"
                                  onClick={() => updateAnnouncement(announcement.id, 'imageId', 'none')}
                                  className="text-red-600 hover:text-red-800 text-xs"
                                >
                                  {t('common.remove', 'Remove')}
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                        
                        {/* Multiple images */}
                        {announcement.images && announcement.images.map((img, index) => {
                          // Use imageUrl if available (for Supabase Storage images), otherwise get from cache
                          const selectedImage = getImageFromCache(img.imageId);
                          const imageUrl = img.imageUrl || selectedImage?.url;
                          const imageName = selectedImage?.name || 'Custom Image';
                          return imageUrl ? (
                            <div key={index} className="flex items-start gap-2 sm:gap-3 p-2 sm:p-3 bg-white rounded border">
                              {/* Drag handle and reorder buttons */}
                              <div className="flex flex-col items-center gap-1 flex-shrink-0">
                                <GripVertical className="w-4 h-4 text-gray-400 cursor-move" />
                                <div className="flex flex-col gap-1">
                                  <button
                                    type="button"
                                    onClick={() => moveImage(announcement.id, index, -1)}
                                    disabled={index === 0}
                                    className="w-5 h-5 sm:w-6 sm:h-6 flex items-center justify-center text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed text-xs sm:text-sm"
                                    title="Move up"
                                  >
                                    ↑
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => moveImage(announcement.id, index, 1)}
                                    disabled={index === (announcement.images?.length || 0) - 1}
                                    className="w-5 h-5 sm:w-6 sm:h-6 flex items-center justify-center text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed text-xs sm:text-sm"
                                    title="Move down"
                                  >
                                    ↓
                                  </button>
                                </div>
                              </div>
                              
                              <img
                                src={imageUrl}
                                alt={imageName}
                                className="w-12 h-12 sm:w-16 sm:h-16 object-cover rounded border flex-shrink-0"
                                onError={(e) => {
                                  // Silently hide broken images (may be deleted from storage)
                                  (e.target as HTMLImageElement).style.display = 'none';
                                }}
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs sm:text-sm font-medium text-gray-900 truncate">{imageName}</p>
                                <div className="flex flex-col gap-2 mt-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <label className="flex items-center text-xs">
                                      <input
                                        type="checkbox"
                                        checked={img.hideImageOnPrint || false}
                                        onChange={(e) => {
                                          const updatedImages = [...(announcement.images || [])];
                                          updatedImages[index] = { ...updatedImages[index], hideImageOnPrint: e.target.checked };
                                          updateAnnouncement(announcement.id, 'images', updatedImages);
                                        }}
                                        className="h-3 w-3 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                                      />
                                      <span className="ml-1">{t('form.hideFromPrint')}</span>
                                    </label>
                                    
                                    <label className="flex items-center text-xs">
                                      <span className="mr-1">Size:</span>
                                      <select
                                        value={img.size || 'medium'}
                                        onChange={(e) => {
                                          const updatedImages = [...(announcement.images || [])];
                                          updatedImages[index] = { ...updatedImages[index], size: e.target.value as 'small' | 'medium' | 'large' | 'xlarge' };
                                          updateAnnouncement(announcement.id, 'images', updatedImages);
                                        }}
                                        className="text-xs border border-gray-300 rounded px-1 py-0.5 min-w-0 max-w-32"
                                      >
                                        <option value="small">{t('form.imageSizeSmall', 'Small (120px)')}</option>
                                        <option value="medium">{t('form.imageSizeMedium', 'Medium (200px)')}</option>
                                        <option value="large">{t('form.imageSizeLarge', 'Large (300px)')}</option>
                                        <option value="xlarge">{t('form.imageSizeXLarge', 'X-Large (400px)')}</option>
                                      </select>
                                    </label>
                                  </div>
                                  
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const updatedImages = (announcement.images || []).filter((_, i) => i !== index);
                                      updateAnnouncement(announcement.id, 'images', updatedImages);
                                    }}
                                    className="text-red-600 hover:text-red-800 text-xs self-start"
                                  >
                                    {t('common.remove', 'Remove')}
                                  </button>
                                </div>
                              </div>
                            </div>
                          ) : null;
                        })}
                      </div>
                    ) : null}
                    
                    {/* Add new image */}
                    <div className="mb-3">
                      <ImageUpload
                        onImageUploaded={async (imageId, imageUrl) => {
                          const newImage = {
                            imageId,
                            imageUrl, // Store the Supabase public URL
                            hideImageOnPrint: false,
                            size: 'medium' as const
                          };
                          const currentImages = announcement.images || [];
                          updateAnnouncement(announcement.id, 'images', [...currentImages, newImage]);

                          // Refresh the images list to show the newly uploaded image
                          const images = await getAllImages(userId);
                          setAllImages(images);
                        }}
                        onError={handleImageError}
                        userId={userId}
                      />
                    </div>
                    
                    {/* Quick select from existing images */}
                    <details className="mt-3">
                      <summary className="cursor-pointer text-sm text-blue-600 hover:text-blue-800">
                        Or choose from existing images ({allImages.length - 1} available)
                      </summary>
                      <div className="mt-2 grid grid-cols-4 sm:grid-cols-6 gap-2 max-h-32 overflow-y-auto">
                        {allImages.filter(img => img.id !== 'none').map((image) => (
                          <div
                            key={image.id}
                            onClick={() => {
                              const newImage = {
                                imageId: image.id,
                                imageUrl: image.url, // Store the URL for Supabase images
                                hideImageOnPrint: false,
                                size: 'medium' as const
                              };
                              const currentImages = announcement.images || [];
                              updateAnnouncement(announcement.id, 'images', [...currentImages, newImage]);
                            }}
                            className="relative cursor-pointer rounded border-2 border-gray-200 hover:border-blue-300 transition-colors"
                            title={image.description || image.name}
                          >
                            {image.url ? (
                              <img
                                src={image.url}
                                alt={image.name}
                                className="w-full h-12 object-cover rounded"
                              />
                            ) : (
                              <div className="w-full h-12 bg-gray-100 flex items-center justify-center rounded">
                                <span className="text-gray-500 text-xs">No Img</span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </details>
                  </div>
                            </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              });
            })()}
            <div className="flex flex-col sm:flex-row gap-3 mt-4">
              {/* Add New Type Dropdown */}
              <div className="relative" ref={addTypeDropdownRef}>
                <button
                  onClick={() => setShowAddTypeDropdown(!showAddTypeDropdown)}
                  className="inline-flex items-center justify-center w-full sm:w-auto px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-base"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  {t('form.addAnnouncement')}
                  <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showAddTypeDropdown && (
                  <div className="absolute left-0 mt-2 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
                    <div className="py-2">
                      <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide border-b">
                        {t('form.groupedByType')}
                      </div>
                      {audienceOptions.filter(opt => opt.value !== 'standalone').map(opt => (
                        <button
                          key={opt.value}
                          onClick={() => {
                            addAnnouncement(opt.value);
                            setShowAddTypeDropdown(false);
                          }}
                          className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700"
                        >
                          {opt.label}
                        </button>
                      ))}
                      <div className="border-t my-1"></div>
                      <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        {t('form.noGrouping')}
                      </div>
                      <button
                        onClick={() => {
                          addStandaloneAnnouncement();
                          setShowAddTypeDropdown(false);
                        }}
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 font-medium"
                      >
                        {t('form.standaloneAnnouncement')}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={() => setShowRecurringAnnouncements(true)}
                disabled={!profileSlug}
                className="inline-flex items-center justify-center w-full sm:w-auto px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-base disabled:opacity-50 disabled:cursor-not-allowed"
                title={!profileSlug ? t('qrCode.createYourProfile') : t('form.recurringAnnouncements')}
              >
                <Repeat className="w-4 h-4 mr-1" />
                {t('form.recurringAnnouncements')}
              </button>
            </div>
          </section>
        </div>
      )}
      {activeTab === 'unitinfo' && (
        <div id="form-tab-panel-unitinfo" role="tabpanel" aria-labelledby="form-tab-unitinfo" className="space-y-8">
          {/* Ward Leadership Section */}
          <section className="space-y-4">
            <h3 className="text-xl font-medium text-gray-900 border-b pb-2 flex items-center justify-between">{t('terminology.wardLeadership', { unit: getTranslatedUnitLabel(t) })}
              <div className="flex flex-col items-end ml-2">
                <button
                  type="button"
                  onClick={() => saveDefault('wardLeadership', data.wardLeadership)}
                  className="px-3 py-2 text-sm bg-gray-200 rounded hover:bg-gray-300 border border-gray-300"
                  title={t('form.saveAsDefault')}
                >
                  {t('form.saveAsDefault')}
                </button>
                <span className="text-sm text-gray-500 mt-1">{t('form.savesAsYourTemplate')}</span>
              </div>
            </h3>
            
            {/* Desktop view */}
            <div className="hidden md:block overflow-x-auto">
              <table className="min-w-full border text-sm rounded-lg overflow-hidden bg-white shadow-sm">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-3 py-2 border-b text-sm">{t('form.title')}</th>
                    <th className="px-3 py-2 border-b text-sm">{t('form.name')}</th>
                    <th className="px-3 py-2 border-b text-sm">{t('form.contact')}</th>
                    <th className="px-3 py-2 border-b text-sm"></th>
                  </tr>
                </thead>
                <tbody>
                  {data.wardLeadership.map((entry, idx) => (
                    <tr key={idx} className="hover:bg-blue-50 transition">
                      <td className="border-b px-3 py-2">
                        <input
                          type="text"
                          value={entry.title}
                          onChange={e => {
                            const updated = [...data.wardLeadership];
                            updated[idx] = { ...updated[idx], title: e.target.value };
                            updateField('wardLeadership', updated);
                          }}
                          className="w-full px-3 py-3 text-base border rounded bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </td>
                      <td className="border-b px-3 py-2">
                        <input
                          type="text"
                          value={entry.name}
                          onChange={e => {
                            const updated = [...data.wardLeadership];
                            updated[idx] = { ...updated[idx], name: e.target.value };
                            updateField('wardLeadership', updated);
                          }}
                          className="w-full px-3 py-3 text-base border rounded bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </td>
                      <td className="border-b px-3 py-2">
                        <input
                          type="text"
                          value={entry.phone || ''}
                          onChange={e => {
                            const updated = [...data.wardLeadership];
                            updated[idx] = { ...updated[idx], phone: e.target.value };
                            updateField('wardLeadership', updated);
                          }}
                          className="w-full px-3 py-3 text-base border rounded bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </td>
                      <td className="border-b px-3 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => {
                            const updated = data.wardLeadership.filter((_, i) => i !== idx);
                            updateField('wardLeadership', updated);
                          }}
                          className="px-4 py-2 text-sm bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors font-medium"
                          title={t('common.remove')}
                        >
                          {t('common.remove')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            {/* Mobile view */}
            <div className="md:hidden space-y-4">
              {data.wardLeadership.map((entry, idx) => (
                <div key={idx} className="bg-white border rounded-lg p-4 shadow-sm">
                  <div className="space-y-3">
                    <div>
                      <label className="block text-base font-medium text-gray-700 mb-2">{t('form.title')}</label>
                      <input
                        type="text"
                        value={entry.title}
                        onChange={e => {
                          const updated = [...data.wardLeadership];
                          updated[idx] = { ...updated[idx], title: e.target.value };
                          updateField('wardLeadership', updated);
                        }}
                        className="w-full px-3 py-3 text-base border rounded bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-base font-medium text-gray-700 mb-2">{t('form.name')}</label>
                      <input
                        type="text"
                        value={entry.name}
                        onChange={e => {
                          const updated = [...data.wardLeadership];
                          updated[idx] = { ...updated[idx], name: e.target.value };
                          updateField('wardLeadership', updated);
                        }}
                        className="w-full px-3 py-3 text-base border rounded bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-base font-medium text-gray-700 mb-2">{t('form.contact')}</label>
                      <input
                        type="text"
                        value={entry.phone || ''}
                        onChange={e => {
                          const updated = [...data.wardLeadership];
                          updated[idx] = { ...updated[idx], phone: e.target.value };
                          updateField('wardLeadership', updated);
                        }}
                        className="w-full px-3 py-3 text-base border rounded bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                    <div className="pt-2">
                      <button
                        type="button"
                        onClick={() => {
                          const updated = data.wardLeadership.filter((_, i) => i !== idx);
                          updateField('wardLeadership', updated);
                        }}
                        className="w-full px-4 py-2 text-sm bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors font-medium"
                        title={t('common.remove', 'Remove')}
                      >
                        {t('common.remove', 'Remove')}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            
            <button
              type="button"
              onClick={() => updateField('wardLeadership', [...data.wardLeadership, { title: '', name: '', phone: '' }])}
              className="mt-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-base"
            >
              {t('form.addLeadershipPosition')}
            </button>
          </section>

          {/* Missionaries Section */}
          <section className="space-y-4 mt-8">
            <h3 className="text-xl font-medium text-gray-900 border-b pb-2 flex items-center justify-between">{t('form.missionaries')}
              <div className="flex flex-col items-end ml-2">
                <button
                  type="button"
                  onClick={() => saveDefault('missionaries', data.missionaries)}
                  className="px-3 py-2 text-sm bg-gray-200 rounded hover:bg-gray-300 border border-gray-300"
                  title={t('form.saveAsDefault')}
                >
                  {t('form.saveAsDefault')}
                </button>
                <span className="text-sm text-gray-500 mt-1">{t('form.savesAllInfoAsTemplate')}</span>
              </div>
            </h3>
            
            {/* Desktop view */}
            <div className="hidden md:block overflow-x-auto">
              <table className="min-w-full border text-sm rounded-lg overflow-hidden bg-white shadow-sm">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-3 py-2 border-b text-sm">{t('form.name')}</th>
                    <th className="px-3 py-2 border-b text-sm">{t('form.contact')}</th>
                    <th className="px-3 py-2 border-b text-sm"></th>
                  </tr>
                </thead>
                <tbody>
                  {data.missionaries.map((entry, idx) => (
                    <tr key={idx} className="hover:bg-blue-50 transition">
                      <td className="border-b px-3 py-2">
                        <input
                          type="text"
                          value={entry.name}
                          onChange={e => {
                            const updated = [...data.missionaries];
                            updated[idx] = { ...updated[idx], name: e.target.value };
                            updateField('missionaries', updated);
                          }}
                          className="w-full px-3 py-3 text-base border rounded bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder={t('form.missionaryNamePlaceholder')}
                        />
                      </td>
                      <td className="border-b px-3 py-2">
                        <input
                          type="text"
                          value={entry.phone || ''}
                          onChange={e => {
                            const updated = [...data.missionaries];
                            updated[idx] = { ...updated[idx], phone: e.target.value };
                            updateField('missionaries', updated);
                          }}
                          className="w-full px-3 py-3 text-base border rounded bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder={t('form.contactInfoPlaceholder')}
                        />
                      </td>
                      <td className="border-b px-3 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => {
                            const updated = data.missionaries.filter((_, i) => i !== idx);
                            updateField('missionaries', updated);
                          }}
                          className="px-4 py-2 text-sm bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors font-medium"
                          title={t('common.remove')}
                        >
                          {t('common.remove')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            {/* Mobile view */}
            <div className="md:hidden space-y-4">
              {data.missionaries.map((entry, idx) => (
                <div key={idx} className="bg-white border rounded-lg p-4 shadow-sm">
                  <div className="space-y-3">
                    <div>
                      <label className="block text-base font-medium text-gray-700 mb-2">{t('form.name')}</label>
                      <input
                        type="text"
                        value={entry.name}
                        onChange={e => {
                          const updated = [...data.missionaries];
                          updated[idx] = { ...updated[idx], name: e.target.value };
                          updateField('missionaries', updated);
                        }}
                        className="w-full px-3 py-3 text-base border rounded bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder={t('form.missionaryNamePlaceholder')}
                      />
                    </div>
                    <div>
                      <label className="block text-base font-medium text-gray-700 mb-2">{t('form.contact')}</label>
                      <input
                        type="text"
                        value={entry.phone || ''}
                        onChange={e => {
                          const updated = [...data.missionaries];
                          updated[idx] = { ...updated[idx], phone: e.target.value };
                          updateField('missionaries', updated);
                        }}
                        className="w-full px-3 py-3 text-base border rounded bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder={t('form.phoneNumberPlaceholder')}
                      />
                    </div>
                    <div className="pt-2">
                      <button
                        type="button"
                        onClick={() => {
                          const updated = data.missionaries.filter((_, i) => i !== idx);
                          updateField('missionaries', updated);
                        }}
                        className="w-full px-4 py-2 text-sm bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors font-medium"
                        title={t('common.remove', 'Remove')}
                      >
                        {t('common.remove', 'Remove')}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            
            <button
              type="button"
              onClick={() => updateField('missionaries', [...data.missionaries, { name: '', phone: '' }])}
              className="mt-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-base"
            >
              {t('form.addMissionary')}
            </button>
          </section>

          {/* Missionaries from our ward Section */}
          <section className="space-y-4 mt-8">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="text-xl font-medium text-gray-900">{t('terminology.wardMissionaries', { unit: getTranslatedUnitLabel(t) })}</h3>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    const updated = [...data.wardMissionaries];
                    updated.sort((a, b) => {
                      const dateA = a.expectedReturnDate || '';
                      const dateB = b.expectedReturnDate || '';
                      if (!dateA && !dateB) return 0;
                      if (!dateA) return 1;
                      if (!dateB) return -1;
                      return dateA.localeCompare(dateB);
                    });
                    updateField('wardMissionaries', updated);
                  }}
                  className="px-3 py-1.5 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200 border border-blue-300 font-medium"
                  title={t('form.sortByReturnDate')}
                >
                  {t('form.sortByReturnDate')}
                </button>
                <div className="flex flex-col items-end">
                  <button
                    type="button"
                    onClick={() => saveDefault('wardMissionaries', data.wardMissionaries)}
                    className="px-3 py-1.5 text-sm bg-gray-200 rounded hover:bg-gray-300 border border-gray-300"
                    title={t('form.saveAsDefault')}
                  >
                    {t('form.saveAsDefault')}
                  </button>
                  <span className="text-xs text-gray-500 mt-1">{t('form.savesAsYourTemplate')}</span>
                </div>
              </div>
            </div>
            
            {/* Desktop view - Stacked card layout */}
            <div className="hidden md:block space-y-4">
              {data.wardMissionaries.length === 0 ? (
                <div className="bg-white border rounded-lg p-8 text-center">
                  <p className="text-gray-500 mb-3">{t('form.noMissionariesAdded')}</p>
                  <button
                    type="button"
                    onClick={() => updateField('wardMissionaries', [...data.wardMissionaries, { name: '', mission: '', email: '' }])}
                    className="text-blue-600 hover:text-blue-800 underline font-medium"
                  >
                    {t('form.addFirstMissionary')}
                  </button>
                </div>
              ) : (
                data.wardMissionaries.map((entry, idx) => {
                  // Calculate days until return
                  const getDaysUntilReturn = () => {
                    if (!entry.expectedReturnDate) return null;
                    const returnDate = new Date(entry.expectedReturnDate);
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    const diffTime = returnDate.getTime() - today.getTime();
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                    return diffDays;
                  };
                  
                  const daysUntilReturn = getDaysUntilReturn();
                  const getReturnStatusBadge = () => {
                    if (daysUntilReturn === null) return null;
                    if (daysUntilReturn < 0) {
                      return <span className="inline-block px-3 py-1.5 text-sm font-semibold bg-green-100 text-green-800 rounded-full">{t('form.returned', 'Returned')}</span>;
                    } else if (daysUntilReturn <= 30) {
                      return <span className="inline-block px-3 py-1.5 text-sm font-semibold bg-orange-100 text-orange-800 rounded-full">{t('form.returningSoon', 'Returning Soon')}</span>;
                    } else if (daysUntilReturn <= 90) {
                      return <span className="inline-block px-3 py-1.5 text-sm font-semibold bg-yellow-100 text-yellow-800 rounded-full">{t('form.returningInDays', 'Returning in {{days}} days', { days: daysUntilReturn })}</span>;
                    }
                    return null;
                  };
                  
                  const isMilitary = entry.serviceType === 'military';

                  return (
                    <div key={idx} className="bg-white border rounded-lg p-5 shadow-sm hover:shadow-md transition-shadow">
                      {isMilitary && (
                        <span className="inline-block px-3 py-1 mb-4 text-xs font-semibold bg-blue-100 text-blue-800 rounded-full">{t('form.servingInMilitary', 'Serving in the Military')}</span>
                      )}
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {/* Left Column */}
                        <div className="space-y-4">
                          <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">{t('form.name', 'Name')}</label>
                            <input
                              type="text"
                              value={entry.name}
                              onChange={e => {
                                const updated = [...data.wardMissionaries];
                                updated[idx] = { ...updated[idx], name: e.target.value };
                                updateField('wardMissionaries', updated);
                              }}
                              className="w-full px-4 py-3 text-base border rounded-lg bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent font-medium"
                              placeholder={isMilitary ? t('form.militaryMemberNamePlaceholder', 'Member name') : t('form.missionaryNamePlaceholder')}
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">{isMilitary ? t('form.militaryBranch', 'Branch of Service') : t('form.mission', 'Mission')}</label>
                            <input
                              type="text"
                              value={entry.mission || ''}
                              onChange={e => {
                                const updated = [...data.wardMissionaries];
                                updated[idx] = { ...updated[idx], mission: e.target.value };
                                updateField('wardMissionaries', updated);
                              }}
                              className="w-full px-4 py-3 text-base border rounded-lg bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                              placeholder={isMilitary ? t('form.militaryBranchPlaceholder', 'e.g., U.S. Army') : t('form.missionNamePlaceholder')}
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">{t('form.email', 'Email')}</label>
                            <input
                              type="email"
                              value={entry.email || ''}
                              onChange={e => {
                                const updated = [...data.wardMissionaries];
                                updated[idx] = { ...updated[idx], email: e.target.value };
                                updateField('wardMissionaries', updated);
                              }}
                              className="w-full px-4 py-3 text-base border rounded-lg bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                              placeholder={t('form.emailPlaceholder')}
                            />
                          </div>
                        </div>
                        
                        {/* Right Column */}
                        <div className="space-y-4">
                          {!isMilitary && (
                            <>
                              <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-2">{t('form.setApartDate', 'Set Apart Date')}</label>
                                <input
                                  type="date"
                                  value={entry.setApartDate || ''}
                                  onChange={e => {
                                    const updated = [...data.wardMissionaries];
                                    updated[idx] = { ...updated[idx], setApartDate: e.target.value };
                                    updateField('wardMissionaries', updated);
                                  }}
                                  className="w-full px-4 py-3 text-base border rounded-lg bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                  placeholder={t('form.setApartDatePlaceholder')}
                                />
                              </div>
                              <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-2">{t('form.expectedReturnDate', 'Expected Return Date')}</label>
                                <div className="space-y-2">
                                  <input
                                    type="date"
                                    value={entry.expectedReturnDate || ''}
                                    onChange={e => {
                                      const updated = [...data.wardMissionaries];
                                      updated[idx] = { ...updated[idx], expectedReturnDate: e.target.value };
                                      updateField('wardMissionaries', updated);
                                    }}
                                    className="w-full px-4 py-3 text-base border rounded-lg bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    placeholder={t('form.expectedReturnPlaceholder')}
                                  />
                                  {getReturnStatusBadge()}
                                </div>
                              </div>
                            </>
                          )}
                          <div className="pt-2">
                            <button
                              type="button"
                              onClick={() => {
                                const updated = data.wardMissionaries.filter((_, i) => i !== idx);
                                updateField('wardMissionaries', updated);
                              }}
                              className="w-full px-4 py-2.5 text-sm bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors font-medium"
                              title={t('common.remove', 'Remove')}
                            >
                              {isMilitary ? t('form.removeMilitaryMember', 'Remove Military Member') : t('form.removeMissionary', 'Remove Missionary')}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            
            {/* Mobile view */}
            <div className="md:hidden space-y-4">
              {data.wardMissionaries.length === 0 ? (
                <div className="bg-white border rounded-lg p-8 text-center">
                  <p className="text-gray-500 mb-3">{t('form.noMissionariesAdded')}</p>
                  <button
                    type="button"
                    onClick={() => updateField('wardMissionaries', [...data.wardMissionaries, { name: '', mission: '', email: '' }])}
                    className="text-blue-600 hover:text-blue-800 underline font-medium"
                  >
                    {t('form.addFirstMissionary')}
                  </button>
                </div>
              ) : (
                data.wardMissionaries.map((entry, idx) => {
                  // Calculate days until return
                  const getDaysUntilReturn = () => {
                    if (!entry.expectedReturnDate) return null;
                    const returnDate = new Date(entry.expectedReturnDate);
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    const diffTime = returnDate.getTime() - today.getTime();
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                    return diffDays;
                  };
                  
                  const daysUntilReturn = getDaysUntilReturn();
                  const getReturnStatusBadge = () => {
                    if (daysUntilReturn === null) return null;
                    if (daysUntilReturn < 0) {
                      return <span className="inline-block px-2 py-1 text-xs font-semibold bg-green-100 text-green-800 rounded-full mt-1">{t('form.returned', 'Returned')}</span>;
                    } else if (daysUntilReturn <= 30) {
                      return <span className="inline-block px-2 py-1 text-xs font-semibold bg-orange-100 text-orange-800 rounded-full mt-1">{t('form.returningSoon', 'Returning Soon')}</span>;
                    } else if (daysUntilReturn <= 90) {
                      return <span className="inline-block px-2 py-1 text-xs font-semibold bg-yellow-100 text-yellow-800 rounded-full mt-1">{t('form.returningInDays', 'Returning in {{days}} days', { days: daysUntilReturn })}</span>;
                    }
                    return null;
                  };
                  
                  const isMilitary = entry.serviceType === 'military';

                  return (
                    <div key={idx} className="bg-white border rounded-lg p-4 shadow-sm">
                      <div className="space-y-3">
                        {isMilitary && (
                          <span className="inline-block px-2 py-1 text-xs font-semibold bg-blue-100 text-blue-800 rounded-full">{t('form.servingInMilitary', 'Serving in the Military')}</span>
                        )}
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1.5">{t('form.name', 'Name')}</label>
                          <input
                            type="text"
                            value={entry.name}
                            onChange={e => {
                              const updated = [...data.wardMissionaries];
                              updated[idx] = { ...updated[idx], name: e.target.value };
                              updateField('wardMissionaries', updated);
                            }}
                            className="w-full px-3 py-2.5 text-base border rounded bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent font-medium"
                            placeholder={isMilitary ? t('form.militaryMemberNamePlaceholder', 'Member name') : t('form.missionaryNamePlaceholder')}
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1.5">{isMilitary ? t('form.militaryBranch', 'Branch of Service') : t('form.mission', 'Mission')}</label>
                          <input
                            type="text"
                            value={entry.mission || ''}
                            onChange={e => {
                              const updated = [...data.wardMissionaries];
                              updated[idx] = { ...updated[idx], mission: e.target.value };
                              updateField('wardMissionaries', updated);
                            }}
                            className="w-full px-3 py-2.5 text-base border rounded bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            placeholder={isMilitary ? t('form.militaryBranchPlaceholder', 'e.g., U.S. Army') : t('form.missionNamePlaceholder')}
                          />
                        </div>
                        {!isMilitary && (
                          <>
                            <div>
                              <label className="block text-sm font-semibold text-gray-700 mb-1.5">{t('form.setApartDate', 'Set Apart Date')}</label>
                              <input
                                type="date"
                                value={entry.setApartDate || ''}
                                onChange={e => {
                                  const updated = [...data.wardMissionaries];
                                  updated[idx] = { ...updated[idx], setApartDate: e.target.value };
                                  updateField('wardMissionaries', updated);
                                }}
                                className="w-full px-3 py-2.5 text-base border rounded bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                placeholder={t('form.setApartDatePlaceholder')}
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-semibold text-gray-700 mb-1.5">{t('form.expectedReturnDate', 'Expected Return Date')}</label>
                              <input
                                type="date"
                                value={entry.expectedReturnDate || ''}
                                onChange={e => {
                                  const updated = [...data.wardMissionaries];
                                  updated[idx] = { ...updated[idx], expectedReturnDate: e.target.value };
                                  updateField('wardMissionaries', updated);
                                }}
                                className="w-full px-3 py-2.5 text-base border rounded bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                placeholder={t('form.expectedReturnPlaceholder')}
                              />
                              {getReturnStatusBadge()}
                            </div>
                          </>
                        )}
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1.5">{t('form.email', 'Email')}</label>
                          <input
                            type="email"
                            value={entry.email || ''}
                            onChange={e => {
                              const updated = [...data.wardMissionaries];
                              updated[idx] = { ...updated[idx], email: e.target.value };
                              updateField('wardMissionaries', updated);
                            }}
                            className="w-full px-3 py-2.5 text-base border rounded bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            placeholder={t('form.emailPlaceholder')}
                          />
                        </div>
                        <div className="pt-2">
                          <button
                            type="button"
                            onClick={() => {
                              const updated = data.wardMissionaries.filter((_, i) => i !== idx);
                              updateField('wardMissionaries', updated);
                            }}
                            className="w-full px-4 py-2.5 text-sm bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors font-medium"
                            title={t('common.remove', 'Remove')}
                          >
                            {t('common.remove', 'Remove')}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => updateField('wardMissionaries', [...data.wardMissionaries, { name: '', mission: '', email: '' }])}
                className="px-4 py-2.5 bg-blue-600 text-white rounded-lg text-base font-medium hover:bg-blue-700 transition-colors shadow-sm"
              >
                <Plus className="w-4 h-4 inline mr-2" />
                {t('form.addUnitMissionary', { unit: getTranslatedUnitLabel(t) })}
              </button>
              <button
                type="button"
                onClick={() => updateField('wardMissionaries', [...data.wardMissionaries, { name: '', mission: '', email: '', serviceType: 'military' as const }])}
                className="px-4 py-2.5 bg-white text-blue-700 border border-blue-600 rounded-lg text-base font-medium hover:bg-blue-50 transition-colors shadow-sm"
              >
                <Plus className="w-4 h-4 inline mr-2" />
                {t('form.addMilitaryMember', 'Add Military Member')}
              </button>
            </div>
          </section>

          {/* Service Missionaries Section */}
          <section className="space-y-4 mt-8">
            <h3 className="text-xl font-medium text-gray-900 border-b pb-2">{t('form.serviceMissionaries')}</h3>
            
            {/* Desktop view - Card layout matching Ward Missionaries */}
            <div className="hidden md:block space-y-4">
              {(!data.serviceMissionaries || data.serviceMissionaries.length === 0) ? (
                <div className="bg-white border rounded-lg p-8 text-center">
                  <p className="text-gray-500 mb-3">{t('form.noServiceMissionariesAdded')}</p>
                  <button
                    type="button"
                    onClick={() => updateField('serviceMissionaries', [...(data.serviceMissionaries || []), { name: '', serviceName: '' }])}
                    className="text-blue-600 hover:text-blue-800 underline font-medium"
                  >
                    {t('form.addFirstServiceMissionary')}
                  </button>
                </div>
              ) : (
                (data.serviceMissionaries || []).map((entry, idx) => (
                  <div key={idx} className="bg-white border rounded-lg p-5 shadow-sm hover:shadow-md transition-shadow">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {/* Left Column */}
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-2">{t('form.names')}</label>
                          <input
                            type="text"
                            value={entry.name || ''}
                            onChange={e => {
                              const updated = [...(data.serviceMissionaries || [])];
                              updated[idx] = { ...updated[idx], name: e.target.value };
                              updateField('serviceMissionaries', updated);
                            }}
                            className="w-full px-4 py-3 text-base border rounded-lg bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent font-medium"
                            placeholder={t('form.seniorMissionaryPlaceholder')}
                          />
                        </div>
                      </div>
                      
                      {/* Right Column */}
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-2">{t('form.calling')}</label>
                          <input
                            type="text"
                            value={entry.serviceName || ''}
                            onChange={e => {
                              const updated = [...(data.serviceMissionaries || [])];
                              updated[idx] = { ...updated[idx], serviceName: e.target.value };
                              updateField('serviceMissionaries', updated);
                            }}
                            className="w-full px-4 py-3 text-base border rounded-lg bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            placeholder={t('form.seniorMissionaryRolePlaceholder')}
                          />
                        </div>
                        <div className="pt-2">
                          <button
                            type="button"
                            onClick={() => {
                              const updated = (data.serviceMissionaries || []).filter((_, i) => i !== idx);
                              updateField('serviceMissionaries', updated);
                            }}
                            className="w-full px-4 py-2.5 text-sm bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors font-medium"
                            title={t('common.remove', 'Remove')}
                          >
                            {t('form.removeMissionary')}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
            
            {/* Mobile view */}
            <div className="md:hidden space-y-4">
              {(!data.serviceMissionaries || data.serviceMissionaries.length === 0) ? (
                <div className="bg-white border rounded-lg p-8 text-center">
                  <p className="text-gray-500 mb-3">{t('form.noServiceMissionariesAdded')}</p>
                  <button
                    type="button"
                    onClick={() => updateField('serviceMissionaries', [...(data.serviceMissionaries || []), { name: '', serviceName: '' }])}
                    className="text-blue-600 hover:text-blue-800 underline font-medium"
                  >
                    {t('form.addFirstServiceMissionary')}
                  </button>
                </div>
              ) : (
                (data.serviceMissionaries || []).map((entry, idx) => (
                  <div key={idx} className="bg-white border rounded-lg p-4 shadow-sm">
                    <div className="space-y-3">
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-1.5">Name(s)</label>
                        <input
                          type="text"
                          value={entry.name || ''}
                          onChange={e => {
                            const updated = [...(data.serviceMissionaries || [])];
                            updated[idx] = { ...updated[idx], name: e.target.value };
                            updateField('serviceMissionaries', updated);
                          }}
                          className="w-full px-3 py-2.5 text-base border rounded bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent font-medium"
                          placeholder={t('form.seniorMissionaryPlaceholder')}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-1.5">Calling</label>
                        <input
                          type="text"
                          value={entry.serviceName || ''}
                          onChange={e => {
                            const updated = [...(data.serviceMissionaries || [])];
                            updated[idx] = { ...updated[idx], serviceName: e.target.value };
                            updateField('serviceMissionaries', updated);
                          }}
                          className="w-full px-3 py-2.5 text-base border rounded bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder={t('form.seniorMissionaryRolePlaceholder')}
                        />
                      </div>
                      <div className="pt-2">
                        <button
                          type="button"
                          onClick={() => {
                            const updated = (data.serviceMissionaries || []).filter((_, i) => i !== idx);
                            updateField('serviceMissionaries', updated);
                          }}
                          className="w-full px-4 py-2.5 text-sm bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors font-medium"
                          title={t('common.remove')}
                        >
                          {t('common.remove')}
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
            
            <button
              type="button"
              onClick={() => updateField('serviceMissionaries', [...(data.serviceMissionaries || []), { name: '', serviceName: '' }])}
              className="mt-4 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-base font-medium hover:bg-blue-700 transition-colors shadow-sm"
            >
              <Plus className="w-4 h-4 inline mr-2" />
              {t('form.addServiceMissionary')}
            </button>
          </section>
        </div>
      )}

      {/* Recurring Announcements Modal */}
      {profileSlug && (
        <RecurringAnnouncementsModal
          isOpen={showRecurringAnnouncements}
          onClose={() => setShowRecurringAnnouncements(false)}
          profileSlug={profileSlug}
          onAnnouncementSelected={handleRecurringAnnouncementSelected}
        />
      )}

      {/* Delete Image Confirmation Modal */}
      {deleteImageConfirm.show && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" onClick={() => setDeleteImageConfirm({ show: false, imageId: null })} />
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen">&#8203;</span>
            <div className="inline-block align-bottom bg-white rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full sm:p-6">
              <div className="sm:flex sm:items-start">
                <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10">
                  <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                </div>
                <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                  <h3 className="text-lg leading-6 font-medium text-gray-900">{t('form.deleteImage')}</h3>
                  <div className="mt-2">
                    <p className="text-sm text-gray-500">{t('modals.thisActionCannotBeUndone')}</p>
                  </div>
                </div>
              </div>
              <div className="mt-5 sm:mt-4 sm:flex sm:flex-row-reverse gap-3">
                <button
                  type="button"
                  onClick={confirmDeleteImage}
                  className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-red-600 text-base font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 sm:w-auto sm:text-sm"
                >
                  {t('common.delete')}
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteImageConfirm({ show: false, imageId: null })}
                  className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:mt-0 sm:w-auto sm:text-sm"
                >
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
export default React.memo(BulletinForm);

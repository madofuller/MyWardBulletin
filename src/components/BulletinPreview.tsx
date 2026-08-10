import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Video } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BulletinData } from "../types/bulletin";
import { sanitizeHtml } from '../lib/sanitizeHtml';
import { linkifyHtml } from '../lib/linkifyHtml';
import { decodeHtml } from '../lib/decodeHtml';
import { detectMeetingPlatform, normalizeMeetingUrl } from '../lib/meetingPlatform';
import { sanitizedAnnouncementHtml } from '../lib/sanitizeCache';
import { getSongUrl, getSongTitle } from '../lib/songService';
import { getImageByIdSync, LDS_IMAGES, ImageData } from '../data/images';


import {
  getUnitLabel,
  getUnitLowercase,
  getHigherUnitLabel,
  getUnitLeadershipLabel,
  getUnitMissionariesLabel,
  getAudienceDisplayName,
  getTranslatedUnitLabel,
  UnitType
} from '../lib/terminology';

interface BulletinPreviewProps {
  data: BulletinData;
  hideTabs?: boolean;
  hideImageControls?: boolean;
  onImagePositionChange?: (position: { x: number; y: number }) => void;
  onImageOpacityChange?: (opacity: number) => void;
  allImages?: ImageData[];
  unitTypeOverride?: UnitType;
}

/* ---------------------------------- Consts --------------------------------- */

// Dynamic audience labels based on terminology - moved to component for unitTypeOverride support

const imagePositions = {
  top: { x: 50, y: 25 },
  center: { x: 50, y: 50 },
  bottom: { x: 50, y: 75 }
} as const;

/* ------------------------------- Pure helpers ------------------------------ */

const hasUnitInfo = (data?: BulletinData): boolean => {
  if (!data) return false;
  const hasUnitLeadership =
    Array.isArray(data.wardLeadership) &&
    data.wardLeadership.some(e => e && (e.title || e.name || e.phone));

  const hasMissionaries =
    Array.isArray(data.missionaries) &&
    data.missionaries.some(e => e && (e.name || e.phone));

  const hasUnitMissionaries =
    Array.isArray(data.wardMissionaries) &&
    data.wardMissionaries.some(e => e && (e.name || e.mission || e.setApartDate || e.expectedReturnDate || e.email));
  const hasServiceMissionaries =
    Array.isArray(data.serviceMissionaries) &&
    data.serviceMissionaries.some(e => e && (e.name || e.serviceName));

  return hasUnitLeadership || hasMissionaries || hasUnitMissionaries || hasServiceMissionaries;
};

// Legacy alias for compatibility
const hasWardInfo = hasUnitInfo;

const formatDate = (dateString?: string, locale: string = 'en') => {
  if (!dateString) return '';
  const [y, m, d] = dateString.split('-').map(Number);
  // Create date in local timezone to avoid timezone shifts
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  // Map i18n language codes to proper locale codes
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
  const resolvedLocale = localeMap[locale] || locale;
  return date.toLocaleDateString(resolvedLocale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
};

/* ----------------------------- Reusable pieces ----------------------------- */

const DottedLine = ({
  children,
  rightAlign
}: {
  children: React.ReactNode;
  rightAlign?: React.ReactNode;
}) => (
  <div className="flex items-center justify-between py-1">
    <span className="flex-1 flex items-center">
      {children}
      <span className="flex-1 mx-2 border-b border-dotted border-gray-400"></span>
    </span>
    {rightAlign ? <span className="text-right font-medium">{rightAlign}</span> : null}
  </div>
);

function BulletinHeader({
  wardName,
  dateLabel,
  heading, // e.g., "Sacrament Meeting" or "Announcements"
  image,
  imagePosition,
  imageOpacity = 40,
  children
}: {
  wardName?: string;
  dateLabel: string;
  heading: string;
  image?: { url?: string; name?: string } | null;
  imagePosition: { x: number; y: number };
  imageOpacity?: number;
  children?: React.ReactNode;
}) {
  return (
    <div className="bg-gray-100 border-b-2 border-gray-300 text-center relative overflow-hidden min-h-56">
      {image?.url && (
        <img
          src={image.url}
          alt=""
          className="absolute inset-0 w-full h-full object-cover transition-all duration-300"
          style={{
            objectPosition: `${imagePosition.x}% ${imagePosition.y}%`,
            opacity: imageOpacity / 100
          }}
          crossOrigin="anonymous"
          onError={(e) => {
            // Hide broken images (may be deleted from storage)
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      )}
      <div className="relative z-10 p-12">
        {wardName && (
          <h1 className="text-3xl font-bold text-gray-900 mb-3 tracking-wide">
            {wardName}
          </h1>
        )}
        <h2 className="text-2xl font-semibold text-gray-800 mb-3 whitespace-pre-line">{heading}</h2>
        <p className="text-lg text-gray-600 italic font-medium">{dateLabel}</p>
        {children}
      </div>
    </div>
  );
}

function ImagePositionControls({
  show,
  onToggle,
  positions,
  current,
  onChange,
  opacity = 40,
  onOpacityChange,
  t
}: {
  show: boolean;
  onToggle: () => void;
  positions: Record<string, { x: number; y: number }>;
  current: { x: number; y: number };
  onChange: (p: { x: number; y: number }) => void;
  opacity?: number;
  onOpacityChange?: (opacity: number) => void;
  t: (key: string) => string;
}) {
  return (
    <div className="absolute top-2 right-2 z-20">
      <button
        onClick={onToggle}
        className="bg-white/90 hover:bg-white text-gray-700 px-2 py-1 rounded text-xs font-medium shadow-sm transition-all border"
      >
        {show ? '✕' : '⚙️'}
      </button>
      {show && (
        <div className="absolute top-full right-0 mt-1 bg-white rounded-lg shadow-lg border p-3 min-w-48">
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-gray-700 block mb-2">{t('form.position')}</label>
              <div className="space-y-1">
                {Object.entries(positions).map(([key, pos]) => (
                  <button
                    key={key}
                    onClick={() => onChange(pos)}
                    className={`w-full px-3 py-2 text-xs rounded ${
                      current.x === pos.x && current.y === pos.y
                        ? 'bg-blue-500 text-white'
                        : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                    }`}
                    title={key.charAt(0).toUpperCase() + key.slice(1)}
                  >
                    {key === 'center' ? `● ${t('form.center')}` : key === 'top' ? `↑ ${t('form.top')}` : `↓ ${t('form.bottom')}`}
                  </button>
                ))}
              </div>
            </div>
            {onOpacityChange && (
              <div>
                <label className="text-xs font-medium text-gray-700 block mb-2 flex items-center justify-between">
                  <span>{t('form.opacity')}</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={opacity}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      if (!isNaN(val) && val >= 0 && val <= 100) {
                        onOpacityChange(val);
                      }
                    }}
                    className="w-14 px-2 py-1 text-xs border border-gray-300 rounded text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={opacity}
                  onChange={(e) => onOpacityChange(parseInt(e.target.value))}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>{t('form.transparent')}</span>
                  <span>{t('form.opaque')}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AnnouncementItem({
  audience,
  category,
  title,
  html, // sanitized html string
  imageId,
  hideImageOnPrint = false,
  hideOnPrint = false,
  images
}: {
  audience: string;
  category?: string | null;
  title: string;
  html: string;
  imageId?: string;
  hideImageOnPrint?: boolean;
  hideOnPrint?: boolean;
  images?: Array<{ imageId: string; hideImageOnPrint?: boolean; size?: 'small' | 'medium' | 'large' | 'xlarge' }>;
}) {
  // H1 audience, H2 title, content styled as "H3-ish"
  
  const getImageSizeStyle = (size?: 'small' | 'medium' | 'large' | 'xlarge') => {
    switch (size) {
      case 'small':
        return { maxHeight: '120px' };
      case 'medium':
        return { maxHeight: '200px' };
      case 'large':
        return { maxHeight: '300px' };
      case 'xlarge':
        return { maxHeight: '400px' };
      default:
        return { maxHeight: '200px' }; // Default to medium
    }
  };
  
  return (
    <article className={`border-l-4 border-[#edf4ff] pl-4${hideOnPrint ? ' print:hidden' : ''}`}>
      <h3 className="text-xl sm:text-2xl text-gray-900">{audience}</h3>

      {category && category !== 'general' && (
        <div className="mt-1">
          <span className="inline-block text-gray-700 text-xs bg-gray-100 px-2 py-1 rounded">
            {category}
          </span>
        </div>
      )}

      <h2 className="text-xl sm:text-xl text-gray-900 mt-3">{title}</h2>

      <div className="mt-2 text-gray-800 text-base leading-relaxed overflow-hidden">
        <div
          className="mt-1 break-words [&_a]:text-blue-600 [&_a]:underline [&_a]:break-all hover:[&_a]:text-blue-800"
          style={{
            '--tw-prose-bullets': 'disc',
            '--tw-prose-list-style': 'disc',
            wordBreak: 'break-word',
            overflowWrap: 'break-word'
          } as React.CSSProperties}
          dangerouslySetInnerHTML={{
            __html: html.replace(
              /<ul>/g,
              '<ul style="list-style-type: disc; list-style-position: inside; margin-left: 1rem;">'
            ).replace(
              /<ol>/g,
              '<ol style="list-style-type: decimal; list-style-position: inside; margin-left: 1rem;">'
            ).replace(
              /<li>/g,
              '<li style="margin-left: 0.5rem; display: list-item;">'
            )
          }}
        />
      </div>

      {/* Announcement Images */}
      {/* Legacy single image support */}
      {imageId && imageId !== 'none' && !images && (
        <div className={`mt-3 ${hideImageOnPrint ? 'print:hidden' : ''}`}>
          {(() => {
            const selectedImage = getImageByIdSync(imageId);
            return selectedImage?.url ? (
              <img
                src={selectedImage.url}
                alt={selectedImage.name}
                className="max-w-full h-auto rounded-lg shadow-sm w-full"
                style={{ ...getImageSizeStyle('medium'), objectFit: 'contain' }}
                loading="lazy"
                crossOrigin="anonymous"
              />
            ) : null;
          })()}
        </div>
      )}

      {/* Multiple images support */}
      {images && images.length > 0 && (
        <div className="mt-3 space-y-3">
          {images.map((img: any, index: number) => {
            // Use imageUrl if available (for Supabase Storage images), otherwise resolve from imageId
            // For custom images, imageUrl should always be present (Supabase public URL)
            // For LDS images, getImageByIdSync will return the relative path
            let imageUrl = img.imageUrl;
            if (!imageUrl && img.imageId) {
              const imageData = getImageByIdSync(img.imageId);
              imageUrl = imageData?.url;
            }
            // If still no URL and it's a custom image, skip silently
            // (image may have been deleted from storage)
            return imageUrl ? (
              <div key={index} className={`${img.hideImageOnPrint ? 'print:hidden' : ''}`}>
                <img
                  src={imageUrl}
                  alt="Announcement Image"
                  className="max-w-full h-auto rounded-lg shadow-sm w-full"
                  style={{ ...getImageSizeStyle(img.size), objectFit: 'contain' }}
                  loading="lazy"
                  crossOrigin="anonymous"
                  onError={(e) => {
                    // Silently hide broken images (may be deleted from storage)
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              </div>
            ) : null;
          })}
        </div>
      )}
    </article>
  );
}

/* ------------------------------- Main export ------------------------------- */

function BulletinPreview({
  data,
  hideTabs = false,
  hideImageControls = false,
  onImagePositionChange,
  onImageOpacityChange,
  onThemeSelectClick,
  allImages = [],
  unitTypeOverride,
}: BulletinPreviewProps) {
  const { t, i18n } = useTranslation();
  const currentLang = i18n.language;

  // Dynamic audience labels based on terminology
  const getAudienceLabel = (audience: string): string => {
    return getAudienceDisplayName(audience, unitTypeOverride);
  };
  const [activeTab, setActiveTab] = useState<'program' | 'announcements' | 'unitinfo'>(() => {
    const hash = window.location.hash.replace('#', '');
    if (hash === 'announcements' || hash === 'unitinfo') return hash;
    return 'program';
  });

  // Handle mobile viewport - switch away from wardinfo if on mobile and that tab is active and there's no ward info
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 640 && activeTab === 'unitinfo' && !hasWardInfo(data)) {
        setActiveTab('program');
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [activeTab, data]);
  const initialPosRef = useRef<{ x: number; y: number }>(
    data.imagePosition &&
    typeof data.imagePosition.x === 'number' &&
    typeof data.imagePosition.y === 'number'
      ? data.imagePosition
      : imagePositions.center
  );
  const [imagePosition, setImagePosition] = useState<{ x: number; y: number }>(
    initialPosRef.current
  );
  const [showImageControls, setShowImageControls] = useState(false);

  // Only adopt parent updates when the prop is explicitly provided (no fallback to center here)
  useEffect(() => {
    const p = data.imagePosition;
    if (
      p &&
      typeof p.x === 'number' &&
      typeof p.y === 'number' &&
      (p.x !== imagePosition.x || p.y !== imagePosition.y)
    ) {
      setImagePosition(p);
    }
  }, [data.imagePosition?.x, data.imagePosition?.y, imagePosition.x, imagePosition.y]);

  const handleImagePositionChange = (pos: { x: number; y: number }) => {
    if (pos.x !== imagePosition.x || pos.y !== imagePosition.y) {
      setImagePosition(pos);
      onImagePositionChange?.(pos);
    }
  };

  /* ------------------------------- Memoized -------------------------------- */

  const selectedImage = useMemo(() => {
    if (!data.imageId || data.imageId === 'none') return null;

    // If imageUrl is provided (from public bulletin), use it directly
    if (data.imageUrl) {
      return {
        id: data.imageId,
        name: 'Custom Image',
        url: data.imageUrl,
        description: 'Custom uploaded image'
      };
    }

    // First try to find in allImages (includes both preset and custom images)
    if (allImages.length > 0) {
      const found = allImages.find(img => img.id === data.imageId);
      if (found) {
        return found;
      }
    }

    // Fallback to sync lookup for preset images
    return getImageByIdSync(data.imageId);
  }, [data.imageId, data.imageUrl, allImages]);

  const formattedDate = useMemo(() => formatDate(data.date, i18n.language), [data.date, i18n.language]);

  const sanitizedAnnouncements = useMemo(() => {
    const arr = data?.announcements ?? [];
    return arr.map(a => {
      // For standalone announcements, use customAudienceLabel if available.
      // Recurring standalone items were stored with the literal 'standalone'
      // audience (no _id suffix), so match both forms.
      const isStandalone = a.audience === 'standalone' || a.audience?.startsWith('standalone_');
      let label: string;
      if (isStandalone) {
        label = a.customAudienceLabel || ''; // Use custom label or empty for standalone
      } else {
        label = getAudienceLabel(a.audience || getUnitLowercase(unitTypeOverride));
      }
      return {
        ...a,
        audienceLabel: label,
        html: sanitizedAnnouncementHtml(a.content ?? ""),
      };
    });
  }, [data?.announcements, unitTypeOverride]);

  const [bulletinId, setBulletinId] = useState('');
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setBulletinId(window.location.pathname.split('/').pop() ?? '');
    }
  }, []);

  const qrUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(window.location.href)}`;
  }, []);

  const meetingLink = typeof data?.leadership?.meetingLink === 'string' ? data.leadership.meetingLink.trim() : '';
  const meetingPlatform = useMemo(() => (meetingLink ? detectMeetingPlatform(meetingLink) : null), [meetingLink]);

  /* --------------------------------- Render -------------------------------- */

  return (
    <div className="bulletin bg-white shadow-lg rounded-lg overflow-hidden max-w-2xl mx-auto font-sans">
      {/* Tabs */}
      {!hideTabs && (
        <nav className="flex justify-center print:hidden mb-4 mt-4" aria-label="Main tabs">
          <ul role="tablist" className="flex flex-col gap-2 sm:flex-row sm:gap-3 w-full max-w-xs sm:max-w-none mx-auto justify-center items-center">
            {(['program', 'announcements', 'unitinfo'] as const).map(tab => (
              <li key={tab} role="presentation" className={`w-full sm:w-auto ${tab === 'unitinfo' && !hasWardInfo(data) ? 'hidden sm:block' : ''}`}>
                <button
                  type="button"
                  role="tab"
                  id={`tab-${tab}`}
                  tabIndex={activeTab === tab ? 0 : -1}
                  aria-selected={activeTab === tab}
                  aria-controls={`tab-panel-${tab}`}
                  onKeyDown={(e) => {
                    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                    e.preventDefault();
                    const tabs = ['program', 'announcements', 'unitinfo'] as const;
                    const idx = tabs.indexOf(tab);
                    const next = tabs[(idx + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
                    setActiveTab(next);
                    document.getElementById(`tab-${next}`)?.focus();
                  }}
                  className={`w-full sm:w-auto px-4 sm:px-8 py-3 sm:py-3 rounded-full font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 border-2 transition-all duration-200 text-base sm:text-base
                    ${activeTab === tab
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50 hover:border-gray-400 hover:text-gray-900'}
                  `}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab === 'program' ? t('bulletin.program') : tab === 'announcements' ? t('bulletin.announcements') : t('bulletin.unitInfo', { unit: getTranslatedUnitLabel(t, unitTypeOverride) })}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {/* ------------------------------- Program ------------------------------ */}
      {activeTab === 'program' && (
        <div id="tab-panel-program" role="tabpanel" aria-labelledby="tab-program" className="p-6 space-y-4 text-sm leading-relaxed">
          <div className="relative">
            <BulletinHeader
              wardName={data?.meetingType === 'baptism' ? undefined : data?.wardName}
              dateLabel={formattedDate}
              heading={data?.meetingType === 'baptism'
                ? `${t('bulletin.theBaptismOf')}\n${data?.agenda?.find((i: any) => i.type === 'baptism_ordinance')?.candidateName || ''}`
                : t('bulletin.sacramentMeeting')}
              image={selectedImage}
              imagePosition={imagePosition}
              imageOpacity={data.imageOpacity ?? 40}
            />
            {data?.imageId && data.imageId !== 'none' && !hideImageControls && (
              <ImagePositionControls
                show={showImageControls}
                onToggle={() => setShowImageControls(v => !v)}
                positions={imagePositions}
                current={imagePosition}
                onChange={handleImagePositionChange}
                opacity={data.imageOpacity ?? 40}
                onOpacityChange={onImageOpacityChange}
                t={t}
              />
            )}
          </div>

          {/* Virtual meeting link (Zoom, Google Meet, Teams, ...) */}
          {meetingLink !== '' && (
            <div className="flex justify-center print:hidden">
              <a
                href={normalizeMeetingUrl(meetingLink)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-blue-600 text-white text-sm font-medium shadow-sm hover:bg-blue-700 transition-colors"
              >
                <Video className="w-4 h-4" aria-hidden="true" />
                {meetingPlatform
                  ? t('bulletin.joinMeeting', { platform: meetingPlatform })
                  : t('bulletin.joinMeetingGeneric')}
              </a>
            </div>
          )}

          {/* Leadership */}
          <div className="space-y-1">
            <DottedLine rightAlign={data?.leadership?.presiding}>
              <span>{t('form.presiding')}</span>
            </DottedLine>
            {data?.leadership?.conducting && (
              <DottedLine rightAlign={data.leadership.conducting}>
                <span>{t('form.conducting')}</span>
              </DottedLine>
            )}
            <DottedLine rightAlign={data?.leadership?.chorister}>
              <span>{data?.leadership?.choristerLabel === 'Music Leader' ? t('form.musicLeader') : t('form.chorister')}</span>
            </DottedLine>
            <DottedLine rightAlign={data?.leadership?.organist}>
              <span>{data?.leadership?.organistLabel === 'Pianist' ? t('form.pianist') : t('form.organist')}</span>
            </DottedLine>
            {data?.leadership?.interpreter && (
              <DottedLine rightAlign={data.leadership.interpreter}>
                <span>{t('form.interpreter')}</span>
              </DottedLine>
            )}
            {data?.leadership?.preludeMusic && (
              <DottedLine rightAlign={data.leadership.preludeMusic}>
                <span>{t('form.preludeMusic')}</span>
              </DottedLine>
            )}
          </div>

          {/* Theme */}
          {data?.theme && (
            <div className="text-center py-2">
              <p className="italic text-gray-700">{data.theme}</p>
            </div>
          )}

          {/* Opening Hymn */}
          {(data?.musicProgram?.openingHymnNumber || data?.musicProgram?.openingHymnTitle) && (
            <div className="space-y-1">
              <DottedLine rightAlign={data?.musicProgram?.openingHymnNumber}>
                <span>{t('bulletin.openingHymn')}</span>
              </DottedLine>
              <div className="text-center py-1">
                <p className="italic">
                  <a
                    href={getSongUrl(
                      data?.musicProgram?.openingHymnNumber,
                      data?.musicProgram?.openingHymnType || 'hymn',
                      currentLang
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-700 underline hover:text-blue-900"
                  >
                    {data?.musicProgram?.openingHymnTitle ||
                      getSongTitle(
                        data?.musicProgram?.openingHymnNumber,
                        data?.musicProgram?.openingHymnType || 'hymn',
                        currentLang
                      )}
                  </a>
                </p>
              </div>
            </div>
          )}

          {/* Opening Prayer */}
          {data?.prayers?.opening && (
            <DottedLine rightAlign={data.prayers.opening}>
              <span>{t('bulletin.invocation')}</span>
            </DottedLine>
          )}

          {/* Unit Business - hidden for baptism programs */}
          {data?.meetingType !== 'baptism' && (
            <div className="text-center">
              <p className="font-medium text-gray-900">{t('bulletin.unitBusiness', { unit: getTranslatedUnitLabel(t, unitTypeOverride) })}</p>
            </div>
          )}


          {/* Agenda */}
          {Array.isArray(data?.agenda) && data.agenda.length > 0 && (
            <div className="space-y-1">
              <div className="text-center py-2">
              </div>
              {data.agenda.map((item, idx) => (
                <div key={idx} className="space-y-1">
                  {item.type === 'speaker' && (
                    <DottedLine rightAlign={item.name}>
                      <span>{item.customLabel || (item.speakerType === 'youth' ? t('bulletin.youthSpeaker') : item.speakerType === 'highCouncil' ? t('bulletin.highCouncilSpeaker') : t('bulletin.speaker'))}</span>
                    </DottedLine>
                  )}
                  {item.type === 'musical' && (
                    <>
                      <DottedLine rightAlign={item.hymnNumber || item.songName}>
                        <span>{item.label === 'Intermediate Hymn' ? t('form.intermediateHymn') : t('bulletin.musicalNumber')}</span>
                      </DottedLine>
                      {(item.hymnNumber || item.hymnTitle) && (
                        <div className="text-center py-1">
                          <p className="italic">
                            {item.hymnNumber ? (
                              <a
                                href={getSongUrl(item.hymnNumber, item.hymnType || 'hymn', currentLang)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-700 underline hover:text-blue-900"
                              >
                                {item.hymnTitle || getSongTitle(item.hymnNumber, item.hymnType || 'hymn', currentLang)}
                              </a>
                            ) : item.songName}
                          </p>
                        </div>
                      )}
                      {item.performers && (
                        <div className="text-center py-1">
                          <p className="text-sm">{item.performers}</p>
                        </div>
                      )}
                    </>
                  )}
                  {item.type === 'testimony' && (
                    <div className="text-center py-2">
                      <p className="font-bold text-lg text-gray-900">{t('bulletin.bearingOfTestimonies')}</p>
                      {item.note && (
                        <p className="text-sm text-gray-700 italic mt-1">{item.note}</p>
                      )}
                    </div>
                  )}
                  {item.type === 'baby_blessing' && (
                    <div className="text-center py-2">
                      <p className="font-bold text-lg text-gray-900">{t('bulletin.babyBlessing')} {item.childName || ''}</p>
                      {item.parentNames && (
                        <p className="text-sm text-gray-700 italic mt-1">{t('form.childOf')} {item.parentNames}</p>
                      )}
                    </div>
                  )}
                  {item.type === 'baptism_ordinance' && (
                    <div className="text-center py-2">
                      <p className="font-bold text-lg text-gray-900 uppercase">{t('bulletin.baptismOf')} {item.candidateName || ''}</p>
                      {item.performedBy && (
                        <p className="text-sm text-gray-700 italic mt-1">{t('form.performedByLabel')} {item.performedBy}</p>
                      )}
                    </div>
                  )}
                  {item.type === 'confirmation' && (
                    <div className="text-center py-2">
                      <p className="font-bold text-lg text-gray-900 uppercase">{t('bulletin.confirmationOf')} {item.candidateName || ''}</p>
                      {item.performedBy && (
                        <p className="text-sm text-gray-700 italic mt-1">{t('form.performedByLabel')} {item.performedBy}</p>
                      )}
                    </div>
                  )}
                  {item.type === 'sacrament' && data.meetingType === 'sacrament' && (
                    <>
                      {(data?.musicProgram?.sacramentHymnNumber || data?.musicProgram?.sacramentHymnTitle) && (
                        <div className="space-y-1">
                          <DottedLine rightAlign={data?.musicProgram?.sacramentHymnNumber}>
                            <span>{t('bulletin.sacramentHymn')}</span>
                          </DottedLine>
                          <div className="text-center py-1">
                            <p className="italic">
                              <a
                                href={getSongUrl(
                                  data?.musicProgram?.sacramentHymnNumber,
                                  data?.musicProgram?.sacramentHymnType || 'hymn',
                                  currentLang
                                )}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-700 underline hover:text-blue-900"
                              >
                                {data?.musicProgram?.sacramentHymnTitle ||
                                  getSongTitle(
                                    data?.musicProgram?.sacramentHymnNumber,
                                    data?.musicProgram?.sacramentHymnType || 'hymn',
                                    currentLang
                                  )}
                              </a>
                            </p>
                          </div>
                        </div>
                      )}
                      <div className="text-center">
                        <p className="text-lg font-bold text-gray-900">{t('bulletin.administrationOfSacrament')}</p>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Closing Hymn */}
          {(data?.musicProgram?.closingHymnNumber || data?.musicProgram?.closingHymnTitle) && (
            <div className="space-y-1">
              <DottedLine rightAlign={data?.musicProgram?.closingHymnNumber}>
                <span>{t('bulletin.closingHymn')}</span>
              </DottedLine>
              <div className="text-center py-1">
                <p className="italic">
                  <a
                    href={getSongUrl(
                      data?.musicProgram?.closingHymnNumber,
                      data?.musicProgram?.closingHymnType || 'hymn',
                      currentLang
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-700 underline hover:text-blue-900"
                  >
                    {data?.musicProgram?.closingHymnTitle ||
                      getSongTitle(
                        data?.musicProgram?.closingHymnNumber,
                        data?.musicProgram?.closingHymnType || 'hymn',
                        currentLang
                      )}
                  </a>
                </p>
              </div>
            </div>
          )}

          {/* Closing Prayer */}
          {data?.prayers?.closing && (
            <DottedLine rightAlign={data.prayers.closing}>
              <span>{t('bulletin.benediction')}</span>
            </DottedLine>
          )}

          {/* Bishopric Message */}
          {data?.bishopricMessage && (
            <div className="mt-4 p-4 bg-blue-50 rounded-lg">
              <h3 className="font-bold text-blue-900 mb-2">{t('terminology.bishopricMessage', { leadershipBody: t('terminology.bishopric') })}</h3>
              <p className="text-blue-800 italic">{data.bishopricMessage}</p>
            </div>
          )}
        </div>
      )}

      {/* ---------------------------- Announcements --------------------------- */}
      {activeTab === 'announcements' && (
        <div id="tab-panel-announcements" role="tabpanel" aria-labelledby="tab-announcements" className="p-6 space-y-4 text-sm leading-relaxed">
          <div className="relative">
            <BulletinHeader
              wardName={data?.wardName}
              dateLabel={formattedDate}
              heading={t('bulletin.announcements')}
              image={selectedImage}
              imagePosition={imagePosition}
              imageOpacity={data.imageOpacity ?? 40}
            />
            {data?.imageId && data.imageId !== 'none' && !hideImageControls && (
              <ImagePositionControls
                show={showImageControls}
                onToggle={() => setShowImageControls(v => !v)}
                positions={imagePositions}
                current={imagePosition}
                onChange={handleImagePositionChange}
                opacity={data.imageOpacity ?? 40}
                onOpacityChange={onImageOpacityChange}
                t={t}
              />
            )}
          </div>

          {sanitizedAnnouncements.length > 0 ? (
            <div className="space-y-8">
              {(() => {
                // Group announcements by audience/type. Standalone
                // announcements without a custom label have an empty label:
                // they group under '' and render with no section header
                // (falling back to 'Ward' here put a wrong header on them).
                const grouped = sanitizedAnnouncements.reduce((groups, announcement) => {
                  const audience = announcement.audienceLabel ?? '';
                  if (!groups[audience]) {
                    groups[audience] = [];
                  }
                  groups[audience].push(announcement);
                  return groups;
                }, {} as Record<string, typeof sanitizedAnnouncements>);

                // Render grouped announcements
                return Object.entries(grouped).map(([audience, announcements]) => (
                  <article key={audience || 'no-label'} className="border-l-4 border-[#edf4ff] pl-4">
                    {audience && (
                      <h3 className="text-xl sm:text-2xl text-gray-900 mb-4">{audience}</h3>
                    )}
                    <div className="space-y-6">
                      {announcements.map((a, i) => (
                        <div key={i} className={a.hideOnPrint ? 'print:hidden' : undefined}>
                          {a.title && (
                            <h2 className="text-xl sm:text-xl text-gray-900 mb-2 font-semibold">{a.title}</h2>
                          )}
                          {a.category && a.category !== 'general' && (
                            <div className="mb-2">
                              <span className="inline-block text-gray-700 text-xs bg-gray-100 px-2 py-1 rounded">
                                {a.category}
                              </span>
                            </div>
                          )}
                          <div className="mt-2 text-gray-800 text-base leading-relaxed overflow-hidden">
                            <div
                              className="mt-1 break-words [&_a]:text-blue-600 [&_a]:underline [&_a]:break-all hover:[&_a]:text-blue-800"
                              style={{
                                '--tw-prose-bullets': 'disc',
                                '--tw-prose-list-style': 'disc',
                                wordBreak: 'break-word',
                                overflowWrap: 'break-word'
                              } as React.CSSProperties}
                              dangerouslySetInnerHTML={{
                                __html: a.html.replace(
                                  /<ul>/g, 
                                  '<ul style="list-style-type: disc; list-style-position: inside; margin-left: 1rem;">'
                                ).replace(
                                  /<ol>/g, 
                                  '<ol style="list-style-type: decimal; list-style-position: inside; margin-left: 1rem;">'
                                ).replace(
                                  /<li>/g, 
                                  '<li style="margin-left: 0.5rem; display: list-item;">'
                                )
                              }}
                            />
                          </div>
                          {/* Announcement Images */}
                          {a.imageId && a.imageId !== 'none' && !a.images && (
                            <div className={`mt-3 ${a.hideImageOnPrint ? 'print:hidden' : ''}`}>
                              {(() => {
                                const selectedImage = getImageByIdSync(a.imageId);
                                return selectedImage?.url ? (
                                  <img
                                    src={selectedImage.url}
                                    alt={selectedImage.name}
                                    className="max-w-full h-auto rounded-lg shadow-sm w-full"
                                    style={{ maxHeight: '200px', objectFit: 'contain' }}
                                    loading="lazy"
                                    crossOrigin="anonymous"
                                  />
                                ) : null;
                              })()}
                            </div>
                          )}
                          {a.images && a.images.length > 0 && (
                            <div className="mt-3 space-y-3">
                              {a.images.map((img: any, index: number) => {
                                // Use imageUrl if available (for Supabase Storage images), otherwise resolve from imageId
                                // For custom images, imageUrl should always be present (Supabase public URL)
                                let imageUrl = img.imageUrl;
                                if (!imageUrl && img.imageId) {
                                  const imageData = getImageByIdSync(img.imageId);
                                  imageUrl = imageData?.url;
                                }
                                // If still no URL and it's a custom image, skip silently
                                // (image may have been deleted from storage)
                                return imageUrl ? (
                                  <div key={index} className={`${img.hideImageOnPrint ? 'print:hidden' : ''}`}>
                                    <img
                                      src={imageUrl}
                                      alt="Announcement Image"
                                      className="max-w-full h-auto rounded-lg shadow-sm w-full"
                                      style={{
                                        maxHeight: img.size === 'small' ? '120px' :
                                                  img.size === 'medium' ? '200px' :
                                                  img.size === 'large' ? '300px' :
                                                  img.size === 'xlarge' ? '400px' : '200px',
                                        objectFit: 'contain'
                                      }}
                                      loading="lazy"
                                      crossOrigin="anonymous"
                                      onError={(e) => {
                                        // Silently hide broken images (may be deleted from storage)
                                        (e.target as HTMLImageElement).style.display = 'none';
                                      }}
                                    />
                                  </div>
                                ) : null;
                              })}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </article>
                ));
              })()}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <p>{t('bulletin.noAnnouncementsThisWeek')}</p>
            </div>
          )}

          {/* Meetings */}
          {Array.isArray(data?.meetings) && data.meetings.length > 0 && (
            <div className="mt-6">
              <h3 className="font-bold text-gray-900 mb-3">{t('bulletin.meetingsAndActivities')}</h3>
              <div className="space-y-3">
                {data.meetings.map((m, i) => (
                  <div key={i} className="border-l-4 border-green-500 pl-4">
                    <h4 className="font-semibold text-gray-900">{m.title}</h4>
                    <p className="text-gray-700">{m.time} • {m.location}</p>
                    {m.description && (
                      <p className="text-gray-600 text-sm mt-1">{m.description}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Special Events */}
          {Array.isArray(data?.specialEvents) && data.specialEvents.length > 0 && (
            <div className="mt-6">
              <h3 className="font-bold text-gray-900 mb-3">{t('bulletin.specialEvents')}</h3>
              <div className="space-y-3">
                {data.specialEvents.map((e, i) => (
                  <div key={i} className="border-l-4 border-purple-500 pl-4">
                    <h4 className="font-semibold text-gray-900">{e.title}</h4>
                    <p className="text-gray-700">{e.date} • {e.time} • {e.location}</p>
                    {e.description && <p className="text-gray-600 text-sm mt-1">{e.description}</p>}
                    {e.contact && <p className="text-gray-600 text-sm mt-1">Contact: {e.contact}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Submission Link */}
          {!hideTabs && bulletinId && (
            <div className="mt-6 p-4 bg-green-50 rounded-lg text-center">
              <p className="text-green-800 mb-2">{t('bulletin.haveAnnouncementToShare')}</p>
              <a
                href={`/submit/${bulletinId}`}
                className="inline-flex items-center px-3 py-2 bg-green-600 text-white text-sm rounded-full hover:bg-green-700 transition-colors"
              >
                📝 {t('bulletin.submitAnnouncement')}
              </a>
            </div>
          )}
        </div>
      )}

      {/* ------------------------------- Ward Info ---------------------------- */}
      {activeTab === 'unitinfo' && (
        <div id="tab-panel-unitinfo" role="tabpanel" aria-labelledby="tab-unitinfo" className="p-6 space-y-4 text-sm leading-relaxed">
          {/* Ward Leadership Section */}
          {Array.isArray(data.wardLeadership) && data.wardLeadership.some(e => e && (e.title || e.name || e.phone)) && (
            <>
              <h3 className="text-base font-bold mb-3 text-center">{t('terminology.wardLeadership', { unit: getTranslatedUnitLabel(t, unitTypeOverride) })}</h3>
              <div className="overflow-x-auto">
                <table className="min-w-full border text-sm">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="px-3 py-2 border">{t('form.title')}</th>
                      <th className="px-3 py-2 border text-center">{t('form.name')}</th>
                      <th className="px-3 py-2 border">{t('form.contact')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.wardLeadership || []).map((e, idx) => (
                      <tr key={idx}>
                        <td className="border px-3 py-2 font-bold">{e.title}</td>
                        <td className="border px-3 py-2 text-center font-normal">{e.name}</td>
                        <td className="border px-3 py-2 font-normal">{e.phone}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Missionaries Section */}
          {Array.isArray(data.missionaries) && data.missionaries.some(e => e && (e.name || e.phone)) && (
            <>
              <h3 className="text-base font-bold mb-3 text-center mt-8">{t('form.missionaries')}</h3>
              <div className="overflow-x-auto">
                <table className="min-w-full border text-sm">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="px-3 py-2 border text-center">{t('form.name')}</th>
                      <th className="px-3 py-2 border">{t('form.contact')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.missionaries || []).map((e, idx) => (
                      <tr key={idx}>
                        <td className="border px-3 py-2 text-center font-bold">{e.name}</td>
                        <td className="border px-3 py-2 font-normal">{e.phone}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Ward Missionaries Section */}
          {Array.isArray(data.wardMissionaries) && data.wardMissionaries.some(e => e && (e.name || e.mission || e.setApartDate || e.expectedReturnDate || e.email)) && (() => {
            const fullTimeMissionaries = (data?.wardMissionaries || []).filter(e => e && e.serviceType !== 'military');
            const militaryMembers = (data?.wardMissionaries || []).filter(e => e && e.serviceType === 'military');

            // Sort by expected return date (earliest first)
            const sorted = [...fullTimeMissionaries].sort((a, b) => {
              const dateA = a.expectedReturnDate || '';
              const dateB = b.expectedReturnDate || '';
              if (!dateA && !dateB) return 0;
              if (!dateA) return 1;
              if (!dateB) return -1;
              return dateA.localeCompare(dateB);
            });

            return (
              <>
                {sorted.length > 0 && (
                  <>
                    <h3 className="text-base font-bold mb-3 text-center mt-8">{t('terminology.wardMissionaries', { unit: getTranslatedUnitLabel(t, unitTypeOverride) })}</h3>
                    {sorted.length > 2 ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {sorted.map((e, idx) => (
                          <div key={idx} className="border border-gray-300 rounded-lg p-3">
                            <div className="font-bold text-sm mb-2">{e.name}</div>
                            {e.mission && <div className="text-xs text-gray-600 mb-1 font-normal">{e.mission}</div>}
                            {e.setApartDate && <div className="text-xs text-gray-600 mb-1 font-normal">{t('form.setApartDate')}: {formatDate(e.setApartDate, i18n.language)}</div>}
                            {e.expectedReturnDate && <div className="text-xs text-gray-600 mb-1 font-normal">{t('form.expectedReturn')}: {formatDate(e.expectedReturnDate, i18n.language)}</div>}
                            {e.email && <div className="text-xs text-gray-600 font-normal">{e.email}</div>}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="min-w-full border text-sm">
                          <thead>
                            <tr className="bg-gray-100">
                              <th className="px-3 py-2 border">{t('form.name')}</th>
                              <th className="px-3 py-2 border">{t('form.mission')}</th>
                              <th className="px-3 py-2 border">{t('form.setApartDate')}</th>
                              <th className="px-3 py-2 border">{t('form.expectedReturn')}</th>
                              <th className="px-3 py-2 border">{t('form.email')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sorted.map((e, idx) => (
                              <tr key={idx}>
                                <td className="border px-3 py-2 font-bold">{e.name}</td>
                                <td className="border px-3 py-2 font-normal">{e.mission}</td>
                                <td className="border px-3 py-2 font-normal">{e.setApartDate ? formatDate(e.setApartDate, i18n.language) : ''}</td>
                                <td className="border px-3 py-2 font-normal">{e.expectedReturnDate ? formatDate(e.expectedReturnDate, i18n.language) : ''}</td>
                                <td className="border px-3 py-2 font-normal">{e.email}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}

                {/* Serving in the Military Section */}
                {militaryMembers.length > 0 && (
                  <>
                    <h3 className="text-base font-bold mb-3 text-center mt-8">{t('bulletin.servingInMilitary', 'Serving in the Military')}</h3>
                    {militaryMembers.length > 2 ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {militaryMembers.map((e, idx) => (
                          <div key={idx} className="border border-gray-300 rounded-lg p-3">
                            <div className="font-bold text-sm mb-2">{e.name}</div>
                            {e.mission && <div className="text-xs text-gray-600 mb-1 font-normal">{e.mission}</div>}
                            {e.email && <div className="text-xs text-gray-600 font-normal">{e.email}</div>}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="min-w-full border text-sm">
                          <thead>
                            <tr className="bg-gray-100">
                              <th className="px-3 py-2 border">{t('form.name')}</th>
                              <th className="px-3 py-2 border">{t('form.militaryBranch', 'Branch of Service')}</th>
                              <th className="px-3 py-2 border">{t('form.email')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {militaryMembers.map((e, idx) => (
                              <tr key={idx}>
                                <td className="border px-3 py-2 font-bold">{e.name}</td>
                                <td className="border px-3 py-2 font-normal">{e.mission}</td>
                                <td className="border px-3 py-2 font-normal">{e.email}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </>
            );
          })()}

          {/* Service Missionaries Section */}
          {Array.isArray(data.serviceMissionaries) && data.serviceMissionaries.some(e => e && (e.name || e.serviceName)) && (
            <>
              <h3 className="text-base font-bold mb-3 text-center mt-8">{t('form.serviceMissionaries')}</h3>
              {(() => {
                const serviceMissionaries = data?.serviceMissionaries || [];
                
                return serviceMissionaries.length > 2 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {serviceMissionaries.map((e, idx) => (
                      <div key={idx} className="border border-gray-300 rounded-lg p-3">
                        <div className="font-bold text-sm mb-2">{e.name}</div>
                        {e.serviceName && <div className="text-xs text-gray-600 font-normal">{e.serviceName}</div>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full border text-sm">
                      <thead>
                        <tr className="bg-gray-100">
                          <th className="px-3 py-2 border">{t('form.name')}</th>
                          <th className="px-3 py-2 border">{t('form.calling')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {serviceMissionaries.map((e, idx) => (
                          <tr key={idx}>
                            <td className="border px-3 py-2 font-bold">{e.name}</td>
                            <td className="border px-3 py-2 font-normal">{e.serviceName || ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </>
          )}

          {/* No Ward Info Message */}
          {!hasWardInfo(data) && (
            <div className="text-center py-8">
              <div className="mb-4">
                <svg className="w-16 h-16 text-gray-300 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V6a1 1 0 00-1-1H5a1 1 0 00-1 1v1a1 1 0 001 1zm12 0h2a1 1 0 001-1V6a1 1 0 00-1-1h-2a1 1 0 00-1 1v1a1 1 0 001 1zM5 20h2a1 1 0 001-1v-1a1 1 0 00-1-1H5a1 1 0 00-1 1v1a1 1 0 001 1z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">{t('qrCode.qrCode')}</h3>
              <p className="text-gray-600 mb-4">{t('qrCode.scanQrCodeToAccess')}</p>
              <div className="flex justify-center">
                {qrUrl ? (
                  <img
                    src={qrUrl}
                    alt="QR Code for this bulletin"
                    className="border-2 border-gray-200 rounded-lg"
                    crossOrigin="anonymous"
                  />
                ) : null}
              </div>
              <p className="text-xs text-gray-500 mt-4">
                {t('bulletin.noWardInfoAvailable')}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="bg-gray-100 text-center border-t border-gray-300 p-3">
        <p className="text-sm text-gray-500">{data?.wardName}</p>
      </div>
    </div>
  );
}

export default React.memo(BulletinPreview);

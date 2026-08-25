import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Printer, Mic } from 'lucide-react';
import type { BulletinData } from '../types/bulletin';
import { buildConductingScript, TranslateFn } from '../lib/conductingAgenda';

const formatDate = (dateString: string, locale: string = 'en'): string => {
  if (!dateString) return '';
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
};

interface ConductingAgendaModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: BulletinData;
}

const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export default function ConductingAgendaModal({ isOpen, onClose, data }: ConductingAgendaModalProps) {
  const { t, i18n } = useTranslation();

  const sections = useMemo(
    () => (isOpen ? buildConductingScript(data, t as TranslateFn) : []),
    [isOpen, data, t]
  );

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const title = t('conducting.title', 'Conducting Agenda');
  const dateLabel = data.date ? formatDate(data.date, i18n.language) : '';

  // The bulletin's own print pipeline is scoped to the hidden print portal, so
  // the conducting agenda prints from its own window instead of fighting that
  // CSS. Content is user-entered text — escape everything interpolated.
  const handlePrint = () => {
    const win = window.open('', '_blank', 'width=800,height=1000');
    if (!win) return;
    const body = sections
      .map(section => {
        const lines = section.lines
          .map(line =>
            line.kind === 'note'
              ? `<p class="note">${escapeHtml(line.text)}</p>`
              : `<p class="script">${escapeHtml(line.text)}</p>`
          )
          .join('');
        return `<section><h2>${escapeHtml(section.title)}</h2>${lines}</section>`;
      })
      .join('');
    win.document.write(`<!DOCTYPE html>
<html lang="${escapeHtml(i18n.language || 'en')}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; color: #111; max-width: 42rem; margin: 2rem auto; padding: 0 1rem; }
  h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
  .meta { color: #444; margin-bottom: 1.5rem; }
  section { margin-bottom: 1.25rem; page-break-inside: avoid; }
  h2 { font-size: 1rem; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #999; padding-bottom: 0.2rem; margin-bottom: 0.5rem; }
  p { margin: 0.4rem 0; line-height: 1.5; }
  .note { font-style: italic; color: #555; font-size: 0.9rem; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<p class="meta">${escapeHtml([data.wardName, dateLabel].filter(Boolean).join(' — '))}</p>
${body}
</body>
</html>`);
    win.document.close();
    win.focus();
    win.print();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-2 sm:p-4 z-50">
      <div role="dialog" aria-modal="true" aria-labelledby="conducting-agenda-modal-title" className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[95vh] sm:max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between p-4 sm:p-6 border-b">
          <div className="flex items-center gap-2">
            <Mic className="w-5 h-5 text-blue-600" />
            <h2 id="conducting-agenda-modal-title" className="text-xl font-semibold">{title}</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="inline-flex items-center px-3 py-2 bg-gray-200 text-gray-800 rounded-full hover:bg-gray-300 transition-colors text-sm"
            >
              <Printer className="w-4 h-4 mr-2" />
              {t('common.print', 'Print')}
            </button>
            <button autoFocus onClick={onClose} aria-label={t('common.close')} className="text-gray-400 hover:text-gray-600 px-2 text-xl">
              ✕
            </button>
          </div>
        </div>

        <div className="p-4 sm:p-6 overflow-y-auto">
          <p className="text-sm text-gray-500 mb-4">
            {t('conducting.privateNotice', 'This agenda is for the person conducting — it is not shown on the public bulletin.')}
          </p>
          {(data.wardName || dateLabel) && (
            <p className="text-gray-700 font-medium mb-4">
              {[data.wardName, dateLabel].filter(Boolean).join(' — ')}
            </p>
          )}
          <div className="space-y-6">
            {sections.map(section => (
              <section key={section.id}>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 border-b pb-1 mb-2">
                  {section.title}
                </h3>
                <div className="space-y-2">
                  {section.lines.map((line, i) =>
                    line.kind === 'note' ? (
                      <p key={i} className="text-sm italic text-gray-500">{line.text}</p>
                    ) : (
                      <p key={i} className="text-gray-900 leading-relaxed">{line.text}</p>
                    )
                  )}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

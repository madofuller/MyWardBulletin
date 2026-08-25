import type { TFunction } from 'i18next';
import type { BulletinData, WardBusinessEntry } from '../types/bulletin';
import { getTranslatedUnitLabel } from './terminology';

// react-i18next's t, narrowed to the (key, defaultValue, options) call shape.
export type TranslateFn = (key: string, defaultValue?: string, options?: Record<string, unknown>) => string;

export interface ScriptLine {
  /** 'script' is read aloud from the pulpit; 'note' is a stage direction for the conductor. */
  kind: 'script' | 'note';
  text: string;
}

export interface ScriptSection {
  id: string;
  title: string;
  lines: ScriptLine[];
}

const hymnLabel = (number?: string, title?: string): string => {
  const num = (number || '').trim();
  const name = (title || '').trim();
  if (num && name) return `#${num}, “${name}”`;
  return name || (num ? `#${num}` : '');
};

const entryLine = (e: WardBusinessEntry): ScriptLine | null => {
  const name = (e.name || '').trim();
  const calling = (e.calling || '').trim();
  if (!name && !calling) return null;
  return { kind: 'script', text: name && calling ? `${name} — ${calling}` : name || calling };
};

/**
 * Turn a bulletin into a conducting script: the order of the meeting with
 * readable pulpit language for each item, in the bulletin's language. Pure —
 * all wording comes through t() so it follows the app's locale.
 */
export function buildConductingScript(data: BulletinData, t: TranslateFn): ScriptSection[] {
  const sections: ScriptSection[] = [];
  const agenda = Array.isArray(data.agenda) ? data.agenda : [];

  // Welcome
  {
    const lines: ScriptLine[] = [];
    if (data.leadership?.conducting) {
      lines.push({ kind: 'note', text: t('conducting.conductingNote', 'Conducting: {{name}}', { name: data.leadership.conducting }) });
    }
    lines.push({
      kind: 'script',
      text: data.wardName
        ? t('conducting.welcomeNamed', 'Brothers and sisters, we welcome you to sacrament meeting of the {{name}}.', { name: data.wardName })
        : t('conducting.welcome', 'Brothers and sisters, we welcome you to sacrament meeting.')
    });
    if (data.leadership?.presiding) {
      lines.push({ kind: 'script', text: t('conducting.presiding', 'Presiding at this meeting is {{name}}.', { name: data.leadership.presiding }) });
    }
    lines.push({ kind: 'note', text: t('conducting.announcementsNote', 'Share any welcome remarks and announcements not printed in the bulletin.', {}) });
    sections.push({ id: 'welcome', title: t('conducting.sectionWelcome', 'Welcome'), lines });
  }

  // Opening hymn and invocation
  {
    const lines: ScriptLine[] = [];
    const opening = hymnLabel(data.musicProgram?.openingHymnNumber, data.musicProgram?.openingHymnTitle);
    if (opening) {
      lines.push({ kind: 'script', text: t('conducting.openingHymn', 'We will begin by singing hymn {{hymn}}.', { hymn: opening }) });
    }
    if (data.prayers?.opening) {
      lines.push({ kind: 'script', text: t('conducting.invocation', 'The invocation will be offered by {{name}}.', { name: data.prayers.opening }) });
    }
    if (lines.length > 0) {
      sections.push({ id: 'opening', title: t('conducting.sectionOpening', 'Opening'), lines });
    }
  }

  const speakerItems = agenda.filter(item => item.type === 'speaker');
  let speakerIndex = 0;

  agenda.forEach(item => {
    switch (item.type) {
      case 'ward_business': {
        const lines: ScriptLine[] = [];

        const releases = (item.releases || []).map(entryLine).filter(Boolean) as ScriptLine[];
        if (releases.length > 0) {
          lines.push({ kind: 'script', text: t('conducting.releasesIntro', 'The following have been released:', {}) });
          lines.push(...releases);
          lines.push({ kind: 'script', text: t('conducting.releasesThanks', 'We propose that they be given a vote of thanks for their service. Those who wish to express appreciation may manifest it by the uplifted hand.', {}) });
        }

        const sustainings = (item.sustainings || []).map(entryLine).filter(Boolean) as ScriptLine[];
        if (sustainings.length > 0) {
          lines.push({ kind: 'script', text: t('conducting.sustainingsIntro', 'The following have been called to serve, and we propose that they be sustained:', {}) });
          lines.push(...sustainings);
          lines.push({ kind: 'script', text: t('conducting.voteInFavor', 'Those in favor may manifest it by the uplifted hand.', {}) });
          lines.push({ kind: 'script', text: t('conducting.voteOpposed', 'Those opposed, if any, may manifest it.', {}) });
        }

        const ordinations = (item.ordinations || []).map(entryLine).filter(Boolean) as ScriptLine[];
        if (ordinations.length > 0) {
          lines.push({ kind: 'script', text: t('conducting.ordinationsIntro', 'We propose that the following be ordained to the office shown:', {}) });
          lines.push(...ordinations);
          lines.push({ kind: 'script', text: t('conducting.voteInFavor', 'Those in favor may manifest it by the uplifted hand.', {}) });
          lines.push({ kind: 'script', text: t('conducting.voteOpposed', 'Those opposed, if any, may manifest it.', {}) });
        }

        if ((item.newMembers || '').trim()) {
          lines.push({ kind: 'script', text: t('conducting.newMembers', 'We are pleased to welcome the following new members: {{names}}. We invite all to make them feel welcome.', { names: item.newMembers?.trim() }) });
        }

        if (lines.length > 0) {
          sections.push({
            id: item.id,
            title: t('bulletin.unitBusiness', '{{unit}} Business', { unit: getTranslatedUnitLabel(t as unknown as TFunction) }),
            lines
          });
        }
        break;
      }
      case 'sacrament': {
        const lines: ScriptLine[] = [];
        const sacramentHymn = hymnLabel(data.musicProgram?.sacramentHymnNumber, data.musicProgram?.sacramentHymnTitle);
        if (sacramentHymn) {
          lines.push({ kind: 'script', text: t('conducting.sacramentHymn', 'We will now prepare to partake of the sacrament by singing hymn {{hymn}}. Following the hymn, the sacrament will be administered by the Aaronic Priesthood.', { hymn: sacramentHymn }) });
        } else {
          lines.push({ kind: 'script', text: t('conducting.sacramentNoHymn', 'The sacrament will now be administered by the Aaronic Priesthood.', {}) });
        }
        lines.push({ kind: 'note', text: t('conducting.sacramentAdministered', '(The sacrament is administered.)', {}) });
        lines.push({ kind: 'script', text: t('conducting.sacramentThanks', 'We thank the priesthood for the reverent administration of the sacrament.', {}) });
        sections.push({ id: item.id, title: t('conducting.sectionSacrament', 'Sacrament'), lines });
        break;
      }
      case 'speaker': {
        if (!(item.name || '').trim()) break;
        speakerIndex += 1;
        let text: string;
        if (speakerItems.length === 1) {
          text = t('conducting.speakerOnly', 'Our speaker today will be {{name}}.', { name: item.name });
        } else if (speakerIndex === 1) {
          text = t('conducting.speakerFirst', 'Our first speaker will be {{name}}.', { name: item.name });
        } else if (speakerIndex === speakerItems.length) {
          text = t('conducting.speakerLast', 'Our concluding speaker will be {{name}}.', { name: item.name });
        } else {
          text = t('conducting.speakerNext', 'We will now hear from {{name}}.', { name: item.name });
        }
        sections.push({ id: item.id, title: t('conducting.sectionSpeaker', 'Speaker'), lines: [{ kind: 'script', text }] });
        break;
      }
      case 'musical': {
        const lines: ScriptLine[] = [];
        const piece = hymnLabel(item.hymnNumber, item.hymnTitle) || (item.songName || '').trim();
        if (item.label === 'Intermediate Hymn') {
          if (piece) {
            lines.push({ kind: 'script', text: t('conducting.intermediateHymn', 'We will now sing the intermediate hymn, {{hymn}}.', { hymn: piece }) });
          }
        } else if (piece) {
          lines.push({ kind: 'script', text: t('conducting.musicalNumber', 'We will now hear a musical number: {{piece}}.', { piece }) });
        } else {
          lines.push({ kind: 'script', text: t('conducting.musicalNumberUntitled', 'We will now hear a musical number.', {}) });
        }
        if ((item.performers || '').trim()) {
          lines.push({ kind: 'script', text: t('conducting.performedBy', 'Performed by {{names}}.', { names: item.performers }) });
        }
        if (lines.length > 0) {
          sections.push({ id: item.id, title: t('conducting.sectionMusic', 'Music'), lines });
        }
        break;
      }
      case 'testimony': {
        const lines: ScriptLine[] = [
          { kind: 'script', text: t('conducting.testimonies', 'The time will now be turned over to the congregation for the bearing of testimonies. We invite you to share brief testimonies of the Savior.', {}) }
        ];
        if ((item.note || '').trim()) {
          lines.push({ kind: 'note', text: item.note!.trim() });
        }
        sections.push({ id: item.id, title: t('conducting.sectionTestimonies', 'Bearing of Testimonies'), lines });
        break;
      }
      case 'baby_blessing': {
        const lines: ScriptLine[] = [];
        lines.push({
          kind: 'script',
          text: (item.childName || '').trim()
            ? t('conducting.babyBlessingNamed', '{{child}} will now receive a name and a blessing.', { child: item.childName })
            : t('conducting.babyBlessing', 'We will now have the blessing of a child.', {})
        });
        if ((item.parentNames || '').trim()) {
          lines.push({ kind: 'script', text: t('conducting.childOf', 'Child of {{parents}}.', { parents: item.parentNames }) });
        }
        sections.push({ id: item.id, title: t('conducting.sectionBabyBlessing', 'Baby Blessing'), lines });
        break;
      }
      case 'baptism_ordinance': {
        const lines: ScriptLine[] = [{
          kind: 'script',
          text: (item.candidateName || '').trim()
            ? t('conducting.baptismNamed', 'The ordinance of baptism will now be performed for {{name}}.', { name: item.candidateName })
            : t('conducting.baptism', 'The ordinance of baptism will now be performed.', {})
        }];
        if ((item.performedBy || '').trim()) {
          lines.push({ kind: 'script', text: t('conducting.ordinancePerformedBy', 'The ordinance will be performed by {{name}}.', { name: item.performedBy }) });
        }
        sections.push({ id: item.id, title: t('conducting.sectionBaptism', 'Baptism'), lines });
        break;
      }
      case 'confirmation': {
        const lines: ScriptLine[] = [{
          kind: 'script',
          text: (item.candidateName || '').trim()
            ? t('conducting.confirmationNamed', '{{name}} will now be confirmed a member of the Church.', { name: item.candidateName })
            : t('conducting.confirmation', 'We will now have a confirmation.', {})
        }];
        if ((item.performedBy || '').trim()) {
          lines.push({ kind: 'script', text: t('conducting.ordinancePerformedBy', 'The ordinance will be performed by {{name}}.', { name: item.performedBy }) });
        }
        sections.push({ id: item.id, title: t('conducting.sectionConfirmation', 'Confirmation'), lines });
        break;
      }
    }
  });

  // Closing hymn and benediction
  {
    const lines: ScriptLine[] = [
      { kind: 'script', text: t('conducting.closingThanks', 'We thank all who have participated in this meeting.', {}) }
    ];
    const closing = hymnLabel(data.musicProgram?.closingHymnNumber, data.musicProgram?.closingHymnTitle);
    if (closing) {
      lines.push({ kind: 'script', text: t('conducting.closingHymn', 'We will close by singing hymn {{hymn}}.', { hymn: closing }) });
    }
    if (data.prayers?.closing) {
      lines.push({ kind: 'script', text: t('conducting.benediction', 'The benediction will be offered by {{name}}.', { name: data.prayers.closing }) });
    }
    sections.push({ id: 'closing', title: t('conducting.sectionClosing', 'Closing'), lines });
  }

  return sections;
}

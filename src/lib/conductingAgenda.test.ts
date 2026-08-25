import { describe, it, expect } from 'vitest';
import { buildConductingScript, TranslateFn } from './conductingAgenda';
import type { BulletinData } from '../types/bulletin';

// Interpolates the English defaultValue like i18next would, so tests exercise
// the real wording without loading i18n.
const t: TranslateFn = (key, defaultValue, options) => {
  let text = defaultValue ?? key;
  for (const [name, value] of Object.entries(options ?? {})) {
    text = text.replaceAll(`{{${name}}}`, String(value));
  }
  return text;
};

const blankBulletin = (): BulletinData => ({
  wardName: 'Franklin 2nd Ward',
  date: '2026-08-30',
  meetingType: 'sacrament',
  theme: '',
  userTheme: '',
  bishopricMessage: '',
  announcements: [],
  meetings: [],
  specialEvents: [],
  agenda: [],
  prayers: { opening: '', closing: '', invocation: '', benediction: '' },
  musicProgram: {
    openingHymn: '', openingHymnNumber: '', openingHymnTitle: '',
    sacramentHymn: '', sacramentHymnNumber: '', sacramentHymnTitle: '',
    closingHymn: '', closingHymnNumber: '', closingHymnTitle: ''
  },
  leadership: { presiding: '', conducting: '', chorister: '', organist: '' },
  wardLeadership: [],
  missionaries: [],
  wardMissionaries: [],
  serviceMissionaries: []
});

const allText = (sections: ReturnType<typeof buildConductingScript>) =>
  sections.flatMap(s => s.lines.map(l => l.text)).join('\n');

describe('buildConductingScript', () => {
  it('always includes welcome and closing sections', () => {
    const sections = buildConductingScript(blankBulletin(), t);
    expect(sections[0].id).toBe('welcome');
    expect(sections[sections.length - 1].id).toBe('closing');
  });

  it('names the ward, presiding, opening hymn, and invocation', () => {
    const data = blankBulletin();
    data.leadership.presiding = 'Bishop Larsen';
    data.prayers.opening = 'Amy Pratt';
    data.musicProgram.openingHymnNumber = '2';
    data.musicProgram.openingHymnTitle = 'The Spirit of God';
    const text = allText(buildConductingScript(data, t));
    expect(text).toContain('Franklin 2nd Ward');
    expect(text).toContain('Presiding at this meeting is Bishop Larsen.');
    expect(text).toContain('#2, “The Spirit of God”');
    expect(text).toContain('The invocation will be offered by Amy Pratt.');
  });

  it('scripts releases and sustainings with votes', () => {
    const data = blankBulletin();
    data.agenda = [{
      type: 'ward_business',
      id: 'wb1',
      releases: [{ id: 'r1', name: 'John Doe', calling: 'Primary Teacher' }],
      sustainings: [{ id: 's1', name: 'Jane Roe', calling: 'Relief Society President' }],
      ordinations: [],
      newMembers: 'The Nguyen family'
    }];
    const text = allText(buildConductingScript(data, t));
    expect(text).toContain('John Doe — Primary Teacher');
    expect(text).toContain('vote of thanks');
    expect(text).toContain('Jane Roe — Relief Society President');
    expect(text).toContain('Those in favor may manifest it by the uplifted hand.');
    expect(text).toContain('Those opposed, if any, may manifest it.');
    expect(text).toContain('The Nguyen family');
  });

  it('skips a ward business item with no content', () => {
    const data = blankBulletin();
    data.agenda = [{ type: 'ward_business', id: 'wb1', releases: [], sustainings: [], ordinations: [], newMembers: '' }];
    const sections = buildConductingScript(data, t);
    expect(sections.find(s => s.id === 'wb1')).toBeUndefined();
  });

  it('skips entries with empty names and callings', () => {
    const data = blankBulletin();
    data.agenda = [{
      type: 'ward_business',
      id: 'wb1',
      releases: [{ id: 'r1', name: '  ', calling: '' }],
      sustainings: [],
      ordinations: []
    }];
    const sections = buildConductingScript(data, t);
    expect(sections.find(s => s.id === 'wb1')).toBeUndefined();
  });

  it('uses first/last wording for multiple speakers and single wording for one', () => {
    const data = blankBulletin();
    data.agenda = [
      { type: 'speaker', id: 'sp1', name: 'A One', speakerType: 'adult' },
      { type: 'speaker', id: 'sp2', name: 'B Two', speakerType: 'adult' },
      { type: 'speaker', id: 'sp3', name: 'C Three', speakerType: 'adult' }
    ];
    const text = allText(buildConductingScript(data, t));
    expect(text).toContain('Our first speaker will be A One.');
    expect(text).toContain('We will now hear from B Two.');
    expect(text).toContain('Our concluding speaker will be C Three.');

    const single = blankBulletin();
    single.agenda = [{ type: 'speaker', id: 'sp1', name: 'A One', speakerType: 'adult' }];
    expect(allText(buildConductingScript(single, t))).toContain('Our speaker today will be A One.');
  });

  it('scripts the sacrament with its hymn and thanks', () => {
    const data = blankBulletin();
    data.musicProgram.sacramentHymnNumber = '169';
    data.musicProgram.sacramentHymnTitle = 'As Now We Take the Sacrament';
    data.agenda = [{ type: 'sacrament', id: 'sac1' }];
    const text = allText(buildConductingScript(data, t));
    expect(text).toContain('#169, “As Now We Take the Sacrament”');
    expect(text).toContain('administered by the Aaronic Priesthood');
    expect(text).toContain('We thank the priesthood');
  });

  it('includes closing hymn and benediction', () => {
    const data = blankBulletin();
    data.musicProgram.closingHymnNumber = '152';
    data.prayers.closing = 'David Cho';
    const text = allText(buildConductingScript(data, t));
    expect(text).toContain('#152');
    expect(text).toContain('The benediction will be offered by David Cho.');
  });
});

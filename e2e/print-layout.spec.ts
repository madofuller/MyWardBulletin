import { test, expect, type Page } from '@playwright/test';
import { watchErrors, gotoEditor } from './helpers';

// These tests assert against the hidden print portal (.print-source-portal),
// which is the exact DOM that @media print reveals — so they verify what
// actually comes out of the printer, not just the on-screen preview.

/** Seed the editor's localStorage draft before the app boots. */
async function seedDraft(page: Page, data: Record<string, unknown>): Promise<void> {
  await page.addInitScript((draftData) => {
    window.localStorage.setItem(
      'draft_bulletin',
      JSON.stringify({ data: draftData, savedAt: Date.now(), bulletinId: null })
    );
  }, data);
}

function announcement(id: string, title: string, content: string) {
  return { id, title, content, category: 'general', audience: 'ward' };
}

// The announcements multi-column container is the only element in the print
// layout with an inline column-count style.
const COLUMNS = '.print-source-portal [style*="column-count"]';

function columnCount(page: Page): Promise<number> {
  return page.locator(COLUMNS).evaluate((el) => Number(getComputedStyle(el).columnCount));
}

/** Vertical/horizontal overflow of the announcements area, in px (≤2 = fits). */
function overflowPx(page: Page): Promise<number> {
  return page.locator(COLUMNS).evaluate((el) => {
    const wrap = el.parentElement as HTMLElement;
    return Math.max(
      wrap.scrollHeight - wrap.clientHeight,
      wrap.scrollWidth - wrap.clientWidth
    );
  });
}

test.describe('print layout', () => {
  test('musical number song name and performers both appear in print', async ({ page }) => {
    const errors = watchErrors(page);
    await seedDraft(page, {
      agenda: [
        {
          type: 'musical',
          id: 'm1',
          label: 'Musical Number',
          songName: 'Amazing Grace',
          performers: 'The Larsen Family',
        },
      ],
    });
    await gotoEditor(page);

    const portal = page.locator('.print-source-portal');
    await expect(portal).toContainText('Amazing Grace');
    await expect(portal).toContainText('The Larsen Family');
    errors.assertClean();
  });

  test('a few short announcements print in a single column', async ({ page }) => {
    const errors = watchErrors(page);
    await seedDraft(page, {
      announcements: [
        announcement('a1', 'Ward Picnic', 'Saturday at the park pavilion, 10am. Bring a side dish.'),
        announcement('a2', 'Tithing Settlement', 'Sign-up sheet is in the foyer.'),
        announcement('a3', 'Choir Practice', 'Sundays at 9am in the chapel.'),
      ],
    });
    await gotoEditor(page);

    await expect.poll(() => columnCount(page)).toBe(1);
    await expect.poll(() => overflowPx(page), { timeout: 10_000 }).toBeLessThanOrEqual(2);
    expect(await columnCount(page)).toBe(1);
    errors.assertClean();
  });

  test('six moderate announcements print in three columns, not four', async ({ page }) => {
    const filler =
      'Please see the sign-up sheet in the foyer for details and contact a member of the activities committee with any questions you may have.';
    const errors = watchErrors(page);
    await seedDraft(page, {
      announcements: [1, 2, 3, 4, 5, 6].map((n) =>
        announcement(`a${n}`, `Announcement ${n}`, filler)
      ),
    });
    await gotoEditor(page);

    // Starts at 3 columns for 6 announcements; short content must not
    // escalate to 4 (the pre-fix behavior Garry reported).
    await expect.poll(() => columnCount(page)).toBe(3);
    await expect.poll(() => overflowPx(page), { timeout: 10_000 }).toBeLessThanOrEqual(2);
    expect(await columnCount(page)).toBe(3);
    errors.assertClean();
  });

  test('heavy announcement content still auto-fits without overflow', async ({ page }) => {
    const longContent =
      'The stake is organizing a multi-ward service project at the cannery next month. Volunteers are needed for both the morning and afternoon shifts, and youth are welcome when accompanied by a leader. Please coordinate with your quorum or class presidency.';
    const errors = watchErrors(page);
    await seedDraft(page, {
      announcements: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) =>
        announcement(`a${n}`, `Announcement ${n}`, longContent)
      ),
    });
    await gotoEditor(page);

    // Column escalation (up to 4) plus font shrink must converge to a fit.
    await expect.poll(() => overflowPx(page), { timeout: 15_000 }).toBeLessThanOrEqual(2);
    expect(await columnCount(page)).toBeGreaterThanOrEqual(3);
    errors.assertClean();
  });
});

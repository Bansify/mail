// =============================================================================
// Phone chrome and the Archive action, end to end.
//
// Two rules the owner cares about are checked here:
//
//   1. there is NO bottom tab bar on a phone. Folder navigation lives in the
//      drawer, so the bar was deleted (not hidden), and this test would catch it
//      coming back into the DOM;
//   2. the phone header is `[hamburger] [search] [avatar]` — the menu outside
//      and to the LEFT of the search pill, and the same avatar the desktop dock
//      shows on the RIGHT of it.
//
// Plus the Archive button: it must really move a conversation out of the Inbox
// and into Archive, against the real Worker (`moveToArchive` was rejected with a
// 400 before, so nothing ever left the list).
// =============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { act, mountApp, resetCookie, text, unmountApp, waitFor } from './ui-harness.tsx';

const ARCHIVED = 'Invoice for October';

function buttonByLabel(label: string): HTMLElement | undefined {
  return [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === label);
}

/**
 * A button inside the list pane. The folder rail also has an "Archive" button,
 * so the toolbar action must be looked up in the mail column only.
 */
function inMailColumn(label: string): HTMLElement | undefined {
  const column = document.querySelector('main');
  assert.ok(column, 'the mail column exists');
  return [...column.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === label);
}

/** The phone search input (the phone row is the only `md:hidden` one). */
function mobileSearch(): HTMLInputElement | undefined {
  return [...document.querySelectorAll('input')].find((i) => i.placeholder === 'Search mail');
}

function phoneHeader(): HTMLElement {
  const input = mobileSearch();
  assert.ok(input, 'search pill exists');
  // header row -> search pill -> input
  const row = input.parentElement?.parentElement as HTMLElement | null;
  assert.ok(row, 'header row exists');
  assert.ok(row.className.includes('md:hidden'), 'the phone row is the md:hidden one');
  return row;
}

test('phones show no bottom tab bar at all', async () => {
  resetCookie();
  const root = await mountApp();
  await waitFor(() => text().includes(ARCHIVED), 'inbox loaded');

  assert.equal(document.querySelector('nav[aria-label="Mobile navigation"]'), null, 'no 5-tab bottom bar');
  assert.deepEqual(
    [...document.querySelectorAll('nav[aria-label]')].map((n) => n.getAttribute('aria-label')),
    [],
    'no bottom navigation is rendered'
  );
  // Folder switching still exists: it is in the drawer, behind the hamburger.
  assert.ok(buttonByLabel('Open navigation'), 'the hamburger opens the folder drawer');

  await unmountApp(root);
});

test('the phone header is hamburger, then search, then the dock avatar', async () => {
  resetCookie();
  const root = await mountApp();
  await waitFor(() => text().includes(ARCHIVED), 'inbox loaded');

  const row = phoneHeader();
  const children = [...row.children] as HTMLElement[];
  assert.equal(children.length, 3, 'exactly three slots: menu, search, avatar');

  const [menu, search, avatar] = children;
  assert.equal(menu.getAttribute('aria-label'), 'Open navigation', 'leftmost slot is the 3-line menu');
  assert.ok(!search.contains(menu), 'the menu sits OUTSIDE the search bar');
  assert.ok(search.contains(mobileSearch()!), 'middle slot is the search bar');

  const avatarButton = (avatar.querySelector('button') ?? avatar) as HTMLElement;
  assert.match(avatarButton.getAttribute('aria-label') || '', /^Accounts \(/, 'rightmost slot opens the account sheet');
  assert.ok(!search.contains(avatarButton), 'the avatar sits OUTSIDE the search bar, to its right');

  // The avatar on a phone is the same component the desktop dock renders.
  const dockAvatar = document.querySelector('aside[aria-label="Bansify apps"] button[aria-label^="Accounts ("]');
  assert.ok(dockAvatar, 'desktop dock avatar exists');
  assert.equal(
    avatarButton.className,
    (dockAvatar as HTMLElement).className,
    'the phone avatar looks exactly like the dock one'
  );

  await unmountApp(root);
});

test('archiving a conversation really moves it to Archive', async () => {
  resetCookie();
  const root = await mountApp();
  await waitFor(() => text().includes(ARCHIVED), 'inbox loaded');

  // Select one conversation through its row avatar (the checkbox), then use the
  // toolbar's Archive action — the exact path a user takes.
  const rowAvatar = [...document.querySelectorAll('main [class*="cursor-pointer"]')]
    .filter((row) => row.textContent?.includes(ARCHIVED))
    .map((row) => row.querySelector('button[aria-label="Select message"]'))
    .filter((b): b is HTMLButtonElement => !!b)
    .pop();
  assert.ok(rowAvatar, 'a row avatar exists');
  await act(async () => {
    rowAvatar.click();
  });
  await waitFor(() => text().includes('selected'), 'selection bar shown');

  try {
    const archive = inMailColumn('Archive');
    assert.ok(archive, 'Archive action exists in the selection bar');
    await act(async () => {
      archive.click();
    });
    await waitFor(() => !text().includes(ARCHIVED), 'the conversation left the Inbox');

    // Archive now lists it: open the folder from the rail/drawer.
    const archiveFolder = [...document.querySelectorAll('button')].find((b) =>
      /^Archive/.test((b.textContent || '').trim())
    );
    assert.ok(archiveFolder, 'Archive folder button exists');
    await act(async () => {
      (archiveFolder as HTMLElement).click();
    });
    await waitFor(() => text().includes(ARCHIVED), 'the conversation is listed under Archive');
  } finally {
    await unmountApp(root);
    // Put the local preview mailbox back, so the next test file starts clean.
    await restorArchived();
    await resetCookie();
  }
});

/** Moves everything the Archive test moved back into the Inbox. */
async function restorArchived(): Promise<void> {
  const list = (await fetch('/api/mail/messages?folder=archive', { credentials: 'include' }).then((r) =>
    r.json()
  )) as { messages: Array<{ id: string }> };
  for (const message of list.messages ?? []) {
    await fetch(`/api/mail/messages/${message.id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ folder: 'inbox' }),
    });
  }
}

# new-tab

A keyboard-first Chrome new tab page for your bookmarks. Folders show as cards
packed into columns, and a filter that always has the cursor lets you find,
open, edit and rearrange links without the mouse.

Top sites (`⌃1`–`⌃8`) are the first 8 loose links on your bookmarks bar. With no
loose links there, the page falls back to Chrome's most-visited list, whose
order changes as you browse.

Chrome puts the cursor in the address bar when a new tab opens, so the page
reloads itself once to take it. That's why the address bar shows the
extension's address instead of staying empty.

Enter opens the selected bookmark. When nothing matches, Enter searches Google
or goes to the address you typed, and `⌘⇧↵` searches Google even when something
matches. Empty folders stay hidden.

Press `?` on the page for every shortcut, or `⌘K` for everything else.

## Install

1. Clone this repo.
2. Open `chrome://extensions`, turn on Developer mode, click Load unpacked, and
   pick the cloned folder.
3. Turn off any other extension that replaces the new tab page.

Maintained by agents; see [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

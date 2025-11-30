<img src="icons/icon128.png" align="left" width="128" height="128" alt="Focus Mode Icon">

# Focus Mode

<br clear="left"/>

A browser extension that lets you hide distracting elements on any website with a simple point-and-click interface.

## What it does

Focus Mode helps you create a cleaner browsing experience by letting you remove elements that get in your way. Instead of dealing with complex CSS selectors or browser dev tools, just click what you want to hide.

## Features

- **Point-and-click hiding**: Activate selection mode, hover over any element, and click to hide it
- **Persistent settings**: Hidden elements stay hidden across page reloads and browser sessions
- **Per-site configuration**: Each website maintains its own list of hidden elements
- **Smart selector generation**: Automatically creates reliable CSS selectors using IDs, data attributes, classes, or DOM paths
- **Dynamic content support**: Continues hiding elements even when websites load content dynamically
- **Undo functionality**: Quickly restore the last hidden element if you make a mistake
- **Export and import**: Back up your settings or share them across devices
- **Readable element labels**: See what you've hidden with human-friendly descriptions instead of technical selectors

## Installation

### From source

1. Clone this repository or download the ZIP file
2. Open your browser's extension management page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
3. Enable "Developer mode" (toggle in the top right)
4. Click "Load unpacked"
5. Select the extension directory

## How to use

1. Click the Focus Mode icon in your browser toolbar
2. Click "Start Focusing" to activate selection mode
3. Hover over elements on the page to highlight them
4. Click any element to hide it
5. Press ESC to exit selection mode

The extension popup shows how many elements you've hidden on the current site. You can view the full list, remove individual items, or reset everything for that site.

## Managing hidden elements

- **View list**: See all hidden elements for the current site with their descriptions
- **Remove individual items**: Click the × button next to any hidden element to show it again
- **Undo**: Quickly restore the last element you hid
- **Reset site**: Clear all hidden elements for the current website
- **Export/Import**: Back up your settings as a JSON file or restore from a backup

## Technical details

The extension uses CSS injection to hide elements with `display: none !important`, which ensures they stay hidden even if the website's JavaScript tries to show them. It monitors the page for changes and reapplies your settings when new content loads.

Selectors are generated using a fallback strategy:
1. Element ID (if unique)
2. Data attributes (data-testid, data-cy)
3. Custom element tags
4. Class combinations
5. ARIA attributes
6. DOM path from body

## Privacy

All settings are stored locally in your browser using Chrome's storage API. Nothing is sent to external servers.

## Browser compatibility

This extension uses Manifest V3 and should work on:
- Chrome 88+
- Edge 88+
- Other Chromium-based browsers

## License

MIT

## Contributing

Issues and pull requests are welcome.

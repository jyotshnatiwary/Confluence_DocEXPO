# Confluence Bulk Exporter

A Chrome / Edge extension that exports a Confluence page **and all of its child pages** as a single **ZIP** — with folders that mirror the Confluence page tree and one Word (`.doc`) or HTML (`.html`) file per page.

- Works with any **Confluence Cloud** site (`*.atlassian.net`).
- Uses your **own logged-in session** — no credentials stored, nothing leaves your browser.
- **Free**, no paid Marketplace app, no admin approval required.

---

## Install (2 minutes)

1. **Download** this folder to your computer (unzip if you got it as a ZIP).
   Recommended location: `C:\Tools\confluence-bulk-exporter` (or anywhere permanent — don't delete it later).

2. Open **Chrome** (or Edge) and go to:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`

3. Turn on **Developer mode** — toggle in the top-right corner of the page.

4. Click **Load unpacked** → select the folder you just downloaded → **Select Folder**.

5. Click the puzzle-piece icon in the browser toolbar → pin **Confluence Bulk Exporter** so its icon is visible.

That's it — no other setup needed.

> Not seeing "Developer mode"? If your browser says *"Managed by your organization"* and the toggle is greyed out, your company's IT policy blocks unpacked extensions. Try **Microsoft Edge** instead, or ask IT to allow developer extensions.

---

## Use it

1. Open Confluence and log in as normal.
2. Navigate to the **parent page** you want to export (e.g. a whole section).
3. Click the extension icon in the toolbar.
4. Choose:
   - **Format** — Word (`.doc`) or HTML.
   - **Include all child pages** (on by default).
   - **Max depth** — `0` = unlimited.
   - **Embed images inline** — tick this for a fully offline copy (larger files).
5. Click **Export as ZIP** → choose where to save.

You get a folder structure like:

```
BrandCloud-export.zip
└── BrandCloud/
    ├── BrandCloud.doc
    ├── Presentation of BrandCloud.doc
    ├── Support Operation - BrandCloud/
    │   ├── User Management - BrandCloud/
    │   │   ├── Internal Admin Access.doc
    │   │   └── ...
    │   └── Assets - BrandCloud/
    │       └── ...
    └── ...
```

Unzip, open in Word — done. To get PDFs, open in Word and use *File → Save As → PDF*.

---

## Notes & limits

- **Login required** — if your Confluence session times out mid-export, log back in and retry.
- **Images** — by default they reference Confluence's URLs (display fine while logged in). Tick *Embed images inline* for offline copies.
- **Macros** — Confluence renders 95% of macros to plain HTML for export. Exotic third-party macros may render as placeholders.
- **Long paths** — deep trees + long titles can hit Windows' 260-char path limit. Extract to a short path like `C:\c\` if files get skipped.
- **Confluence Server / Data Center** — this extension targets Confluence Cloud (`*.atlassian.net`). Server / DC support would need a small change to the host permissions.

---

## Privacy

- The extension only calls **your own Confluence instance** and the browser's own download API.
- **Nothing is sent to a third party.** No analytics, no telemetry, no external server.
- Your session cookies stay in your browser — the extension never reads them directly or stores them anywhere.

---

## Uninstall

`chrome://extensions` → find **Confluence Bulk Exporter** → **Remove**. Delete the folder if you want.

---

## License

MIT — free to use, share, modify. See `LICENSE`.

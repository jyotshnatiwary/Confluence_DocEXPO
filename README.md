# Confluence Bulk Exporter

A Chrome / Edge extension that exports a Confluence page **and all of its child pages** as a single **ZIP** — with folders that mirror the Confluence page tree and one file per page in your chosen format:

- **Markdown (`.md`)** — recommended for translation engines (IBM Transition Engine, LILT, etc.) and modern knowledge tools
- **True Word (`.docx`)** — real Office Open XML, opens cleanly in Word / Google Docs / LibreOffice
- **HTML (`.html`)** — standalone offline pages

Works with any **Confluence Cloud** site (`*.atlassian.net`). Uses your own logged-in session, so **no credentials are stored** and **no data leaves your browser**. Free, no paid Marketplace app, no admin approval required.

> **v1.1.0 note** — the previous Word (`.doc`) output was rejected by IBM Transition Engine ("unsupported type"). This release replaces it with true `.docx` (Office Open XML) and adds Markdown. If you're uploading to a translation engine, **use Markdown** — it produces the cleanest output.

---

## Install (2 minutes)

1. **Download** the ZIP from the [latest release](https://github.com/jyotshnatiwary/Confluence_DocEXPO/releases/latest) and unzip it to a permanent folder (e.g. `C:\Tools\confluence-bulk-exporter`). Don't delete this folder later — the browser loads the extension from it every time.

2. Open **Chrome** (or Edge) and go to:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`

3. Turn on **Developer mode** — toggle in the top-right corner of the page.

4. Click **Load unpacked** → select the folder you unzipped → **Select Folder**.

5. Click the puzzle-piece icon in the browser toolbar → pin **Confluence Bulk Exporter** so its icon is visible.

That's it — no other setup, no scripts to run.

> Not seeing "Developer mode"? If your browser says *"Managed by your organization"* and the toggle is greyed out, your company's IT policy blocks unpacked extensions. Try **Microsoft Edge** instead, or ask IT to allow developer extensions.

---

## Use it

1. Open Confluence and log in as normal.
2. Navigate to the **parent page** you want to export (a whole section or a whole space).
3. Click the extension icon in the toolbar.
4. Choose:
   - **Format** — Markdown (`.md`), Word (`.docx`), or HTML.
   - **Include all child pages** — on by default; recursive export.
   - **Max depth** — `0` = unlimited.
   - **Embed images inline** — tick this for a fully offline copy (larger files, base64-encoded images).
5. Click **Export as ZIP** → choose where to save.

You get a folder structure like:

```
YourSection-export.zip
└── YourSection/
    ├── YourSection.docx
    ├── Overview.docx
    ├── Support Operation/
    │   ├── Support Operation.docx
    │   ├── User Management/
    │   │   ├── Admin Access.docx
    │   │   └── ...
    │   └── Assets/
    │       └── ...
    └── ...
```

(Substitute `.md` or `.html` if that's what you picked.)

---

## Which format for what?

| You want to… | Pick this |
|---|---|
| Upload to **IBM Transition Engine**, LILT, Smartcat, or any translation engine | **Markdown** (`.md`) |
| Edit in **Microsoft Word**, share for review, save as PDF later | **Word** (`.docx`) |
| Read offline in the browser | **HTML** |
| Feed into a static site generator, MkDocs, Docusaurus, Obsidian, Notion import | **Markdown** |

---

## Notes & limits

- **Login required** — if your Confluence session times out mid-export, log back in and retry.
- **Images** — by default `<img>` tags point at Confluence URLs (display fine while you're logged in). Tick *Embed images inline* for offline copies. Not applied to Markdown / DOCX images yet — they still reference Confluence URLs. (Coming in v1.2.)
- **Macros** — Confluence renders 95% of macros to plain HTML in `export_view`. A handful of exotic third-party macros may render as placeholders.
- **Long paths** — deep trees + long page titles can hit Windows' 260-char path limit. Extract to a short base path like `C:\c\` if files get skipped.
- **Confluence Server / Data Center** — this extension targets Confluence Cloud (`*.atlassian.net`). Server / DC support would need a small change to the host permissions.

---

## Privacy

- The extension only calls **your own Confluence instance** and the browser's own download API.
- **Nothing is sent to any third party.** No analytics, no telemetry, no external server.
- Your session cookies stay in your browser — the extension never reads them directly or stores them anywhere.

---

## Uninstall

`chrome://extensions` → find **Confluence Bulk Exporter** → **Remove**. Delete the folder if you like.

---

## License

MIT — free to use, share, modify. See `LICENSE`.

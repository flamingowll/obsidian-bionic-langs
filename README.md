# BioRead (Semibold & Multilingual Edition)

An Obsidian plugin that applies **Semibold (`font-weight: 600`)** Bionic Reading formatting to notes in both **Reading Mode** and **Live Preview** across **all languages (including Persian / فارسی, Arabic, and English)** without altering your custom Bold or Italic theme colors.

## Key Improvements Over Original BioRead
1. **Semibold (`600`) Instead of Bold (`700`)**: Uses `font-weight: 600` (configurable in settings from `500` to `700`) instead of heavy `700` bolding.
2. **Preserves Normal, Bold, and Italic Colors**: Replaces `<b>` tags with `<span class="bionic-reader-prefix">` and enforces `color: inherit !important;` so custom theme colors for Bold (`<b>`/`<strong>`) and Italic (`<i>`/`<em>`) never bleed into normal words, and italic words keep their exact italic color.
3. **Full Persian (فارسی) & Multilingual Unicode Support**:
   - Uses Unicode property escapes (`\p{L}\p{M}`) instead of ASCII-only `\W` regexes.
   - Properly handles Persian **Zero-Width Non-Joiner (`نیم‌فاصله`, `\u200C`)** in compound words like `می‌خواهم`, `می‌شود`, and `کتاب‌هایتان` without breaking letter joining or counting ZWNJ as an extra letter.
   - Keeps Persian diacritics/harakat (`اعراب`, `هٔ`, `تشدید`) attached to their base letters.
4. **Live Preview + Settings Tab + Toggle Command**: Works in both Reading Mode and Live Preview, with a Settings tab to customize weight and behavior.

## Installation
1. Copy `main.js`, `styles.css`, and `manifest.json` into your vault's `.obsidian/plugins/obsidian-bionic-reader/` (or `.obsidian/plugins/bioread/`) folder, **or** extract `obsidian-bionic-reader.zip` directly into `.obsidian/plugins/`.
2. Reload Obsidian and enable **BioRead (Semibold & Multilingual)** in **Settings → Community Plugins**.

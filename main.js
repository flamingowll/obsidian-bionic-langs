const obsidian = require('obsidian');

const DEFAULT_SETTINGS = {
    enabled: true,
    fontWeight: '600',
    enableLivePreview: true,
    skipBoldElements: true,
    fixationRatio: 0.4
};

// Matches words in any Unicode script (Persian, Arabic, Latin, Cyrillic, etc.)
// including internal ZWNJ (\u200C), ZWJ (\u200D), and apostrophes.
const WORD_REGEX = /[\p{L}\p{M}]+(?:[\u200C\u200D'\u2019][\p{L}\p{M}]+)*/gu;

// Matches a single base letter (\p{L}) together with its combining marks/harakat (\p{M}*)
// and any trailing ZWNJ/ZWJ (\u200C/\u200D) so Persian نیم‌فاصله and اعراب are never broken.
const LETTER_CLUSTER_REGEX = /\p{L}\p{M}*[\u200C\u200D]*/gu;

function computeSplitIndex(word, ratio = 0.4) {
    const clusters = Array.from(word.matchAll(LETTER_CLUSTER_REGEX));
    const len = clusters.length;
    if (len === 0) {
        return 0;
    }

    let splitLen = 1;
    if (len <= 3) {
        splitLen = 1;
    } else if (len <= 5) {
        splitLen = 2;
    } else if (len <= 8) {
        splitLen = 3;
    } else {
        splitLen = Math.max(4, Math.floor(len * ratio));
    }

    const targetCluster = clusters[Math.min(splitLen, len) - 1];
    return targetCluster.index + targetCluster[0].length;
}

class BionicReaderPlugin extends obsidian.Plugin {
    async onload() {
        console.log('Loading BioRead Semibold Multilingual plugin');

        await this.loadSettings();
        this.applySettingsStyles();

        // Command Palette toggle
        this.addCommand({
            id: 'toggle-bionic-reader',
            name: 'Toggle Bionic Reader (Semibold)',
            callback: async () => {
                this.settings.enabled = !this.settings.enabled;
                await this.saveSettings();
                this.applySettingsStyles();
                this.refreshViews();
            }
        });

        // Settings Tab
        this.addSettingTab(new BionicReaderSettingTab(this.app, this));

        // Hook into Obsidian's Markdown Reading / Preview pipeline
        this.registerMarkdownPostProcessor((el, ctx) => {
            if (!this.settings.enabled) {
                return;
            }
            this.formatElement(el);
        });

        // Hook into Obsidian's Live Preview (CodeMirror 6) if available
        this.setupLivePreviewExtension();
    }

    applySettingsStyles() {
        if (typeof document !== 'undefined' && document.documentElement) {
            document.documentElement.style.setProperty(
                '--bionic-reader-weight',
                String(this.settings.fontWeight || '600')
            );
            if (document.body) {
                document.body.classList.toggle('bionic-reader-disabled', !this.settings.enabled);
            }
        }
    }

    refreshViews() {
        if (!this.app || !this.app.workspace) return;
        this.app.workspace.iterateAllLeaves((leaf) => {
            if (leaf.view && leaf.view.previewMode && typeof leaf.view.previewMode.rerender === 'function') {
                leaf.view.previewMode.rerender(true);
            }
            if (leaf.view && leaf.view.editor && leaf.view.editor.cm) {
                leaf.view.editor.cm.dispatch({});
            }
        });
    }

    formatElement(element) {
        if (!element || !element.tagName) {
            return;
        }

        // Skip tags that should never be formatted
        const ignoredTags = [
            'SCRIPT', 'STYLE', 'PRE', 'CODE', 'INPUT', 'TEXTAREA',
            'SVG', 'MATH', 'MJX-CONTAINER', 'KBD', 'SAMP', 'VAR'
        ];
        if (this.settings.skipBoldElements) {
            ignoredTags.push('B', 'STRONG');
        }

        if (ignoredTags.includes(element.tagName.toUpperCase())) {
            return;
        }

        // Skip math, code, frontmatter, and already formatted containers
        if (
            element.classList &&
            (
                element.classList.contains('bionic-reader-text') ||
                element.classList.contains('bionic-reader-prefix') ||
                element.classList.contains('math') ||
                element.classList.contains('math-block') ||
                element.classList.contains('math-inline') ||
                element.classList.contains('frontmatter') ||
                element.classList.contains('cm-inline-code')
            )
        ) {
            return;
        }

        if (typeof element.closest === 'function' && element.closest('.bionic-reader-text')) {
            return;
        }

        const nodes = Array.from(element.childNodes);
        for (let node of nodes) {
            if (node.nodeType === 3) { // Text Node
                const text = node.nodeValue;
                if (!text || !text.trim()) {
                    continue;
                }

                // Transform text node into formatted DOM nodes
                const span = this.transformTextNode(text);
                if (span && node.parentNode) {
                    node.parentNode.replaceChild(span, node);
                }
            } else if (node.nodeType === 1) { // Element Node
                this.formatElement(node);
            }
        }
    }

    transformTextNode(text) {
        WORD_REGEX.lastIndex = 0;
        const matches = Array.from(text.matchAll(WORD_REGEX));
        if (matches.length === 0) {
            return null;
        }

        const span = document.createElement('span');
        span.className = 'bionic-reader-text';
        let lastIndex = 0;

        for (const match of matches) {
            const word = match[0];
            const startIndex = match.index;

            // Append any preceding whitespace or punctuation untouched
            if (startIndex > lastIndex) {
                span.appendChild(document.createTextNode(text.slice(lastIndex, startIndex)));
            }

            const splitIndex = computeSplitIndex(word, this.settings.fixationRatio);
            if (splitIndex > 0) {
                // Use <span> instead of <b> so Obsidian's bold/italic custom theme colors are never triggered
                const prefixNode = document.createElement('span');
                prefixNode.className = 'bionic-reader-prefix';
                prefixNode.textContent = word.slice(0, splitIndex);
                span.appendChild(prefixNode);

                const suffixText = word.slice(splitIndex);
                if (suffixText) {
                    span.appendChild(document.createTextNode(suffixText));
                }
            } else {
                span.appendChild(document.createTextNode(word));
            }

            lastIndex = startIndex + word.length;
        }

        // Append any trailing whitespace or punctuation untouched
        if (lastIndex < text.length) {
            span.appendChild(document.createTextNode(text.slice(lastIndex)));
        }

        return span;
    }

    setupLivePreviewExtension() {
        try {
            const cmView = require('@codemirror/view');
            const cmState = require('@codemirror/state');
            const cmLanguage = require('@codemirror/language');

            if (!cmView || !cmState) {
                return;
            }

            const pluginInstance = this;
            const prefixMark = cmView.Decoration.mark({ class: 'cm-bionic-prefix' });

            const bionicViewPlugin = cmView.ViewPlugin.fromClass(
                class {
                    constructor(view) {
                        this.decorations = this.buildDecorations(view);
                    }

                    update(update) {
                        if (
                            update.docChanged ||
                            update.viewportChanged ||
                            update.selectionSet ||
                            update.transactions.length > 0
                        ) {
                            this.decorations = this.buildDecorations(update.view);
                        }
                    }

                    buildDecorations(view) {
                        if (!pluginInstance.settings.enabled || !pluginInstance.settings.enableLivePreview) {
                            return cmView.Decoration.none;
                        }

                        // Only apply in Live Preview mode if editorLivePreviewField exists
                        if (obsidian.editorLivePreviewField) {
                            try {
                                const isLivePreview = view.state.field(obsidian.editorLivePreviewField, false);
                                if (isLivePreview === false) {
                                    return cmView.Decoration.none;
                                }
                            } catch (_) {
                                // Ignore field lookup error
                            }
                        }

                        const builder = new cmState.RangeSetBuilder();
                        const tree = cmLanguage && cmLanguage.syntaxTree ? cmLanguage.syntaxTree(view.state) : null;

                        // Collect excluded ranges from syntax tree (code, math, links, urls, frontmatter, bold)
                        const excludedRanges = [];
                        if (tree) {
                            for (const { from, to } of view.visibleRanges) {
                                tree.iterate({
                                    from,
                                    to,
                                    enter: (node) => {
                                        const name = node.name || '';
                                        const lower = name.toLowerCase();
                                        if (
                                            lower.includes('code') ||
                                            lower.includes('math') ||
                                            lower.includes('frontmatter') ||
                                            lower.includes('yaml') ||
                                            lower.includes('url') ||
                                            lower.includes('link') ||
                                            lower.includes('hashtag') ||
                                            lower.includes('formatting') ||
                                            (pluginInstance.settings.skipBoldElements && lower.includes('strong'))
                                        ) {
                                            excludedRanges.push([node.from, node.to]);
                                        }
                                    }
                                });
                            }
                        }

                        const isExcluded = (start, end) => {
                            for (const [eFrom, eTo] of excludedRanges) {
                                if (start < eTo && end > eFrom) {
                                    return true;
                                }
                            }
                            return false;
                        };

                        for (const { from, to } of view.visibleRanges) {
                            const text = view.state.doc.sliceString(from, to);
                            WORD_REGEX.lastIndex = 0;
                            let match;
                            while ((match = WORD_REGEX.exec(text)) !== null) {
                                const word = match[0];
                                const wordStart = from + match.index;
                                const wordEnd = wordStart + word.length;

                                if (isExcluded(wordStart, wordEnd)) {
                                    continue;
                                }

                                const splitIndex = computeSplitIndex(word, pluginInstance.settings.fixationRatio);
                                if (splitIndex > 0) {
                                    builder.add(wordStart, wordStart + splitIndex, prefixMark);
                                }
                            }
                        }

                        return builder.finish();
                    }
                },
                {
                    decorations: (v) => v.decorations
                }
            );

            this.registerEditorExtension(bionicViewPlugin);
        } catch (err) {
            // If CodeMirror packages are unavailable, Reading mode still works seamlessly
            console.log('BioRead: Live Preview extension skipped:', err);
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    onunload() {
        if (typeof document !== 'undefined' && document.body) {
            document.body.classList.remove('bionic-reader-disabled');
        }
        console.log('Unloading BioRead Semibold Multilingual plugin');
    }
}

class BionicReaderSettingTab extends obsidian.PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'BioRead (Semibold & Multilingual) Settings' });

        new obsidian.Setting(containerEl)
            .setName('Enable Bionic Reading / فعال‌سازی پلاگین')
            .setDesc('Apply semibold formatting to the initial letters of words without changing their color.')
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.enabled)
                    .onChange(async (value) => {
                        this.plugin.settings.enabled = value;
                        await this.plugin.saveSettings();
                        this.plugin.applySettingsStyles();
                        this.plugin.refreshViews();
                    })
            );

        new obsidian.Setting(containerEl)
            .setName('Prefix Font Weight / وزن فونت حروف اول')
            .setDesc('Default is 600 (SemiBold). Does not alter bold or italic colors.')
            .addDropdown((dropdown) =>
                dropdown
                    .addOption('500', '500 — Medium')
                    .addOption('600', '600 — SemiBold (Default / پیش‌فرض)')
                    .addOption('650', '650 — DemiBold')
                    .addOption('700', '700 — Bold')
                    .setValue(String(this.plugin.settings.fontWeight || '600'))
                    .onChange(async (value) => {
                        this.plugin.settings.fontWeight = value;
                        await this.plugin.saveSettings();
                        this.plugin.applySettingsStyles();
                    })
            );

        new obsidian.Setting(containerEl)
            .setName('Enable in Live Preview / فعال در حالت ویرایش زنده')
            .setDesc('Also apply semibold word prefixes in Live Preview editor mode (in addition to Reading mode).')
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.enableLivePreview)
                    .onChange(async (value) => {
                        this.plugin.settings.enableLivePreview = value;
                        await this.plugin.saveSettings();
                        this.plugin.refreshViews();
                    })
            );

        new obsidian.Setting(containerEl)
            .setName('Skip Already-Bold Words / نادیده گرفتن متن‌های بولد')
            .setDesc('Do not downgrade words that are already explicitly bolded (**bold**) to semibold.')
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.skipBoldElements)
                    .onChange(async (value) => {
                        this.plugin.settings.skipBoldElements = value;
                        await this.plugin.saveSettings();
                        this.plugin.refreshViews();
                    })
            );
    }
}

module.exports = BionicReaderPlugin;

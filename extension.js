// extension.js - GNOME Shell Lyrics Extension (Debounced & Stable)
const { GObject, St, Clutter, Gio, GLib } = imports.gi;

// Force Soup 2.4
imports.gi.versions.Soup = '2.4';
const Soup = imports.gi.Soup;

const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const ExtensionUtils = imports.misc.extensionUtils;
const Util = imports.misc.util;

const LyricsIndicator = GObject.registerClass(
class LyricsIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'Lyrics Indicator');

        this._settings = ExtensionUtils.getSettings('org.gnome.shell.extensions.lyrics');

        this._label = new St.Label({
            text: '♪ Ready',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'lyrics-label'
        });
        this.add_child(this._label);

        // --- State Variables ---
        this._currentLyrics = []; 
        this._lyricActors = [];
        this._currentSong = null;     
        this._currentPlayer = null;
        this._activeLineIndex = -1;

        // Timers & IDs
        this._updateInterval = null; 
        this._rainbowInterval = null;
        this._debounceTimeout = null; // CRITICAL: Prevents double-fetching
        this._fetchId = 0;
        this._hue = 0;
        
        this._session = new Soup.Session();

        // --- UI Setup ---
        this._createTabs();
        this._createHeader();
        this._createScrollArea();
        this._createFooter();
        this._createArtistSection();

        // --- Watchers ---
        this._settings.connect('changed::color-animation', () => this._checkRainbowMode());
        this._settings.connect('changed::animation-speed', () => this._checkRainbowMode());
        this._settings.connect('changed::font', () => this._updateFont());
        
        this._updateFont();
        this._checkRainbowMode();
        this._startMonitoring();
    }

    _createTabs() {
        this._tabBox = new St.BoxLayout({ style_class: 'lyrics-tabs', x_expand: true });
        this._lyricsTab = new St.Button({ label: 'Lyrics', style_class: 'lyrics-tab-button active', x_expand: true, can_focus: true });
        this._artistTab = new St.Button({ label: 'Artist', style_class: 'lyrics-tab-button', x_expand: true, can_focus: true });
        
        this._lyricsTab.connect('clicked', () => this._switchTab('lyrics'));
        this._artistTab.connect('clicked', () => this._switchTab('artist'));
        
        this._tabBox.add_child(this._lyricsTab);
        this._tabBox.add_child(this._artistTab);
        
        const tabItem = new PopupMenu.PopupBaseMenuItem({ reactive: true, can_focus: false, style_class: 'lyrics-tab-container' });
        tabItem.actor.add_child(this._tabBox);
        this.menu.addMenuItem(tabItem);
    }

    _createHeader() {
        this._headerBox = new St.BoxLayout({ vertical: true, style_class: 'lyrics-header-box', x_expand: true });
        this._titleLabel = new St.Label({ text: 'No Song Playing', style_class: 'lyrics-title' });
        this._artistLabel = new St.Label({ text: '...', style_class: 'lyrics-artist' });
        this._headerBox.add_child(this._titleLabel);
        this._headerBox.add_child(this._artistLabel);
        
        const headerItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
        headerItem.actor.add_child(this._headerBox);
        this.menu.addMenuItem(headerItem);
    }

    _createScrollArea() {
        this._scrollView = new St.ScrollView({
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            style_class: 'lyrics-scrollview',
            overlay_scrollbars: true
        });

        this._lyricsBox = new St.BoxLayout({ vertical: true, style_class: 'lyrics-content-box', x_expand: true });
        this._scrollView.add_actor(this._lyricsBox);

        this._scrollMenuItem = new PopupMenu.PopupBaseMenuItem({ reactive: true, can_focus: false });
        this._scrollMenuItem.actor.add_child(this._scrollView);
        this.menu.addMenuItem(this._scrollMenuItem);
    }

    _createFooter() {
        const footerBox = new St.BoxLayout({ style_class: 'lyrics-footer-box', x_expand: true });

        const makeBtn = (label, icon, callback) => {
            const btn = new St.Button({ 
                label: ` ${icon} ${label} `, style_class: 'lyrics-footer-button',
                can_focus: true, x_expand: true, x_align: Clutter.ActorAlign.CENTER
            });
            btn.connect('clicked', () => callback());
            return btn;
        };

        const btnRefresh = makeBtn('Refresh', '↻', () => { if (this._currentSong) this._forceFetch(); });
        const btnSearch = makeBtn('Search', '🔍', () => { this.menu.close(); this._showSearchDialog(); });
        const btnClear = makeBtn('Clear', '🗑', () => {
            this._resetState();
            this._label.set_text('♪ Cleared');
            this._showStatusMessage('Lyrics cleared manually.');
        });

        footerBox.add_child(btnRefresh);
        footerBox.add_child(btnClear);
        footerBox.add_child(btnSearch);

        const footerItem = new PopupMenu.PopupBaseMenuItem({ reactive: true, can_focus: false });
        footerItem.actor.add_child(footerBox);
        this.menu.addMenuItem(footerItem);
    }

    _createArtistSection() {
        this._artistSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._artistSection);
        this._artistSection.actor.hide();
    }

    // --- State Management ---

    _resetState() {
        this._currentLyrics = [];
        this._lyricActors = [];
        this._activeLineIndex = -1; 
        this._lyricsBox.destroy_all_children();
    }

    _switchTab(tabName) {
        if (tabName === 'lyrics') {
            this._scrollMenuItem.actor.show();
            this._artistSection.actor.hide();
            this._lyricsTab.add_style_class_name('active');
            this._artistTab.remove_style_class_name('active');
        } else {
            this._scrollMenuItem.actor.hide();
            this._artistSection.actor.show();
            this._artistTab.add_style_class_name('active');
            this._lyricsTab.remove_style_class_name('active');
            this._fetchArtistInfo();
        }
    }

    _updateHeader(title, artist) {
        this._titleLabel.set_text(title || 'Unknown Title');
        this._artistLabel.set_text(artist || 'Unknown Artist');
    }

    _showStatusMessage(msg, isError = false) {
        this._resetState();
        const lbl = new St.Label({ 
            text: msg, 
            style_class: isError ? 'lyrics-status-msg lyrics-error-msg' : 'lyrics-status-msg', 
            x_align: Clutter.ActorAlign.CENTER, x_expand: true
        });
        this._lyricsBox.add_child(lbl);
    }

    // --- Monitoring & Player Connection ---

    _startMonitoring() {
        this._dbusConnection = Gio.DBus.session;
        this._updateInterval = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            this._updateCurrentLine();
            return GLib.SOURCE_CONTINUE;
        });
        this._findMusicPlayer();
    }

    _findMusicPlayer() {
        this._dbusConnection.call(
            'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'ListNames',
            null, null, Gio.DBusCallFlags.NONE, -1, null,
            (c, result) => {
                try {
                    const names = c.call_finish(result).get_child_value(0).deep_unpack();
                    const pref = this._settings.get_string('mpris-player');
                    let target = null;
                    if (pref && names.includes(`org.mpris.MediaPlayer2.${pref}`)) {
                        target = `org.mpris.MediaPlayer2.${pref}`;
                    } else {
                        target = names.find(n => n.startsWith('org.mpris.MediaPlayer2.') && !n.includes('browser'));
                        if (!target) target = names.find(n => n.startsWith('org.mpris.MediaPlayer2.'));
                    }
                    if (target) this._connectToPlayer(target);
                } catch (e) {}
            }
        );
    }

    _connectToPlayer(busName) {
        if (this._currentPlayer === busName) return;
        this._currentPlayer = busName;
        this._dbusConnection.signal_subscribe(
            busName, 'org.freedesktop.DBus.Properties', 'PropertiesChanged', '/org/mpris/MediaPlayer2',
            null, Gio.DBusSignalFlags.NONE,
            (c, s, p, i, sig, params) => this._onPlayerPropertiesChanged(params)
        );
        this._getCurrentSong();
    }

    _onPlayerPropertiesChanged(params) {
        const changed = params.get_child_value(1).deep_unpack();
        if ('Metadata' in changed) this._onSongChanged(changed['Metadata']);
    }

    _getCurrentSong() {
        if (!this._currentPlayer) return;
        this._dbusConnection.call(
            this._currentPlayer, '/org/mpris/MediaPlayer2', 'org.freedesktop.DBus.Properties', 'Get',
            new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2.Player', 'Metadata']),
            null, Gio.DBusCallFlags.NONE, -1, null,
            (c, res) => {
                try {
                    const val = c.call_finish(res).get_child_value(0).get_variant();
                    this._onSongChanged(val.deep_unpack());
                } catch (e) {}
            }
        );
    }

    // --- LOGIC FIX: Debouncing ---

    _onSongChanged(data) {
        try {
            let artist = data['xesam:artist']?.[0] || 'Unknown';
            let title = data['xesam:title'] || 'Unknown';
            let album = data['xesam:album'] || '';

            // 1. Normalize strings
            artist = artist.trim();
            title = title.trim();

            // 2. Strict Comparison: If same song, DO NOT fetch again.
            if (this._currentSong && 
                this._currentSong.title === title && 
                this._currentSong.artist === artist) {
                return;
            }

            // 3. New Song Detected
            this._currentSong = { artist, title, album };
            this._updateHeader(title, artist);

            // 4. DEBOUNCE: Wait 750ms before fetching. 
            // If another signal comes (e.g., album art updated), this resets.
            if (this._debounceTimeout) {
                GLib.source_remove(this._debounceTimeout);
            }

            this._debounceTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 750, () => {
                this._executeFetch();
                this._debounceTimeout = null;
                return GLib.SOURCE_REMOVE;
            });

        } catch (e) { logError(e); }
    }

    _forceFetch() {
        if (!this._currentSong) return;
        if (this._debounceTimeout) GLib.source_remove(this._debounceTimeout);
        this._executeFetch();
    }

    _executeFetch() {
        // Increment ID to invalidate any previous network requests still flying
        this._fetchId++;
        const currentRequestId = this._fetchId;

        const { artist, title, album } = this._currentSong;

        // UI Feedback
        this._resetState();
        this._label.set_text('♪ Fetching...');
        this._showStatusMessage('⏳ Fetching lyrics...');

        // 1. Try Local File First
        if (this._loadLyricsFromFile(artist, title)) {
            return;
        }

        // 2. Network Request
        const url = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}&album_name=${encodeURIComponent(album)}`;
        
        const msg = Soup.Message.new('GET', url);
        msg.request_headers.append('User-Agent', 'GNOME-Lyrics-Extension/1.0');

        this._session.queue_message(msg, (sess, res) => {
            // CRITICAL: If fetch ID changed (new song started), ignore this result
            if (this._fetchId !== currentRequestId) return;

            if (res.status_code === 200 && res.response_body.data) {
                const json = res.response_body.data.toString();
                this._saveLyricsToFile(artist, title, json);
                this._parseLyrics(json);
            } else {
                this._showNoLyricsFound();
            }
        });
    }

    // --- File Handling ---

    _saveLyricsToFile(artist, title, json) {
        try {
            const homeDir = GLib.get_home_dir();
            const lyricsDir = GLib.build_filenamev([homeDir, '.lyrics']);
            const dir = Gio.File.new_for_path(lyricsDir);
            
            if (!dir.query_exists(null)) dir.make_directory_with_parents(null);

            const safeFilename = `${artist} - ${title}.lrc`.replace(/[<>:"/\\|?*]/g, '_');
            const filepath = GLib.build_filenamev([lyricsDir, safeFilename]);
            const file = Gio.File.new_for_path(filepath);

            file.replace_contents_async(json, null, false, Gio.FileCreateFlags.NONE, null, null);
        } catch(e) {}
    }

    _loadLyricsFromFile(artist, title) {
        try {
            const homeDir = GLib.get_home_dir();
            const safeFilename = `${artist} - ${title}.lrc`.replace(/[<>:"/\\|?*]/g, '_');
            const filepath = GLib.build_filenamev([homeDir, '.lyrics', safeFilename]);
            const file = Gio.File.new_for_path(filepath);

            if (file.query_exists(null)) {
                const [success, contents] = file.load_contents(null);
                if (success) {
                    this._parseLyrics(contents.toString());
                    return true;
                }
            }
        } catch(e) { }
        return false;
    }

    // --- Parsing & Display ---

    _parseLyrics(json) {
        try {
            const data = JSON.parse(json);
            const text = data.syncedLyrics || data.plainLyrics;

            if (!text) { this._showNoLyricsFound(); return; }

            this._resetState();
            this._currentLyrics = [];
            const lines = text.split('\n');
            const timeRegex = /\[(\d+):(\d+)(?:\.(\d+))?\](.*)/;

            for (const line of lines) {
                const match = line.match(timeRegex);
                if (match) {
                    const min = parseInt(match[1]);
                    const sec = parseInt(match[2]);
                    const ms = match[3] ? parseInt(match[3].padEnd(3, '0').substring(0,3)) : 0;
                    this._currentLyrics.push({
                        time: (min * 60 + sec) * 1000 + ms,
                        text: match[4].trim()
                    });
                }
            }
            this._currentLyrics.sort((a, b) => a.time - b.time);
            
            if (this._currentLyrics.length > 0) {
                this._label.set_text('♪ Ready');
                this._populateLyricsList();
            } else {
                this._showNoLyricsFound();
            }
        } catch (e) { this._showNoLyricsFound(); }
    }

    _populateLyricsList() {
        this._lyricActors = [];
        for (const line of this._currentLyrics) {
            const lbl = new St.Label({ 
                text: line.text, style_class: 'lyrics-line', x_align: Clutter.ActorAlign.CENTER, x_expand: true
            });
            lbl._time = line.time;
            this._lyricsBox.add_child(lbl);
            this._lyricActors.push(lbl);
        }
    }

    _showNoLyricsFound() {
        this._resetState(); 
        this._label.set_text('♪ No Lyrics');
        this._showStatusMessage('❌ No lyrics found.', true);
    }

    _updateCurrentLine() {
        if (!this._currentPlayer || !this._currentLyrics.length) return;
        this._dbusConnection.call(
            this._currentPlayer, '/org/mpris/MediaPlayer2', 'org.freedesktop.DBus.Properties', 'Get',
            new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2.Player', 'Position']),
            null, Gio.DBusCallFlags.NONE, -1, null,
            (c, res) => {
                try {
                    const pos = c.call_finish(res).get_child_value(0).get_variant().get_int64() / 1000;
                    this._syncUI(pos);
                } catch (e) {}
            }
        );
    }

    _syncUI(positionMs) {
        if (this._currentLyrics.length === 0) return;
        
        let newIndex = -1;
        for (let i = 0; i < this._currentLyrics.length; i++) {
            if (this._currentLyrics[i].time <= positionMs) newIndex = i;
            else break;
        }

        if (newIndex !== -1 && newIndex !== this._activeLineIndex) {
            this._activeLineIndex = newIndex;

            const activeLine = this._currentLyrics[newIndex];
            const maxLen = this._settings.get_int('max-line-length') || 50;
            let txt = activeLine.text;
            if (txt.length > maxLen) txt = txt.substring(0, maxLen) + '...';
            this._label.set_text(`♪ ${txt}`);

            if (this._lyricActors[newIndex]) {
                const activeActor = this._lyricActors[newIndex];
                
                this._lyricActors.forEach(a => a.remove_style_class_name('lyrics-line-active'));
                activeActor.add_style_class_name('lyrics-line-active');
                
                // Safe scroll
                GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    if (this._scrollView && activeActor && activeActor.get_parent()) {
                        Util.ensureActorVisibleInScrollView(this._scrollView, activeActor);
                    }
                    return GLib.SOURCE_REMOVE;
                });
            }
        }
    }

    _showSearchDialog() {
        const artist = this._currentSong ? this._currentSong.artist : '';
        const title = this._currentSong ? this._currentSong.title : '';
        const cmd = ['zenity', '--forms', '--title=Search Lyrics', '--text=Details', '--add-entry=Artist', '--add-entry=Title', `--entry-text=${artist}|${title}`, '--separator=|||'];
        
        try {
            let proc = Gio.Subprocess.new(cmd, Gio.SubprocessFlags.STDOUT_PIPE);
            proc.communicate_utf8_async(null, null, (proc, res) => {
                try {
                    const [, out] = proc.communicate_utf8_finish(res);
                    if (out) {
                        const [newA, newT] = out.trim().split('|||');
                        if (newA && newT) {
                            this._currentSong = { artist: newA, title: newT, album: '' };
                            this._updateHeader(newT, newA);
                            this._forceFetch(); // Force logic
                        }
                    }
                } catch (e) {}
            });
        } catch (e) {}
    }

    _fetchArtistInfo() {
        if (!this._currentSong) return;
        this._artistSection.removeAll();
        this._artistSection.addMenuItem(new PopupMenu.PopupMenuItem('Fetching info...', {reactive:false}));
        
        const url = `https://musicbrainz.org/ws/2/artist/?query=artist:${encodeURIComponent(this._currentSong.artist)}&fmt=json&limit=1`;
        const msg = Soup.Message.new('GET', url);
        msg.request_headers.append('User-Agent', 'GNOME-Lyrics-Extension/1.0 ( mailto:user@localhost )');

        this._session.queue_message(msg, (sess, res) => {
            this._artistSection.removeAll();
            if (res.status_code === 200) {
                try {
                    const data = JSON.parse(res.response_body.data);
                    if (data.artists?.[0]) {
                        const artist = data.artists[0];
                        const name = new PopupMenu.PopupMenuItem(artist.name, {reactive:false});
                        name.label.style = 'font-weight:bold; font-size:13pt';
                        this._artistSection.addMenuItem(name);
                        
                        if (artist.type || artist.country) {
                            const details = [artist.type, artist.country].filter(x=>x).join(' • ');
                            this._artistSection.addMenuItem(new PopupMenu.PopupMenuItem(details, {reactive:false}));
                        }
                        if (artist.tags) {
                            const tags = artist.tags.slice(0,3).map(t => t.name).join(', ');
                            this._artistSection.addMenuItem(new PopupMenu.PopupMenuItem('Tags: ' + tags, {reactive:false}));
                        }
                    } else {
                        this._artistSection.addMenuItem(new PopupMenu.PopupMenuItem('Artist not found', {reactive:false}));
                    }
                } catch(e) {}
            } else {
                 this._artistSection.addMenuItem(new PopupMenu.PopupMenuItem(`Error ${res.status_code}`, {reactive:false}));
            }
        });
    }

    _updateFont() {
        const font = this._settings.get_string('font');
        if (!this._rainbowInterval) this._label.style = `font: ${font};`;
    }

    _checkRainbowMode() {
        const isEnabled = this._settings.get_boolean('color-animation');
        if (this._rainbowInterval) {
            GLib.source_remove(this._rainbowInterval);
            this._rainbowInterval = null;
        }

        if (isEnabled) {
            const speed = this._settings.get_double('animation-speed') || 1.0;
            const interval = Math.max(20, Math.floor(100 / speed));
            this._rainbowInterval = GLib.timeout_add(GLib.PRIORITY_DEFAULT, interval, () => {
                this._hue = (this._hue + 5) % 360;
                const font = this._settings.get_string('font');
                this._label.style = `font: ${font}; color: hsl(${this._hue}, 100%, 70%);`;
                return GLib.SOURCE_CONTINUE;
            });
        } else {
            this._updateFont();
        }
    }

    destroy() {
        if (this._updateInterval) GLib.source_remove(this._updateInterval);
        if (this._debounceTimeout) GLib.source_remove(this._debounceTimeout);
        if (this._rainbowInterval) GLib.source_remove(this._rainbowInterval);
        super.destroy();
    }
});

class Extension {
    enable() {
        this._indicator = new LyricsIndicator();
        Main.panel.addToStatusArea('lyrics-indicator', this._indicator);
    }
    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}

function init() {
    return new Extension();
}

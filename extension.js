// extension.js - GNOME Shell Lyrics Extension
const { GObject, St, Clutter, Gio, Soup, GLib } = imports.gi;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const ExtensionUtils = imports.misc.extensionUtils;

const LyricsIndicator = GObject.registerClass(
class LyricsIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'Lyrics Indicator');

        // 1. Load Settings
        this._settings = ExtensionUtils.getSettings('org.gnome.shell.extensions.lyrics');

        // 2. Top Bar Label
        this._label = new St.Label({
            text: '♪ Ready',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'lyrics-label'
        });
        this.add_child(this._label);

        // 3. State Variables
        this._currentLyrics = []; // Holds the time/text data
        this._lyricMenuItems = []; // Holds the menu item objects
        this._currentSong = null;
        this._currentPlayer = null;
        this._updateInterval = null; 
        this._rainbowInterval = null;
        this._hue = 0;

        this._session = new Soup.Session();

        // 4. Build Menu
        this._createTabs();
        
        // Refresh Button
        this._refreshButton = new PopupMenu.PopupMenuItem('↻ Refresh Current Song');
        this._refreshButton.connect('activate', () => {
            if (this._currentSong) this._retryFetch();
        });
        this.menu.addMenuItem(this._refreshButton);

        // Manual Search Button
        this._searchButton = new PopupMenu.PopupMenuItem('🔍 Search Lyrics Manually');
        this._searchButton.connect('activate', () => this._showSearchDialog());
        this.menu.addMenuItem(this._searchButton);

        // 5. Watch Settings
        this._settings.connect('changed::color-animation', () => this._checkRainbowMode());
        this._settings.connect('changed::animation-speed', () => this._checkRainbowMode());
        this._settings.connect('changed::font', () => this._updateFont());
        this._updateFont();
        this._checkRainbowMode();

        // 6. Start Loop
        this._startMonitoring();
    }

    _createTabs() {
        this._tabBox = new St.BoxLayout({ style_class: 'lyrics-tabs', x_expand: true });
        
        this._lyricsTab = new St.Button({ 
            label: 'Lyrics', style_class: 'lyrics-tab-button active', x_expand: true, can_focus: true 
        });
        this._artistTab = new St.Button({ 
            label: 'Artist', style_class: 'lyrics-tab-button', x_expand: true, can_focus: true 
        });
        
        this._lyricsTab.connect('clicked', () => this._switchTab('lyrics'));
        this._artistTab.connect('clicked', () => this._switchTab('artist'));
        
        this._tabBox.add_child(this._lyricsTab);
        this._tabBox.add_child(this._artistTab);
        
        const tabItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, style_class: 'lyrics-tab-container' });
        tabItem.actor.add_child(this._tabBox);
        this.menu.addMenuItem(tabItem);
        
        this._lyricsSection = new PopupMenu.PopupMenuSection();
        this._artistSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._lyricsSection);
        this.menu.addMenuItem(this._artistSection);
        this._artistSection.actor.hide();
    }

    _switchTab(tabName) {
        if (tabName === 'lyrics') {
            this._lyricsSection.actor.show();
            this._artistSection.actor.hide();
            this._lyricsTab.add_style_class_name('active');
            this._artistTab.remove_style_class_name('active');
        } else {
            this._lyricsSection.actor.hide();
            this._artistSection.actor.show();
            this._artistTab.add_style_class_name('active');
            this._lyricsTab.remove_style_class_name('active');
            this._fetchArtistInfo();
        }
    }

    _retryFetch() {
        if (!this._currentSong) return;
        this._showSearchingIndicator();
        this._fetchLyrics(this._currentSong.artist, this._currentSong.title, this._currentSong.album);
    }

    // --- MAIN LOGIC ---

    _startMonitoring() {
        this._dbusConnection = Gio.DBus.session;
        // Run check every 500ms
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
                    // Simple auto-detection
                    const player = names.find(n => n.startsWith('org.mpris.MediaPlayer2.') && !n.includes('browser'));
                    if (player) this._connectToPlayer(player);
                } catch (e) { log(e); }
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

    _onSongChanged(data) {
        const artist = data['xesam:artist']?.[0] || 'Unknown';
        const title = data['xesam:title'] || 'Unknown';
        const album = data['xesam:album'] || '';

        // If it's the exact same song, do nothing
        if (this._currentSong && this._currentSong.title === title && this._currentSong.artist === artist) return;

        // CRITICAL: Clear old data immediately
        this._currentLyrics = []; 
        this._lyricMenuItems = [];
        this._currentSong = { artist, title, album };

        this._showSearchingIndicator();
        this._fetchLyrics(artist, title, album);
    }

    _showSearchingIndicator() {
        this._label.set_text('♪ Fetching...');
        
        // Clear menu UI
        this._lyricsSection.removeAll();
        
        // Add Header
        if (this._currentSong) {
            const header = new PopupMenu.PopupMenuItem(`${this._currentSong.artist} - ${this._currentSong.title}`, { reactive: false });
            header.label.style_class = 'lyrics-title';
            this._lyricsSection.addMenuItem(header);
            this._lyricsSection.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        }

        const item = new PopupMenu.PopupMenuItem('⏳ Fetching lyrics...', { reactive: false });
        this._lyricsSection.addMenuItem(item);
    }

    _fetchLyrics(artist, title, album) {
        // Capture specific song details for the closure
        const targetTitle = title;
        
        const url = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}&album_name=${encodeURIComponent(album)}`;
        
        const msg = Soup.Message.new('GET', url);
        this._session.queue_message(msg, (sess, res) => {
            // CRITICAL: Check if song changed while we were waiting
            if (!this._currentSong || this._currentSong.title !== targetTitle) {
                log('[Lyrics] Ignoring stale response for ' + targetTitle);
                return;
            }

            if (res.status_code === 200 && res.response_body.data) {
                this._parseLyrics(res.response_body.data.toString());
            } else {
                this._showNoLyricsFound();
            }
        });
    }

    _parseLyrics(json) {
        try {
            const data = JSON.parse(json);
            const text = data.syncedLyrics || data.plainLyrics;

            if (!text) {
                this._showNoLyricsFound();
                return;
            }

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
                this._updatePopupMenu();
            } else {
                this._showNoLyricsFound();
            }

        } catch (e) {
            logError(e, '[Lyrics] Parse Error');
            this._showNoLyricsFound();
        }
    }

    _showNoLyricsFound() {
        // CRITICAL: Ensure data is empty so sync loop doesn't run
        this._currentLyrics = [];
        this._lyricMenuItems = [];

        this._label.set_text('♪ No Lyrics');
        this._lyricsSection.removeAll();
        
        // Header
        if (this._currentSong) {
            const header = new PopupMenu.PopupMenuItem(`${this._currentSong.artist} - ${this._currentSong.title}`, { reactive: false });
            header.label.style_class = 'lyrics-title';
            this._lyricsSection.addMenuItem(header);
            this._lyricsSection.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        }

        // Clickable Error Message
        const item = new PopupMenu.PopupMenuItem('❌ No lyrics found. Click to Search.', { reactive: true });
        item.label.style_class = 'lyrics-error-msg';
        item.connect('activate', () => {
            this.menu.close();
            this._showSearchDialog();
        });
        this._lyricsSection.addMenuItem(item);
    }

    _updatePopupMenu() {
        this._lyricsSection.removeAll();
        // Title Header
        const header = new PopupMenu.PopupMenuItem(`${this._currentSong.artist} - ${this._currentSong.title}`, { reactive: false });
        header.label.style_class = 'lyrics-title';
        this._lyricsSection.addMenuItem(header);
        this._lyricsSection.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._lyricMenuItems = [];
        for (const line of this._currentLyrics) {
            const item = new PopupMenu.PopupMenuItem(line.text, { reactive: false });
            item.label.style_class = 'lyrics-content-item';
            item._time = line.time;
            this._lyricsSection.addMenuItem(item);
            this._lyricMenuItems.push(item);
        }
    }

    _updateCurrentLine() {
        // If we have no lyrics, do absolutely nothing
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
        let activeLine = null;
        for (let i = 0; i < this._currentLyrics.length; i++) {
            if (this._currentLyrics[i].time <= positionMs) activeLine = this._currentLyrics[i];
            else break;
        }

        if (activeLine) {
            // Top Bar
            const maxLen = this._settings.get_int('max-line-length') || 50;
            let txt = activeLine.text;
            if (txt.length > maxLen) txt = txt.substring(0, maxLen) + '...';
            this._label.set_text(`♪ ${txt}`);

            // Dropdown Menu Highlight
            if (this._lyricMenuItems) {
                this._lyricMenuItems.forEach(item => {
                    if (item._time === activeLine.time) item.label.style_class = 'lyrics-content-item lyrics-current-line';
                    else item.label.style_class = 'lyrics-content-item';
                });
            }
        }
    }

    // --- UTILITIES ---

    _showSearchDialog() {
        this.menu.close();
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
                            // Ensure clean state before manual search
                            this._currentLyrics = [];
                            this._currentSong = { artist: newA, title: newT, album: '' };
                            this._showSearchingIndicator();
                            this._fetchLyrics(newA, newT, '');
                        }
                    }
                } catch (e) {}
            });
        } catch (e) {}
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

    _fetchArtistInfo() {
        if (!this._currentSong) return;
        this._artistSection.removeAll();
        this._artistSection.addMenuItem(new PopupMenu.PopupMenuItem('Fetching info...', {reactive:false}));
        
        const url = `https://musicbrainz.org/ws/2/artist/?query=${encodeURIComponent(this._currentSong.artist)}&fmt=json&limit=1`;
        const msg = Soup.Message.new('GET', url);
        msg.request_headers.append('User-Agent', 'GNOME-Lyrics-Extension/1.0');

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
                            this._artistSection.addMenuItem(new PopupMenu.PopupMenuItem([artist.type, artist.country].filter(x=>x).join(' • '), {reactive:false}));
                        }
                    } else {
                        this._artistSection.addMenuItem(new PopupMenu.PopupMenuItem('Artist not found', {reactive:false}));
                    }
                } catch(e) {}
            }
        });
    }

    destroy() {
        if (this._updateInterval) GLib.source_remove(this._updateInterval);
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

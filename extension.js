// extension.js - GNOME Shell Lyrics Extension (GNOME 42 compatible)
const { GObject, St, Clutter, Gio, GLib } = imports.gi;

// Force Soup 2.4
imports.gi.versions.Soup = '2.4';
const Soup = imports.gi.Soup;

const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Util = imports.misc.util;

const LyricsIndicator = GObject.registerClass(
class LyricsIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'Lyrics Indicator');
        
        log('[Lyrics] Initializing extension...');

        // Create label for top bar
        this._label = new St.Label({
            text: '♪ Ready',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'lyrics-label'
        });
        this.add_child(this._label);

        // State
        this._currentLyrics = [];
        this._lyricActors = [];
        this._currentSong = null;
        this._currentPlayer = null;
        this._activeLineIndex = -1;
        this._updateInterval = null;
        this._fetchTimeoutId = null;
        this._dbusSignalId = null;
        this._playbackStatus = 'Stopped';
        this._isSynced = false; // Track if we have timestamps

        // HTTP session
        this._session = new Soup.Session();

        // Create UI
        this._createTabs();
        this._createHeader();
        this._createScrollArea();
        this._createFooter();
        this._createArtistSection();

        // Start monitoring after a short delay
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            this._startMonitoring();
            return GLib.SOURCE_REMOVE;
        });
    }

    // --- UI CONSTRUCTION ---

    _createTabs() {
        this._tabBox = new St.BoxLayout({ 
            style_class: 'lyrics-tabs', 
            x_expand: true, 
            style: 'spacing: 0px;' 
        });
        
        this._lyricsTab = new St.Button({ 
            label: 'Lyrics',
            style_class: 'lyrics-tab-button active',
            x_expand: true,
            style: 'padding: 8px 16px;'
        });
        
        this._artistTab = new St.Button({ 
            label: 'Artist Info',
            style_class: 'lyrics-tab-button',
            x_expand: true,
            style: 'padding: 8px 16px;'
        });
        
        this._lyricsTab.connect('clicked', () => this._switchTab('lyrics'));
        this._artistTab.connect('clicked', () => this._switchTab('artist'));
        
        this._tabBox.add_child(this._lyricsTab);
        this._tabBox.add_child(this._artistTab);
        
        const tabItem = new PopupMenu.PopupBaseMenuItem({ 
            reactive: false,
            style_class: 'lyrics-tab-container'
        });
        tabItem.actor.add_child(this._tabBox);
        this.menu.addMenuItem(tabItem);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    }

    _createHeader() {
        this._headerBox = new St.BoxLayout({ 
            vertical: true, 
            style_class: 'lyrics-header-box', 
            x_expand: true 
        });
        
        this._titleLabel = new St.Label({ 
            text: 'No Song Playing', 
            style_class: 'lyrics-title' 
        });
        
        this._artistLabel = new St.Label({ 
            text: '...', 
            style_class: 'lyrics-artist',
            style: 'color: #888; font-size: 10pt;'
        });
        
        this._headerBox.add_child(this._titleLabel);
        this._headerBox.add_child(this._artistLabel);
        
        const headerItem = new PopupMenu.PopupBaseMenuItem({ reactive: false });
        headerItem.actor.add_child(this._headerBox);
        this.menu.addMenuItem(headerItem);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    }

    _createScrollArea() {
        this._scrollView = new St.ScrollView({
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            style: 'max-height: 400px;',
            overlay_scrollbars: true
        });

        this._lyricsBox = new St.BoxLayout({ 
            vertical: true, 
            style: 'padding: 8px;',
            x_expand: true 
        });
        this._scrollView.add_actor(this._lyricsBox);

        this._scrollMenuItem = new PopupMenu.PopupBaseMenuItem({ reactive: false });
        this._scrollMenuItem.actor.add_child(this._scrollView);
        this.menu.addMenuItem(this._scrollMenuItem);
    }

    _createFooter() {
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        
        const footerBox = new St.BoxLayout({ 
            style: 'spacing: 4px; padding: 4px;',
            x_expand: true 
        });

        const makeBtn = (label, icon, callback) => {
            const btn = new St.Button({ 
                label: `${icon} ${label}`,
                style_class: 'lyrics-footer-button',
                style: 'padding: 8px 12px; border-radius: 4px;',
                x_expand: true
            });
            btn.connect('clicked', () => {
                this.menu.close();
                callback();
            });
            return btn;
        };

        const btnRefresh = makeBtn('Refresh', '↻', () => { 
            if (this._currentSong) this._forceFetch(); 
        });
        
        const btnSearch = makeBtn('Search', '🔍', () => { 
            this._showSearchDialog(); 
        });
        
        const btnClear = makeBtn('Clear', '🗑', () => {
            this._resetState();
            this._label.set_text('♪ Cleared');
        });

        footerBox.add_child(btnRefresh);
        footerBox.add_child(btnSearch);
        footerBox.add_child(btnClear);

        const footerItem = new PopupMenu.PopupBaseMenuItem({ reactive: false });
        footerItem.actor.add_child(footerBox);
        this.menu.addMenuItem(footerItem);
    }

    _createArtistSection() {
        this._artistSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._artistSection);
        this._artistSection.actor.hide();
    }

    // --- STATE MANAGEMENT ---

    _resetState() {
        this._currentLyrics = [];
        this._lyricActors = [];
        this._activeLineIndex = -1;
        this._isSynced = false;
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

    _safeString(val) {
        if (val === null || val === undefined) return "";
        if (val.deep_unpack) return this._safeString(val.deep_unpack());
        if (typeof val === 'string') return val;
        if (Array.isArray(val)) return val.length > 0 ? this._safeString(val[0]) : "";
        return String(val);
    }

    // --- PLAYER CONNECTION ---

    _startMonitoring() {
        log('[Lyrics] Starting monitoring...');
        this._dbusConnection = Gio.DBus.session;
        
        if (this._updateInterval) GLib.source_remove(this._updateInterval);
        this._updateInterval = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            this._updateCurrentLine();
            return GLib.SOURCE_CONTINUE;
        });
        
        this._findMusicPlayer();
    }

    _findMusicPlayer() {
        this._dbusConnection.call(
            'org.freedesktop.DBus',
            '/org/freedesktop/DBus',
            'org.freedesktop.DBus',
            'ListNames',
            null,
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (connection, result) => {
                try {
                    const reply = connection.call_finish(result);
                    const names = reply.get_child_value(0).deep_unpack();
                    
                    log('[Lyrics] Scanning for MPRIS players...');
                    
                    let target = null;
                    const excludeBrowsers = ['firefox', 'chrome', 'chromium', 'brave'];
                    
                    // Find first non-browser player
                    for (const name of names) {
                        if (typeof name === 'string' && name.startsWith('org.mpris.MediaPlayer2.')) {
                            const isBrowser = excludeBrowsers.some(b => name.toLowerCase().includes(b));
                            if (!isBrowser) {
                                target = name;
                                break;
                            }
                        }
                    }
                    
                    // Fallback to any player
                    if (!target) {
                        target = names.find(n => typeof n === 'string' && n.startsWith('org.mpris.MediaPlayer2.'));
                    }
                    
                    if (target) {
                        this._connectToPlayer(target);
                    } else {
                        log('[Lyrics] No MPRIS players found');
                        this._label.set_text('♪ No Player');
                    }
                } catch (e) {
                    logError(e, '[Lyrics] Failed to find player');
                }
            }
        );
    }

    _connectToPlayer(busName) {
        if (this._currentPlayer === busName) return;
        
        if (this._dbusSignalId) {
            this._dbusConnection.signal_unsubscribe(this._dbusSignalId);
            this._dbusSignalId = null;
        }

        this._currentPlayer = busName;
        log(`[Lyrics] Connected to ${busName}`);
        
        this._dbusSignalId = this._dbusConnection.signal_subscribe(
            busName,
            'org.freedesktop.DBus.Properties',
            'PropertiesChanged',
            '/org/mpris/MediaPlayer2',
            null,
            Gio.DBusSignalFlags.NONE,
            (connection, sender, path, iface, signal, params) => {
                this._onPlayerPropertiesChanged(params);
            }
        );
        
        this._refreshPlayerState();
    }

    _onPlayerPropertiesChanged(params) {
        const changedDict = params.get_child_value(1);
        const changed = changedDict.deep_unpack();
        
        if ('PlaybackStatus' in changed) {
            let status = changed['PlaybackStatus'];
            if (status && status.deep_unpack) status = status.deep_unpack();
            
            this._playbackStatus = status;
            log(`[Lyrics] Playback status changed: ${this._playbackStatus}`);
            
            if (this._playbackStatus === 'Stopped') {
                this._resetState();
                this._currentSong = null;
                this._label.set_text('♪ Idle');
                this._updateHeader('No Song Playing', '...');
                return;
            }
        }
        
        if ('Metadata' in changed) {
            let meta = changed['Metadata'];
            if (meta && meta.deep_unpack) meta = meta.deep_unpack();
            this._onSongChanged(meta);
        }
    }

    _refreshPlayerState() {
        if (!this._currentPlayer) return;
        
        this._dbusConnection.call(
            this._currentPlayer,
            '/org/mpris/MediaPlayer2',
            'org.freedesktop.DBus.Properties',
            'GetAll',
            new GLib.Variant('(s)', ['org.mpris.MediaPlayer2.Player']),
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (connection, result) => {
                try {
                    const reply = connection.call_finish(result);
                    const props = reply.get_child_value(0).deep_unpack();
                    
                    if ('PlaybackStatus' in props) {
                        let status = props['PlaybackStatus'];
                        if (status && status.deep_unpack) status = status.deep_unpack();
                        this._playbackStatus = status;
                        log(`[Lyrics] Initial Status: ${this._playbackStatus}`);
                    }
                    
                    if ('Metadata' in props) {
                        let meta = props['Metadata'];
                        if (meta && meta.deep_unpack) meta = meta.deep_unpack();
                        this._onSongChanged(meta);
                    }
                } catch (e) {
                    logError(e, '[Lyrics] Failed to refresh player state');
                }
            }
        );
    }

    _onSongChanged(data) {
        try {
            if (!data || Object.keys(data).length === 0) return;

            let artist = this._safeString(data['xesam:artist']).trim();
            let title = this._safeString(data['xesam:title']).trim();
            let album = this._safeString(data['xesam:album']).trim();

            if (!title || !artist) return;

            if (this._currentSong && 
                this._currentSong.title === title && 
                this._currentSong.artist === artist) {
                return;
            }

            log(`[Lyrics] Song changed: ${artist} - ${title}`);

            this._currentSong = { artist, title, album };
            this._updateHeader(title, artist);
            this._showSearchingIndicator();
            
            if (this._fetchTimeoutId) {
                GLib.source_remove(this._fetchTimeoutId);
            }

            this._fetchTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 750, () => {
                this._executeFetch();
                this._fetchTimeoutId = null;
                return GLib.SOURCE_REMOVE;
            });

        } catch (e) {
            logError(e, '[Lyrics] Error in _onSongChanged');
        }
    }

    _forceFetch() {
        if (!this._currentSong) return;
        this._showSearchingIndicator();
        this._executeFetch();
    }

    _showSearchingIndicator() {
        this._label.set_text('♪ Searching...');
        this._resetState();
        
        const searchingItem = new St.Label({
            text: '🔍 Searching for lyrics...',
            style: 'font-style: italic; color: #4a90d9; text-align: center; padding: 20px;',
            x_align: Clutter.ActorAlign.CENTER,
            x_expand: true
        });
        this._lyricsBox.add_child(searchingItem);
    }

    _executeFetch() {
        if (!this._currentSong) return;

        const { artist, title, album } = this._currentSong;

        if (this._loadLyricsFromFile(artist, title)) {
            log('[Lyrics] Loaded from cache');
            return;
        }

        const url = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}&album_name=${encodeURIComponent(album)}`;
        const message = Soup.Message.new('GET', url);
        message.request_headers.append('User-Agent', 'GNOME-Lyrics-Extension/1.0');

        this._session.queue_message(message, (session, message) => {
            try {
                if (message.status_code === 200 && message.response_body.data) {
                    const json = message.response_body.data.toString();
                    this._saveLyricsToFile(artist, title, json);
                    this._parseLyrics(json);
                } else {
                    log(`[Lyrics] No lyrics found (status ${message.status_code})`);
                    this._showNoLyricsFound();
                }
            } catch (e) {
                logError(e, '[Lyrics] Failed to fetch lyrics');
                this._showNoLyricsFound();
            }
        });
    }

    _saveLyricsToFile(artist, title, json) {
        try {
            const homeDir = GLib.get_home_dir();
            const lyricsDir = GLib.build_filenamev([homeDir, '.lyrics']);
            const dir = Gio.File.new_for_path(lyricsDir);
            
            if (!dir.query_exists(null)) {
                dir.make_directory_with_parents(null);
            }

            const safeFilename = `${artist} - ${title}.lrc`.replace(/[<>:"/\\|?*]/g, '_');
            const filepath = GLib.build_filenamev([lyricsDir, safeFilename]);
            const file = Gio.File.new_for_path(filepath);

            const byteArray = new TextEncoder().encode(json);
            const bytes = new GLib.Bytes(byteArray);

            file.replace_contents_async(
                bytes,
                null,
                false,
                Gio.FileCreateFlags.NONE,
                null,
                (obj, res) => {
                    try {
                        obj.replace_contents_finish(res);
                        log('[Lyrics] Saved to cache: ' + filepath);
                    } catch (e) {
                        logError(e, '[Lyrics] Failed to finish saving lyrics');
                    }
                }
            );
        } catch (e) {
            logError(e, '[Lyrics] Failed to save lyrics');
        }
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
                    const text = new TextDecoder().decode(contents);
                    this._parseLyrics(text);
                    return true;
                }
            }
        } catch (e) {
        }
        return false;
    }

    // --- PARSING & UI (FIXED) ---

    _parseLyrics(json) {
        try {
            const data = JSON.parse(json);
            
            this._resetState();
            this._currentLyrics = [];
            
            // 1. Try Synced Lyrics First
            if (data.syncedLyrics) {
                this._isSynced = true;
                const lines = data.syncedLyrics.split('\n');
                for (const line of lines) {
                    const match = line.match(/\[(\d+):(\d+)(?:\.(\d+))?\](.*)/);
                    if (match) {
                        const minutes = parseInt(match[1]);
                        const seconds = parseInt(match[2]);
                        const ms = match[3] ? parseInt(match[3].padEnd(3, '0').substring(0, 3)) : 0;
                        const lyricText = match[4].trim();
                        
                        if (lyricText) {
                            this._currentLyrics.push({
                                time: (minutes * 60 + seconds) * 1000 + ms,
                                text: lyricText
                            });
                        }
                    }
                }
                this._currentLyrics.sort((a, b) => a.time - b.time);
            }
            
            // 2. Fallback to Plain Lyrics if Synced failed or didn't exist
            if (this._currentLyrics.length === 0 && data.plainLyrics) {
                this._isSynced = false;
                const lines = data.plainLyrics.split('\n');
                for (const line of lines) {
                    const cleanLine = line.trim();
                    if (cleanLine) {
                        this._currentLyrics.push({
                            time: -1, // No time
                            text: cleanLine
                        });
                    }
                }
            }

            if (this._currentLyrics.length > 0) {
                this._label.set_text('♪ Ready');
                // Use idle_add to ensure UI updates on the main thread
                GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    this._populateLyricsList();
                    return GLib.SOURCE_REMOVE;
                });
            } else {
                this._showNoLyricsFound();
            }

        } catch (e) {
            logError(e, '[Lyrics] Failed to parse lyrics');
            this._showNoLyricsFound();
        }
    }

    _populateLyricsList() {
        this._lyricActors = [];
        this._lyricsBox.destroy_all_children();

        // If not synced, show a small indicator
        if (!this._isSynced) {
            const note = new St.Label({
                text: '(Plain Lyrics - No Auto Scroll)',
                style: 'font-size: 8pt; color: #888; text-align: center; padding-bottom: 10px;',
                x_align: Clutter.ActorAlign.CENTER,
                x_expand: true
            });
            this._lyricsBox.add_child(note);
        }

        for (const line of this._currentLyrics) {
            const label = new St.Label({
                text: line.text,
                style: 'padding: 4px 8px; text-align: center;',
                x_align: Clutter.ActorAlign.CENTER,
                x_expand: true
            });
            label._time = line.time;
            this._lyricsBox.add_child(label);
            this._lyricActors.push(label);
        }
    }

    _showNoLyricsFound() {
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._resetState();
            this._label.set_text('♪ No Lyrics');
            
            const errorLabel = new St.Label({
                text: '❌ No lyrics found for this song',
                style: 'font-style: italic; color: #ff6b6b; text-align: center; padding: 20px;',
                x_align: Clutter.ActorAlign.CENTER,
                x_expand: true
            });
            this._lyricsBox.add_child(errorLabel);
            
            const now = new Date();
            const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const timeLabel = new St.Label({
                text: `Searched at ${timeStr}`,
                style: 'font-size: 9pt; color: #666; text-align: center; padding: 8px;',
                x_align: Clutter.ActorAlign.CENTER,
                x_expand: true
            });
            this._lyricsBox.add_child(timeLabel);
            return GLib.SOURCE_REMOVE;
        });
    }

    _updateCurrentLine() {
        // Only attempt to scroll if we have synced lyrics
        if (!this._currentPlayer || this._currentLyrics.length === 0 || 
            this._playbackStatus !== 'Playing' || !this._isSynced) return;

        this._dbusConnection.call(
            this._currentPlayer,
            '/org/mpris/MediaPlayer2',
            'org.freedesktop.DBus.Properties',
            'Get',
            new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2.Player', 'Position']),
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (connection, result) => {
                try {
                    const reply = connection.call_finish(result);
                    const positionUs = reply.get_child_value(0).get_variant().get_int64();
                    const positionMs = positionUs / 1000;
                    this._syncUI(positionMs);
                } catch (e) {
                }
            }
        );
    }

    _syncUI(positionMs) {
        if (this._currentLyrics.length === 0 || !this._isSynced) return;

        let newIndex = -1;
        for (let i = 0; i < this._currentLyrics.length; i++) {
            if (this._currentLyrics[i].time <= positionMs) {
                newIndex = i;
            } else {
                break;
            }
        }

        if (newIndex !== -1 && newIndex !== this._activeLineIndex) {
            this._activeLineIndex = newIndex;

            const activeLine = this._currentLyrics[newIndex];
            const maxLen = 50;
            let txt = activeLine.text;
            if (txt.length > maxLen) {
                txt = txt.substring(0, maxLen) + '...';
            }
            this._label.set_text(`♪ ${txt}`);

            // Highlight active line
            if (this._lyricActors[newIndex]) {
                const activeActor = this._lyricActors[newIndex];
                
                // Remove active class from all
                this._lyricActors.forEach(actor => {
                    actor.style = 'padding: 4px 8px; text-align: center; color: #ccc;';
                });
                
                // Add to current
                activeActor.style = 'padding: 4px 8px; text-align: center; font-weight: bold; color: #4a90d9;';
                
                // Auto-scroll
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
        try {
            const artist = this._currentSong ? this._currentSong.artist : '';
            const title = this._currentSong ? this._currentSong.title : '';
            
            const cmd = [
                'zenity',
                '--forms',
                '--title=Search for Lyrics',
                '--text=Enter song information:',
                '--add-entry=Artist',
                '--add-entry=Title',
                '--add-entry=Album (optional)',
                '--separator=|||'
            ];
            
            let proc = Gio.Subprocess.new(
                cmd,
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
            
            proc.communicate_utf8_async(null, null, (proc, res) => {
                try {
                    let [, stdout] = proc.communicate_utf8_finish(res);
                    
                    if (proc.get_successful() && stdout) {
                        const parts = stdout.trim().split('|||');
                        
                        if (parts.length >= 2 && parts[0] && parts[1]) {
                            const newArtist = parts[0].trim();
                            const newTitle = parts[1].trim();
                            const newAlbum = parts[2] ? parts[2].trim() : '';
                            
                            log(`[Lyrics] Manual search: ${newArtist} - ${newTitle}`);
                            this._currentSong = { 
                                artist: newArtist, 
                                title: newTitle, 
                                album: newAlbum 
                            };
                            this._updateHeader(newTitle, newArtist);
                            this._forceFetch();
                        }
                    }
                } catch (e) {
                    logError(e, '[Lyrics] Error reading search dialog');
                }
            });
            
        } catch (e) {
            logError(e, '[Lyrics] Error showing search dialog');
        }
    }

    _fetchArtistInfo() {
        if (!this._currentSong) return;
        
        this._artistSection.removeAll();
        const loadingItem = new PopupMenu.PopupMenuItem('Loading artist info...', { reactive: false });
        this._artistSection.addMenuItem(loadingItem);

        const url = `https://musicbrainz.org/ws/2/artist/?query=artist:${encodeURIComponent(this._currentSong.artist)}&fmt=json&limit=1`;
        const message = Soup.Message.new('GET', url);
        message.request_headers.append('User-Agent', 'GNOME-Lyrics-Extension/1.0');

        this._session.queue_message(message, (session, message) => {
            this._artistSection.removeAll();
            
            try {
                if (message.status_code === 200 && message.response_body.data) {
                    const data = JSON.parse(message.response_body.data);
                    
                    if (data.artists && data.artists.length > 0) {
                        const artist = data.artists[0];
                        
                        const nameItem = new PopupMenu.PopupMenuItem(artist.name, { reactive: false });
                        nameItem.label.style = 'font-weight: bold; font-size: 13pt;';
                        this._artistSection.addMenuItem(nameItem);
                        
                        if (artist.type || artist.country) {
                            const details = [artist.type, artist.country].filter(x => x).join(' • ');
                            const detailsItem = new PopupMenu.PopupMenuItem(details, { reactive: false });
                            this._artistSection.addMenuItem(detailsItem);
                        }
                        
                        if (artist.tags && artist.tags.length > 0) {
                            const tags = artist.tags.slice(0, 3).map(t => t.name).join(', ');
                            const tagsItem = new PopupMenu.PopupMenuItem('Tags: ' + tags, { reactive: false });
                            this._artistSection.addMenuItem(tagsItem);
                        }
                    } else {
                        const notFoundItem = new PopupMenu.PopupMenuItem('Artist not found', { reactive: false });
                        this._artistSection.addMenuItem(notFoundItem);
                    }
                } else {
                    const errorItem = new PopupMenu.PopupMenuItem('Failed to load artist info', { reactive: false });
                    this._artistSection.addMenuItem(errorItem);
                }
            } catch (e) {
                logError(e, '[Lyrics] Failed to parse artist info');
                const errorItem = new PopupMenu.PopupMenuItem('Error loading artist info', { reactive: false });
                this._artistSection.addMenuItem(errorItem);
            }
        });
    }

    destroy() {
        log('[Lyrics] Destroying extension...');
        
        if (this._updateInterval) {
            GLib.source_remove(this._updateInterval);
            this._updateInterval = null;
        }

        if (this._fetchTimeoutId) {
            GLib.source_remove(this._fetchTimeoutId);
            this._fetchTimeoutId = null;
        }
        
        if (this._dbusSignalId && this._dbusConnection) {
            this._dbusConnection.signal_unsubscribe(this._dbusSignalId);
            this._dbusSignalId = null;
        }

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

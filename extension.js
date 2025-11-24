// extension.js - GNOME Shell Lyrics Extension (GNOME 42 compatible)
const { GObject, St, Clutter, Gio, Soup, GLib } = imports.gi;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const ExtensionUtils = imports.misc.extensionUtils; // <-- ADDED

const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';
const PREFERRED_PLAYER_EXCLUSIONS = ['firefox', 'chrome', 'brave', 'chromium'];

const LyricsIndicator = GObject.registerClass(
class LyricsIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'Lyrics Indicator');

        // Extension Settings
        this._settings = ExtensionUtils.getSettings('org.gnome.shell.extensions.lyrics'); // <-- ADDED
        
        // Create label for top bar
        this._label = new St.Label({
            text: '♪ No lyrics',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'lyrics-label'
        });
        this.add_child(this._label);

        // Create tabs
        this._createTabs();
        
        // Add search button at the bottom
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._searchButton = new PopupMenu.PopupMenuItem('🔍 Search Lyrics Manually');
        this._searchButton.connect('activate', () => {
            this._showSearchDialog();
        });
        this.menu.addMenuItem(this._searchButton);

        // State
        this._currentLyrics = [];
        this._currentSong = null;
        this._currentPlayer = null;
        this._position = 0;
        this._updateInterval = null;
        this._signalId = null; // To store the DBus signal subscription ID

        // HTTP session for API calls
        this._session = new Soup.Session();

        // Start monitoring
        this._startMonitoring();

        // Listen for setting changes (especially mpris-player)
        this._settings.connect('changed::mpris-player', () => this._findAndConnectToPlayer()); // <-- ADDED
        this._settings.connect('changed::font', () => this._updateFont()); // <-- ADDED
        this._updateFont(); // Initial font application
    }

    // New method to apply font setting
    _updateFont() {
        const font = this._settings.get_string('font');
        this._label.style = `font: ${font};`;
    }

    _createTabs() {
        // ... (No change in _createTabs)
        // ... (existing code for _createTabs here)
        // Create tab buttons
        this._tabBox = new St.BoxLayout({ 
            style_class: 'lyrics-tabs',
            x_expand: true,
            style: 'spacing: 0px;'
        });
        
        this._lyricsTab = new St.Button({ 
            label: 'Lyrics',
            style_class: 'lyrics-tab-button active',
            x_expand: true,
            style: 'padding: 8px 16px; border-radius: 4px 0 0 0;'
        });
        this._artistTab = new St.Button({ 
            label: 'Artist Info',
            style_class: 'lyrics-tab-button',
            x_expand: true,
            style: 'padding: 8px 16px; border-radius: 0 4px 0 0;'
        });
        
        this._lyricsTab.connect('clicked', () => this._switchTab('lyrics'));
        this._artistTab.connect('clicked', () => this._switchTab('artist'));
        
        this._tabBox.add_child(this._lyricsTab);
        this._tabBox.add_child(this._artistTab);
        
        // Add tab box to menu
        const tabItem = new PopupMenu.PopupBaseMenuItem({ 
            reactive: false,
            style_class: 'lyrics-tab-container'
        });
        tabItem.actor.add_child(this._tabBox);
        this.menu.addMenuItem(tabItem);
        
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        
        // Create content sections
        this._lyricsSection = new PopupMenu.PopupMenuSection();
        this._artistSection = new PopupMenu.PopupMenuSection();
        
        this.menu.addMenuItem(this._lyricsSection);
        this.menu.addMenuItem(this._artistSection);
        
        // Hide artist section by default
        this._artistSection.actor.hide();
    }

    _switchTab(tabName) {
        // ... (No change in _switchTab)
        // ... (existing code for _switchTab here)
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

    _fetchArtistInfo() {
        // ... (No change in _fetchArtistInfo)
        // ... (existing code for _fetchArtistInfo here)
        if (!this._currentSong) {
            this._showArtistError('No song playing');
            return;
        }

        // Clear previous content
        this._artistSection.removeAll();
        
        const loadingItem = new PopupMenu.PopupMenuItem('Loading artist info...', { reactive: false });
        this._artistSection.addMenuItem(loadingItem);

        // Fetch from MusicBrainz API
        const artist = this._currentSong.artist;
        const url = `https://musicbrainz.org/ws/2/artist/?query=${encodeURIComponent(artist)}&fmt=json&limit=1`;
        
        log(`[Lyrics] Fetching artist info from: ${url}`);
        
        try {
            const message = Soup.Message.new('GET', url);
            message.request_headers.append('User-Agent', 'GNOME-Lyrics-Extension/1.0');

            this._session.queue_message(message, (session, message) => {
                try {
                    this._artistSection.removeAll();
                    
                    if (message.status_code === 200) {
                        const data = message.response_body.data;
                        if (data) {
                            this._parseArtistInfo(data.toString());
                        } else {
                            this._showArtistError('No data received');
                        }
                    } else {
                        this._showArtistError(`Error: ${message.status_code}`);
                    }
                } catch (e) {
                    logError(e, '[Lyrics] Failed to fetch artist info');
                    this._showArtistError('Failed to load artist info');
                }
            });
        } catch (e) {
            logError(e, '[Lyrics] Error creating artist request');
            this._showArtistError('Error loading artist info');
        }
    }

    _parseArtistInfo(jsonResponse) {
        // ... (No change in _parseArtistInfo)
        // ... (existing code for _parseArtistInfo here)
        try {
            const data = JSON.parse(jsonResponse);
            
            if (!data.artists || data.artists.length === 0) {
                this._showArtistError('Artist not found');
                return;
            }

            const artist = data.artists[0];
            
            // Artist name
            const nameItem = new PopupMenu.PopupMenuItem(artist.name, { reactive: false });
            nameItem.label.style = 'font-weight: bold; font-size: 12pt;';
            this._artistSection.addMenuItem(nameItem);
            
            // Type and country
            if (artist.type || artist.country) {
                const info = [];
                if (artist.type) info.push(artist.type);
                if (artist.country) info.push(artist.country);
                const infoItem = new PopupMenu.PopupMenuItem(info.join(' • '), { reactive: false });
                infoItem.label.style = 'color: #888;';
                this._artistSection.addMenuItem(infoItem);
            }
            
            this._artistSection.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            
            // Disambiguation or genre
            if (artist.disambiguation) {
                const disambigItem = new PopupMenu.PopupMenuItem(artist.disambiguation, { reactive: false });
                disambigItem.label.style = 'font-style: italic;';
                this._artistSection.addMenuItem(disambigItem);
            }
            
            // Tags/Genres
            if (artist.tags && artist.tags.length > 0) {
                const tags = artist.tags.slice(0, 5).map(t => t.name).join(', ');
                const tagsItem = new PopupMenu.PopupMenuItem(`Genres: ${tags}`, { reactive: false });
                this._artistSection.addMenuItem(tagsItem);
            }
            
        } catch (e) {
            logError(e, '[Lyrics] Failed to parse artist info');
            this._showArtistError('Failed to parse artist info');
        }
    }

    _showArtistError(message) {
        // ... (No change in _showArtistError)
        // ... (existing code for _showArtistError here)
        this._artistSection.removeAll();
        const errorItem = new PopupMenu.PopupMenuItem(message, { reactive: false });
        errorItem.label.style = 'color: #ff6b6b;';
        this._artistSection.addMenuItem(errorItem);
    }

    _startMonitoring() {
        // Watch for MPRIS players
        this._dbusConnection = Gio.DBus.session;
        
        // Monitor position changes
        this._updateInterval = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            this._updateCurrentLine();
            return GLib.SOURCE_CONTINUE;
        });

        // Find active music player
        this._findAndConnectToPlayer(); // <-- CHANGED
    }

    // NEW LOGIC: Use preference and filter out browser tabs
    _findAndConnectToPlayer() {
        // Disconnect previous player signal if exists
        if (this._signalId) {
            this._dbusConnection.signal_unsubscribe(this._signalId);
            this._signalId = null;
        }
        this._currentPlayer = null;
        this._currentSong = null;
        this._label.set_text('♪ Scanning...');

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
                    const variant = reply.get_child_value(0);
                    const names = variant.deep_unpack();
                    
                    log('[Lyrics] Scanning for MPRIS players...');
                    
                    let potentialPlayers = names.filter(name => 
                        typeof name === 'string' && name.startsWith(MPRIS_PREFIX)
                    );
                    
                    if (potentialPlayers.length === 0) {
                        log('[Lyrics] No MPRIS players found.');
                        this._label.set_text('♪ No player found');
                        return;
                    }
                    
                    let targetPlayer = null;
                    const preferredID = this._settings.get_string('mpris-player'); // Get user preference
                    
                    // 1. Check for user preference
                    if (preferredID) {
                        for (const player of potentialPlayers) {
                            if (player.includes(`.${preferredID}`)) {
                                targetPlayer = player;
                                log(`[Lyrics] Connected to preferred player: ${targetPlayer}`);
                                break;
                            }
                        }
                    }

                    // 2. Auto-select (Skip web browsers)
                    if (!targetPlayer) {
                        for (const player of potentialPlayers) {
                            let isExcluded = PREFERRED_PLAYER_EXCLUSIONS.some(exclusion => player.includes(exclusion));
                            
                            if (!isExcluded) {
                                targetPlayer = player;
                                log(`[Lyrics] Connected to non-excluded player: ${targetPlayer}`);
                                break;
                            }
                        }
                    }
                    
                    // 3. Fallback to the first player found
                    if (!targetPlayer && potentialPlayers.length > 0) {
                        targetPlayer = potentialPlayers[0];
                        log(`[Lyrics] Fallback connection to player: ${targetPlayer}`);
                    }
                    
                    if (targetPlayer) {
                        this._connectToPlayer(targetPlayer);
                    } else {
                        this._label.set_text('♪ No music player found');
                    }
                    
                } catch (e) {
                    logError(e, '[Lyrics] Failed to list DBus names');
                    this._label.set_text('♪ Error');
                }
            }
        );
    }
    
    // RENAMED from _findMusicPlayer to _findAndConnectToPlayer. The old contents are replaced above.
    // The previous _findMusicPlayer is REMOVED.

    _connectToPlayer(busName) {
        log('[Lyrics] Connecting to player: ' + busName);
        this._currentPlayer = busName;
        
        // Watch for property changes (song changes, position updates)
        // Store signal ID to allow unsubscribing later (in _findAndConnectToPlayer)
        this._signalId = this._dbusConnection.signal_subscribe( // <-- SAVED ID
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

        // Get current song
        this._getCurrentSong();
    }
    
    // ... (rest of the class methods remain the same) ...
    _getCurrentSong() {
        if (!this._currentPlayer) return;

        this._dbusConnection.call(
            this._currentPlayer,
            '/org/mpris/MediaPlayer2',
            'org.freedesktop.DBus.Properties',
            'Get',
            new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2.Player', 'Metadata']),
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (connection, result) => {
                try {
                    const reply = connection.call_finish(result);
                    const variant = reply.get_child_value(0).get_variant();
                    this._onSongChanged(variant);
                } catch (e) {
                    logError(e, '[Lyrics] Failed to get current song');
                }
            }
        );
    }

    _onPlayerPropertiesChanged(params) {
        const changed = params.get_child_value(1).deep_unpack();
        
        if ('Metadata' in changed) {
            this._onSongChanged(changed['Metadata']);
        }
    }

    _onSongChanged(metadata) {
        try {
            const data = metadata.deep_unpack();
            
            const artist = data['xesam:artist']?.deep_unpack()?.[0] || 'Unknown';
            const title = data['xesam:title']?.deep_unpack() || 'Unknown';
            const album = data['xesam:album']?.deep_unpack() || '';

            log(`[Lyrics] Song changed: ${artist} - ${title}`);

            const newSong = { artist, title, album };
            
            // Check if song actually changed
            if (this._currentSong && 
                this._currentSong.artist === newSong.artist &&
                this._currentSong.title === newSong.title) {
                return;
            }

            this._currentSong = newSong;
            this._fetchLyrics(artist, title, album);
        } catch (e) {
            logError(e, '[Lyrics] Error in _onSongChanged');
        }
    }

    _fetchLyrics(artist, title, album) {
        const url = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}&album_name=${encodeURIComponent(album)}`;
        
        log(`[Lyrics] Fetching from: ${url}`);
        
        try {
            const message = Soup.Message.new('GET', url);
            message.request_headers.append('User-Agent', 'GNOME-Lyrics-Extension');

            this._session.queue_message(message, (session, message) => {
                try {
                    log(`[Lyrics] Response status: ${message.status_code}`);
                    
                    if (message.status_code === 200) {
                        const data = message.response_body.data;
                        log(`[Lyrics] Response data length: ${data ? data.length : 0}`);
                        if (data) {
                            this._parseLyrics(data.toString());
                        } else {
                            this._label.set_text('♪ No data received');
                        }
                    } else {
                        log(`[Lyrics] No lyrics found (status ${message.status_code})`);
                        this._label.set_text('♪ No lyrics - Click to search');
                        this._currentLyrics = [];
                    }
                } catch (e) {
                    logError(e, '[Lyrics] Failed to process response');
                    this._label.set_text('♪ Error - Click to search');
                }
            });
        } catch (e) {
            logError(e, '[Lyrics] Failed to create request');
            this._label.set_text('♪ Error - Click to search');
        }
    }

    _parseLyrics(jsonResponse) {
        try {
            const data = JSON.parse(jsonResponse);
            const lyricsText = data.syncedLyrics || data.plainLyrics;
            
            if (!lyricsText) {
                this._label.set_text('♪ No lyrics available');
                this._currentLyrics = [];
                return;
            }

            // Save to local file
            this._saveLyricsToFile(lyricsText, data);

            // Parse LRC format
            this._currentLyrics = [];
            const lines = lyricsText.split('\n');
            
            for (let line of lines) {
                const match = line.match(/\[(\d+):(\d+)\.?(\d+)?\](.*)/);
                if (match) {
                    const minutes = parseInt(match[1]);
                    const seconds = parseInt(match[2]);
                    const centiseconds = parseInt(match[3] || '0');
                    const text = match[4].trim();
                    
                    const timeMs = (minutes * 60 + seconds) * 1000 + centiseconds * 10;
                    this._currentLyrics.push({ time: timeMs, text });
                }
            }

            this._currentLyrics.sort((a, b) => a.time - b.time);
            
            if (this._currentLyrics.length > 0) {
                this._label.set_text('♪ Lyrics loaded');
                this._updatePopupMenu();
            }
        } catch (e) {
            logError(e, '[Lyrics] Failed to parse lyrics');
        }
    }

    _saveLyricsToFile(lyricsText, metadata) {
        try {
            // Create lyrics directory
            const homeDir = GLib.get_home_dir();
            const lyricsDir = GLib.build_filenamev([homeDir, '.lyrics']);
            const dir = Gio.File.new_for_path(lyricsDir);
            
            if (!dir.query_exists(null)) {
                dir.make_directory_with_parents(null);
                log('[Lyrics] Created lyrics directory: ' + lyricsDir);
            }

            // Create filename from song metadata
            if (this._currentSong) {
                const safeFilename = this._createSafeFilename(
                    this._currentSong.artist,
                    this._currentSong.title
                );
                const filepath = GLib.build_filenamev([lyricsDir, safeFilename]);
                const file = Gio.File.new_for_path(filepath);

                // Write lyrics to file
                const outputStream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
                outputStream.write(lyricsText, null);
                outputStream.close(null);
                
                log('[Lyrics] Saved lyrics to: ' + filepath);
            }
        } catch (e) {
            logError(e, '[Lyrics] Failed to save lyrics to file');
        }
    }

    _createSafeFilename(artist, title) {
        // Remove invalid filename characters
        const safe = (str) => {
            return str.replace(/[<>:"/\\|?*]/g, '_');
        };
        return `${safe(artist)} - ${safe(title)}.lrc`;
    }

    _showSearchDialog() {
        try {
            log('[Lyrics] Opening search dialog');
            
            const artist = this._currentSong ? this._currentSong.artist : '';
            const title = this._currentSong ? this._currentSong.title : '';
            const album = this._currentSong ? this._currentSong.album : '';
            
            // Use zenity for a simple form
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
                    let [, stdout, stderr] = proc.communicate_utf8_finish(res);
                    
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
                            this._fetchLyrics(newArtist, newTitle, newAlbum);
                        }
                    }
                } catch (e) {
                    logError(e, '[Lyrics] Error reading dialog result');
                }
            });
            
        } catch (e) {
            logError(e, '[Lyrics] Error showing search dialog');
        }
    }

    _updatePopupMenu() {
        this._lyricsSection.removeAll();
        
        if (this._currentSong) {
            const titleItem = new PopupMenu.PopupMenuItem(
                `${this._currentSong.artist} - ${this._currentSong.title}`,
                { reactive: false }
            );
            titleItem.label.style_class = 'lyrics-title';
            this._lyricsSection.addMenuItem(titleItem);
            
            this._lyricsSection.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        }

        for (let lyric of this._currentLyrics) {
            const item = new PopupMenu.PopupMenuItem(lyric.text, { reactive: false });
            item._time = lyric.time;
            this._lyricsSection.addMenuItem(item);
        }
    }

    _updateCurrentLine() {
        if (!this._currentPlayer || this._currentLyrics.length === 0) return;

        // Get current position
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
                    
                    this._updateLyricDisplay(positionMs);
                } catch (e) {
                    // Player might be closed
                }
            }
        );
    }

    _updateLyricDisplay(positionMs) {
        let currentLine = null;
        
        for (let i = 0; i < this._currentLyrics.length; i++) {
            if (this._currentLyrics[i].time <= positionMs) {
                currentLine = this._currentLyrics[i];
            } else {
                break;
            }
        }

        if (currentLine && currentLine.text) {
            // Apply max line length from settings
            const maxLength = this._settings.get_int('max-line-length'); // <-- USED SETTING
            let displayText = currentLine.text;
            if (displayText.length > maxLength) {
                displayText = displayText.substring(0, maxLength) + '...';
            }
            this._label.set_text(`♪ ${displayText}`);
            
            // Highlight current line in popup
            const items = this._lyricsSection._getMenuItems();
            for (let item of items) {
                if (item._time !== undefined) {
                    if (item._time === currentLine.time) {
                        item.label.style = 'font-weight: bold; color: #4a90d9;';
                    } else {
                        item.label.style = '';
                    }
                }
            }
        }
    }

    destroy() {
        if (this._updateInterval) {
            GLib.source_remove(this._updateInterval);
            this._updateInterval = null;
        }
        
        // Unsubscribe from DBus signal when destroying
        if (this._signalId) {
            this._dbusConnection.signal_unsubscribe(this._signalId);
            this._signalId = null;
        }
        
        super.destroy();
    }
});

class Extension {
    constructor() {
        this._indicator = null;
    }

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

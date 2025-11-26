// extension.js - GNOME Shell Lyrics Extension
const { GObject, St, Clutter, Gio, Soup, GLib } = imports.gi;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const LyricsIndicator = GObject.registerClass(
class LyricsIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'Lyrics Indicator');

        // Create label for top bar
        this._label = new St.Label({
            text: '♪ Ready',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'lyrics-label'
        });
        this.add_child(this._label);

        // Initialize state variables
        this._currentLyrics = [];
        this._currentSong = null;
        this._currentPlayer = null;
        this._updateInterval = null;
        this._isFetching = false;
        
        // HTTP session
        this._session = new Soup.Session();

        // 1. Create Tabs (Lyrics / Artist)
        this._createTabs();

        // 2. Refresh Button
        this._refreshButton = new PopupMenu.PopupMenuItem('↻ Refresh Current Song');
        this._refreshButton.connect('activate', () => {
            if (this._currentSong) {
                this._retryFetch();
            }
        });
        this.menu.addMenuItem(this._refreshButton);

        // 3. Search Button
        this._searchButton = new PopupMenu.PopupMenuItem('🔍 Search Lyrics Manually');
        this._searchButton.connect('activate', () => {
            this._showSearchDialog();
        });
        this.menu.addMenuItem(this._searchButton);

        // Start background tasks
        this._startMonitoring();
    }

    _createTabs() {
        this._tabBox = new St.BoxLayout({ 
            style_class: 'lyrics-tabs',
            x_expand: true
        });
        
        this._lyricsTab = new St.Button({ 
            label: 'Lyrics',
            style_class: 'lyrics-tab-button active',
            x_expand: true,
            can_focus: true
        });
        
        this._artistTab = new St.Button({ 
            label: 'Artist Info',
            style_class: 'lyrics-tab-button',
            x_expand: true,
            can_focus: true
        });
        
        this._lyricsTab.connect('clicked', () => this._switchTab('lyrics'));
        this._artistTab.connect('clicked', () => this._switchTab('artist'));
        
        this._tabBox.add_child(this._lyricsTab);
        this._tabBox.add_child(this._artistTab);
        
        // Add tab container to menu
        const tabItem = new PopupMenu.PopupBaseMenuItem({ 
            reactive: false,
            style_class: 'lyrics-tab-container'
        });
        tabItem.actor.add_child(this._tabBox);
        this.menu.addMenuItem(tabItem);
        
        // Sections
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
        log(`[Lyrics] Retrying fetch for ${this._currentSong.title}`);
        this._showSearchingIndicator();
        this._fetchLyrics(this._currentSong.artist, this._currentSong.title, this._currentSong.album);
    }

    _startMonitoring() {
        this._dbusConnection = Gio.DBus.session;
        
        // Update loop for synced lyrics
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
            null, null, Gio.DBusCallFlags.NONE, -1, null,
            (connection, result) => {
                try {
                    const reply = connection.call_finish(result);
                    const names = reply.get_child_value(0).deep_unpack();
                    
                    const player = names.find(n => n.startsWith('org.mpris.MediaPlayer2.') && !n.includes('browser'));
                    
                    if (player) {
                        this._connectToPlayer(player);
                    } else {
                        this._label.set_text('♪ No Player');
                    }
                } catch (e) {
                    logError(e, '[Lyrics] DBus error');
                }
            }
        );
    }

    _connectToPlayer(busName) {
        if (this._currentPlayer === busName) return;
        
        log('[Lyrics] Connected to ' + busName);
        this._currentPlayer = busName;
        
        this._dbusConnection.signal_subscribe(
            busName,
            'org.freedesktop.DBus.Properties',
            'PropertiesChanged',
            '/org/mpris/MediaPlayer2',
            null,
            Gio.DBusSignalFlags.NONE,
            (c, s, p, i, sig, params) => this._onPlayerPropertiesChanged(params)
        );

        this._getCurrentSong();
    }

    _onPlayerPropertiesChanged(params) {
        const changed = params.get_child_value(1).deep_unpack();
        if ('Metadata' in changed) {
            this._onSongChanged(changed['Metadata']);
        }
    }

    _getCurrentSong() {
        if (!this._currentPlayer) return;
        
        this._dbusConnection.call(
            this._currentPlayer,
            '/org/mpris/MediaPlayer2',
            'org.freedesktop.DBus.Properties',
            'Get',
            new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2.Player', 'Metadata']),
            null, Gio.DBusCallFlags.NONE, -1, null,
            (c, res) => {
                try {
                    const reply = c.call_finish(res);
                    const val = reply.get_child_value(0).get_variant();
                    this._onSongChanged(val.deep_unpack());
                } catch (e) { /* ignore */ }
            }
        );
    }

    _onSongChanged(data) {
        try {
            const artist = data['xesam:artist']?.[0] || 'Unknown';
            const title = data['xesam:title'] || 'Unknown';
            const album = data['xesam:album'] || '';

            const newSong = { artist, title, album };

            if (this._currentSong && 
                this._currentSong.artist === newSong.artist && 
                this._currentSong.title === newSong.title) {
                return;
            }

            this._currentSong = newSong;
            this._showSearchingIndicator();
            this._fetchLyrics(artist, title, album);
        } catch (e) {
            logError(e, '[Lyrics] Song data parse error');
        }
    }

    _showSearchingIndicator() {
        this._isFetching = true;
        this._label.set_text('♪ Fetching...');
        
        this._lyricsSection.removeAll();
        
        // Song Title Header
        if (this._currentSong) {
            const header = new PopupMenu.PopupMenuItem(
                `${this._currentSong.artist} - ${this._currentSong.title}`, 
                { reactive: false }
            );
            header.label.style_class = 'lyrics-title';
            this._lyricsSection.addMenuItem(header);
            this._lyricsSection.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        }

        // Loading spinner/text
        const loadingItem = new PopupMenu.PopupMenuItem('⏳ Fetching lyrics...', { reactive: false });
        loadingItem.label.style_class = 'lyrics-status-msg';
        this._lyricsSection.addMenuItem(loadingItem);
    }

    _fetchLyrics(artist, title, album) {
        // Build URL (using LRCLIB as default)
        const url = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}&album_name=${encodeURIComponent(album)}`;
        
        const message = Soup.Message.new('GET', url);
        message.request_headers.append('User-Agent', 'GNOME-Lyrics-Extension');

        this._session.queue_message(message, (session, message) => {
            this._isFetching = false;
            
            if (message.status_code === 200 && message.response_body.data) {
                this._parseLyrics(message.response_body.data.toString());
            } else {
                this._label.set_text('♪ No Lyrics');
                this._showNoLyricsFound();
            }
        });
    }

    _parseLyrics(json) {
        try {
            const data = JSON.parse(json);
            const text = data.syncedLyrics || data.plainLyrics;

            if (!text) throw new Error("No lyrics in JSON");

            this._currentLyrics = [];
            
            // Parse LRC
            const lines = text.split('\n');
            const timeRegex = /\[(\d+):(\d+)(?:\.(\d+))?\](.*)/;

            for (const line of lines) {
                const match = line.match(timeRegex);
                if (match) {
                    const min = parseInt(match[1]);
                    const sec = parseInt(match[2]);
                    const ms = match[3] ? parseInt(match[3].padEnd(3, '0').substring(0,3)) : 0;
                    const content = match[4].trim();
                    
                    if (content) {
                        this._currentLyrics.push({
                            time: (min * 60 + sec) * 1000 + ms,
                            text: content
                        });
                    }
                }
            }

            this._currentLyrics.sort((a, b) => a.time - b.time);
            
            if (this._currentLyrics.length > 0) {
                this._label.set_text('♪ Lyrics Ready');
                this._updatePopupMenu();
            } else {
                this._showNoLyricsFound();
            }

        } catch (e) {
            logError(e, '[Lyrics] Parse error');
            this._showNoLyricsFound();
        }
    }

    _showNoLyricsFound() {
        this._lyricsSection.removeAll();
        
        if (this._currentSong) {
            const header = new PopupMenu.PopupMenuItem(
                `${this._currentSong.artist} - ${this._currentSong.title}`, 
                { reactive: false }
            );
            header.label.style_class = 'lyrics-title';
            this._lyricsSection.addMenuItem(header);
            this._lyricsSection.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        }

        // Make the error message reactive (clickable)
        const errorItem = new PopupMenu.PopupMenuItem('❌ No lyrics found. Click to Search.', { reactive: true });
        errorItem.label.style_class = 'lyrics-error-msg lyrics-action-item';
        
        // Allow clicking the error message to trigger search
        errorItem.connect('activate', () => {
            this.menu.close();
            this._showSearchDialog();
        });
        
        this._lyricsSection.addMenuItem(errorItem);
        this._label.set_text('♪ No Lyrics');
    }

    _updatePopupMenu() {
        this._lyricsSection.removeAll();
        
        // Header
        const header = new PopupMenu.PopupMenuItem(
            `${this._currentSong.artist} - ${this._currentSong.title}`, 
            { reactive: false }
        );
        header.label.style_class = 'lyrics-title';
        this._lyricsSection.addMenuItem(header);
        this._lyricsSection.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Lyrics Lines
        this._lyricMenuItems = [];
        for (const line of this._currentLyrics) {
            const item = new PopupMenu.PopupMenuItem(line.text, { reactive: false });
            item.label.style_class = 'lyrics-content-item';
            item._time = line.time; // Store time for syncing
            this._lyricsSection.addMenuItem(item);
            this._lyricMenuItems.push(item);
        }
    }

    _updateCurrentLine() {
        if (!this._currentPlayer || !this._currentLyrics.length) return;

        this._dbusConnection.call(
            this._currentPlayer,
            '/org/mpris/MediaPlayer2',
            'org.freedesktop.DBus.Properties',
            'Get',
            new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2.Player', 'Position']),
            null, Gio.DBusCallFlags.NONE, -1, null,
            (c, res) => {
                try {
                    const reply = c.call_finish(res);
                    const pos = reply.get_child_value(0).get_variant().get_int64() / 1000; // to ms
                    this._syncUI(pos);
                } catch (e) { /* ignore */ }
            }
        );
    }

    _syncUI(positionMs) {
        let activeLine = null;
        
        // Find current line
        for (let i = 0; i < this._currentLyrics.length; i++) {
            if (this._currentLyrics[i].time <= positionMs) {
                activeLine = this._currentLyrics[i];
            } else {
                break;
            }
        }

        if (activeLine) {
            // Update Top Bar
            const maxLen = 40;
            let txt = activeLine.text;
            if (txt.length > maxLen) txt = txt.substring(0, maxLen) + '...';
            this._label.set_text(`♪ ${txt}`);

            // Update Popup Menu Highlighting
            if (this._lyricMenuItems) {
                for (const item of this._lyricMenuItems) {
                    if (item._time === activeLine.time) {
                        item.label.style_class = 'lyrics-content-item lyrics-current-line';
                    } else {
                        item.label.style_class = 'lyrics-content-item';
                    }
                }
            }
        }
    }

    _showSearchDialog() {
        // Close the menu first to prevent locking
        this.menu.close();

        const artist = this._currentSong ? this._currentSong.artist : '';
        const title = this._currentSong ? this._currentSong.title : '';
        
        const cmd = [
            'zenity', '--forms', 
            '--title=Search Lyrics', 
            '--text=Enter Song Details', 
            '--add-entry=Artist', 
            '--add-entry=Title', 
            `--entry-text=${artist}|${title}`,
            '--separator=|||'
        ];

        try {
            let proc = Gio.Subprocess.new(cmd, Gio.SubprocessFlags.STDOUT_PIPE);
            proc.communicate_utf8_async(null, null, (proc, res) => {
                try {
                    const [, stdout] = proc.communicate_utf8_finish(res);
                    if (proc.get_successful() && stdout) {
                        const [newArtist, newTitle] = stdout.trim().split('|||');
                        if (newArtist && newTitle) {
                            this._currentSong = { artist: newArtist, title: newTitle, album: '' };
                            this._showSearchingIndicator();
                            this._fetchLyrics(newArtist, newTitle, '');
                        }
                    }
                } catch (e) { logError(e); }
            });
        } catch (e) { logError(e); }
    }

    _fetchArtistInfo() {
        // Simplified Artist Info Fetcher
        if (!this._currentSong) {
            this._showArtistStatus('No song playing');
            return;
        }

        this._artistSection.removeAll();
        this._showArtistStatus('Fetching artist info...');

        const url = `https://musicbrainz.org/ws/2/artist/?query=${encodeURIComponent(this._currentSong.artist)}&fmt=json&limit=1`;
        
        const msg = Soup.Message.new('GET', url);
        msg.request_headers.append('User-Agent', 'GNOME-Lyrics-Extension/1.0');

        this._session.queue_message(msg, (sess, res) => {
            this._artistSection.removeAll();
            if (res.status_code === 200) {
                try {
                    const data = JSON.parse(res.response_body.data);
                    if (data.artists && data.artists.length > 0) {
                        const artist = data.artists[0];
                        
                        const nameItem = new PopupMenu.PopupMenuItem(artist.name, { reactive: false });
                        nameItem.label.style = 'font-weight: bold; font-size: 13pt;';
                        this._artistSection.addMenuItem(nameItem);

                        if (artist.country || artist.type) {
                            const details = [artist.type, artist.country].filter(x=>x).join(' • ');
                            this._artistSection.addMenuItem(new PopupMenu.PopupMenuItem(details, { reactive: false }));
                        }
                        
                        if (artist.tags) {
                            const tags = artist.tags.slice(0, 3).map(t => t.name).join(', ');
                            const tagItem = new PopupMenu.PopupMenuItem(`Genre: ${tags}`, { reactive: false });
                            tagItem.label.style = 'font-size: 9pt; color: #aaa;';
                            this._artistSection.addMenuItem(tagItem);
                        }
                    } else {
                        this._showArtistStatus('Artist not found');
                    }
                } catch (e) { this._showArtistStatus('Parse error'); }
            } else {
                this._showArtistStatus('Network error');
            }
        });
    }

    _showArtistStatus(msg) {
        const item = new PopupMenu.PopupMenuItem(msg, { reactive: false });
        item.label.style = 'color: #888; font-style: italic;';
        this._artistSection.addMenuItem(item);
    }

    destroy() {
        if (this._updateInterval) {
            GLib.source_remove(this._updateInterval);
        }
        super.destroy();
    }
});

class Extension {
    enable() {
        this._indicat

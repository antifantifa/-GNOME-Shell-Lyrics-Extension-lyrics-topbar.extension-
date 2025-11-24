const { GObject, Gtk, Gio, GLib } = imports.gi; // <-- ADDED GLIB
const ExtensionUtils = imports.misc.extensionUtils;

function init() {
    // Nothing to do
}

function buildPrefsWidget() {
    return new LyricsPreferences();
}

const LyricsPreferences = GObject.registerClass(
    class LyricsPreferences extends Gtk.Grid {
        _init(params) {
            super._init(params);

            // Layout settings
            this.margin_top = 24;
            this.margin_bottom = 24;
            this.margin_start = 24;
            this.margin_end = 24;
            this.row_spacing = 12;
            this.column_spacing = 24;
            this.orientation = Gtk.Orientation.VERTICAL;

            this._settings = ExtensionUtils.getSettings('org.gnome.shell.extensions.lyrics'); // Ensure correct ID
            this._dbusConnection = Gio.DBus.session; // <-- ADDED
            this._buildUI();
        }

        _populatePlayerList(combo) {
            // Clear existing list
            combo.remove_all();
            
            // Add 'Auto' option first
            combo.append('', 'Auto-Detect (Recommended)');
            
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
                        
                        const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';
                        
                        names.filter(name => 
                            typeof name === 'string' && name.startsWith(MPRIS_PREFIX)
                        ).forEach(playerService => {
                            // Extract the short name (e.g., 'spotify', 'firefox')
                            const shortName = playerService.substring(MPRIS_PREFIX.length);
                            combo.append(shortName, shortName);
                        });
                        
                    } catch (e) {
                        logError(e, '[Lyrics Prefs] Failed to list DBus names');
                    }
                }
            );
        }

        _buildUI() {
            let row = 0;

            // --- 1. General Settings (Source) ---
            this._addHeader('General Settings', row++);

            const sourceLabel = new Gtk.Label({
                label: 'Lyric Source Provider',
                xalign: 0
            });

            const sourceCombo = new Gtk.ComboBoxText();
            sourceCombo.append('lrclib', 'LRC Lib (Free, Recommended)');
            sourceCombo.append('genius', 'Genius (Requires API)');
            sourceCombo.append('musixmatch', 'Musixmatch (Requires API)');
            sourceCombo.append('local', 'Local Files Only (~/.lyrics)');

            this._settings.bind(
                'lyric-source',
                sourceCombo,
                'active-id',
                Gio.SettingsBindFlags.DEFAULT
            );

            this.attach(sourceLabel, 0, row, 1, 1);
            this.attach(sourceCombo, 1, row, 1, 1);
            row++;

            // --- NEW: MPRIS Player Selection ---
            this._addHeader('Player Selection', row++);

            const playerLabel = new Gtk.Label({
                label: 'Select MPRIS Player',
                xalign: 0
            });

            const playerCombo = new Gtk.ComboBoxText();
            this._populatePlayerList(playerCombo); // <-- POPULATE THE LIST

            this._settings.bind(
                'mpris-player',
                playerCombo,
                'active-id',
                Gio.SettingsBindFlags.DEFAULT
            );

            this.attach(playerLabel, 0, row, 1, 1);
            this.attach(playerCombo, 1, row, 1, 1);
            row++;
            
            // --- Separator ---
            this.attach(new Gtk.Separator({ orientation: Gtk.Orientation.HORIZONTAL }), 0, row, 2, 1);
            row++;


            // --- 2. Max Line Length ---
            this._addHeader('Display Settings', row++); // Changed section header for clarity

            const lengthLabel = new Gtk.Label({
                label: 'Max Line Length (Chars)',
                xalign: 0
            });

            const lengthAdjustment = new Gtk.Adjustment({
                lower: 10,
                upper: 200,
                step_increment: 1,
                page_increment: 10
            });

            const lengthSpin = new Gtk.SpinButton({
                adjustment: lengthAdjustment,
                climb_rate: 1.0,
                digits: 0
            });

            this._settings.bind(
                'max-line-length',
                lengthSpin,
                'value',
                Gio.SettingsBindFlags.DEFAULT
            );

            this.attach(lengthLabel, 0, row, 1, 1);
            this.attach(lengthSpin, 1, row, 1, 1);
            row++;

            // --- 3. Font Selection ---
            const fontLabel = new Gtk.Label({
                label: 'Status Bar Font',
                xalign: 0
            });

            const fontBtn = new Gtk.FontButton();
            this._settings.bind(
                'font',
                fontBtn,
                'font',
                Gio.SettingsBindFlags.DEFAULT
            );

            this.attach(fontLabel, 0, row, 1, 1);
            this.attach(fontBtn, 1, row, 1, 1);
            row++;

            // --- Separator ---
            this.attach(new Gtk.Separator({ orientation: Gtk.Orientation.HORIZONTAL }), 0, row, 2, 1);
            row++;

            // --- 4. Visual Effects ---
            this._addHeader('Visual Effects', row++);

            // Enable Animation Switch
            const animLabel = new Gtk.Label({
                label: 'Enable Color Animation',
                xalign: 0
            });

            const animSwitch = new Gtk.Switch({
                valign: Gtk.Align.CENTER
            });

            this._settings.bind(
                'color-animation',
                animSwitch,
                'active',
                Gio.SettingsBindFlags.DEFAULT
            );

            this.attach(animLabel, 0, row, 1, 1);
            this.attach(animSwitch, 1, row, 1, 1);
            row++;

            // Animation Speed Slider
            const speedLabel = new Gtk.Label({
                label: 'Animation Speed',
                xalign: 0
            });

            const speedAdjustment = new Gtk.Adjustment({
                lower: 0.1,
                upper: 5.0,
                step_increment: 0.1,
                page_increment: 0.5
            });

            const speedScale = new Gtk.Scale({
                orientation: Gtk.Orientation.HORIZONTAL,
                adjustment: speedAdjustment,
                draw_value: true,
                digits: 1,
                hexpand: true
            });

            this._settings.bind(
                'animation-speed',
                speedScale.adjustment,
                'value',
                Gio.SettingsBindFlags.DEFAULT
            );

            this.attach(speedLabel, 0, row, 1, 1);
            this.attach(speedScale, 1, row, 1, 1);
            row++;
        }

        _addHeader(text, row) {
            const label = new Gtk.Label({
                label: `<b>${text}</b>`,
                use_markup: true,
                xalign: 0,
                margin_bottom: 10,
                margin_top: row > 0 ? 10 : 0
            });
            this.attach(label, 0, row, 2, 1);
        }
    }
);

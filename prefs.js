const { GObject, Gtk, Gio } = imports.gi;
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

            this.margin_top = 24;
            this.margin_bottom = 24;
            this.margin_start = 24;
            this.margin_end = 24;
            this.row_spacing = 12;
            this.column_spacing = 24;
            this.orientation = Gtk.Orientation.VERTICAL;

            this._settings = ExtensionUtils.getSettings('org.gnome.shell.extensions.lyrics');
            this._dbusConnection = Gio.DBus.session;
            
            this._buildUI();
        }

        _buildUI() {
            let row = 0;

            // --- 1. Player Selection ---
            this._addHeader('Music Player', row++);

            const playerLabel = new Gtk.Label({ label: 'Select Player', xalign: 0 });
            const playerCombo = new Gtk.ComboBoxText();
            
            // Fill the list
            this._populatePlayerList(playerCombo);

            // Bind setting
            this._settings.bind(
                'mpris-player',
                playerCombo,
                'active-id',
                Gio.SettingsBindFlags.DEFAULT
            );

            this.attach(playerLabel, 0, row, 1, 1);
            this.attach(playerCombo, 1, row, 1, 1);
            row++;
            
            this.attach(new Gtk.Separator({ orientation: Gtk.Orientation.HORIZONTAL }), 0, row, 2, 1);
            row++;

            // --- 2. Display Settings ---
            this._addHeader('Display Settings', row++);

            // Max Line Length
            const lengthLabel = new Gtk.Label({ label: 'Max Line Length (Chars)', xalign: 0 });
            const lengthSpin = new Gtk.SpinButton({
                adjustment: new Gtk.Adjustment({ lower: 10, upper: 200, step_increment: 1 }),
                climb_rate: 1.0,
                digits: 0
            });
            this._settings.bind('max-line-length', lengthSpin, 'value', Gio.SettingsBindFlags.DEFAULT);

            this.attach(lengthLabel, 0, row, 1, 1);
            this.attach(lengthSpin, 1, row, 1, 1);
            row++;

            // Font Selection
            const fontLabel = new Gtk.Label({ label: 'Status Bar Font', xalign: 0 });
            const fontBtn = new Gtk.FontButton();
            this._settings.bind('font', fontBtn, 'font', Gio.SettingsBindFlags.DEFAULT);

            this.attach(fontLabel, 0, row, 1, 1);
            this.attach(fontBtn, 1, row, 1, 1);
            row++;

            this.attach(new Gtk.Separator({ orientation: Gtk.Orientation.HORIZONTAL }), 0, row, 2, 1);
            row++;

            // --- 3. RGB Gamer Mode ---
            this._addHeader('RGB Gamer Mode', row++);

            // Enable Switch
            const animLabel = new Gtk.Label({ label: 'Enable Rainbow Animation', xalign: 0 });
            const animSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER });
            this._settings.bind('color-animation', animSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);

            this.attach(animLabel, 0, row, 1, 1);
            this.attach(animSwitch, 1, row, 1, 1);
            row++;

            // Speed Slider
            const speedLabel = new Gtk.Label({ label: 'Animation Speed', xalign: 0 });
            const speedScale = new Gtk.Scale({
                orientation: Gtk.Orientation.HORIZONTAL,
                adjustment: new Gtk.Adjustment({ lower: 0.1, upper: 5.0, step_increment: 0.1 }),
                draw_value: true,
                digits: 1,
                hexpand: true
            });
            this._settings.bind('animation-speed', speedScale.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);

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

        _populatePlayerList(combo) {
            combo.remove_all();
            combo.append('', 'Auto-Detect (Recommended)');
            
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
                        const prefix = 'org.mpris.MediaPlayer2.';
                        
                        names.filter(n => n.startsWith(prefix)).forEach(name => {
                            const shortName = name.substring(prefix.length);
                            combo.append(shortName, shortName);
                        });
                    } catch (e) {
                        logError(e, 'Failed to list players');
                    }
                }
            );
        }
    }
);

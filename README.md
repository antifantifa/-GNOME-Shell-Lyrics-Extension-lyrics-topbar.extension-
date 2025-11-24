# 🎶 GNOME Shell Lyrics Extension (lyrics@topbar.extension)

An MPRIS-enabled GNOME Shell extension that fetches and displays synchronized (LRC) lyrics for the currently playing song directly in your top bar and popup menu.

The extension prioritizes dedicated music players (like Spotify or Rhythmbox) over non-music players (like browser tabs playing lectures/videos), and includes a user setting to force a specific player.

---

## ✨ Features

* **Synchronized Lyrics (LRC):** Displays lyrics synced to the music position in the main dropdown menu.
* **Top Bar Display:** Shows the current line of the lyric in the GNOME top bar, auto-truncating based on user preference.
* **Smart MPRIS Selection:** Automatically filters out common browser-based MPRIS sources (like Firefox or Chrome) to avoid displaying lyrics for non-music media.
* **Manual Player Selection:** Allows users to manually select a preferred MPRIS player from the settings if multiple are running.
* **Artist Info Tab:** Includes a separate tab to fetch and display detailed artist information from **MusicBrainz**.
* **Local Caching:** Automatically saves fetched LRC lyrics to `~/.lyrics` for offline use and faster loading.

---

## 🛠️ Installation

### 📦 Prerequisites

This extension relies on **MPRIS** (Media Player Remote Interfacing Specification) being supported by your music player.

You may also need `zenity` installed for the manual search function:
```bash
# For Debian/Ubuntu/Pop!_OS
sudo apt install zenity

# For Fedora
sudo dnf install zenity
````

### 💻 Manual Installation (Developer Method)

1.  **Clone the Repository:**

    ```bash
    git clone [https://github.com/antifantifa/lyrics-gnome-extension.git](https://github.com/antifantifa/lyrics-gnome-extension.git) ~/.local/share/gnome-shell/extensions/lyrics@topbar.extension
    ```

2.  **Compile the Schema:** After adding new settings (like the `mpris-player` key), you must compile the GSettings schema.

    ```bash
    cd ~/.local/share/gnome-shell/extensions/lyrics@topbar.extension
    glib-compile-schemas schemas/
    ```

3.  **Enable the Extension:**

      * Restart GNOME Shell by pressing `Alt` + `F2`, typing `r`, and hitting `Enter`.
      * Enable the extension using GNOME Extensions app or GNOME Tweak Tool.

-----

## ⚙️ Configuration

The extension adds a comprehensive settings panel available via the GNOME Extensions app.

### **Player Selection**

This section is crucial for systems running multiple media applications simultaneously (e.g., Firefox and Spotify).

  * **Select MPRIS Player:** Use the dropdown menu to choose your desired player.
      * **Auto-Detect (Recommended):** The default behavior. It scans for all active players and intelligently skips known web browsers (Firefox, Chrome, etc.) to connect to a dedicated music player first.
      * **Specific Player:** Select the short name of your player (e.g., `spotify`, `rhythmbox`) to force the extension to monitor only that source.

### **Display Settings**

  * **Max Line Length:** Controls how many characters of the current lyric are displayed in the GNOME top bar before truncation (`...`).

-----

## 🐞 Troubleshooting

If you encounter issues, especially with player detection or lyrics fetching, check the logs:

1.  **Stop Monitoring:** Disable and re-enable the extension.
2.  **Monitor Logs:** Open a new terminal and run:
    ```bash
    journalctl -f -o cat | grep -i lyrics
    ```
3.  **Reproduce Issue:** Play a song or switch players. The log output will show exactly which player the extension is connecting to and the HTTP status code for lyric requests (e.g., `404` for not found).

-----

## 💡 Planned Improvements

  * Support for additional lyric sources (e.g., a fallback if LRC Lib returns 404).
  * Better UI integration for manual search results.
  * Configuration options for excluding specific players (if not using the default exclusions).

-----

## 👤 Credits

  * **Author/Maintainer:** [Antifantifa](https://github.com/antifantifa)
  * **Lyric Source:** [LRC Lib](https://lrclib.net) (Used as the primary source)
  * **Artist Info Source:** [MusicBrainz](https://musicbrainz.org) (Used for detailed artist metadata)
  * **GNOME Shell Extension Framework:** Based on various community examples.

<!-- end list -->

```
```

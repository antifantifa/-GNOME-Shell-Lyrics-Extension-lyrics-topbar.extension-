# 🎶 GNOME Shell Lyrics Extension

An MPRIS-enabled GNOME Shell extension that fetches and displays synchronized (LRC) lyrics for the currently playing song directly in your top bar and a scrollable popup menu.

The extension prioritizes dedicated music players (like Spotify, Rhythmbox, Amberol, or Quod Libet) and includes intelligent state management to handle pauses, stops, and track changes smoothly.

---

## ✨ Features

### 🎧 Core Functionality
*   **Synchronized & Plain Lyrics:** automatically handles time-synced LRC files (auto-scrolling) and falls back to plain text lyrics if no timing data is available.
*   **Universal Provider:** Fetches lyrics from **LRCLib** (no API key required).
*   **Local Caching:** Automatically saves fetched lyrics to `~/.lyrics`. The extension checks this local cache first for instant loading on repeat listens.
*   **Manual Editor:** Missing lyrics? Click the **Edit** button to paste or write lyrics directly via a text editor window. They are saved instantly to your local cache.
*   **Smart MPRIS Selection:** Automatically filters out common browser-based MPRIS sources (like Firefox, Chrome, Brave) to avoid displaying lyrics for YouTube videos or ads.

### 🎨 UI & Customization
*   **Top Bar Indicator:** Displays the current lyric line in the top bar.
*   **Scrollable Dropdown:** A clean, scrollable view limited to 50% of screen height to prevent overflow.
*   **Rainbow Mode:** 🌈 An optional visual effect that cycles the top bar and active line text color through the RGB spectrum. Includes a **Speed Control** slider.
*   **Font & Layout:** Customize the font family and maximum line length via settings.

### 🧠 Advanced Integration
*   **Artist Info Tab:** A secondary tab fetches metadata (Tags, Country, Type) from **MusicBrainz**.
*   **Manual Search:** If automatic fetching fails, use the built-in search dialog (Zenity) to find lyrics by manually entering Artist/Title.
*   **Genius API Support:** Settings field available to add a Genius Access Token for future expanded search capabilities.

---

## 🛠️ Installation

### 📦 Prerequisites

1.  **MPRIS Player:** Your music player must support the MPRIS D-Bus interface.
2.  **Zenity:** Required for the Manual Search and Manual Edit dialogs.

```bash
# Debian/Ubuntu/Pop!_OS
sudo apt install zenity

# Fedora
sudo dnf install zenity

# Arch Linux
sudo pacman -S zenity
```

### 📥 Manual Installation (From Source)

1.  **Download the Extension:**
    Download the `.zip` file or clone the repository.

2.  **Install to Extensions Directory:**
    Create the directory and move the files there.
    ```bash
    mkdir -p ~/.local/share/gnome-shell/extensions/lyrics@topbar.extension
    # Extract files into this directory
    cp -r * ~/.local/share/gnome-shell/extensions/lyrics@topbar.extension/
    ```

3.  **Compile Settings Schemas (Important!):**
    The extension settings will not work without compiling the schema.
    ```bash
    cd ~/.local/share/gnome-shell/extensions/lyrics@topbar.extension/schemas
    glib-compile-schemas .
    ```

4.  **Restart GNOME Shell:**
    *   **X11:** Press `Alt` + `F2`, type `r`, and press `Enter`.
    *   **Wayland:** Log out and log back in.

5.  **Enable the Extension:**
    Use the **Extensions** app (green icon) or run:
    ```bash
    gnome-extensions enable lyrics@topbar.extension
    ```

---

## ⚙️ Configuration

Open the **Extensions** app and click the Settings (⚙️) button for Lyrics Indicator.

| Setting | Description |
| :--- | :--- |
| **Top Bar Font** | Choose the specific font family for the indicator. |
| **Max Line Length** | Truncate long lyric lines in the top bar after $N$ characters. |
| **Rainbow Animation** | Toggle the RGB color cycling effect. |
| **Animation Speed** | Adjust the speed of the rainbow effect (0.1x to 5.0x). |
| **Genius API Token** | (Optional) Input your OAuth2 token here. |

---

## 📂 File Structure

*   `~/.lyrics/` - Where .lrc files are cached.
*   `extension.js` - Core logic for DBus, UI, and Networking.
*   `prefs.js` - The GTK4 settings window.
*   `stylesheet.css` - Visual styling for the top bar and popup.

---

## 🤝 Contributing

Pull requests are welcome! For major changes, please open an issue first to discuss what you would like to change.

## 📄 License

[MIT](https://choosealicense.com/licenses/mit/)

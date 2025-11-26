# 🎶 GNOME Shell Lyrics Extension

An MPRIS-enabled GNOME Shell extension that fetches and displays synchronized (LRC) lyrics for the currently playing song directly in your top bar and a scrollable popup menu.

The extension prioritizes dedicated music players (like Spotify, Rhythmbox, or Amberol) over non-music players (like browser tabs), and includes a user setting to force a specific player.

---

## ✨ Features

### 🎧 Core Functionality
* **Synchronized Lyrics (LRC):** Displays lyrics synced to the music position in the main dropdown menu.
* **Top Bar Display:** Shows the current line of the lyric in the GNOME top bar, auto-truncating based on user preference.
* **Local Caching:** Automatically saves fetched LRC lyrics to `~/.lyrics` for offline use and faster loading on repeat listens.
* **Smart MPRIS Selection:** Automatically filters out common browser-based MPRIS sources (like Firefox or Chrome) to avoid displaying lyrics for non-music media.

### 🎨 UI & Customization
* **Scrollable Interface:** The dropdown menu features a **scrollable view** limited to 50% of the screen height, preventing long lyrics from overflowing your display.
* **Sticky Footer Controls:** A fixed control bar at the bottom of the menu allows you to **Refresh**, **Clear**, or **Manually Search** for lyrics without losing context.
* **RGB Gamer Mode:** 🌈 An optional visual effect that cycles the top bar text color through the RGB spectrum.
* **Font Customization:** Choose your preferred font and size for the top bar indicator.

### 🧠 Stability & Metadata
* **Artist Info Tab:** Includes a separate tab to fetch and display detailed artist information from **MusicBrainz**.
* **Smart Debouncing:** Prevents "Metadata Jitter" (duplicate requests) when music players emit multiple signals for the same song change.
* **Manual Search:** If automatic fetching fails, use the built-in search dialog to find lyrics manually.

---

## 🛠️ Installation

### 📦 Prerequisites

This extension relies on **MPRIS** (Media Player Remote Interfacing Specification) being supported by your music player.

You must install `zenity` for the manual search dialog to function:
```bash
# For Debian/Ubuntu/Pop!_OS
sudo apt install zenity

# For Fedora
sudo dnf install zenity

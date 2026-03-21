# 🧹 DiskCleaner

A free, open-source disk cleaner with a beautiful web UI. Scan your folders, see what's eating up your storage, and delete files — all from your browser.

> Runs locally on your PC. No data leaves your machine.

---

## ✨ Features

- **📊 Disk Overview** — see used, free and total space at a glance with a live progress bar
- **📁 Quick Folder Scan** — one-click scan of Downloads, Videos, Pictures, Documents, Desktop, Music
- **🔍 Custom Path Scan** — scan any folder or drive you want
- **📂 File Type Filter** — filter results by Videos, Images, Audio, Documents, Archives or Folders
- **📏 Size Visualization** — every file has a size bar so you instantly spot the big ones
- **☑️ Multi-Select Delete** — select individual files or select all, then delete in one click
- **⚠️ Confirm Dialog** — shows exactly how much space will be freed before deleting
- **🌌 Clean Dark UI** — minimal dark interface with animated star background
- **💾 Multi-Drive Support** — automatically detects D:, E:, F: drives on Windows
- **No install** — just Node.js, one `.js` file and one `.bat` file

---

## 🚀 Getting Started

### Requirements

- [Node.js](https://nodejs.org) (any recent version)

### Start

**Windows:**
```
Double-click START.bat
```

The browser opens automatically at `http://localhost:3333`.

**Manual:**
```bash
node server.js
```

---

## 🖥️ How to Use

1. **Start** the app via `START.bat`
2. **Check** your disk usage in the top bar
3. **Click** a quick-access folder (Downloads, Videos, etc.) or type a custom path
4. **Browse** the scan results — sorted by size, largest first
5. **Select** files or folders you want to delete (checkbox or click)
6. **Click Delete** — confirm the dialog — done

---

## ⚠️ Important

> Files are **permanently deleted** — they do **not** go to the Recycle Bin.

Make sure you know what you're deleting before confirming.

---

## 🗂️ File Types

| Icon | Type | Extensions |
|------|------|-----------|
| 🎬 | Video | mp4, mkv, avi, mov, wmv, flv, webm... |
| 🖼 | Image | jpg, png, gif, webp, heic, raw... |
| 🎵 | Audio | mp3, wav, flac, aac, ogg, m4a... |
| 📄 | Document | pdf, doc, docx, xls, xlsx, txt, md... |
| 📦 | Archive | zip, rar, 7z, tar, gz... |
| 📁 | Folder | — |

---

## 🔒 Privacy

DiskCleaner runs entirely on your local machine. No data is sent anywhere. The Node.js server only listens on `localhost:3333`.

---

## 📄 License

MIT — free to use, modify and share.

---

## 🤝 Part of [DevLoot-Free](https://github.com/DevLoot-Free)

A collection of free, open-source tools for developers and streamers.

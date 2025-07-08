// --- IndexedDB Manager for File System Access API handles ---
class IndexedDBManager {
  constructor(dbName = "MusicPlayerDB", storeName = "fileHandles") {
    this.dbName = dbName;
    this.storeName = storeName;
    this.db = null;
  }
  async openDB() {
    return new Promise((resolve, reject) => {
      if (this.db) {
        resolve(this.db);
        return;
      }
      const request = indexedDB.open(this.dbName, 1);
      request.onerror = (event) => reject("Error opening DB");
      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        db.createObjectStore(this.storeName);
      };
    });
  }
  async set(key, value) {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, "readwrite");
      const store = transaction.objectStore(this.storeName);
      const request = store.put(value, key);
      request.onsuccess = () => resolve();
      request.onerror = (event) => reject("Error setting item");
    });
  }
  async get(key) {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, "readonly");
      const store = transaction.objectStore(this.storeName);
      const request = store.get(key);
      request.onsuccess = (event) => resolve(event.target.result);
      request.onerror = (event) => reject("Error getting item");
    });
  }
  async delete(key) {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, "readwrite");
      const store = transaction.objectStore(this.storeName);
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject("Error deleting item");
    });
  }
}

class UltimateMusicPlayer {
  constructor() {
    this.currentSong = -1;
    this.isPlaying = false;
    this.volume = 70;
    this.lastVolume = 70;
    this.speeds = [0.5, 0.75, 1.0, 1.25, 1.5];
    this.speedIndex = 2;
    this.currentPlaylist = "default";
    this.isEditingPlaylist = false;

    this.dbManager = new IndexedDBManager();
    this.isFileSystemApiSupported = "showOpenFilePicker" in window;

    this.audio = document.getElementById("audioElement");
    this.visualizerCanvas = document.getElementById("visualizerCanvas");
    this.volumeSlider = document.getElementById("volumeSlider");
    this.speedSlider = document.getElementById("speedSlider");

    this.audioCtx = null;
    this.analyser = null;
    this.source = null;
    this.bufferLength = 0;
    this.dataArray = null;

    this.playlists = {};

    this.init();
  }

  async init() {
    setTimeout(() => {
      document.getElementById("splashScreen").classList.add("hidden");
    }, 1200);

    await this.dbManager.openDB();
    this.playlists = this.loadPlaylistsFromStorage() || {
      default: { name: "Default Playlist", songs: [] },
    };

    this.initTheme();
    this.bindEvents();
    this.updatePlaylistDropdown();
    this.updatePlaylistUI();
    this.updateDisplay();
    this.setVolume(this.volume, true);
    this.setSpeed(this.speedIndex, true);
  }

  bindEvents() {
    document.getElementById("themeToggle").addEventListener("click", () => {
      this.toggleTheme();
      this.updateSliderFills(); // Update fills on theme change
    });
    document
      .getElementById("playBtn")
      .addEventListener("click", () => this.togglePlay());
    document
      .getElementById("prevBtn")
      .addEventListener("click", () => this.previousSong());
    document
      .getElementById("nextBtn")
      .addEventListener("click", () => this.nextSong());
    document
      .getElementById("seekBackwardBtn")
      .addEventListener("click", () => this.seek(-10));
    document
      .getElementById("seekForwardBtn")
      .addEventListener("click", () => this.seek(10));
    document
      .getElementById("progressBar")
      .addEventListener("click", (e) => this.seekTo(e));
    document
      .getElementById("volumeIconBtn")
      .addEventListener("click", () => this.toggleMute());
    this.volumeSlider.addEventListener("input", (e) =>
      this.setVolume(e.target.value)
    );
    this.speedSlider.addEventListener("input", (e) =>
      this.setSpeed(e.target.value)
    );
    this.audio.addEventListener("timeupdate", () => this.updateProgress());
    this.audio.addEventListener("ended", () => this.nextSong());
    this.audio.addEventListener("loadedmetadata", () => this.updateTotalTime());
    document.getElementById("addMusicBtn").addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleAddDropdown();
    });
    document
      .getElementById("playlistSelect")
      .addEventListener("change", (e) => this.switchPlaylist(e.target.value));
    document
      .getElementById("uploadFiles")
      .addEventListener("click", () => this.triggerFileUpload());
    document
      .getElementById("createPlaylist")
      .addEventListener("click", () => this.showPlaylistModal(false));
    document
      .getElementById("editPlaylist")
      .addEventListener("click", () => this.showPlaylistModal(true));
    document
      .getElementById("deletePlaylist")
      .addEventListener("click", () => this.deleteCurrentPlaylist());
    document
      .getElementById("savePlaylistBtn")
      .addEventListener("click", () => this.savePlaylist());
    document
      .getElementById("cancelPlaylistBtn")
      .addEventListener("click", () => this.hidePlaylistModal());
    document
      .getElementById("fileInput")
      .addEventListener("change", (e) => this.handleFileSelect(e.target.files));
    this.setupDragDrop();
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".add-music-container"))
        document.getElementById("addDropdown").classList.remove("show");
      if (e.target.classList.contains("modal")) this.hideAllModals();
    });
    document.getElementById("appContainer").addEventListener("keydown", (e) => {
      if (e.code === "Space" && e.target.tagName !== "INPUT") {
        e.preventDefault();
        this.togglePlay();
      }
    });
  }

  initTheme() {
    const savedTheme = localStorage.getItem("musicPlayerTheme") || "dark";
    const themeIcon = document
      .getElementById("themeToggle")
      .querySelector("use");
    document.documentElement.setAttribute("data-theme", savedTheme);
    themeIcon.setAttribute(
      "href",
      savedTheme === "dark" ? "#icon-sun" : "#icon-moon"
    );
  }

  toggleTheme() {
    const currentTheme = document.documentElement.getAttribute("data-theme");
    const newTheme = currentTheme === "dark" ? "light" : "dark";
    const themeIcon = document
      .getElementById("themeToggle")
      .querySelector("use");
    document.documentElement.setAttribute("data-theme", newTheme);
    localStorage.setItem("musicPlayerTheme", newTheme);
    themeIcon.setAttribute(
      "href",
      newTheme === "dark" ? "#icon-sun" : "#icon-moon"
    );
  }

  setupAudioContext() {
    if (this.audioCtx) return;
    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    this.analyser = this.audioCtx.createAnalyser();
    this.source = this.audioCtx.createMediaElementSource(this.audio);
    this.source.connect(this.analyser);
    this.analyser.connect(this.audioCtx.destination);
    this.analyser.fftSize = 256;
    this.bufferLength = this.analyser.frequencyBinCount;
    this.dataArray = new Uint8Array(this.bufferLength);
    this.drawVisualizer();
  }

  drawVisualizer() {
    requestAnimationFrame(() => this.drawVisualizer());
    if (!this.analyser) return;
    this.analyser.getByteFrequencyData(this.dataArray);

    const canvasCtx = this.visualizerCanvas.getContext("2d");
    const { width, height } = this.visualizerCanvas;
    canvasCtx.clearRect(0, 0, width, height);

    // Get colors from CSS variables
    const styles = getComputedStyle(document.documentElement);
    const startColor = JSON.parse(
      styles.getPropertyValue("--visualizer-color-start").trim()
    );
    const endColor = JSON.parse(
      styles.getPropertyValue("--visualizer-color-end").trim()
    );

    const barWidth = (width / this.bufferLength) * 2.5;
    let x = 0;

    for (let i = 0; i < this.bufferLength; i++) {
      const barHeight = this.dataArray[i];
      const intensity = barHeight / 255.0;

      // Interpolate color based on intensity
      const r = startColor[0] + intensity * (endColor[0] - startColor[0]);
      const g = startColor[1] + intensity * (endColor[1] - startColor[1]);
      const b = startColor[2] + intensity * (endColor[2] - startColor[2]);

      canvasCtx.fillStyle = `rgb(${r}, ${g}, ${b})`;

      const barDrawHeight = intensity * height;
      canvasCtx.fillRect(x, height - barDrawHeight, barWidth, barDrawHeight);
      x += barWidth + 1;
    }
  }

  updateSliderFill(slider) {
    const min = slider.min;
    const max = slider.max;
    const val = slider.value;
    const percentage = ((val - min) * 100) / (max - min);

    const trackColor = getComputedStyle(document.documentElement)
      .getPropertyValue("--progress-track")
      .trim();
    const gradient = getComputedStyle(document.documentElement)
      .getPropertyValue("--accent-gradient")
      .trim();

    // We set the background as a gradient layered on top of the track color
    slider.style.background = `linear-gradient(to right, ${gradient.substring(
      18,
      gradient.length - 1
    )} ${percentage}%, ${trackColor} ${percentage}%)`;
  }

  updateSliderFills() {
    this.updateSliderFill(this.volumeSlider);
    this.updateSliderFill(this.speedSlider);
  }

  setVolume(value, isInit = false) {
    if (!isInit) this.volume = Number(value);
    this.audio.volume = this.volume / 100;

    const volIcon = document.getElementById("volumeIcon");
    const volPercentage = document.getElementById("volumePercentage");

    if (this.volume > 0) {
      volIcon.style.display = "none";
      volPercentage.style.display = "block";
      volPercentage.textContent = Math.round(this.volume);
    } else {
      volIcon.style.display = "flex";
      volPercentage.style.display = "none";
    }
    this.volumeSlider.value = this.volume;
    this.updateSliderFill(this.volumeSlider);
  }

  setSpeed(value, isInit = false) {
    if (!isInit) this.speedIndex = parseInt(value, 10);
    const speed = this.speeds[this.speedIndex];
    this.audio.playbackRate = speed;
    document.getElementById("speedDisplay").textContent = `${speed.toFixed(
      2
    )}x`;
    this.speedSlider.value = this.speedIndex;
    this.updateSliderFill(this.speedSlider);
  }

  togglePlay() {
    if (
      (!this.audioCtx && this.setupAudioContext(),
      this.playlists[this.currentPlaylist].songs.length !== 0)
    ) {
      -1 === this.currentSong && this.loadSong(0);
      if (this.playlists[this.currentPlaylist].songs[this.currentSong]) {
        this.isPlaying = !this.isPlaying;
        const t = document.getElementById("playBtn").querySelector("use");
        this.isPlaying
          ? (this.audio.play().catch((t) => {
              console.error("Playback failed:", t), (this.isPlaying = !1);
            }),
            t.setAttribute("href", "#icon-pause"))
          : (this.audio.pause(), t.setAttribute("href", "#icon-play"));
      }
    }
  }
  loadPlaylistsFromStorage() {
    const t = localStorage.getItem("ultimateMusicPlayerPlaylists");
    return t ? JSON.parse(t) : null;
  }
  savePlaylistsToStorage() {
    localStorage.setItem(
      "ultimateMusicPlayerPlaylists",
      JSON.stringify(this.playlists)
    );
  }
  updatePlaylistDropdown() {
    const t = document.getElementById("playlistSelect");
    t.innerHTML = "";
    for (const e in this.playlists) {
      const s = document.createElement("option");
      (s.value = e), (s.textContent = this.playlists[e].name), t.appendChild(s);
    }
    t.value = this.currentPlaylist;
  }
  switchPlaylist(t) {
    this.isPlaying && this.togglePlay(),
      (this.currentPlaylist = t),
      (this.currentSong = -1),
      (this.audio.src = ""),
      this.updatePlaylistUI(),
      this.updateDisplay(),
      this.resetProgress();
  }
  showPlaylistModal(t = !1) {
    (this.isEditingPlaylist = t), this.toggleAddDropdown(!1);
    const e = document.getElementById("playlistModal"),
      s = document.getElementById("playlistModalTitle"),
      n = document.getElementById("playlistNameInput");
    t
      ? "default" === this.currentPlaylist
        ? alert("The Default Playlist cannot be renamed.")
        : ((s.textContent = "Rename Playlist"),
          (n.value = this.playlists[this.currentPlaylist].name))
      : ((s.textContent = "Create New Playlist"), (n.value = "")),
      (e.style.display = "flex"),
      n.focus();
  }
  hidePlaylistModal() {
    document.getElementById("playlistModal").style.display = "none";
  }
  hideAllModals() {
    document
      .querySelectorAll(".modal")
      .forEach((t) => (t.style.display = "none"));
  }
  savePlaylist() {
    const t = document.getElementById("playlistNameInput").value.trim();
    if (t) {
      if (this.isEditingPlaylist) this.playlists[this.currentPlaylist].name = t;
      else {
        const e = `playlist_${Date.now()}`;
        (this.playlists[e] = { name: t, songs: [] }),
          (this.currentPlaylist = e);
      }
      this.savePlaylistsToStorage(),
        this.updatePlaylistDropdown(),
        this.switchPlaylist(this.currentPlaylist),
        this.hidePlaylistModal();
    }
  }
  deleteCurrentPlaylist() {
    this.toggleAddDropdown(!1),
      "default" === this.currentPlaylist
        ? alert("The Default Playlist cannot be deleted.")
        : confirm(
            `Are you sure you want to delete "${
              this.playlists[this.currentPlaylist].name
            }"?`
          ) &&
          (this.playlists[this.currentPlaylist].songs.forEach((t) => {
            t.handleId && this.dbManager.delete(t.handleId);
          }),
          delete this.playlists[this.currentPlaylist],
          this.savePlaylistsToStorage(),
          this.switchPlaylist("default"),
          this.updatePlaylistDropdown());
  }
  async addSong(t) {
    t.handle
      ? (async (t) => {
          const e = `handle_${Date.now()}_${Math.random()}`;
          await this.dbManager.set(e, t.handle),
            this.playlists[this.currentPlaylist].songs.push({
              title: t.title,
              artist: t.artist,
              id: `song_${e}`,
              handleId: e,
            });
        })(t)
      : t.file &&
        this.playlists[this.currentPlaylist].songs.push({
          title: t.title,
          artist: t.artist,
          id: `file_${Date.now()}_${Math.random()}`,
          file: t.file,
        }),
      this.savePlaylistsToStorage(),
      this.updatePlaylistUI();
  }
  async deleteSong(t, e) {
    t.stopPropagation();
    const s = this.playlists[this.currentPlaylist].songs[e];
    s.handleId && (await this.dbManager.delete(s.handleId)),
      this.currentSong === e &&
        (this.audio.pause(),
        (this.audio.src = ""),
        (this.isPlaying = !1),
        (this.currentSong = -1),
        this.updateDisplay(),
        this.resetProgress()),
      this.playlists[this.currentPlaylist].songs.splice(e, 1),
      this.savePlaylistsToStorage(),
      this.currentSong > e && this.currentSong--,
      this.updatePlaylistUI();
  }
  async loadSong(t) {
    const e = this.playlists[this.currentPlaylist].songs;
    if (!(t < 0 || t >= e.length)) {
      this.currentSong = t;
      const s = e[this.currentSong];
      this.currentObjectURL && URL.revokeObjectURL(this.currentObjectURL);
      let n;
      try {
        if (s.handleId) {
          const t = await this.dbManager.get(s.handleId);
          if (!t)
            throw new Error("File handle not found. Please re-add the file.");
          if ("granted" !== (await t.queryPermission({ mode: "read" })))
            if ("granted" !== (await t.requestPermission({ mode: "read" })))
              throw new Error("Permission denied to read the file.");
          n = await t.getFile();
        } else s.file && (n = s.file);
        if (!n) throw new Error("Song data is missing.");
        (this.currentObjectURL = URL.createObjectURL(n)),
          (this.audio.src = this.currentObjectURL),
          this.updateDisplay(),
          this.isPlaying && this.audio.play();
      } catch (t) {
        alert(`Could not load song: ${t.message}`),
          console.error(t),
          (this.audio.src = ""),
          this.updateDisplay(),
          this.isPlaying && this.togglePlay();
      }
      this.updatePlaylistUI();
    }
  }
  previousSong() {
    const t = this.playlists[this.currentPlaylist].songs;
    if (0 !== t.length) {
      let e = this.currentSong - 1;
      e < 0 && (e = t.length - 1), this.loadSong(e);
    }
  }
  nextSong() {
    const t = this.playlists[this.currentPlaylist].songs;
    0 !== t.length && this.loadSong((this.currentSong + 1) % t.length);
  }
  seek(t) {
    -1 !== this.currentSong &&
      !isNaN(this.audio.duration) &&
      (this.audio.currentTime = Math.max(
        0,
        Math.min(this.audio.duration, this.audio.currentTime + t)
      ));
  }
  seekTo(t) {
    if (-1 !== this.currentSong && !isNaN(this.audio.duration)) {
      const e = t.currentTarget;
      this.audio.currentTime =
        (t.offsetX / e.clientWidth) * this.audio.duration;
    }
  }
  toggleMute() {
    this.audio.volume > 0
      ? ((this.lastVolume = this.volume), this.setVolume(0))
      : this.setVolume(this.lastVolume > 0 ? this.lastVolume : 70);
  }
  updateDisplay() {
    const t = document.getElementById("songTitle"),
      e = document.getElementById("artistName");
    -1 !== this.currentSong &&
    this.playlists[this.currentPlaylist].songs.length > 0
      ? ((t.textContent =
          this.playlists[this.currentPlaylist].songs[this.currentSong].title),
        (e.textContent =
          this.playlists[this.currentPlaylist].songs[this.currentSong].artist),
        (document.title = `${t.textContent} - ${e.textContent}`))
      : ((t.textContent = "No Song Selected"),
        (e.textContent = this.isFileSystemApiSupported
          ? "Select music to begin"
          : "Upload music to begin"),
        (document.title = "Modern Music Player"));
  }
  updatePlaylistUI() {
    const t = document.getElementById("playlist"),
      e = document.getElementById("dragDropArea");
    t.innerHTML = "";
    const s = this.playlists[this.currentPlaylist].songs;
    (e.style.display = 0 === s.length ? "flex" : "none"),
      s.forEach((e, s) => {
        const n = document.createElement("div");
        (n.className = "playlist-item"),
          s === this.currentSong && n.classList.add("active"),
          (n.innerHTML = `<div class="playlist-item-info"><div class="playlist-item-title">${e.title}</div><div class="playlist-item-artist">${e.artist}</div></div><button class="delete-btn" title="Remove song"><svg class="svg-icon"><use href="#icon-trash"></use></svg></button>`),
          n.addEventListener("click", () => {
            this.currentSong === s
              ? this.togglePlay()
              : ((this.isPlaying = !0), this.loadSong(s));
          }),
          n
            .querySelector(".delete-btn")
            .addEventListener("click", (t) => this.deleteSong(t, s)),
          t.appendChild(n);
      });
  }
  updateProgress() {
    if (!isNaN(this.audio.duration)) {
      const t = document.getElementById("progressFill"),
        e = document.getElementById("currentTime"),
        s = (this.audio.currentTime / this.audio.duration) * 100;
      (t.style.width = `${s}%`),
        (e.textContent = this.formatTime(this.audio.currentTime));
    }
  }
  updateTotalTime() {
    document.getElementById("totalTime").textContent = this.formatTime(
      this.audio.duration
    );
  }
  resetProgress() {
    (document.getElementById("progressFill").style.width = "0%"),
      (document.getElementById("currentTime").textContent = "0:00"),
      (document.getElementById("totalTime").textContent = "0:00");
  }
  formatTime(t) {
    t = Math.floor(t) || 0;
    const e = Math.floor(t / 60);
    return `${e}:${(t %= 60) < 10 ? "0" : ""}${t}`;
  }
  toggleAddDropdown(t) {
    document.getElementById("addDropdown").classList.toggle("show", t);
  }
  async triggerFileUpload() {
    if ((this.toggleAddDropdown(!1), this.isFileSystemApiSupported))
      try {
        const t = await window.showOpenFilePicker({
          multiple: !0,
          types: [
            {
              description: "Audio Files",
              accept: { "audio/*": [".mp3", ".wav", ".ogg", ".flac", ".m4a"] },
            },
          ],
        });
        for (const e of t) {
          const s = await e.getFile();
          this.addSong({
            title: s.name.replace(/\.[^/.]+$/, ""),
            artist: "Unknown Artist",
            handle: e,
          });
        }
      } catch (t) {
        console.info("User cancelled file picker.");
      }
    else document.getElementById("fileInput").click();
  }
  handleFileSelect(t) {
    t &&
      Array.from(t).forEach((t) => {
        t.type.startsWith("audio/") &&
          this.addSong({
            title: t.name.replace(/\.[^/.]+$/, ""),
            artist: "Uploaded File",
            file: t,
          });
      }),
      (document.getElementById("fileInput").value = "");
  }
  setupDragDrop() {
    const t = document.getElementById("dragDropArea");
    ["dragenter", "dragover", "dragleave", "drop"].forEach((e) => {
      t.addEventListener(e, (t) => {
        t.preventDefault(), t.stopPropagation();
      });
    }),
      t.addEventListener("dragenter", () => t.classList.add("dragover")),
      t.addEventListener("dragleave", () => t.classList.remove("dragover")),
      t.addEventListener("drop", (e) => {
        t.classList.remove("dragover"),
          this.handleFileSelect(e.dataTransfer.files);
      });
  }
}

document.addEventListener("DOMContentLoaded", () => new UltimateMusicPlayer());

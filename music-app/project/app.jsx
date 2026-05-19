// Main App. Composes screens, manages state, wires interactions.

const { useState, useEffect, useRef, useCallback } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "terra",
  "dark": false,
  "deviceFrame": true,
  "homeLayout": "classic"
}/*EDITMODE-END*/;

// URL params can override tweak defaults at load time (used by the compare view).
function _readUrlOverrides() {
  try {
    const p = new URLSearchParams(window.location.search);
    const out = {};
    const home = p.get("home");
    if (home === "classic" || home === "bento") out.homeLayout = home;
    const accent = p.get("accent");
    if (accent === "terra" || accent === "sage") out.accent = accent;
    const dark = p.get("dark");
    if (dark === "1" || dark === "true") out.dark = true;
    if (dark === "0" || dark === "false") out.dark = false;
    const frame = p.get("frame");
    if (frame === "0" || frame === "false") out.deviceFrame = false;
    return out;
  } catch (e) { return {}; }
}
const _DEFAULTS_WITH_OVERRIDES = { ...TWEAK_DEFAULTS, ..._readUrlOverrides() };


function App() {
  const [tweaks, setTweaksState] = useTweaks(_DEFAULTS_WITH_OVERRIDES);
  const appRootRef = useRef(null);

  // Navigation stack
  const [stack, setStack] = useState([{ screen: "home" }]);
  const current = stack[stack.length - 1];

  const navTo = (screen, params = {}) => {
    setStack((s) => [...s, { screen, ...params }]);
  };
  const navReplaceTab = (screen) => {
    // Bottom-nav switching resets the stack to just that screen.
    setStack([{ screen }]);
  };
  const navBack = () => {
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  };

  // Tabs (bottom nav main tabs)
  const isMainTab = ["home", "library", "search"].includes(current.screen);
  const activeTab = isMainTab ? current.screen : (stack.find(x => ["home", "library", "search"].includes(x.screen))?.screen || "home");

  // Profile
  const [profileId, setProfileId] = useState("main");
  const profile = PROFILES.find(p => p.id === profileId);

  // Profile switcher state
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [switcherCenter, setSwitcherCenter] = useState(null);
  const [switcherPointer, setSwitcherPointer] = useState(null);
  const longPressTimer = useRef(null);

  const onProfilePress = (center) => {
    // Start long-press timer.
    setSwitcherCenter(center);
    longPressTimer.current = setTimeout(() => {
      setSwitcherOpen(true);
      // start pointer at center so no petal is focused yet
      setSwitcherPointer(center);
    }, 280);
  };
  const onProfileMove = (pt) => {
    if (switcherOpen) setSwitcherPointer(pt);
  };
  const onProfileRelease = () => {
    clearTimeout(longPressTimer.current);
    if (switcherOpen) {
      const focused = window.__profileSwitcherFocused;
      if (focused) {
        setProfileId(focused);
      }
      setSwitcherOpen(false);
      setSwitcherPointer(null);
    }
  };

  // Playback state
  const [currentSong, setCurrentSong] = useState(DAILY_PLAYLISTS[0].songs[0]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0.34);
  const [playerOpen, setPlayerOpen] = useState(false);

  // Simulate playback progress
  useEffect(() => {
    if (!isPlaying || !currentSong) return;
    const id = setInterval(() => {
      setProgress((p) => {
        const next = p + 1 / currentSong.duration;
        if (next >= 1) return 0;
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [isPlaying, currentSong]);

  const playSong = (song) => {
    setCurrentSong(song);
    setIsPlaying(true);
    setProgress(0);
  };
  const playPlaylist = (pl) => {
    if (pl.songs && pl.songs.length) {
      setCurrentSong(pl.songs[0]);
      setIsPlaying(true);
      setProgress(0);
      setPlayerOpen(true);
    }
  };

  // Toast (transient feedback for actions)
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const showToast = (msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1800);
  };

  const onOpenPlaylist = (pl) => navTo("playlist", { playlist: pl });
  const onOpenArtist = (artist) => navTo("artist", { artist });
  const onOpenDeletion = () => navTo("deletion");

  // Profile menu sheet
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  const queueNext = (() => {
    const idx = DAILY_PLAYLISTS[0].songs.findIndex(s => s.id === currentSong?.id);
    if (idx === -1) return ALL_SONGS[0];
    return DAILY_PLAYLISTS[0].songs[idx + 1] || ALL_SONGS[(idx + 1) % ALL_SONGS.length];
  })();

  // Render current screen
  const renderScreen = () => {
    switch (current.screen) {
      case "home":
        return tweaks.homeLayout === "bento"
          ? <HomeBentoScreen profile={profile}
                             onOpenPlaylist={onOpenPlaylist}
                             onOpenArtist={onOpenArtist}
                             onPlaySong={playSong}
                             onOpenProfileMenu={() => setProfileMenuOpen(true)}
                             onShowToast={showToast}/>
          : <HomeScreen profile={profile}
                           onOpenPlaylist={onOpenPlaylist}
                           onOpenArtist={onOpenArtist}
                           onOpenPlayer={() => setPlayerOpen(true)}
                           onPlaySong={playSong}
                           onOpenProfileMenu={() => setProfileMenuOpen(true)}
                           onShowToast={showToast}/>;
      case "library":
        return <LibraryScreen profile={profile}
                              onOpenArtist={onOpenArtist}
                              onPlaySong={playSong}
                              onOpenPlaylist={onOpenPlaylist}
                              onShowToast={showToast}/>;
      case "search":
        return <SearchScreen onPlaySong={playSong} onOpenArtist={onOpenArtist}/>;
      case "history":
        return <HistoryScreen onOpenPlaylist={onOpenPlaylist} onOpenDeletion={onOpenDeletion} onBack={navBack}/>;
      case "settings":
        return <SettingsScreen tweaks={tweaks} setTweak={setTweaksState} onBack={navBack}/>;
      case "playlist":
        return <PlaylistScreen pl={current.playlist} profile={profile}
                               onBack={navBack}
                               onPlay={playPlaylist}
                               onPlaySong={playSong}
                               onOpenArtist={onOpenArtist}
                               onShowToast={showToast}/>;
      case "artist":
        return <ArtistScreen artist={current.artist} onBack={navBack}
                             onPlaySong={playSong} profile={profile}
                             onShowToast={showToast}/>;
      case "deletion":
        return <DeletionScreen onBack={navBack}/>;
      default:
        return null;
    }
  };

  const themeClass = `theme-${tweaks.dark ? "dark" : "light"} accent-${tweaks.accent === "sage" ? "sage" : "terra"}`;

  const appContent = (
    <div ref={appRootRef} className={"app-root " + themeClass}>
      <StatusBar/>
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <div key={stack.map(s => s.screen).join("/")} className="screen screen-enter">
          {renderScreen()}
        </div>
      </div>

      {/* Mini player above bottom nav (hidden when player open) */}
      {currentSong && !playerOpen && (
        <MiniPlayer song={currentSong}
                    isPlaying={isPlaying}
                    onTogglePlay={() => setIsPlaying(!isPlaying)}
                    onOpen={() => setPlayerOpen(true)}
                    progress={progress}/>
      )}

      {/* Bottom nav */}
      <NavBar activeScreen={activeTab}
              onNav={navReplaceTab}
              onProfilePress={onProfilePress}
              onProfileMove={onProfileMove}
              onProfileRelease={onProfileRelease}
              appRootRef={appRootRef}
              profileSwitching={switcherOpen}/>

      {/* Profile menu sheet (Settings / History / Manage) */}
      <ProfileMenu open={profileMenuOpen}
                   onClose={() => setProfileMenuOpen(false)}
                   onNav={(screen) => navTo(screen)}
                   profile={profile}/>

      {/* Toast */}
      <Toast msg={toast}/>

      {/* Profile switcher overlay (radial) */}
      <ProfileSwitcher open={switcherOpen}
                       center={switcherCenter}
                       pointer={switcherPointer}
                       profiles={PROFILES}
                       currentProfileId={profileId}
                       onCancel={onProfileRelease}/>

      {/* Player sheet */}
      {playerOpen && (
        <PlayerScreen song={currentSong} isPlaying={isPlaying}
                      onTogglePlay={() => setIsPlaying(!isPlaying)}
                      onClose={() => setPlayerOpen(false)}
                      profile={profile} progress={progress}
                      queueNext={queueNext}
                      onShowToast={showToast}/>
      )}
    </div>
  );

  // Tweaks panel
  const tweaksPanel = (
    <TweaksPanel title="Tweaks">
      <TweakSection label="Theme">
        <TweakRadio label="Mode"
                    options={["Light", "Dark"]}
                    value={tweaks.dark ? "Dark" : "Light"}
                    onChange={(v) => setTweaksState("dark", v === "Dark")}/>
        <TweakRadio label="Accent"
                    options={["Terracotta", "Sage"]}
                    value={tweaks.accent === "sage" ? "Sage" : "Terracotta"}
                    onChange={(v) => setTweaksState("accent", v === "Sage" ? "sage" : "terra")}/>
      </TweakSection>
      <TweakSection label="Home">
        <TweakRadio label="Layout"
                    options={["Classic", "Bento"]}
                    value={tweaks.homeLayout === "bento" ? "Bento" : "Classic"}
                    onChange={(v) => setTweaksState("homeLayout", v === "Bento" ? "bento" : "classic")}/>
      </TweakSection>
      <TweakSection label="Demo">
        <TweakToggle label="Show device frame" value={tweaks.deviceFrame}
                     onChange={(v) => setTweaksState("deviceFrame", v)}/>
        <TweakButton label="Open profile switcher demo"
                     onClick={() => {
                       const r = appRootRef.current?.getBoundingClientRect();
                       if (!r) return;
                       const center = { x: 412 / 2, y: 892 - 64 };
                       setSwitcherCenter(center);
                       setSwitcherOpen(true);
                       setSwitcherPointer(center);
                     }}/>
        <TweakButton label="Trigger deletion review"
                     onClick={() => { navTo("deletion"); }}/>
      </TweakSection>
    </TweaksPanel>
  );

  return (
    <div style={{
      width: "100vw", height: "100vh",
      display: "flex", alignItems: "center", justifyContent: "center",
      background: tweaks.dark ? "#0e0c0a" : "#2a2520",
      overflow: "hidden",
    }}>
      {tweaks.deviceFrame ? (
        <DeviceWrapper dark={tweaks.dark}>
          {appContent}
        </DeviceWrapper>
      ) : (
        <div style={{ width: 412, height: 892, position: "relative", overflow: "hidden",
                      borderRadius: 18, boxShadow: "0 30px 80px rgba(0,0,0,0.4)" }}>
          {appContent}
        </div>
      )}
      {tweaksPanel}
    </div>
  );
}

// Device wrapper — uses Android frame with our custom status bar built in.
function DeviceWrapper({ children, dark }) {
  return (
    <div style={{
      width: 412, height: 892,
      borderRadius: 36, overflow: "hidden",
      background: dark ? "#0a0807" : "#1a1714",
      padding: 8,
      border: `1px solid ${dark ? "#1a1714" : "#3a322a"}`,
      boxShadow: "0 40px 120px rgba(0,0,0,0.45), 0 6px 18px rgba(0,0,0,0.2)",
      position: "relative",
    }}>
      <div style={{
        width: "100%", height: "100%",
        borderRadius: 28, overflow: "hidden",
        position: "relative",
        background: "var(--bg)",
      }}>
        {/* Camera punch-hole */}
        <div style={{
          position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)",
          width: 12, height: 12, borderRadius: "50%",
          background: "#0a0807",
          zIndex: 200,
        }}/>
        {children}
        {/* Bottom gesture pill */}
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0,
          height: 0, pointerEvents: "none", zIndex: 200,
        }}/>
      </div>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);

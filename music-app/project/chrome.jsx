// Bottom navigation + status bar + mini-player.

function StatusBar() {
  return (
    <div className="statusbar">
      <span>9:41</span>
      <div style={{ row: true, display: "flex", alignItems: "center", gap: 6 }}>
        <svg width="14" height="10" viewBox="0 0 14 10" fill="none">
          <path d="M0 9 L4 9 M3 7 L7 7 M6 4 L10 4 M9 1 L13 1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
        </svg>
        <svg width="14" height="10" viewBox="0 0 14 10" fill="currentColor">
          <path d="M1 1h12v8H1z" stroke="currentColor" strokeWidth="1" fill="none" />
          <rect x="2" y="2" width="9" height="6" />
        </svg>
      </div>
    </div>
  );
}

function NavBar({ activeScreen, onNav, onProfilePress, onProfileRelease, onProfileMove, appRootRef, profileSwitching }) {
  const homeBtnRef = React.useRef(null);

  // Translate viewport coords → app-root coords so the radial overlay (positioned
  // inside app-root) lines up correctly even when the device frame is centered
  // somewhere else on screen.
  const toLocal = (cx, cy) => {
    const r = appRootRef?.current?.getBoundingClientRect();
    if (!r) return { x: cx, y: cy };
    return { x: cx - r.left, y: cy - r.top };
  };

  const onPointerDown = (e) => {
    e.preventDefault();
    homeBtnRef.current?.setPointerCapture?.(e.pointerId);
    const rect = homeBtnRef.current.getBoundingClientRect();
    const c = toLocal(rect.left + rect.width / 2, rect.top + rect.height / 2);
    onProfilePress(c);
  };
  const onPointerMove = (e) => {
    if (!profileSwitching) return;
    onProfileMove(toLocal(e.clientX, e.clientY));
  };
  const onPointerUp = () => onProfileRelease();

  return (
    <div className="bottom-nav">
      <NavItem icon={I.search} label="Search" active={activeScreen === "search"}
               onClick={() => onNav("search")} />
      {/* Center home button: tap to go home, long-press to open radial profile switcher */}
      <div style={{ flex: 1.2, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <button
          ref={homeBtnRef}
          className={"home-btn-shell tap" + (profileSwitching ? " pressing" : "")}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClick={(e) => { if (!profileSwitching) onNav("home"); }}
          aria-label="Home — hold to switch profile"
          style={{ touchAction: "none" }}
        >
          <span className="home-btn-ring" />
          {activeScreen === "home" ? <I.home size={26} stroke={2}/> : <I.home size={24} stroke={1.8}/>}
        </button>
      </div>
      <NavItem icon={I.library} label="Library" active={activeScreen === "library"}
               onClick={() => onNav("library")} />
    </div>
  );
}

function NavItem({ icon: Icon, label, active, onClick }) {
  return (
    <button className={"nav-btn tap" + (active ? " active" : "")} onClick={onClick}>
      <Icon size={22} stroke={active ? 1.9 : 1.6} />
      <span className="nav-btn-label">{label}</span>
    </button>
  );
}

// Deterministic waveform shape per song (so each track has a recognisable wave).
function generateWaveform(seed = 0, bars = 56) {
  // Mulberry32-ish for determinism.
  let s = (seed * 2654435761) >>> 0;
  const rnd = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [];
  // Smoothed: each bar is a moving average of three random samples so heights
  // flow rather than spike. Floor at 0.4 so no bar collapses to a sliver.
  const raw = Array.from({ length: bars }, () => rnd());
  for (let i = 0; i < bars; i++) {
    const a = raw[i];
    const b = raw[(i + 1) % bars];
    const c = raw[(i + 2) % bars];
    const v = (a + b + c) / 3;
    const env = 0.55 + 0.45 * Math.sin((i / bars) * Math.PI);
    out.push(0.4 + 0.6 * v * env);
  }
  return out;
}

function Waveform({ seed, progress, isPlaying, height = 22, density = 38, barWidth = 2, gap = 2 }) {
  const bars = React.useMemo(() => generateWaveform(seed, density), [seed, density]);
  const playedIdx = Math.floor(bars.length * progress);
  const w = density * barWidth + (density - 1) * gap;
  const h = height;

  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none"
         style={{ display: "block" }}>
      {bars.map((v, i) => {
        const played = i < playedIdx;
        const cursor = i === playedIdx;
        const bh = Math.max(2, Math.round(v * h));
        const x = i * (barWidth + gap);
        const y = (h - bh) / 2;
        return (
          <rect key={i}
                x={x} y={y}
                width={barWidth} height={bh}
                rx={barWidth / 2}
                fill={played || cursor ? "var(--accent)" : "var(--fg-soft)"}
                opacity={cursor ? 1 : played ? 0.9 : 0.3}/>
        );
      })}
    </svg>
  );
}

function MiniPlayer({ song, isPlaying, onTogglePlay, onOpen, progress }) {
  if (!song) return null;

  // Layout that breathes a bit more — taller, larger touch targets.
  const height = 72;
  const coverSize = 52;
  const playBtn = 44;

  return (
    <div className="mini-player tap" onClick={onOpen}
         data-mini-anchor="true"
         style={{
           height,
           padding: "10px 12px 10px 10px",
           gap: 14,
         }}>
      <CoverArt spec={song.cover} size={coverSize} title={song.title} artist={song.artist}/>
      <div style={{ flex: 1, minWidth: 0,
                    display: "flex", flexDirection: "column",
                    justifyContent: "center", gap: 5 }}>
        <div style={{
          fontSize: 14,
          fontWeight: 600, color: "var(--fg-strong)",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          letterSpacing: "-0.005em",
          lineHeight: 1.2,
        }}>{song.title}</div>
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          color: "var(--fg-muted)", fontSize: 11,
        }}>
          <span style={{
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            flexShrink: 0, maxWidth: "40%",
          }}>{song.artist}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Waveform seed={song.cover.seed + (song.title?.length || 0)}
                      progress={progress}
                      isPlaying={isPlaying}
                      height={22}
                      density={54}
                      barWidth={1.5}
                      gap={1.5}/>
          </div>
        </div>
      </div>
      <button className="tap" onClick={(e) => { e.stopPropagation(); onTogglePlay(); }}
              style={{
                width: playBtn, height: playBtn,
                borderRadius: "50%",
                background: "var(--accent)",
                color: "var(--on-accent)",
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: "0 2px 6px color-mix(in oklab, var(--accent) 35%, transparent)",
                flexShrink: 0,
              }}>
        {isPlaying ? <I.pause size={18}/> : <I.play size={18}/>}
      </button>
    </div>
  );
}

Object.assign(window, { StatusBar, NavBar, MiniPlayer, Waveform, generateWaveform });

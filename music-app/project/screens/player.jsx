// Full-sheet Now Playing screen. Album art prominent, controls below.
// Includes "Stay in profile / full library" toggle and skip/listen meaning hints.

function PlayerScreen({ song, isPlaying, onTogglePlay, onClose, profile, progress, onSeek, queueNext, onShowToast }) {
  const [liked, setLiked] = React.useState(false);
  const [stayInProfile, setStayInProfile] = React.useState(true);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [closing, setClosing] = React.useState(false);

  const handleClose = () => {
    setClosing(true);
    setTimeout(() => { onClose(); }, 280);
  };

  if (!song) return null;
  const elapsed = Math.floor(progress * song.duration);

  return (
    <div className={"sheet sheet-morph" + (closing ? " sheet-closing" : "")}>
      {/* Top bar */}
      <StatusBar/>
      <div className="top-bar">
        <button className="tap" onClick={handleClose}
                style={{ width: 38, height: 38, display: "flex", alignItems: "center", justifyContent: "center",
                         color: "var(--fg-strong)" }}>
          <I.chevronDown size={24}/>
        </button>
        <div style={{ textAlign: "center" }}>
          <div className="label" style={{ marginBottom: 2 }}>Playing from</div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{profile.name}</div>
        </div>
        <button className="tap" onClick={() => setMenuOpen(true)}
                style={{ width: 38, height: 38, display: "flex", alignItems: "center", justifyContent: "center",
                         color: "var(--fg-strong)" }}>
          <I.dots size={22}/>
        </button>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column",
                    padding: "20px 28px 24px", justifyContent: "space-between" }}>
        {/* Cover */}
        <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 24px" }}>
          <CoverArt spec={song.cover} size={300} title={song.title} artist={song.artist}
                    style={{ borderRadius: 16, boxShadow: "0 16px 48px rgba(40,25,15,0.22)" }}/>
        </div>

        {/* Title + artist */}
        <div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.015em", color: "var(--fg-strong)",
                            lineHeight: 1.2 }}>{song.title}</div>
              <div style={{ fontSize: 14.5, color: "var(--fg-muted)", marginTop: 5 }}>{song.artist}</div>
            </div>
            <button className="tap" onClick={() => setLiked(!liked)}
                    style={{ width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center",
                             color: liked ? "var(--accent)" : "var(--fg-muted)" }}>
              {liked ? <I.heartFill size={24}/> : <I.heart size={24}/>}
            </button>
          </div>

          {/* Progress bar */}
          <div style={{ marginTop: 22 }}>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${progress * 100}%`, background: "var(--accent)" }}/>
              <div style={{
                position: "absolute",
                left: `${progress * 100}%`,
                top: "50%",
                transform: "translate(-50%, -50%)",
                width: 12, height: 12, borderRadius: "50%",
                background: "var(--accent)",
                boxShadow: "0 1px 4px color-mix(in oklab, var(--accent) 35%, transparent)",
              }}/>
            </div>
            <div className="mono" style={{ display: "flex", justifyContent: "space-between",
                                           fontSize: 11.5, color: "var(--fg-soft)", marginTop: 8,
                                           letterSpacing: "0.04em" }}>
              <span>{fmtTime(elapsed)}</span>
              <span>−{fmtTime(song.duration - elapsed)}</span>
            </div>
          </div>

          {/* Controls */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 18 }}>
            <button className="tap" style={{ color: "var(--fg-muted)" }}><I.shuffle size={22}/></button>
            <button className="tap" style={{ color: "var(--fg-strong)" }}><I.prev size={30}/></button>
            <button className="tap" onClick={onTogglePlay}
                    style={{
                      width: 68, height: 68, borderRadius: "50%",
                      background: "var(--fg-strong)", color: "var(--bg)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      boxShadow: "0 8px 24px rgba(40,25,15,0.2)",
                    }}>
              {isPlaying ? <I.pause size={28}/> : <I.play size={28}/>}
            </button>
            <button className="tap" style={{ color: "var(--fg-strong)" }}><I.skip size={30}/></button>
            <button className="tap" style={{ color: "var(--fg-muted)" }}><I.repeat size={22}/></button>
          </div>

          {/* Profile / Library scope toggle */}
          <div style={{
            marginTop: 22,
            padding: "11px 14px",
            background: "var(--bg-elev)",
            border: "1px solid var(--border-soft)",
            borderRadius: 100,
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <I.radio size={18} stroke={1.6}/>
            <div style={{ flex: 1, fontSize: 12.5, color: "var(--fg-muted)", lineHeight: 1.3 }}>
              Auto-radio: <b style={{ color: "var(--fg-strong)", fontWeight: 600 }}>{stayInProfile ? profile.name : "Full library"}</b>
            </div>
            <button className="tap" onClick={() => setStayInProfile(!stayInProfile)}
                    style={{
                      padding: "6px 12px", borderRadius: 100,
                      background: stayInProfile ? "var(--accent)" : "var(--surface)",
                      color: stayInProfile ? "var(--on-accent)" : "var(--fg-strong)",
                      border: `1px solid ${stayInProfile ? "var(--accent)" : "var(--border)"}`,
                      fontSize: 11.5, fontWeight: 600,
                      letterSpacing: "-0.005em",
                    }}>
              {stayInProfile ? "Stay" : "Open"}
            </button>
          </div>

          {/* Up next preview */}
          {queueNext && (
            <div style={{
              marginTop: 14,
              padding: "10px 12px",
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <CoverArt spec={queueNext.cover} size={34}/>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="label" style={{ fontSize: 9.5, marginBottom: 1 }}>Up next</div>
                <div style={{ fontSize: 12.5, color: "var(--fg-strong)", fontWeight: 500,
                              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {queueNext.title} · <span style={{ color: "var(--fg-muted)" }}>{queueNext.artist}</span>
                </div>
              </div>
              <I.list size={18} stroke={1.6}/>
            </div>
          )}
        </div>
      </div>
      <ActionSheet open={menuOpen} onClose={() => setMenuOpen(false)} title={song.title}
                   actions={[
                     { label: "Add to playlist", icon: <I.plus size={20}/>, run: () => onShowToast?.("Added to playlist") },
                     { label: "Assign to profile", icon: <I.refresh size={20}/>, run: () => onShowToast?.("Reassigned") },
                     { label: "Go to artist", icon: <I.artist size={20}/>, run: () => onShowToast?.(`Opening ${song.artist}`) },
                     { label: "Sleep timer", icon: <I.clock size={20}/>, run: () => onShowToast?.("Sleep timer") },
                   ]}/>
    </div>
  );
}

Object.assign(window, { PlayerScreen });

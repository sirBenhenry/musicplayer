// Daily playlist detail screen.
// Shows the songs, with "Pause to Tomorrow", "Generate for another profile", etc.

function PlaylistScreen({ pl, profile, onBack, onPlay, onPlaySong, onOpenArtist, onShowToast }) {
  const [paused, setPaused] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const isDaily = !!pl.isDaily;

  return (
    <div className="scroll" style={{ paddingBottom: 160 }}>
      {/* Header bar */}
      <div className="top-bar">
        <button className="tap" onClick={onBack}
                style={{ width: 38, height: 38, display: "flex", alignItems: "center", justifyContent: "center",
                         color: "var(--fg-strong)" }}>
          <I.arrowLeft size={22}/>
        </button>
        <button className="tap" onClick={() => setMenuOpen(true)}
                style={{ width: 38, height: 38, display: "flex", alignItems: "center", justifyContent: "center",
                         color: "var(--fg-strong)" }}>
          <I.dots size={22}/>
        </button>
      </div>

      {/* Hero */}
      <div style={{ padding: "12px 20px 24px", textAlign: "center" }}>
        <div style={{ display: "inline-block", marginBottom: 18 }}>
          <CoverArt spec={pl.cover} size={208} title={pl.title}
                    style={{ borderRadius: 14, boxShadow: "0 8px 32px rgba(40,25,15,0.18)" }}/>
        </div>
        <div className="label" style={{ marginBottom: 8 }}>
          {isDaily ? `Daily · ${pl.accent || pl.title}` : "Playlist"}
        </div>
        <div className="serif" style={{ fontSize: 32, lineHeight: 1.05, color: "var(--fg-strong)", marginBottom: 6 }}>
          {pl.title}
        </div>
        <div style={{ fontSize: 13.5, color: "var(--fg-muted)", maxWidth: 320, margin: "0 auto" }}>
          {pl.subtitle}
        </div>
        <div className="mono" style={{ fontSize: 11.5, color: "var(--fg-soft)", marginTop: 14,
                                       letterSpacing: "0.08em", textTransform: "uppercase" }}>
          {pl.songCount} songs · {pl.duration} · From {profile.name}
        </div>
      </div>

      {/* Action row */}
      <div style={{ padding: "0 20px 18px", display: "flex", gap: 10, alignItems: "center" }}>
        <button className="btn btn-primary tap" style={{ flex: 1 }} onClick={() => onPlay(pl)}>
          <I.play size={18}/> Play
        </button>
        <button className="btn btn-ghost tap" style={{ width: 48, padding: 0, height: 44 }}
                onClick={() => onShowToast("Shuffling")}>
          <I.shuffle size={18}/>
        </button>
        <button className="btn btn-ghost tap" style={{ width: 48, padding: 0, height: 44 }}
                onClick={() => onShowToast("Downloading for offline")}>
          <I.download size={18}/>
        </button>
      </div>

      {/* Behavior hints — explains how this playlist works */}
      {isDaily && (
        <div style={{ padding: "0 20px 16px" }}>
          <div style={{
            background: "var(--bg-elev)",
            border: "1px solid var(--border-soft)",
            borderRadius: 12,
            padding: "12px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <I.check size={16} stroke={2}/>
              <div style={{ fontSize: 12.5, color: "var(--fg-muted)", lineHeight: 1.4 }}>
                <b style={{ color: "var(--fg-strong)", fontWeight: 600 }}>Listen through</b> a song to save it to your library.
              </div>
            </div>
            <div style={{ height: 1, background: "var(--border-soft)" }}/>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <I.skip size={16} stroke={2}/>
              <div style={{ fontSize: 12.5, color: "var(--fg-muted)", lineHeight: 1.4 }}>
                <b style={{ color: "var(--fg-strong)", fontWeight: 600 }}>Skip</b> to mark for deletion at end of day.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Songs */}
      <div style={{ padding: "0 0 8px" }}>
        {pl.songs.map((s, i) => (
          <SongRow key={s.id} song={s} idx={i} onPlay={() => onPlaySong(s)}
                   onMore={() => onShowToast(`Options for “${s.title}”`)}/>
        ))}
      </div>

      {/* Pause to tomorrow */}
      {isDaily && (
        <div style={{ padding: "16px 20px 0" }}>
          <button className="tap" onClick={() => setPaused(!paused)}
                  style={{
                    width: "100%",
                    padding: "14px 16px",
                    borderRadius: 12,
                    background: paused ? "var(--accent-bg)" : "var(--bg-elev)",
                    border: `1px solid ${paused ? "color-mix(in oklab, var(--accent) 30%, transparent)" : "var(--border-soft)"}`,
                    display: "flex", alignItems: "center", gap: 12,
                    color: paused ? "var(--accent)" : "var(--fg-strong)",
                  }}>
            <I.pauseTomorrow size={20}/>
            <div style={{ flex: 1, textAlign: "left" }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>
                {paused ? "Paused — saved for tomorrow" : "Pause to tomorrow"}
              </div>
              <div style={{ fontSize: 12, color: paused ? "var(--accent)" : "var(--fg-muted)", marginTop: 1, opacity: paused ? 0.75 : 1 }}>
                {paused ? "Won't be replaced until you listen." : "Don't have time? Keep it for tomorrow."}
              </div>
            </div>
            <div className={"toggle" + (paused ? " on" : "")}>
              <div className="toggle-thumb"/>
            </div>
          </button>
        </div>
      )}
      {/* Playlist action sheet */}
      <ActionSheet open={menuOpen} onClose={() => setMenuOpen(false)} title={pl.title}
                   actions={isDaily ? [
                     { label: "Generate for another profile", icon: <I.refresh size={20}/>, run: () => onShowToast("Generate for another profile") },
                     { label: "Pause to tomorrow", icon: <I.pauseTomorrow size={20}/>, run: () => { setPaused(true); } },
                     { label: "View artists in this list", icon: <I.artist size={20}/>, run: () => onShowToast("View artists") },
                   ] : [
                     { label: "Rename playlist", icon: <I.cassette size={20}/>, run: () => onShowToast("Rename") },
                     { label: "Add to taste profile", icon: <I.plus size={20}/>, run: () => onShowToast("Add to profile") },
                     { label: "Download for offline", icon: <I.download size={20}/>, run: () => onShowToast("Downloading") },
                     { label: "Delete playlist", icon: <I.trash size={20}/>, run: () => onShowToast("Deleted"), danger: true },
                   ]}/>
    </div>
  );
}

Object.assign(window, { PlaylistScreen });

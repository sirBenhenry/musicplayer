// Artist page.

function ArtistScreen({ artist, onBack, onPlaySong, profile, onShowToast }) {
  const [following, setFollowing] = React.useState(artist.followed);
  const [menuOpen, setMenuOpen] = React.useState(false);
  // Pick songs that belong to this artist (generate some)
  const songs = Array.from({ length: artist.songs > 10 ? 10 : artist.songs }, (_, i) =>
    mkSong(i + 50, { artist: artist.name, id: `${artist.id}-s${i}` })
  );

  return (
    <div className="scroll" style={{ paddingBottom: 160 }}>
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
      <div style={{ padding: "8px 20px 28px", textAlign: "center" }}>
        <CoverArt spec={artist.photo} size={144} title={artist.name} artist={artist.name}
                  style={{ borderRadius: "50%", margin: "0 auto", boxShadow: "0 8px 32px rgba(40,25,15,0.18)" }}/>
        <div className="label" style={{ marginTop: 18, marginBottom: 6 }}>Artist</div>
        <div className="serif" style={{ fontSize: 32, lineHeight: 1.05, color: "var(--fg-strong)" }}>
          {artist.name}
        </div>
        <div style={{ fontSize: 13, color: "var(--fg-muted)", marginTop: 6,
                      fontFamily: '"Geist Mono", monospace', letterSpacing: "0.04em" }}>
          {artist.songs} SONGS · IN {profile.name.toUpperCase()}
        </div>

        {/* New release banner */}
        {artist.newRelease && (
          <div style={{
            marginTop: 18,
            display: "inline-flex",
            alignItems: "center", gap: 8,
            padding: "8px 14px",
            borderRadius: 100,
            background: "var(--accent-bg)",
            color: "var(--accent)",
            fontSize: 12.5, fontWeight: 600,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)" }}/>
            New release · 2 days ago
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ padding: "0 20px 20px", display: "flex", gap: 10 }}>
        <button className="btn btn-primary tap" style={{ flex: 1 }}
                onClick={() => onPlaySong(songs[0])}>
          <I.play size={18}/> Play
        </button>
        <button className="btn btn-ghost tap" style={{ flex: 1 }}
                onClick={() => setFollowing(!following)}>
          {following ? <><I.check size={16}/> Following</> : <><I.plus size={16}/> Follow</>}
        </button>
      </div>

      {/* Followed = auto library notice */}
      {following && (
        <div style={{ padding: "0 20px 20px" }}>
          <div style={{
            background: "var(--bg-elev)",
            border: "1px solid var(--border-soft)",
            borderRadius: 12,
            padding: "11px 14px",
            display: "flex", gap: 10, alignItems: "center",
          }}>
            <I.sparkle size={18} stroke={1.6}/>
            <div style={{ fontSize: 12.5, color: "var(--fg-muted)", lineHeight: 1.4 }}>
              New releases from <b style={{ color: "var(--fg-strong)", fontWeight: 600 }}>{artist.name}</b> are automatically added to your library.
            </div>
          </div>
        </div>
      )}

      {/* Top tracks */}
      <div className="section-head">
        <div className="section-title">Songs</div>
        <span className="section-meta">{songs.length}</span>
      </div>
      <div>
        {songs.map((s, i) => (
          <SongRow key={s.id} song={s} idx={i} onPlay={() => onPlaySong(s)}
                   onMore={() => onShowToast(`Options for “${s.title}”`)}/>
        ))}
      </div>

      <ActionSheet open={menuOpen} onClose={() => setMenuOpen(false)} title={artist.name}
                   actions={[
                     { label: following ? "Unfollow" : "Follow artist", icon: following ? <I.check size={20}/> : <I.plus size={20}/>,
                       run: () => setFollowing(!following) },
                     { label: "Add all songs to playlist", icon: <I.cassette size={20}/>, run: () => onShowToast("Added to playlist") },
                     { label: "Assign artist to profile", icon: <I.refresh size={20}/>, run: () => onShowToast("Profile assigned") },
                   ]}/>
    </div>
  );
}

Object.assign(window, { ArtistScreen });

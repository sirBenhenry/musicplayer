// Library screen — songs / artists / albums / playlists tabs.

function LibraryScreen({ profile, onOpenArtist, onPlaySong, onOpenPlaylist, onShowToast }) {
  const [tab, setTab] = React.useState("songs");
  const [songMenu, setSongMenu] = React.useState(null);
  const tabs = [
    { id: "songs",     label: "Songs",     count: ALL_SONGS.length },
    { id: "artists",   label: "Artists",   count: ARTISTS.length },
    { id: "albums",    label: "Albums",    count: ALBUMS.length },
    { id: "playlists", label: "Playlists", count: CUSTOM_PLAYLISTS.length },
  ];
  const [filterProfile, setFilterProfile] = React.useState(false);

  return (
    <div className="scroll" style={{ paddingBottom: 160 }}>
      <div className="top-bar" style={{ paddingTop: 10 }}>
        <div>
          <div className="label" style={{ marginBottom: 4 }}>Library</div>
          <div className="serif" style={{ fontSize: 30, lineHeight: 1.05, color: "var(--fg-strong)" }}>
            Your collection
          </div>
        </div>
        <button className="tap" onClick={() => onShowToast("New playlist")}
                style={{ width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center",
                         color: "var(--fg-strong)" }}>
          <I.plus size={22}/>
        </button>
      </div>

      {/* Tabs */}
      <div style={{ padding: "10px 16px 8px", display: "flex", gap: 6, overflowX: "auto", scrollbarWidth: "none" }}>
        {tabs.map((t) => (
          <button key={t.id}
                  className="tap"
                  onClick={() => setTab(t.id)}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 100,
                    background: tab === t.id ? "var(--fg-strong)" : "transparent",
                    color: tab === t.id ? "var(--bg)" : "var(--fg-muted)",
                    fontSize: 13.5, fontWeight: 500,
                    border: tab === t.id ? "none" : "1px solid var(--border)",
                    whiteSpace: "nowrap",
                  }}>
            {t.label} <span style={{ opacity: 0.6, marginLeft: 4 }}>{t.count}</span>
          </button>
        ))}
      </div>

      {/* Profile filter row */}
      <div style={{ padding: "6px 20px 18px", display: "flex", alignItems: "center", gap: 10 }}>
        <button className="tap"
                onClick={() => setFilterProfile(!filterProfile)}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "6px 11px", borderRadius: 100,
                  background: filterProfile ? "var(--accent-bg)" : "transparent",
                  color: filterProfile ? "var(--accent)" : "var(--fg-muted)",
                  border: `1px solid ${filterProfile ? "color-mix(in oklab, var(--accent) 30%, transparent)" : "var(--border)"}`,
                  fontSize: 12.5,
                  fontWeight: 500,
                }}>
          <I.filter size={14}/>
          {filterProfile ? profile.name + " only" : "All profiles"}
        </button>
        <div style={{ flex: 1 }}/>
        <button className="tap" style={{ color: "var(--fg-muted)", display: "flex", alignItems: "center", gap: 4, fontSize: 12.5 }}>
          Recently added <I.chevronDown size={14}/>
        </button>
      </div>

      {/* Content */}
      {tab === "songs" && (
        <div>
          {ALL_SONGS.slice(0, 18).map((s) => (
            <SongRow key={s.id} song={s} onPlay={() => onPlaySong(s)}
                     onMore={() => setSongMenu(s)}/>
          ))}
        </div>
      )}

      {tab === "artists" && (
        <div style={{ padding: "0 4px" }}>
          {ARTISTS.map((a) => (
            <div key={a.id} className="tap song-row" onClick={() => onOpenArtist(a)}>
              <CoverArt spec={a.photo} size={48} title={a.name} artist={a.name}
                        style={{ borderRadius: "50%" }}/>
              <div style={{ flex: 1 }}>
                <div className="song-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {a.name}
                  {a.newRelease && (
                    <span style={{
                      width: 6, height: 6, borderRadius: "50%",
                      background: "var(--accent)",
                    }}/>
                  )}
                </div>
                <div className="song-artist">
                  {a.songs} songs {a.followed && <span>· Following</span>}
                </div>
              </div>
              <I.chevronRight size={18}/>
            </div>
          ))}
        </div>
      )}

      {tab === "albums" && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 14,
          padding: "0 20px",
        }}>
          {ALBUMS.map((al) => (
            <div key={al.id} className="tap">
              <CoverArt spec={al.cover} size={172} title={al.title} artist={al.artist}
                        style={{ width: "100%", height: "auto", aspectRatio: "1/1" }}/>
              <div style={{ marginTop: 10, fontSize: 14, fontWeight: 600, color: "var(--fg-strong)",
                            lineHeight: 1.25, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {al.title}
              </div>
              <div style={{ fontSize: 12, color: "var(--fg-muted)", marginTop: 2,
                            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {al.artist} · {al.year}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "playlists" && (
        <div>
          <button className="tap song-row" onClick={() => onShowToast("New playlist")}
                  style={{ width: "100%", textAlign: "left" }}>
            <div style={{
              width: 48, height: 48, borderRadius: 10,
              background: "var(--bg-elev)",
              border: "1px dashed var(--border-strong)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "var(--fg-muted)",
            }}>
              <I.plus size={20}/>
            </div>
            <div className="song-title" style={{ flex: 1 }}>New playlist</div>
          </button>
          {CUSTOM_PLAYLISTS.map((pl) => (
            <div key={pl.id} className="tap song-row"
                 onClick={() => onOpenPlaylist({ ...pl, songs: ALL_SONGS.slice(0, pl.songs > 12 ? 12 : pl.songs),
                                                 subtitle: `${pl.songs} songs`, songCount: pl.songs,
                                                 duration: `${Math.round(pl.songs * 3.4)} min`, accent: "Custom playlist" })}>
              <CoverArt spec={pl.cover} size={48} title={pl.title}/>
              <div style={{ flex: 1 }}>
                <div className="song-title">{pl.title}</div>
                <div className="song-artist">{pl.songs} songs</div>
              </div>
              <I.chevronRight size={18}/>
            </div>
          ))}
        </div>
      )}
      <ActionSheet open={!!songMenu} onClose={() => setSongMenu(null)} title={songMenu?.title}
                   actions={songMenu ? [
                     { label: "Add to playlist", icon: <I.plus size={20}/>, run: () => onShowToast("Added to playlist") },
                     { label: "Assign to taste profile", icon: <I.refresh size={20}/>, run: () => onShowToast("Reassigned") },
                     { label: "Go to artist", icon: <I.artist size={20}/>, run: () => { const a = ARTISTS.find(x => x.name === songMenu.artist) || ARTISTS[0]; onOpenArtist(a); } },
                     { label: "Remove from library", icon: <I.trash size={20}/>, run: () => onShowToast("Removed"), danger: true },
                   ] : []}/>
    </div>
  );
}

Object.assign(window, { LibraryScreen });

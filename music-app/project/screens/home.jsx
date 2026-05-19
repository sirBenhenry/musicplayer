// Home screen (V2) — calmer, fewer elements, more breathing room.
// Goal: keep the daily-discovery as the unmistakable focal point; let everything else recede.

function HomeScreen({ profile, onOpenPlaylist, onOpenArtist, onOpenPlayer, onPlaySong, onOpenProfileMenu, onShowToast }) {
  const now = new Date();
  const h = now.getHours();
  const greeting =
    h < 5 ? "Late night" :
    h < 12 ? "Good morning" :
    h < 17 ? "Good afternoon" :
    h < 21 ? "Good evening" :
              "Late evening";
  const period =
    h < 5 ? "night" :
    h < 12 ? "morning" :
    h < 17 ? "afternoon" :
    h < 21 ? "evening" :
              "night";
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });

  const close = DAILY_PLAYLISTS.find(p => p.slot === "close");
  const artist = DAILY_PLAYLISTS.find(p => p.slot === "artist");
  const broader = DAILY_PLAYLISTS.find(p => p.slot === "broader");
  const genre = DAILY_PLAYLISTS.find(p => p.slot === "genre");
  const newReleases = ARTISTS.filter(a => a.newRelease);

  // Show only a handful of playlists on home; the rest live in Library.
  const visiblePlaylists = CUSTOM_PLAYLISTS.slice(0, 4);

  return (
    <div className="scroll" style={{ paddingBottom: 160 }}>
      {/* Header — prominent greeting with quiet profile chip on the right */}
      <div style={{ padding: "14px 20px 4px", display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div className="label">{greeting.toUpperCase()}</div>
        <button className="tap" onClick={onOpenProfileMenu}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "5px 11px 5px 5px",
            background: "transparent",
            borderRadius: 100,
            color: "var(--fg-muted)",
            marginTop: -4,
          }}>
          <div style={{
            width: 22, height: 22, borderRadius: "50%",
            background: `oklch(70% 0.08 ${profile.hue})`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: '"Instrument Serif", serif', fontSize: 13, lineHeight: 1,
            color: "var(--bg)",
            flexShrink: 0,
          }}>{profile.glyph}</div>
          <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--fg-strong)" }}>{profile.name}</span>
          <I.chevronDown size={14}/>
        </button>
      </div>

      <div style={{ padding: "0 20px 22px" }}>
        <div className="serif" style={{ fontSize: 30, lineHeight: 1.05, color: "var(--fg-strong)", letterSpacing: "-0.015em" }}>
          {weekday} <span style={{ color: "var(--fg-muted)" }}>{period}</span>
        </div>
      </div>

      {/* New release — visible but not loud. Inline strip with avatar + accent dot. */}
      {newReleases.length > 0 && (
        <div style={{ padding: "0 20px 22px" }}>
          <button className="tap" onClick={() => onOpenArtist(newReleases[0])}
                  style={{
                    width: "100%",
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "10px 14px 10px 10px",
                    background: "var(--bg-elev)",
                    border: "1px solid var(--border-soft)",
                    borderRadius: 12,
                    textAlign: "left",
                  }}>
            <CoverArt spec={newReleases[0].photo} size={36}
                      title={newReleases[0].name} artist={newReleases[0].name}
                      style={{ borderRadius: "50%", flexShrink: 0 }}/>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)" }}/>
                <span className="label" style={{ color: "var(--accent)", fontSize: 9.5 }}>New release</span>
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--fg-strong)",
                            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {newReleases[0].name}
              </div>
            </div>
            <I.chevronRight size={16}/>
          </button>
        </div>
      )}

      {/* Today — quiet display heading */}
      <div style={{ padding: "0 20px 14px" }}>
        <div className="label">Today</div>
      </div>

      {/* Hero — Close Match. Cleaner: no meta row, no Refreshes-in. */}
      <div style={{ padding: "0 20px 12px" }}>
        <DailyHeroCard pl={close} onOpen={() => onOpenPlaylist(close)} onPlay={() => { onPlaySong(close.songs[0]); }}/>
      </div>

      {/* Artist of the Day — quieter, no accent bubble. */}
      <div style={{ padding: "0 20px 12px" }}>
        <ArtistOfDayCard pl={artist} onOpen={() => onOpenPlaylist(artist)}/>
      </div>

      {/* Broader + Genre — compact pair */}
      <div style={{ padding: "0 20px 32px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <DailySmallCard pl={broader} onOpen={() => onOpenPlaylist(broader)}/>
        <DailySmallCard pl={genre}   onOpen={() => onOpenPlaylist(genre)}/>
      </div>

      {/* Your playlists — quieter section */}
      <div style={{ padding: "0 20px 14px", display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--fg-strong)" }}>Your playlists</div>
        <button className="tap" style={{ fontSize: 12, color: "var(--fg-muted)" }}>
          See all
        </button>
      </div>
      <div style={{ display: "flex", gap: 14, overflowX: "auto", padding: "0 20px 12px",
                    scrollbarWidth: "none" }}>
        {visiblePlaylists.map((pl) => (
          <div key={pl.id} className="tap" style={{ flexShrink: 0, width: 116 }}>
            <CoverArt spec={pl.cover} size={116} title={pl.title}/>
            <div style={{ marginTop: 8, fontSize: 13, fontWeight: 500, color: "var(--fg-strong)",
                          lineHeight: 1.25, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{pl.title}</div>
            <div style={{ fontSize: 11.5, color: "var(--fg-soft)", marginTop: 2 }}>{pl.songs} songs</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DailyHeroCard({ pl, onOpen, onPlay }) {
  return (
    <div className="card tap" onClick={onOpen}
         style={{ padding: 0, overflow: "hidden", border: "1px solid var(--border-soft)" }}>
      <div style={{ position: "relative", height: 188 }}>
        <div style={{ position: "absolute", inset: 0 }}>
          <CoverArt spec={pl.cover} size={372} title={pl.title}
                    style={{ width: "100%", height: "100%", borderRadius: 0 }}/>
        </div>
        <div style={{
          position: "absolute", inset: 0,
          background: "linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.55) 100%)",
        }}/>
        <div style={{ position: "absolute", top: 16, left: 16, color: "#fff" }}>
          <div className="label" style={{ color: "rgba(255,255,255,0.85)" }}>Close match</div>
        </div>
        <div style={{ position: "absolute", left: 16, right: 16, bottom: 16, color: "#fff",
                      display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 14 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="serif" style={{ fontSize: 28, lineHeight: 1.05, letterSpacing: "-0.015em" }}>{pl.title}</div>
          </div>
          <button className="tap" onClick={(e) => { e.stopPropagation(); onPlay(); }}
                  style={{
                    width: 46, height: 46, borderRadius: "50%",
                    background: "#fff", color: "#1f1a14",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
                    flexShrink: 0,
                  }}>
            <I.play size={20}/>
          </button>
        </div>
      </div>
    </div>
  );
}

function ArtistOfDayCard({ pl, onOpen }) {
  return (
    <div className="card tap" onClick={onOpen}
         style={{ padding: 14, display: "flex", alignItems: "center", gap: 14,
                  border: "1px solid var(--border-soft)" }}>
      <CoverArt spec={pl.cover} size={64} title={pl.title}
                style={{ borderRadius: "50%", flexShrink: 0 }}/>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="label" style={{ marginBottom: 3 }}>Artist of the day</div>
        <div className="serif" style={{ fontSize: 20, lineHeight: 1.1, color: "var(--fg-strong)",
                                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {pl.title}
        </div>
      </div>
      <I.chevronRight size={18}/>
    </div>
  );
}

function DailySmallCard({ pl, onOpen }) {
  const slotLabel = pl.slot === "broader" ? "Broader" : pl.slot === "genre" ? "New genre" : "Daily";
  return (
    <div className="tap" onClick={onOpen} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <CoverArt spec={pl.cover} size={144} title={pl.title}
                style={{ width: "100%", aspectRatio: "1/1", height: "auto" }}/>
      <div>
        <div className="label" style={{ marginBottom: 2 }}>{slotLabel}</div>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--fg-strong)", lineHeight: 1.2,
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{pl.title}</div>
      </div>
    </div>
  );
}

function SongRow({ song, onPlay, onMore, hideArtist, showDuration = true, idx, status }) {
  return (
    <div className="song-row tap" onClick={onPlay}>
      {idx !== undefined ? (
        <div style={{
          width: 28, textAlign: "center",
          fontFamily: '"Geist Mono", monospace',
          fontSize: 12, color: "var(--fg-soft)",
        }}>{(idx + 1).toString().padStart(2, "0")}</div>
      ) : (
        <CoverArt spec={song.cover} size={44} title={song.title} artist={song.artist}/>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="song-title" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{song.title}</div>
        {!hideArtist && <div className="song-artist" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{song.artist}</div>}
      </div>
      {status === "kept" && (
        <span style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--accent)", fontSize: 11,
                       fontFamily: '"Geist Mono", monospace', textTransform: "uppercase", letterSpacing: "0.06em" }}>
          <I.check size={14}/> Kept
        </span>
      )}
      {status === "delete" && (
        <span style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--fg-soft)", fontSize: 11,
                       fontFamily: '"Geist Mono", monospace', textTransform: "uppercase", letterSpacing: "0.06em" }}>
          <I.trash size={14}/>
        </span>
      )}
      {showDuration && status === undefined && (
        <span style={{
          fontFamily: '"Geist Mono", monospace',
          fontSize: 11.5, color: "var(--fg-soft)",
        }}>{fmtTime(song.duration)}</span>
      )}
      {onMore && (
        <button className="tap" onClick={(e) => { e.stopPropagation(); onMore(); }}
                style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center",
                         color: "var(--fg-soft)" }}>
          <I.dots size={18}/>
        </button>
      )}
    </div>
  );
}

Object.assign(window, { HomeScreen, SongRow, DailyHeroCard, DailySmallCard, ArtistOfDayCard });

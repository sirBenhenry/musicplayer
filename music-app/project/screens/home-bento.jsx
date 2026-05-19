// Home — Bento variant. Tile grid with mixed sizes; visual-content forward.
// Asymmetric grid: hero (Close Match) takes left column over two rows, with
// the Artist of the Day and New Release stacked on the right. Broader Taste
// and New Genre share the row below. Playlists shelf rounds it out.

function HomeBentoScreen({ profile, onOpenPlaylist, onOpenArtist, onPlaySong, onOpenProfileMenu, onShowToast }) {
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

  const close   = DAILY_PLAYLISTS.find(p => p.slot === "close");
  const artist  = DAILY_PLAYLISTS.find(p => p.slot === "artist");
  const broader = DAILY_PLAYLISTS.find(p => p.slot === "broader");
  const genre   = DAILY_PLAYLISTS.find(p => p.slot === "genre");
  const newReleases = ARTISTS.filter(a => a.newRelease);
  const visiblePlaylists = CUSTOM_PLAYLISTS.slice(0, 4);

  return (
    <div className="scroll" style={{ paddingBottom: 160 }}>
      {/* Header */}
      <div style={{ padding: "14px 20px 4px", display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div className="label">{greeting.toUpperCase()}</div>
        <button className="tap" onClick={onOpenProfileMenu}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "5px 11px 5px 5px",
            borderRadius: 100, color: "var(--fg-muted)", marginTop: -4,
          }}>
          <div style={{
            width: 22, height: 22, borderRadius: "50%",
            background: `oklch(70% 0.08 ${profile.hue})`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: '"Instrument Serif", serif', fontSize: 13, lineHeight: 1,
            color: "var(--bg)", flexShrink: 0,
          }}>{profile.glyph}</div>
          <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--fg-strong)" }}>{profile.name}</span>
          <I.chevronDown size={14}/>
        </button>
      </div>
      <div style={{ padding: "0 20px 18px" }}>
        <div className="serif" style={{ fontSize: 30, lineHeight: 1.05, color: "var(--fg-strong)", letterSpacing: "-0.015em" }}>
          {weekday} <span style={{ color: "var(--fg-muted)" }}>{period}</span>
        </div>
      </div>

      <div style={{ padding: "0 20px 14px" }}>
        <div className="label">Today's discovery</div>
      </div>

      {/* The bento — 2 col grid, hero spans 2 rows on the left. */}
      <div style={{
        padding: "0 20px 18px",
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gridAutoRows: "minmax(0, auto)",
        gap: 12,
      }}>
        <BentoHero pl={close} onOpen={() => onOpenPlaylist(close)} onPlay={() => onPlaySong(close.songs[0])} />
        <BentoArtist pl={artist} onOpen={() => onOpenPlaylist(artist)} />
        <BentoRelease artist={newReleases[0]} onOpen={() => newReleases[0] && onOpenArtist(newReleases[0])} />
      </div>

      {/* Broader + Genre — equal pair below the bento */}
      <div style={{
        padding: "0 20px 28px",
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 12,
      }}>
        <BentoSecondary pl={broader} kicker="Broader taste" onOpen={() => onOpenPlaylist(broader)} />
        <BentoSecondary pl={genre}   kicker="New genre"     onOpen={() => onOpenPlaylist(genre)} />
      </div>

      {/* Playlists shelf */}
      <div style={{ padding: "0 20px 14px", display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--fg-strong)" }}>Your playlists</div>
        <button className="tap" style={{ fontSize: 12, color: "var(--fg-muted)" }}>See all</button>
      </div>
      <div style={{ display: "flex", gap: 14, overflowX: "auto", padding: "0 20px 12px", scrollbarWidth: "none" }}>
        {visiblePlaylists.map((pl) => (
          <div key={pl.id} className="tap" style={{ flexShrink: 0, width: 116 }}>
            <CoverArt spec={pl.cover} size={116} title={pl.title} />
            <div style={{ marginTop: 8, fontSize: 13, fontWeight: 500, color: "var(--fg-strong)",
                          lineHeight: 1.25, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{pl.title}</div>
            <div style={{ fontSize: 11.5, color: "var(--fg-soft)", marginTop: 2 }}>{pl.songs} songs</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// — Bento tiles — //

function BentoHero({ pl, onOpen, onPlay }) {
  return (
    <div className="card tap" onClick={onOpen}
         style={{
           gridRow: "span 2",
           position: "relative", overflow: "hidden", padding: 0,
           aspectRatio: "1 / 2.0",
           border: "1px solid var(--border-soft)",
         }}>
      <div style={{ position: "absolute", inset: 0 }}>
        <CoverArt spec={pl.cover} size={372} title={pl.title}
                  style={{ width: "100%", height: "100%", borderRadius: 0 }} />
      </div>
      <div style={{
        position: "absolute", inset: 0,
        background: "linear-gradient(180deg, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0) 35%, rgba(0,0,0,0.6) 100%)",
      }}/>
      <div style={{ position: "absolute", top: 12, left: 12, color: "#fff" }}>
        <div className="label" style={{ color: "rgba(255,255,255,0.85)" }}>Close match</div>
      </div>
      <div style={{ position: "absolute", left: 12, right: 12, bottom: 12, color: "#fff" }}>
        <div className="serif" style={{ fontSize: 24, lineHeight: 1.05, letterSpacing: "-0.015em", marginBottom: 10 }}>
          {pl.title}
        </div>
        <button className="tap" onClick={(e) => { e.stopPropagation(); onPlay(); }}
                style={{
                  width: 40, height: 40, borderRadius: "50%",
                  background: "#fff", color: "#1f1a14",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
                }}>
          <I.play size={18}/>
        </button>
      </div>
    </div>
  );
}

function BentoArtist({ pl, onOpen }) {
  return (
    <div className="card tap" onClick={onOpen}
         style={{
           aspectRatio: "1 / 1",
           position: "relative", overflow: "hidden",
           padding: 12,
           display: "flex", flexDirection: "column", justifyContent: "space-between",
           border: "1px solid var(--border-soft)",
         }}>
      <div className="label" style={{ color: "var(--accent)" }}>
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent)",
                       display: "inline-block", marginRight: 5, verticalAlign: "middle" }}/>
        Artist of the day
      </div>
      <div style={{ display: "flex", justifyContent: "center", padding: "6px 0" }}>
        <CoverArt spec={pl.cover} size={72} title={pl.title}
                  style={{ borderRadius: "50%" }}/>
      </div>
      <div>
        <div className="serif" style={{ fontSize: 17, lineHeight: 1.1, color: "var(--fg-strong)",
                                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {pl.title}
        </div>
        <div style={{ fontSize: 11, color: "var(--fg-muted)", marginTop: 2 }}>
          {pl.songCount} songs
        </div>
      </div>
    </div>
  );
}

function BentoRelease({ artist, onOpen }) {
  if (!artist) {
    // graceful fallback: a quiet stat tile if no new releases today
    return (
      <div className="card"
           style={{
             aspectRatio: "1 / 1",
             padding: 12, border: "1px solid var(--border-soft)",
             display: "flex", flexDirection: "column", justifyContent: "space-between",
             color: "var(--fg-muted)",
           }}>
        <div className="label">Quiet day</div>
        <div className="serif" style={{ fontSize: 17, lineHeight: 1.1, color: "var(--fg-strong)" }}>
          No new releases<br/>from your follows.
        </div>
      </div>
    );
  }
  return (
    <div className="card tap" onClick={onOpen}
         style={{
           aspectRatio: "1 / 1",
           position: "relative", overflow: "hidden",
           padding: 12,
           display: "flex", flexDirection: "column", justifyContent: "space-between",
           border: "1px solid var(--border-soft)",
         }}>
      <div className="label" style={{ color: "var(--accent)" }}>
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent)",
                       display: "inline-block", marginRight: 5, verticalAlign: "middle" }}/>
        New release
      </div>
      <div style={{ display: "flex", justifyContent: "center", padding: "6px 0" }}>
        <CoverArt spec={artist.photo} size={72} title={artist.name} artist={artist.name}
                  style={{ borderRadius: 10 }}/>
      </div>
      <div>
        <div className="serif" style={{ fontSize: 17, lineHeight: 1.1, color: "var(--fg-strong)",
                                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {artist.name}
        </div>
        <div style={{ fontSize: 11, color: "var(--fg-muted)", marginTop: 2 }}>
          Just added
        </div>
      </div>
    </div>
  );
}

function BentoSecondary({ pl, kicker, onOpen }) {
  return (
    <div className="card tap" onClick={onOpen}
         style={{
           aspectRatio: "1 / 1",
           position: "relative", overflow: "hidden", padding: 0,
           border: "1px solid var(--border-soft)",
         }}>
      <div style={{ position: "absolute", inset: 0 }}>
        <CoverArt spec={pl.cover} size={180} title={pl.title}
                  style={{ width: "100%", height: "100%", borderRadius: 0 }}/>
      </div>
      <div style={{
        position: "absolute", inset: 0,
        background: "linear-gradient(180deg, rgba(0,0,0,0) 35%, rgba(0,0,0,0.55) 100%)",
      }}/>
      <div style={{ position: "absolute", top: 10, left: 10, color: "#fff" }}>
        <div className="label" style={{ color: "rgba(255,255,255,0.85)" }}>{kicker}</div>
      </div>
      <div style={{ position: "absolute", left: 10, right: 10, bottom: 10, color: "#fff" }}>
        <div className="serif" style={{ fontSize: 18, lineHeight: 1.05, letterSpacing: "-0.01em",
                                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {pl.title}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { HomeBentoScreen });

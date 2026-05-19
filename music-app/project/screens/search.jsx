// Search screen.

function SearchScreen({ onPlaySong, onOpenArtist }) {
  const [q, setQ] = React.useState("");
  const [focused, setFocused] = React.useState(false);

  const trimmed = q.trim().toLowerCase();
  const songResults = trimmed
    ? ALL_SONGS.filter((s) => s.title.toLowerCase().includes(trimmed) || s.artist.toLowerCase().includes(trimmed)).slice(0, 8)
    : [];
  const artistResults = trimmed
    ? ARTISTS.filter((a) => a.name.toLowerCase().includes(trimmed)).slice(0, 4)
    : [];

  const recents = ["Hollow Coast", "Junichi Sora", "Slow Country", "Maren Tashi"];
  const browse = [
    { name: "Just added",   accent: "#c4825a" },
    { name: "Ambient",      accent: "#7a8b8a" },
    { name: "Folk",         accent: "#cbb78a" },
    { name: "Heavy",        accent: "#a4644a" },
    { name: "Slowcore",     accent: "#8a9275" },
    { name: "Electronic",   accent: "#7e6a55" },
  ];

  return (
    <div className="scroll" style={{ paddingBottom: 160 }}>
      <div className="top-bar" style={{ paddingTop: 10 }}>
        <div>
          <div className="label" style={{ marginBottom: 4 }}>Search</div>
          <div className="serif" style={{ fontSize: 30, lineHeight: 1.05, color: "var(--fg-strong)" }}>
            What are you looking for?
          </div>
        </div>
      </div>

      <div style={{ padding: "16px 20px 14px", position: "relative" }}>
        <div style={{ position: "absolute", left: 32, top: "50%", transform: "translateY(-50%)",
                      color: "var(--fg-soft)", pointerEvents: "none" }}>
          <I.search size={18}/>
        </div>
        <input className="search-input"
               placeholder="Songs, artists, albums"
               value={q}
               onChange={(e) => setQ(e.target.value)}
               onFocus={() => setFocused(true)}
               onBlur={() => setFocused(false)}/>
        {q && (
          <button className="tap" onClick={() => setQ("")}
                  style={{
                    position: "absolute", right: 30, top: "50%", transform: "translateY(-50%)",
                    width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center",
                    color: "var(--fg-soft)",
                  }}>
            <I.close size={18}/>
          </button>
        )}
      </div>

      {trimmed === "" ? (
        <>
          {/* Recent */}
          <div className="section-head" style={{ marginTop: 10 }}>
            <div className="section-title">Recent searches</div>
          </div>
          <div style={{ padding: "0 20px 24px", display: "flex", flexWrap: "wrap", gap: 8 }}>
            {recents.map((r) => (
              <button key={r} className="chip chip-ghost tap" onClick={() => setQ(r)}>
                <I.clock size={13}/> {r}
              </button>
            ))}
          </div>

          {/* Browse */}
          <div className="section-head">
            <div className="section-title">Browse the library</div>
          </div>
          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
            padding: "0 20px",
          }}>
            {browse.map((b) => (
              <button key={b.name} className="tap"
                      style={{
                        position: "relative",
                        height: 92,
                        borderRadius: 12,
                        overflow: "hidden",
                        background: b.accent,
                        color: "#fff",
                        textAlign: "left",
                        padding: "12px 14px",
                        display: "flex",
                        alignItems: "flex-start",
                      }}>
                <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.005em" }}>{b.name}</span>
                <div style={{
                  position: "absolute", right: -8, bottom: -16,
                  width: 60, height: 60,
                  borderRadius: 12,
                  background: "rgba(0,0,0,0.18)",
                  transform: "rotate(22deg)",
                }}/>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          {artistResults.length > 0 && (
            <>
              <div className="section-head"><div className="section-title">Artists</div></div>
              <div>
                {artistResults.map((a) => (
                  <div key={a.id} className="tap song-row" onClick={() => onOpenArtist(a)}>
                    <CoverArt spec={a.photo} size={44} title={a.name} artist={a.name}
                              style={{ borderRadius: "50%" }}/>
                    <div style={{ flex: 1 }}>
                      <div className="song-title">{a.name}</div>
                      <div className="song-artist">Artist · {a.songs} songs</div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
          {songResults.length > 0 && (
            <>
              <div className="section-head" style={{ marginTop: 14 }}>
                <div className="section-title">Songs</div>
              </div>
              <div>
                {songResults.map((s) => (
                  <SongRow key={s.id} song={s} onPlay={() => onPlaySong(s)}/>
                ))}
              </div>
            </>
          )}
          {songResults.length === 0 && artistResults.length === 0 && (
            <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--fg-muted)" }}>
              <div style={{ fontSize: 14 }}>No matches in your library.</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

Object.assign(window, { SearchScreen });

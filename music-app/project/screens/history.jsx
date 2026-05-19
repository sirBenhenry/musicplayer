// Discovery History — 30-day log of daily playlists.

function HistoryScreen({ onOpenPlaylist, onOpenDeletion, onBack }) {
  return (
    <div className="scroll" style={{ paddingBottom: 160 }}>
      <div className="top-bar" style={{ paddingTop: 10 }}>
        <button className="tap" onClick={onBack}
                style={{ width: 38, height: 38, display: "flex", alignItems: "center", justifyContent: "center",
                         color: "var(--fg-strong)", marginLeft: -8 }}>
          <I.arrowLeft size={22}/>
        </button>
        <div className="label">Discovery history</div>
        <button className="tap"
                style={{ width: 38, height: 38, display: "flex", alignItems: "center", justifyContent: "center",
                         color: "var(--fg-strong)" }}>
          <I.filter size={20}/>
        </button>
      </div>
      <div style={{ padding: "8px 20px 0" }}>
        <div className="serif" style={{ fontSize: 30, lineHeight: 1.05, color: "var(--fg-strong)" }}>
          Last 30 days
        </div>
      </div>

      <div style={{ padding: "8px 20px 20px" }}>
        <div style={{ fontSize: 13, color: "var(--fg-muted)", lineHeight: 1.45 }}>
          Every daily playlist from the last 30 days. Tap a day to re-download and listen again.
        </div>
      </div>

      {/* Deletion review entry (only today, prominent) */}
      <div style={{ padding: "0 20px 24px" }}>
        <button className="card tap" onClick={onOpenDeletion}
                style={{
                  width: "100%", textAlign: "left",
                  padding: "14px 16px",
                  display: "flex", alignItems: "center", gap: 14,
                  background: "var(--bg-elev)",
                }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "var(--accent-bg)", color: "var(--accent)",
          }}>
            <I.trash size={22}/>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14.5, fontWeight: 600, color: "var(--fg-strong)" }}>End-of-day review</div>
            <div style={{ fontSize: 12.5, color: "var(--fg-muted)", marginTop: 2 }}>
              {DELETION_QUEUE.length} songs marked for deletion · Rescue any you changed your mind about
            </div>
          </div>
          <I.chevronRight size={20}/>
        </button>
      </div>

      {/* Day-by-day list */}
      <div style={{ padding: "0 20px 8px" }}>
        {HISTORY.map((day, di) => {
          const dateLabel = relDate(day.date);
          const dateExact = day.date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
          return (
            <div key={day.id} style={{ marginBottom: 24 }}>
              <div style={{
                display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12,
              }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--fg-strong)" }}>{dateLabel}</div>
                <div className="mono" style={{ fontSize: 11, color: "var(--fg-soft)" }}>{dateExact}</div>
              </div>
              <div className="card" style={{ padding: 8 }}>
                {day.items.map((it, i) => (
                  <div key={i}>
                    <button className="tap" onClick={() => onOpenPlaylist({
                      id: `${day.id}-${i}`,
                      title: it.title === "Artist" ? it.subtitle : it.title,
                      subtitle: it.title === "Artist" ? "Artist of the day" : it.subtitle,
                      accent: `From ${dateLabel}`,
                      cover: it.cover,
                      songCount: 8 + i,
                      duration: `${28 + i * 2} min`,
                      songs: ALL_SONGS.slice(0, 8 + i),
                    })}
                            style={{
                              width: "100%", textAlign: "left",
                              padding: "8px 6px",
                              display: "flex", alignItems: "center", gap: 12,
                            }}>
                      <CoverArt spec={it.cover} size={40} title={it.title}/>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--fg-strong)",
                                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {it.title}
                        </div>
                        <div style={{ fontSize: 11.5, color: "var(--fg-muted)", marginTop: 1,
                                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {it.subtitle}
                        </div>
                      </div>
                      <span className="mono" style={{
                        fontSize: 10,
                        color: it.kept ? "var(--accent)" : "var(--fg-soft)",
                        textTransform: "uppercase", letterSpacing: "0.06em",
                      }}>
                        {it.kept ? "● kept" : "skipped"}
                      </span>
                    </button>
                    {i < day.items.length - 1 && (
                      <div style={{ height: 1, background: "var(--border-soft)", margin: "0 8px" }}/>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        <div style={{ textAlign: "center", padding: "8px 0 20px", color: "var(--fg-soft)", fontSize: 12 }}>
          End of 30-day window.
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { HistoryScreen });

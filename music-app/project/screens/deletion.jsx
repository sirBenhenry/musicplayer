// End-of-day deletion review.

function DeletionScreen({ onBack }) {
  const [rescued, setRescued] = React.useState(new Set());
  const [confirmed, setConfirmed] = React.useState(false);

  const toggle = (id) => {
    setRescued((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const willDelete = DELETION_QUEUE.length - rescued.size;

  return (
    <div className="scroll" style={{ paddingBottom: 180 }}>
      <div className="top-bar">
        <button className="tap" onClick={onBack}
                style={{ width: 38, height: 38, display: "flex", alignItems: "center", justifyContent: "center",
                         color: "var(--fg-strong)" }}>
          <I.arrowLeft size={22}/>
        </button>
        <div className="label">End-of-day review</div>
        <div style={{ width: 38 }}/>
      </div>

      <div style={{ padding: "20px 24px 32px" }}>
        <div className="serif" style={{ fontSize: 30, lineHeight: 1.1, color: "var(--fg-strong)", marginBottom: 10 }}>
          {willDelete} songs<br/>
          <span style={{ color: "var(--fg-muted)" }}>about to be removed.</span>
        </div>
        <div style={{ fontSize: 13.5, color: "var(--fg-muted)", lineHeight: 1.5 }}>
          You skipped these during today's discovery. Tap any you want to keep — they'll go back into your library.
        </div>
      </div>

      {/* List */}
      <div>
        {DELETION_QUEUE.map((s, i) => {
          const isRescued = rescued.has(s.id);
          return (
            <button key={s.id} className="tap" onClick={() => toggle(s.id)}
                    style={{
                      width: "100%", textAlign: "left",
                      padding: "12px 20px",
                      display: "flex", alignItems: "center", gap: 12,
                      background: isRescued ? "var(--accent-bg)" : "transparent",
                      transition: "background 180ms ease",
                    }}>
              <div style={{ position: "relative", opacity: isRescued ? 1 : 0.55 }}>
                <CoverArt spec={s.cover} size={44} title={s.title} artist={s.artist}/>
                {!isRescued && (
                  <div className="tape" style={{
                    position: "absolute", inset: 0, borderRadius: 10,
                    pointerEvents: "none",
                  }}/>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 14.5, fontWeight: 600,
                  color: isRescued ? "var(--accent)" : "var(--fg-strong)",
                  textDecoration: isRescued ? "none" : "line-through",
                  textDecorationColor: "var(--fg-soft)",
                  textDecorationThickness: "1px",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}>{s.title}</div>
                <div style={{
                  fontSize: 12.5,
                  color: isRescued ? "var(--accent)" : "var(--fg-muted)",
                  opacity: isRescued ? 0.85 : 1,
                  marginTop: 2,
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}>
                  {s.artist}
                </div>
              </div>
              <div style={{
                width: 26, height: 26,
                borderRadius: "50%",
                border: `1.5px solid ${isRescued ? "var(--accent)" : "var(--border-strong)"}`,
                background: isRescued ? "var(--accent)" : "transparent",
                color: "var(--on-accent)",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all 180ms ease",
              }}>
                {isRescued && <I.check size={16} stroke={2.4}/>}
              </div>
            </button>
          );
        })}
      </div>

      <div style={{ padding: "24px 20px", textAlign: "center", color: "var(--fg-soft)", fontSize: 12,
                    fontFamily: '"Geist Mono", monospace', letterSpacing: "0.06em", textTransform: "uppercase" }}>
        {rescued.size} rescued · {willDelete} will be removed
      </div>

      {/* Fixed bottom confirm */}
      <div style={{
        position: "absolute", left: 16, right: 16, bottom: 88,
        display: "flex", gap: 10,
      }}>
        <button className="btn btn-ghost tap" style={{ flex: 1 }} onClick={onBack}>
          Decide later
        </button>
        <button className="btn btn-primary tap" style={{ flex: 1.5 }}
                onClick={() => { setConfirmed(true); setTimeout(onBack, 600); }}>
          {confirmed ? <><I.check size={18}/> Done</> : "Confirm removal"}
        </button>
      </div>
    </div>
  );
}

Object.assign(window, { DeletionScreen });

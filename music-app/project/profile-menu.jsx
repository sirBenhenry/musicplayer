// Profile menu — bottom sheet from the avatar tap.
// Houses Settings, Discovery History, Manage profiles, About.

function ProfileMenu({ open, onClose, onNav, profile }) {
  const [closing, setClosing] = React.useState(false);

  React.useEffect(() => {
    if (!open) setClosing(false);
  }, [open]);

  const close = () => {
    setClosing(true);
    setTimeout(() => { onClose(); setClosing(false); }, 220);
  };

  const goto = (screen) => {
    // 'profiles' isn't a separate screen — taste-profile management lives inside Settings.
    const target = screen === "profiles" ? "settings" : screen;
    setClosing(true);
    setTimeout(() => { onNav(target); onClose(); setClosing(false); }, 200);
  };

  if (!open) return null;

  const items = [
    { label: "Discovery history", hint: "Last 30 days of daily playlists", icon: <I.history size={20}/>, screen: "history" },
    { label: "Manage taste profiles", hint: `${PROFILES.length} profiles · Main is active`, icon: <I.cassette size={20}/>, screen: "profiles" },
    { label: "Settings", hint: "Theme, playback, daily generation", icon: <I.settings size={20}/>, screen: "settings" },
  ];

  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 80,
      animation: closing ? "fadeOut 220ms ease forwards" : "fadeIn 200ms ease both",
    }}>
      {/* Scrim */}
      <div onClick={close}
           style={{
             position: "absolute", inset: 0,
             background: "color-mix(in oklab, #000 35%, transparent)",
             backdropFilter: "blur(2px)",
           }}/>
      {/* Sheet */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0,
        background: "var(--bg-elev)",
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        padding: "12px 16px 24px",
        animation: closing
          ? "sheetDown 220ms cubic-bezier(0.4, 0, 1, 1) forwards"
          : "sheetUpSmall 320ms cubic-bezier(0.2, 0.8, 0.2, 1) both",
        boxShadow: "0 -8px 32px rgba(0,0,0,0.18)",
      }}>
        {/* grabber */}
        <div style={{
          width: 40, height: 4, borderRadius: 2,
          background: "var(--border-strong)",
          margin: "0 auto 14px",
        }}/>

        {/* Profile header */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "8px 10px 18px" }}>
          <div style={{
            width: 48, height: 48, borderRadius: "50%",
            background: `oklch(70% 0.08 ${profile.hue})`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: '"Instrument Serif", serif',
            fontSize: 22,
            color: "var(--bg)",
            flexShrink: 0,
          }}>{profile.glyph}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="label" style={{ marginBottom: 3 }}>Listening as</div>
            <div className="serif" style={{ fontSize: 22, lineHeight: 1, color: "var(--fg-strong)" }}>
              {profile.name}
            </div>
          </div>
          <button className="tap" onClick={close}
                  style={{ width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center",
                           color: "var(--fg-muted)", borderRadius: 100, background: "var(--surface)",
                           border: "1px solid var(--border-soft)" }}>
            <I.close size={18}/>
          </button>
        </div>

        {/* Long-press hint */}
        <div style={{
          margin: "0 4px 14px",
          padding: "10px 12px",
          background: "var(--surface)",
          border: "1px solid var(--border-soft)",
          borderRadius: 12,
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <div style={{
            width: 26, height: 26, borderRadius: "50%",
            background: "var(--accent)", color: "var(--on-accent)",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}>
            <I.home size={14} stroke={2}/>
          </div>
          <div style={{ fontSize: 12, color: "var(--fg-muted)", lineHeight: 1.4 }}>
            Hold the home button to switch profiles. Drag to a profile and release.
          </div>
        </div>

        {/* Menu items */}
        <div className="card" style={{ overflow: "hidden", padding: 0 }}>
          {items.map((it, i) => (
            <React.Fragment key={it.screen}>
              <button className="tap" onClick={() => goto(it.screen)}
                      style={{
                        width: "100%", textAlign: "left",
                        padding: "14px 16px",
                        display: "flex", alignItems: "center", gap: 14,
                      }}>
                <div style={{ color: "var(--fg-muted)", flexShrink: 0 }}>{it.icon}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: "var(--fg-strong)" }}>{it.label}</div>
                  <div style={{ fontSize: 12, color: "var(--fg-muted)", marginTop: 2 }}>{it.hint}</div>
                </div>
                <I.chevronRight size={18}/>
              </button>
              {i < items.length - 1 && <div style={{ height: 1, background: "var(--border-soft)", marginLeft: 16 }}/>}
            </React.Fragment>
          ))}
        </div>

        <style>{`
          @keyframes sheetUpSmall {
            from { transform: translateY(100%); }
            to { transform: translateY(0); }
          }
          @keyframes sheetDown {
            from { transform: translateY(0); }
            to { transform: translateY(100%); }
          }
          @keyframes fadeOut {
            from { opacity: 1; }
            to { opacity: 0; }
          }
        `}</style>
      </div>
    </div>
  );
}

Object.assign(window, { ProfileMenu });

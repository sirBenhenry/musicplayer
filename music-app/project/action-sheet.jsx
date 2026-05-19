// Action sheet + lightweight toast.
// ActionSheet: bottom sheet with a list of actions for context menus.
// Toast: short transient message.

function ActionSheet({ open, onClose, title, actions = [] }) {
  const [closing, setClosing] = React.useState(false);
  React.useEffect(() => { if (!open) setClosing(false); }, [open]);

  if (!open) return null;

  const close = () => {
    setClosing(true);
    setTimeout(onClose, 220);
  };

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 90,
                  animation: closing ? "fadeOut 220ms ease forwards" : "fadeIn 200ms ease both" }}>
      <div onClick={close} style={{
        position: "absolute", inset: 0,
        background: "color-mix(in oklab, #000 30%, transparent)",
      }}/>
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0,
        background: "var(--bg-elev)",
        borderTopLeftRadius: 22, borderTopRightRadius: 22,
        padding: "12px 14px 24px",
        animation: closing
          ? "sheetDown 220ms cubic-bezier(0.4, 0, 1, 1) forwards"
          : "sheetUpSmall 300ms cubic-bezier(0.2, 0.8, 0.2, 1) both",
        boxShadow: "0 -8px 32px rgba(0,0,0,0.18)",
      }}>
        <div style={{ width: 36, height: 4, borderRadius: 2,
                      background: "var(--border-strong)", margin: "0 auto 14px" }}/>
        {title && (
          <div style={{
            padding: "4px 10px 12px",
            fontSize: 13, color: "var(--fg-muted)",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            fontFamily: '"Geist Mono", monospace',
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}>{title}</div>
        )}
        <div className="card" style={{ overflow: "hidden", padding: 0 }}>
          {actions.map((a, i) => (
            <React.Fragment key={i}>
              <button className="tap" onClick={() => { a.run(); close(); }}
                      style={{
                        width: "100%", textAlign: "left",
                        padding: "14px 16px",
                        display: "flex", alignItems: "center", gap: 14,
                        color: a.danger ? "#c4503a" : "var(--fg-strong)",
                      }}>
                <div style={{ color: a.danger ? "#c4503a" : "var(--fg-muted)", flexShrink: 0 }}>{a.icon}</div>
                <div style={{ fontSize: 14, fontWeight: 500, flex: 1 }}>{a.label}</div>
              </button>
              {i < actions.length - 1 && (
                <div style={{ height: 1, background: "var(--border-soft)", marginLeft: 16 }}/>
              )}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

function Toast({ msg }) {
  if (!msg) return null;
  return (
    <div style={{
      position: "absolute",
      left: "50%", transform: "translateX(-50%)",
      bottom: 152,
      background: "var(--fg-strong)",
      color: "var(--bg)",
      padding: "10px 16px",
      borderRadius: 100,
      fontSize: 13,
      fontWeight: 500,
      letterSpacing: "-0.005em",
      maxWidth: "calc(100% - 48px)",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
      zIndex: 200,
      boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
      animation: "toastIn 280ms cubic-bezier(0.2, 0.8, 0.2, 1) both",
    }}>
      {msg}
      <style>{`
        @keyframes toastIn {
          from { opacity: 0; transform: translate(-50%, 16px); }
          to   { opacity: 1; transform: translate(-50%, 0); }
        }
      `}</style>
    </div>
  );
}

Object.assign(window, { ActionSheet, Toast });

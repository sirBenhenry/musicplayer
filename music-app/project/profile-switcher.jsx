// Radial profile switcher.
// Long-press the home button, drag to a profile petal, release to select.
// Cleanly animated: petals fan out from center, focus state follows the pointer.

function ProfileSwitcher({ open, center, pointer, profiles, currentProfileId, onCommit, onCancel }) {
  const [focused, setFocused] = React.useState(null);
  const containerRef = React.useRef(null);

  // Geometry: compact arc above the home button, tuned so the 5 petals fit
  // inside the 412px frame with comfortable margins from both edges.
  const radius = 122;
  const n = profiles.length;
  const startAng = 200;
  const endAng = 340;
  const stride = (endAng - startAng) / (n - 1 || 1);

  const petals = profiles.map((p, i) => {
    const ang = (startAng + i * stride) * Math.PI / 180;
    return {
      profile: p,
      x: Math.cos(ang) * radius,
      y: Math.sin(ang) * radius,
      ang,
    };
  });

  // Compute which petal is closest to pointer, but only if pointer is far enough from center.
  React.useEffect(() => {
    if (!open || !pointer || !center) { setFocused(null); return; }
    const dx = pointer.x - center.x;
    const dy = pointer.y - center.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 50) {
      setFocused(null);
      return;
    }
    // Find petal whose center is closest to pointer
    let best = null, bestD = Infinity;
    petals.forEach((p) => {
      const pdx = p.x - dx;
      const pdy = p.y - dy;
      const d = pdx * pdx + pdy * pdy;
      if (d < bestD) { bestD = d; best = p.profile.id; }
    });
    setFocused(best);
  }, [pointer, open, center]);

  // On close (pointer up), commit focused selection.
  const onCloseRef = React.useRef();
  onCloseRef.current = focused;
  React.useEffect(() => {
    return () => {
      // unmount: don't auto-commit
    };
  }, []);

  // External: parent calls onCommit when pointer up — we expose focused via window?
  // Simpler: parent passes us the current pointer; when parent's pointerup fires, parent
  // calls onCommit() and we tell it which profile by exposing focused via ref.
  React.useEffect(() => {
    window.__profileSwitcherFocused = focused;
  }, [focused]);

  if (!open) return null;

  return (
    <div className="radial-overlay" onPointerUp={() => onCancel()}>
      {/* Center hint */}
      <div style={{
        position: "absolute",
        left: center.x, top: center.y,
        transform: "translate(-50%, -50%)",
        pointerEvents: "none",
        textAlign: "center",
      }}>
        <div style={{
          width: 80, height: 80, borderRadius: "50%",
          border: "1.5px dashed var(--accent)",
          opacity: 0.45,
          animation: "pulse 2s ease-in-out infinite",
        }}/>
        <div style={{
          position: "absolute", top: "calc(100% + 14px)", left: "50%",
          transform: "translateX(-50%)",
          whiteSpace: "nowrap",
          fontSize: 12,
          color: "var(--fg-muted)",
          fontFamily: '"Geist Mono", monospace',
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}>
          {focused ? "release to switch" : "drag to a profile"}
        </div>
      </div>

      {petals.map((p, i) => {
        const isCurrent = p.profile.id === currentProfileId;
        const isFocus = focused === p.profile.id;
        return (
          <div
            key={p.profile.id}
            className={"radial-petal" + (isFocus ? " focus" : "")}
            style={{
              left: center.x + p.x,
              top: center.y + p.y,
              width: 78, minHeight: 56, padding: "8px 6px",
              borderRadius: 14,
              transform: `translate(-50%, -50%) scale(${isFocus ? 1.1 : 1})`,
              animation: `petalIn 280ms cubic-bezier(0.2, 0.8, 0.2, 1) ${i * 28}ms both`,
              "--from-x": `${-p.x * 0.6}px`,
              "--from-y": `${-p.y * 0.6}px`,
            }}
          >
            <div style={{
              fontFamily: '"Instrument Serif", serif',
              fontSize: 16,
              lineHeight: 1,
              marginBottom: 3,
              color: isFocus ? "var(--on-accent)" : `oklch(60% 0.08 ${p.profile.hue})`,
            }}>{p.profile.glyph}</div>
            <div style={{
              fontSize: 11.5,
              fontWeight: 600,
              letterSpacing: "-0.005em",
              color: isFocus ? "var(--on-accent)" : "var(--fg-strong)",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              maxWidth: "100%",
            }}>{p.profile.name}</div>
            <div style={{
              fontFamily: '"Geist Mono", monospace',
              fontSize: 8.5,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              color: isFocus ? "var(--on-accent)" : "var(--fg-soft)",
              marginTop: 2,
              opacity: isFocus ? 0.85 : 1,
            }}>{isCurrent ? "● active" : `${p.profile.songs} songs`}</div>
          </div>
        );
      })}

      {/* Keyframes injected inline */}
      <style>{`
        @keyframes petalIn {
          from { opacity: 0; transform: translate(calc(-50% + var(--from-x)), calc(-50% + var(--from-y))) scale(0.6); }
          to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 0.45; }
          50% { transform: scale(1.15); opacity: 0.25; }
        }
      `}</style>
    </div>
  );
}

Object.assign(window, { ProfileSwitcher });

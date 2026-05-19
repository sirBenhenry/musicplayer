// Placeholder cover art — generated programmatically, deterministic by seed.
// Three styles: gradient duotone, typographic initials, geometric.

// Warm muted palette for placeholders. Stays cohesive with the warm cream/charcoal scheme.
const COVER_PALETTE = [
  // [base, accent]
  ["#c4825a", "#3a2a20"],  // terracotta + espresso
  ["#8a9275", "#2d3022"],  // sage + dark olive
  ["#cbb78a", "#3d3322"],  // sand + walnut
  ["#9a7e64", "#27201a"],  // mocha
  ["#b5a589", "#332a1f"],  // taupe
  ["#7a8b8a", "#202827"],  // slate-teal
  ["#d6a37e", "#3a261c"],  // peach + bark
  ["#7e6a55", "#1f1814"],  // umber
  ["#a8b094", "#2c2e21"],  // moss
  ["#c98f73", "#2c1c14"],  // brick
];

function pickColors(seed) {
  return COVER_PALETTE[Math.abs(seed) % COVER_PALETTE.length];
}

function initialsFrom(s) {
  if (!s) return "♪";
  const parts = s.replace(/[^a-zA-Z\u3040-\u30FF\u4E00-\u9FAF\s&]/g, "").trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function CoverArt({ spec, size = 56, title = "", artist = "", style }) {
  if (!spec) spec = { kind: "grad", seed: 0 };
  const [base, accent] = pickColors(spec.seed);
  const s = size;
  const radius = Math.max(6, size * 0.07);

  if (spec.kind === "grad") {
    // soft duotone: diagonal gradient
    const ang = ((spec.seed * 37) % 180);
    return (
      <div className="cover" style={{ width: s, height: s, borderRadius: radius, ...style }}>
        <div style={{
          position: "absolute", inset: 0,
          background: `linear-gradient(${ang}deg, ${base} 0%, ${accent} 110%)`,
        }} />
        {/* subtle film grain via radial shading */}
        <div style={{
          position: "absolute", inset: 0,
          background: `radial-gradient(circle at ${20 + (spec.seed % 60)}% ${30 + (spec.seed % 40)}%, ${shade(base, 12)}, transparent 60%)`,
          mixBlendMode: "soft-light",
        }} />
        {/* tiny dot/lozenge as visual anchor */}
        <div style={{
          position: "absolute",
          width: s * 0.18,
          height: s * 0.18,
          borderRadius: s * 0.09,
          background: shade(base, 18),
          right: s * 0.12,
          bottom: s * 0.12,
          opacity: 0.6,
        }} />
      </div>
    );
  }

  if (spec.kind === "type") {
    const initials = initialsFrom(title || artist || "♪");
    return (
      <div className="cover" style={{
        width: s, height: s, borderRadius: radius,
        background: base, display: "flex",
        alignItems: "center", justifyContent: "center",
        ...style,
      }}>
        <span style={{
          fontFamily: '"Instrument Serif", serif',
          fontSize: s * 0.42,
          fontWeight: 400,
          color: accent,
          letterSpacing: "-0.04em",
          lineHeight: 1,
          textAlign: "center",
        }}>{initials}</span>
        {/* corner index dot */}
        <div style={{
          position: "absolute",
          top: s * 0.1, right: s * 0.1,
          width: s * 0.05, height: s * 0.05,
          borderRadius: "50%",
          background: accent,
          opacity: 0.4,
        }} />
      </div>
    );
  }

  // geometric — varies by seed % 4
  const variant = Math.abs(spec.seed) % 4;
  return (
    <div className="cover" style={{ width: s, height: s, borderRadius: radius, background: base, ...style }}>
      <svg viewBox="0 0 100 100" width={s} height={s} style={{ display: "block" }}>
        {variant === 0 && (
          <>
            <circle cx="50" cy="62" r="22" fill={accent} opacity="0.9" />
            <circle cx="50" cy="62" r="6" fill={base} />
          </>
        )}
        {variant === 1 && (
          <>
            <rect x="14" y="50" width="72" height="3" fill={accent} />
            <rect x="14" y="58" width="40" height="3" fill={accent} opacity="0.7" />
            <rect x="14" y="66" width="58" height="3" fill={accent} opacity="0.5" />
          </>
        )}
        {variant === 2 && (
          <>
            <path d="M50 22 L78 78 L22 78 Z" fill={accent} opacity="0.9" />
            <circle cx="50" cy="62" r="6" fill={base} />
          </>
        )}
        {variant === 3 && (
          <>
            <rect x="30" y="20" width="6" height="60" fill={accent} />
            <rect x="64" y="20" width="6" height="60" fill={accent} opacity="0.55" />
            <rect x="47" y="20" width="6" height="60" fill={accent} opacity="0.75" />
          </>
        )}
      </svg>
    </div>
  );
}

function shade(hex, amt) {
  // lighten/darken roughly. amt positive = lighter
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 0xff) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 0xff) + amt));
  const b = Math.max(0, Math.min(255, (n & 0xff) + amt));
  return `rgb(${r},${g},${b})`;
}

Object.assign(window, { CoverArt, pickColors, initialsFrom });

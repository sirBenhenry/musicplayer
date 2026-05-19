// Settings — including accent color toggle (terracotta vs sage) per user's request,
// auto-generate profiles, follow management, etc.

function SettingsScreen({ tweaks, setTweak, onBack }) {
  const accent = tweaks.accent; // "terra" | "sage"
  const dark = tweaks.dark;
  const [autoProfiles, setAutoProfiles] = React.useState(["main", "chill"]);
  const toggleAuto = (id) => {
    setAutoProfiles((p) => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  };

  return (
    <div className="scroll" style={{ paddingBottom: 160 }}>
      <div className="top-bar" style={{ paddingTop: 10 }}>
        <button className="tap" onClick={onBack}
                style={{ width: 38, height: 38, display: "flex", alignItems: "center", justifyContent: "center",
                         color: "var(--fg-strong)", marginLeft: -8 }}>
          <I.arrowLeft size={22}/>
        </button>
        <div className="label">Settings</div>
        <div style={{ width: 38 }}/>
      </div>
      <div style={{ padding: "8px 20px 0" }}>
        <div className="serif" style={{ fontSize: 30, lineHeight: 1.05, color: "var(--fg-strong)" }}>
          Make it yours
        </div>
      </div>

      <div style={{ padding: "10px 20px 0" }}>
        {/* Appearance */}
        <Section title="Appearance">
          <SettingRow label="Accent color" hint="The single restrained accent across the app">
            <div style={{ display: "flex", gap: 8 }}>
              <Swatch label="Terracotta" color="#b8553a" active={accent === "terra"}
                      onClick={() => setTweak("accent", "terra")}/>
              <Swatch label="Sage" color="#5e7155" active={accent === "sage"}
                      onClick={() => setTweak("accent", "sage")}/>
            </div>
          </SettingRow>
          <SettingRow label="Dark mode" hint="Warm charcoal blacks">
            <Toggle on={dark} onClick={() => setTweak("dark", !dark)}/>
          </SettingRow>
        </Section>

        {/* Daily discovery */}
        <Section title="Daily discovery">
          <div style={{ fontSize: 12.5, color: "var(--fg-muted)", lineHeight: 1.5, padding: "4px 4px 14px" }}>
            Choose which taste profiles get a new daily playlist generated automatically. Others can be triggered on demand from the profile switcher.
          </div>
          {PROFILES.map((p) => (
            <SettingRow key={p.id} label={p.name}
                        hint={`${p.songs} songs · ${p.desc}`}>
              <Toggle on={autoProfiles.includes(p.id)} onClick={() => toggleAuto(p.id)}/>
            </SettingRow>
          ))}
        </Section>

        {/* Playback */}
        <Section title="Playback">
          <SettingRow label="Auto-radio default" hint="When a song ends, what should play next?">
            <SegmentedTwo
              left="Stay in profile"
              right="Full library"
              active="left"
              onChange={() => {}}/>
          </SettingRow>
          <SettingRow label="Gapless playback">
            <Toggle on={true}/>
          </SettingRow>
          <SettingRow label="Crossfade" hint="Smooth transitions between songs">
            <span style={{ fontSize: 13, color: "var(--fg-muted)" }}>2 s</span>
          </SettingRow>
        </Section>

        {/* Library */}
        <Section title="Library">
          <SettingRow label="Auto-add new releases" hint="From followed artists">
            <Toggle on={true}/>
          </SettingRow>
          <SettingRow label="Storage" hint="14.2 GB of music · cached offline">
            <I.chevronRight size={18}/>
          </SettingRow>
          <SettingRow label="Connected server" hint="bookshelf.local · 412 songs synced">
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#7ea968" }}/>
          </SettingRow>
        </Section>

        <Section title="Profiles">
          <SettingRow label="Manage taste profiles">
            <I.chevronRight size={18}/>
          </SettingRow>
          <SettingRow label="Auto-assign new songs" hint="If uncertain, ask me">
            <Toggle on={true}/>
          </SettingRow>
        </Section>

        <div style={{ padding: "24px 0 8px", textAlign: "center", color: "var(--fg-soft)", fontSize: 11,
                      fontFamily: '"Geist Mono", monospace', letterSpacing: "0.06em" }}>
          v0.1.0 · {profileName(accent)} {dark ? "dark" : "light"}
        </div>
      </div>
    </div>
  );
}

function profileName(accent) {
  return accent === "sage" ? "sage" : "terracotta";
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div className="label" style={{ padding: "0 4px 10px" }}>{title}</div>
      <div className="card" style={{ overflow: "hidden", padding: 0 }}>
        {React.Children.toArray(children).map((c, i, arr) => (
          <React.Fragment key={i}>
            {c}
            {i < arr.length - 1 && <div style={{ height: 1, background: "var(--border-soft)", marginLeft: 16 }}/>}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function SettingRow({ label, hint, children }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 14,
      padding: "14px 16px",
      minHeight: 56,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: "var(--fg-strong)" }}>{label}</div>
        {hint && <div style={{ fontSize: 12, color: "var(--fg-muted)", marginTop: 2, lineHeight: 1.35 }}>{hint}</div>}
      </div>
      <div style={{ flexShrink: 0, color: "var(--fg-muted)" }}>{children}</div>
    </div>
  );
}

function Toggle({ on, onClick }) {
  return (
    <button onClick={onClick} className={"toggle" + (on ? " on" : "")}>
      <span className="toggle-thumb"/>
    </button>
  );
}

function Swatch({ label, color, active, onClick }) {
  return (
    <button className="tap" onClick={onClick}
            title={label}
            style={{
              width: 44, height: 32,
              borderRadius: 8,
              background: color,
              border: active ? "2px solid var(--fg-strong)" : "2px solid transparent",
              boxShadow: active ? `0 0 0 1px var(--bg)` : "none",
              position: "relative",
            }}>
      {active && (
        <span style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center", justifyContent: "center",
          color: "#fff",
        }}>
          <I.check size={16} stroke={2.4}/>
        </span>
      )}
    </button>
  );
}

function SegmentedTwo({ left, right, active }) {
  const [a, setA] = React.useState(active);
  return (
    <div style={{
      display: "inline-flex",
      padding: 3,
      background: "var(--bg-elev)",
      borderRadius: 100,
      border: "1px solid var(--border-soft)",
    }}>
      {[{ k: "left", l: left }, { k: "right", l: right }].map((b) => (
        <button key={b.k} className="tap" onClick={() => setA(b.k)}
                style={{
                  padding: "5px 11px",
                  borderRadius: 100,
                  background: a === b.k ? "var(--surface)" : "transparent",
                  color: a === b.k ? "var(--fg-strong)" : "var(--fg-muted)",
                  fontSize: 12, fontWeight: 500,
                  boxShadow: a === b.k ? "0 1px 2px rgba(0,0,0,0.05)" : "none",
                }}>
          {b.l}
        </button>
      ))}
    </div>
  );
}

Object.assign(window, { SettingsScreen });

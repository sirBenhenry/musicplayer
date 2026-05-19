// SVG icons. Stroke-based, single weight, current color.
// Style: 1.6px stroke on 24-grid, rounded caps & joins, calm geometry.

const Ic = ({ children, size = 22, stroke = 1.6 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth={stroke}
       strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

const I = {
  home: (p) => <Ic {...p}><path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4v-5h-6v5H5a1 1 0 0 1-1-1z"/></Ic>,
  library: (p) => <Ic {...p}><path d="M5 4h14M5 9h14M5 14h9"/><circle cx="17" cy="17" r="3"/><path d="m20 20 1.5 1.5"/></Ic>,
  search: (p) => <Ic {...p}><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></Ic>,
  play:  (p) => <Ic {...p}><path d="M7 5v14l12-7z" fill="currentColor" stroke="none"/></Ic>,
  pause: (p) => <Ic {...p}><rect x="6" y="5" width="4" height="14" rx="0.8" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" rx="0.8" fill="currentColor" stroke="none"/></Ic>,
  skip:  (p) => <Ic {...p}><path d="M6 5v14l9-7z" fill="currentColor" stroke="none"/><path d="M17 5v14" /></Ic>,
  prev:  (p) => <Ic {...p}><path d="M18 5v14l-9-7z" fill="currentColor" stroke="none"/><path d="M7 5v14" /></Ic>,
  shuffle: (p) => <Ic {...p}><path d="M3 6h3l12 12h3M3 18h3l4-4M14 10l4-4h3M18 3l3 3-3 3M18 15l3 3-3 3"/></Ic>,
  repeat: (p) => <Ic {...p}><path d="M17 3l3 3-3 3M4 13v-4a3 3 0 0 1 3-3h13M7 21l-3-3 3-3M20 11v4a3 3 0 0 1-3 3H4"/></Ic>,
  heart: (p) => <Ic {...p}><path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/></Ic>,
  heartFill: (p) => <Ic {...p}><path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z" fill="currentColor"/></Ic>,
  dots: (p) => <Ic {...p}><circle cx="5" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.3" fill="currentColor" stroke="none"/></Ic>,
  plus: (p) => <Ic {...p}><path d="M12 5v14M5 12h14"/></Ic>,
  check: (p) => <Ic {...p}><path d="m5 12 5 5 9-11"/></Ic>,
  arrowRight: (p) => <Ic {...p}><path d="M5 12h14M13 6l6 6-6 6"/></Ic>,
  arrowLeft: (p) => <Ic {...p}><path d="M19 12H5M11 6l-6 6 6 6"/></Ic>,
  chevronDown: (p) => <Ic {...p}><path d="m6 9 6 6 6-6"/></Ic>,
  chevronRight: (p) => <Ic {...p}><path d="m9 6 6 6-6 6"/></Ic>,
  close: (p) => <Ic {...p}><path d="M6 6l12 12M18 6 6 18"/></Ic>,
  clock: (p) => <Ic {...p}><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></Ic>,
  trash: (p) => <Ic {...p}><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12"/></Ic>,
  settings: (p) => <Ic {...p}><circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></Ic>,
  user: (p) => <Ic {...p}><circle cx="12" cy="8" r="3.5"/><path d="M5 20c1.5-3.5 4-5 7-5s5.5 1.5 7 5"/></Ic>,
  pauseTomorrow: (p) => <Ic {...p}><rect x="5" y="6" width="3.5" height="12" rx="0.8"/><rect x="11" y="6" width="3.5" height="12" rx="0.8"/><path d="M19 14l3-3-3-3"/></Ic>,
  sparkle: (p) => <Ic {...p}><path d="M12 4v4M12 16v4M4 12h4M16 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/></Ic>,
  download: (p) => <Ic {...p}><path d="M12 4v12m0 0 4-4m-4 4-4-4M5 20h14"/></Ic>,
  refresh: (p) => <Ic {...p}><path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 4v4h-4M21 12a9 9 0 0 1-15 6.7L3 16M3 20v-4h4"/></Ic>,
  list: (p) => <Ic {...p}><path d="M4 6h16M4 12h16M4 18h10"/></Ic>,
  filter: (p) => <Ic {...p}><path d="M4 5h16l-6 8v6l-4-2v-4z"/></Ic>,
  album: (p) => <Ic {...p}><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/></Ic>,
  radio: (p) => <Ic {...p}><circle cx="12" cy="12" r="2"/><path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.5 5.5a9 9 0 0 0 0 13M18.5 5.5a9 9 0 0 1 0 13"/></Ic>,
  artist: (p) => <Ic {...p}><circle cx="12" cy="8" r="3.5"/><path d="M5 20c1.5-3.5 4-5 7-5s5.5 1.5 7 5"/></Ic>,
  cassette: (p) => <Ic {...p}><rect x="3" y="6" width="18" height="12" rx="1.5"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="12" r="2"/></Ic>,
  history: (p) => <Ic {...p}><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 8v4l3 2"/></Ic>,
};

Object.assign(window, { I });

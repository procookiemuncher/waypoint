// Waypoint's real interface, rebuilt from core/web/static/app.css + index.html so the trailer can
// pose every part of it frame by frame: no transitions, no CSS animation, every live value set
// from the clock. Sizes are the app's own (a 1440x900 window); shots scale the result up.
'use strict';

const UI_CSS = `
.wp { position: absolute; font-family: 'Inter', sans-serif; color: #c9d1d9; font-size: 13px; -webkit-font-smoothing: antialiased; }
.wp * { box-sizing: border-box; }
.wp .mono { font-family: 'JetBrains Mono', monospace; }
.wp svg.lu { display: block; flex: none; }

/* window */
.wp-win { width: 1440px; height: 900px; padding: 4px; background: #050609; border-radius: 14px; }
.wp-frame { position: relative; height: 100%; border-radius: 10px; overflow: hidden; display: flex; flex-direction: column;
  background: radial-gradient(120% 90% at 50% 0%, #0d0f14 0%, #0a0b0f 70%); }
.wp-ring { position: absolute; inset: 0; border-radius: 14px; padding: 4px; pointer-events: none; z-index: 5;
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude; }
.wp-ring i { position: absolute; left: 50%; top: 50%; width: 200%; aspect-ratio: 1; transform: translate(-50%,-50%); display: block; }
.wp-title { height: 40px; flex: none; display: flex; align-items: center; gap: 12px; padding: 0 6px 0 14px;
  background: rgba(18,20,27,.72); border-bottom: 1px solid #1e2230; }
.wp-title .spacer { flex: 1; }
.wp-winbtn { width: 38px; height: 30px; display: grid; place-items: center; color: #6b7280; }
.wp-pill { display: flex; align-items: center; height: 32px; padding: 0 4px 0 6px; margin-left: -6px; border-radius: 10px; color: #f4f4f5; }
.wp-pill .name { font-size: 13px; font-weight: 500; letter-spacing: -.01em; padding-left: 8px; white-space: nowrap; }
.wp-pill .stat { display: flex; align-items: center; gap: 6px; padding: 0 10px 0 9px; font-size: 12px; color: #a1a1aa; white-space: nowrap; }
.wp-pill .stat i { width: 6px; height: 6px; border-radius: 50%; background: #22c55e; display: block; }
.wp-pill .mini { display: flex; align-items: center; padding: 2px; border-radius: 8px; background: rgba(255,255,255,.035); border: 1px solid rgba(255,255,255,.07); }
.wp-pill .ico { position: relative; width: 26px; height: 22px; display: grid; place-items: center; border-radius: 6px; color: #f4f4f5; }
.wp-pill .ico .dot { position: absolute; right: 2px; bottom: 1px; width: 6px; height: 6px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 0 2px #121318; }
.wp-pill .chev { color: #6b6b74; margin-left: 6px; }
.wp-main { flex: 1; display: grid; grid-template-columns: 60% 40%; min-height: 0; }
.wp-mapwrap { position: relative; min-height: 0; border-right: 1px solid #1e2230; background: #0a0b0f; overflow: hidden; }
.wp-panel { display: flex; flex-direction: column; min-height: 0; background: #101219; overflow: hidden; }
.wp-status { flex: none; height: 28px; display: flex; align-items: center; gap: 18px; padding: 0 14px; background: rgba(18,20,27,.8);
  border-top: 1px solid #1e2230; font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #6b7280; letter-spacing: .04em; white-space: nowrap; }
.wp-status b { font-weight: 500; color: #c9d1d9; font-variant-numeric: tabular-nums; }
.wp-status .mode b { color: #b49aff; }
.wp-status .flex { flex: 1; }
.wp-gauge { width: 90px; height: 4px; border-radius: 4px; background: #1e2230; overflow: hidden; }
.wp-gauge i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, #63548c, #b49aff); }

/* map HUD */
.wp-hud { position: absolute; z-index: 8; font-family: 'JetBrains Mono', monospace; font-size: 11px; background: rgba(13,15,20,.78);
  border: 1px solid #1e2230; border-radius: 8px; padding: 5px 10px; color: #c9d1d9; box-shadow: 0 4px 14px rgba(0,0,0,.4);
  display: flex; align-items: center; gap: 8px; white-space: nowrap; }
.wp-hud .lbl { color: #6b7280; font-size: 9px; letter-spacing: .1em; }
.wp-hud .val { color: #b49aff; text-shadow: 0 0 8px rgba(180,154,255,.35); font-variant-numeric: tabular-nums; }
.wp-toast { position: absolute; z-index: 9; background: rgba(13,15,20,.92); border: 1px solid rgba(126,231,135,.35); border-radius: 12px;
  padding: 12px 18px; display: flex; align-items: center; gap: 10px; font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #7ee787;
  box-shadow: 0 8px 30px rgba(0,0,0,.6), 0 0 24px rgba(126,231,135,.12); white-space: nowrap; }
.wp-bub { position: absolute; display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 10px 0 6px; border-radius: 15px; white-space: nowrap;
  background: rgba(14,14,17,.88); border: 1px solid var(--tb); box-shadow: 0 6px 20px rgba(0,0,0,.45), 0 0 0 4px var(--tg);
  color: #f4f4f5; font: 600 12.5px 'Inter', sans-serif; transform-origin: 50% 50%; }
.wp-bub .fl { width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; font-size: 13px; background: var(--tf); }
.wp-bub .n { color: var(--t); }
.wp-bub .more { color: #a1a1aa; font-weight: 500; margin-left: -2px; }
.wp-marker { position: absolute; width: 0; height: 0; z-index: 7; }
.wp-marker .core { position: absolute; left: -6px; top: -6px; width: 12px; height: 12px; border-radius: 50%; background: var(--t);
  box-shadow: 0 0 10px var(--t), 0 0 22px var(--tg); border: 2px solid #0a0b0f; }
.wp-marker .ring { position: absolute; left: -22px; top: -22px; width: 44px; height: 44px; border-radius: 50%; border: 2.5px solid var(--tr); }

/* panel: destinations */
.wp-browse { flex: 1; min-height: 0; overflow: hidden; position: relative; }
.wp-bhead { display: flex; align-items: center; gap: 10px; padding: 16px 14px 12px 16px; }
.wp-bhead h2 { margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -.035em; color: #f4f4f5; }
.wp-bhead .sub { font-size: 12.5px; color: #6b6b74; margin-top: 2px; }
.wp-reset { flex: none; margin-left: auto; width: 32px; height: 32px; border-radius: 9px; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); color: #a1a1aa; display: grid; place-items: center; }
.wp-art { position: absolute; inset: 0; overflow: hidden; background: #18181b; }
.wp-art svg { position: absolute; left: 0; top: 0; }
.wp-shade { position: absolute; inset: 0; }
.wp-chead { display: flex; align-items: center; gap: 10px; margin: 6px 14px 10px; padding: 8px 4px 8px 2px; border-bottom: 1px solid rgba(255,255,255,.06); color: #f4f4f5; }
.wp-chead .fl { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; font-size: 17px; background: rgba(255,255,255,.06); flex: none; }
.wp-chead .nm { font-size: 15px; font-weight: 650; letter-spacing: -.02em; }
.wp-chead .sb { font-size: 11.5px; color: #6b6b74; margin-top: 1px; }
.wp-chead .chev { margin-left: auto; color: #6b6b74; }
.wp-gcard { position: relative; display: block; height: 168px; border-radius: 18px; overflow: hidden; color: #f4f4f5;
  border: 1px solid rgba(255,255,255,.07); background: #18181b; }
.wp-gcard .wp-shade { background: linear-gradient(180deg, rgba(11,11,13,0) 25%, rgba(11,11,13,.92) 100%), linear-gradient(90deg, var(--tw), transparent 60%); }
.wp-gcard .top { position: absolute; left: 14px; top: 12px; right: 14px; display: flex; align-items: center; gap: 8px; }
.wp-gcard .go { margin-left: auto; width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; background: rgba(255,255,255,.12); }
.wp-gcard .bot { position: absolute; left: 16px; right: 16px; bottom: 14px; }
.wp-gcard .cn { font-size: 24px; font-weight: 700; letter-spacing: -.03em; margin-bottom: 8px; }
.wp-halves { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 0 14px 12px; }
.wp-halves .wp-gcard { height: 136px; }
.wp-halves .wp-gcard .cn { font-size: 18px; margin-bottom: 6px; }
.wp-halves .wp-gcard .wp-mchip { height: 20px; font-size: 11px; padding: 0 7px; }
.wp-mchips { display: flex; gap: 6px; flex-wrap: wrap; }
.wp-mchip { display: inline-flex; align-items: center; gap: 5px; height: 22px; padding: 0 8px; border-radius: 11px; font-size: 11.5px; font-weight: 500;
  background: rgba(255,255,255,.1); color: #e4e4e7; white-space: nowrap; }
.wp-mchip svg { opacity: .8; }
.wp-live { display: inline-flex; align-items: center; gap: 5px; height: 20px; padding: 0 8px; border-radius: 10px; background: rgba(14,14,17,.8); color: #f4f4f5; font-size: 11px; font-weight: 600; }
.wp-live i { width: 6px; height: 6px; border-radius: 50%; background: var(--t); display: block; }
.wp-chero { position: relative; height: 200px; overflow: hidden; }
.wp-chero .wp-shade { background: linear-gradient(180deg, rgba(16,18,25,.35) 0, rgba(16,18,25,0) 30%, rgba(16,18,25,.6) 70%, #101219 100%); }
.wp-backb { position: absolute; left: 12px; top: 12px; height: 30px; padding: 0 10px 0 6px; border-radius: 15px; display: flex; align-items: center; gap: 2px;
  background: rgba(14,14,17,.72); color: #f4f4f5; font: 500 12.5px 'Inter', sans-serif; }
.wp-chero .in { position: absolute; left: 16px; right: 16px; bottom: 8px; }
.wp-chero .cn { display: flex; align-items: center; gap: 10px; font-size: 28px; font-weight: 700; letter-spacing: -.035em; color: #f4f4f5; }
.wp-chero .cn .flag { font-size: 24px; }
.wp-chero .cc { font-size: 12.5px; color: #a1a1aa; margin-top: 2px; }
.wp-cstats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; padding: 6px 14px 4px; }
.wp-cstats > div { padding: 10px 12px; border-radius: 12px; background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.07); }
.wp-cstats b { display: block; font-size: 18px; font-weight: 700; letter-spacing: -.03em; color: #f4f4f5; font-variant-numeric: tabular-nums; }
.wp-cstats span { font-size: 11.5px; color: #6b6b74; }
.wp-bsec { display: flex; align-items: center; padding: 14px 16px 8px; font-size: 12px; font-weight: 500; color: #a1a1aa; }
.wp-bsec .n { margin-left: auto; color: #6b6b74; font-size: 11.5px; }
.wp-pchips { display: flex; gap: 8px; padding: 0 14px 4px; overflow: hidden; }
.wp-pchip { flex: none; display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 14px 0 6px; border-radius: 20px;
  border: 1px solid rgba(255,255,255,.13); background: rgba(255,255,255,.03); color: #f4f4f5; font: 500 12.5px 'Inter', sans-serif; white-space: nowrap; }
.wp-pchip .ic { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; color: var(--t); background: var(--tf); }
.wp-pchip .oc { font-size: 11px; font-weight: 500; color: #6b6b74; }
.wp-pchip .oc.on { color: #4ade80; }
.wp-mcards { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 0 14px 14px; }
.wp-mcard { border-radius: 14px; overflow: hidden; color: #f4f4f5; border: 1px solid rgba(255,255,255,.07); background: rgba(255,255,255,.03); }
.wp-mcard.sel { border-color: var(--t); }
.wp-mcard .pic { position: relative; height: 104px; }
.wp-mcard .pic .wp-live { position: absolute; right: 8px; top: 8px; z-index: 1; }
.wp-mcard .tx { padding: 9px 11px 11px; }
.wp-mcard .nm { font-weight: 600; font-size: 12.5px; letter-spacing: -.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wp-mcard .sb { font-size: 11.5px; color: #6b6b74; }

/* hero card */
.wp-hero { position: relative; margin: 8px 12px; border-radius: 14px; }
.wp-hero .tick { position: absolute; inset: 0; border-radius: 14px; padding: 1px; overflow: hidden; opacity: .8;
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude; }
.wp-hero .tick i { position: absolute; left: 50%; top: 50%; width: 150%; aspect-ratio: 1; display: block;
  background: conic-gradient(transparent 0deg, rgba(180,154,255,.9) 38deg, transparent 80deg); }
.wp-hero-in { display: grid; grid-template-columns: minmax(0,1fr) auto; column-gap: 10px; align-items: center; border: 1px solid #1e2230; border-radius: 14px; padding: 12px;
  background: linear-gradient(160deg, #161923 0%, #12141b 100%); }
.wp-hero-top { display: flex; gap: 12px; align-items: center; min-width: 0; }
.wp-thumb { width: 44px; height: 44px; border-radius: 10px; flex: none; overflow: hidden; background: #0c0e13; border: 1px solid #1e2230; position: relative; }
.wp-hero-name { font-weight: 600; font-size: 15px; color: #e9eef4; letter-spacing: .01em; white-space: nowrap; }
.wp-hero-sub { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #6b7280; margin-top: 3px; white-space: nowrap; }
.wp-act { padding: 9px 14px; white-space: nowrap; border-radius: 9px; background: rgba(180,154,255,.1); border: 1px solid rgba(180,154,255,.4); color: #b49aff;
  font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 700; letter-spacing: .14em; text-shadow: 0 0 10px rgba(180,154,255,.3); display: flex; align-items: center; gap: 6px; }
.wp-opts { grid-column: 1 / -1; display: flex; gap: 8px; margin: 10px 0 0; }
.wp-seg { flex: 1; display: flex; padding: 3px; gap: 3px; background: #0c0e13; border: 1px solid #1e2230; border-radius: 9px; }
.wp-seg span { flex: 1; text-align: center; padding: 5px 0; border: 1px solid transparent; border-radius: 6px; color: #6b7280;
  font-family: 'JetBrains Mono', monospace; font-size: 9.5px; font-weight: 700; letter-spacing: .12em; }
.wp-seg span.on { background: #171a24; color: #b49aff; border-color: rgba(180,154,255,.3); }
.wp-mph { flex: none; display: flex; align-items: center; gap: 6px; padding: 0 8px; background: #0c0e13; border: 1px solid #1e2230; border-radius: 9px;
  font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: .14em; color: #6b7280; }
.wp-mph b { width: 46px; text-align: right; color: #b49aff; font-size: 13px; font-weight: 400; letter-spacing: 0; }
.wp-note { grid-column: 1 / -1; font-family: 'JetBrains Mono', monospace; font-size: 9.5px; color: #6b7280; margin: 8px 0 0; line-height: 1.5; }

/* now playing */
.wp-np { margin: 6px 12px 4px; padding: 12px 14px; border-radius: 12px; background: rgba(23,26,36,.7); border: 1px solid #1e2230; }
.wp-np-head { display: flex; align-items: baseline; gap: 8px; }
.wp-np-name { font-weight: 600; font-size: 13px; color: #e2e8f0; }
.wp-np-name small { color: #6b7280; font-weight: 400; font-size: 11px; margin-left: 6px; }
.wp-np-time { margin-left: auto; font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #b49aff; font-variant-numeric: tabular-nums; }
.wp-np-bar { height: 4px; border-radius: 4px; background: #1e2230; margin: 10px 0; overflow: hidden; }
.wp-np-bar i { display: block; height: 100%; width: 0; border-radius: 4px; background: linear-gradient(90deg, #63548c, #b49aff); box-shadow: 0 0 8px rgba(180,154,255,.5); }
.wp-np-ctl { display: flex; gap: 8px; }
.wp-ctl { flex: 1; text-align: center; padding: 7px 0; border-radius: 8px; border: 1px solid #1e2230; background: #12141b; color: #c9d1d9;
  font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: .06em; }
.wp-ctl.primary { background: rgba(180,154,255,.12); border-color: rgba(180,154,255,.4); color: #b49aff; }
.wp-ctl.on { color: #b49aff; border-color: rgba(180,154,255,.35); }

/* console */
.wp-conwrap { flex: 1; min-height: 90px; display: flex; flex-direction: column; border-top: 1px solid #1e2230; background: #0c0e13; }
.wp-seclabel { font-family: 'JetBrains Mono', monospace; font-size: 9px; font-weight: 700; letter-spacing: .22em; color: #6b7280; text-transform: uppercase; padding: 14px 18px 4px; }
.wp-console { flex: 1; min-height: 0; overflow: hidden; padding: 10px 16px 4px; font-family: 'JetBrains Mono', monospace; font-size: 11px; line-height: 1.75; color: #9aa4b2;
  display: flex; flex-direction: column; justify-content: flex-end; }
.wp-console .ln { white-space: pre; }
.wp-console .cmd { color: #dbe3ea; }
.wp-console .ps, .wp-prompt .ps { color: #b49aff; text-shadow: 0 0 8px rgba(180,154,255,.3); }
.wp-console .ok { color: #7ee787; }
.wp-console .accent { color: #b49aff; }
.wp-console .dim { color: #4b5563; }
.wp-prompt { flex: none; display: flex; align-items: center; padding: 4px 16px 12px; font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #dbe3ea; white-space: pre; }
.wp-prompt .ps { margin-right: 7px; }
.wp-caret { display: inline-block; width: 7px; height: 13px; margin-left: 2px; background: #b49aff; vertical-align: -2px; box-shadow: 0 0 6px rgba(180,154,255,.5); }

/* connect */
.wp-link { position: absolute; display: flex; flex-direction: column; align-items: center; text-align: center; width: 560px; }
.wp-link .shell { fill: #151821; stroke: #2a3042; stroke-width: 1.2; }
.wp-link .screen { fill: #0a0b0f; }
.wp-link .island { fill: #151821; }
.wp-link .port { fill: #0a0b0f; stroke: #2a3042; }
.wp-link-title { font-size: 22px; font-weight: 600; letter-spacing: -.01em; color: #e2e8f0; }
.wp-link-sub { margin-top: 6px; font-size: 13px; color: #8b949e; line-height: 1.45; }
.wp-steps { display: flex; gap: 8px; margin-top: 22px; }
.wp-lstep { display: flex; align-items: center; gap: 7px; padding: 6px 12px 6px 9px; border-radius: 99px; background: #11141b; border: 1px solid #1e2230; color: #6b7280; font-size: 12px; font-weight: 500; white-space: nowrap; }
.wp-lstep i { width: 14px; height: 14px; border-radius: 50%; border: 1.5px solid #2a3042; flex: none; display: grid; place-items: center; position: relative; }
.wp-lstep.done { color: #c9d1d9; }
.wp-lstep.done i { background: #7ee787; border-color: #7ee787; }
.wp-lstep.done i::after { content: ''; width: 6px; height: 3px; margin-top: -2px; border: solid #0c0e13; border-width: 0 0 1.6px 1.6px; transform: rotate(-45deg); }
.wp-lstep.now { color: #c9d1d9; border-color: rgba(180,154,255,.35); }
.wp-lstep.now i { border-color: #b49aff; border-top-color: transparent; }
`;

// Lucide icons the app uses (core/web/static/icons.js, lucide-static 0.460.0, ISC)
const ICONS = {
  'cable': '<path d="M17 21v-2a1 1 0 0 1-1-1v-1a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1a1 1 0 0 1-1 1"/><path d="M19 15V6.5a1 1 0 0 0-7 0v11a1 1 0 0 1-7 0V9"/><path d="M21 21v-2h-4"/><path d="M3 5h4V3"/><path d="M7 5a1 1 0 0 1 1 1v1a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a1 1 0 0 1 1-1V3"/>',
  'gauge': '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  'map': '<path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15"/><path d="M9 3.236v15"/>',
  'radio': '<path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/>',
  'link': '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'route': '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
  'map-pin': '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  'arrow-right': '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  'chevron-left': '<path d="m15 18-6-6 6-6"/>',
  'rotate-ccw': '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
};
const icon = (name, size = 16) => `<svg class="lu" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let _uiCss = false;
function uiCss() {
  if (_uiCss) return;
  document.head.appendChild(h('style', { text: UI_CSS }));
  _uiCss = true;
}
// colour custom properties a themed element needs (the app uses color-mix; mixed here once)
function tvars(color) {
  return { '--t': color, '--tb': rgba(color, 0.5), '--tg': rgba(color, 0.12), '--tf': rgba(color, 0.22), '--tw': rgba(color, 0.14), '--tr': rgba(color, 0.8) };
}

// ---------- library helpers (the app's own derivations, app.js) ----------
const LIBR = () => window.LIB.routes;
const cityRoutes = c => Object.values(LIBR()).filter(r => r.city === c);
const cityPlaces = c => LIB.places.filter(p => p.city === c);
const ACRONYMS = new Set(['jfk', 'mia', 'cdg', 'dxb', 'lax', 'lhr', 'nyc', 'sfo']);
function routeLabel(r) {
  if (r.label) return r.label;
  const w = r.id.replace(/-to-/g, ' → ').split(/[-_ ]+/).map(t => (ACRONYMS.has(t.toLowerCase()) ? t.toUpperCase() : t));
  const s_ = w.join(' ');
  return s_.charAt(0).toUpperCase() + s_.slice(1);
}
const miles = r => r.meters / 1609.34;
const modeWord = r => (r.modes.includes('drive') ? 'drive' : 'walk');
const cardSub = r => `${miles(r).toFixed(1)} mi · ${Math.round(r.seconds / 60)} min · ${modeWord(r)}`;
const plural = (n, word) => `${n} ${n === 1 ? word : word.endsWith('y') ? word.slice(0, -1) + 'ies' : word + 's'}`;

// ---------- map art (cards): a real OSM region if we baked one, else the route on graphite ----------
// Draws `lines` (arrays of [lat, lon]) fitted to w x h with padding, in the app's .art style.
function mapArt(lines, w, h_, color, pad = 26, region = null, opts = {}) {
  const pts = lines.flat();
  const fit = fitBox(pts, { x: 0, y: 0, w, h: h_ }, pad);
  const svg = s('svg', { width: w, height: h_, viewBox: `0 0 ${w} ${h_}` });
  if (region) svg.appendChild(mapGroup(region, fit, { rect: [0, 0, w, h_], lineScale: opts.lineScale ?? 0.9, counties: false,
    pal: { water: '#0f1118', ground: '#1b1c22', coast: '#2a2d38', park: '#1d2124', road: '#2b2e38', road2: '#373b47', ...(opts.pal || {}) } }));
  const groups = [];
  for (const line of lines) {
    if (line.length < 2) continue;
    const g = routeGroup(routeGeom(fit, line), color, opts.width ?? 2.6, opts.glow ?? 7, 0.25);
    const geom = g.geom, a = geom.pts[0], b = geom.pts[geom.pts.length - 1];
    g.appendChild(s('circle', { cx: f2(a[0]), cy: f2(a[1]), r: opts.startR ?? 2.6, fill: '#fff' }));
    g.appendChild(s('circle', { cx: f2(b[0]), cy: f2(b[1]), r: opts.endR ?? 3.6, fill: color, stroke: '#fff', 'stroke-width': 1.6 }));
    g.draw(1);
    svg.appendChild(g);
    groups.push(g);
  }
  const art = h('div', { class: 'wp-art' }, [svg]);
  art.fit = fit; art.routes = groups; art.svg = svg;
  return art;
}
// which baked region covers a city (for card art)
const REGION_OF = { 'Miami': 'mia', 'New York': 'nyc', 'Paris': 'par', 'Monaco': 'mco', 'London': 'lon', 'Dubai': 'dxb',
  'Tokyo': 'tyo', 'Cape Town': 'cpt', 'Rio de Janeiro': 'rio', 'Sydney': 'syd' };
const regionFor = c => (REGION_OF[c] && window.MAPS[REGION_OF[c]] ? REGION_OF[c] : null);

// ---------- components ----------
function uiGcard(city, w, half) {
  const ci = LIB.cities[city], rs = cityRoutes(city), ps = cityPlaces(city);
  const mi = rs.reduce((a, r) => a + miles(r), 0);
  const word = (n, s_) => (half ? n : plural(n, s_));
  const el = h('div', { class: 'wp-gcard', style: { width: px(w), ...tvars(ci.color) } });
  el.appendChild(mapArt(rs.map(r => r.line), w, half ? 136 : 168, ci.color, half ? 22 : 36, regionFor(city)));
  el.appendChild(h('div', { class: 'wp-shade' }));
  el.appendChild(h('div', { class: 'top', html: `<span class="go">${icon('arrow-right', 15)}</span>` }));
  el.appendChild(h('div', { class: 'bot', html: `<div class="cn">${esc(city)}</div><div class="wp-mchips">
      ${rs.length ? `<span class="wp-mchip">${icon('route', 12)}${word(rs.length, 'route')}</span>` : ''}
      ${ps.length ? `<span class="wp-mchip">${icon('map-pin', 12)}${word(ps.length, 'place')}</span>` : ''}
      ${mi ? `<span class="wp-mchip">${mi.toFixed(mi < 10 ? 1 : 0)} mi</span>` : ''}</div>` }));
  el.go = el.querySelector('.go');
  return el;
}

function uiCountry(country, flag, nCities, nRoutes) {
  return h('div', { class: 'wp-chead', html: `<span class="fl">${flag}</span><div><div class="nm">${esc(country)}</div><div class="sb">${plural(nCities, 'city')} · ${plural(nRoutes, 'route')}</div></div><span class="chev">${icon('chevron-down', 16)}</span>` });
}

// the Destinations gallery as the app lays it out (US group first: Miami/New York halves, ...)
function uiGallery(Wp) {
  const el = h('div', { class: 'wp-gallery' });
  const T = LIB.totals;
  el.appendChild(h('div', { class: 'wp-bhead', html: `<div><h2>Destinations</h2><div class="sub">${T.cities} cities in ${T.countries} countries</div></div><span class="wp-reset">${icon('rotate-ccw', 15)}</span>` }));
  const us = ['Miami', 'New York', 'Las Vegas', 'Los Angeles', 'Aspen'];
  const nR = us.reduce((a, c) => a + cityRoutes(c).length, 0);
  el.appendChild(uiCountry('United States', LIB.cities.Miami.flag, us.length, nR));
  const halves = h('div', { class: 'wp-halves' });
  const cw = Math.floor((Wp - 38) / 2);
  el.cards = {};
  for (const c of us) { const g = uiGcard(c, cw, true); el.cards[c] = g; halves.appendChild(g); }
  el.appendChild(halves);
  return el;
}

function localTimeFixed(c) { return { 'Miami': 'Fri 9:41 PM', 'New York': 'Fri 9:41 PM' }[c] || 'Fri 9:41 PM'; }

// a city's page: map header, stats, places with "open now", route cards
function uiCity(city, Wp, opts = {}) {
  const ci = LIB.cities[city], rs = cityRoutes(city), ps = cityPlaces(city);
  const mi = rs.reduce((a, r) => a + miles(r), 0), mins = Math.round(rs.reduce((a, r) => a + r.seconds, 0) / 60);
  const el = h('div', { class: 'wp-citypage', style: tvars(ci.color) });
  const hero = h('div', { class: 'wp-chero' });
  hero.appendChild(mapArt(rs.map(r => r.line), Wp, 200, ci.color, 40, regionFor(city)));
  hero.appendChild(h('div', { class: 'wp-shade' }));
  hero.appendChild(h('div', { class: 'wp-backb', html: `${icon('chevron-left', 16)}Destinations` }));
  hero.appendChild(h('div', { class: 'in', html: `<div class="cn"><span class="flag">${ci.flag}</span>${esc(city)}</div><div class="cc">${esc(ci.country)} · ${opts.time || localTimeFixed(city)} there</div>` }));
  el.appendChild(hero);
  const stats = h('div', { class: 'wp-cstats' });
  el.stat = [];
  for (const [v, l] of [[rs.length, rs.length === 1 ? 'route' : 'routes'], [mi, 'of road'], [mins, 'of driving']]) {
    const b = h('b'), d = h('div', {}, [b, h('span', { text: l })]);
    stats.appendChild(d); el.stat.push({ b, v });
  }
  el.setStats = k => { // k 0..1 counts the figures up
    const [a, b, c] = el.stat;
    a.b.textContent = String(Math.round(a.v * k));
    b.b.textContent = `${Math.round(b.v * k)} mi`;
    c.b.textContent = `${Math.round(c.v * k)} min`;
  };
  el.setStats(1);
  el.appendChild(stats);
  el.appendChild(h('div', { class: 'wp-bsec', html: `Places<span class="n">${ps.length}</span>` }));
  const chips = h('div', { class: 'wp-pchips' });
  // opening hours as the app shows them at 9:41 pm local (Friday): hotels have none
  const hoursTag = p => {
    if (!p.hours) return '';
    const [a, b] = p.hours, t = 21.68;
    const open = a < b ? t >= a && t < b : t >= a || t < b;
    const fmt = x => `${x % 12 || 12}${x < 12 ? 'am' : 'pm'}`;
    return `<span class="oc${open ? ' on' : ''}">${open ? 'open now' : 'opens ' + fmt(a)}</span>`;
  };
  el.chips = ps.map(p => {
    const c_ = h('div', { class: 'wp-pchip', html: `<span class="ic">${icon('map-pin', 14)}</span>${esc(p.name)}${hoursTag(p)}` });
    chips.appendChild(c_);
    return c_;
  });
  el.appendChild(chips);
  el.appendChild(h('div', { class: 'wp-bsec', html: `Routes<span class="n">${rs.length}</span>` }));
  const grid = h('div', { class: 'wp-mcards' });
  const cw = Math.floor((Wp - 38) / 2);
  const order = opts.order ? opts.order.map(id => rs.find(r => r.id === id)).concat(rs.filter(r => !opts.order.includes(r.id))) : rs;
  el.cards = {};
  for (const r of order) {
    const card = h('div', { class: 'wp-mcard' });
    const pic = h('div', { class: 'pic' }, [mapArt([r.line], cw, 104, ci.color, 16, regionFor(city))]);
    card.appendChild(pic);
    card.appendChild(h('div', { class: 'tx', html: `<div class="nm">${esc(routeLabel(r))}</div><div class="sb">${esc(cardSub(r))}</div>` }));
    grid.appendChild(card);
    el.cards[r.id] = card;
  }
  el.appendChild(grid);
  return el;
}

// the hero card for a route, with the engine picked and the speed set
function uiHero(r, engine = 'drive', mph = 35) {
  const el = h('div', { class: 'wp-hero' });
  const tick = h('div', { class: 'tick' }, [h('i')]);
  el.appendChild(tick);
  const ci = LIB.cities[r.city];
  const sub = `~${mph} mph · ${miles(r).toFixed(1)} mi · ${Math.round(r.seconds / 60)} min`;
  const inn = h('div', { class: 'wp-hero-in' });
  const thumb = h('div', { class: 'wp-thumb' }, [mapArt([r.line], 44, 44, ci.color, 6, null, { width: 1.8, glow: 4, startR: 1.4, endR: 2 })]);
  inn.appendChild(h('div', { class: 'wp-hero-top' }, [thumb, h('div', { style: { minWidth: 0 }, html: `<div class="wp-hero-name">${esc(routeLabel(r))}</div><div class="wp-hero-sub">${esc(sub)}</div>` })]));
  const act = h('div', { class: 'wp-act' }, [playSvg(9, C.accent), h('span', { text: 'PLAY ROUTE' })]);
  inn.appendChild(act);
  const seg = h('div', { class: 'wp-seg' }, [h('span', { text: 'SPOOF' }), h('span', { text: 'DRIVE' })]);
  const mphEl = h('div', { class: 'wp-mph', html: `MPH <b>${mph}</b>` });
  inn.appendChild(h('div', { class: 'wp-opts' }, [seg, mphEl]));
  inn.appendChild(h('div', { class: 'wp-note', text: engine === 'drive' ? 'real speed: the phone reports mph like a real drive.' : 'position only: follows the route’s slow-downs and stops.' }));
  el.appendChild(inn);
  el.setEngine = e => { seg.children[0].className = e === 'spoof' ? 'on' : ''; seg.children[1].className = e === 'drive' ? 'on' : ''; };
  el.setEngine(engine);
  el.setTick = deg => css(tick.firstChild, 'transform', `translate(-50%,-50%) rotate(${f2(deg)}deg)`);
  el.act = act;
  return el;
}

function uiNowPlaying(name, engine) {
  const el = h('div', { class: 'wp-np' });
  const time = h('span', { class: 'wp-np-time', text: 't+00:00' });
  el.appendChild(h('div', { class: 'wp-np-head' }, [playSvg(9, C.accent), h('span', { class: 'wp-np-name', html: `${esc(name)}<small>${engine}</small>` }), time]));
  const fill = h('i');
  el.appendChild(h('div', { class: 'wp-np-bar' }, [fill]));
  el.appendChild(h('div', { class: 'wp-np-ctl', html: '<span class="wp-ctl primary">■ STOP &amp; CLEAR</span><span class="wp-ctl on">FOLLOW</span>' }));
  el.set = (secs, frac) => {
    const m = Math.floor(secs / 60), sx = Math.floor(secs % 60);
    time.textContent = `t+${String(m).padStart(2, '0')}:${String(sx).padStart(2, '0')}`;
    css(fill, 'width', `${(clamp(frac) * 100).toFixed(2)}%`);
  };
  return el;
}

// console: label, scrollback, prompt with the block caret
function uiConsole() {
  const el = h('div', { class: 'wp-conwrap' });
  el.appendChild(h('div', { class: 'wp-seclabel', text: 'Console' }));
  const log = h('div', { class: 'wp-console' });
  el.appendChild(log);
  const typed = h('span', { text: '' });
  const caret = h('span', { class: 'wp-caret' });
  const prompt = h('div', { class: 'wp-prompt' }, [h('span', { class: 'ps', text: 'waypoint ›' }), typed, caret]);
  el.appendChild(prompt);
  el.lines = [];
  el.addLine = (html, cls = 'sys') => { const l = h('div', { class: 'ln ' + cls, html }); log.appendChild(l); el.lines.push(l); return l; };
  el.type = text => { if (typed.textContent !== text) typed.textContent = text; };
  el.caret = on => op(caret, on ? 1 : 0);
  el.prompt = prompt; el.log = log; el.typed = typed; el.caretEl = caret;
  return el;
}

// device pill: the phone's name, its state, the four check icons
function uiPill(name = 'iPhone', state = 'Ready') {
  const el = h('div', { class: 'wp-pill' });
  el.innerHTML = `<svg width="12" height="20" viewBox="0 0 12 20"><rect x="0.6" y="0.6" width="10.8" height="18.8" rx="2.6" fill="rgba(255,255,255,.08)" stroke="rgba(255,255,255,.55)" stroke-width="1.1"/><rect x="4" y="2" width="4" height="1.4" rx=".7" fill="rgba(255,255,255,.55)"/><circle cx="6" cy="10" r="1.6" fill="#22c55e"/></svg>
    <span class="name">${esc(name)}</span><span class="stat"><i></i><span class="st">${state}</span></span>
    <span class="mini">${['map', 'radio', 'link', 'gauge'].map(n => `<span class="ico">${icon(n, 14)}<span class="dot"></span></span>`).join('')}</span><span class="chev">${icon('chevron-down', 14)}</span>`;
  el.st = el.querySelector('.st');
  return el;
}

// The whole app window: titlebar + map | panel + status bar, the rainbow ring round its edge.
// The panel and map contents are passed in so each shot can stage its own state.
function uiWindow({ map, panel, mode = 'IDLE', pos = '25.7617, -80.1918' } = {}) {
  uiCss();
  const win = h('div', { class: 'wp wp-win' });
  const ring = h('div', { class: 'wp-ring' }, [h('i')]);
  const frame = h('div', { class: 'wp-frame' });
  const pill = uiPill();
  frame.appendChild(h('div', { class: 'wp-title' }, [pill, h('div', { class: 'spacer' }),
    h('span', { class: 'wp-winbtn', html: '<svg width="11" height="11" viewBox="0 0 11 11"><line x1="1.5" y1="5.5" x2="9.5" y2="5.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>' }),
    h('span', { class: 'wp-winbtn', html: '<svg width="11" height="11" viewBox="0 0 11 11"><path d="M2 2 L9 9 M9 2 L2 9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>' })]));
  const mapwrap = h('div', { class: 'wp-mapwrap' });
  const panelEl = h('div', { class: 'wp-panel' });
  if (map) mapwrap.appendChild(map);
  if (panel) panelEl.appendChild(panel);
  frame.appendChild(h('div', { class: 'wp-main' }, [mapwrap, panelEl]));
  const sb = h('div', { class: 'wp-status' });
  sb.innerHTML = `<span class="mode">MODE <b>${mode}</b></span><span>PHONE <b>iPhone · iOS 27.0</b></span><span>POS <b class="pos">${pos}</b></span><span>ELAPSED <b class="el">--:--</b></span><span class="flex"></span><span>SPD</span><div class="wp-gauge"><i></i></div>`;
  frame.appendChild(sb);
  win.appendChild(frame);
  win.appendChild(ring);
  win.mapwrap = mapwrap; win.panel = panelEl; win.pill = pill; win.status = sb;
  win.setMode = m => { sb.querySelector('.mode b').textContent = m; };
  win.setPos = p => { sb.querySelector('.pos').textContent = p; };
  win.setElapsed = e => { sb.querySelector('.el').textContent = e; };
  win.setGauge = k => css(sb.querySelector('.wp-gauge i'), 'width', `${(clamp(k) * 100).toFixed(1)}%`);
  // rainbow ring (ring.js: 5 s turn) plus the comet lap (13 s), as two conic sweeps
  const ri = ring.firstChild;
  win.setRing = (t, alpha = 0.55) => {
    const turn = (t / 5) * 360, lap = (t / 13) * 360;
    css(ri, 'background', `conic-gradient(from ${f2(lap)}deg, rgba(255,255,255,.95) 0deg, ${rgba('#ffffff', 0)} 10deg, transparent 316deg, ${rgba('#ffffff', 0.0)} 340deg, rgba(255,255,255,.55) 357deg, rgba(255,255,255,.95) 360deg), conic-gradient(from ${f2(turn)}deg, ${RAINBOW.concat(RAINBOW[0]).join(',')})`);
    op(ring, alpha);
  };
  win.setRing(0);
  return win;
}

// a HUD chip: label/value pairs
function uiHud(pairs) {
  const el = h('div', { class: 'wp-hud' });
  el.vals = pairs.map(([l, v]) => { el.appendChild(h('span', { class: 'lbl', text: l })); const s_ = h('span', { class: 'val', text: v }); el.appendChild(s_); return s_; });
  el.set = (...v) => v.forEach((x, i) => { if (el.vals[i].textContent !== x) el.vals[i].textContent = x; });
  return el;
}

function uiToast(msg) {
  const el = h('div', { class: 'wp wp-toast' });
  el.appendChild(playSvg(10, '#7ee787'));
  el.appendChild(h('span', { text: msg }));
  return el;
}

// a city tag on the world map: flag, name, "+N" more cities, count
function uiBub(name, color, flag, more, n) {
  uiCss();
  return h('div', { class: 'wp wp-bub', style: tvars(color), html: `<span class="fl">${flag}</span>${esc(name)}${more ? `<span class="more">+${more}</span>` : ''}<span class="n">${n}</span>` });
}

function uiMarker(color) {
  const el = h('div', { class: 'wp wp-marker', style: tvars(color) }, [h('div', { class: 'ring' }), h('div', { class: 'core' })]);
  el.ring = el.firstChild;
  return el;
}

// The connect screen's scene (index.html #link-scene), drawn bigger and posed by state.
function uiLink() {
  uiCss();
  const el = h('div', { class: 'wp wp-link' });
  const gid = 'rb' + _fxId++;
  el.innerHTML = `<svg viewBox="0 0 560 270" width="560" height="270" style="overflow:visible;margin-bottom:18px">
    <defs><linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="320" y2="0" spreadMethod="repeat">
      <stop offset="0" stop-color="#b49aff"/><stop offset=".17" stop-color="#7a8cff"/><stop offset=".33" stop-color="#c47aff"/><stop offset=".5" stop-color="#ff7ab8"/>
      <stop offset=".67" stop-color="#ffb37a"/><stop offset=".83" stop-color="#b8e67a"/><stop offset="1" stop-color="#b49aff"/></linearGradient>
      <filter id="${gid}g" x="-20%" y="-60%" width="140%" height="220%"><feGaussianBlur stdDeviation="5"/></filter></defs>
    <g><rect x="44" y="52" width="176" height="112" rx="9" class="shell"/><rect x="52" y="60" width="160" height="96" rx="4" class="screen"/>
      <g class="lmark" transform="translate(132 108) scale(.17) translate(-129 -127)"><path d="${LEAP.path}" fill="#2a3042" fill-rule="evenodd"/></g>
      <path d="M28 164 H236 L226 178 H38 Z" class="shell"/><rect x="230" y="166" width="10" height="7" rx="1.5" class="port"/></g>
    <path class="wbase" d="M240 169 C 300 169, 296 238, 360 238 S 466 236, 466 196" fill="none" stroke="#232836" stroke-width="6" stroke-linecap="round"/>
    <path class="wglow" d="M240 169 C 300 169, 296 238, 360 238 S 466 236, 466 196" fill="none" stroke="url(#${gid})" stroke-width="9" stroke-linecap="round" filter="url(#${gid}g)"/>
    <path class="wrgb" d="M240 169 C 300 169, 296 238, 360 238 S 466 236, 466 196" fill="none" stroke="url(#${gid})" stroke-width="4.5" stroke-linecap="round"/>
    <g class="pk"><circle r="2.6" fill="#fff"/><circle r="2.6" fill="#fff"/><circle r="2.6" fill="#fff"/></g>
    <rect class="plug" x="460" y="186" width="12" height="11" rx="2.5" fill="#ff7ab8"/>
    <g><rect x="422" y="30" width="88" height="158" rx="17" class="shell"/><rect x="428" y="36" width="76" height="146" rx="12" class="screen pscreen"/>
      <rect x="452" y="42" width="28" height="8" rx="4" class="island"/>
      <g class="glock" fill="none" stroke-width="2" stroke-linecap="round"><rect x="456" y="104" width="20" height="16" rx="3.5" fill="#e3b341"/><path d="M459.5 104 V98.5 a6.5 6.5 0 0 1 13 0 V104" stroke="#e3b341"/></g>
      <g class="gcheck" stroke-linecap="round" stroke-linejoin="round"><circle cx="466" cy="108" r="13" fill="rgba(126,231,135,.14)" stroke="#7ee787" stroke-width="1.4"/><path d="M459.5 108.5 L464 113 L472.5 103.5" fill="none" stroke="#7ee787" stroke-width="2.4"/></g></g>
  </svg>
  <div class="wp-link-title">Connect your iPhone</div><div class="wp-link-sub">Plug it into this Mac with a USB cable.</div>
  <div class="wp-steps"><div class="wp-lstep"><i></i>Plugged in</div><div class="wp-lstep"><i></i>Unlocked</div><div class="wp-lstep"><i></i>Ready</div></div>`;
  const q = sel => el.querySelector(sel);
  const wire = q('.wrgb'), glow = q('.wglow'), pk = [...q('.pk').children], lock = q('.glock'), check = q('.gcheck');
  const lmark = q('.lmark path'), title = q('.wp-link-title'), sub = q('.wp-link-sub'), steps = [...el.querySelectorAll('.wp-lstep')];
  const L = wire.getTotalLength ? 400 : 400;
  el.steps = steps;
  // draw 0..1 lights the wire, flow = seconds (rainbow drift + packets), state per step: 0 idle 1 now 2 done
  el.set = ({ draw = 1, flow = 0, glowA = 0.75, phone = 'lock', checkS = 1, stepState = [2, 2, 2], titleTxt, subTxt, markOn = 1 }) => {
    for (const p of [wire, glow]) { p.setAttribute('stroke-dasharray', `${f2(L * draw)} ${L + 10}`); }
    op(glow, glowA * draw);
    const shift = (flow / 3) * 320 % 320;
    el.querySelector('linearGradient').setAttribute('gradientTransform', `translate(${f2(shift)} 0)`);
    const len = wire.getTotalLength();
    pk.forEach((c, i) => {
      const u = ((flow / 1.8) + i / 3) % 1;
      const p = wire.getPointAtLength(u * len);
      c.setAttribute('cx', f2(p.x)); c.setAttribute('cy', f2(p.y));
      op(c, draw >= 1 ? 0.9 : 0);
    });
    op(lock, phone === 'lock' ? 1 : 0);
    op(check, phone === 'check' ? 1 : 0);
    check.setAttribute('transform', `translate(466 108) scale(${checkS.toFixed(4)}) translate(-466 -108)`);
    q('.pscreen').setAttribute('fill', phone === 'check' ? '#10131b' : '#0a0b0f');
    lmark.setAttribute('fill', mix('#2a3042', C.accent, markOn));
    steps.forEach((st, i) => { st.className = 'wp-lstep' + (stepState[i] === 2 ? ' done' : stepState[i] === 1 ? ' now' : ''); });
    if (titleTxt !== undefined && title.textContent !== titleTxt) title.textContent = titleTxt;
    if (subTxt !== undefined && sub.textContent !== subTxt) sub.textContent = subTxt;
  };
  return el;
}

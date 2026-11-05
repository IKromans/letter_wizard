/* Skanītis — shared dreamy sky and quiet background music for every page.
   Day (real sunrise → sunset in Latvia): a soft pastel sky, a glowing sun, slow clouds, floating blossoms and the odd flock of birds.
   Night: softly twinkling, slowly drifting stars and the moon in its real current phase.
   The sun and moon travel across the sky along a gentle arc, at their position for the current time of day / night.
   Preview either scene with ?sky=day or ?sky=night in the address; the ☀️/🌙 button ([data-sky-btn]) switches by hand.
   Music has its own button on every page ([data-music-btn], setting "bb_music"), separate from the game sounds button ("bb_mute").
   window.Sky.chime() plays the shared "sound on" ding. */
(() => {
  "use strict";
  /* Pages never reload while moving around, so the sky and the music keep going:
     the home page (its <script data-shell>) is the "shell" — it owns the sky canvas and the music, and opens a game
     in a full-window frame on top (index.html#burtinu_burvis), sharing the address bar history (Back returns home).
     Inside that frame this script is the "embedded" side: no canvas or music of its own; it hands the game's
     background, title and button presses (music, day/night, Sākums) to the shell. A game opened directly
     moves itself into the shell (a tiny script in its <head>); add ?solo to the address to open it on its own. */
  const ROLE = document.currentScript?.hasAttribute("data-shell") ? "shell" : window.parent !== window ? "embedded" : "solo";
  const EMBEDDED = ROLE === "embedded", SHELL = ROLE === "shell";
  const MSG = "skanitis";
  const toShell = data => { try { parent.postMessage({ [MSG]: data }, "*"); } catch { /* no shell */ } };
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const rand = (a, b) => a + Math.random() * (b - a);
  // Random gaps like real events (a Poisson process): usually around `mean`, sometimes very soon, sometimes long. Never below `min`.
  const wait = (mean, min = 0) => min + -Math.log(1 - Math.random()) * mean;
  const WIND = Math.random() < .5 ? 1 : -1;                              // the day's wind direction (changes from visit to visit)
  const RAD = Math.PI / 180, DAY_MS = 86400000;

  /* ---------------- real sun times ----------------
     The standard "sunrise equation" for Riga (close enough for all of Latvia): no location permission needed. */
  const LAT = 56.95, LON = 24.11;
  function sunTimes(day) {
    const noon = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12);
    const n = Math.round(noon / DAY_MS + 2440587.5 - 2451545);           // days since 1 Jan 2000
    const Js = n - LON / 360;                                             // mean solar noon
    const M = (357.5291 + .98560028 * Js) % 360;                          // solar mean anomaly
    const C = 1.9148 * Math.sin(M * RAD) + .02 * Math.sin(2 * M * RAD) + .0003 * Math.sin(3 * M * RAD);
    const L = (M + C + 180 + 102.9372) % 360;                             // ecliptic longitude
    const Jt = 2451545 + Js + .0053 * Math.sin(M * RAD) - .0069 * Math.sin(2 * L * RAD);   // solar noon
    const sinD = Math.sin(L * RAD) * Math.sin(23.4397 * RAD), cosD = Math.cos(Math.asin(sinD));
    const cosW = (Math.sin(-.833 * RAD) - Math.sin(LAT * RAD) * sinD) / (Math.cos(LAT * RAD) * cosD);
    const w = Math.acos(Math.max(-1, Math.min(1, cosW))) / RAD;          // half the length of the day, in degrees
    const toDate = J => new Date((J - 2440587.5) * DAY_MS);
    return { rise: toDate(Jt - w / 360), set: toDate(Jt + w / 360) };
  }
  // Preview / testing: ?skytime=15:30 starts the sky clock at that time today, ?skyspeed=600 makes it run 600× faster
  // (a whole day in ~2.5 minutes). Without them the sky uses the real time.
  const params = new URLSearchParams(location.search);
  const startReal = Date.now(), speed = Math.max(1, Number(params.get("skyspeed")) || 1);
  const skyStart = (() => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(params.get("skytime") || "");
    if (!m) return startReal;
    const d = new Date(); d.setHours(+m[1], +m[2], 0, 0); return +d;
  })();
  const previewing = speed > 1 || skyStart !== startReal;
  const skyNow = () => new Date(skyStart + (Date.now() - startReal) * speed);

  // Is the sun up right now, and how far through the current day or night are we (0 = just started, 1 = ending)?
  function skyClock(t = skyNow()) {
    const today = sunTimes(t);
    if (t >= today.rise && t < today.set) return { up: true, p: (t - today.rise) / (today.set - today.rise) };
    const start = t < today.rise ? sunTimes(new Date(+t - DAY_MS)).set : today.set;
    const end = t < today.rise ? today.rise : sunTimes(new Date(+t + DAY_MS)).rise;
    return { up: false, p: (t - start) / (end - start) };
  }

  // Which scene to show, in order of priority:
  //   1. ?sky=day / ?sky=night in the address (for previewing),
  //   2. the ☀️/🌙 button choice, remembered for this browser tab (sessionStorage), so it carries across pages,
  //   3. otherwise the real sun: day between sunrise and sunset, night the rest of the time.
  const forced = new URLSearchParams(location.search).get("sky");
  const valid = m => m === "day" || m === "night";
  const chosen = () => { try { return sessionStorage.getItem("bb_sky"); } catch { return null; } };
  const bySun = () => skyClock().up ? "day" : "night";
  // (while previewing with ?skytime / ?skyspeed, an earlier button choice is ignored so the preview follows the sun)
  let pressedHere = false;
  const pickMode = () => valid(forced) ? forced : (!previewing && valid(chosen())) ? chosen() : bySun();
  let mode = pickMode();
  document.documentElement.dataset.sky = mode;

  /* ---------------- canvas ---------------- */
  const cv = document.createElement("canvas");
  cv.setAttribute("aria-hidden", "true");
  cv.style.cssText = "position:fixed;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none";
  const cx = cv.getContext("2d");
  let W = 0, H = 0, dpr = 1, lastDraw = 0, raf = 0;

  const sprite = (w, h, paint) => {
    const c = document.createElement("canvas");
    c.width = Math.ceil(w * dpr); c.height = Math.ceil(h * dpr);
    const g = c.getContext("2d"); g.scale(dpr, dpr); paint(g, w, h);
    return c;
  };

  /* ---------------- the path of the sun and moon ----------------
     A gentle arc: rising low on the left, highest in the middle of the day / night, setting low on the right.
     Every page uses the same path: a shallow arc through the open "sky strip" right below the button row
     (the strip is clamp(64px, 12vh, 110px) tall — the pages keep that space free), so the sun / moon
     stays put when moving between the home page and the games. */
  let arc = null, skyP = .5, lastClock = -1e9, gameToolsBottom = null;   // while a game is open: where its button row ends
  const toolsBottom = () => { const r = document.querySelector(".toolbar, .tools")?.getBoundingClientRect(); return r ? r.bottom + scrollY : null; };
  function buildArc() {
    const stripTop = gameToolsBottom ?? toolsBottom() ?? (W <= 600 ? 16 : 26) + 42;
    const strip = Math.max(64, Math.min(110, H * .12));
    const r = Math.max(16, Math.min(Math.max(26, Math.min(48, W * .036)), strip * .4));
    const top = stripTop + strip / 2 - strip * .06;
    arc = { apexX: W / 2, top, horizon: top + strip * .5, left: W * .05, right: W * .95, r, bandTop: 10, bandBottom: stripTop + strip - 6 };
  }
  function arcPoint(p) {
    p = Math.max(0, Math.min(1, p));
    const x = p < .5 ? arc.left + (arc.apexX - arc.left) * p * 2 : arc.apexX + (arc.right - arc.apexX) * (p - .5) * 2;
    const height = Math.pow(Math.sin(Math.PI * p), .6);                  // stays high most of the time, dips near rise / set
    return { x, y: arc.horizon - (arc.horizon - arc.top) * height, low: 1 - height };   // low: 0 at the top, 1 at the horizon
  }
  function updateClock(now) {                                             // the real position changes slowly; check every 5 s
    if (now - lastClock < (previewing ? 0 : 5000)) return;
    lastClock = now;
    skyP = skyClock().p;
  }

  /* ---------- night: stars and the moon ---------- */
  const STAR_TINTS = ["255,255,255", "255,236,200", "205,225,255", "225,210,255"];
  const SYNODIC = 29.530588853, NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);   // a known new moon
  let stars = [], starSprites = [], moon = null;

  // 0 = new moon, .25 = first quarter, .5 = full moon, .75 = last quarter
  const moonPhase = () => ((((+skyNow() - NEW_MOON) / DAY_MS) % SYNODIC + SYNODIC) % SYNODIC) / SYNODIC;

  function moonSprite(r, f) {
    return sprite(r * 2, r * 2, g => {
      g.translate(r, r);
      g.fillStyle = "rgba(255,240,215,.13)";                              // the unlit part still shows faintly
      g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill();
      if (f > .5) { g.scale(-1, 1); f = 1 - f; }                          // waning moon: lit on the left (as seen from Latvia)
      const c = Math.cos(2 * Math.PI * f);
      const grd = g.createRadialGradient(-r * .2, -r * .25, r * .05, 0, 0, r);
      grd.addColorStop(0, "#fffdf3"); grd.addColorStop(.6, "#fff0c4"); grd.addColorStop(1, "#f3d28f");
      g.fillStyle = grd; g.beginPath();
      g.arc(0, 0, r, -Math.PI / 2, Math.PI / 2);                          // the lit right half…
      g.ellipse(0, 0, r * Math.abs(c), r, 0, Math.PI / 2, -Math.PI / 2, c > 0);   // …trimmed or widened by the shadow line
      g.fill();
    });
  }

  function buildNight() {
    const r = arc.r * .92, f = moonPhase();
    moon = { r, img: moonSprite(r, f), light: (1 - Math.cos(2 * Math.PI * f)) / 2 };
    starSprites = STAR_TINTS.map(rgb => sprite(32, 32, (g, w) => {
      const grd = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      grd.addColorStop(0, `rgba(${rgb},1)`); grd.addColorStop(.12, `rgba(${rgb},.9)`);
      grd.addColorStop(.3, `rgba(${rgb},.25)`); grd.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = grd; g.fillRect(0, 0, w, w);
    }));
    stars = Array.from({ length: Math.min(220, Math.round(W * H / 7000)) }, () => {
      const big = Math.random() < .08, size = big ? rand(7, 12) : rand(3, 6.5);
      return {
        x: rand(0, W), y: rand(0, H), size, depth: size / 12,              // bigger = "closer" = drifts faster
        base: big ? rand(.55, .85) : rand(.25, .65), amp: rand(.25, .6),
        speed: Math.PI * 2 / rand(4000, 13000), phase: rand(0, 7),         // one twinkle every 4–13 s
        tint: Math.random() < .7 ? 0 : 1 + Math.floor(Math.random() * 3)
      };
    });
    stationImg = stationSprite();
    meteors = []; satellites = []; station = null;
    const t = performance.now();
    nextMeteor = t + wait(5000, 1500); nextSatellite = t + wait(12000, 3000); nextStation = t + wait(30000, 10000);
  }

  /* ---------- night visitors: shooting stars, satellites and a little space station ---------- */
  let meteors = [], satellites = [], station = null, stationImg = null, nextMeteor = 0, nextSatellite = 0, nextStation = 0;

  // a straight path across the open sky band of the page (above the game panel), from one side to the other
  function crossing(speed, inset) {
    const top = arc.bandTop + inset, bottom = Math.max(top + 1, arc.bandBottom - inset);
    const dir = Math.random() < .5 ? 1 : -1, y0 = rand(top, bottom), y1 = rand(top, bottom);
    const x0 = dir > 0 ? -40 : W + 40, x1 = dir > 0 ? W + 40 : -40, len = Math.hypot(x1 - x0, y1 - y0);
    return { x: x0, y: y0, vx: (x1 - x0) / len * speed, vy: (y1 - y0) / len * speed };
  }

  function stationSprite() {
    return sprite(46, 24, g => {
      const panel = (x) => {
        const grd = g.createLinearGradient(x, 4, x + 14, 20);
        grd.addColorStop(0, "#7ea2ff"); grd.addColorStop(1, "#33499a");
        g.fillStyle = grd; g.fillRect(x, 5, 14, 14);
        g.strokeStyle = "rgba(255,255,255,.35)"; g.lineWidth = .7;
        for (let i = 1; i < 3; i++) { g.beginPath(); g.moveTo(x + i * 14 / 3, 5); g.lineTo(x + i * 14 / 3, 19); g.stroke(); }
        g.beginPath(); g.moveTo(x, 12); g.lineTo(x + 14, 12); g.stroke();
      };
      g.strokeStyle = "#d8d2ee"; g.lineWidth = 1.4;                       // the truss holding the panels
      g.beginPath(); g.moveTo(3, 12); g.lineTo(43, 12); g.stroke();
      panel(2); panel(30);
      g.fillStyle = "#f1edfb";                                            // the living module, with a little window
      g.beginPath(); g.roundRect ? g.roundRect(17, 7, 12, 10, 4) : g.rect(17, 7, 12, 10); g.fill();
      g.fillStyle = "#9fd4ff"; g.beginPath(); g.arc(23, 12, 2.2, 0, 7); g.fill();
    });
  }

  function drawVisitors(now, dt) {
    // satellites: tiny steady lights gliding across; some catch the sunlight and flare for a moment
    if (now > nextSatellite) {
      const s = crossing(rand(10, 34), 4);
      s.flareAt = Math.random() < .3 ? rand(.25, .75) : -1; s.fadeAt = Math.random() < .3 ? rand(.35, .8) : 2;
      s.bright = rand(.5, 1); s.age = 0; s.span = (W + 80) / Math.hypot(s.vx, s.vy);
      satellites.push(s); nextSatellite = now + wait(25000, 4000);
    }
    for (const s of satellites) {
      s.x += s.vx * dt; s.y += s.vy * dt; s.age += dt;
      const p = s.age / s.span, flare = s.flareAt < 0 ? 0 : Math.exp(-Math.pow((p - s.flareAt) * 18, 2));   // a short, smooth brightening
      const shadow = p < s.fadeAt ? 1 : Math.max(0, 1 - (p - s.fadeAt) * 12);   // some slide into Earth's shadow and fade out
      if (shadow <= 0) continue;
      cx.globalAlpha = (s.bright * .75 + .25 * flare) * shadow;
      cx.fillStyle = "#fffbe8"; cx.beginPath(); cx.arc(s.x, s.y, 1.3 + 2.2 * flare, 0, 7); cx.fill();
      if (flare > .05) {
        const g = cx.createRadialGradient(s.x, s.y, 0, s.x, s.y, 14 * flare + 2);
        g.addColorStop(0, `rgba(255,250,225,${.6 * flare})`); g.addColorStop(1, "rgba(255,250,225,0)");
        cx.fillStyle = g; cx.beginPath(); cx.arc(s.x, s.y, 14 * flare + 2, 0, 7); cx.fill();
      }
    }
    satellites = satellites.filter(s => s.x > -60 && s.x < W + 60);

    // the space station: drifts slowly, rocks gently, blinks its red light
    if (!station && now > nextStation) {
      station = crossing(rand(22, 34), 16);
      station.phase = rand(0, 7); station.scale = rand(1.05, 1.35);
    }
    if (station) {
      const s = station;
      s.x += s.vx * dt; s.y += s.vy * dt;
      cx.save();
      cx.translate(s.x, s.y); cx.rotate(Math.sin(now * .0006 + s.phase) * .18); cx.scale(s.scale, s.scale);
      cx.globalAlpha = .92;
      cx.drawImage(stationImg, -23, -12, 46, 24);
      if (Math.floor((now + s.phase * 1000) / 600) % 2 === 0) {            // blinking navigation light
        cx.globalAlpha = 1;
        const g = cx.createRadialGradient(23, -6, 0, 23, -6, 7);
        g.addColorStop(0, "rgba(255,90,110,1)"); g.addColorStop(1, "rgba(255,90,110,0)");
        cx.fillStyle = g; cx.beginPath(); cx.arc(23, -6, 7, 0, 7); cx.fill();
      }
      cx.restore();
      if (s.x < -80 || s.x > W + 80) { station = null; nextStation = now + wait(70000, 25000); }
    }

    drawPlanes(now, dt);

    // shooting stars: each one different in speed, length, brightness and colour; now and then two close together,
    // and rarely a slow, bright fireball
    if (now > nextMeteor) {
      const band = arc.bandBottom - arc.bandTop, steep = band > 220;
      const make = () => {
        const fireball = Math.random() < .06, dir = Math.random() < .5 ? 1 : -1;
        const angle = (steep ? rand(15, 50) : rand(5, 16)) * RAD, speed = fireball ? rand(150, 230) : rand(240, 460);
        const tint = fireball ? "255,214,170" : pick(["225,235,255", "225,235,255", "225,235,255", "205,255,225", "255,225,195"]);
        return {
          x: rand(W * .08, W * .92), y: arc.bandTop + rand(0, band * (steep ? .6 : .45)), vx: Math.cos(angle) * speed * dir, vy: Math.sin(angle) * speed,
          age: 0, life: fireball ? rand(2, 3) : rand(.9, 1.8), len: fireball ? rand(180, 280) : rand(60, 160),
          width: fireball ? rand(3.2, 4.2) : rand(1.4, 2.6), bright: fireball ? 1 : rand(.5, 1), tint, head: fireball ? 16 : rand(5, 9)
        };
      };
      meteors.push(make());
      if (Math.random() < .15) setTimeout(() => { if (mode === "night") meteors.push(make()); }, rand(250, 2500));
      nextMeteor = now + wait(9000, 1500);
    }
    for (const m of meteors) {
      m.age += dt; m.x += m.vx * dt; m.y += m.vy * dt;
      const a = Math.sin(Math.PI * Math.min(1, m.age / m.life)) * m.bright, sp = Math.hypot(m.vx, m.vy);
      const tx = m.x - m.vx / sp * m.len, ty = m.y - m.vy / sp * m.len;
      const g = cx.createLinearGradient(m.x, m.y, tx, ty);
      g.addColorStop(0, `rgba(255,255,255,${.95 * a})`); g.addColorStop(.3, `rgba(${m.tint},${.45 * a})`); g.addColorStop(1, `rgba(${m.tint},0)`);
      cx.globalAlpha = 1; cx.strokeStyle = g; cx.lineWidth = m.width; cx.lineCap = "round";
      cx.beginPath(); cx.moveTo(m.x, m.y); cx.lineTo(tx, ty); cx.stroke();
      const glow = cx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.head);    // a soft glowing head
      glow.addColorStop(0, `rgba(255,255,255,${a})`); glow.addColorStop(.35, `rgba(${m.tint},${.5 * a})`); glow.addColorStop(1, `rgba(${m.tint},0)`);
      cx.fillStyle = glow; cx.beginPath(); cx.arc(m.x, m.y, m.head, 0, 7); cx.fill();
    }
    meteors = meteors.filter(m => m.age < m.life);
    cx.globalAlpha = 1;
  }

  /* ---------- planes (day and night) ----------
     Day: a tiny silhouette high up, leaving a white contrail that forms just behind it, slowly spreads, drifts with the
     wind and fades: long-lasting in humid air, shorter or none in dry air, sometimes double. Always one continuous
     trail, only gently denser and thinner along its length, like real contrails.
     Night: no trail, only the red and green wing lights and a white double-flash strobe. */
  let planes = [], nextPlane = 0;
  function spawnPlane(now) {
    const p = crossing(rand(9, 20), 6), r = Math.random();
    Object.assign(p, {
      size: rand(5, 8.5), heading: Math.atan2(p.vy, p.vx), trail: [], lastDrop: 0, phase: rand(0, 2000),
      trailLife: r < .1 ? 0 : r < .35 ? rand(9000, 18000) : rand(28000, 75000),   // none / shorter / long-lasting
      double: Math.random() < .3, strength: rand(.6, 1),                  // how dense this plane's trail is
      wobble: [rand(.0003, .0007), rand(.0011, .0019), rand(0, 7), rand(0, 7)]   // slow, smooth changes along the trail
    });
    planes.push(p);
    nextPlane = now + wait(mode === "day" ? 35000 : 45000, 8000);
  }
  function glowDot(x, y, rgb, r, a) {
    const g = cx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`);
    cx.fillStyle = g; cx.beginPath(); cx.arc(x, y, r, 0, 7); cx.fill();
  }
  function drawPlanes(now, dt) {
    if (now > nextPlane) spawnPlane(now);
    const night = mode === "night";
    for (const p of planes) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      const ux = Math.cos(p.heading), uy = Math.sin(p.heading), s = p.size, visible = p.x > -40 && p.x < W + 40;
      if (!night && visible && p.trailLife && now - p.lastDrop > 250) {   // the trail forms a little behind the plane
        p.lastDrop = now;
        const gap = s * 2.4, [f1, f2, o1, o2] = p.wobble;
        const density = .72 + .18 * Math.sin(now * f1 + o1) + .1 * Math.sin(now * f2 + o2);   // smooth, never a gap
        p.trail.push({ x: p.x - ux * gap, y: p.y - uy * gap, t: now, density });
      }
      if (p.trail.length) {
        cx.lineCap = "butt";                                              // flat ends: segments join into one smooth line
        for (let i = 1; i < p.trail.length; i++) {
          const a = p.trail[i - 1], b = p.trail[i];
          const age = (now - b.t) / p.trailLife;
          if (age >= 1) continue;
          cx.strokeStyle = `rgba(255,255,255,${.58 * p.strength * b.density * Math.pow(1 - age, 1.3)})`;
          cx.lineWidth = (1.1 + age * 8) * (.85 + .3 * b.density);        // spreads out as it ages
          const off = p.double ? 1.6 + age * 2.5 : 0, nx = -uy * off, ny = ux * off;
          for (const k of p.double ? [-1, 1] : [0]) {
            cx.beginPath(); cx.moveTo(a.x + nx * k, a.y + ny * k); cx.lineTo(b.x + nx * k, b.y + ny * k); cx.stroke();
          }
        }
        for (const q of p.trail) q.x += WIND * 2.5 * dt;                  // drifts slowly with the wind
        p.trail = p.trail.filter(q => now - q.t < p.trailLife);
      }
      if (!visible) continue;
      cx.save(); cx.translate(p.x, p.y); cx.rotate(p.heading);
      if (night) {
        glowDot(-s * .3, -s * .9, "255,80,90", 4, .9);                    // red wing light
        glowDot(-s * .3, s * .9, "90,255,140", 4, .9);                    // green wing light
        const blink = (now + p.phase) % 1400;
        if (blink < 70 || (blink > 180 && blink < 250)) glowDot(-s, 0, "255,255,255", 7, 1);   // white double-flash strobe
      } else {
        cx.fillStyle = "rgba(60,58,105,.75)";
        cx.beginPath(); cx.ellipse(0, 0, s, s * .16, 0, 0, 7); cx.fill();                // body
        cx.beginPath(); cx.moveTo(s * .15, 0); cx.lineTo(-s * .25, -s * .85); cx.lineTo(-s * .45, -s * .85); cx.lineTo(-s * .15, 0);
        cx.lineTo(-s * .45, s * .85); cx.lineTo(-s * .25, s * .85); cx.closePath(); cx.fill();   // swept wings
        cx.beginPath(); cx.moveTo(-s * .8, 0); cx.lineTo(-s, -s * .35); cx.lineTo(-s * 1.08, -s * .35); cx.lineTo(-s * .95, 0);
        cx.lineTo(-s * 1.08, s * .35); cx.lineTo(-s, s * .35); cx.closePath(); cx.fill();         // tail
      }
      cx.restore();
    }
    planes = planes.filter(p => (p.x > -40 && p.x < W + 40) || p.trail.length);
  }

  function drawNight(now, dt, still) {
    for (const s of stars) {
      if (!still) {
        s.x += 3.4 * s.depth * dt; s.y -= 1.4 * s.depth * dt;              // slow drift, a few px per second
        if (s.x > W + 10) s.x = -10;
        if (s.y < -10) s.y = H + 10;
      }
      cx.globalAlpha = s.base * (still ? 1 : 1 - s.amp * (.5 + .5 * Math.sin(now * s.speed + s.phase)));
      cx.drawImage(starSprites[s.tint], s.x - s.size / 2, s.y - s.size / 2, s.size, s.size);
    }
    cx.globalAlpha = 1;
    if (!still) drawVisitors(now, dt);
    // the moon on its path, with a slowly breathing glow (brighter when the moon is fuller)
    const { x, y } = arcPoint(skyP), { r, img, light } = moon, pulse = still ? 1 : 1 + .06 * Math.sin(now * .0008);
    const g = cx.createRadialGradient(x, y, r * .4, x, y, r * 5 * pulse);
    g.addColorStop(0, `rgba(255,240,200,${.08 + .16 * light})`); g.addColorStop(1, "rgba(200,190,255,0)");
    cx.fillStyle = g; cx.beginPath(); cx.arc(x, y, r * 5 * pulse, 0, 7); cx.fill();
    cx.drawImage(img, x - r, y - r, r * 2, r * 2);
  }

  /* ---------- day: sun, clouds, blossoms, birds ---------- */
  const PETALS = ["#ffd1e3", "#fff3f8", "#e4d3ff", "#ffe1c9", "#d8f3ff"];
  let skyGrad = null, clouds = [], blossoms = [], blossomSprites = [], birds = [], nextFlock = 0, sun = null;

  function cloudSprite(w, h) {
    return sprite(w, h, g => {
      const n = 6;
      for (let i = 0; i < n; i++) {
        const middle = 1 - Math.abs(i - (n - 1) / 2) / ((n - 1) / 2);   // puffs in the middle are bigger
        const px = w * (.16 + .68 * i / (n - 1)) + rand(-8, 8), py = h * (.6 - .14 * middle) + rand(-4, 4);
        const r = h * (.28 + .22 * middle) + rand(0, h * .06);
        const grd = g.createRadialGradient(px, py, 0, px, py, r);
        grd.addColorStop(0, "rgba(255,252,255,.95)"); grd.addColorStop(.55, "rgba(255,244,252,.6)");
        grd.addColorStop(1, "rgba(255,236,248,0)");
        g.fillStyle = grd; g.beginPath(); g.arc(px, py, r, 0, 7); g.fill();
      }
    });
  }

  function buildDay() {
    skyGrad = cx.createLinearGradient(0, 0, 0, H);
    skyGrad.addColorStop(0, "rgba(150,192,252,.6)");
    skyGrad.addColorStop(.55, "rgba(202,182,242,.52)");
    skyGrad.addColorStop(1, "rgba(255,206,214,.55)");
    sun = { r: arc.r };
    const cloudCount = W < 700 ? 4 : 6;
    clouds = Array.from({ length: cloudCount }, (_, i) => {
      const w = rand(200, 380) * Math.min(1, Math.max(.6, W / 1000)), h = w * .42;
      return { x: rand(-w, W), y: rand(H * .04, H * .5) + (i % 2) * 30, w, h, speed: rand(14, 30), alpha: rand(.5, .72), img: cloudSprite(w, h) };   // speed in px per second
    });
    blossomSprites = PETALS.map(col => sprite(26, 26, g => {
      g.translate(13, 13); g.fillStyle = col;
      for (let k = 0; k < 5; k++) { g.rotate(Math.PI * 2 / 5); g.beginPath(); g.ellipse(0, -6, 4, 6.2, 0, 0, 7); g.fill(); }
      g.fillStyle = "#ffd76a"; g.beginPath(); g.arc(0, 0, 2.6, 0, 7); g.fill();
    }));
    blossoms = Array.from({ length: Math.min(36, Math.max(8, Math.round(W * H / 32000))) }, () => newBlossom(rand(0, H)));
    birds = []; nextFlock = performance.now() + wait(9000, 2000);
  }

  function newBlossom(y) {
    return {
      x: rand(0, W), y, size: rand(10, 18), vx: WIND * rand(0, 7) + rand(-2, 2), vy: rand(7, 15),
      rot: rand(0, 7), vr: rand(-.5, .5), sway: rand(6, 18), swaySpeed: rand(.0005, .0012), phase: rand(0, 7),
      alpha: rand(.5, .85), img: Math.floor(Math.random() * PETALS.length)
    };
  }

  function spawnFlock(now) {
    const dir = Math.random() < .5 ? 1 : -1, speed = rand(30, 64);
    const baseY = rand(arc.bandTop + 10, Math.max(arc.bandTop + 20, arc.bandBottom - 10));
    const n = pick([1, 1, 2, 2, 3, 3, 4, 5, 7]), vee = n >= 5 && Math.random() < .6;   // bigger flocks often fly in a V
    for (let i = 0; i < n; i++) {
      const rank = vee ? Math.ceil(i / 2) : i, side = vee ? (i % 2 ? -1 : 1) : 0;
      birds.push({
        x: (dir > 0 ? -30 : W + 30) - dir * rank * (vee ? 18 : rand(14, 30)),
        y: baseY + (vee ? side * rank * 10 : rand(-16, 16)), dir, speed: speed * (vee ? 1 : rand(.9, 1.1)),
        size: rand(5.5, 10), flap: rand(.008, .014), phase: rand(0, 7)
      });
    }
    nextFlock = now + wait(18000, 4000);
  }

  function drawBird(b, now) {
    const s = b.size, f = Math.sin(now * b.flap + b.phase) * .65, x = b.x, y = b.y + Math.sin(now * .002 + b.phase) * 3;
    cx.beginPath();
    cx.moveTo(x - s, y - s * f);
    cx.quadraticCurveTo(x - s * .4, y - s * .2, x, y + s * .15);
    cx.quadraticCurveTo(x + s * .4, y - s * .2, x + s, y - s * f);
    cx.stroke();
  }

  function drawDay(now, dt, still) {
    cx.fillStyle = skyGrad; cx.fillRect(0, 0, W, H);
    {                                                                     // the sun on its path, breathing very gently
      const { x, y, low } = arcPoint(skyP), r = sun.r, pulse = still ? 1 : 1 + .07 * Math.sin(now * .001);
      // a little warmer and rosier near sunrise and sunset
      let g = cx.createRadialGradient(x, y, r * .5, x, y, r * 6 * pulse);
      g.addColorStop(0, `rgba(255,${Math.round(220 - 55 * low)},${Math.round(150 - 20 * low)},${.42 + .12 * low})`); g.addColorStop(1, "rgba(255,200,150,0)");
      cx.fillStyle = g; cx.beginPath(); cx.arc(x, y, r * 6 * pulse, 0, 7); cx.fill();
      g = cx.createRadialGradient(x - r * .3, y - r * .3, r * .1, x, y, r);
      g.addColorStop(0, "#fffbea"); g.addColorStop(.55, low > .7 ? "#ffd08a" : "#ffe08f"); g.addColorStop(1, low > .7 ? "#f39a62" : "#f7b660");
      cx.fillStyle = g; cx.beginPath(); cx.arc(x, y, r, 0, 7); cx.fill();
    }
    for (const c of clouds) {
      if (!still) {
        c.x += c.speed * WIND * dt;                                       // all clouds drift with the same wind
        if (WIND > 0 ? c.x > W + 20 : c.x < -c.w - 20) { c.x = WIND > 0 ? -c.w - rand(20, 200) : W + rand(20, 200); c.y = rand(H * .04, H * .5); }
      }
      cx.globalAlpha = c.alpha; cx.drawImage(c.img, c.x, c.y, c.w, c.h);
    }
    cx.globalAlpha = 1;
    if (!still) drawPlanes(now, dt);
    if (!still) {
      if (now > nextFlock) spawnFlock(now);
      cx.strokeStyle = "rgba(48,42,92,.55)"; cx.lineCap = "round"; cx.lineJoin = "round";
      for (const b of birds) { b.x += b.dir * b.speed * dt; cx.lineWidth = Math.max(1.3, b.size * .17); drawBird(b, now); }
      birds = birds.filter(b => b.x > -120 && b.x < W + 120);
    }
    for (const p of blossoms) {
      if (!still) {
        p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        if (p.y > H + 20) Object.assign(p, newBlossom(-20));
        if (p.x > W + 20) p.x = -20; else if (p.x < -20) p.x = W + 20;
      }
      const x = p.x + Math.sin(now * p.swaySpeed + p.phase) * p.sway;
      cx.save(); cx.globalAlpha = p.alpha; cx.translate(x, p.y); cx.rotate(p.rot);
      cx.drawImage(blossomSprites[p.img], -p.size / 2, -p.size / 2, p.size, p.size);
      cx.restore();
    }
  }

  /* ---------- frame loop ---------- */
  function build() {
    buildArc(); lastClock = -1e9;
    planes = []; nextPlane = performance.now() + wait(12000, 3000);
    mode === "day" ? buildDay() : buildNight();
    draw(performance.now(), true);
  }

  function fit() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    build();
  }

  function draw(now, force) {
    if (!force && now - lastDraw < 33) return;                            // ~30 fps is plenty for slow motion
    const dt = force ? 0 : Math.min(now - lastDraw, 100) / 1000;
    lastDraw = now;
    const still = reduceMotion.matches || force;
    updateClock(now);
    cx.clearRect(0, 0, W, H);
    mode === "day" ? drawDay(now, dt, still && reduceMotion.matches) : drawNight(now, dt, still);
    cx.globalAlpha = 1;
  }

  function loop(now) { draw(now, false); raf = reduceMotion.matches ? 0 : requestAnimationFrame(loop); }

  function startSky() {
    document.body.prepend(cv);
    fit();
    addEventListener("resize", fit);
    document.fonts?.ready.then(fit);                                       // re-measure the page once fonts are in
    if (!reduceMotion.matches) raf = requestAnimationFrame(loop);
    reduceMotion.addEventListener?.("change", () => { if (!reduceMotion.matches && !raf) raf = requestAnimationFrame(loop); draw(performance.now(), true); });
    setInterval(() => { if (pressedHere) return; const m = pickMode(); if (m !== mode) setScene(m); }, previewing ? 1000 : 60000);   // switch at sunrise / sunset
  }

  // Switch scene with a short fade. The music follows on its next bar.
  let fading = 0;
  function setScene(m) {
    clearTimeout(fading);
    cv.style.transition = "opacity .45s ease";
    cv.style.opacity = "0";
    fading = setTimeout(() => {
      mode = m;
      document.documentElement.dataset.sky = mode;
      build();
      cv.style.opacity = "1";
      showSkyButtons();
      tellStage();
    }, reduceMotion.matches ? 0 : 450);
  }

  /* ---------------- day/night button ([data-sky-btn]) ---------------- */
  const SKY_LABELS = { lv: { day: "☀️ Diena", night: "🌙 Nakts" }, en: { day: "☀️ Day", night: "🌙 Night" } };
  const SKY_HINTS = { lv: { day: "Pārslēgt uz dienu", night: "Pārslēgt uz nakti" }, en: { day: "Switch to day", night: "Switch to night" } };
  function showSkyButtons() {
    const lang = SKY_LABELS[document.documentElement.lang] ? document.documentElement.lang : "lv";
    document.querySelectorAll("[data-sky-btn]").forEach(b => {
      const other = mode === "day" ? "night" : "day";                    // the label shows where the button takes you
      b.textContent = SKY_LABELS[lang][other];
      b.setAttribute("aria-label", SKY_HINTS[lang][other]);
    });
  }
  function toggleScene() {
    if (EMBEDDED) return toShell({ sky: "toggle" });
    pressedHere = true;
    const m = mode === "day" ? "night" : "day";
    try { sessionStorage.setItem("bb_sky", m); } catch { /* private browsing */ }
    setScene(m);
  }

  /* ---------------- music ----------------
     A tiny generative lullaby: a warm pad, a soft harp roll on every chord and a music-box melody
     built from short motifs that repeat and vary (A A B A), so it feels like a little song, not random notes. */
  let enabled = (() => { try { return JSON.parse(localStorage.getItem("bb_music")) !== false; } catch { return true; } })();   // music on unless switched off
  let ac = null, master = null, warm = null, clear = null, playing = false, ticker = 0, chirpTimer = 0;
  const VOLUME = .25;                                                     // overall loudness (0–1); stays below the games' own sound effects
  const hz = m => 440 * Math.pow(2, (m - 69) / 12);
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const MUSIC = {
    // chords are MIDI notes; the melody uses the scale. Night: C major pentatonic lullaby. Day: brighter, a bit quicker.
    night: { bpm: 60, chords: [[48, 55, 64, 71], [45, 52, 60, 67], [53, 57, 60, 64], [55, 59, 62, 69]], scale: [72, 74, 76, 79, 81, 84, 86, 88] },
    day:   { bpm: 72, chords: [[53, 57, 60, 64], [48, 55, 64, 67], [50, 57, 62, 65], [55, 59, 62, 67]], scale: [72, 74, 76, 77, 79, 81, 84, 86, 88] }
  };
  const RHYTHMS = [[0, 1, 2, 3], [0, 1.5, 2, 3], [0, 1, 1.5, 2], [0, 2, 2.5], [0, .5, 1, 2], [0, 1, 2]];

  function setupAudio() {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    const mix = ac.createGain(), comp = ac.createDynamicsCompressor();
    comp.threshold.value = -24; comp.ratio.value = 3;
    master = ac.createGain(); master.gain.value = 0;
    // warm bus (pad + harp) is softened; clear bus (music box, chirps) keeps its sparkle and gets a gentle echo
    const lowWarm = ac.createBiquadFilter(); lowWarm.type = "lowpass"; lowWarm.frequency.value = 1500;
    const lowClear = ac.createBiquadFilter(); lowClear.type = "lowpass"; lowClear.frequency.value = 6000;
    warm = ac.createGain(); clear = ac.createGain();
    warm.connect(lowWarm); lowWarm.connect(mix);
    clear.connect(lowClear); lowClear.connect(mix);
    const echo = ac.createDelay(2), feedback = ac.createGain(), echoOut = ac.createGain();
    echo.delayTime.value = .5; feedback.gain.value = .28; echoOut.gain.value = .25;
    lowClear.connect(echo); echo.connect(feedback); feedback.connect(echo); echo.connect(echoOut); echoOut.connect(mix);
    const verb = ac.createConvolver(), len = ac.sampleRate * 4, ir = ac.createBuffer(2, len, ac.sampleRate);
    for (let ch = 0; ch < 2; ch++) {                                      // soft generated reverb: decaying stereo noise
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    verb.buffer = ir;
    const dry = ac.createGain(), wet = ac.createGain();
    dry.gain.value = .6; wet.gain.value = .7;
    mix.connect(dry); mix.connect(verb); verb.connect(wet);
    dry.connect(comp); wet.connect(comp); comp.connect(master); master.connect(ac.destination);
  }

  // one oscillator with a quick attack and a natural exponential fade
  function pluck(freq, t, gain, decay, type, out, detune = 0) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = freq; o.detune.value = detune;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + .006);
    g.gain.exponentialRampToValueAtTime(.0001, t + decay);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + decay + .05);
  }

  function musicBox(m, t, vel = 1) {
    const f = hz(m);
    pluck(f, t, .07 * vel, 2.4, "sine", clear);
    pluck(f * 2, t, .02 * vel, 1.1, "sine", clear);
    pluck(f * 4.02, t, .006 * vel, .35, "sine", clear);                   // the tiny metallic "ting"
  }

  function harp(chord, t) {
    [...chord.map(n => n + 12), chord[0] + 24].forEach((n, i) => pluck(hz(n), t + i * .075, .03, 2.6, "triangle", warm));
  }

  function pad(chord, t, dur) {
    chord.forEach(n => [["sine", 0, .024], ["triangle", 5, .009], ["triangle", -5, .009]].forEach(([type, det, gain]) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.value = hz(n); o.detune.value = det;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + 2.2);
      g.gain.setValueAtTime(gain, t + dur - .3);
      g.gain.linearRampToValueAtTime(0, t + dur + 2.8);                   // overlaps softly into the next chord
      o.connect(g); g.connect(warm); o.start(t); o.stop(t + dur + 3);
    }));
  }

  // melody helpers: notes are indexes into the scale; the first note of each motif lands on a chord tone
  const clampIdx = (i, scale) => Math.max(0, Math.min(scale.length - 1, i));
  function toChordTone(i, scale, chord) {
    const pcs = chord.map(n => n % 12);
    for (const d of [0, 1, -1, 2, -2, 3, -3]) { const j = clampIdx(i + d, scale); if (pcs.includes(scale[j] % 12)) return j; }
    return i;
  }
  function makeMotif(scale) {
    let i = Math.floor(rand(2, scale.length - 3));
    return pick(RHYTHMS).map((b, k) => { if (k) i = clampIdx(i + pick([-2, -1, -1, 0, 1, 1, 2]), scale); return { b, i }; });
  }

  let bar = 0, nextBar = 0, motifA = null, motifB = null, motifMode = "";
  function scheduleBar(t) {
    const m = MUSIC[mode], beat = 60 / m.bpm, chordNo = Math.floor(bar / 2) % 4, chord = m.chords[chordNo], second = bar % 2;
    if (motifMode !== mode || bar % 16 === 0) { motifA = makeMotif(m.scale); motifB = makeMotif(m.scale); motifMode = mode; }
    if (!second) {
      pad(chord, t, 8 * beat);
      harp(chord, t);
      // first bar of each chord: the motif (A, A, B, A), nudged so it fits the chord
      const motif = chordNo === 2 ? motifB : motifA, shift = toChordTone(motif[0].i, m.scale, chord) - motif[0].i;
      motif.forEach(({ b, i }, k) => musicBox(m.scale[clampIdx(i + shift, m.scale)], t + b * beat, k ? .8 : 1));
    } else if (Math.random() < .75) {
      // second bar: a calm answer, one or two long notes on chord tones
      const j = toChordTone(Math.floor(rand(1, m.scale.length - 2)), m.scale, chord);
      musicBox(m.scale[j], t, .85);
      if (Math.random() < .5) musicBox(m.scale[toChordTone(clampIdx(j - 2, m.scale), m.scale, chord)], t + 2 * beat, .7);
    }
    bar++;
    return t + 4 * beat;
  }

  function tick() {                                                       // schedule a little ahead, so timing stays smooth
    if (!playing) return;
    while (nextBar < ac.currentTime + 1.2) nextBar = scheduleBar(nextBar);
  }

  function chirps() {
    if (!playing) return;
    if (mode === "day") {
      const n = 2 + Math.floor(Math.random() * 2), base = rand(2600, 3300);
      for (let i = 0; i < n; i++) {
        const t = ac.currentTime + .05 + i * rand(.1, .14), o = ac.createOscillator(), g = ac.createGain();
        o.type = "sine";
        o.frequency.setValueAtTime(base, t);
        o.frequency.exponentialRampToValueAtTime(base * rand(1.25, 1.45), t + .06);
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.012, t + .015); g.gain.linearRampToValueAtTime(0, t + .085);
        o.connect(g); g.connect(clear); o.start(t); o.stop(t + .1);
      }
    }
    chirpTimer = setTimeout(chirps, rand(7000, 16000));
  }

  // Starts the music. Browsers decide whether sound may start before the visitor has clicked:
  // if the audio engine is allowed to run we begin straight away, otherwise on the first click, tap or key press.
  function play() {
    if (EMBEDDED || playing || !enabled || document.hidden) return;
    try { if (!ac) setupAudio(); } catch { return; }
    if (ac.state === "running") return begin();
    const p = ac.resume?.();
    if (p && p.then) p.then(() => { if (ac.state === "running") begin(); }, () => {});
  }

  function begin() {
    if (playing || !enabled || document.hidden) return;
    playing = true;
    removeGestureListeners();
    const t = ac.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(master.gain.value, t);
    master.gain.linearRampToValueAtTime(VOLUME, t + 3);                   // gentle fade-in
    bar = 0; nextBar = t + .15;
    tick(); ticker = setInterval(tick, 250);
    chirpTimer = setTimeout(chirps, 6000);
  }

  function stop() {
    if (!playing) return;
    playing = false;
    clearInterval(ticker); clearTimeout(chirpTimer);
    const t = ac.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(master.gain.value, t);
    master.gain.linearRampToValueAtTime(0, t + 1.2);
  }

  const GESTURES = ["pointerdown", "keydown", "touchend", "click"];
  const onGesture = () => play();
  const removeGestureListeners = () => GESTURES.forEach(n => removeEventListener(n, onGesture, true));
  if (!EMBEDDED) GESTURES.forEach(n => addEventListener(n, onGesture, true));
  document.addEventListener("visibilitychange", () => {
    if (EMBEDDED) return;
    if (document.hidden) { stop(); ac?.suspend?.(); } else { play(); if (ac && ac.state !== "running") ac.resume?.().catch?.(() => {}); }
  });

  /* ---------------- music button ([data-music-btn]) ----------------
     Every page has the same "🎵 Mūzika" button; it is handled here so it behaves identically everywhere.
     Labels follow the page language (<html lang>), which each page updates when the language changes. */
  const MUSIC_LABELS = { lv: ["🎵 Mūzika", "🔕 Bez mūzikas"], en: ["🎵 Music", "🔕 Music off"] };
  function showMusicButtons() {
    const words = MUSIC_LABELS[document.documentElement.lang] || MUSIC_LABELS.lv;
    document.querySelectorAll("[data-music-btn]").forEach(b => {
      b.textContent = enabled ? words[0] : words[1];
      b.setAttribute("aria-pressed", String(enabled));
    });
  }
  function setMusic(on) {
    if (EMBEDDED) return toShell({ music: !!on });
    enabled = !!on;
    try { localStorage.setItem("bb_music", JSON.stringify(enabled)); } catch { /* private browsing */ }
    showMusicButtons();
    enabled ? play() : stop();
    tellStage();
  }

  /* ---------------- button sound ----------------
     Every toolbar button (".tool") on every page plays the same soft, magical sparkle when game sounds are on
     (the 🔊 Skaņa setting "bb_mute"). Three quick, high music-box notes with a light echo; deliberately quiet. */
  const SPARKLES = [[84, 88, 91], [86, 88, 93], [83, 86, 91], [88, 91, 95]];   // high, but not piercing
  let sfx = null;
  const soundsOn = () => { try { return JSON.parse(localStorage.getItem("bb_mute")) !== true; } catch { return true; } };
  // Browsers pause the audio engine until the first click, and we pause it when the tab is hidden.
  // So: wake it up first and only then schedule the notes; otherwise they can be lost (Safari especially).
  function whenAudioRuns(fn) {
    try { if (!ac) setupAudio(); } catch { return; }
    if (ac.state === "running") return fn();
    let done = false;
    const go = () => { if (!done && ac.state === "running") { done = true; fn(); } };
    const p = ac.resume?.();
    if (p && p.then) p.then(go, () => {});
    setTimeout(go, 120);                                                  // some browsers resume without settling the promise
  }

  function sparkle() {
    if (EMBEDDED) return toShell({ sparkle: true });                     // the shell's audio is already awake
    whenAudioRuns(() => {
      if (!sfx) {                                                         // its own small output with a soft echo, independent of the music volume
        sfx = ac.createGain();
        const echo = ac.createDelay(1), fb = ac.createGain(), echoOut = ac.createGain();
        echo.delayTime.value = .16; fb.gain.value = .3; echoOut.gain.value = .45;
        sfx.connect(ac.destination); sfx.connect(echo); echo.connect(fb); fb.connect(echo); echo.connect(echoOut); echoOut.connect(ac.destination);
      }
      const t = ac.currentTime + .02;
      pick(SPARKLES).forEach((m, i) => {
        const f = hz(m) * rand(.997, 1.003);
        pluck(f, t + i * .06, .028, .6, "sine", sfx);
        pluck(f * 2, t + i * .06, .005, .25, "sine", sfx);
        pluck(f / 2, t + i * .06, .008, .35, "triangle", sfx);            // a soft lower body, so it is easier to hear
      });
    });
  }
  const chime = sparkle;                                                  // kept for pages that call Sky.chime()


  /* ---------------- toolbar buttons on phones ----------------
     Every ".tool" button label is "emoji + words". On narrow screens only the emoji is shown (the words stay
     available to screen readers), so all buttons fit on one line. Short labels like "LV" are always shown. */
  const toolStyle = document.createElement("style");
  toolStyle.textContent = ".tool{display:inline-flex;align-items:center;justify-content:center;gap:.35em}" +
    // the burst: the motion is one long glide (fast launch, slowing down gradually right to the end);
    // size, spin and fade each run on their own gentle timing, so nothing stops abruptly
    ".sky-burst{position:fixed;z-index:20;pointer-events:none;font-weight:800;font-size:var(--size);color:var(--c);text-shadow:0 0 10px currentColor,0 0 22px currentColor;" +
      "translate:-50% -50%;opacity:0;" +
      "animation:skyGlide var(--t) cubic-bezier(.22,.61,.36,1) forwards,skyPop var(--t) ease-out forwards,skySpin var(--t) cubic-bezier(.3,.5,.4,1) forwards,skyFade var(--t) linear forwards}" +
    "@keyframes skyGlide{from{translate:-50% -50%}to{translate:calc(-50% + var(--fx)) calc(-50% + var(--fy))}}" +
    "@keyframes skyPop{0%{scale:.2}18%{scale:var(--s1)}100%{scale:.8}}" +
    "@keyframes skySpin{from{rotate:0deg}to{rotate:var(--rot)}}" +
    "@keyframes skyFade{0%{opacity:0}5%{opacity:1}60%{opacity:1}100%{opacity:0}}" +
    ".sky-ring{position:fixed;z-index:19;pointer-events:none;width:24px;height:24px;border-radius:50%;border:2px solid var(--c);box-shadow:0 0 18px var(--c),inset 0 0 12px var(--c);transform:translate(-50%,-50%) scale(.2);opacity:.9;animation:skyRing .9s ease-out forwards}" +
    "@keyframes skyRing{to{transform:translate(-50%,-50%) scale(var(--grow));opacity:0}}" +
    "@media(prefers-reduced-motion:reduce){.sky-burst,.sky-ring{display:none}}" +
    "html[data-sky=day] :is(.brand h1,.sub,.footer,footer,.credit,.hero h1,.eyebrow,.intro,.choose){text-shadow:0 1px 8px rgba(30,24,80,.5)}" +
    "html[data-sky=day] :is(.footer,footer,.credit){color:#f3eefc}" +
    "@media(max-width:680px){.tool{min-width:42px;padding-inline:10px}.tool .tl:not(.keep){position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}}";
  document.head.append(toolStyle);
  function splitLabel(b) {
    if (b.querySelector(".tl") || b.children.length) return;           // already split, or custom markup
    const m = b.textContent.trim().match(/^(\S+)\s+(.+)$/u);
    if (!m) return;
    const icon = document.createElement("span"), words = document.createElement("span");
    icon.setAttribute("aria-hidden", "true"); icon.textContent = m[1];
    words.className = m[2].length <= 3 ? "tl keep" : "tl"; words.textContent = m[2];
    b.replaceChildren(icon, words);
    b.title = m[2];
  }
  function watchTools() {
    document.querySelectorAll(".tool").forEach(b => {
      splitLabel(b);
      new MutationObserver(() => splitLabel(b)).observe(b, { childList: true, characterData: true, subtree: true });
    });
  }

  /* ---------------- Krāsas burst ([data-burst]) ----------------
     Changing colours sends a little burst of glowing characters out of the button, in the new theme's colours:
     stars on the home page, letters in the typing game, digits in the math game. */
  const BURST = {
    stars: "✦✧",
    digits: "0123456789",
    letters: { lv: "aābcčdeēfgģhiījkķlļmnņoprsštuūvzž", en: "abcdefghijklmnopqrstuvwxyz" }
  };
  function burst(btn) {
    const kind = btn.dataset.burst, set = kind === "letters" ? (BURST.letters[document.documentElement.lang] || BURST.letters.lv) : BURST[kind];
    if (!set || reduceMotion.matches) return;
    const chars = [...set], css = getComputedStyle(document.documentElement);
    const colours = [css.getPropertyValue("--gold").trim() || "#ffd166", css.getPropertyValue("--gold").trim() || "#ffd166", css.getPropertyValue("--mint").trim() || "#75e6c1", "#ffffff"];
    const r = btn.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    const reach = Math.max(innerWidth, innerHeight);                    // how far the magic can fly on this screen

    // a glowing ring flashes out of the button
    for (const [grow, delay] of [[14, 0], [24, .12]]) {
      const ring = document.createElement("span");
      ring.className = "sky-ring"; ring.setAttribute("aria-hidden", "true");
      ring.style.left = x + "px"; ring.style.top = y + "px";
      ring.style.setProperty("--c", colours[0]); ring.style.setProperty("--grow", grow);
      ring.style.animationDelay = delay + "s";
      document.body.appendChild(ring);
      setTimeout(() => ring.remove(), 1300);
    }

    // the characters: a few close, most flying far across the page, each with its own size, spin and float
    const count = innerWidth < 600 ? 32 : 48;
    for (let i = 0; i < count; i++) {
      const el = document.createElement("span");
      const angle = rand(-.2, 1.2) * Math.PI;                             // mostly sideways and down (the button is at the top)
      const dist = reach * Math.pow(Math.random(), .7) * rand(.35, .85) + 40;
      const dx = Math.cos(angle) * dist, dy = Math.sin(angle) * dist;
      let ch = chars[Math.floor(Math.random() * chars.length)];
      if (kind === "letters" && Math.random() < .3) ch = ch.toUpperCase();
      el.className = "sky-burst"; el.textContent = ch; el.setAttribute("aria-hidden", "true");
      el.style.left = x + "px"; el.style.top = y + "px";
      el.style.setProperty("--dx", dx + "px"); el.style.setProperty("--dy", dy + "px");
      el.style.setProperty("--fx", dx + rand(-40, 40) + "px");          // where it ends up, drifting a little
      el.style.setProperty("--fy", dy + rand(20, 90) + "px");           // and sinking gently like falling sparkles
      el.style.setProperty("--size", (Math.random() < .15 ? rand(30, 44) : rand(14, 28)) + "px");
      el.style.setProperty("--s1", rand(1, 1.4));
      el.style.setProperty("--rot", rand(-300, 300) + "deg");
      el.style.setProperty("--c", pick(colours)); el.style.setProperty("--t", rand(2.2, 3.2) + "s");
      el.style.animationDelay = rand(0, .18) + "s";
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 3600);
    }
  }

  window.Sky = { setMusic, chime };

  function startPage() {
    startSky();
    watchTools();
    document.addEventListener("click", e => { const b = e.target.closest?.("[data-burst]"); if (b) burst(b); });
    document.addEventListener("click", e => {
      const tool = e.target.closest?.(".tool");
      if (!tool || !soundsOn()) return;
      sparkle();
      // a link (Sākums) would leave the page before the sparkle is heard: follow it a moment later
      if (tool.tagName === "A" && tool.href && !e.defaultPrevented && e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && tool.target !== "_blank") {
        e.preventDefault();
        setTimeout(() => { location.href = tool.href; }, 220);
      }
    });
    document.querySelectorAll("[data-music-btn]").forEach(b => b.addEventListener("click", () => setMusic(!enabled)));
    document.querySelectorAll("[data-sky-btn]").forEach(b => b.addEventListener("click", toggleScene));
    showMusicButtons();
    showSkyButtons();
    new MutationObserver(() => { showMusicButtons(); showSkyButtons(); })
      .observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    play();                                                               // try to start right away
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startPage);
  else startPage();
})();

"use client";

import { useEffect, useRef, useCallback } from "react";

export default function NightFuryRadar() {
  const canvasRef = useRef(null);
  const gameRef = useRef(null);
  const animFrameRef = useRef(null);

  const initGame = useCallback((canvas) => {
    const ctx = canvas.getContext("2d");
    const W = canvas.width;
    const H = canvas.height;

    /* ─── Assets ─── */
    const dragonImg = new Image();
    dragonImg.src = "/dragon.png";

    const pulseSound = new Audio("/fah.mp3");
    pulseSound.volume = 0.5;

    /* ─── State ─── */
    const STATE = {
      mode: "START",
      score: 0,
      highScore: 0,
      crashTimer: 0,
      crashDuration: 80,
    };

    /* ─── Player ─── */
    const player = {
      x: W * 0.22,
      y: H / 2,
      vy: 0,
      vx: 0,
      baseSpeed: 4.5, // HARDER (was 3.2)
      width: 56,
      height: 32,
      gravity: 0.13,
      lift: -0.48,
      drag: 0.96,
      dragX: 0.93,
    };

    /* ─── Pulse ─── */
    const pulse = {
      energy: 100,
      max: 100,
      cost: 22,
      rechargeBase: 0.09,
      rechargeFast: 0.22,
    };
    const pulses = [];

    /* ─── World ─── */
    let obstacles = [];
    let scrollX = 0;
    const GAP = 220; // HARDER (was 270)
    let nextObs = W + 250;
    const particles = [];
    const shake = { i: 0, decay: 0.86 };
    const sonar = { bars: new Array(48).fill(0), energy: 0 };
    const keys = {};

    /* ─── Powerups ─── */
    const powerups = [];
    let nextPowerup = W + 500;
    const activePowerups = {
      immunity: { active: false, timer: 0, duration: 180 },
      fireball: { active: false, timer: 0 },
    };
    const POWERUP_TYPES = {
      IMMUNITY: { type: 'immunity', color: '#39ff14', symbol: '◆', duration: 180 },
      FIREBALL: { type: 'fireball', color: '#ff4444', symbol: '◉', duration: 0 },
      PLASMA: { type: 'plasma', color: '#44aaff', symbol: '◈', duration: 0 },
    };

    /* ─── Input ─── */
    function onKeyDown(e) {
      keys[e.code] = true;
      if (e.code === "Space") {
        e.preventDefault();
        if (STATE.mode === "START") startGame();
        else if (STATE.mode === "PLAY") firePulse();
        else if (STATE.mode === "CRASH" && STATE.crashTimer <= 0) startGame();
      }
    }
    function onKeyUp(e) { keys[e.code] = false; }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    /* ─── Obstacle Generation ─── */
    function makePillar(x, isTop, pairH = 0) {
      const minH = 60; // HARDER: Taller min obstacles
      const maxH = pairH > 0
        ? Math.max(minH, H - pairH - player.height * 3.8) // HARDER: Tighter gap (was 4.5)
        : H * 0.6;
      const h = minH + Math.random() * (maxH - minH);
      const w = 55 + Math.random() * 70;
      const segs = 10;
      const pts = [];

      if (isTop) {
        pts.push({ x, y: 0 });
        for (let i = 0; i <= segs; i++) {
          const f = i / segs;
          const bulge = Math.sin(f * Math.PI) * w * 0.15;
          const noise = Math.sin(f * 11 + x * 0.01) * 8;
          pts.push({
            x: x + f * w + bulge + noise,
            y: f * h * 0.85 + Math.random() * h * 0.15,
          });
        }
        pts.push({ x: x + w, y: 0 });
      } else {
        pts.push({ x, y: H });
        for (let i = 0; i <= segs; i++) {
          const f = i / segs;
          const bulge = Math.sin(f * Math.PI) * w * 0.15;
          const noise = Math.sin(f * 13 + x * 0.02) * 8;
          pts.push({
            x: x + f * w + bulge + noise,
            y: H - (f * h * 0.85 + Math.random() * h * 0.15),
          });
        }
        pts.push({ x: x + w, y: H });
      }

      return { x, w, h, points: pts, opacity: 0, revealT: 0, isTop };
    }

    /* ─── Start / Reset ─── */
    function startGame() {
      STATE.mode = "PLAY";
      STATE.score = 0;
      STATE.crashTimer = 0;
      player.x = W * 0.22;
      player.y = H / 2;
      player.vy = 0;
      player.vx = 0;
      pulse.energy = pulse.max;
      pulses.length = 0;
      particles.length = 0;
      obstacles = [];
      scrollX = 0;
      nextObs = W + 250;
      nextPowerup = W + 500;
      powerups.length = 0;
      activePowerups.immunity.active = false;
      activePowerups.immunity.timer = 0;
      activePowerups.fireball.active = false;
      activePowerups.fireball.timer = 0;
      shake.i = 0;

      for (let i = 0; i < 6; i++) {
        const top = Math.random() > 0.5;
        const ob = makePillar(nextObs, top);
        obstacles.push(ob);
        // HARDER: More frequent pairs (40% -> 60%)
        if (Math.random() > 0.4) {
          const pair = makePillar(nextObs, !top, ob.h);
          if (pair.h > 40) obstacles.push(pair);
        }
        nextObs += GAP + Math.random() * 80; // HARDER: Less variance in gap
      }
    }

    /* ─── Fire Pulse ─── */
    function firePulse() {
      if (pulse.energy < pulse.cost) return;
      pulse.energy -= pulse.cost;
      
      const isFireball = activePowerups.fireball.active;
      pulses.push({
        x: player.x + player.width / 2,
        y: player.y + player.height / 2,
        r: 10,
        maxR: isFireball ? 300 : 550,
        a: 1,
        // New high-fidelity properties
        w: 4, // width
        hue: isFireball ? 0 : 260 + Math.random() * 40,
        isFireball: isFireball,
      });
      
      if (isFireball) {
        activePowerups.fireball.active = false;
        shake.i = 12;
      } else {
        shake.i = 6;
      }
      
      sonar.energy = 1;

      // Play sound
      pulseSound.currentTime = 0;
      pulseSound.play().catch(() => { });
    }

    /* ─── Collision ─── */
    function ptInPoly(px, py, poly) {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i].x - scrollX, yi = poly[i].y;
        const xj = poly[j].x - scrollX, yj = poly[j].y;
        if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)
          inside = !inside;
      }
      return inside;
    }

    function checkCollision() {
      // Immunity powerup prevents collision
      if (activePowerups.immunity.active) return false;
      
      const cx = player.x + player.width / 2;
      const cy = player.y + player.height / 2;
      const tests = [
        { x: cx, y: player.y + 2 },
        { x: cx, y: player.y + player.height - 2 },
        { x: player.x + player.width - 2, y: cy },
        { x: player.x + 4, y: cy },
      ];
      for (const ob of obstacles) {
        const sx = ob.x - scrollX;
        if (sx > W + 80 || sx + ob.w < -80) continue;
        // Skip destroyed obstacles
        if (ob.destroyed) continue;
        for (const t of tests) {
          if (ptInPoly(t.x, t.y, ob.points)) return true;
        }
      }
      if (player.y < -5 || player.y + player.height > H + 5) return true;
      return false;
    }

    /* ─── Crash ─── */
    function triggerCrash() {
      STATE.mode = "CRASH";
      STATE.crashTimer = STATE.crashDuration;
      if (STATE.score > STATE.highScore) STATE.highScore = STATE.score;
      shake.i = 14;
    }

    /* ─── Draw Dragon ─── */
    function drawDragon() {
      ctx.save();
      ctx.translate(player.x + player.width / 2, player.y + player.height / 2);

      const pitch = Math.max(-0.4, Math.min(0.4, player.vy * 0.08));
      ctx.rotate(pitch);

      const sw = player.width + 16;
      const sh = player.height + 12;

      if (dragonImg.complete && dragonImg.naturalWidth > 0) {
        ctx.save();
        ctx.scale(-1, 1); // flip to face right
        ctx.drawImage(dragonImg, -sw / 2, -sh / 2, sw, sh);
        ctx.restore();
      } else {
        // Fallback: simple shape
        ctx.fillStyle = "#1a0b2e";
        ctx.shadowColor = "#7c3aed";
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.ellipse(0, 0, 22, 10, 0, 0, Math.PI * 2);
        ctx.fill();
        // Eye
        ctx.shadowBlur = 6;
        ctx.shadowColor = "#39ff14";
        ctx.fillStyle = "#39ff14";
        ctx.beginPath();
        ctx.arc(16, -3, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }

    /* ─── Update ─── */
    function update() {
      if (STATE.mode === "PLAY") {
        const up = keys["ArrowUp"] || keys["KeyW"];
        const dn = keys["ArrowDown"] || keys["KeyS"];
        const rt = keys["ArrowRight"] || keys["KeyD"];
        const lt = keys["ArrowLeft"] || keys["KeyA"];

        if (up) player.vy += player.lift;
        if (dn) player.vy -= player.lift * 0.7;
        if (rt) player.vx += 0.22;
        if (lt) player.vx -= 0.14;

        player.vy += player.gravity;
        player.vy *= player.drag;
        player.vx *= player.dragX;
        player.y += player.vy;
        player.x += player.vx;
        player.x = Math.max(40, Math.min(W * 0.65, player.x));

        const speedF = 1 + (player.x / W) * 3.5; // HARDER: Faster scaler
        scrollX += player.baseSpeed * speedF;
        STATE.score = Math.floor(scrollX / 10);

        // Recharge
        const rr = speedF > 2 ? pulse.rechargeFast : pulse.rechargeBase;
        pulse.energy = Math.min(pulse.max, pulse.energy + rr);

        // Update pulses
        for (let i = pulses.length - 1; i >= 0; i--) {
          const p = pulses[i];
          p.r += p.isFireball ? 9 : 7;
          p.a = 1 - p.r / p.maxR;
          if (p.r >= p.maxR) { pulses.splice(i, 1); continue; }
          for (const ob of obstacles) {
            const ox = ob.x - scrollX + ob.w / 2;
            const oy = ob.isTop ? ob.h / 2 : H - ob.h / 2;
            const dist = Math.hypot(ox - p.x, oy - p.y);
            if (dist < p.r + ob.w / 2) {
              ob.opacity = 1;
              ob.revealT = 100;
              // Fireball destroys obstacles
              if (p.isFireball && dist < p.r) {
                ob.destroyed = true;
                ob.opacity = 0;
              }
            }
          }
        }
        
        // Update powerup timers
        if (activePowerups.immunity.active) {
          activePowerups.immunity.timer--;
          if (activePowerups.immunity.timer <= 0) {
            activePowerups.immunity.active = false;
          }
        }
        
        // Check powerup collection
        for (let i = powerups.length - 1; i >= 0; i--) {
          const pu = powerups[i];
          const dx = (player.x + player.width / 2) - (pu.x - scrollX);
          const dy = (player.y + player.height / 2) - pu.y;
          if (Math.hypot(dx, dy) < 30) {
            // Collect powerup
            if (pu.powerupType === 'immunity') {
              activePowerups.immunity.active = true;
              activePowerups.immunity.timer = activePowerups.immunity.duration;
            } else if (pu.powerupType === 'fireball') {
              activePowerups.fireball.active = true;
            } else if (pu.powerupType === 'plasma') {
              pulse.energy = pulse.max;
            }
            powerups.splice(i, 1);
            shake.i = 4;
            continue;
          }
        }

        // Obstacle fade
        for (const ob of obstacles) {
          if (ob.revealT > 0) {
            ob.revealT--;
            ob.opacity = ob.revealT / 100;
          } else {
            ob.opacity = Math.max(0, ob.opacity - 0.004);
          }
        }

        // Generate obstacles
        while (nextObs - scrollX < W + 400) {
          const top = Math.random() > 0.5;
          const ob = makePillar(nextObs, top);
          obstacles.push(ob);
          // HARDER frequency
          if (Math.random() > 0.25) {
            const pair = makePillar(nextObs, !top, ob.h);
            if (pair.h > 50) obstacles.push(pair);
          }
          nextObs += GAP + Math.random() * 80;
        }

        obstacles = obstacles.filter(ob => ob.x - scrollX > -150);
        
        // Generate powerups in safe but challenging positions
        while (nextPowerup - scrollX < W + 200) {
          const types = Object.values(POWERUP_TYPES);
          const selectedType = types[Math.floor(Math.random() * types.length)];
          
          // Find obstacles near this X position to avoid placing inside them
          const nearbyObs = obstacles.filter(ob => 
            Math.abs(ob.x - nextPowerup) < ob.w + 60
          );
          
          // Calculate safe Y range
          let safeMinY = 80;
          let safeMaxY = H - 80;
          
          for (const ob of nearbyObs) {
            if (ob.isTop) {
              // Top obstacle - don't place in upper area
              safeMinY = Math.max(safeMinY, ob.h + 50);
            } else {
              // Bottom obstacle - don't place in lower area
              safeMaxY = Math.min(safeMaxY, H - ob.h - 50);
            }
          }
          
          // Ensure valid range exists
          if (safeMaxY - safeMinY > 60) {
            // Place slightly off-center (not in the middle, makes it more challenging)
            const centerY = (safeMinY + safeMaxY) / 2;
            const offset = (Math.random() - 0.5) * (safeMaxY - safeMinY) * 0.6;
            const puY = Math.max(safeMinY + 30, Math.min(safeMaxY - 30, centerY + offset));
            
            powerups.push({
              x: nextPowerup,
              y: puY,
              powerupType: selectedType.type,
              color: selectedType.color,
              symbol: selectedType.symbol,
              pulse: 0,
            });
          }
          nextPowerup += 600 + Math.random() * 400;
        }
        
        // Update powerups
        powerups.forEach(pu => {
          pu.pulse += 0.08;
        });
        powerups.splice(0, powerups.filter(pu => pu.x - scrollX < -100).length);

        // Trail particles
        if (Math.random() > 0.3) {
          particles.push({
            x: player.x + 4,
            y: player.y + player.height / 2 + (Math.random() - 0.5) * 8,
            a: 0.5, s: 1.5 + Math.random() * 2,
            vx: -0.8 - Math.random() * 0.5,
            vy: (Math.random() - 0.5) * 0.4,
          });
        }
        if (particles.length > 80) particles.splice(0, particles.length - 80);
        for (let i = particles.length - 1; i >= 0; i--) {
          const p = particles[i];
          p.x += p.vx; p.y += p.vy;
          p.a -= 0.01; p.s *= 0.997;
          if (p.a <= 0) particles.splice(i, 1);
        }

        if (checkCollision()) triggerCrash();
      }

      if (STATE.mode === "CRASH") {
        STATE.crashTimer--;
        // Reveal walls on crash
        for (const ob of obstacles) {
          ob.opacity = Math.min(1, ob.opacity + 0.025);
        }
      }

      // Sonar bar decay
      sonar.energy *= 0.94;
      for (let i = 0; i < sonar.bars.length; i++) {
        sonar.bars[i] = sonar.bars[i] * 0.87 +
          sonar.energy * Math.sin(i * 0.5 + Date.now() * 0.005) *
          (0.3 + Math.random() * 0.6) * 0.1;
      }

      shake.i *= shake.decay;
      if (shake.i < 0.2) shake.i = 0;
    }

    /* ─── Draw ─── */
    function draw() {
      ctx.save();

      // Screen shake
      if (shake.i > 0) {
        ctx.translate(
          (Math.random() - 0.5) * shake.i * 1.5,
          (Math.random() - 0.5) * shake.i * 1.5
        );
      }

      // Background
      ctx.fillStyle = "#08081a";
      ctx.fillRect(-10, -10, W + 20, H + 20);

      // Subtle grid
      ctx.strokeStyle = "rgba(100, 50, 160, 0.04)";
      ctx.lineWidth = 0.5;
      for (let x = (-scrollX * 0.3) % 60; x < W; x += 60) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
      for (let y = 0; y < H; y += 60) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }

      if (STATE.mode === "START") {
        drawStart();
      } else {
        drawGame();
      }

      ctx.restore();
    }

    function drawGame() {
      // Obstacles
      for (const ob of obstacles) {
        if (ob.opacity < 0.01 || ob.destroyed) continue;
        ctx.save();
        ctx.globalAlpha = ob.opacity;

        // Fill
        ctx.fillStyle = `rgba(30, 10, 60, ${ob.opacity * 0.5})`;
        ctx.beginPath();
        ctx.moveTo(ob.points[0].x - scrollX, ob.points[0].y);
        for (let i = 1; i < ob.points.length; i++) {
          ctx.lineTo(ob.points[i].x - scrollX, ob.points[i].y);
        }
        ctx.closePath();
        ctx.fill();

        // Outline
        ctx.strokeStyle = `rgba(120, 50, 200, ${ob.opacity * 0.8})`;
        ctx.lineWidth = 1.5;
        ctx.shadowColor = "#7c3aed";
        ctx.shadowBlur = 10 * ob.opacity;
        ctx.stroke();
        ctx.restore();
      }

      // Powerups
      for (const pu of powerups) {
        const px = pu.x - scrollX;
        if (px < -50 || px > W + 50) continue;
        
        ctx.save();
        const scale = 1 + Math.sin(pu.pulse) * 0.15;
        const alpha = 0.7 + Math.sin(pu.pulse * 2) * 0.3;
        
        ctx.globalAlpha = alpha;
        ctx.translate(px, pu.y);
        ctx.scale(scale, scale);
        
        // Outer glow
        const glow = ctx.createRadialGradient(0, 0, 10, 0, 0, 25);
        const r = parseInt(pu.color.slice(1, 3), 16);
        const g = parseInt(pu.color.slice(3, 5), 16);
        const b = parseInt(pu.color.slice(5, 7), 16);
        glow.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.67)`);
        glow.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(0, 0, 25, 0, Math.PI * 2);
        ctx.fill();
        
        // Symbol
        ctx.fillStyle = pu.color;
        ctx.shadowColor = pu.color;
        ctx.shadowBlur = 15;
        ctx.font = 'bold 24px "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(pu.symbol, 0, 0);
        
        ctx.restore();
      }

      // Pulse rings (High Fidelity)
      for (const p of pulses) {
        ctx.save();

        // 1. Outer Glow (Soft)
        const g = ctx.createRadialGradient(p.x, p.y, p.r * 0.8, p.x, p.y, p.r);
        g.addColorStop(0, `hsla(${p.hue}, 100%, 50%, 0)`);
        g.addColorStop(0.9, `hsla(${p.hue}, 100%, 70%, ${p.a * 0.3})`);
        g.addColorStop(1, `hsla(${p.hue}, 100%, 50%, 0)`);
        ctx.fillStyle = g;
        ctx.globalCompositeOperation = "screen";
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();

        // 2. Main Ring (Sharp, Chromatic)
        ctx.globalCompositeOperation = "lighter";

        // Cyan shift inner
        ctx.strokeStyle = `rgba(100, 255, 255, ${p.a * 0.8})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r - 2, 0, Math.PI * 2);
        ctx.stroke();

        // Magenta shift outer
        ctx.strokeStyle = `rgba(255, 100, 255, ${p.a * 0.8})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r + 2, 0, Math.PI * 2);
        ctx.stroke();

        // White hot core ring
        ctx.strokeStyle = `rgba(255, 255, 255, ${p.a})`;
        ctx.lineWidth = 1;
        ctx.shadowColor = `hsla(${p.hue}, 100%, 70%, 1)`;
        ctx.shadowBlur = 15;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.stroke();

        ctx.restore();
      }

      // Trail particles
      for (const p of particles) {
        ctx.save();
        ctx.globalAlpha = p.a;
        ctx.fillStyle = "#6d3bbd";
        ctx.shadowColor = "#6d3bbd";
        ctx.shadowBlur = 4;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.s, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Dragon with immunity effect
      if (activePowerups.immunity.active) {
        ctx.save();
        const shimmer = 0.5 + 0.5 * Math.sin(Date.now() * 0.02);
        ctx.shadowColor = '#39ff14';
        ctx.shadowBlur = 20 * shimmer;
        ctx.globalAlpha = 0.3 + shimmer * 0.4;
        ctx.strokeStyle = '#39ff14';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(player.x + player.width / 2, player.y + player.height / 2, 35, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      
      drawDragon();

      // HUD
      drawHUD();

      // Sonar
      drawSonar();

      // Crash overlay
      if (STATE.mode === "CRASH") drawCrash();
    }

    function drawHUD() {
      ctx.save();
      ctx.fillStyle = "#9b7cc8";
      ctx.font = "bold 16px 'Courier New', monospace";
      ctx.textAlign = "left";
      ctx.fillText(`DIST: ${STATE.score}`, 18, 32);

      if (STATE.highScore > 0) {
        ctx.fillStyle = "#5a3d8a66";
        ctx.font = "11px 'Courier New', monospace";
        ctx.fillText(`BEST: ${STATE.highScore}`, 18, 50);
      }

      // Plasma bar
      const bw = 140, bh = 8, bx = W - bw - 20, by = 26;
      ctx.fillStyle = "#12081e";
      ctx.fillRect(bx, by, bw, bh);
      const fill = pulse.energy / pulse.max;
      ctx.fillStyle = "#5c2d91";
      ctx.fillRect(bx, by, bw * fill, bh);
      ctx.strokeStyle = "#5c2d9133";
      ctx.lineWidth = 1;
      ctx.strokeRect(bx, by, bw, bh);
      ctx.fillStyle = "#9b7cc8";
      ctx.font = "9px 'Courier New', monospace";
      ctx.textAlign = "right";
      ctx.fillText("PLASMA", bx - 5, by + 7);

      // Speed
      const sf = 1 + (player.x / W) * 2.2;
      const sl = Math.min(3, Math.floor(sf));
      ctx.fillStyle = sl >= 3 ? "#c44" : sl >= 2 ? "#b98030" : "#9b7cc8";
      ctx.font = "9px 'Courier New', monospace";
      ctx.textAlign = "left";
      ctx.fillText(`SPD ${"▮".repeat(sl)}${"▯".repeat(3 - sl)}`, 18, 66);
      
      // Active powerups display
      let pyOffset = 82;
      if (activePowerups.immunity.active) {
        const timeLeft = Math.ceil(activePowerups.immunity.timer / 60);
        ctx.fillStyle = '#39ff14';
        ctx.font = 'bold 10px "Courier New", monospace';
        ctx.fillText(`◆ IMMUNITY ${timeLeft}s`, 18, pyOffset);
        pyOffset += 14;
      }
      if (activePowerups.fireball.active) {
        ctx.fillStyle = '#ff4444';
        ctx.font = 'bold 10px "Courier New", monospace';
        ctx.fillText(`◉ FIREBALL READY`, 18, pyOffset);
        pyOffset += 14;
      }

      ctx.restore();
    }

    function drawSonar() {
      ctx.save();
      const n = sonar.bars.length;
      const bw = W / n;
      const base = H - 22;
      for (let i = 0; i < n; i++) {
        const h = Math.abs(sonar.bars[i]) * 16;
        const a = 0.1 + Math.abs(sonar.bars[i]) * 3;
        ctx.fillStyle = `rgba(100, 50, 170, ${Math.min(0.7, a)})`;
        ctx.fillRect(i * bw + 1, base - h / 2, bw - 2, h);
      }
      ctx.fillStyle = "#5c2d9122";
      ctx.font = "8px 'Courier New', monospace";
      ctx.textAlign = "center";
      ctx.fillText("◈ SONAR ◈", W / 2, H - 5);
      ctx.restore();
    }

    function drawStart() {
      const p = 0.5 + 0.5 * Math.sin(Date.now() * 0.002);

      ctx.save();
      ctx.fillStyle = `rgba(100, 50, 170, ${0.5 + p * 0.3})`;
      ctx.shadowColor = "#7c3aed";
      ctx.shadowBlur = 20 * p;
      ctx.font = "bold 36px 'Courier New', monospace";
      ctx.textAlign = "center";
      ctx.fillText("NIGHT FURY RADAR", W / 2, H * 0.3);

      ctx.shadowBlur = 6;
      ctx.fillStyle = "#5a3d8a66";
      ctx.font = "12px 'Courier New', monospace";
      ctx.fillText("fly blind. pulse to see.", W / 2, H * 0.38);

      // Dragon preview
      if (dragonImg.complete && dragonImg.naturalWidth > 0) {
        ctx.save();
        ctx.translate(W / 2, H * 0.50);
        ctx.scale(-1, 1);
        ctx.drawImage(dragonImg, -40, -25, 80, 50);
        ctx.restore();
      }

      ctx.shadowBlur = 4;
      ctx.fillStyle = "#9b7cc866";
      ctx.font = "11px 'Courier New', monospace";
      ctx.fillText("[WASD / ARROWS] — FLY", W / 2, H * 0.64);
      ctx.fillText("[SPACE] — PULSE", W / 2, H * 0.69);

      ctx.shadowBlur = 12 * p;
      ctx.fillStyle = `rgba(155, 124, 200, ${0.4 + p * 0.5})`;
      ctx.font = "bold 14px 'Courier New', monospace";
      ctx.fillText("[ SPACE TO FLY ]", W / 2, H * 0.82);

      ctx.restore();
    }

    function drawCrash() {
      const t = STATE.crashTimer / STATE.crashDuration;

      if (STATE.crashTimer > 20) {
        ctx.save();
        ctx.globalAlpha = t * 0.25;
        ctx.fillStyle = "#c44";
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = t;
        ctx.fillStyle = "#c44";
        ctx.shadowColor = "#c44";
        ctx.shadowBlur = 16;
        ctx.font = "bold 40px 'Courier New', monospace";
        ctx.textAlign = "center";
        const jx = (Math.random() - 0.5) * 6 * t;
        const jy = (Math.random() - 0.5) * 6 * t;
        ctx.fillText("CRASH", W / 2 + jx, H / 2 + jy);
        ctx.restore();
      }

      if (STATE.crashTimer <= 20 && STATE.crashTimer > 0) {
        ctx.save();
        ctx.globalAlpha = 1 - STATE.crashTimer / 20;
        ctx.fillStyle = "#9b7cc8";
        ctx.font = "16px 'Courier New', monospace";
        ctx.textAlign = "center";
        ctx.fillText(`DISTANCE: ${STATE.score}`, W / 2, H / 2 - 14);
        ctx.font = "12px 'Courier New', monospace";
        ctx.fillStyle = "#9b7cc888";
        ctx.fillText("[ SPACE TO RETRY ]", W / 2, H / 2 + 14);
        ctx.restore();
      }
    }

    /* ─── Loop ─── */
    function loop() {
      update();
      draw();
      animFrameRef.current = requestAnimationFrame(loop);
    }
    loop();

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = Math.min(1200, window.innerWidth);
    canvas.height = Math.min(700, window.innerHeight);
    const cleanup = initGame(canvas);
    gameRef.current = cleanup;
    return () => { if (gameRef.current) gameRef.current(); };
  }, [initGame]);

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#08081a",
        overflow: "hidden",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          display: "block",
          borderRadius: "3px",
          border: "1px solid rgba(100, 50, 170, 0.08)",
        }}


      />
    </div>
  );
}

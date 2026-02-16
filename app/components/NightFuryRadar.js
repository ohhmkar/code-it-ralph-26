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

    /* ───────── GLOBAL STATE ───────── */
    const STATE = {
      mode: "START", // START, PLAY, CRASH
      score: 0,
      highScore: 0,
      crashTimer: 0,
      crashDuration: 90, // frames
      pulseFlash: 0, // Chromatic aberration intensity
    };

    /* ───────── PLAYER (Toothless) ───────── */
    const player = {
      x: W * 0.25,
      y: H / 2,
      vy: 0,
      vx: 0,
      baseSpeed: 3,
      width: 44,
      height: 22,
      gravity: 0.12,
      lift: -0.45,
      drag: 0.96,
      dragX: 0.94,
    };

    /* ───────── PULSE SYSTEM ───────── */
    const pulseState = {
      energy: 1000,
      maxEnergy: 100,
      cost: 28,
      rechargeBase: 0.08,
      rechargeFast: 0.24,
    };
    const pulses = []; // { x, y, radius, maxRadius, alpha }

    /* ───────── OBSTACLES ───────── */
    let obstacles = []; // { x, y, w, h, points[], opacity, revealed }
    let scrollX = 0;
    const OBSTACLE_GAP = 260;
    let nextObstacleX = W + 200;

    /* ───────── PARTICLES (Trail) ───────── */
    const particles = [];

    /* ───────── SCREEN SHAKE ───────── */
    const shake = { intensity: 0, decay: 0.88 };

    /* ───────── SOUND WAVE UI ───────── */
    const soundWave = {
      bars: new Array(64).fill(0),
      energy: 0,
    };

    /* ───────── GLITCH CRASH ───────── */
    const glitch = { active: false, slices: [] };

    /* ───────── KEYS ───────── */
    const keys = {};

    function onKeyDown(e) {
      keys[e.code] = true;
      if (e.code === "Space") {
        e.preventDefault();
        if (STATE.mode === "START") {
          startGame();
        } else if (STATE.mode === "PLAY") {
          firePulse();
        } else if (STATE.mode === "CRASH" && STATE.crashTimer <= 0) {
          startGame();
        }
      }
    }
    function onKeyUp(e) {
      keys[e.code] = false;
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    /* ───────── GENERATE ORGANIC CAVE WALL ───────── */
    function generatePillar(x, isTop, minGap = 0) {
      const minH = 40;
      // If we need to respect a minimum gap, constrain the max height
      const maxPossibleH = H - minGap - minH;
      const maxH = Math.min(H * 0.6, Math.max(minH + 50, maxPossibleH));

      const h = minH + Math.random() * (maxH - minH);
      const w = 60 + Math.random() * 80; // Wider, more organic
      const baseY = isTop ? 0 : H;

      // Organic shape using sine wave summation (simple noise)
      const pts = [];
      const segments = 12; // More segments for smoother look

      if (isTop) {
        pts.push({ x: x, y: 0 }); // Top-left anchor
        for (let i = 0; i <= segments; i++) {
          const frac = i / segments;
          // Non-linear bulge
          const bulge = Math.sin(frac * Math.PI) * (w * 0.2);
          // Noise
          const noise = Math.sin(frac * 10 + x * 0.01) * 10 + Math.cos(frac * 20) * 5;

          pts.push({
            x: x + (frac * w) + bulge + noise,
            y: (frac * h * 0.8) + (Math.random() * h * 0.2) // jagged bottom edge
          });
        }
        pts.push({ x: x + w, y: 0 }); // Top-right anchor
      } else {
        pts.push({ x: x, y: H }); // Bottom-left anchor
        for (let i = 0; i <= segments; i++) {
          const frac = i / segments;
          // Non-linear bulge
          const bulge = Math.sin(frac * Math.PI) * (w * 0.2);
          const noise = Math.sin(frac * 12 + x * 0.02) * 10 + Math.cos(frac * 15) * 5;

          pts.push({
            x: x + (frac * w) + bulge + noise,
            y: H - ((frac * h * 0.8) + (Math.random() * h * 0.2)) // jagged top edge
          });
        }
        pts.push({ x: x + w, y: H }); // Bottom-right anchor
      }

      return {
        x,
        y: isTop ? 0 : H - h, // approximate bounding box y
        w,
        h,
        points: pts,
        opacity: 0,
        revealTimer: 0,
        isTop,
      };
    }

    /* ───────── INIT / RESET ───────── */
    function startGame() {
      STATE.mode = "PLAY";
      STATE.score = 0;
      STATE.crashTimer = 0;
      player.x = W * 0.25;
      player.y = H / 2;
      player.vy = 0;
      player.vx = 0;
      pulseState.energy = pulseState.maxEnergy;
      pulses.length = 0;
      particles.length = 0;
      obstacles = [];
      scrollX = 0;
      nextObstacleX = W + 200;
      glitch.active = false;
      shake.intensity = 0;

      // seed initial obstacles
      for (let i = 0; i < 8; i++) {
        const isTop = Math.random() > 0.5;
        const obs = generatePillar(nextObstacleX, isTop);
        obstacles.push(obs);

        // sometimes add a pair (IMPOSSIBLE LEVEL CHECK)
        if (Math.random() > 0.4) {
          const gap = player.height * 4.5; // Ensure ample space
          // If first one was top, generate bottom with gap constraint
          // If first one was bottom, generate top with gap constraint
          // Actually, just pass the 'gap' to generatePillar logic or check after?
          // Let's pass the other obstacle's height to constrain the new one.

          const otherH = obs.h;
          const totalSpace = H;
          // We need H - (h1 + h2) > gap
          // So h2 < H - h1 - gap

          const maxH2 = H - otherH - gap;
          if (maxH2 > 50) { // Only generate if there's enough room for a decent obstacle
            const pair = generatePillar(nextObstacleX, !isTop, H - maxH2); // Pass minGap? No, logic inside needs update.
            // Let's use a simpler approach: explicitly request generation with max height constraint

            // Redo generation logic above to accept constraints.
            // ... Refactored generatePillar above to accept 'minGap' which implies max height.

            // Actually, the logic in my new generatePillar uses minGap to calculate maxPossibleH.
            // If I have an existing obstacle of height h1. 
            // The new obstacle (h2) needs to leave 'gap' space.
            // Space used = h1. Remaining = H - h1.
            // We need Remaining - h2 > gap  => h2 < Remaining - gap => h2 < H - h1 - gap.
            // So I should pass (h1 + gap) as the 'reserved space' effectively?
            // No, my generatePillar takes 'minGap' and does `H - minGap - minH`.
            // So if I pass `minGap = otherH + gap`, then `maxPossibleH = H - (otherH + gap) - minH`.
            // `maxH = ... maxPossibleH`.

            const safeGap = otherH + gap;
            const pairObs = generatePillar(nextObstacleX, !isTop, safeGap);
            obstacles.push(pairObs);
          }
        }
        nextObstacleX += OBSTACLE_GAP + Math.random() * 120;
      }
    }

    /* ───────── FIRE PULSE ───────── */
    function firePulse() {
      if (pulseState.energy < pulseState.cost) return;
      pulseState.energy -= pulseState.cost;
      pulses.push({
        x: player.x,
        y: player.y,
        radius: 10,
        maxRadius: 550,
        alpha: 1.0,
      });
      shake.intensity = 12;
      STATE.pulseFlash = 1.0; // Trigger chromatic aberration
      soundWave.energy = 1.0;
    }

    /* ───────── COLLISION ───────── */
    function pointInPolygon(px, py, poly) {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i].x - scrollX,
          yi = poly[i].y;
        const xj = poly[j].x - scrollX,
          yj = poly[j].y;
        const intersect =
          yi > py !== yj > py &&
          px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
        if (intersect) inside = !inside;
      }
      return inside;
    }

    function checkCollision() {
      // check multiple points on player body
      const testPoints = [
        { x: player.x + player.width / 2, y: player.y },
        { x: player.x + player.width / 2, y: player.y + player.height },
        { x: player.x + player.width, y: player.y + player.height / 2 },
        { x: player.x, y: player.y + player.height / 2 },
        { x: player.x + player.width * 0.75, y: player.y + 4 },
        { x: player.x + player.width * 0.75, y: player.y + player.height - 4 },
      ];

      for (const ob of obstacles) {
        const screenX = ob.x - scrollX;
        if (screenX > W + 100 || screenX + ob.w < -100) continue;
        for (const pt of testPoints) {
          if (pointInPolygon(pt.x, pt.y, ob.points)) {
            return true;
          }
        }
      }

      // boundary collision
      if (player.y < -10 || player.y + player.height > H + 10) return true;

      return false;
    }

    /* ───────── CRASH ───────── */
    function triggerCrash() {
      STATE.mode = "CRASH";
      STATE.crashTimer = STATE.crashDuration;
      if (STATE.score > STATE.highScore) STATE.highScore = STATE.score;
      glitch.active = true;
      shake.intensity = 25;

      // generate glitch slices
      glitch.slices = [];
      for (let i = 0; i < 12; i++) {
        glitch.slices.push({
          y: Math.random() * H,
          h: 5 + Math.random() * 30,
          offset: (Math.random() - 0.5) * 60,
          color: Math.random() > 0.5 ? "#a020f0" : "#6a0dad",
        });
      }
    }

    /* ───────── CRASH REVEAL ───────── */
    function updateCrashReveal() {
      // Light up all obstacles
      for (const ob of obstacles) {
        if (ob.opacity < 1.0) {
          ob.opacity += 0.02;
        }
      }
    }

    /* ───────── DRAW TOOTHLESS (Dragon silhouette) ───────── */
    // REPLACEABLE: You can swap this function to draw an image/sprite instead.
    // function drawToothlessModel(ctx, x, y, w, h, angle) { ... }
    function drawToothless(cx, cy) {
      ctx.save();
      ctx.translate(cx, cy);

      // Pitch based on velocity
      const pitch = Math.min(Math.max(player.vy * 0.1, -0.5), 0.5);
      ctx.rotate(pitch);

      // glow
      ctx.shadowColor = "#a020f0";
      ctx.shadowBlur = 20;

      const scale = 0.8;
      ctx.scale(scale, scale);

      const w = player.width;
      const h = player.height;

      // Color
      ctx.fillStyle = "#100020"; // Darker body (Night Fury)

      // 1. Wings (Bottom Layer)
      const wingFlap = Math.sin(Date.now() * 0.015) * 8;

      // Left Wing (Far)
      ctx.beginPath();
      ctx.moveTo(10, 5);
      ctx.quadraticCurveTo(-20, -20 + wingFlap, -40, 10 + wingFlap);
      ctx.quadraticCurveTo(-10, 20, 10, 10);
      ctx.fillStyle = "#1a0b2e";
      ctx.fill();

      // 2. Body (Smooth aerodynamic shape)
      ctx.beginPath();
      ctx.ellipse(0, 0, 30, 12, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#0a0510";
      ctx.fill();

      // 3. Head (Rounded with ear plates)
      ctx.beginPath();
      ctx.ellipse(28, -2, 14, 10, 0.2, 0, Math.PI * 2);
      ctx.fill();

      // Ear plates (Nubs)
      ctx.beginPath();
      ctx.moveTo(22, -10);
      ctx.lineTo(18, -18); // Ear 1
      ctx.lineTo(24, -12);
      ctx.lineTo(28, -20); // Ear 2
      ctx.lineTo(32, -11);
      ctx.lineTo(38, -16); // Ear 3 (Middle)
      ctx.lineTo(36, -8);
      ctx.fill();

      // 4. Right Wing (Near)
      ctx.beginPath();
      ctx.moveTo(10, 5);
      ctx.quadraticCurveTo(-15, -30 + wingFlap, -50, -10 + wingFlap);
      ctx.bezierCurveTo(-30, 30 + wingFlap, 0, 20, 15, 8);
      ctx.fillStyle = "#2d1b4e"; // Slightly lighter for contrast
      ctx.fill();

      // 5. Tail
      ctx.beginPath();
      ctx.moveTo(-25, 0);
      ctx.quadraticCurveTo(-50, 5, -70, 0); // Tail spine
      ctx.strokeStyle = "#0a0510";
      ctx.lineWidth = 6;
      ctx.stroke();

      // Tail Fins (Red one?)
      ctx.beginPath();
      ctx.moveTo(-65, 0);
      ctx.lineTo(-75, -10 + wingFlap * 0.5);
      ctx.lineTo(-70, 0);
      ctx.lineTo(-75, 10 - wingFlap * 0.5);
      ctx.lineTo(-65, 0);
      ctx.fillStyle = "#ff2a2a"; // Hiccup's red tail fin patch
      ctx.fill();

      // 6. Eyes (Glowing Green)
      ctx.shadowBlur = 10;
      ctx.shadowColor = "#39ff14";
      ctx.fillStyle = "#39ff14";
      ctx.beginPath();
      ctx.ellipse(32, -4, 2, 4, 0.2, 0, Math.PI * 2); // Left eye
      ctx.fill();

      ctx.restore();
    }

    /* ───────── MAIN LOOP ───────── */
    function update() {
      if (STATE.mode === "PLAY") {
        // ─── Input ───
        const up = keys["ArrowUp"] || keys["KeyW"];
        const down = keys["ArrowDown"] || keys["KeyS"];
        const right = keys["ArrowRight"] || keys["KeyD"];
        const left = keys["ArrowLeft"] || keys["KeyA"];

        if (up) player.vy += player.lift;
        if (down) player.vy -= player.lift;
        if (right) player.vx += 0.25;
        if (left) player.vx -= 0.15;

        player.vy += player.gravity;
        player.vy *= player.drag;
        player.vx *= player.dragX;

        player.y += player.vy;
        player.x += player.vx;

        // clamp player x
        player.x = Math.max(40, Math.min(W * 0.7, player.x));

        // Speed-based scroll (faster when player is further right)
        const speedFactor = 1 + (player.x / W) * 2.5;
        const scrollSpeed = player.baseSpeed * speedFactor;
        scrollX += scrollSpeed;

        // Score = distance
        STATE.score = Math.floor(scrollX / 10);

        // ─── Recharge pulse ───
        const speedMag = Math.abs(scrollSpeed);
        const rechargeRate =
          speedMag > 8
            ? pulseState.rechargeFast
            : pulseState.rechargeBase;
        pulseState.energy = Math.min(
          pulseState.maxEnergy,
          pulseState.energy + rechargeRate
        );

        // ─── Update pulses ───
        for (let i = pulses.length - 1; i >= 0; i--) {
          const p = pulses[i];
          p.radius += 8;
          p.alpha = 1 - p.radius / p.maxRadius;
          if (p.radius >= p.maxRadius) {
            pulses.splice(i, 1);
            continue;
          }

          // reveal obstacles hit by pulse
          for (const ob of obstacles) {
            const obScreenX = ob.x - scrollX + ob.w / 2;
            const obScreenY = ob.y + ob.h / 2;
            const dist = Math.hypot(obScreenX - p.x, obScreenY - p.y);
            if (dist < p.radius + ob.w / 2) {
              ob.opacity = 1.0;
              ob.revealTimer = 90; // 1.5s at 60fps
            }
          }
        }

        // ─── Obstacle opacity decay ───
        for (const ob of obstacles) {
          if (ob.revealTimer > 0) {
            ob.revealTimer--;
            ob.opacity = ob.revealTimer / 90;
          } else {
            ob.opacity = Math.max(0, ob.opacity - 0.005);
          }
        }

        // ─── Generate new obstacles ───
        while (nextObstacleX - scrollX < W + 400) {
          const isTop = Math.random() > 0.5;
          const obs = generatePillar(nextObstacleX, isTop);
          obstacles.push(obs);

          if (Math.random() > 0.35) {
            const gap = player.height * 4.5;
            const otherH = obs.h;
            const maxH2 = H - otherH - gap;

            if (maxH2 > 50) {
              const safeGap = otherH + gap;
              const pairObs = generatePillar(nextObstacleX, !isTop, safeGap);
              obstacles.push(pairObs);
            }
          }
          nextObstacleX += OBSTACLE_GAP + Math.random() * 140;
        }

        // ─── Remove far-behind obstacles ───
        obstacles = obstacles.filter((ob) => ob.x - scrollX > -200);

        // ─── Particles (trail) ───
        particles.push({
          x: player.x + 2,
          y: player.y + player.height / 2 + (Math.random() - 0.5) * 6,
          alpha: 0.7,
          size: 2 + Math.random() * 3,
          vx: -1 - Math.random(),
          vy: (Math.random() - 0.5) * 0.5,
        });
        if (particles.length > 120) particles.splice(0, particles.length - 120);

        for (let i = particles.length - 1; i >= 0; i--) {
          const p = particles[i];
          p.x += p.vx;
          p.y += p.vy;
          p.alpha -= 0.012;
          p.size *= 0.995;
          if (p.alpha <= 0) particles.splice(i, 1);
        }

        // ─── Collision ───
        if (checkCollision()) {
          triggerCrash();
        }
      }

      if (STATE.mode === "CRASH") {
        STATE.crashTimer--;
        if (STATE.crashTimer <= 0) {
          glitch.active = false;
        }
        updateCrashReveal(); // Reveal map on crash
      }

      // ─── Sound wave decay ───
      soundWave.energy *= 0.95;
      for (let i = 0; i < soundWave.bars.length; i++) {
        soundWave.bars[i] =
          soundWave.bars[i] * 0.88 +
          soundWave.energy *
          Math.sin(i * 0.4 + Date.now() * 0.006) *
          (0.3 + Math.random() * 0.7) *
          0.12;
      }

      // ─── Shake decay ───
      shake.intensity *= shake.decay;
      if (shake.intensity < 0.3) shake.intensity = 0;

      // ─── Pulse Flash Decay ───
      if (STATE.pulseFlash > 0) {
        STATE.pulseFlash -= 0.05;
        if (STATE.pulseFlash < 0) STATE.pulseFlash = 0;
      }
    }

    function draw() {
      ctx.save();

      // ── Screen shake ──
      if (shake.intensity > 0) {
        const sx = (Math.random() - 0.5) * shake.intensity * 2;
        const sy = (Math.random() - 0.5) * shake.intensity * 2;
        ctx.translate(sx, sy);
      }

      // ── Chromatic Aberration (Pulse Impact) ──
      if (STATE.pulseFlash > 0.1) {
        ctx.translate(STATE.pulseFlash * 4, 0); // Red shift right
        ctx.globalCompositeOperation = "screen";
        ctx.fillStyle = `rgba(255, 0, 0, ${STATE.pulseFlash * 0.5})`;
        ctx.fillRect(-20, -20, W + 40, H + 40);

        ctx.translate(-STATE.pulseFlash * 8, 0); // Blue shift left
        ctx.fillStyle = `rgba(0, 0, 255, ${STATE.pulseFlash * 0.5})`;
        ctx.fillRect(-20, -20, W + 40, H + 40);

        ctx.translate(STATE.pulseFlash * 4, 0); // Reset
        ctx.globalCompositeOperation = "source-over";
      }

      // ── Clear ──
      ctx.fillStyle = "#000000";
      ctx.fillRect(-20, -20, W + 40, H + 40);

      if (STATE.mode === "START") {
        drawStartScreen();
      } else if (STATE.mode === "PLAY" || STATE.mode === "CRASH") {
        drawGame();
      }

      ctx.restore();

      // ── Glitch overlay (outside shake transform) ──
      if (glitch.active && STATE.mode === "CRASH") {
        drawGlitch();
      }
    }

    function drawGame() {
      // ── Obstacles ──
      for (const ob of obstacles) {
        if (ob.opacity <= 0.01) continue;
        const pts = ob.points;
        ctx.save();
        ctx.globalAlpha = ob.opacity;
        ctx.shadowColor = "#a020f0";
        ctx.shadowBlur = 20 * ob.opacity;
        ctx.strokeStyle = `rgba(160, 32, 240, ${ob.opacity})`;
        ctx.lineWidth = 2;
        ctx.fillStyle = `rgba(40, 0, 80, ${ob.opacity * 0.3})`;

        ctx.beginPath();
        ctx.moveTo(pts[0].x - scrollX, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(pts[i].x - scrollX, pts[i].y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      // ── Pulses ──
      for (const p of pulses) {
        ctx.save();
        ctx.strokeStyle = `rgba(160, 32, 240, ${p.alpha * 0.7})`;
        ctx.lineWidth = 3;
        ctx.shadowColor = "#a020f0";
        ctx.shadowBlur = 30;

        // Speed instability
        const speedFactor = 1 + (player.x / W) * 2.5;
        if (speedFactor > 1.8) {
          const jitter = (Math.random() - 0.5) * (speedFactor * 3);
          ctx.lineWidth = 2 + Math.random() * 3;
          p.radius += jitter;
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.stroke();

        // inner ring
        ctx.strokeStyle = `rgba(200, 120, 255, ${p.alpha * 0.3})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius * 0.85, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // ── Particles (trail) ──
      for (const p of particles) {
        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.shadowColor = "#7b2ff2";
        ctx.shadowBlur = 8;
        ctx.fillStyle = "#9b59f7";
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // ── Toothless ──
      drawToothless(player.x, player.y);

      // ── HUD ──
      drawHUD();

      // ── Sound wave ──
      drawSoundWave();
    }

    function drawHUD() {
      ctx.save();
      ctx.shadowColor = "#a020f0";
      ctx.shadowBlur = 10;

      // Score
      ctx.fillStyle = "#c084fc";
      ctx.font = "bold 18px 'Courier New', monospace";
      ctx.textAlign = "left";
      ctx.fillText(`DIST: ${STATE.score}`, 20, 35);

      // High score
      if (STATE.highScore > 0) {
        ctx.fillStyle = "#7c3aed55";
        ctx.font = "13px 'Courier New', monospace";
        ctx.fillText(`BEST: ${STATE.highScore}`, 20, 55);
      }

      // ── Pulse Bar ──
      const barW = 160;
      const barH = 10;
      const barX = W - barW - 25;
      const barY = 28;

      ctx.fillStyle = "#1a0030";
      ctx.fillRect(barX, barY, barW, barH);

      const fillRatio = pulseState.energy / pulseState.maxEnergy;
      const gradient = ctx.createLinearGradient(barX, 0, barX + barW, 0);
      gradient.addColorStop(0, "#6a0dad");
      gradient.addColorStop(1, "#a020f0");
      ctx.fillStyle = gradient;
      ctx.shadowBlur = fillRatio > 0.5 ? 12 : 4;
      ctx.fillRect(barX, barY, barW * fillRatio, barH);

      ctx.strokeStyle = "#a020f066";
      ctx.lineWidth = 1;
      ctx.strokeRect(barX, barY, barW, barH);

      ctx.fillStyle = "#c084fc";
      ctx.shadowBlur = 0;
      ctx.font = "10px 'Courier New', monospace";
      ctx.textAlign = "right";
      ctx.fillText("PLASMA", barX - 6, barY + 9);

      // Speed indicator
      const speedFactor = 1 + (player.x / W) * 2.5;
      const speedLevel = Math.min(3, Math.floor(speedFactor));
      ctx.fillStyle = speedLevel >= 3 ? "#ff4444" : speedLevel >= 2 ? "#ffaa00" : "#c084fc";
      ctx.font = "10px 'Courier New', monospace";
      ctx.textAlign = "left";
      ctx.fillText(`SPD: ${"▮".repeat(speedLevel)}${"▯".repeat(3 - speedLevel)}`, 20, 72);

      ctx.restore();
    }

    function drawSoundWave() {
      ctx.save();
      const barCount = soundWave.bars.length;
      const barW = W / barCount;
      const baseY = H - 30;
      const maxH = 22;

      for (let i = 0; i < barCount; i++) {
        const h = Math.abs(soundWave.bars[i]) * maxH;
        const alpha = 0.15 + Math.abs(soundWave.bars[i]) * 4;
        ctx.fillStyle = `rgba(160, 32, 240, ${Math.min(1, alpha)})`;
        ctx.shadowColor = "#a020f0";
        ctx.shadowBlur = h > 3 ? 8 : 0;
        ctx.fillRect(i * barW + 1, baseY - h / 2, barW - 2, h);
      }

      // label
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#a020f033";
      ctx.font = "9px 'Courier New', monospace";
      ctx.textAlign = "center";
      ctx.fillText("◈ SONAR FREQ ◈", W / 2, H - 6);

      ctx.restore();
    }

    function drawStartScreen() {
      ctx.save();

      // ambient pulse
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.003);

      // Title
      ctx.shadowColor = "#a020f0";
      ctx.shadowBlur = 40 * pulse;
      ctx.fillStyle = `rgba(160, 32, 240, ${0.7 + pulse * 0.3})`;
      ctx.font = "bold 42px 'Courier New', monospace";
      ctx.textAlign = "center";
      ctx.fillText("NIGHT FURY RADAR", W / 2, H * 0.32);

      // Subtitle
      ctx.shadowBlur = 10;
      ctx.fillStyle = "#7c3aed88";
      ctx.font = "14px 'Courier New', monospace";
      ctx.fillText("/// FLY BLIND. PULSE TO SEE. ///", W / 2, H * 0.40);

      // Dragon silhouette
      drawToothless(W / 2 - player.width / 2, H * 0.47);

      // Controls
      ctx.shadowBlur = 5;
      ctx.fillStyle = "#c084fc66";
      ctx.font = "13px 'Courier New', monospace";
      ctx.fillText("[WASD / ARROWS] — FLY", W / 2, H * 0.62);
      ctx.fillText("[SPACE] — PLASMA PULSE", W / 2, H * 0.67);

      // Start prompt
      ctx.shadowBlur = 20 * pulse;
      ctx.fillStyle = `rgba(192, 132, 252, ${0.5 + pulse * 0.5})`;
      ctx.font = "bold 16px 'Courier New', monospace";
      ctx.fillText("[ PRESS SPACE TO FLY ]", W / 2, H * 0.80);

      // Footer
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#a020f022";
      ctx.font = "10px 'Courier New', monospace";
      ctx.fillText("lo-fi sci-fi × primal dragon energy", W / 2, H * 0.92);

      ctx.restore();
    }

    function drawGlitch() {
      if (STATE.crashTimer <= 0) return;
      const intensity = STATE.crashTimer / STATE.crashDuration;

      ctx.save();

      // chromatic aberration / color flash
      ctx.globalAlpha = intensity * 0.4;
      ctx.fillStyle = Math.random() > 0.5 ? "#a020f0" : "#ff0044";
      ctx.fillRect(0, 0, W, H);

      // horizontal slice glitches
      ctx.globalAlpha = intensity * 0.8;
      for (const s of glitch.slices) {
        s.offset += (Math.random() - 0.5) * 10;
        ctx.fillStyle = s.color;
        ctx.fillRect(s.offset, s.y, W, s.h);
      }

      // scan lines
      ctx.globalAlpha = intensity * 0.15;
      ctx.fillStyle = "#000";
      for (let y = 0; y < H; y += 3) {
        ctx.fillRect(0, y, W, 1);
      }

      // "CRASH" text
      if (STATE.crashTimer > 30) {
        ctx.globalAlpha = intensity;
        ctx.shadowColor = "#ff0044";
        ctx.shadowBlur = 30;
        ctx.fillStyle = "#ff0044";
        ctx.font = "bold 52px 'Courier New', monospace";
        ctx.textAlign = "center";
        const jx = (Math.random() - 0.5) * 12 * intensity;
        const jy = (Math.random() - 0.5) * 12 * intensity;
        ctx.fillText("CRASH", W / 2 + jx, H / 2 + jy);
      }

      // "Try again" prompt
      if (STATE.crashTimer <= 30 && STATE.crashTimer > 0) {
        ctx.globalAlpha = 1 - STATE.crashTimer / 30;
        ctx.shadowColor = "#a020f0";
        ctx.shadowBlur = 10;
        ctx.fillStyle = "#c084fc";
        ctx.font = "18px 'Courier New', monospace";
        ctx.textAlign = "center";
        ctx.fillText(`DISTANCE: ${STATE.score}`, W / 2, H / 2 - 20);
        ctx.font = "14px 'Courier New', monospace";
        ctx.fillText("[ SPACE TO RETRY ]", W / 2, H / 2 + 20);
      }

      ctx.restore();
    }

    /* ───────── GAME LOOP ───────── */
    function loop() {
      update();
      draw();
      animFrameRef.current = requestAnimationFrame(loop);
    }

    loop();

    // expose cleanup
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Set canvas size
    canvas.width = Math.min(1200, window.innerWidth);
    canvas.height = Math.min(700, window.innerHeight);

    const cleanup = initGame(canvas);
    gameRef.current = cleanup;

    const handleResize = () => {
      canvas.width = Math.min(1200, window.innerWidth);
      canvas.height = Math.min(700, window.innerHeight);
    };

    window.addEventListener("resize", handleResize);

    return () => {
      if (gameRef.current) gameRef.current();
      window.removeEventListener("resize", handleResize);
    };
  }, [initGame]);

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#000",
        overflow: "hidden",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          display: "block",
          border: "1px solid #a020f015",
          borderRadius: "4px",
          boxShadow: "0 0 60px rgba(160, 32, 240, 0.08)",
        }}
      />
    </div>
  );
}

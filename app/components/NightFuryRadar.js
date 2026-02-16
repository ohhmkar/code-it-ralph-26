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
      energy: 100,
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

    /* ───────── GENERATE JAGGED PILLAR ───────── */
    function generatePillar(x) {
      const isTop = Math.random() > 0.5;
      const minH = 80;
      const maxH = H * 0.55;
      const h = minH + Math.random() * (maxH - minH);
      const w = 40 + Math.random() * 50;
      const baseY = isTop ? 0 : H - h;

      // jagged polygon points
      const pts = [];
      const segments = 6 + Math.floor(Math.random() * 5);
      if (isTop) {
        // top pillar hangs down
        pts.push({ x: x, y: 0 });
        for (let i = 0; i <= segments; i++) {
          const frac = i / segments;
          const jag = (Math.random() - 0.5) * w * 0.6;
          pts.push({
            x: x + w / 2 + jag,
            y: frac * h,
          });
        }
        pts.push({ x: x + w, y: 0 });
      } else {
        // bottom pillar grows up
        pts.push({ x: x, y: H });
        for (let i = 0; i <= segments; i++) {
          const frac = i / segments;
          pts.push({
            x: x + w / 2 + (Math.random() - 0.5) * w * 0.6,
            y: H - frac * h,
          });
        }
        pts.push({ x: x + w, y: H });
      }

      return {
        x,
        y: baseY,
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
        obstacles.push(generatePillar(nextObstacleX));
        // sometimes add a pair
        if (Math.random() > 0.4) {
          const pair = generatePillar(nextObstacleX);
          pair.isTop = !obstacles[obstacles.length - 1].isTop;
          pair.y = pair.isTop ? 0 : H - pair.h;
          // regenerate points for flipped
          const pts2 = [];
          const seg = 6 + Math.floor(Math.random() * 4);
          if (pair.isTop) {
            pts2.push({ x: pair.x, y: 0 });
            for (let j = 0; j <= seg; j++) {
              pts2.push({
                x: pair.x + pair.w / 2 + (Math.random() - 0.5) * pair.w * 0.5,
                y: (j / seg) * pair.h,
              });
            }
            pts2.push({ x: pair.x + pair.w, y: 0 });
          } else {
            pts2.push({ x: pair.x, y: H });
            for (let j = 0; j <= seg; j++) {
              pts2.push({
                x: pair.x + pair.w / 2 + (Math.random() - 0.5) * pair.w * 0.5,
                y: H - (j / seg) * pair.h,
              });
            }
            pts2.push({ x: pair.x + pair.w, y: H });
          }
          pair.points = pts2;
          obstacles.push(pair);
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

    /* ───────── DRAW TOOTHLESS (Dragon silhouette) ───────── */
    function drawToothless(cx, cy) {
      ctx.save();
      ctx.translate(cx, cy);

      // glow
      ctx.shadowColor = "#a020f0";
      ctx.shadowBlur = 30;

      const w = player.width;
      const h = player.height;

      // Body
      ctx.fillStyle = "#7b2ff2";
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2, w / 2, h / 2.5, 0, 0, Math.PI * 2);
      ctx.fill();

      // Head
      ctx.beginPath();
      ctx.ellipse(w * 0.85, h * 0.38, 10, 7, 0.2, 0, Math.PI * 2);
      ctx.fill();

      // Wings (flap)
      const wingFlap = Math.sin(Date.now() * 0.012) * 6;
      ctx.beginPath();
      ctx.moveTo(w * 0.35, h * 0.3);
      ctx.quadraticCurveTo(w * 0.15, -8 + wingFlap, w * 0.5, h * 0.1 + wingFlap);
      ctx.lineTo(w * 0.55, h * 0.35);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(w * 0.35, h * 0.7);
      ctx.quadraticCurveTo(w * 0.15, h + 8 - wingFlap, w * 0.5, h * 0.9 - wingFlap);
      ctx.lineTo(w * 0.55, h * 0.65);
      ctx.closePath();
      ctx.fill();

      // Tail
      ctx.beginPath();
      ctx.moveTo(4, h * 0.45);
      ctx.quadraticCurveTo(-18, h * 0.5 + wingFlap * 0.5, -14, h * 0.55);
      ctx.lineTo(4, h * 0.55);
      ctx.closePath();
      ctx.fill();

      // Tail fin
      ctx.beginPath();
      ctx.moveTo(-14, h * 0.4);
      ctx.lineTo(-22, h * 0.2 + wingFlap * 0.3);
      ctx.lineTo(-12, h * 0.45);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(-14, h * 0.6);
      ctx.lineTo(-22, h * 0.8 - wingFlap * 0.3);
      ctx.lineTo(-12, h * 0.55);
      ctx.closePath();
      ctx.fill();

      // Eye
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#39ff14";
      ctx.shadowColor = "#39ff14";
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.ellipse(w * 0.88, h * 0.35, 2.5, 2, 0, 0, Math.PI * 2);
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
          obstacles.push(generatePillar(nextObstacleX));
          if (Math.random() > 0.35) {
            const pair = generatePillar(nextObstacleX);
            pair.isTop = !obstacles[obstacles.length - 1].isTop;
            pair.y = pair.isTop ? 0 : H - pair.h;
            const pts2 = [];
            const seg = 6 + Math.floor(Math.random() * 4);
            if (pair.isTop) {
              pts2.push({ x: pair.x, y: 0 });
              for (let j = 0; j <= seg; j++) {
                pts2.push({
                  x: pair.x + pair.w / 2 + (Math.random() - 0.5) * pair.w * 0.5,
                  y: (j / seg) * pair.h,
                });
              }
              pts2.push({ x: pair.x + pair.w, y: 0 });
            } else {
              pts2.push({ x: pair.x, y: H });
              for (let j = 0; j <= seg; j++) {
                pts2.push({
                  x: pair.x + pair.w / 2 + (Math.random() - 0.5) * pair.w * 0.5,
                  y: H - (j / seg) * pair.h,
                });
              }
              pts2.push({ x: pair.x + pair.w, y: H });
            }
            pair.points = pts2;
            obstacles.push(pair);
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
    }

    function draw() {
      ctx.save();

      // ── Screen shake ──
      if (shake.intensity > 0) {
        const sx = (Math.random() - 0.5) * shake.intensity * 2;
        const sy = (Math.random() - 0.5) * shake.intensity * 2;
        ctx.translate(sx, sy);
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

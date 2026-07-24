(function(){
  "use strict";

  const stage = document.getElementById('stage');
  const videoEl = document.getElementById('video');
  const handCanvas = document.getElementById('handOverlay');
  const handCtx = handCanvas.getContext('2d');
  const hero = document.querySelector('.hero');
  const startBtn = document.getElementById('startBtn');
  const hudStatus = document.getElementById('hudStatus');
  const hudPinch = document.getElementById('hudPinch');
  const toggleBtns = document.querySelectorAll('.mode-switch button');

  toggleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      toggleBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      stage.dataset.mode = btn.dataset.mode;
    });
  });

  // ---------- gesture mode: 'tap' (push toward camera) or 'pinch' (thumb+index) ----------
  const GESTURE_MODE = 'tap';

  let tapHistory = [];
  const TAP_WINDOW_MS = 220;
  const TAP_Z_DELTA = 0.06;      // smaller = more sensitive
  const TAP_COOLDOWN_MS = 260;
  let lastTapTime = 0;

  let hands = null;
  let stream = null;
  let running = false;
  let handsBusy = false;

  let cursor = { x: 0.5, y: 0.5, tracked: false };
  const SMOOTHING = 0.45;

  // small offscreen canvas fed to MediaPipe — kept separate from the full-size display feed
  const inferenceCanvas = document.createElement('canvas');
  const inferenceCtx = inferenceCanvas.getContext('2d');
  const INFERENCE_W = 480, INFERENCE_H = 270;
  inferenceCanvas.width = INFERENCE_W;
  inferenceCanvas.height = INFERENCE_H;

  function dist(a, b){
    const dx = a.x - b.x, dy = a.y - b.y;
    return Math.sqrt(dx*dx + dy*dy);
  }

  function toPx(landmarks, w, h){
    return landmarks.map(p => ({ x: p.x * w, y: p.y * h }));
  }

  function onResults(results){
    const w = handCanvas.width, h = handCanvas.height;
    handCtx.clearRect(0, 0, w, h);

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0){
      const raw = results.multiHandLandmarks[0];
      const pts = toPx(raw, w, h);

      const tip = raw[8]; // index fingertip (normalized, has real .z)
      cursor.x += (tip.x - cursor.x) * SMOOTHING;
      cursor.y += (tip.y - cursor.y) * SMOOTHING;
      cursor.tracked = true;

      const palmLen = dist(pts[0], pts[9]) || 1;

      let triggered = false;
      if (GESTURE_MODE === 'pinch'){
        triggered = dist(pts[4], pts[8]) < palmLen * 0.32;
      } else {
        const now = performance.now();
        tapHistory.push({ z: tip.z, t: now });
        tapHistory = tapHistory.filter(p => now - p.t < TAP_WINDOW_MS);

        if (tapHistory.length > 2 && now - lastTapTime > TAP_COOLDOWN_MS){
          const pushedIn = tapHistory[0].z - tip.z;
          if (pushedIn > TAP_Z_DELTA){
            lastTapTime = now;
          }
        }
        triggered = (now - lastTapTime) < 150;
      }

      // reticle only — no skeleton
      const cx = cursor.x * w, cy = cursor.y * h;
      handCtx.save();
      handCtx.strokeStyle = triggered ? '#c8ff4d' : '#8a6bff';
      handCtx.shadowColor = handCtx.strokeStyle;
      handCtx.shadowBlur = 18;
      handCtx.lineWidth = 3;
      handCtx.beginPath();
      handCtx.arc(cx, cy, triggered ? 11 : 16, 0, Math.PI*2);
      handCtx.stroke();
      handCtx.restore();

      hudPinch.textContent = triggered ? 'on' : 'off';
    } else {
      cursor.tracked = false;
      hudPinch.textContent = 'off';
    }
  }

  function onVideoFrame(){
    if (!running) return;
    if (!handsBusy){
      handsBusy = true;
      inferenceCtx.drawImage(videoEl, 0, 0, INFERENCE_W, INFERENCE_H);
      const t0 = performance.now();
      hands.send({ image: inferenceCanvas }).finally(() => {
        const ms = (performance.now() - t0).toFixed(0);
        hudStatus.textContent = 'live · ' + ms + 'ms';
        handsBusy = false;
      });
    }
    if (videoEl.requestVideoFrameCallback){
      videoEl.requestVideoFrameCallback(onVideoFrame);
    } else {
      requestAnimationFrame(onVideoFrame);
    }
  }

  async function start(){
    startBtn.disabled = true;
    hudStatus.textContent = 'requesting camera…';

    try{
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width:  { ideal: 1280 },
          height: { ideal: 720 },
          aspectRatio: { ideal: 16/9 },
          frameRate: { ideal: 30, min: 15 }
        },
        audio: false
      });
    } catch(e){
      console.error('getUserMedia failed:', e.name, e.message);
      hudStatus.textContent = 'error: ' + e.name;
      startBtn.disabled = false;
      return;
    }

    videoEl.srcObject = stream;
    await new Promise(res => { videoEl.onloadedmetadata = res; });
    await videoEl.play();

    handCanvas.width = videoEl.videoWidth;
    handCanvas.height = videoEl.videoHeight;

    hudStatus.textContent = 'loading model…';

    if (!hands){
      hands = new Hands({
        locateFile: (file) => 'https://cdn.jsdelivr.net/npm/@mediapipe/hands/' + file
      });
      hands.setOptions({
        selfieMode: false,
        maxNumHands: 1,
        modelComplexity: 0,
        minDetectionConfidence: 0.6,
        minTrackingConfidence: 0.55
      });
      hands.onResults(onResults);
    }

    running = true;
    hero.classList.add('hidden');
    hudStatus.textContent = 'live';

    onVideoFrame();
  }

  startBtn.addEventListener('click', start);

})();
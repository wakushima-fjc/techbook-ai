import {
  PoseLandmarker,
  FilesetResolver,
  DrawingUtils
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.2/+esm";
import { REBAEngine } from "./reba-engine.js";
import { ClinicalEngine } from "./clinical-engine.js";
// ============================================================
// デバッグログ
// ============================================================
const debugArea = document.getElementById('debug-log');
function log(msg) {
    console.log(`[AI] ${msg}`);
    if (debugArea) { debugArea.style.display='block'; debugArea.innerHTML += ` > ${msg}<br>`; debugArea.scrollTop = debugArea.scrollHeight; }
}
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
// ============================================================
// 追跡カラーパレット（最大6関節）
// ============================================================
const TRACK_COLORS = ['#00ff88','#ff6b6b','#60a5fa','#fbbf24','#e879f9','#34d399'];
const JOINT_NAMES = {
    0:'頭部', 11:'左肩', 12:'右肩', 13:'左肘', 14:'右肘',
    15:'左手首', 16:'右手首', 23:'左股関節', 24:'右股関節',
    25:'左膝', 26:'右膝', 27:'左足首', 28:'右足首'
};
// ============================================================
// アプリ状態
// ============================================================
const state = {
    isRunning: false, isPredicting: false, isRecording: false,
    rebaScore: 1, history: [],
    isComparing: false,
    isVideoMode: false,   // 動画ファイル使用中か
    isLooping: false,
    setup: { load: 0, coupling: 0, suddenForce: false },
    // 複数選択（Set of indices）
    selectedParts: new Set([23]),   // デフォルト: 左股関節
    activeMetric: 'angle',
    activePlane: 'XY',
    isOrbitActive: false,
    orbits: {}  // { idx: [{x,y,t},...] }
};
const MAX_ORBIT = 50;
const reba = new REBAEngine();
const clinical = new ClinicalEngine();
let poseLandmarker, mainChart, isModelReady = false;
let mediaRecorder, recordedChunks = [];
// ============================================================
// DOM
// ============================================================
const el = {
    video:          document.getElementById('input-video'),
    canvas:         document.getElementById('output-canvas'),
    overlay:        document.getElementById('processing-overlay'),
    statusText:     document.getElementById('status-text'),
    statusDot:      document.getElementById('status-dot'),
    rebaVal:        document.getElementById('reba-score-value'),
    riskBadge:      document.getElementById('risk-level-badge'),
    backVal:        document.getElementById('back-load-value'),
    kneeVal:        document.getElementById('knee-load-value'),
    trackedVal:     document.getElementById('tracked-value'),
    videoUpload:    document.getElementById('video-upload'),
    toggleCam:      document.getElementById('toggle-cam'),
    btnRecord:      document.getElementById('btn-record'),
    setupModal:     document.getElementById('setup-modal'),
    startBtn:       document.getElementById('start-analysis'),
    selectorModal:  document.getElementById('selector-modal'),
    btnShowSel:     document.getElementById('btn-show-selector'),
    btnCloseSel:    document.getElementById('close-selector'),
    btnClearSel:    document.getElementById('btn-clear-selection'),
    planeSelect:    document.getElementById('plane-select'),
    btnToggleOrbit: document.getElementById('btn-toggle-orbit'),
    metricAngle:    document.getElementById('metric-angle'),
    metricVelocity: document.getElementById('metric-velocity'),
    selectedBadges: document.getElementById('selected-badges'),
    trackedJoints:  document.getElementById('tracked-joints-list'),
    // 動画コントロール
    videoControls:  document.getElementById('video-controls'),
    seekBar:        document.getElementById('seek-bar'),
    btnPlayPause:   document.getElementById('btn-play-pause'),
    btnRewind:      document.getElementById('btn-rewind'),
    btnLoop:        document.getElementById('btn-loop'),
    timeDisplay:    document.getElementById('time-display'),
    liveLabel:      document.getElementById('live-label'),
    liveDot:        document.getElementById('live-dot'),
    // 比較
    compSection:    document.getElementById('comparison-section'),
    compToggle:     document.getElementById('btn-compare-toggle-v2'),
    compClose:      document.getElementById('btn-compare-close'),
    refVideo:       document.getElementById('ref-video'),
    targetVideo:    document.getElementById('target-video'),
    refCanvas:      document.getElementById('ref-canvas'),
    targetCanvas:   document.getElementById('target-canvas'),
    refUpload:      document.getElementById('ref-upload'),
    targetUpload:   document.getElementById('target-upload'),
    syncPlay:       document.getElementById('sync-play'),
    // レポート
    reportModal:    document.getElementById('report-container'),
    closeReport:    document.getElementById('close-report'),
    aiFeedback:     document.getElementById('ai-feedback'),
    statsArea:      document.getElementById('alignment-stats'),
    btnStop:        document.getElementById('btn-stop'),
    btnExport:      document.getElementById('btn-export-direct'),
    btnExport2:     document.getElementById('btn-export-v2'),
};
const ctx  = el.canvas.getContext('2d');
const refCtx  = el.refCanvas?.getContext('2d');
const targCtx = el.targetCanvas?.getContext('2d');
// ============================================================
// INIT
// ============================================================
async function init() {
    setupEventListeners();
    updateJointBadges();
    try {
        updateStatus('AIモデル読込中...', '#f59e0b');
        const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.2/wasm");
        poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`,
                delegate: "GPU"
            },
            runningMode: "VIDEO", numPoses: 1
        });
        isModelReady = true;
        updateStatus('準備完了', '#22c55e');
        el.overlay?.classList.add('hidden');
        initCharts();
        log("AI System V2.2 Online. Multi-joint tracking enabled.");
    } catch (err) {
        log(`Fatal: ${err.message}`);
        updateStatus('初期化失敗', '#ef4444');
    }
}
function updateStatus(text, color) {
    if (el.statusText) el.statusText.innerText = text;
    if (el.statusDot) el.statusDot.style.backgroundColor = color;
}
// ============================================================
// EVENT LISTENERS
// ============================================================
function setupEventListeners() {
    const on = (idOrEl, type, fn) => {
        const e = typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl;
        if (e) e.addEventListener(type, fn);
    };
    // デバッグ
    on('app-title', 'click', () => {
        if (debugArea) debugArea.style.display = debugArea.style.display === 'block' ? 'none' : 'block';
    });
    // セットアップ
    document.querySelectorAll('.load-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.load-btn').forEach(b => b.classList.remove('bg-white','text-black'));
            document.getElementById('btn-no-load')?.classList.remove('bg-white','text-black');
            btn.classList.add('bg-white','text-black');
            state.setup.load = btn.dataset.value === "2" ? 15 : btn.dataset.value === "1" ? 7 : 3;
        });
    });
    on('btn-no-load', 'click', () => {
        document.querySelectorAll('.load-btn').forEach(b => b.classList.remove('bg-white','text-black'));
        document.getElementById('btn-no-load').classList.add('bg-white','text-black');
        state.setup.load = 0;
    });
    on('sudden-force', 'change', (e) => state.setup.suddenForce = e.target.checked);
    on('coupling-select', 'change', (e) => state.setup.coupling = parseInt(e.target.value));
    on(el.startBtn, 'click', () => {
        if (!isModelReady) { alert("AI準備中です..."); return; }
        el.setupModal.classList.add('hidden');
        if (!el.video.src && !el.video.srcObject) startCamera();
    });
    // カメラ・動画
    on(el.toggleCam, 'click', startCamera);
    on(el.videoUpload, 'change', (e) => {
        const f = e.target.files[0];
        if (f) loadVideoFile(f, el.video, el.canvas);
    });
    // 部位選択（複数対応）
    on(el.btnShowSel, 'click', () => el.selectorModal.classList.remove('hidden'));
    on(el.btnCloseSel, 'click', () => el.selectorModal.classList.add('hidden'));
    on(el.btnClearSel, 'click', () => {
        state.selectedParts.clear();
        state.orbits = {};
        updateJointBadges();
        updateDotColors();
        log("Joint selection cleared");
    });
    document.querySelectorAll('.joint-point').forEach(p => {
        p.addEventListener('click', (e) => {
            const id = parseInt(e.target.dataset.id);
            const name = e.target.dataset.name || JOINT_NAMES[id] || `関節${id}`;
            if (state.selectedParts.has(id)) {
                state.selectedParts.delete(id);
                delete state.orbits[id];
                log(`Deselected: ${name}`);
            } else {
                if (state.selectedParts.size >= 6) {
                    alert("最大6関節まで同時追跡できます");
                    return;
                }
                state.selectedParts.add(id);
                log(`Selected: ${name} (${state.selectedParts.size} total)`);
            }
            updateJointBadges();
            updateDotColors();
        });
    });
    // 解析モード
    on(el.metricAngle, 'click', () => {
        state.activeMetric = 'angle';
        el.metricAngle.classList.add('bg-white','text-black'); el.metricAngle.classList.remove('text-white/60');
        el.metricVelocity.classList.remove('bg-white','text-black'); el.metricVelocity.classList.add('text-white/60');
    });
    on(el.metricVelocity, 'click', () => {
        state.activeMetric = 'velocity';
        el.metricVelocity.classList.add('bg-white','text-black'); el.metricVelocity.classList.remove('text-white/60');
        el.metricAngle.classList.remove('bg-white','text-black'); el.metricAngle.classList.add('text-white/60');
    });
    on(el.planeSelect, 'change', (e) => { state.activePlane = e.target.value; log(`Plane: ${state.activePlane}`); });
    on(el.btnToggleOrbit, 'click', () => {
        state.isOrbitActive = !state.isOrbitActive;
        el.btnToggleOrbit.textContent = `🔵 軌跡表示: ${state.isOrbitActive ? 'ON' : 'OFF'}`;
        el.btnToggleOrbit.style.background = state.isOrbitActive ? '#fff' : '';
        el.btnToggleOrbit.style.color = state.isOrbitActive ? '#000' : '';
        log(`Orbit: ${state.isOrbitActive}`);
    });
    // 動画コントロール
    on(el.btnPlayPause, 'click', togglePlayPause);
    on(el.btnRewind, 'click', () => {
        el.video.currentTime = 0;
        if (el.video.paused) { el.video.play(); el.btnPlayPause.textContent = '⏸'; }
    });
    on(el.btnLoop, 'click', () => {
        state.isLooping = !state.isLooping;
        el.video.loop = state.isLooping;
        el.btnLoop.style.color = state.isLooping ? '#00ff88' : '';
        log(`Loop: ${state.isLooping}`);
    });
    on(el.seekBar, 'input', () => {
        if (el.video.duration) el.video.currentTime = (el.seekBar.value / 100) * el.video.duration;
    });
    document.querySelectorAll('.speed-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            el.video.playbackRate = parseFloat(btn.dataset.speed);
            log(`Speed: ${btn.dataset.speed}x`);
        });
    });
    // 動画の時間更新 → シークバー更新
    el.video.addEventListener('timeupdate', () => {
        if (!el.video.duration) return;
        el.seekBar.value = (el.video.currentTime / el.video.duration) * 100;
        el.timeDisplay.textContent = `${fmtTime(el.video.currentTime)} / ${fmtTime(el.video.duration)}`;
    });
    el.video.addEventListener('ended', () => {
        el.btnPlayPause.textContent = '▶';
        if (state.isLooping) { el.video.currentTime = 0; el.video.play(); }
    });
    // 比較モード
    on(el.compToggle, 'click', () => el.compSection.classList.remove('hidden'));
    on(el.compClose,  'click', () => el.compSection.classList.add('hidden'));
    on(el.refUpload,    'change', (e) => { const f = e.target.files[0]; if (f) loadVideoFile(f, el.refVideo, el.refCanvas, false); });
    on(el.targetUpload, 'change', (e) => { const f = e.target.files[0]; if (f) loadVideoFile(f, el.targetVideo, el.targetCanvas, true); });
    on(el.syncPlay, 'click', () => {
        el.refVideo.currentTime = 0; el.targetVideo.currentTime = 0;
        el.refVideo.play(); el.targetVideo.play();
        state.isRunning = true; state.isComparing = true; predict();
    });
    // レポート・録画・CSV
    on(el.btnStop,    'click', () => { state.isRunning = false; showReport(); });
    on(el.closeReport,'click', () => el.reportModal.classList.add('hidden'));
    on(el.btnRecord,  'click', toggleRecording);
    on(el.btnExport,  'click', exportCSV);
    on(el.btnExport2, 'click', exportCSV);
}
function fmtTime(s) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
}
function togglePlayPause() {
    if (el.video.paused) {
        el.video.play(); el.btnPlayPause.textContent = '⏸';
        state.isRunning = true; predict();
    } else {
        el.video.pause(); el.btnPlayPause.textContent = '▶';
    }
}
// ============================================================
// 部位バッジ更新
// ============================================================
function updateJointBadges() {
    // 部位選択モーダル内バッジ
    if (el.selectedBadges) {
        el.selectedBadges.innerHTML = '';
        let i = 0;
        state.selectedParts.forEach(id => {
            const color = TRACK_COLORS[i % TRACK_COLORS.length];
            const badge = document.createElement('span');
            badge.className = 'track-badge';
            badge.style.cssText = `background:${color}22; border:1px solid ${color}66; color:${color}`;
            badge.textContent = JOINT_NAMES[id] || `関節${id}`;
            el.selectedBadges.appendChild(badge);
            i++;
        });
        if (state.selectedParts.size === 0) {
            el.selectedBadges.innerHTML = '<span style="color:rgba(255,255,255,0.3);font-size:9px">未選択</span>';
        }
    }
    // ビューポート右上パネル
    if (el.trackedJoints) {
        el.trackedJoints.innerHTML = '';
        let i = 0;
        state.selectedParts.forEach(id => {
            const color = TRACK_COLORS[i % TRACK_COLORS.length];
            const div = document.createElement('div');
            div.className = 'flex items-center gap-1';
            div.innerHTML = `<div style="width:6px;height:6px;border-radius:50%;background:${color}"></div><span style="font-size:9px;font-weight:700;color:rgba(255,255,255,0.8)">${JOINT_NAMES[id]||`関節${id}`}</span>`;
            el.trackedJoints.appendChild(div);
            i++;
        });
    }
}
function updateDotColors() {
    // 全ドットをリセット
    document.querySelectorAll('[id^="dot-"]').forEach(d => d.setAttribute('fill', '#666'));
    let i = 0;
    state.selectedParts.forEach(id => {
        const dot = document.getElementById(`dot-${id}`);
        if (dot) dot.setAttribute('fill', TRACK_COLORS[i % TRACK_COLORS.length]);
        i++;
    });
}
// ============================================================
// CAMERA / VIDEO
// ============================================================
async function startCamera() {
    try {
        log("カメラ起動中...");
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        el.video.srcObject = stream; el.video.src = null;
        el.video.load();
        el.video.onloadedmetadata = () => {
            el.canvas.width = el.video.videoWidth; el.canvas.height = el.video.videoHeight;
            el.video.play(); state.isRunning = true; state.isVideoMode = false;
            el.videoControls?.classList.add('hidden');
            el.liveLabel.textContent = 'LIVE';
            predict();
        };
    } catch (e) { log(`Camera Error: ${e.message}`); }
}
function loadVideoFile(file, video, canvas, isMain = true) {
    log(`Loading: ${file.name}`);
    video.srcObject = null; video.src = URL.createObjectURL(file);
    video.load();
    video.onloadedmetadata = () => {
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        video.play().then(() => {
            log(`Playing: ${file.name}`);
            if (isMain) {
                state.isRunning = true; state.isVideoMode = true;
                el.videoControls?.classList.remove('hidden');
                el.btnPlayPause.textContent = '⏸';
                el.liveLabel.textContent = '動画';
                el.liveDot.style.background = '#60a5fa';
                predict();
            }
        }).catch(e => log(`Play error: ${e.message}`));
    };
}
// ============================================================
// PREDICT LOOP
// ============================================================
function predict() {
    if (state.isPredicting) return;
    state.isPredicting = true;
    const loop = () => {
        if (!state.isRunning) { state.isPredicting = false; return; }
        if (!el.compSection.classList.contains('hidden') && state.isComparing) {
            processFrame(el.refVideo, el.refCanvas, refCtx, false);
            processFrame(el.targetVideo, el.targetCanvas, targCtx, true);
        } else {
            processFrame(el.video, el.canvas, ctx, true);
        }
        requestAnimationFrame(loop);
    };
    loop();
}
function processFrame(video, canvas, context, isMain) {
    if (!video || video.paused || video.ended || video.readyState < 2) return;
    const ts = performance.now();
    try {
        const res = poseLandmarker.detectForVideo(video, ts);
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        if (res.landmarks?.[0]) {
            const lm = res.landmarks[0];
            const du = new DrawingUtils(context);
            du.drawConnectors(lm, PoseLandmarker.POSE_CONNECTIONS, { color: isMain ? 'rgba(255,255,255,0.5)' : '#3b82f6', lineWidth: 2 });
            du.drawLandmarks(lm, { color: 'rgba(255,255,255,0.3)', radius: 2, lineWidth: 1 });
            if (isMain) {
                updateOrbitsAll(lm);
                if (state.isOrbitActive) drawOrbitsAll(context, canvas);
                highlightSelected(context, canvas, lm);
                calculateAnalytics(lm);
            }
        }
    } catch (_) {}
}
// ============================================================
// 複数関節の軌跡
// ============================================================
function updateOrbitsAll(lm) {
    let i = 0;
    state.selectedParts.forEach(id => {
        const p = lm[id]; if (!p) { i++; return; }
        if (!state.orbits[id]) state.orbits[id] = [];
        state.orbits[id].push({ x: p.x, y: p.y, z: p.z, t: Date.now() });
        if (state.orbits[id].length > MAX_ORBIT) state.orbits[id].shift();
        i++;
    });
}
function drawOrbitsAll(context, canvas) {
    let colorIdx = 0;
    state.selectedParts.forEach(id => {
        const pts = state.orbits[id];
        const color = TRACK_COLORS[colorIdx % TRACK_COLORS.length];
        if (pts && pts.length >= 2) {
            for (let i = 1; i < pts.length; i++) {
                const alpha = (i / pts.length) * 0.85;
                context.beginPath();
                context.moveTo(pts[i-1].x * canvas.width, pts[i-1].y * canvas.height);
                context.lineTo(pts[i].x   * canvas.width, pts[i].y   * canvas.height);
                context.strokeStyle = `${color}${Math.round(alpha * 255).toString(16).padStart(2,'0')}`;
                context.lineWidth = 1.5 + alpha * 2;
                context.stroke();
            }
        }
        colorIdx++;
    });
}
function highlightSelected(context, canvas, lm) {
    let i = 0;
    state.selectedParts.forEach(id => {
        const p = lm[id]; if (!p) { i++; return; }
        const color = TRACK_COLORS[i % TRACK_COLORS.length];
        const x = p.x * canvas.width, y = p.y * canvas.height;
        // 内側リング
        context.beginPath();
        context.arc(x, y, 10, 0, Math.PI * 2);
        context.strokeStyle = color;
        context.lineWidth = 2.5;
        context.stroke();
        // 外側パルスリング
        context.beginPath();
        context.arc(x, y, 16, 0, Math.PI * 2);
        context.strokeStyle = `${color}55`;
        context.lineWidth = 1.5;
        context.stroke();
        i++;
    });
}
// ============================================================
// ANALYTICS
// ============================================================
function calculateAnalytics(pl) {
    const sC = { x: (pl[11].x+pl[12].x)/2, y: (pl[11].y+pl[12].y)/2 };
    const hC = { x: (pl[23].x+pl[24].x)/2, y: (pl[23].y+pl[24].y)/2 };
    const trunkAngle = Math.abs(Math.atan2(sC.x-hC.x, hC.y-sC.y) * 180 / Math.PI);
    const kneeAngle  = calcAngle3(pl[24], pl[26], pl[28]);
    const trunkScore = trunkAngle > 60 ? 4 : trunkAngle > 40 ? 3 : trunkAngle > 20 ? 2 : 1;
    const loadScore  = state.setup.load > 10 ? 3 : state.setup.load > 5 ? 2 : state.setup.load > 0 ? 1 : 0;
    const score = Math.max(1, Math.min(15, trunkScore + loadScore + (state.setup.suddenForce ? 1 : 0)));
    state.rebaScore = score;
    // 速度（全選択部位の平均）
    let totalVel = 0, velCount = 0;
    state.selectedParts.forEach(id => {
        const pts = state.orbits[id];
        if (pts && pts.length >= 2) {
            const a = pts[pts.length-2], b = pts[pts.length-1];
            const dist = Math.sqrt((b.x-a.x)**2+(b.y-a.y)**2);
            const dt = (b.t - a.t) / 1000;
            if (dt > 0) { totalVel += dist / dt; velCount++; }
        }
    });
    const velocity = velCount > 0 ? totalVel / velCount : 0;
    // UI 更新
    el.rebaVal.innerText = score;
    const action = reba.getActionLevel(score);
    el.riskBadge.innerText = action.risk;
    el.riskBadge.style.backgroundColor = action.color;
    el.backVal.innerText = `${trunkAngle.toFixed(0)}°`;
    el.kneeVal.innerText = `${kneeAngle.toFixed(0)}°`;
    el.trackedVal.innerText = state.activeMetric === 'velocity'
        ? `${(velocity*100).toFixed(1)} cm/s`
        : `${trunkAngle.toFixed(1)}°`;
    state.history.push({ timestamp: Date.now(), score, trunk: trunkAngle, knee: kneeAngle, velocity });
}
function calcAngle3(A, B, C) {
    const v1 = { x: A.x-B.x, y: A.y-B.y };
    const v2 = { x: C.x-B.x, y: C.y-B.y };
    const dot = v1.x*v2.x + v1.y*v2.y;
    const mag = Math.sqrt(v1.x**2+v1.y**2) * Math.sqrt(v2.x**2+v2.y**2);
    return Math.acos(Math.max(-1, Math.min(1, dot/mag))) * 180 / Math.PI;
}
// ============================================================
// CHARTS
// ============================================================
function initCharts() {
    const c = document.getElementById('main-chart'); if (!c) return;
    mainChart = new Chart(c, {
        type: 'line',
        data: { datasets: [
            { label: 'REBAスコア', data: [], borderColor: '#fff', borderWidth: 2, pointRadius: 0, yAxisID: 'y' },
            { label: '体幹角度', data: [], borderColor: '#00ff88', borderWidth: 1, pointRadius: 0, yAxisID: 'y2', borderDash: [4,2] }
        ]},
        options: {
            responsive: true, maintainAspectRatio: false, animation: false,
            scales: {
                x: { type: 'realtime', ticks: { color:'#555', font:{size:8} }, grid: { color:'#222' } },
                y: { min: 0, max: 15, ticks: { color:'#555', font:{size:8} }, grid: { color:'#222' } },
                y2: { min: 0, max: 90, position: 'right', ticks: { color:'#00ff88', font:{size:8} }, grid: { display:false } }
            },
            plugins: { legend: { labels: { color:'#555', font:{size:8} } } }
        }
    });
    setInterval(() => {
        if (!state.isRunning || !mainChart) return;
        const h = state.history[state.history.length-1]; if (!h) return;
        mainChart.data.datasets[0].data.push({ x: Date.now(), y: h.score });
        mainChart.data.datasets[1].data.push({ x: Date.now(), y: h.trunk });
    }, 500);
}
// ============================================================
// REPORT
// ============================================================
function showReport() {
    const feedback = clinical.generateReport({ history: state.history, setup: state.setup });
    el.aiFeedback.innerHTML = '';
    feedback.forEach(item => {
        const d = document.createElement('div');
        d.className = 'p-4 rounded-xl border border-white/10 bg-white/5';
        const c = item.color || '#6b7280';
        d.innerHTML = `
            <div class="flex justify-between items-center mb-2">
                <span class="text-[10px] font-black text-white">${item.part}</span>
                <span class="text-[8px] font-bold px-2 py-0.5 rounded-full" style="background:${c}20;color:${c};border:1px solid ${c}40">${item.priority}</span>
            </div>
            <p class="text-[10px] leading-relaxed text-white/70">${item.comment}</p>`;
        el.aiFeedback.appendChild(d);
    });
    const h = state.history;
    const mT = h.length ? Math.max(...h.map(x=>x.trunk)).toFixed(1) : 0;
    const mK = h.length ? Math.max(...h.map(x=>x.knee)).toFixed(1)  : 0;
    const aS = h.length ? (h.reduce((a,b)=>a+b.score,0)/h.length).toFixed(1) : 0;
    const mS = h.length ? Math.max(...h.map(x=>x.score)) : 0;
    el.statsArea.innerHTML = `
        <div class="glass rounded-lg p-2 text-center"><div class="text-[8px] text-white/40">最大体幹角度</div><div class="font-black text-sm">${mT}°</div></div>
        <div class="glass rounded-lg p-2 text-center"><div class="text-[8px] text-white/40">最大膝屈曲</div><div class="font-black text-sm">${mK}°</div></div>
        <div class="glass rounded-lg p-2 text-center"><div class="text-[8px] text-white/40">平均REBAスコア</div><div class="font-black text-sm">${aS}</div></div>
        <div class="glass rounded-lg p-2 text-center"><div class="text-[8px] text-white/40">ピークスコア</div><div class="font-black text-sm">${mS}</div></div>`;
    el.reportModal.classList.remove('hidden');
}
// ============================================================
// RECORDING & CSV
// ============================================================
function toggleRecording() {
    if (!state.isRecording) {
        recordedChunks = [];
        const stream = el.canvas.captureStream(30);
        const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
        mediaRecorder = new MediaRecorder(stream, { mimeType: mime });
        mediaRecorder.ondataavailable = (e) => recordedChunks.push(e.data);
        mediaRecorder.onstop = () => {
            const blob = new Blob(recordedChunks, { type: mime });
            const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
            a.download = `Analysis_${Date.now()}.webm`; a.click();
        };
        mediaRecorder.start(); state.isRecording = true;
        document.getElementById('record-icon').style.borderRadius = '2px';
        log("録画開始");
    } else {
        mediaRecorder.stop(); state.isRecording = false;
        document.getElementById('record-icon').style.borderRadius = '50%';
        log("録画停止");
    }
}
function exportCSV() {
    if (!state.history.length) { alert("解析データがありません"); return; }
    let csv = "\uFEFF時刻,REBAスコア,体幹角度（°）,膝角度（°）,速度\n";
    state.history.forEach(h => {
        csv += `${new Date(h.timestamp).toLocaleTimeString('ja-JP')},${h.score},${h.trunk.toFixed(1)},${h.knee.toFixed(1)},${h.velocity.toFixed(3)}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `REBA_${new Date().toISOString().split('T')[0]}.csv`; a.click();
    log("CSV保存完了");
}
init();

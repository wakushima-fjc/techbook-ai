import {
  PoseLandmarker,
  FilesetResolver,
  DrawingUtils
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.2/+esm";
import { REBAEngine } from "./reba-engine.js";
import { ClinicalEngine } from "./clinical-engine.js";
// --- デバッグログ ---
const debugArea = document.getElementById('debug-log');
function log(msg) {
    console.log(`[AI] ${msg}`);
    if (debugArea) {
        debugArea.style.display = 'block';
        debugArea.innerHTML += ` > ${msg}<br>`;
        debugArea.scrollTop = debugArea.scrollHeight;
    }
}
// --- Service Worker ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
// --- アプリの状態 ---
const state = {
    isRunning: false, isPredicting: false, isRecording: false,
    rebaScore: 1, history: [],
    isComparing: false,
    setup: { load: 0, coupling: 0, suddenForce: false },
    // 部位・解析モード
    selectedPart: 23,           // デフォルト: 左股関節
    selectedPartName: '左股関節',
    activeMetric: 'angle',      // 'angle' | 'velocity'
    activePlane: 'XY',
    isOrbitActive: false,
    orbits: {}
};
const MAX_ORBIT = 40;
const JOINT_NAMES = {
    0: '頭部', 11: '左肩', 12: '右肩', 13: '左肘', 14: '右肘',
    15: '左手首', 16: '右手首', 23: '左股関節', 24: '右股関節',
    25: '左膝', 26: '右膝', 27: '左足首', 28: '右足首'
};
const reba = new REBAEngine();
const clinical = new ClinicalEngine();
let poseLandmarker, mainChart, isModelReady = false;
let mediaRecorder, recordedChunks = [];
// --- DOM要素 ---
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
    planeSelect:    document.getElementById('plane-select'),
    btnToggleOrbit: document.getElementById('btn-toggle-orbit'),
    metricAngle:    document.getElementById('metric-angle'),
    metricVelocity: document.getElementById('metric-velocity'),
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
    reportModal:    document.getElementById('report-container'),
    closeReport:    document.getElementById('close-report'),
    aiFeedback:     document.getElementById('ai-feedback'),
    statsArea:      document.getElementById('alignment-stats'),
    btnStop:        document.getElementById('btn-stop'),
    btnExport:      document.getElementById('btn-export-direct'),
    btnExport2:     document.getElementById('btn-export-v2'),
    jointInfo:      document.getElementById('joint-info-panel'),
    jointName:      document.getElementById('joint-name-display'),
    jointValue:     document.getElementById('joint-value-display'),
};
const ctx = el.canvas.getContext('2d');
const refCtx  = el.refCanvas?.getContext('2d');
const targCtx = el.targetCanvas?.getContext('2d');
// ================================================================
// INIT
// ================================================================
async function init() {
    setupEventListeners();
    try {
        updateStatus('AIモデル読込中...', '#f59e0b');
        const vision = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.2/wasm"
        );
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
        log("AI System V2.1 Online. All features activated.");
    } catch (err) {
        log(`Fatal Error: ${err.message}`);
        updateStatus('初期化失敗', '#ef4444');
    }
}
function updateStatus(text, color) {
    if (el.statusText) el.statusText.innerText = text;
    if (el.statusDot) el.statusDot.style.backgroundColor = color;
}
// ================================================================
// EVENT LISTENERS
// ================================================================
function setupEventListeners() {
    const on = (idOrEl, type, fn) => {
        const e = typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl;
        if (e) e.addEventListener(type, fn);
    };
    // デバッグログ表示
    on('app-title', 'click', () => {
        if (debugArea) debugArea.style.display = debugArea.style.display === 'block' ? 'none' : 'block';
    });
    // --- セットアップモーダル ---
    document.querySelectorAll('.load-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.load-btn').forEach(b => b.classList.remove('bg-white', 'text-black'));
            document.getElementById('btn-no-load')?.classList.remove('bg-white', 'text-black');
            btn.classList.add('bg-white', 'text-black');
            const v = btn.dataset.value;
            state.setup.load = v === "2" ? 15 : v === "1" ? 7 : 3;
        });
    });
    on('btn-no-load', 'click', () => {
        document.querySelectorAll('.load-btn').forEach(b => b.classList.remove('bg-white', 'text-black'));
        document.getElementById('btn-no-load').classList.add('bg-white', 'text-black');
        state.setup.load = 0;
    });
    on('sudden-force', 'change', (e) => state.setup.suddenForce = e.target.checked);
    on('coupling-select', 'change', (e) => state.setup.coupling = parseInt(e.target.value));
    on(el.startBtn, 'click', () => {
        if (!isModelReady) { alert("AIモデル準備中です。しばらくお待ちください。"); return; }
        el.setupModal.classList.add('hidden');
        if (!el.video.src && !el.video.srcObject) startCamera();
    });
    // --- カメラ・動画 ---
    on(el.toggleCam, 'click', startCamera);
    on(el.videoUpload, 'change', (e) => {
        const file = e.target.files[0];
        if (file) loadVideoFile(file, el.video, el.canvas);
    });
    // --- 部位選択モーダル ---
    on(el.btnShowSel, 'click', () => el.selectorModal.classList.remove('hidden'));
    on(el.btnCloseSel, 'click', () => el.selectorModal.classList.add('hidden'));
    // 各関節ポイントのクリック
    document.querySelectorAll('.joint-point').forEach(p => {
        p.addEventListener('click', (e) => {
            const id = parseInt(e.target.dataset.id);
            const name = e.target.dataset.name || JOINT_NAMES[id] || `関節 ${id}`;
            selectJoint(id, name);
        });
    });
    // 解析メトリクス切替
    on(el.metricAngle, 'click', () => {
        state.activeMetric = 'angle';
        el.metricAngle.classList.add('bg-white', 'text-black');
        el.metricAngle.classList.remove('text-white/60');
        el.metricVelocity.classList.remove('bg-white', 'text-black');
        el.metricVelocity.classList.add('text-white/60');
        log("Mode: Angle Analysis");
    });
    on(el.metricVelocity, 'click', () => {
        state.activeMetric = 'velocity';
        el.metricVelocity.classList.add('bg-white', 'text-black');
        el.metricVelocity.classList.remove('text-white/60');
        el.metricAngle.classList.remove('bg-white', 'text-black');
        el.metricAngle.classList.add('text-white/60');
        log("Mode: Velocity Analysis");
    });
    // 解析平面切替
    on(el.planeSelect, 'change', (e) => {
        state.activePlane = e.target.value;
        log(`Plane: ${state.activePlane}`);
    });
    // 軌跡 ON/OFF
    on(el.btnToggleOrbit, 'click', () => {
        state.isOrbitActive = !state.isOrbitActive;
        if (state.isOrbitActive) {
            el.btnToggleOrbit.textContent = '🔵 軌跡表示: ON';
            el.btnToggleOrbit.classList.add('bg-white', 'text-black');
            el.btnToggleOrbit.classList.remove('text-white/60');
        } else {
            el.btnToggleOrbit.textContent = '🔵 軌跡表示: OFF';
            el.btnToggleOrbit.classList.remove('bg-white', 'text-black');
            el.btnToggleOrbit.classList.add('text-white/60');
        }
        log(`Orbit: ${state.isOrbitActive ? 'ON' : 'OFF'}`);
    });
    // --- 比較モード ---
    on(el.compToggle, 'click', () => el.compSection.classList.remove('hidden'));
    on(el.compClose, 'click', () => el.compSection.classList.add('hidden'));
    on(el.refUpload, 'change', (e) => {
        const f = e.target.files[0];
        if (f) loadVideoFile(f, el.refVideo, el.refCanvas, false);
    });
    on(el.targetUpload, 'change', (e) => {
        const f = e.target.files[0];
        if (f) loadVideoFile(f, el.targetVideo, el.targetCanvas, true);
    });
    on(el.syncPlay, 'click', () => {
        el.refVideo.currentTime = 0; el.targetVideo.currentTime = 0;
        el.refVideo.play(); el.targetVideo.play();
        state.isRunning = true; state.isComparing = true;
        predict();
    });
    // --- 終了・レポート・録画 ---
    on(el.btnStop, 'click', () => { state.isRunning = false; showReport(); });
    on(el.closeReport, 'click', () => el.reportModal.classList.add('hidden'));
    on(el.btnRecord, 'click', toggleRecording);
    on(el.btnExport, 'click', exportCSV);
    on(el.btnExport2, 'click', exportCSV);
}
function selectJoint(id, name) {
    state.selectedPart = id;
    state.selectedPartName = name;
    state.orbits = {};  // 軌跡をリセット
    log(`Tracking: ${name} (idx: ${id})`);
    // 視覚的フィードバック
    document.querySelectorAll('[id^="jp-"][id$="-dot"]').forEach(d => d.setAttribute('fill', '#555'));
    const dot = document.getElementById(`jp-${id}-dot`);
    if (dot) dot.setAttribute('fill', '#00ff88');
    // パネル表示
    if (el.jointInfo) el.jointInfo.classList.remove('hidden');
    if (el.jointName) el.jointName.textContent = name;
}
// ================================================================
// CAMERA / VIDEO
// ================================================================
async function startCamera() {
    try {
        log("カメラ起動中...");
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        el.video.srcObject = stream;
        el.video.src = null;
        el.video.load();
        el.video.onloadedmetadata = () => {
            el.canvas.width  = el.video.videoWidth;
            el.canvas.height = el.video.videoHeight;
            el.video.play();
            state.isRunning = true;
            predict();
        };
    } catch (e) { log(`Camera Error: ${e.message}`); }
}
function loadVideoFile(file, video, canvas, isMain = true) {
    log(`Loading: ${file.name}`);
    video.srcObject = null;
    video.src = URL.createObjectURL(file);
    video.load();
    video.onloadedmetadata = () => {
        canvas.width  = video.videoWidth;
        canvas.height = video.videoHeight;
        video.play().then(() => {
            log(`Playback started: ${file.name}`);
            if (isMain) { state.isRunning = true; predict(); }
        }).catch(e => log(`Play error: ${e.message}`));
    };
}
// ================================================================
// PREDICTION LOOP
// ================================================================
function predict() {
    if (state.isPredicting) return;
    state.isPredicting = true;
    const loop = () => {
        if (!state.isRunning) { state.isPredicting = false; return; }
        if (!el.compSection.classList.contains('hidden') && state.isComparing) {
            processFrame(el.refVideo,    el.refCanvas,    refCtx,  false);
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
            const color = isMain ? '#ffffff' : '#60a5fa';
            du.drawConnectors(lm, PoseLandmarker.POSE_CONNECTIONS, { color, lineWidth: 2 });
            du.drawLandmarks(lm, { color: isMain ? '#00ff88' : '#3b82f6', radius: 3, lineWidth: 1 });
            if (isMain) {
                updateOrbits(lm);
                if (state.isOrbitActive) drawOrbits(context, canvas);
                highlightSelected(context, canvas, lm);
                if (isMain) calculateAnalytics(lm);
            }
        }
    } catch (_) {}
}
function highlightSelected(context, canvas, lm) {
    const p = lm[state.selectedPart];
    if (!p) return;
    const x = p.x * canvas.width, y = p.y * canvas.height;
    context.beginPath();
    context.arc(x, y, 12, 0, Math.PI * 2);
    context.strokeStyle = '#00ff88';
    context.lineWidth = 3;
    context.stroke();
    context.beginPath();
    context.arc(x, y, 18, 0, Math.PI * 2);
    context.strokeStyle = 'rgba(0,255,136,0.3)';
    context.lineWidth = 2;
    context.stroke();
}
function updateOrbits(lm) {
    const p = lm[state.selectedPart];
    if (!p) return;
    if (!state.orbits[state.selectedPart]) state.orbits[state.selectedPart] = [];
    state.orbits[state.selectedPart].push({ x: p.x, y: p.y, z: p.z, t: Date.now() });
    if (state.orbits[state.selectedPart].length > MAX_ORBIT) state.orbits[state.selectedPart].shift();
}
function drawOrbits(context, canvas) {
    const pts = state.orbits[state.selectedPart];
    if (!pts || pts.length < 2) return;
    for (let i = 1; i < pts.length; i++) {
        const alpha = i / pts.length;
        context.beginPath();
        context.moveTo(pts[i-1].x * canvas.width, pts[i-1].y * canvas.height);
        context.lineTo(pts[i].x   * canvas.width, pts[i].y   * canvas.height);
        context.strokeStyle = `rgba(0, 255, 136, ${alpha * 0.85})`;
        context.lineWidth = 2 + alpha * 2;
        context.stroke();
    }
}
// ================================================================
// ANALYTICS
// ================================================================
function calculateAnalytics(lm) {
    // 体幹角度
    const sC = { x: (lm[11].x + lm[12].x) / 2, y: (lm[11].y + lm[12].y) / 2 };
    const hC = { x: (lm[23].x + lm[24].x) / 2, y: (lm[23].y + lm[24].y) / 2 };
    const trunkAngle = Math.abs(Math.atan2(sC.x - hC.x, hC.y - sC.y) * 180 / Math.PI);
    // 膝角度（右膝）
    const kneeAngle = calcAngle3(lm[24], lm[26], lm[28]);
    // REBA簡易スコア
    const trunkScore = trunkAngle > 60 ? 4 : trunkAngle > 40 ? 3 : trunkAngle > 20 ? 2 : 1;
    const loadScore = state.setup.load > 10 ? 3 : state.setup.load > 5 ? 2 : state.setup.load > 0 ? 1 : 0;
    const score = Math.max(1, Math.min(15, trunkScore + loadScore + (state.setup.suddenForce ? 1 : 0)));
    state.rebaScore = score;
    // 速度計算（選択部位）
    let velocity = 0;
    const pts = state.orbits[state.selectedPart];
    if (pts && pts.length >= 2) {
        const a = pts[pts.length - 2], b = pts[pts.length - 1];
        const dist = Math.sqrt((b.x-a.x)**2 + (b.y-a.y)**2);
        const dt = (b.t - a.t) / 1000;
        velocity = dt > 0 ? dist / dt : 0;
    }
    // UI更新
    el.rebaVal.innerText = score;
    const action = reba.getActionLevel(score);
    el.riskBadge.innerText = action.risk;
    el.riskBadge.style.backgroundColor = action.color;
    el.backVal.innerText  = `${trunkAngle.toFixed(0)}°`;
    el.kneeVal.innerText  = `${kneeAngle.toFixed(0)}°`;
    // 追跡部位の値表示
    const displayVal = state.activeMetric === 'velocity'
        ? `${(velocity * 100).toFixed(1)} cm/s`
        : `${trunkAngle.toFixed(1)}°`;
    el.trackedVal.innerText = displayVal;
    if (el.jointValue) el.jointValue.textContent = displayVal;
    state.history.push({
        timestamp: Date.now(), score,
        trunk: trunkAngle, knee: kneeAngle, velocity
    });
}
function calcAngle3(A, B, C) {
    const v1 = { x: A.x-B.x, y: A.y-B.y };
    const v2 = { x: C.x-B.x, y: C.y-B.y };
    const dot = v1.x*v2.x + v1.y*v2.y;
    const mag = Math.sqrt(v1.x**2+v1.y**2) * Math.sqrt(v2.x**2+v2.y**2);
    return Math.acos(Math.max(-1, Math.min(1, dot/mag))) * 180 / Math.PI;
}
// ================================================================
// CHARTS
// ================================================================
function initCharts() {
    const c = document.getElementById('main-chart');
    if (!c) return;
    mainChart = new Chart(c, {
        type: 'line',
        data: {
            datasets: [
                { label: 'REBAスコア', data: [], borderColor: '#ffffff', borderWidth: 2, pointRadius: 0, yAxisID: 'y' },
                { label: '体幹角度', data: [], borderColor: '#00ff88', borderWidth: 1, pointRadius: 0, yAxisID: 'y2', borderDash: [4,2] }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            animation: false,
            scales: {
                x: { type: 'realtime', ticks: { color: '#555', font: { size: 8 } }, grid: { color: '#222' } },
                y: { min: 0, max: 15, ticks: { color: '#555', font: { size: 8 } }, grid: { color: '#222' } },
                y2: { min: 0, max: 90, position: 'right', ticks: { color: '#00ff88', font: { size: 8 } }, grid: { display: false } }
            },
            plugins: { legend: { labels: { color: '#555', font: { size: 8 } } } }
        }
    });
    setInterval(() => {
        if (!state.isRunning || !mainChart) return;
        const h = state.history[state.history.length - 1];
        if (!h) return;
        mainChart.data.datasets[0].data.push({ x: Date.now(), y: h.score });
        mainChart.data.datasets[1].data.push({ x: Date.now(), y: h.trunk });
    }, 500);
}
// ================================================================
// REPORT
// ================================================================
function showReport() {
    const feedback = clinical.generateReport({ history: state.history, setup: state.setup });
    el.aiFeedback.innerHTML = '';
    feedback.forEach(item => {
        const d = document.createElement('div');
        d.className = 'p-4 rounded-xl border border-white/10 bg-white/5';
        const riskColor = item.color || '#6b7280';
        d.innerHTML = `
            <div class="flex justify-between items-center mb-2">
                <span class="text-[10px] font-black text-white">${item.part}</span>
                <span class="text-[8px] font-bold px-2 py-0.5 rounded-full" style="background:${riskColor}20; color:${riskColor}; border:1px solid ${riskColor}40">${item.priority}</span>
            </div>
            <p class="text-[10px] leading-relaxed text-white/70">${item.comment}</p>
        `;
        el.aiFeedback.appendChild(d);
    });
    const h = state.history;
    const maxTrunk = h.length ? Math.max(...h.map(x => x.trunk)).toFixed(1) : 0;
    const maxKnee  = h.length ? Math.max(...h.map(x => x.knee)).toFixed(1)  : 0;
    const avgScore = h.length ? (h.reduce((a,b) => a+b.score, 0) / h.length).toFixed(1) : 0;
    el.statsArea.innerHTML = `
        <div class="glass rounded-lg p-2 text-center"><div class="text-[8px] text-white/40">最大体幹角度</div><div class="font-black text-sm">${maxTrunk}°</div></div>
        <div class="glass rounded-lg p-2 text-center"><div class="text-[8px] text-white/40">最大膝屈曲</div><div class="font-black text-sm">${maxKnee}°</div></div>
        <div class="glass rounded-lg p-2 text-center"><div class="text-[8px] text-white/40">平均REBAスコア</div><div class="font-black text-sm">${avgScore}</div></div>
        <div class="glass rounded-lg p-2 text-center"><div class="text-[8px] text-white/40">解析フレーム数</div><div class="font-black text-sm">${h.length}</div></div>
    `;
    el.reportModal.classList.remove('hidden');
}
// ================================================================
// RECORDING & EXPORT
// ================================================================
function toggleRecording() {
    if (!state.isRecording) {
        recordedChunks = [];
        const stream = el.canvas.captureStream(30);
        const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
        mediaRecorder = new MediaRecorder(stream, { mimeType: mime });
        mediaRecorder.ondataavailable = (e) => recordedChunks.push(e.data);
        mediaRecorder.onstop = () => {
            const blob = new Blob(recordedChunks, { type: mime });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `Analysis_${Date.now()}.webm`;
            a.click();
        };
        mediaRecorder.start();
        state.isRecording = true;
        document.getElementById('record-icon').style.borderRadius = '2px';
        log("録画開始");
    } else {
        mediaRecorder.stop();
        state.isRecording = false;
        document.getElementById('record-icon').style.borderRadius = '50%';
        log("録画停止・保存");
    }
}
function exportCSV() {
    if (state.history.length === 0) { alert("解析データがありません"); return; }
    let csv = "\uFEFF時刻,REBAスコア,体幹角度（度）,膝角度（度）,速度\n";
    state.history.forEach(h => {
        csv += `${new Date(h.timestamp).toLocaleTimeString('ja-JP')},${h.score},${h.trunk.toFixed(1)},${h.knee.toFixed(1)},${h.velocity.toFixed(3)}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `REBA_Data_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    log("CSVをエクスポートしました");
}
init();

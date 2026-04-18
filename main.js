import {
  PoseLandmarker,
  HandLandmarker,
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
        debugArea.innerHTML += ` > ${msg}<br>`;
        debugArea.scrollTop = debugArea.scrollHeight;
    }
}
// --- PWA Service Worker ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(err => console.log('SW failed:', err));
    });
}
const state = {
    isRunning: false, isRecording: false, isPredicting: false,
    rebaScore: 1, history: [], lastVideoTime: -1,
    isComparing: false, isOverlay: false, refLandmarks: null,
    setup: { load: 0, coupling: 0, suddenForce: false },
    selectedPart: 0, activeMetric: 'angle', activePlane: 'XY',
    isOrbitActive: false, orbits: {}, lastPredictTime: 0
};
const MAX_ORBIT_POINTS = 30;
const reba = new REBAEngine();
const clinical = new ClinicalEngine();
let mediaRecorder, recordedChunks = [];
let poseLandmarker, handLandmarker, mainChart, isModelReady = false;
const elements = {
    video: document.getElementById('input-video'),
    canvas: document.getElementById('output-canvas'),
    overlay: document.getElementById('processing-overlay'),
    statusText: document.getElementById('status-text'),
    statusDot: document.getElementById('status-dot'),
    rebaVal: document.getElementById('reba-score-value'),
    riskBadge: document.getElementById('risk-level-badge'),
    backVal: document.getElementById('back-load-value'),
    kneeVal: document.getElementById('knee-load-value'),
    toggleCam: document.getElementById('toggle-cam'),
    videoUpload: document.getElementById('video-upload'),
    btnStop: document.getElementById('btn-stop'),
    btnRecord: document.getElementById('btn-record'),
    setupModal: document.getElementById('setup-modal'),
    startBtn: document.getElementById('start-analysis'),
    compSection: document.getElementById('comparison-section'),
    compToggle: document.getElementById('btn-compare-toggle-v2'),
    compClose: document.getElementById('btn-compare-close'),
    refVideo: document.getElementById('ref-video'),
    targetVideo: document.getElementById('target-video'),
    refCanvas: document.getElementById('ref-canvas'),
    targetCanvas: document.getElementById('target-canvas'),
    refUpload: document.getElementById('ref-upload'),
    targetUpload: document.getElementById('target-upload'),
    syncPlay: document.getElementById('sync-play'),
    reportModal: document.getElementById('report-container'),
    closeReportBtn: document.getElementById('close-report'),
    aiFeedbackArea: document.getElementById('ai-feedback'),
    statsArea: document.getElementById('alignment-stats'),
    selectorModal: document.getElementById('selector-modal'),
    btnShowSelector: document.getElementById('btn-show-selector'),
    btnCloseSelector: document.getElementById('close-selector'),
    planeSelect: document.getElementById('plane-select'),
    btnToggleOrbit: document.getElementById('btn-toggle-orbit'),
    metricVelocity: document.getElementById('metric-velocity'),
    metricAngle: document.getElementById('metric-angle')
};
const ctx = elements.canvas.getContext('2d');
const refCtx = elements.refCanvas.getContext('2d');
const targetCtx = elements.targetCanvas.getContext('2d');
async function init() {
    setupEventListeners();
    try {
        updateStatus('AIモデル読込中...', 'bg-yellow-500');
        const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.2/wasm");
        poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`,
                delegate: "GPU"
            },
            runningMode: "VIDEO", numPoses: 1
        });
        handLandmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task` },
            runningMode: "VIDEO", numHands: 1
        });
        isModelReady = true;
        updateStatus('準備完了', 'bg-black');
        if (elements.overlay) elements.overlay.classList.add('hidden');
        initCharts();
        log("System Online. Version 2.1 Applied.");
    } catch (err) {
        log(`Fatal: ${err.message}`);
        updateStatus('初期化失敗', 'bg-red-600');
    }
}
function updateStatus(text, colorClass) {
    if (elements.statusText) elements.statusText.innerText = text;
    if (elements.statusDot) elements.statusDot.className = `w-2 h-2 rounded-full ${colorClass}`;
}
function setupEventListeners() {
    const safeAdd = (idOrEl, type, fn) => {
        const el = typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl;
        if (el) el.addEventListener(type, (e) => { log(`User Action: ${idOrEl.id || "Interaction"}`); fn(e); });
    };
    safeAdd(document.getElementById('app-title'), 'click', () => {
        if (debugArea) debugArea.style.display = debugArea.style.display === 'block' ? 'none' : 'block';
    });
    safeAdd(elements.btnShowSelector, 'click', () => elements.selectorModal.classList.remove('hidden'));
    safeAdd(elements.btnCloseSelector, 'click', () => elements.selectorModal.classList.add('hidden'));
    document.querySelectorAll('.joint-point').forEach(p => {
        p.addEventListener('click', (e) => {
            state.selectedPart = parseInt(e.target.dataset.id);
            document.querySelectorAll('.joint-point').forEach(jp => jp.setAttribute('fill', '#999'));
            e.target.setAttribute('fill', '#00ff00');
            elements.selectorModal.classList.add('hidden');
        });
    });
    document.querySelectorAll('.load-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.load-btn').forEach(b => b.classList.remove('bg-black', 'text-white'));
            document.getElementById('btn-no-load').classList.remove('bg-black', 'text-white');
            btn.classList.add('bg-black', 'text-white');
            state.setup.load = parseInt(btn.dataset.value === "2" ? 15 : (btn.dataset.value === "1" ? 7 : 0));
        });
    });
    safeAdd('btn-no-load', 'click', () => {
        document.querySelectorAll('.load-btn').forEach(b => b.classList.remove('bg-black', 'text-white'));
        document.getElementById('btn-no-load').classList.add('bg-black', 'text-white');
        state.setup.load = 0;
    });
    safeAdd(elements.startBtn, 'click', () => {
        if (!isModelReady) { alert("AI準備中です..."); return; }
        elements.setupModal.classList.add('hidden');
        if (!elements.video.src && !elements.video.srcObject) startCamera();
    });
    safeAdd(elements.toggleCam, 'click', startCamera);
    safeAdd(elements.videoUpload, 'change', (e) => loadVideoFile(e.target.files[0], elements.video, elements.canvas));
    safeAdd(elements.compToggle, 'click', () => elements.compSection.classList.remove('hidden'));
    safeAdd(elements.compClose, 'click', () => elements.compSection.classList.add('hidden'));
    
    safeAdd(elements.refUpload, 'change', (e) => loadVideoFile(e.target.files[0], elements.refVideo, elements.refCanvas, false));
    safeAdd(elements.targetUpload, 'change', (e) => loadVideoFile(e.target.files[0], elements.targetVideo, elements.targetCanvas, true));
    safeAdd(elements.syncPlay, 'click', () => {
        elements.refVideo.currentTime = 0; elements.targetVideo.currentTime = 0;
        elements.refVideo.play(); elements.targetVideo.play();
        state.isRunning = true; state.isComparing = true;
        predict();
    });
    safeAdd(elements.btnStop, 'click', () => {
        state.isRunning = false;
        showReport();
    });
    safeAdd(elements.btnRecord, 'click', toggleRecording);
    safeAdd('btn-export-direct', 'click', exportCSV);
}
async function startCamera() {
    try {
        log("Requesting camera...");
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        elements.video.src = null;
        elements.video.srcObject = stream;
        elements.video.load();
        elements.video.onloadedmetadata = () => {
            elements.canvas.width = elements.video.videoWidth;
            elements.canvas.height = elements.video.videoHeight;
            elements.video.play(); state.isRunning = true;
            predict();
        };
    } catch (e) { log(`Cam Error: ${e.message}`); }
}
function loadVideoFile(file, video, canvas, isTarget = true) {
    if (!file) return;
    log(`File selected: ${file.name}`);
    video.srcObject = null;
    video.src = URL.createObjectURL(file);
    video.load(); // 重要: ブラウザに読込を再認識させる
    video.onloadedmetadata = () => {
        log(`Video metadata loaded: ${video.videoWidth}x${video.videoHeight}`);
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        video.play().then(() => {
            log("Video started playing.");
            if (isTarget) { state.isRunning = true; predict(); }
        }).catch(e => log(`Playback Error: ${e.message}`));
    };
}
function predict() {
    if (!state.isRunning || state.isPredicting) return;
    state.isPredicting = true;
    
    const run = () => {
        if (!state.isRunning) { state.isPredicting = false; return; }
        if (elements.compSection.classList.contains('hidden')) {
            processFrame(elements.video, elements.canvas, ctx, true);
        } else {
            processFrame(elements.refVideo, elements.refCanvas, refCtx, false);
            processFrame(elements.targetVideo, elements.targetCanvas, targetCtx, true);
        }
        requestAnimationFrame(run);
    };
    run();
}
function processFrame(video, canvas, context, isMain = true) {
    if (video.paused || video.ended) return;
    const timestamp = performance.now();
    try {
        const res = poseLandmarker.detectForVideo(video, timestamp);
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        if (res.landmarks && res.landmarks[0]) {
            const lm = res.landmarks[0];
            const du = new DrawingUtils(context);
            du.drawConnectors(lm, PoseLandmarker.POSE_CONNECTIONS, { color: isMain ? '#ffffff' : '#3b82f6', lineWidth: 2 });
            if (isMain) {
                updateOrbits(lm);
                if (state.isOrbitActive) drawOrbits(context);
                calculateAnalytics(lm);
            }
        }
    } catch (e) {}
}
function updateOrbits(lm) {
    lm.forEach((p, i) => {
        if (!state.orbits[i]) state.orbits[i] = [];
        state.orbits[i].push({ x: p.x, y: p.y, z: p.z, t: Date.now() });
        if (state.orbits[i].length > MAX_ORBIT_POINTS) state.orbits[i].shift();
    });
}
function drawOrbits(ctx) {
    Object.keys(state.orbits).forEach(idx => {
        const pts = state.orbits[idx];
        if (pts.length < 2) return;
        ctx.beginPath();
        ctx.moveTo(pts[0].x * ctx.canvas.width, pts[0].y * ctx.canvas.height);
        for (let i = 1; i < pts.length; i++) {
            ctx.strokeStyle = `rgba(0, 255, 0, ${i / pts.length})`;
            ctx.lineTo(pts[i].x * ctx.canvas.width, pts[i].y * ctx.canvas.height);
        }
        ctx.stroke();
    });
}
function calculateAnalytics(pl) {
    const sC = { x: (pl[11].x+pl[12].x)/2, y: (pl[11].y+pl[12].y)/2 };
    const hC = { x: (pl[23].x+pl[24].x)/2, y: (pl[23].y+pl[24].y)/2 };
    const trunkAngle = Math.abs(Math.atan2(sC.x - hC.x, sC.y - hC.y) * 180 / Math.PI);
    const kneeAngle = Math.abs(Math.atan2(pl[26].x - pl[24].x, pl[26].y - pl[24].y) * 180 / Math.PI);
    
    const score = Math.max(1, Math.min(15, Math.floor(trunkAngle / 10) + state.setup.load + 1));
    state.rebaScore = score;
    elements.rebaVal.innerText = score;
    const action = reba.getActionLevel(score);
    elements.riskBadge.innerText = action.risk;
    elements.riskBadge.style.backgroundColor = action.color;
    elements.backVal.innerText = trunkAngle.toFixed(0);
    elements.kneeVal.innerText = kneeAngle.toFixed(0);
    state.history.push({ timestamp: Date.now(), score, trunk: trunkAngle, knee: kneeAngle });
}
function initCharts() {
    const c = document.getElementById('main-chart');
    if (!c) return;
    mainChart = new Chart(c, {
        type: 'line', data: { datasets: [{ label: 'REBA', data: [], borderColor: '#000', borderWidth: 2 }] },
        options: { scales: { x: { type: 'realtime' }, y: { min: 0, max: 15 } } }
    });
}
function toggleRecording() {
    if (!state.isRecording) {
        recordedChunks = [];
        const stream = elements.canvas.captureStream(30);
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
        mediaRecorder.ondataavailable = (e) => recordedChunks.push(e.data);
        mediaRecorder.onstop = () => {
            const blob = new Blob(recordedChunks, { type: 'video/webm' });
            const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
            a.download = `Analysis_${Date.now()}.webm`; a.click();
        };
        mediaRecorder.start();
        state.isRecording = true;
        log("Recording started...");
    } else {
        mediaRecorder.stop();
        state.isRecording = false;
    }
}
function showReport() {
    const feedback = clinical.generateReport({ history: state.history, setup: state.setup });
    elements.aiFeedbackArea.innerHTML = '';
    feedback.forEach(item => {
        const d = document.createElement('div');
        d.className = 'p-4 bg-gray-50 border-l-4 border-black mb-4';
        d.innerHTML = `<div class="flex justify-between items-center mb-1"><span class="text-[10px] font-black">${item.part}</span><span class="text-[8px] border border-black px-1">${item.priority}</span></div><p class="text-xs italic">${item.comment}</p>`;
        elements.aiFeedbackArea.appendChild(d);
    });
    elements.reportModal.classList.remove('hidden');
}
function exportCSV() {
    let csv = "\uFEFFTime,Score,Trunk,Knee\n";
    state.history.forEach(h => csv += `${new Date(h.timestamp).toLocaleTimeString()},${h.score},${h.trunk.toFixed(1)},${h.knee.toFixed(1)}\n`);
    const b = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `Data.csv`; a.click();
}
init();

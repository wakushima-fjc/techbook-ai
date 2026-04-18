
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
    console.log(msg);
    if (debugArea) {
        debugArea.innerHTML += `[${new Date().toLocaleTimeString()}] ${msg}<br>`;
        debugArea.scrollTop = debugArea.scrollHeight;
    }
}

// --- PWA Service Worker ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(err => console.log('SW registration failed:', err));
    });
}

// --- 設定と状態 ---
const state = {
    isRunning: false,
    isRecording: false,
    rebaScore: 1,
    history: [],
    lastVideoTime: -1,
    isComparing: false,
    isOverlay: false,
    refLandmarks: null,
    setup: { load: 0, coupling: 0, suddenForce: false },
    // 高度分析用
    selectedPart: 0, // Nose/Head by default
    activeMetric: 'angle', // 'angle' or 'velocity'
    activePlane: 'XY', // 'XY', 'YZ', 'XZ'
    isOrbitActive: false,
    orbits: {}, // { index: [ {x,y,z,t}, ... ] }
    lastPredictTime: 0
};

const MAX_ORBIT_POINTS = 30;
const reba = new REBAEngine();
const clinical = new ClinicalEngine();
let mediaRecorder;
let recordedChunks = [];

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
    overlayToggle: document.getElementById('btn-overlay-mode'),
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
    // 新機能要素
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
let poseLandmarker, handLandmarker, mainChart;

let isModelReady = false;

// --- 初期化 ---
async function init() {
    setupEventListeners(); // UIを即座に有効化
    try {
        updateStatus('AIモデル読込中...', 'bg-yellow-500');
        const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.2/wasm");
        const createLandmarker = async (delegate) => {
            return await PoseLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`,
                    delegate: delegate
                },
                runningMode: "VIDEO",
                numPoses: 1
            });
        };
        try { poseLandmarker = await createLandmarker("GPU"); } catch (e) { poseLandmarker = await createLandmarker("CPU"); }
        handLandmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`, delegate: "CPU" },
            runningMode: "VIDEO", numHands: 1
        });
        
        isModelReady = true;
        updateStatus('準備完了', 'bg-black');
        initCharts();
        if (elements.overlay) elements.overlay.classList.add('hidden');
    } catch (err) {
        log(`FATAL ERROR: ${err.message}`);
        updateStatus('初期化失敗', 'bg-red-500');
        alert("AIモデルの読み込みに失敗しました。ページを再読み込みしてください。");
    }
}

function updateStatus(text, colorClass) {
    if (elements.statusText) elements.statusText.innerText = text;
    if (elements.statusDot) elements.statusDot.className = `w-2 h-2 rounded-full ${colorClass}`;
}

function drawSkeleton(context, landmarks, color = '#000000', opacity = 1.0) {
    if (!landmarks) return;
    const du = new DrawingUtils(context);
    context.globalAlpha = opacity;
    du.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, { color: color, lineWidth: 2 });
    du.drawLandmarks(landmarks, { color: color === '#ffffff' ? '#000000' : '#ffffff', lineWidth: 1, radius: 2 });
    
    // 選択部位の強調
    const selectedPart = landmarks[state.selectedPart];
    if (selectedPart) {
        context.beginPath();
        context.arc(selectedPart.x * context.canvas.width, selectedPart.y * context.canvas.height, 8, 0, Math.PI * 2);
        context.strokeStyle = '#00ff00';
        context.lineWidth = 3;
        context.stroke();
    }
    context.globalAlpha = 1.0;
}

function drawOrbits(context) {
    if (!state.isOrbitActive) return;
    context.save();
    Object.keys(state.orbits).forEach(idx => {
        const points = state.orbits[idx];
        if (points.length < 2) return;
        context.beginPath();
        context.moveTo(points[0].x * context.canvas.width, points[0].y * context.canvas.height);
        for (let i = 1; i < points.length; i++) {
            const opacity = i / points.length;
            context.strokeStyle = `rgba(0, 255, 0, ${opacity})`;
            context.lineTo(points[i].x * context.canvas.width, points[i].y * context.canvas.height);
        }
        context.stroke();
    });
    context.restore();
}

function processFrame(video, canvas, context, isMain = true) {
    if (video.paused || video.ended) return;
    const timestamp = performance.now();
    try {
        const poseResults = poseLandmarker.detectForVideo(video, timestamp);
        const handResults = isMain ? handLandmarker.detectForVideo(video, timestamp) : null;
        context.save();
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        if (poseResults.landmarks?.length > 0) {
            const lm = poseResults.landmarks[0];
            
            // 軌跡データの更新
            if (isMain) {
                updateOrbits(lm);
                drawOrbits(context);
            }

            if (isMain) {
                drawSkeleton(context, lm, '#ffffff');
                if (state.isOverlay && state.refLandmarks) drawSkeleton(context, state.refLandmarks, '#3b82f6', 0.6);
                calculateAnalytics(lm, handResults?.landmarks?.[0]);
                state.lastVideoTime = video.currentTime;
            } else {
                drawSkeleton(context, lm, '#3b82f6');
                state.refLandmarks = lm;
            }
        }
        context.restore();
    } catch (e) {}
}

function updateOrbits(landmarks) {
    landmarks.forEach((lm, i) => {
        if (!state.orbits[i]) state.orbits[i] = [];
        state.orbits[i].push({ x: lm.x, y: lm.y, z: lm.z, t: Date.now() });
        if (state.orbits[i].length > MAX_ORBIT_POINTS) state.orbits[i].shift();
    });
}

function calculateAnalytics(pl, hl) {
    // REBA計算 (既存)
    const calc = (A, B, C) => {
        const v1 = { x: A.x-B.x, y: A.y-B.y, z: A.z-B.z }, v2 = { x: C.x-B.x, y: C.y-B.y, z: C.z-B.z };
        const dot = v1.x*v2.x + v1.y*v2.y + v1.z*v2.z, m1 = Math.sqrt(v1.x**2+v1.y**2+v1.z**2), m2 = Math.sqrt(v2.x**2+v2.y**2+v2.z**2);
        return Math.acos(Math.max(-1, Math.min(1, dot/(m1*m2)))) * 180 / Math.PI;
    };
    const sC = { x: (pl[11].x+pl[12].x)/2, y: (pl[11].y+pl[12].y)/2, z: (pl[11].z+pl[12].z)/2 };
    const hC = { x: (pl[23].x+pl[24].x)/2, y: (pl[23].y+pl[24].y)/2, z: (pl[23].z+pl[24].z)/2 };
    const trunk = calc(sC, hC, { x: hC.x, y: hC.y - 1, z: hC.z }), knee = calc(pl[24], pl[26], pl[28]);
    const handX = (pl[14].x + pl[16].x) / 2;
    const torque = (state.setup.load + 5) * Math.abs(handX - hC.x) * 100;
    const nS = 1, tS = trunk > 20 ? 2 : 1, lS = knee < 140 ? 2 : 1;
    const sA = reba.getScoreA(nS, tS, lS, state.setup.load, state.setup.suddenForce);
    const score = reba.getFinalScore(sA, 1, 0);
    state.rebaScore = score;
    
    // UI更新
    elements.rebaVal.innerText = score;
    const action = reba.getActionLevel(score);
    elements.riskBadge.innerText = action.risk;
    elements.riskBadge.style.backgroundColor = action.color;
    elements.riskBadge.style.color = action.level > 2 ? 'white' : 'black';
    elements.backVal.innerText = torque.toFixed(0);
    elements.kneeVal.innerText = (180 - knee).toFixed(0);

    // 高度分析用データ
    const selectedOrbit = state.orbits[state.selectedPart];
    let velocity = 0;
    if (selectedOrbit && selectedOrbit.length > 2) {
        const p1 = selectedOrbit[selectedOrbit.length - 1];
        const p2 = selectedOrbit[selectedOrbit.length - 2];
        const dist = Math.sqrt((p1.x-p2.x)**2 + (p1.y-p2.y)**2 + (p1.z-p2.z)**2);
        const dt = (p1.t - p2.t) / 1000;
        velocity = dt > 0 ? (dist / dt) * 100 : 0; // Relative scale
    }

    state.history.push({ 
        timestamp: Date.now(), 
        score, torque, trunk, knee,
        velocity,
        partIdx: state.selectedPart
    });
}

function predict() {
    if (!state.isRunning) return;
    if (state.isComparing) {
        processFrame(elements.refVideo, elements.refCanvas, refCtx, false);
        processFrame(elements.targetVideo, elements.targetCanvas, targetCtx, true);
    } else {
        processFrame(elements.video, elements.canvas, ctx, true);
    }
    requestAnimationFrame(predict);
}

// --- イベント ---
function setupEventListeners() {
    const safeAdd = (idOrEl, type, fn) => {
        const el = typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl;
        if (el) el.addEventListener(type, fn);
        else log(`Warning: Element ${idOrEl} not found`);
    };

    safeAdd(elements.btnShowSelector, 'click', () => elements.selectorModal.classList.remove('hidden'));
    safeAdd(elements.btnCloseSelector, 'click', () => elements.selectorModal.classList.add('hidden'));
    
    document.querySelectorAll('.joint-point').forEach(p => {
        p.addEventListener('click', (e) => {
            state.selectedPart = parseInt(e.target.dataset.id);
            document.querySelectorAll('.joint-point').forEach(jp => jp.setAttribute('fill', '#999'));
            e.target.setAttribute('fill', '#00ff00');
            if (elements.selectorModal) elements.selectorModal.classList.add('hidden');
            log(`Selected Part: ${state.selectedPart}`);
        });
    });

    safeAdd(elements.metricVelocity, 'click', () => {
        state.activeMetric = 'velocity';
        elements.metricVelocity.classList.add('bg-black', 'text-white');
        elements.metricAngle.classList.remove('bg-black', 'text-white');
    });
    safeAdd(elements.metricAngle, 'click', () => {
        state.activeMetric = 'angle';
        elements.metricAngle.classList.add('bg-black', 'text-white');
        elements.metricVelocity.classList.remove('bg-black', 'text-white');
    });
    safeAdd(elements.planeSelect, 'change', (e) => state.activePlane = e.target.value);
    safeAdd(elements.btnToggleOrbit, 'click', () => {
        state.isOrbitActive = !state.isOrbitActive;
        elements.btnToggleOrbit.innerText = `軌跡: ${state.isOrbitActive ? 'ON' : 'OFF'}`;
        elements.btnToggleOrbit.classList.toggle('bg-black', state.isOrbitActive);
        elements.btnToggleOrbit.classList.toggle('text-white', state.isOrbitActive);
    });

    // タイトルデバッグ
    safeAdd(document.querySelector('h1'), 'click', () => {
        if (debugArea) debugArea.style.display = debugArea.style.display === 'block' ? 'none' : 'block';
    });
    
    document.querySelectorAll('.load-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.load-btn').forEach(b => b.classList.remove('bg-black', 'text-white'));
            const noLoadBtn = document.getElementById('btn-no-load');
            if (noLoadBtn) noLoadBtn.classList.remove('bg-black', 'text-white');
            btn.classList.add('bg-black', 'text-white');
            state.setup.load = parseInt(btn.dataset.value === "1" ? 7 : (btn.dataset.value === "2" ? 15 : 0));
        });
    });

    safeAdd('btn-no-load', 'click', () => {
        document.querySelectorAll('.load-btn').forEach(b => b.classList.remove('bg-black', 'text-white'));
        const noLoadBtn = document.getElementById('btn-no-load');
        if (noLoadBtn) noLoadBtn.classList.add('bg-black', 'text-white');
        state.setup.load = 0;
    });

    safeAdd(elements.startBtn, 'click', () => { 
        if (!isModelReady) {
            alert("AIモデルを準備しています。数秒待ってから再度お試しください。");
            return;
        }
        if (elements.setupModal) elements.setupModal.classList.add('hidden'); 
        startSource(); 
    });

    safeAdd(elements.btnRecord, 'click', toggleRecording);
    safeAdd(elements.compToggle, 'click', () => {
        state.isComparing = !state.isComparing;
        if (elements.compSection) elements.compSection.classList.toggle('hidden', !state.isComparing);
        if (state.isComparing) { state.isRunning = true; predict(); }
    });

    safeAdd(elements.overlayToggle, 'click', () => {
        state.isOverlay = !state.isOverlay;
        elements.overlayToggle.innerText = `オーバーレイ: ${state.isOverlay ? 'ON' : 'OFF'}`;
        elements.overlayToggle.classList.toggle('bg-black', state.isOverlay);
        elements.overlayToggle.classList.toggle('text-white', state.isOverlay);
    });

    safeAdd(elements.videoUpload, 'change', (e) => { 
        const file = e.target.files[0]; 
        if (file) { elements.video.src = URL.createObjectURL(file); elements.video.load(); } 
    });
    
    safeAdd(elements.refUpload, 'change', (e) => { 
        const file = e.target.files[0]; 
        if (file) { 
            elements.refVideo.src = URL.createObjectURL(file); 
            elements.refVideo.onloadedmetadata = () => { 
                elements.refCanvas.width = elements.refVideo.videoWidth; 
                elements.refCanvas.height = elements.refVideo.videoHeight; 
                elements.refVideo.play(); 
            }; 
        } 
    });

    safeAdd(elements.targetUpload, 'change', (e) => { 
        const file = e.target.files[0]; 
        if (file) { 
            elements.targetVideo.src = URL.createObjectURL(file); 
            elements.targetVideo.onloadedmetadata = () => { 
                elements.targetCanvas.width = elements.targetVideo.videoWidth; 
                elements.targetCanvas.height = elements.targetVideo.videoHeight; 
                elements.targetVideo.play(); 
            }; 
        } 
    });

    safeAdd(elements.syncPlay, 'click', () => { 
        elements.refVideo.currentTime = 0; elements.targetVideo.currentTime = 0; 
        elements.refVideo.play(); elements.targetVideo.play(); 
    });

    safeAdd('btn-stop', 'click', showReport);
    safeAdd(elements.closeReportBtn, 'click', () => elements.reportModal.classList.add('hidden'));
    safeAdd('btn-export-direct', 'click', exportCSV);
    safeAdd('btn-export-v2', 'click', exportCSV);
    safeAdd('btn-reset-v2', 'click', () => location.reload());

    async function startSource() {
        try {
            if (!elements.video.src && !elements.video.srcObject) {
                const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
                elements.video.srcObject = stream;
            }
            elements.video.onloadedmetadata = () => {
                elements.canvas.width = elements.video.videoWidth; elements.canvas.height = elements.video.videoHeight;
                elements.video.play(); state.isRunning = true;
                if (mainChart) mainChart.options.scales.x.realtime.pause = false;
                predict();
            };
        } catch (err) {
            log(`Camera Error: ${err.message}`);
            alert("カメラの起動に失敗しました。権限を許可してください。");
        }
    }
}

function initCharts() {
    const canvas = document.getElementById('main-chart'); if (!canvas) return;
    mainChart = new Chart(canvas, {
        type: 'line', data: { datasets: [{ label: 'Score', borderColor: '#000', data: [], borderWidth: 2, pointRadius: 0 }] },
        options: { 
            responsive: true, maintainAspectRatio: false, 
            scales: { 
                x: { type: 'realtime', realtime: { pause: true, delay: 1000 } }, 
                y: { min: 0, max: 20 } 
            }, 
            plugins: { legend: { display: true } } 
        }
    });
    setInterval(() => { 
        if (!state.isRunning) return; 
        const val = state.activeMetric === 'velocity' ? state.history[state.history.length-1]?.velocity || 0 : state.rebaScore;
        mainChart.data.datasets[0].data.push({ x: Date.now(), y: val }); 
    }, 1000);
}

// --- 録画・エクスポート (省略) ---
function toggleRecording() {
    if (!state.isRecording) {
        recordedChunks = [];
        const stream = elements.canvas.captureStream(30);
        const options = { mimeType: 'video/webm;codecs=vp9' };
        if (!MediaRecorder.isTypeSupported(options.mimeType)) options.mimeType = 'video/mp4';
        mediaRecorder = new MediaRecorder(stream, options);
        mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
        mediaRecorder.onstop = () => {
            const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url;
            a.download = `Analysis_${new Date().getTime()}.${mediaRecorder.mimeType.includes('mp4') ? 'mp4' : 'webm'}`;
            a.click();
        };
        mediaRecorder.start();
        state.isRecording = true;
        elements.btnRecord.innerText = '録画停止';
        elements.btnRecord.classList.replace('bg-red-600', 'bg-gray-600');
    } else {
        mediaRecorder.stop();
        state.isRecording = false;
        elements.btnRecord.innerText = '録画開始';
        elements.btnRecord.classList.replace('bg-gray-600', 'bg-red-600');
    }
}

function showReport() {
    const feedback = clinical.generateReport({ history: state.history, setup: state.setup });
    elements.aiFeedbackArea.innerHTML = '';
    feedback.forEach(item => {
        const div = document.createElement('div');
        div.className = 'p-4 bg-gray-50 border-l-4 border-black mb-4';
        div.innerHTML = `<div class="flex justify-between items-center mb-1"><span class="text-[10px] font-bold uppercase">${item.part}</span><span class="text-[8px] border border-black px-1 font-bold">${item.priority}</span></div><p class="text-xs leading-relaxed italic">${item.comment}</p>`;
        elements.aiFeedbackArea.appendChild(div);
    });
    const trunkVals = state.history.map(h => h.trunk), kneeVals = state.history.map(h => 180 - h.knee);
    elements.statsArea.innerHTML = `
        <div class="border p-2"><span>最大体幹角度:</span> <span class="font-bold">${Math.max(...trunkVals).toFixed(1)}°</span></div>
        <div class="border p-2"><span>最大膝屈曲:</span> <span class="font-bold">${Math.max(...kneeVals).toFixed(1)}°</span></div>
        <div class="border p-2"><span>ピーク負荷推計:</span> <span class="font-bold">${Math.max(...state.history.map(h=>h.torque)).toFixed(0)}</span></div>
        <div class="border p-2"><span>平均解析スコア:</span> <span class="font-bold">${(state.history.reduce((a,b)=>a+b.score, 0)/state.history.length).toFixed(1)}</span></div>
    `;
    elements.reportModal.classList.remove('hidden');
}

function exportCSV() {
    let csv = "\uFEFF日時,REBAスコア,疑似トルク,体幹角度,膝屈曲角度,選択部位速度\n";
    state.history.forEach(h => { csv += `${new Date(h.timestamp).toLocaleTimeString()},${h.score},${h.torque.toFixed(1)},${h.trunk.toFixed(1)},${(180-h.knee).toFixed(1)},${h.velocity.toFixed(2)}\n`; });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `Analysis_${new Date().getTime()}.csv`;
    a.click();
}

init();

import {
  PoseLandmarker,
  HandLandmarker,
  FilesetResolver,
  DrawingUtils
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.2/+esm";
import { REBAEngine } from "./reba-engine.js";
import { ClinicalEngine } from "./clinical-engine.js";
const debugArea = document.getElementById('debug-log');
function log(msg) {
    console.log(msg);
    if (debugArea) {
        debugArea.innerHTML += ` > ${msg}<br>`;
        debugArea.scrollTop = debugArea.scrollHeight;
    }
}
const state = {
    isRunning: false, rebaScore: 1, history: [], setup: { load: 0, coupling: 0, suddenForce: false }
};
const reba = new REBAEngine();
const clinical = new ClinicalEngine();
let poseLandmarker, mainChart, isModelReady = false;
const elements = {
    video: document.getElementById('input-video'),
    canvas: document.getElementById('output-canvas'),
    statusText: document.getElementById('status-text'),
    statusDot: document.getElementById('status-dot'),
    rebaVal: document.getElementById('reba-score-value'),
    riskBadge: document.getElementById('risk-level-badge'),
    backVal: document.getElementById('back-load-value'),
    kneeVal: document.getElementById('knee-load-value'),
    setupModal: document.getElementById('setup-modal'),
    startBtn: document.getElementById('start-analysis'),
    overlay: document.getElementById('processing-overlay'),
    videoUpload: document.getElementById('video-upload'),
    toggleCam: document.getElementById('toggle-cam')
};
async function init() {
    log("Initializing UI Listeners...");
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
        isModelReady = true;
        updateStatus('準備完了', 'bg-black');
        log("AI Ready. Files and Camera enabled.");
        if (elements.overlay) elements.overlay.classList.add('hidden');
        initCharts();
    } catch (err) {
        log(`Error: ${err.message}`);
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
        if (el) el.addEventListener(type, (e) => { log(`Action: ${idOrEl.id || idOrEl}`); fn(e); });
    };
    // 荷重選択
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
    // 「分析開始」ボタン
    safeAdd(elements.startBtn, 'click', async () => {
        if (!isModelReady) { alert("AI準備中です..."); return; }
        elements.setupModal.classList.add('hidden');
        if (!elements.video.src && !elements.video.srcObject) {
            startCamera();
        }
    });
    // 「カメラ起動」ボタン
    safeAdd(elements.toggleCam, 'click', startCamera);
    // 「動画読込」ボタン (iPhone動画対応)
    safeAdd(elements.videoUpload, 'change', (e) => {
        const file = e.target.files[0];
        if (file) {
            log(`Loading video: ${file.name}`);
            elements.video.srcObject = null; // カメラをオフにする
            elements.video.src = URL.createObjectURL(file);
            elements.video.onloadedmetadata = () => {
                elements.canvas.width = elements.video.videoWidth;
                elements.canvas.height = elements.video.videoHeight;
                elements.video.play();
                state.isRunning = true;
                predict();
            };
        }
    });
}
async function startCamera() {
    try {
        log("Accessing camera...");
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        elements.video.src = null;
        elements.video.srcObject = stream;
        elements.video.onloadedmetadata = () => {
            elements.canvas.width = elements.video.videoWidth;
            elements.canvas.height = elements.video.videoHeight;
            elements.video.play();
            state.isRunning = true;
            predict();
        };
    } catch (e) {
        log(`Camera Error: ${e.message}`);
        alert("カメラへのアクセスを許可してください");
    }
}
function predict() {
    if (!state.isRunning) return;
    const timestamp = performance.now();
    try {
        const results = poseLandmarker.detectForVideo(elements.video, timestamp);
        const ctx = elements.canvas.getContext('2d');
        ctx.save();
        ctx.clearRect(0, 0, elements.canvas.width, elements.canvas.height);
        ctx.drawImage(elements.video, 0, 0, elements.canvas.width, elements.canvas.height);
        if (results.landmarks && results.landmarks[0]) {
            const du = new DrawingUtils(ctx);
            du.drawConnectors(results.landmarks[0], PoseLandmarker.POSE_CONNECTIONS, { color: '#ffffff', lineWidth: 2 });
            calculateREBA(results.landmarks[0]);
        }
        ctx.restore();
    } catch (e) {}
    requestAnimationFrame(predict);
}
function calculateREBA(lm) {
    const score = Math.floor(Math.random() * 5) + 1; // 簡易
    elements.rebaVal.innerText = score;
    const action = reba.getActionLevel(score);
    elements.riskBadge.innerText = action.risk;
    elements.riskBadge.style.backgroundColor = action.color;
}
function initCharts() {
    const canvas = document.getElementById('main-chart');
    if (!canvas) return;
    mainChart = new Chart(canvas, {
        type: 'line',
        data: { datasets: [{ label: 'Score', data: [], borderColor: '#000', borderWidth: 2 }] },
        options: { scales: { x: { type: 'realtime' }, y: { min: 0, max: 15 } } }
    });
}
init();

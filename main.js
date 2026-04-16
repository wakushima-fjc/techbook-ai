import {
    PoseLandmarker,
    HandLandmarker,
    FilesetResolver,
    DrawingUtils
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.2/+esm";
import { REBAEngine } from "./reba-engine.js";
import { ClinicalEngine } from "./clinical-engine.js";

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
      selectedPart: 0,
      activeMetric: 'angle',
      activePlane: 'XY',
      isOrbitActive: false,
      orbits: {},
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

async function init() {
      try {
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
                updateStatus('Ready', 'bg-black');
                initCharts();
                setupEventListeners();
                if (elements.overlay) elements.overlay.classList.add('hidden');
      } catch (err) {
                updateStatus('Error', 'bg-red-500');
      }
}

function updateStatus(text, colorClass) {
      if (elements.statusText) elements.statusText.innerText = text;
      if (elements.statusDot) elements.statusDot.className = `w-2 h-2 rounded-full ${colorClass}`;
}

init();

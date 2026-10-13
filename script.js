const state = {
  isPlaying: false, mode: 'stereo', playbackRate: 1.0,
  duration: 0, currentTime: 0, recordAngle: 0,
  dispL: 0, dispR: 0, visualSmoothL: 0, visualSmoothR: 0,
  coilEnergyL: 0, coilEnergyR: 0, coilPhase: 0, cantileverDeflection: 0,
  historyL: new Float32Array(250), historyR: new Float32Array(250),
  histIndex: 0, animationFrameId: null, audioStartTime: 0
};

let audioCtx, sourceNode, audioBuffer;
let analyserL, analyserR;
let dataL, dataR;
let splitterNode, mergerNode;
let gainLL, gainLR, gainRL, gainRR;

const els = {
  play: document.getElementById('btn-play'),
  example: document.getElementById('btn-example'),
  upload: document.getElementById('audio-upload'),
  timeline: document.getElementById('timeline'),
  timeCurrent: document.getElementById('time-current'),
  timeTotal: document.getElementById('time-total'),
  btnMono: document.getElementById('btn-mono'),
  btnStereo: document.getElementById('btn-stereo')
};

function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyserL = audioCtx.createAnalyser();
    analyserR = audioCtx.createAnalyser();
    analyserL.fftSize = 256;
    analyserR.fftSize = 256;
    dataL = new Float32Array(256);
    dataR = new Float32Array(256);

    // Matriz de Roteamento Estéreo / Mono com ChannelMerger de 2 canais
    // Canal 0 = Ouvido Esquerdo (Fones)
    // Canal 1 = Ouvido Direito (Fones)
    mergerNode = audioCtx.createChannelMerger(2);

    gainLL = audioCtx.createGain(); // Canal L -> Ouvido Esquerdo
    gainLR = audioCtx.createGain(); // Canal L -> Ouvido Direito
    gainRL = audioCtx.createGain(); // Canal R -> Ouvido Esquerdo
    gainRR = audioCtx.createGain(); // Canal R -> Ouvido Direito

    // Conexões da matriz de áudio
    gainLL.connect(mergerNode, 0, 0); // L -> L
    gainRL.connect(mergerNode, 0, 0); // R -> L
    gainLR.connect(mergerNode, 0, 1); // L -> R
    gainRR.connect(mergerNode, 0, 1); // R -> R

    // Envia o áudio resultante diretamente para os fones de ouvido / alto-falantes
    mergerNode.connect(audioCtx.destination);

    // Configura os ganhos de acordo com o modo atual
    applyAudioMode(state.mode, false);
  }
}

/**
 * Controla os coeficientes da matriz de ganho para alternar entre Mono e Estéreo em tempo real.
 * Usa setTargetAtTime para crossfade suave (25ms), eliminando estalos ou estática nos fones.
 */
function applyAudioMode(mode, smooth = true) {
  if (!gainLL || !audioCtx) return;
  const now = audioCtx.currentTime;
  const ramp = smooth ? 0.025 : 0.001;

  if (mode === 'mono') {
    // MODO MONO (Corte Lateral de Vinil):
    // Cada ouvido recebe a soma de L + R dividida por 2 (phantom center perfeito).
    gainLL.gain.setTargetAtTime(0.5, now, ramp);
    gainRL.gain.setTargetAtTime(0.5, now, ramp);
    gainLR.gain.setTargetAtTime(0.5, now, ramp);
    gainRR.gain.setTargetAtTime(0.5, now, ramp);
  } else {
    // MODO ESTÉREO (Corte 45°/45° RIAA):
    // Canal L vai exclusivamente para o ouvido esquerdo; Canal R exclusivamente para o direito.
    gainLL.gain.setTargetAtTime(1.0, now, ramp);
    gainRL.gain.setTargetAtTime(0.0, now, ramp);
    gainLR.gain.setTargetAtTime(0.0, now, ramp);
    gainRR.gain.setTargetAtTime(1.0, now, ramp);
  }
}

function formatTime(s) {
  if (isNaN(s) || !isFinite(s)) return "00 : 00";
  const m = Math.floor(s / 60).toString().padStart(2, '0');
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m} : ${sec}`;
}

function playSyntheticExample() {
  initAudio();
  stopAudio();
  const bufferSize = audioCtx.sampleRate * 10;
  audioBuffer = audioCtx.createBuffer(2, bufferSize, audioCtx.sampleRate);
  
  const chanL = audioBuffer.getChannelData(0);
  const chanR = audioBuffer.getChannelData(1);
  
  for (let i = 0; i < bufferSize; i++) {
    const t = i / audioCtx.sampleRate;
    // Canal Esquerdo: Bumbo acústico grave 55Hz bem definido
    let kick = Math.sin(2 * Math.PI * 55 * t) * Math.exp(-5.5 * (t % 1.0));
    chanL[i] = Math.max(-0.95, Math.min(0.95, kick * 1.2)); 
    
    // Canal Direito: Sintetizador melódico arpejado em 4 notas
    let note = [440, 554, 659, 880][Math.floor(t * 8) % 4];
    let synth = Math.sin(2 * Math.PI * note * t) * Math.exp(-5.5 * (t % 0.125));
    chanR[i] = Math.max(-0.95, Math.min(0.95, synth * 0.9));
  }
  state.currentTime = 0;
  updateTimelineUI();
  syncStateToCurrentTime();
  startBufferPlayback();
}

els.upload.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  initAudio();
  stopAudio();
  const reader = new FileReader();
  reader.onload = (ev) => {
    audioCtx.decodeAudioData(ev.target.result, (buf) => {
      audioBuffer = buf;
      state.currentTime = 0;
      updateTimelineUI();
      syncStateToCurrentTime();
      startBufferPlayback();
    });
  };
  reader.readAsArrayBuffer(file);
});

els.example.addEventListener('click', playSyntheticExample);

function startBufferPlayback(offset = 0) {
  initAudio();
  try { if (audioCtx.state === 'suspended') audioCtx.resume(); } catch(e){}
  if (sourceNode) {
    try { sourceNode.stop(); } catch(e){}
    try { sourceNode.disconnect(); } catch(e){}
  }
  
  sourceNode = audioCtx.createBufferSource();
  sourceNode.buffer = audioBuffer;
  
  splitterNode = audioCtx.createChannelSplitter(2);

  if (audioBuffer.numberOfChannels === 1) {
    // Arquivo mono nativo: distribui para ambos os canais de análise e ganho
    sourceNode.connect(splitterNode, 0, 0);
    sourceNode.connect(splitterNode, 0, 1);
  } else {
    sourceNode.connect(splitterNode);
  }

  // Análise espectral e física em tempo real
  splitterNode.connect(analyserL, 0);
  splitterNode.connect(analyserR, audioBuffer.numberOfChannels > 1 ? 1 : 0);

  // Alimentação da Matriz de Roteamento para Fones
  splitterNode.connect(gainLL, 0);
  splitterNode.connect(gainLR, 0);
  splitterNode.connect(gainRL, 1);
  splitterNode.connect(gainRR, 1);

  // Aplica o modo atual (mono ou estéreo)
  applyAudioMode(state.mode, false);
  
  sourceNode.start(0, offset);
  state.isPlaying = true;
  state.duration = audioBuffer.duration;
  els.timeTotal.textContent = formatTime(state.duration);
  
  els.play.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg><span>Pause</span>';
  els.play.style.backgroundColor = "var(--color-charcoal)";
  els.play.style.borderColor = "var(--color-charcoal)";
  
  state.audioStartTime = audioCtx.currentTime - offset;
  
  sourceNode.onended = () => {
    setTimeout(() => {
      if (state.currentTime >= state.duration - 0.1) {
        stopAudio();
        state.currentTime = 0;
        updateTimelineUI();
        syncStateToCurrentTime();
      }
    }, 50);
  };
}

/**
 * Sincroniza o histórico e a física visual com o ponto temporal exato do áudio.
 * Permite que o osciloscópio, o sulco 3D, a agulha e o braço reflitam o ponto
 * mesmo quando a reprodução estiver pausada ou durante o scrubbing da timeline.
 */
function syncStateToCurrentTime() {
  if (!audioBuffer) return;
  const numChannels = audioBuffer.numberOfChannels;
  const chanL = audioBuffer.getChannelData(0);
  const chanR = audioBuffer.getChannelData(numChannels > 1 ? 1 : 0);
  const totalSamples = audioBuffer.length;
  const sampleRate = audioBuffer.sampleRate;
  const centerSample = Math.floor(state.currentTime * sampleRate);

  // Escala de amostragem temporal para o histórico (~60Hz por ponto no osciloscópio)
  const step = Math.max(1, Math.floor(sampleRate / 60));

  for (let i = 0; i < 250; i++) {
    const offset = (i - 249) * step;
    const sIdx = centerSample + offset;
    let valL = 0, valR = 0;
    if (sIdx >= 0 && sIdx < totalSamples) {
      valL = (chanL[sIdx] || 0) * 1.5;
      valR = (chanR[sIdx] || 0) * 1.5;
    }
    const clampedL = Math.max(-1.0, Math.min(1.0, valL));
    const clampedR = Math.max(-1.0, Math.min(1.0, valR));
    if (state.mode === 'mono') {
      const comb = (clampedL + clampedR) / 2;
      state.historyL[i] = comb;
      state.historyR[i] = comb;
    } else {
      state.historyL[i] = clampedL;
      state.historyR[i] = clampedR;
    }
  }
  state.histIndex = 0;

  let currL = 0, currR = 0;
  if (centerSample >= 0 && centerSample < totalSamples) {
    currL = (chanL[centerSample] || 0) * 1.5;
    currR = (chanR[centerSample] || 0) * 1.5;
  }
  currL = Math.max(-1.0, Math.min(1.0, currL));
  currR = Math.max(-1.0, Math.min(1.0, currR));

  if (state.mode === 'mono') {
    const comb = (currL + currR) / 2;
    state.dispL = comb;
    state.dispR = comb;
  } else {
    state.dispL = currL;
    state.dispR = currR;
  }
  state.visualSmoothL = state.dispL;
  state.visualSmoothR = state.dispR;

  // Cálculo de energia RMS no trecho
  let sumSqL = 0, sumSqR = 0;
  const rmsWindow = 64;
  for (let j = 0; j < rmsWindow; j++) {
    const idx = centerSample - Math.floor(rmsWindow / 2) + j;
    if (idx >= 0 && idx < totalSamples) {
      const sL = chanL[idx] || 0;
      const sR = chanR[idx] || 0;
      sumSqL += sL * sL;
      sumSqR += sR * sR;
    }
  }
  let rmsL = Math.min(1.0, Math.sqrt(sumSqL / rmsWindow) * 2.8);
  let rmsR = Math.min(1.0, Math.sqrt(sumSqR / rmsWindow) * 2.8);
  if (state.mode === 'mono') {
    const combRms = (rmsL + rmsR) / 2;
    rmsL = combRms;
    rmsR = combRms;
  }
  state.coilEnergyL = rmsL;
  state.coilEnergyR = rmsR;

  if (state.mode === 'mono') {
    state.cantileverDeflection = rmsL * 0.5 + state.dispL * 0.2;
  } else {
    state.cantileverDeflection = (rmsL - rmsR) * 0.75 + (state.dispL - state.dispR) * 0.2;
  }
}

function stopAudio() {
  if (sourceNode && state.isPlaying) {
    try { sourceNode.stop(); } catch(e){}
    try { sourceNode.disconnect(); } catch(e){}
  }
  state.isPlaying = false;
  els.play.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg><span>Play</span>';
  els.play.style.backgroundColor = "var(--color-primary)";
  els.play.style.borderColor = "var(--color-primary)";
}

els.play.addEventListener('click', () => {
  if (!audioBuffer) return;
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  if (state.isPlaying) {
    stopAudio();
  } else {
    if (state.currentTime >= state.duration - 0.05) {
      state.currentTime = 0;
      syncStateToCurrentTime();
    }
    startBufferPlayback(state.currentTime);
  }
});

els.timeline.addEventListener('input', (e) => {
  if (!audioBuffer) return;
  state.currentTime = (parseFloat(e.target.value) / 100) * state.duration;
  els.timeCurrent.textContent = formatTime(state.currentTime);
  syncStateToCurrentTime();
  if (state.isPlaying) {
    startBufferPlayback(state.currentTime);
  }
});

els.btnMono.addEventListener('click', () => {
  state.mode = 'mono';
  els.btnMono.className = 'active-mono';
  els.btnStereo.className = '';
  applyAudioMode('mono', true);
  if (!state.isPlaying && audioBuffer) {
    syncStateToCurrentTime();
  }
});

els.btnStereo.addEventListener('click', () => {
  state.mode = 'stereo';
  els.btnMono.className = '';
  els.btnStereo.className = 'active-stereo';
  applyAudioMode('stereo', true);
  if (!state.isPlaying && audioBuffer) {
    syncStateToCurrentTime();
  }
});

function updateTimelineUI() {
  if (!audioBuffer) return;
  els.timeline.value = (state.currentTime / state.duration) * 100;
  els.timeCurrent.textContent = formatTime(state.currentTime);
}

function updatePhysics() {
  // Apenas avança e computa física quando a música está de fato reproduzindo.
  // Quando pausado, todo o estado congelado permanece exatamente onde estava.
  if (state.isPlaying && audioCtx) {
    state.currentTime = audioCtx.currentTime - state.audioStartTime;
    if (state.currentTime > state.duration) state.currentTime = state.duration;
    updateTimelineUI();
    state.recordAngle += 0.05;

    analyserL.getFloatTimeDomainData(dataL);
    analyserR.getFloatTimeDomainData(dataR);
    
    let rawL = dataL[128]; if(isNaN(rawL)) rawL = 0;
    let rawR = dataR[128]; if(isNaN(rawR)) rawR = 0;
    
    rawL = Math.max(-1.0, Math.min(1.0, rawL)) * 1.5;
    rawR = Math.max(-1.0, Math.min(1.0, rawR)) * 1.5;

    // Cálculo da energia instantânea RMS para acionamento eletromagnético das bobinas
    let sumSqL = 0, sumSqR = 0;
    for (let i = 0; i < 256; i += 4) {
      const vL = isNaN(dataL[i]) ? 0 : dataL[i];
      const vR = isNaN(dataR[i]) ? 0 : dataR[i];
      sumSqL += vL * vL;
      sumSqR += vR * vR;
    }
    let rmsL = Math.min(1.0, Math.sqrt(sumSqL / 64) * 2.8);
    let rmsR = Math.min(1.0, Math.sqrt(sumSqR / 64) * 2.8);

    if (state.mode === 'mono') {
      const combined = (rawL + rawR) / 2;
      state.dispL = combined; state.dispR = combined;
      const combinedRms = (rmsL + rmsR) / 2;
      rmsL = combinedRms; rmsR = combinedRms;
    } else {
      state.dispL = rawL; state.dispR = rawR;
    }

    // Envelope dinâmico: ataque imediato e decaimento exponencial
    state.coilEnergyL = Math.max(rmsL, state.coilEnergyL * 0.84);
    state.coilEnergyR = Math.max(rmsR, state.coilEnergyR * 0.84);
    state.coilPhase = (state.coilPhase + 0.16) % (Math.PI * 2);

    // Movimento Dinâmico da Haste (Cantilever) no Perfil
    let targetCantilever = 0;
    if (state.mode === 'mono') {
      // No modo mono, oscilação mecânica da agulha rastreando o sulco
      const mod = Math.sin(state.recordAngle * 14) * 0.65 + Math.cos(state.recordAngle * 8) * 0.35;
      targetCantilever = (rmsL * 0.85) * mod + (rawL * 0.25);
    } else {
      // No modo estéreo: balanço entre Bobina L e Bobina R + vibração mecânica
      const channelDiff = (rmsL - rmsR); // Positivo quando Bobina L domina, negativo quando Bobina R domina
      const vib = Math.sin(state.recordAngle * 12) * (rmsL * 0.45) - Math.cos(state.recordAngle * 10) * (rmsR * 0.45);
      targetCantilever = channelDiff * 0.75 + vib + (rawL - rawR) * 0.2;
    }
    state.cantileverDeflection += (targetCantilever - state.cantileverDeflection) * 0.22;

    // Amortecimento Mecânico (EMA Factor ajustado para 0.15 para boa resposta mecânica)
    state.visualSmoothL += (state.dispL - state.visualSmoothL) * 0.15;
    state.visualSmoothR += (state.dispR - state.visualSmoothR) * 0.15;

    // Dados sem filtro para Osciloscópio (Alta Frequência Real)
    state.historyL[state.histIndex] = state.dispL;
    state.historyR[state.histIndex] = state.dispR;
    state.histIndex = (state.histIndex + 1) % 250;
  }
}

const canvases = {
  front: { el: document.getElementById('cvs-front'), ctx: null, w: 0, h: 0 },
  top: { el: document.getElementById('cvs-top'), ctx: null, w: 0, h: 0 },
  profile: { el: document.getElementById('cvs-profile'), ctx: null, w: 0, h: 0 },
  scope: { el: document.getElementById('cvs-scope'), ctx: null, w: 0, h: 0 }
};

Object.values(canvases).forEach(c => { c.ctx = c.el.getContext('2d'); });

function resizeCanvases() {
  const dpr = window.devicePixelRatio || 1;
  Object.values(canvases).forEach(c => {
    // Redimensionamento perfeito baseado no container fixo da Grid
    const parent = c.el.parentElement;
    const rect = parent.getBoundingClientRect();
    c.w = rect.width;
    c.h = rect.height;
    c.el.width = c.w * dpr;
    c.el.height = c.h * dpr;
    c.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  });
}

window.addEventListener('resize', resizeCanvases);
window.addEventListener('DOMContentLoaded', () => {
  initAudio();
  resizeCanvases();
  requestAnimationFrame(renderLoop);
});

function drawFront(c) {
  const { ctx, w, h } = c;
  ctx.clearRect(0, 0, w, h);
  
  // Fundo clean do painel
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  
  // Coordenadas Absolutas Relativas
  const cx = w / 2;
  const cy = h / 2;
  const size = Math.min(w, h);
  
  const gw = size * 0.25; // Largura V
  const gd = size * 0.25; // Profundidade V
  const scale = size * 0.2; // Escala do movimento
  
  let lX = 0, lY = 0, rX = 0, rY = 0;
  
  if (state.mode === 'mono') {
    const lat = state.visualSmoothL * scale;
    lX = lat; rX = lat;
  } else {
    lX = state.visualSmoothL * scale * Math.cos(Math.PI/4);
    lY = state.visualSmoothL * scale * Math.sin(Math.PI/4);
    rX = -state.visualSmoothR * scale * Math.cos(Math.PI/4);
    rY = state.visualSmoothR * scale * Math.sin(Math.PI/4);
  }

  if (isNaN(lX) || isNaN(lY) || isNaN(rX) || isNaN(rY)) { lX = 0; lY = 0; rX = 0; rY = 0; }

  // Coordenada flutuante da Ponta da Agulha
  const tX = cx + lX + rX;
  const tY = cy + gd - (lY + rY);

  // Bloco Maciço do Vinil (Charcoal #201E1D)
  ctx.fillStyle = '#201e1d'; 
  ctx.beginPath();
  ctx.moveTo(0, h); 
  ctx.lineTo(0, cy); 
  ctx.lineTo(cx - gw, cy);
  ctx.lineTo(tX, tY); // Ponta dinamicamente modula a parede
  ctx.lineTo(cx + gw, cy);
  ctx.lineTo(w, cy); 
  ctx.lineTo(w, h); 
  ctx.fill();

  // Parede Esquerda (Canal L - Charcoal #201E1D / Mono Terracota)
  ctx.lineWidth = 3.5; ctx.lineCap = 'round';
  ctx.strokeStyle = state.mode === 'mono' ? '#de6644' : '#201e1d';
  ctx.beginPath(); ctx.moveTo(cx - gw, cy); ctx.lineTo(tX, tY); ctx.stroke();
  
  // Parede Direita (Canal R - Terracota #DE6644)
  ctx.strokeStyle = '#de6644';
  ctx.beginPath(); ctx.moveTo(tX, tY); ctx.lineTo(cx + gw, cy); ctx.stroke();

  // Agulha Invertida (Diamante em degradê branco a cinza sutil)
  const needleGrad = ctx.createLinearGradient(tX, tY, tX, tY - gd);
  needleGrad.addColorStop(0, '#ffffff');
  needleGrad.addColorStop(1, '#e5e7eb');
  
  ctx.fillStyle = needleGrad;
  ctx.beginPath();
  ctx.moveTo(tX, tY); 
  ctx.lineTo(tX - gw*0.2, tY - gd*0.7);
  ctx.lineTo(tX + gw*0.2, tY - gd*0.7); 
  ctx.fill();
  ctx.strokeStyle = 'rgba(32, 30, 29, 0.15)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Haste (Grafite acetinado #52545C)
  ctx.fillStyle = '#52545c';
  ctx.beginPath();
  ctx.roundRect 
    ? ctx.roundRect(tX - gw*0.06, tY - gd*1.5, gw*0.12, gd*0.8, 2)
    : ctx.fillRect(tX - gw*0.06, tY - gd*1.5, gw*0.12, gd*0.8);
  ctx.fill();
}

function drawTop(c) {
  const { ctx, w, h } = c;
  ctx.clearRect(0, 0, w, h);

  // Fundo clean do painel
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);

  // ==========================================
  // DIVISÃO 2/3 (TOCA-DISCOS) E 1/3 (LENTE SULCO 3D)
  // ==========================================
  const turntableW = w * (2 / 3);
  const grooveW = w * (1 / 3);

  // Parâmetros isométricos do toca-discos (2/3 da largura)
  const kappa = 0.52;
  const size = Math.min(turntableW, h);
  const tcX = turntableW * 0.46;
  const tcY = h * 0.54;
  const platterR = Math.min(turntableW * 0.34, h * 0.36);
  const platterRy = platterR * kappa;
  const platterH = 13;

  // ==========================================
  // 1. CHASSI DO TOCADISCOS (PLINTH EM 3D ISOMÉTRICO)
  // ==========================================
  const plinthW = platterR * 2.45;
  const plinthD = platterR * 2.05 * kappa;
  const plinthH = 16;
  const plinthX = tcX - plinthW * 0.48;
  const plinthY = tcY - plinthD * 0.52;

  // Sombra suave projetada pelo chassi no chão
  ctx.fillStyle = 'rgba(32, 30, 29, 0.08)';
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(plinthX + 4, plinthY + plinthH + 6, plinthW, plinthD, 14);
  } else {
    ctx.rect(plinthX + 4, plinthY + plinthH + 6, plinthW, plinthD);
  }
  ctx.fill();

  // Pés cilíndricos antivibração nos 4 cantos
  const feetOffset = 18;
  const feet = [
    { x: plinthX + feetOffset, y: plinthY + plinthH },
    { x: plinthX + plinthW - feetOffset, y: plinthY + plinthH },
    { x: plinthX + feetOffset, y: plinthY + plinthD + plinthH - 4 },
    { x: plinthX + plinthW - feetOffset, y: plinthY + plinthD + plinthH - 4 }
  ];
  feet.forEach(f => {
    ctx.fillStyle = '#201e1d';
    ctx.beginPath(); ctx.arc(f.x, f.y + 6, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e5e7eb';
    ctx.beginPath(); ctx.arc(f.x, f.y + 4, 6, 0, Math.PI * 2); ctx.fill();
  });

  const pR = 12; // Raio dos cantos do chassi
  // Face frontal inferior do chassi
  ctx.fillStyle = '#1c1b1a';
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(plinthX, plinthY + plinthH, plinthW, plinthD, pR);
  } else {
    ctx.rect(plinthX, plinthY + plinthH, plinthW, plinthD);
  }
  ctx.fill();

  // Face frontal vertical do chassi
  ctx.fillStyle = '#242220';
  ctx.fillRect(plinthX, plinthY + plinthD, plinthW, plinthH);

  // Superfície Superior do Chassi (Plinth Top Face)
  ctx.fillStyle = '#2b2927';
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(plinthX, plinthY, plinthW, plinthD, pR);
  } else {
    ctx.rect(plinthX, plinthY, plinthW, plinthD);
  }
  ctx.fill();
  ctx.strokeStyle = '#3a3734';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // ==========================================
  // 2. PRATO GIRATÓRIO (PLATTER CILÍNDRICO EM 3D)
  // ==========================================
  const cX = tcX;
  const cY = tcY;

  // Sombra do prato no chassi
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.beginPath();
  ctx.ellipse(cX + 2, cY + 4, platterR + 2, platterRy + 1, 0, 0, Math.PI * 2);
  ctx.fill();

  // Borda Cilíndrica Metálica do Prato (Platter Rim)
  ctx.beginPath();
  ctx.ellipse(cX, cY, platterR, platterRy, 0, 0, Math.PI); // metade inferior base
  ctx.ellipse(cX, cY - platterH, platterR, platterRy, 0, Math.PI, 0, true); // metade inferior topo
  ctx.closePath();
  const gradPlatterRim = ctx.createLinearGradient(cX - platterR, 0, cX + platterR, 0);
  gradPlatterRim.addColorStop(0, '#73706d');
  gradPlatterRim.addColorStop(0.28, '#b8b5b0');
  gradPlatterRim.addColorStop(0.5, '#f0eee9'); // reflexo especular frontal
  gradPlatterRim.addColorStop(0.72, '#9c9994');
  gradPlatterRim.addColorStop(1, '#575552');
  ctx.fillStyle = gradPlatterRim;
  ctx.fill();

  // Linhas pontilhadas do estroboscópio na borda do prato
  ctx.strokeStyle = 'rgba(32, 30, 29, 0.4)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.ellipse(cX, cY - platterH / 2, platterR - 0.5, platterRy - 0.5, 0, 0, Math.PI);
  ctx.stroke();
  ctx.setLineDash([]);

  // Face de topo do prato
  ctx.fillStyle = '#1f1e1d';
  ctx.beginPath();
  ctx.ellipse(cX, cY - platterH, platterR, platterRy, 0, 0, Math.PI * 2);
  ctx.fill();

  // ==========================================
  // 3. DISCO DE VINIL EM 3D ISOMÉTRICO
  // ==========================================
  const vinylR = platterR * 0.96;
  const vinylRy = vinylR * kappa;
  const vinylY = cY - platterH - 1; // 1px acima do prato

  // Face do vinil em carvão profundo
  ctx.fillStyle = '#161514';
  ctx.beginPath();
  ctx.ellipse(cX, vinylY, vinylR, vinylRy, 0, 0, Math.PI * 2);
  ctx.fill();

  // Reflexo Anastigmático Realista de Luz no Vinil em Rotação (Sheen)
  // Dois leques de luz opostos em ampulheta que giram com state.recordAngle
  ctx.save();
  ctx.translate(cX, vinylY);
  ctx.scale(1, kappa);
  ctx.rotate(state.recordAngle);

  for (let sheenAng of [-Math.PI / 4, 3 * Math.PI / 4]) {
    const sheenGrad = ctx.createRadialGradient(0, 0, vinylR * 0.3, 0, 0, vinylR);
    sheenGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
    sheenGrad.addColorStop(0.4, 'rgba(255, 255, 255, 0.08)');
    sheenGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = sheenGrad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, vinylR, sheenAng - 0.35, sheenAng + 0.35);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // Microssulcos Concêntricos no Vinil
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.055)';
  ctx.lineWidth = 1;
  for (let r = vinylR * 0.38; r < vinylR * 0.94; r += 7) {
    ctx.beginPath();
    ctx.ellipse(cX, vinylY, r, r * kappa, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Rótulo Central (Label) em Terracota #DE6644
  const labelR = vinylR * 0.32;
  const labelRy = labelR * kappa;
  ctx.fillStyle = '#de6644';
  ctx.beginPath();
  ctx.ellipse(cX, vinylY, labelR, labelRy, 0, 0, Math.PI * 2);
  ctx.fill();

  // Anéis internos do rótulo e detalhe
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(cX, vinylY, labelR * 0.65, labelRy * 0.65, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Furo central
  ctx.fillStyle = '#201e1d';
  ctx.beginPath();
  ctx.ellipse(cX, vinylY, labelR * 0.16, labelRy * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();

  // Pino Metálico Central (Spindle Cilíndrico em 3D)
  const spindleH = 8;
  const spindleR = 3.5;
  ctx.fillStyle = '#cbd5e1';
  ctx.fillRect(cX - spindleR, vinylY - spindleH, spindleR * 2, spindleH);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(cX, vinylY - spindleH, spindleR, spindleR * kappa, 0, 0, Math.PI * 2);
  ctx.fill();

  // ==========================================
  // 4. CONJUNTO DO BRAÇO FONOCAPTOR EM 3D (TONEARM)
  // ==========================================
  // Torre do Pivô no Chassi
  const pivotX = cX + platterR * 1.05;
  const pivotY = cY - platterRy * 0.62;
  const pivotH = 14;

  // Base cilíndrica da torre em 3D
  ctx.fillStyle = '#1c1b1a';
  ctx.beginPath(); ctx.ellipse(pivotX, pivotY + 2, 12, 12 * kappa, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#e5e7eb';
  ctx.beginPath(); ctx.ellipse(pivotX, pivotY - pivotH, 10, 10 * kappa, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#201e1d'; ctx.lineWidth = 2; ctx.stroke();

  // Cinemática do Rastreamento do Braço em 3D
  const rOuter = vinylR * 0.90;
  const rInner = vinylR * 0.38;
  const prog = state.duration > 0 ? (state.currentTime / state.duration) : 0;
  const currentR = rOuter + (rInner - rOuter) * prog;

  // Ponto de contato da agulha no disco em 3D
  const contactAngle = 0.55 - prog * 0.28;
  const headX = cX + currentR * Math.cos(contactAngle);
  const headY = vinylY + currentR * Math.sin(contactAngle) * kappa;

  // Contrapeso Cilíndrico em 3D (atrás do pivô)
  const armVecX = headX - pivotX;
  const armVecY = headY - (pivotY - pivotH);
  const armLen2D = Math.sqrt(armVecX * armVecX + armVecY * armVecY);
  const normX = armVecX / armLen2D;
  const normY = armVecY / armLen2D;

  const counterX = pivotX - normX * 18;
  const counterY = (pivotY - pivotH) - normY * 18;

  // Haste traseira
  ctx.strokeStyle = '#d1d5db';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(pivotX, pivotY - pivotH);
  ctx.lineTo(counterX, counterY);
  ctx.stroke();

  // Contrapeso em 3D
  ctx.fillStyle = '#32302e';
  ctx.beginPath();
  ctx.arc(counterX, counterY, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#de6644';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Sombra suave do braço sobre o disco
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(pivotX, pivotY + 2);
  ctx.lineTo(headX, headY + 3);
  ctx.stroke();

  // Tubo do Braço Fonocaptor em Alumínio Metálico
  const armGrad = ctx.createLinearGradient(pivotX, pivotY - pivotH, headX, headY);
  armGrad.addColorStop(0, '#e5e7eb');
  armGrad.addColorStop(0.5, '#f8fafc');
  armGrad.addColorStop(1, '#94a3b8');
  ctx.strokeStyle = armGrad;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(pivotX, pivotY - pivotH);
  ctx.lineTo(headX, headY - 4);
  ctx.stroke();

  // Articulação Gimbal no topo da torre
  ctx.fillStyle = '#201e1d';
  ctx.beginPath();
  ctx.arc(pivotX, pivotY - pivotH, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Cápsula & Headshell em 3D
  ctx.save();
  ctx.translate(headX, headY - 4);
  const headAngle = Math.atan2(headY - (pivotY - pivotH), headX - pivotX) + 0.35;
  ctx.rotate(headAngle);

  // Bloco da cápsula em Charcoal #201E1D
  ctx.fillStyle = '#201e1d';
  ctx.fillRect(-5, -3, 16, 7);
  // Detalhe em Terracota #DE6644
  ctx.fillStyle = '#de6644';
  ctx.fillRect(8, -3, 3, 7);
  // Ponta da agulha descendo até o sulco
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(9, 4);
  ctx.lineTo(11, 4);
  ctx.lineTo(10, 7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Vibração dinâmica da cápsula com o áudio
  if (state.isPlaying) {
    const vibOffset = (state.dispL - state.dispR) * 2;
    ctx.strokeStyle = 'rgba(222, 102, 68, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(headX, headY, 5 + Math.abs(vibOffset), 0, Math.PI * 2);
    ctx.stroke();
  }

  // ==========================================
  // 5. DETALHES DE CONTROLE NO CHASSI
  // ==========================================
  // Luz Estroboscópica (Target Light) no canto frontal esquerdo
  const strobeX = plinthX + 22;
  const strobeY = plinthY + 22;
  ctx.fillStyle = '#cbd5e1';
  ctx.fillRect(strobeX - 3, strobeY - 8, 6, 8);
  ctx.fillStyle = state.isPlaying ? '#de6644' : '#6b7280';
  ctx.beginPath(); ctx.arc(strobeX, strobeY - 9, 3, 0, Math.PI * 2); ctx.fill();
  if (state.isPlaying) {
    ctx.fillStyle = 'rgba(222, 102, 68, 0.12)';
    ctx.beginPath();
    ctx.moveTo(strobeX, strobeY - 9);
    ctx.lineTo(strobeX + 45, strobeY - 2);
    ctx.lineTo(strobeX + 40, strobeY + 25);
    ctx.closePath();
    ctx.fill();
  }

  // Chave seletora 33 / 45 RPM
  const swX = plinthX + 22;
  const swY = plinthY + plinthD - 22;
  ctx.fillStyle = '#1c1b1a';
  ctx.beginPath(); ctx.arc(swX, swY, 7, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#4a4845'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = '600 8px "General Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('33', swX, swY + 3);

  // Pitch Slider no lado direito
  const slX = plinthX + plinthW - 20;
  const slY = plinthY + plinthD * 0.45;
  ctx.fillStyle = '#1c1b1a';
  ctx.fillRect(slX - 2, slY, 4, 32);
  ctx.fillStyle = '#e5e7eb';
  ctx.fillRect(slX - 5, slY + 14, 10, 4);

  // ==========================================
  // DIVISÓRIA ENTRE O TOCA-DISCOS (2/3) E A LENTE (1/3)
  // ==========================================
  ctx.strokeStyle = 'rgba(32, 30, 29, 0.07)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(turntableW, 8);
  ctx.lineTo(turntableW, h - 8);
  ctx.stroke();

  // ==========================================
  // 6. PAINEL 1/3: LENTE DE INSPEÇÃO DO SULCO 3D (V-GROOVE PERSPECTIVE)
  // ==========================================
  const hudMargin = 8;
  const hudX = turntableW + hudMargin;
  const hudY = hudMargin;
  const hudW = grooveW - (hudMargin * 2);
  const hudH = h - (hudMargin * 2);

  ctx.save();

  // Sombra e fundo escuro do container do sulco (Charcoal #181716)
  ctx.fillStyle = '#181716';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(hudX, hudY, hudW, hudH, 14);
  else ctx.rect(hudX, hudY, hudW, hudH);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Clip para manter todos os desenhos internos dentro do card arredondado
  ctx.save();
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(hudX, hudY, hudW, hudH, 14);
  else ctx.rect(hudX, hudY, hudW, hudH);
  ctx.clip();

  // --- CABEÇALHO DO CARD DO SULCO ---
  const headerY = hudY + 18;
  // Badge "LENTE SULCO 3D"
  ctx.fillStyle = 'rgba(222, 102, 68, 0.15)';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(hudX + 12, headerY - 10, 78, 16, 8);
  else ctx.rect(hudX + 12, headerY - 10, 78, 16);
  ctx.fill();
  ctx.strokeStyle = 'rgba(222, 102, 68, 0.4)';
  ctx.lineWidth = 0.8;
  ctx.stroke();

  ctx.font = '700 8.5px "General Sans", sans-serif';
  ctx.fillStyle = '#de6644';
  ctx.textAlign = 'center';
  ctx.fillText('LENTE SULCO 3D', hudX + 12 + 39, headerY + 1.5);

  // Indicador de modo à direita
  ctx.font = '600 8px "General Sans", sans-serif';
  ctx.fillStyle = '#9ca3af';
  ctx.textAlign = 'right';
  ctx.fillText(state.mode === 'mono' ? 'MODO MONO (L=R)' : 'ESTÉREO 45°/45°', hudX + hudW - 12, headerY + 1);

  // Legendas dos canais com marcadores de cor
  const legY = headerY + 16;
  ctx.font = '500 8px "General Sans", sans-serif';
  ctx.textAlign = 'left';
  // Canal L
  ctx.fillStyle = '#9ca3af';
  ctx.fillRect(hudX + 12, legY - 5, 5, 5);
  ctx.fillText('45° INT (L)', hudX + 21, legY);
  // Canal R
  ctx.fillStyle = '#de6644';
  ctx.fillRect(hudX + 78, legY - 5, 5, 5);
  ctx.fillText('45° EXT (R)', hudX + 87, legY);

  // Linha separadora sutil
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(hudX + 10, legY + 8);
  ctx.lineTo(hudX + hudW - 10, legY + 8);
  ctx.stroke();

  // --- GEOMETRIA DO CANAL DO SULCO EM 3D ---
  const gTopY = legY + 16;
  const gBotY = hudY + hudH - 32;
  const gH = gBotY - gTopY;
  const gCenterX = hudX + hudW * 0.5;
  const gHalfW = Math.max(22, Math.min(hudW * 0.28, 44)); // meia-largura da abertura na superfície
  const gScale = Math.max(6, Math.min(hudW * 0.12, 14));  // amplitude de modulação
  const vDepth = Math.max(16, Math.min(hudH * 0.08, 24)); // profundidade visual isométrica do vale

  // Superfície do Disco (Lands ao redor do sulco) com micro-textura
  ctx.fillStyle = '#1c1b1a';
  ctx.fillRect(hudX, gTopY - 4, hudW, gH + 8);
  // Micro-ranhuras sutis na superfície plana do vinil (Lands)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
  ctx.lineWidth = 1;
  for (let ly = gTopY; ly <= gBotY; ly += 6) {
    ctx.beginPath();
    ctx.moveTo(hudX + 8, ly);
    ctx.lineTo(hudX + hudW - 8, ly);
    ctx.stroke();
  }

  // Amostragem dos dados de áudio ao longo do comprimento do sulco
  const numSteps = 48;
  const stepY = gH / numSteps;
  const ptsLeft = [];
  const ptsRight = [];
  const ptsApex = [];

  for (let i = 0; i <= numSteps; i++) {
    let idx = (state.histIndex - i * 2) % state.historyL.length;
    if (idx < 0) idx += state.historyL.length;

    const vL = state.historyL[idx] || 0;
    const vR = (state.mode === 'mono' ? vL : (state.historyR[idx] || 0));

    const y = gTopY + i * stepY;
    const xL = gCenterX - gHalfW + vL * gScale;
    const xR = gCenterX + gHalfW - vR * gScale;
    const xApex = gCenterX + (vL - vR) * 0.5 * gScale;
    const yApex = y + vDepth + (vL + vR) * 0.25 * gScale;

    ptsLeft.push({ x: xL, y: y });
    ptsRight.push({ x: xR, y: y });
    ptsApex.push({ x: xApex, y: yApex });
  }

  // 1. Parede Esquerda (45° Canal L) - Face Poligonal Sombreada em 3D
  ctx.beginPath();
  ctx.moveTo(ptsLeft[0].x, ptsLeft[0].y);
  for (let i = 1; i <= numSteps; i++) ctx.lineTo(ptsLeft[i].x, ptsLeft[i].y);
  for (let i = numSteps; i >= 0; i--) ctx.lineTo(ptsApex[i].x, ptsApex[i].y);
  ctx.closePath();

  const gradWallL = ctx.createLinearGradient(gCenterX - gHalfW, 0, gCenterX, 0);
  gradWallL.addColorStop(0, '#33312e');   // Borda superior iluminada
  gradWallL.addColorStop(0.7, '#242220');
  gradWallL.addColorStop(1, '#151413');   // Fundo do desfiladeiro em sombra
  ctx.fillStyle = gradWallL;
  ctx.fill();

  // 2. Parede Direita (45° Canal R) - Face Poligonal Sombreada em 3D com brilho Terracota
  ctx.beginPath();
  ctx.moveTo(ptsApex[0].x, ptsApex[0].y);
  for (let i = 1; i <= numSteps; i++) ctx.lineTo(ptsApex[i].x, ptsApex[i].y);
  for (let i = numSteps; i >= 0; i--) ctx.lineTo(ptsRight[i].x, ptsRight[i].y);
  ctx.closePath();

  const gradWallR = ctx.createLinearGradient(gCenterX, 0, gCenterX + gHalfW, 0);
  gradWallR.addColorStop(0, '#151413');   // Fundo do desfiladeiro
  gradWallR.addColorStop(0.3, '#2a2220'); // Tom quente terroso
  gradWallR.addColorStop(0.85, '#382b27');
  gradWallR.addColorStop(1, '#4a3630');   // Crista direita com reflexo terracota
  ctx.fillStyle = gradWallR;
  ctx.fill();

  // 3. Nervuras Transversais 3D (Cross-Contours / Wireframe em V do Sulco)
  // Deslocamento contínuo com a rotação do disco para efeito visual dinâmico
  const ribSpacing = 10;
  const animOffset = (state.recordAngle * 25) % ribSpacing;
  ctx.lineWidth = 1;

  for (let k = animOffset; k <= gH; k += ribSpacing) {
    const ratio = Math.max(0, Math.min(1, k / gH));
    const stepIdx = Math.floor(ratio * numSteps);
    if (stepIdx < numSteps) {
      const pL = ptsLeft[stepIdx];
      const pR = ptsRight[stepIdx];
      const pA = ptsApex[stepIdx];

      // Costela esquerda (Borda L -> Vale)
      ctx.strokeStyle = 'rgba(156, 163, 175, 0.22)';
      ctx.beginPath();
      ctx.moveTo(pL.x, pL.y);
      ctx.lineTo(pA.x, pA.y);
      ctx.stroke();

      // Costela direita (Vale -> Borda R)
      ctx.strokeStyle = 'rgba(222, 102, 68, 0.28)';
      ctx.beginPath();
      ctx.moveTo(pA.x, pA.y);
      ctx.lineTo(pR.x, pR.y);
      ctx.stroke();
    }
  }

  // 4. Crista Superior Esquerda (Borda do Sulco Canal L)
  ctx.strokeStyle = '#9ca3af';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(ptsLeft[0].x, ptsLeft[0].y);
  for (let i = 1; i <= numSteps; i++) ctx.lineTo(ptsLeft[i].x, ptsLeft[i].y);
  ctx.stroke();

  // 5. Crista Superior Direita (Borda do Sulco Canal R)
  ctx.strokeStyle = '#de6644';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(ptsRight[0].x, ptsRight[0].y);
  for (let i = 1; i <= numSteps; i++) ctx.lineTo(ptsRight[i].x, ptsRight[i].y);
  ctx.stroke();

  // 6. Linha de Fundo do Vale (Apex / Raiz do Sulco 90°)
  ctx.strokeStyle = '#090807';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(ptsApex[0].x, ptsApex[0].y);
  for (let i = 1; i <= numSteps; i++) ctx.lineTo(ptsApex[i].x, ptsApex[i].y);
  ctx.stroke();

  // --- 7. AGULHA DE DIAMANTE EM 3D NO SULCO (DIAMOND STYLUS 3D) ---
  const needleIdx = Math.min(10, Math.floor(numSteps * 0.22));
  const needleApex = ptsApex[needleIdx];
  const nX = needleApex.x;
  const nY = needleApex.y;

  // Haste de Alumínio do Cantilever (subindo em perspectiva)
  const cantH = 32;
  const cantGrad = ctx.createLinearGradient(nX - 4, 0, nX + 4, 0);
  cantGrad.addColorStop(0, '#9ca3af');
  cantGrad.addColorStop(0.4, '#f3f4f6');
  cantGrad.addColorStop(1, '#4b5563');
  ctx.fillStyle = cantGrad;
  ctx.beginPath();
  ctx.moveTo(nX - 3, nY - cantH);
  ctx.lineTo(nX + 3, nY - cantH);
  ctx.lineTo(nX + 2, nY - 8);
  ctx.lineTo(nX - 2, nY - 8);
  ctx.closePath();
  ctx.fill();

  // Bloco de fixação da ponta de diamante
  ctx.fillStyle = '#2b2927';
  ctx.beginPath();
  ctx.arc(nX, nY - 8, 4, 0, Math.PI * 2);
  ctx.fill();

  // Diamante Lapidado Multifacetado em 3D
  // Faceta Esquerda do Diamante (reflexo claro frio)
  ctx.fillStyle = '#f8fafc';
  ctx.beginPath();
  ctx.moveTo(nX, nY);
  ctx.lineTo(nX - 5, nY - 9);
  ctx.lineTo(nX, nY - 9);
  ctx.closePath();
  ctx.fill();

  // Faceta Direita do Diamante (reflexo com tom terracota)
  ctx.fillStyle = '#e2e8f0';
  ctx.beginPath();
  ctx.moveTo(nX, nY);
  ctx.lineTo(nX, nY - 9);
  ctx.lineTo(nX + 5, nY - 9);
  ctx.closePath();
  ctx.fill();

  // Brilho especular no ápice de contato do diamante
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(nX, nY, 1.6, 0, Math.PI * 2);
  ctx.fill();

  // Pontos de contato dinâmicos nas paredes do sulco
  if (state.isPlaying) {
    const glowEnergy = Math.max(state.coilEnergyL || 0, state.coilEnergyR || 0);
    if (glowEnergy > 0.05) {
      // Glow no ponto de contato L
      ctx.fillStyle = 'rgba(156, 163, 175, 0.6)';
      ctx.beginPath();
      ctx.arc(nX - 2.8, nY - 3, 2.5 * (1 + glowEnergy), 0, Math.PI * 2);
      ctx.fill();

      // Glow no ponto de contato R
      ctx.fillStyle = 'rgba(222, 102, 68, 0.7)';
      ctx.beginPath();
      ctx.arc(nX + 2.8, nY - 3, 2.8 * (1 + glowEnergy), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // --- 8. TELEMETRIA E MÉTRICAS NA BASE DO CARD ---
  const footY = hudY + hudH - 12;
  ctx.font = '600 7.5px "General Sans", sans-serif';
  ctx.fillStyle = '#9ca3af';
  ctx.textAlign = 'left';
  const modLPercent = Math.min(99, Math.round(Math.abs(state.dispL || 0) * 100));
  const modRPercent = Math.min(99, Math.round(Math.abs(state.dispR || 0) * 100));
  ctx.fillText(`L: ${modLPercent}%  ·  R: ${modRPercent}%`, hudX + 12, footY);

  // Ângulo nominal 90° V-CUT
  ctx.textAlign = 'right';
  ctx.fillStyle = '#de6644';
  ctx.fillText('90° V-CUT · 45°/45°', hudX + hudW - 12, footY);

  ctx.restore(); // Desfaz clip
  ctx.restore(); // Desfaz save principal
}

function drawProfile(c) {
  const { ctx, w, h } = c;
  ctx.clearRect(0, 0, w, h);
  
  // Fundo limpo
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);

  const vY = h * 0.8;
  // Bloco de vinil em Charcoal #201E1D
  ctx.fillStyle = '#201e1d'; ctx.fillRect(0, vY, w, h - vY);
  ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, vY); ctx.lineTo(w, vY); ctx.stroke();

  const pivotX = w * 0.5; 
  const pivotY = h * 0.5;
  
  const stylusX = w * 0.2;
  // Deflexão mecânica visível da haste (amplitude calibrada de até ±10% da altura do painel)
  const maxTravel = h * 0.10;
  const lift = (state.cantileverDeflection || 0) * maxTravel;
  const stylusY = vY + lift;

  const ang = Math.atan2(pivotY - stylusY, pivotX - stylusX);
  const rArm = w * 0.3; 
  const magX = pivotX + Math.cos(ang) * rArm;
  const magY = pivotY + Math.sin(ang) * rArm;

  // Haste (Cantilever) em grafite acetinado
  ctx.strokeStyle = '#52545c'; ctx.lineWidth = 7; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(stylusX, stylusY); ctx.lineTo(magX, magY); ctx.stroke();

  // Agulha (Diamante em degradê branco a cinza sutil)
  const gradD = ctx.createLinearGradient(stylusX, stylusY, stylusX, stylusY - 16);
  gradD.addColorStop(0, '#ffffff'); gradD.addColorStop(1, '#e5e7eb');
  ctx.fillStyle = gradD; 
  ctx.beginPath();
  ctx.moveTo(stylusX, stylusY); 
  ctx.lineTo(stylusX - 6, stylusY - 14); 
  ctx.lineTo(stylusX + 6, stylusY - 14); 
  ctx.fill();
  ctx.strokeStyle = 'rgba(32, 30, 29, 0.2)'; ctx.lineWidth = 1; ctx.stroke();

  // Pivô central
  ctx.fillStyle = '#201e1d'; ctx.beginPath(); ctx.arc(pivotX, pivotY, 8, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 2; ctx.stroke();
  
  // Matemática do gap para as bobinas simétricas
  const restAng = Math.atan2(pivotY - vY, pivotX - stylusX);
  const rMagX = pivotX + Math.cos(restAng) * rArm;
  const rMagY = pivotY + Math.sin(restAng) * rArm;
  const off = h * 0.16;
  
  const cTX = rMagX; const cTY = rMagY - off;
  const cBX = rMagX; const cBY = rMagY + off;

  const eL = Math.max(0, Math.min(1.0, state.coilEnergyL || 0));
  const eR = Math.max(0, Math.min(1.0, state.coilEnergyR || 0));

  const isMono = state.mode === 'mono';
  const colL = isMono ? '#de6644' : '#201e1d';
  const glowL = isMono ? 'rgba(222, 102, 68, 0.45)' : 'rgba(32, 30, 29, 0.25)';
  const colR = '#de6644';
  const glowR = 'rgba(222, 102, 68, 0.45)';

  // Linhas de Acoplamento Magnético (Íman -> Bobinas)
  const drawFluxCoupling = (toX, toY, energy, glowCol) => {
    if (energy < 0.06) return;
    ctx.save();
    ctx.strokeStyle = glowCol;
    ctx.lineWidth = 1.5 + energy * 2;
    ctx.shadowColor = glowCol;
    ctx.shadowBlur = 8 * energy;
    ctx.globalAlpha = Math.min(0.85, energy * 0.9);
    ctx.setLineDash([4, 4]);
    ctx.lineDashOffset = -state.coilPhase * 10;
    
    [-9, 0, 9].forEach(offset => {
      ctx.beginPath();
      ctx.moveTo(magX, magY);
      const midX = (magX + toX) / 2 + offset * 1.5;
      const midY = (magY + toY) / 2;
      ctx.quadraticCurveTo(midX, midY, toX, toY);
      ctx.stroke();
    });
    ctx.restore();
  };

  drawFluxCoupling(cTX, cTY, eL, glowL);
  drawFluxCoupling(cBX, cBY, eR, glowR);

  const drawCoil = (cx, cy, txt, energy, channelCol, glowCol) => {
    ctx.save();

    // 1. Ondas de Indução Expansivas (Ripples)
    if (energy > 0.08) {
      for (let i = 0; i < 2; i++) {
        const waveProg = ((state.coilPhase * 8 + i * 14) % 28) / 28;
        const waveR = 22 + waveProg * 26;
        const waveAlpha = (1 - waveProg) * energy * 0.55;
        ctx.save();
        ctx.strokeStyle = glowCol;
        ctx.lineWidth = 2;
        ctx.globalAlpha = waveAlpha;
        ctx.shadowColor = glowCol;
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(cx, cy, waveR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    // 2. Núcleo Incandescente (Core Flare / Plasma)
    if (energy > 0.04) {
      const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 26);
      coreGrad.addColorStop(0, `rgba(255, 255, 255, ${Math.min(1, energy * 0.95)})`);
      coreGrad.addColorStop(0.35, glowCol);
      coreGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, 28, 0, Math.PI * 2);
      ctx.fill();
    }

    // 3. Espiras de Cobre / Metal
    if (energy > 0.06) {
      ctx.shadowColor = glowCol;
      ctx.shadowBlur = 6 + energy * 20;
    }
    const baseMetal = '#8e9098';
    const activeCol = energy > 0.35 ? channelCol : '#de6644';
    ctx.strokeStyle = energy > 0.1 ? activeCol : baseMetal;
    ctx.lineWidth = 2.0 + energy * 1.6;
    for (let r = 8; r <= 22; r += 5) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;

    // 4. Rótulo com Tipografia General Sans
    const isLit = energy > 0.12;
    ctx.font = '600 11px "General Sans", sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = isLit ? channelCol : '#8a8a93';
    ctx.fillText(txt, cx - 36, cy - 6);

    // Mini Medidor de LED de Indução (4 níveis)
    const numLeds = 4;
    const ledW = 6, ledH = 7, ledGap = 2;
    const startX = cx - 36 - (numLeds * (ledW + ledGap) - ledGap);
    for (let i = 0; i < numLeds; i++) {
      const threshold = (i + 1) * 0.22;
      const ledActive = energy >= threshold;
      ctx.fillStyle = ledActive ? (i === numLeds - 1 ? '#de6644' : channelCol) : '#e5e7eb';
      if (ledActive) {
        ctx.shadowColor = glowCol;
        ctx.shadowBlur = 4;
      } else {
        ctx.shadowBlur = 0;
      }
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(startX + i * (ledW + ledGap), cy + 2, ledW, ledH, 1.5);
        ctx.fill();
      } else {
        ctx.fillRect(startX + i * (ledW + ledGap), cy + 2, ledW, ledH);
      }
    }

    ctx.restore();
  };

  drawCoil(cTX, cTY, "BOBINA L", eL, colL, glowL);
  drawCoil(cBX, cBY, "BOBINA R", eR, colR, glowR);

  // Íman Móvel (MM) dipolar contemporâneo (Terracota N / Charcoal S)
  ctx.save(); ctx.translate(magX, magY); ctx.rotate(ang);
  ctx.fillStyle = '#de6644'; ctx.fillRect(-10, -8, 10, 16);
  ctx.fillStyle = '#201e1d'; ctx.fillRect(0, -8, 10, 16);
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.strokeRect(-10,-8,20,16);
  ctx.restore();
}

function drawScope(c) {
  const { ctx, w, h } = c;
  const cx = w/2; const cy = h/2;
  
  // Fundo moderno clean (estilo waveform minimalista da imagem 1)
  ctx.fillStyle = '#f5f6f8';
  ctx.fillRect(0, 0, w, h);

  // Grade técnica sutil
  ctx.strokeStyle = '#e8eaed'; ctx.lineWidth = 1;
  ctx.beginPath();
  for(let y = 0; y < h; y += h/8) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
  for(let x = 0; x < w; x += w/10) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
  ctx.stroke();

  // Eixos centrais dos canais (25% e 75%)
  ctx.strokeStyle = '#d2d5dc'; ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(0, h * 0.25); ctx.lineTo(w, h * 0.25);
  ctx.moveTo(0, h * 0.75); ctx.lineTo(w, h * 0.75);
  ctx.moveTo(cx, 0); ctx.lineTo(cx, h);
  ctx.stroke();

  // Badges discretos de canal no osciloscópio
  ctx.font = '600 10px "General Sans", sans-serif';
  ctx.textAlign = 'left';
  if (state.mode === 'mono') {
    ctx.fillStyle = '#de6644';
    ctx.fillText('CH1 · MONO', 14, h * 0.25 - 10);
    ctx.fillText('CH2 · MONO', 14, h * 0.75 - 10);
  } else {
    ctx.fillStyle = '#201e1d';
    ctx.fillText('CH1 · L', 14, h * 0.25 - 10);
    ctx.fillStyle = '#de6644';
    ctx.fillText('CH2 · R', 14, h * 0.75 - 10);
  }

  const hs = state.historyL.length; const step = w / hs;
  ctx.lineWidth = 2.2; ctx.lineJoin = 'round';

  if(state.mode === 'mono') {
    // Ambos os traços em Terracota #DE6644 (idêntico à forma de onda da Imagem 1)
    ctx.strokeStyle = '#de6644';
    ctx.shadowColor = 'rgba(222, 102, 68, 0.25)'; ctx.shadowBlur = 6;
    
    ctx.beginPath(); // CH1 Superior
    for(let i=0; i<hs; i++) {
      let idx = (state.histIndex + i) % hs;
      let val = ((state.historyL[idx]+state.historyR[idx])/2) * (h*0.18);
      if(i===0) ctx.moveTo(i*step, h*0.25 - val); else ctx.lineTo(i*step, h*0.25 - val);
    }
    ctx.stroke();
    
    ctx.beginPath(); // CH2 Inferior
    for(let i=0; i<hs; i++) {
      let idx = (state.histIndex + i) % hs;
      let val = ((state.historyL[idx]+state.historyR[idx])/2) * (h*0.18);
      if(i===0) ctx.moveTo(i*step, h*0.75 - val); else ctx.lineTo(i*step, h*0.75 - val);
    }
    ctx.stroke();
  } else {
    // CH1 (Esquerdo - L) em Charcoal #201E1D
    ctx.strokeStyle = '#201e1d';
    ctx.shadowColor = 'rgba(32, 30, 29, 0.15)'; ctx.shadowBlur = 4;
    ctx.beginPath();
    for(let i=0; i<hs; i++) {
      let idx = (state.histIndex + i) % hs;
      let vL = state.historyL[idx] * (h*0.18);
      if(i===0) ctx.moveTo(i*step, h*0.25 - vL); else ctx.lineTo(i*step, h*0.25 - vL);
    }
    ctx.stroke();
    
    // CH2 (Direito - R) em Terracota #DE6644
    ctx.strokeStyle = '#de6644';
    ctx.shadowColor = 'rgba(222, 102, 68, 0.28)'; ctx.shadowBlur = 6;
    ctx.beginPath();
    for(let i=0; i<hs; i++) {
      let idx = (state.histIndex + i) % hs;
      let vR = state.historyR[idx] * (h*0.18);
      if(i===0) ctx.moveTo(i*step, h*0.75 - vR); else ctx.lineTo(i*step, h*0.75 - vR);
    }
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
}

function renderLoop() {
  updatePhysics();
  // Verificações de segurança antes de desenhar
  if(canvases.front.w > 0 && canvases.front.h > 0) {
    drawFront(canvases.front);
    drawTop(canvases.top);
    drawProfile(canvases.profile);
    drawScope(canvases.scope);
  }
  state.animationFrameId = requestAnimationFrame(renderLoop);
}

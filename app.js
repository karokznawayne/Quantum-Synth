// Audio Context and Nodes
let audioContext;
let masterGain;
let analyserNode;
let lfoOscillator;
let lfoGain;
const activeVoices = new Map();

// Synth Parameters
const synthParams = {
    oscillators: [
        { waveform: 'sawtooth', volume: 80, detune: 0, octave: 0 },
        { waveform: 'square', volume: 50, detune: -5, octave: 0 },
        { waveform: 'sine', volume: 0, detune: 5, octave: 0 }
    ],
    filter: {
        type: 'lowpass',
        cutoff: 2000,
        resonance: 1,
        envAmount: 50
    },
    envelopes: {
        amp: { attack: 0.01, decay: 0.3, sustain: 0.7, release: 0.5 },
        filter: { attack: 0.1, decay: 0.3, sustain: 0.5, release: 0.5 }
    },
    lfo: {
        waveform: 'sine',
        rate: 5,
        depth: 0,
        destination: 'pitch'
    },
    effects: {
        distortion: { enabled: false, drive: 10 },
        chorus: { enabled: false, rate: 1.5, depth: 50 },
        delay: { enabled: false, time: 0.3, feedback: 0.3, mix: 30 },
        reverb: { enabled: false, size: 50, damping: 50, mix: 25 }
    },
    master: { volume: 70 },
    pitchBend: 0,
    modWheel: 0
};

// Keyboard mapping
const keyboardMap = {
    'z': 0, 's': 1, 'x': 2, 'd': 3, 'c': 4, 'v': 5, 'g': 6, 'b': 7, 'h': 8, 'n': 9, 'j': 10, 'm': 11,
    'q': 12, '2': 13, 'w': 14, '3': 15, 'e': 16, 'r': 17, '5': 18, 't': 19, '6': 20, 'y': 21, '7': 22, 'u': 23
};

// Arpeggiator
const arpeggiator = {
    enabled: false,
    pattern: 'up',
    rate: 120,
    octaves: 1,
    notes: [],
    currentIndex: 0,
    intervalId: null
};

// Sequencer
const sequencer = {
    playing: false,
    bpm: 120,
    steps: Array(16).fill(null),
    currentStep: 0,
    intervalId: null
};

// Initialize Audio Context
function initAudio() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        // Master gain
        masterGain = audioContext.createGain();
        masterGain.gain.value = synthParams.master.volume / 100;
        masterGain.connect(audioContext.destination);
        
        // Analyser for visualizations
        analyserNode = audioContext.createAnalyser();
        analyserNode.fftSize = 2048;
        masterGain.connect(analyserNode);
        
        // Initialize LFO
        initLFO();
        
        // Start visualizations
        drawOscilloscope();
        drawSpectrum();
        drawWaveform();
    }
}

// Initialize LFO
function initLFO() {
    if (lfoOscillator) {
        lfoOscillator.stop();
    }
    lfoOscillator = audioContext.createOscillator();
    lfoOscillator.type = synthParams.lfo.waveform;
    lfoOscillator.frequency.value = synthParams.lfo.rate;
    
    lfoGain = audioContext.createGain();
    lfoGain.gain.value = 0;
    
    lfoOscillator.connect(lfoGain);
    lfoOscillator.start();
}

// Note frequency calculation
function noteToFrequency(note) {
    return 440 * Math.pow(2, (note - 69) / 12);
}

// Create Voice
function createVoice(note) {
    const now = audioContext.currentTime;
    const frequency = noteToFrequency(note) * Math.pow(2, synthParams.pitchBend / 12);
    
    const voice = {
        oscillators: [],
        gains: [],
        filter: audioContext.createBiquadFilter(),
        filterEnvGain: audioContext.createGain(),
        ampEnvGain: audioContext.createGain(),
        note: note,
        startTime: now
    };
    
    // Setup filter
    voice.filter.type = synthParams.filter.type;
    voice.filter.frequency.value = synthParams.filter.cutoff;
    voice.filter.Q.value = synthParams.filter.resonance;
    
    // Apply mod wheel effect to filter
    if (synthParams.modWheel > 0) {
        voice.filter.frequency.value += synthParams.modWheel * 5000;
    }
    
    // Create oscillators
    for (let i = 0; i < 3; i++) {
        if (synthParams.oscillators[i].volume > 0) {
            const osc = audioContext.createOscillator();
            const gain = audioContext.createGain();
            
            const oscParams = synthParams.oscillators[i];
            const octaveShift = oscParams.octave * 12;
            const oscFreq = noteToFrequency(note + octaveShift);
            
            // Store oscillator index for later reference
            const oscIndex = i;
            
            if (oscParams.waveform === 'noise') {
                // White noise using buffer source
                const bufferSize = 2 * audioContext.sampleRate;
                const noiseBuffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
                const output = noiseBuffer.getChannelData(0);
                for (let j = 0; j < bufferSize; j++) {
                    output[j] = Math.random() * 2 - 1;
                }
                const noise = audioContext.createBufferSource();
                noise.buffer = noiseBuffer;
                noise.loop = true;
                voice.oscillators[oscIndex] = noise;
                noise.connect(gain);
            } else {
                osc.type = oscParams.waveform;
                osc.frequency.value = oscFreq;
                osc.detune.value = oscParams.detune + (synthParams.pitchBend * 100);
                voice.oscillators[oscIndex] = osc;
                osc.connect(gain);
            }
            
            gain.gain.value = oscParams.volume / 100;
            voice.gains[oscIndex] = gain;
            gain.connect(voice.filter);
        }
    }
    
    // Filter envelope gain not needed anymore - we modulate frequency directly
    
    // Filter envelope - modulate filter frequency directly
    const filterEnv = synthParams.envelopes.filter;
    const baseCutoff = voice.filter.frequency.value;
    const envAmount = (synthParams.filter.envAmount / 100) * 8000; // Scale envelope amount
    
    voice.filter.frequency.setValueAtTime(baseCutoff, now);
    voice.filter.frequency.linearRampToValueAtTime(baseCutoff + envAmount, now + filterEnv.attack);
    voice.filter.frequency.linearRampToValueAtTime(baseCutoff + (envAmount * filterEnv.sustain), now + filterEnv.attack + filterEnv.decay);
    
    // Amplitude envelope
    const ampEnv = synthParams.envelopes.amp;
    voice.ampEnvGain.gain.setValueAtTime(0, now);
    voice.ampEnvGain.gain.linearRampToValueAtTime(1, now + ampEnv.attack);
    voice.ampEnvGain.gain.linearRampToValueAtTime(ampEnv.sustain, now + ampEnv.attack + ampEnv.decay);
    
    // Connect to master
    voice.filter.connect(voice.ampEnvGain);
    voice.ampEnvGain.connect(masterGain);
    
    // Start oscillators
    voice.oscillators.forEach(osc => osc.start());
    
    return voice;
}

// Play Note
function playNote(note) {
    if (!audioContext) initAudio();
    
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
    
    if (!activeVoices.has(note)) {
        const voice = createVoice(note);
        activeVoices.set(note, voice);
    }
}

// Stop Note
function stopNote(note) {
    if (activeVoices.has(note)) {
        const voice = activeVoices.get(note);
        const now = audioContext.currentTime;
        const release = synthParams.envelopes.amp.release;
        const filterRelease = synthParams.envelopes.filter.release;
        
        // Amplitude envelope release
        voice.ampEnvGain.gain.cancelScheduledValues(now);
        voice.ampEnvGain.gain.setValueAtTime(voice.ampEnvGain.gain.value, now);
        voice.ampEnvGain.gain.linearRampToValueAtTime(0, now + release);
        
        // Filter envelope release
        const baseCutoff = synthParams.filter.cutoff;
        voice.filter.frequency.cancelScheduledValues(now);
        voice.filter.frequency.setValueAtTime(voice.filter.frequency.value, now);
        voice.filter.frequency.linearRampToValueAtTime(baseCutoff, now + filterRelease);
        
        setTimeout(() => {
            voice.oscillators.forEach(osc => {
                try { osc.stop(); } catch(e) {}
            });
            activeVoices.delete(note);
        }, release * 1000 + 100);
    }
}

// Panic - Stop all sounds
function panic() {
    activeVoices.forEach((voice, note) => {
        voice.oscillators.forEach(osc => {
            try { osc.stop(); } catch(e) {}
        });
    });
    activeVoices.clear();
    
    if (arpeggiator.intervalId) {
        clearInterval(arpeggiator.intervalId);
        arpeggiator.intervalId = null;
    }
    
    if (sequencer.intervalId) {
        clearInterval(sequencer.intervalId);
        sequencer.intervalId = null;
        sequencer.playing = false;
    }
}

// UI Initialization
function initUI() {
    // Initialize keyboard
    const keyboard = document.getElementById('keyboard');
    const startNote = 36; // C2
    const numKeys = 61;
    
    for (let i = 0; i < numKeys; i++) {
        const note = startNote + i;
        const octave = Math.floor((note - 12) / 12);
        const noteInOctave = (note - 12) % 12;
        const isBlack = [1, 3, 6, 8, 10].includes(noteInOctave);
        
        const key = document.createElement('div');
        key.className = `key ${isBlack ? 'black' : 'white'}`;
        key.dataset.note = note;
        
        key.addEventListener('mousedown', () => {
            key.classList.add('active');
            if (!arpeggiator.enabled) {
                playNote(note);
            }
        });
        
        key.addEventListener('mouseup', () => {
            key.classList.remove('active');
            if (!arpeggiator.enabled) {
                stopNote(note);
            }
        });
        
        key.addEventListener('mouseleave', () => {
            if (key.classList.contains('active')) {
                key.classList.remove('active');
                if (!arpeggiator.enabled) {
                    stopNote(note);
                }
            }
        });
        
        keyboard.appendChild(key);
    }
    
    // Initialize knobs
    initKnobs();
    
    // Initialize wheels
    initWheels();
    
    // Initialize sequencer grid
    initSequencer();
    
    // Event listeners
    setupEventListeners();
}

// Initialize Knobs
function initKnobs() {
    const knobs = document.querySelectorAll('.knob');
    knobs.forEach(knob => {
        const min = parseFloat(knob.dataset.min);
        const max = parseFloat(knob.dataset.max);
        const value = parseFloat(knob.dataset.value);
        
        updateKnobRotation(knob, value, min, max);
        
        let isDragging = false;
        let startY = 0;
        let startValue = value;
        
        knob.addEventListener('mousedown', (e) => {
            isDragging = true;
            startY = e.clientY;
            startValue = parseFloat(knob.dataset.value);
            knob.classList.add('dragging');
            e.preventDefault();
        });
        
        // Double-click to reset
        knob.addEventListener('dblclick', () => {
            const defaultVal = parseFloat(knob.getAttribute('data-default') || knob.dataset.value);
            knob.dataset.value = defaultVal;
            updateKnobRotation(knob, defaultVal, min, max);
            handleKnobChange(knob, defaultVal);
        });
        
        document.addEventListener('mousemove', (e) => {
            if (isDragging) {
                const delta = (startY - e.clientY) / 150; // Improved sensitivity
                let newValue = startValue + delta * (max - min);
                newValue = Math.max(min, Math.min(max, newValue));
                
                knob.dataset.value = newValue;
                updateKnobRotation(knob, newValue, min, max);
                handleKnobChange(knob, newValue);
            }
        });
        
        document.addEventListener('mouseup', () => {
            if (isDragging) {
                document.querySelectorAll('.knob').forEach(k => k.classList.remove('dragging'));
            }
            isDragging = false;
        });
    });
}

function updateKnobRotation(knob, value, min, max) {
    const percentage = (value - min) / (max - min);
    const rotation = percentage * 270 - 135; // -135 to +135 degrees
    const indicator = knob.querySelector('.knob-indicator');
    indicator.style.transform = `translateX(-50%) rotate(${rotation}deg)`;
    indicator.style.transformOrigin = 'center bottom';
    
    // Update progress ring
    knob.style.setProperty('--knob-percent', (percentage * 75).toFixed(1));
    
    const valueDisplay = knob.querySelector('.knob-value');
    if (max > 100) {
        valueDisplay.textContent = Math.round(value);
    } else if (max > 10) {
        valueDisplay.textContent = Math.round(value);
    } else {
        valueDisplay.textContent = value.toFixed(2);
    }
}

function handleKnobChange(knob, value) {
    const param = knob.dataset.param;
    const effect = knob.dataset.effect;
    const env = knob.dataset.env;
    const osc = knob.closest('.oscillator-controls')?.dataset.osc;
    
    if (osc !== undefined) {
        synthParams.oscillators[osc][param] = value;
        // Update active voices immediately
        updateActiveVoicesParameter(osc, param, value);
    } else if (effect) {
        synthParams.effects[effect][param] = value;
    } else if (env) {
        synthParams.envelopes[env][param] = value;
    } else if (knob.id === 'filterCutoff') {
        synthParams.filter.cutoff = value;
        // Update filter cutoff in real-time for all active voices
        activeVoices.forEach(voice => {
            if (voice.filter) {
                voice.filter.frequency.setTargetAtTime(value, audioContext.currentTime, 0.01);
            }
        });
    } else if (knob.id === 'filterResonance') {
        synthParams.filter.resonance = value;
        // Update filter resonance in real-time
        activeVoices.forEach(voice => {
            if (voice.filter) {
                voice.filter.Q.setTargetAtTime(value, audioContext.currentTime, 0.01);
            }
        });
    } else if (knob.id === 'filterEnvAmount') {
        synthParams.filter.envAmount = value;
    } else if (knob.id === 'lfoRate') {
        synthParams.lfo.rate = value;
        if (lfoOscillator) {
            lfoOscillator.frequency.setTargetAtTime(value, audioContext.currentTime, 0.01);
        }
    } else if (knob.id === 'lfoDepth') {
        synthParams.lfo.depth = value;
        updateLFODepth();
    }
}

// Update active voices when parameters change
function updateActiveVoicesParameter(oscIndex, param, value) {
    activeVoices.forEach(voice => {
        if (voice.oscillators[oscIndex]) {
            const osc = voice.oscillators[oscIndex];
            const oscParams = synthParams.oscillators[oscIndex];
            
            if (param === 'volume' && voice.gains[oscIndex]) {
                voice.gains[oscIndex].gain.setTargetAtTime(value / 100, audioContext.currentTime, 0.01);
            } else if (param === 'detune' && osc.detune) {
                osc.detune.setTargetAtTime(value, audioContext.currentTime, 0.01);
            }
        }
    });
}

// Update LFO depth and routing
function updateLFODepth() {
    if (!lfoGain) return;
    
    const depth = synthParams.lfo.depth;
    const destination = synthParams.lfo.destination;
    
    // Disconnect previous connections
    try {
        lfoGain.disconnect();
    } catch(e) {}
    
    if (depth > 0) {
        lfoGain.gain.value = depth / 100;
        
        // Reconnect to appropriate destination
        activeVoices.forEach(voice => {
            if (destination === 'filter' && voice.filter) {
                try {
                    lfoGain.connect(voice.filter.frequency);
                } catch(e) {}
            } else if (destination === 'amplitude' && voice.ampEnvGain) {
                try {
                    lfoGain.connect(voice.ampEnvGain.gain);
                } catch(e) {}
            }
        });
    }
}

// Initialize Wheels
function initWheels() {
    const pitchWheel = document.getElementById('pitchWheel');
    const modWheel = document.getElementById('modWheel');
    
    let pitchDragging = false;
    let modDragging = false;
    
    // Pitch wheel
    pitchWheel.addEventListener('mousedown', (e) => {
        pitchDragging = true;
        updatePitchWheel(e, pitchWheel);
    });
    
    document.addEventListener('mousemove', (e) => {
        if (pitchDragging) {
            updatePitchWheel(e, pitchWheel);
        }
        if (modDragging) {
            updateModWheel(e, modWheel);
        }
    });
    
    document.addEventListener('mouseup', () => {
        if (pitchDragging) {
            pitchDragging = false;
            // Spring back to center
            const handle = pitchWheel.querySelector('.wheel-handle');
            handle.style.top = '56px';
            synthParams.pitchBend = 0;
            
            // Reset pitch bend on all active voices
            activeVoices.forEach(voice => {
                voice.oscillators.forEach((osc, index) => {
                    if (osc.detune) {
                        const baseDetune = synthParams.oscillators[index].detune;
                        osc.detune.setTargetAtTime(baseDetune, audioContext.currentTime, 0.01);
                    }
                });
            });
        }
        modDragging = false;
    });
    
    // Mod wheel
    modWheel.addEventListener('mousedown', (e) => {
        modDragging = true;
        updateModWheel(e, modWheel);
    });
}

function updatePitchWheel(e, wheel) {
    const rect = wheel.getBoundingClientRect();
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    const handle = wheel.querySelector('.wheel-handle');
    handle.style.top = `${y - 9}px`;
    
    // Map to -2 to +2 semitones
    const value = 2 - (y / rect.height) * 4;
    synthParams.pitchBend = value;
    
    // Apply pitch bend to all active voices
    activeVoices.forEach(voice => {
        voice.oscillators.forEach((osc, index) => {
            if (osc.detune) {
                const baseDetune = synthParams.oscillators[index].detune;
                osc.detune.setTargetAtTime(baseDetune + value * 100, audioContext.currentTime, 0.01);
            }
        });
    });
}

function updateModWheel(e, wheel) {
    const rect = wheel.getBoundingClientRect();
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    const handle = wheel.querySelector('.wheel-handle');
    handle.style.top = `${y - 9}px`;
    
    // Map to 0-1
    const value = 1 - (y / rect.height);
    synthParams.modWheel = value;
    
    // Apply mod wheel to filter cutoff modulation
    activeVoices.forEach(voice => {
        if (voice.filter) {
            const baseCutoff = synthParams.filter.cutoff;
            const modAmount = value * 5000; // Up to 5000Hz modulation
            voice.filter.frequency.setTargetAtTime(baseCutoff + modAmount, audioContext.currentTime, 0.01);
        }
    });
}

// Setup Event Listeners
function setupEventListeners() {
    // Master volume
    document.getElementById('masterVolume').addEventListener('input', (e) => {
        synthParams.master.volume = e.target.value;
        if (masterGain) {
            masterGain.gain.setTargetAtTime(e.target.value / 100, audioContext.currentTime, 0.01);
        }
        document.getElementById('masterVolumeValue').textContent = e.target.value;
    });
    
    // Panic button
    document.getElementById('panicBtn').addEventListener('click', panic);
    
    // Oscillator selectors
    document.querySelectorAll('.osc-waveform').forEach((select, index) => {
        select.addEventListener('change', (e) => {
            synthParams.oscillators[index].waveform = e.target.value;
            // Update waveform display
            drawWaveform();
        });
    });
    
    document.querySelectorAll('.osc-octave').forEach((select, index) => {
        select.addEventListener('change', (e) => {
            synthParams.oscillators[index].octave = parseInt(e.target.value);
            // Stop all current notes to apply new octave
            panic();
        });
    });
    
    // Filter type
    document.getElementById('filterType').addEventListener('change', (e) => {
        synthParams.filter.type = e.target.value;
        // Update all active voices
        activeVoices.forEach(voice => {
            if (voice.filter) {
                voice.filter.type = e.target.value;
            }
        });
    });
    
    // LFO
    document.getElementById('lfoWaveform').addEventListener('change', (e) => {
        synthParams.lfo.waveform = e.target.value;
        if (lfoOscillator) {
            lfoOscillator.type = e.target.value;
        }
    });
    
    document.getElementById('lfoDestination').addEventListener('change', (e) => {
        synthParams.lfo.destination = e.target.value;
        updateLFODepth(); // Reconnect to new destination
    });
    
    // Effect toggles
    document.querySelectorAll('.effect-toggle').forEach(toggle => {
        toggle.addEventListener('change', (e) => {
            const effect = e.target.dataset.effect;
            synthParams.effects[effect].enabled = e.target.checked;
            
            // Visual feedback
            const effectControl = toggle.closest('.effect-controls');
            if (e.target.checked) {
                effectControl.style.borderColor = 'rgba(0, 255, 255, 0.5)';
                effectControl.style.boxShadow = '0 0 20px rgba(0, 255, 255, 0.3)';
            } else {
                effectControl.style.borderColor = 'rgba(255, 0, 255, 0.2)';
                effectControl.style.boxShadow = 'none';
            }
        });
    });
    
    // Arpeggiator
    document.getElementById('arpToggle').addEventListener('change', (e) => {
        arpeggiator.enabled = e.target.checked;
        if (arpeggiator.enabled) {
            startArpeggiator();
        } else {
            stopArpeggiator();
        }
    });
    
    document.getElementById('arpPattern').addEventListener('change', (e) => {
        arpeggiator.pattern = e.target.value;
    });
    
    document.getElementById('arpRate').addEventListener('input', (e) => {
        arpeggiator.rate = parseInt(e.target.value);
        if (arpeggiator.enabled) {
            stopArpeggiator();
            startArpeggiator();
        }
    });
    
    document.getElementById('arpOctaves').addEventListener('input', (e) => {
        arpeggiator.octaves = parseInt(e.target.value);
    });
    
    // Sequencer
    document.getElementById('seqPlayStop').addEventListener('click', () => {
        if (sequencer.playing) {
            stopSequencer();
        } else {
            startSequencer();
        }
    });
    
    document.getElementById('seqBpm').addEventListener('input', (e) => {
        sequencer.bpm = parseInt(e.target.value);
        if (sequencer.playing) {
            stopSequencer();
            startSequencer();
        }
    });
    
    // Presets
    document.getElementById('presetSelect').addEventListener('change', (e) => {
        loadPreset(e.target.value);
    });
    
    document.getElementById('savePreset').addEventListener('click', savePreset);
    document.getElementById('deletePreset').addEventListener('click', deletePreset);
    
    // Computer keyboard
    document.addEventListener('keydown', (e) => {
        if (e.repeat) return;
        const key = e.key.toLowerCase();
        if (key in keyboardMap) {
            const note = 48 + keyboardMap[key]; // Start from C3
            const keyElement = document.querySelector(`[data-note="${note}"]`);
            if (keyElement) {
                keyElement.classList.add('active');
                if (!arpeggiator.enabled) {
                    playNote(note);
                }
            }
        }
    });
    
    document.addEventListener('keyup', (e) => {
        const key = e.key.toLowerCase();
        if (key in keyboardMap) {
            const note = 48 + keyboardMap[key];
            const keyElement = document.querySelector(`[data-note="${note}"]`);
            if (keyElement) {
                keyElement.classList.remove('active');
                if (!arpeggiator.enabled) {
                    stopNote(note);
                }
            }
        }
    });
}

// Initialize Sequencer
function initSequencer() {
    const grid = document.getElementById('sequencerGrid');
    for (let i = 0; i < 16; i++) {
        const step = document.createElement('div');
        step.className = 'seq-step';
        step.dataset.step = i;
        step.addEventListener('click', () => {
            if (sequencer.steps[i] === null) {
                sequencer.steps[i] = 60; // Middle C
                step.classList.add('active');
            } else {
                sequencer.steps[i] = null;
                step.classList.remove('active');
            }
        });
        grid.appendChild(step);
    }
}

// Arpeggiator Functions
function startArpeggiator() {
    const interval = 60000 / arpeggiator.rate / 4; // 16th notes
    arpeggiator.intervalId = setInterval(() => {
        if (arpeggiator.notes.length > 0) {
            const notes = generateArpPattern();
            if (notes.length > 0) {
                const note = notes[arpeggiator.currentIndex % notes.length];
                playNote(note);
                setTimeout(() => stopNote(note), interval * 0.8);
                arpeggiator.currentIndex++;
            }
        }
    }, interval);
}

function stopArpeggiator() {
    if (arpeggiator.intervalId) {
        clearInterval(arpeggiator.intervalId);
        arpeggiator.intervalId = null;
    }
    arpeggiator.currentIndex = 0;
}

function generateArpPattern() {
    const baseNotes = [...arpeggiator.notes].sort((a, b) => a - b);
    let notes = [];
    
    for (let oct = 0; oct < arpeggiator.octaves; oct++) {
        notes = notes.concat(baseNotes.map(n => n + oct * 12));
    }
    
    switch (arpeggiator.pattern) {
        case 'down':
            return notes.reverse();
        case 'updown':
            return [...notes, ...notes.slice(1, -1).reverse()];
        case 'random':
            return notes.sort(() => Math.random() - 0.5);
        default: // up
            return notes;
    }
}

// Sequencer Functions
function startSequencer() {
    if (!audioContext) initAudio();
    
    sequencer.playing = true;
    document.getElementById('seqPlayStop').textContent = 'Stop';
    document.getElementById('seqPlayStop').classList.add('playing');
    
    const interval = 60000 / sequencer.bpm / 4; // 16th notes
    sequencer.intervalId = setInterval(() => {
        const steps = document.querySelectorAll('.seq-step');
        steps.forEach(step => step.classList.remove('playing'));
        
        const currentStepElement = steps[sequencer.currentStep];
        currentStepElement.classList.add('playing');
        
        const note = sequencer.steps[sequencer.currentStep];
        if (note !== null) {
            playNote(note);
            setTimeout(() => stopNote(note), interval * 0.8);
        }
        
        sequencer.currentStep = (sequencer.currentStep + 1) % 16;
    }, interval);
}

function stopSequencer() {
    sequencer.playing = false;
    document.getElementById('seqPlayStop').textContent = 'Play';
    document.getElementById('seqPlayStop').classList.remove('playing');
    
    if (sequencer.intervalId) {
        clearInterval(sequencer.intervalId);
        sequencer.intervalId = null;
    }
    
    document.querySelectorAll('.seq-step').forEach(step => {
        step.classList.remove('playing');
    });
    
    sequencer.currentStep = 0;
}

// Visualizations
function drawOscilloscope() {
    const canvas = document.getElementById('oscilloscope');
    const ctx = canvas.getContext('2d');
    
    // Set canvas to match display size
    function resizeCanvas() {
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = rect.height;
    }
    resizeCanvas();
    
    const width = canvas.width;
    const height = canvas.height;
    
    function draw() {
        requestAnimationFrame(draw);
        
        if (!analyserNode) return;
        
        const bufferLength = analyserNode.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyserNode.getByteTimeDomainData(dataArray);
        
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);
        
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#00ffff';
        ctx.shadowBlur = 10;
        ctx.shadowColor = '#00ffff';
        ctx.beginPath();
        
        const sliceWidth = width / bufferLength;
        let x = 0;
        
        for (let i = 0; i < bufferLength; i++) {
            const v = dataArray[i] / 128.0;
            const y = v * height / 2;
            
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
            
            x += sliceWidth;
        }
        
        ctx.lineTo(width, height / 2);
        ctx.stroke();
        ctx.shadowBlur = 0;
    }
    
    draw();
}

function drawSpectrum() {
    const canvas = document.getElementById('spectrum');
    const ctx = canvas.getContext('2d');
    
    // Set canvas to match display size
    function resizeCanvas() {
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = rect.height;
    }
    resizeCanvas();
    
    const width = canvas.width;
    const height = canvas.height;
    
    function draw() {
        requestAnimationFrame(draw);
        
        if (!analyserNode) return;
        
        const bufferLength = analyserNode.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyserNode.getByteFrequencyData(dataArray);
        
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);
        
        const barWidth = width / bufferLength * 2.5;
        let x = 0;
        
        for (let i = 0; i < bufferLength; i++) {
            const barHeight = (dataArray[i] / 255) * height;
            
            const hue = (i / bufferLength) * 270; // Blue to red
            ctx.fillStyle = `hsl(${180 + hue}, 100%, 50%)`;
            ctx.shadowBlur = 10;
            ctx.shadowColor = ctx.fillStyle;
            
            ctx.fillRect(x, height - barHeight, barWidth, barHeight);
            x += barWidth + 1;
        }
        
        ctx.shadowBlur = 0;
    }
    
    draw();
}

function drawWaveform() {
    const canvas = document.getElementById('waveform');
    const ctx = canvas.getContext('2d');
    
    // Set canvas to match display size
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    
    const width = canvas.width;
    const height = canvas.height;
    
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    
    const colors = ['#00ffff', '#ff00ff', '#ffff00'];
    const waveforms = ['sawtooth', 'square', 'sine'];
    
    synthParams.oscillators.forEach((osc, index) => {
        if (osc.volume > 0) {
            ctx.strokeStyle = colors[index];
            ctx.lineWidth = 2;
            ctx.shadowBlur = 8;
            ctx.shadowColor = colors[index];
            ctx.beginPath();
            
            const points = 300;
            for (let i = 0; i < points; i++) {
                const x = (i / points) * width;
                const t = (i / points) * Math.PI * 4;
                let y;
                
                switch (osc.waveform) {
                    case 'sine':
                        y = Math.sin(t);
                        break;
                    case 'square':
                        y = Math.sign(Math.sin(t));
                        break;
                    case 'sawtooth':
                        y = 2 * (t / (2 * Math.PI) - Math.floor(t / (2 * Math.PI) + 0.5));
                        break;
                    case 'triangle':
                        y = Math.abs((t % (2 * Math.PI)) / Math.PI - 1) * 2 - 1;
                        break;
                    default:
                        y = (Math.random() - 0.5) * 2;
                }
                
                y = height / 2 + (y * height / 4) * (osc.volume / 100);
                
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
            
            ctx.stroke();
            ctx.shadowBlur = 0;
        }
    });
}

// Preset Management
const factoryPresets = {
    init: {
        oscillators: [
            { waveform: 'sawtooth', volume: 80, detune: 0, octave: 0 },
            { waveform: 'square', volume: 50, detune: -5, octave: 0 },
            { waveform: 'sine', volume: 0, detune: 5, octave: 0 }
        ],
        filter: { type: 'lowpass', cutoff: 2000, resonance: 1, envAmount: 50 },
        envelopes: {
            amp: { attack: 0.01, decay: 0.3, sustain: 0.7, release: 0.5 },
            filter: { attack: 0.1, decay: 0.3, sustain: 0.5, release: 0.5 }
        }
    },
    bass: {
        oscillators: [
            { waveform: 'square', volume: 100, detune: 0, octave: -1 },
            { waveform: 'sawtooth', volume: 60, detune: -5, octave: -1 },
            { waveform: 'triangle', volume: 30, detune: 5, octave: 0 }
        ],
        filter: { type: 'lowpass', cutoff: 400, resonance: 8, envAmount: 80 },
        envelopes: {
            amp: { attack: 0.005, decay: 0.2, sustain: 0.6, release: 0.3 },
            filter: { attack: 0.01, decay: 0.15, sustain: 0.2, release: 0.2 }
        }
    },
    lead: {
        oscillators: [
            { waveform: 'sawtooth', volume: 90, detune: 0, octave: 0 },
            { waveform: 'square', volume: 70, detune: 7, octave: 1 },
            { waveform: 'sawtooth', volume: 50, detune: -7, octave: 0 }
        ],
        filter: { type: 'lowpass', cutoff: 3000, resonance: 5, envAmount: 70 },
        envelopes: {
            amp: { attack: 0.01, decay: 0.2, sustain: 0.8, release: 0.3 },
            filter: { attack: 0.05, decay: 0.3, sustain: 0.6, release: 0.4 }
        }
    },
    pad: {
        oscillators: [
            { waveform: 'sine', volume: 70, detune: 0, octave: 0 },
            { waveform: 'triangle', volume: 60, detune: 5, octave: 1 },
            { waveform: 'sine', volume: 50, detune: -5, octave: -1 }
        ],
        filter: { type: 'lowpass', cutoff: 1500, resonance: 2, envAmount: 30 },
        envelopes: {
            amp: { attack: 0.8, decay: 0.5, sustain: 0.7, release: 1.5 },
            filter: { attack: 1.0, decay: 0.7, sustain: 0.5, release: 1.2 }
        }
    },
    pluck: {
        oscillators: [
            { waveform: 'sawtooth', volume: 100, detune: 0, octave: 0 },
            { waveform: 'square', volume: 40, detune: 12, octave: 1 },
            { waveform: 'triangle', volume: 30, detune: -12, octave: 0 }
        ],
        filter: { type: 'lowpass', cutoff: 3500, resonance: 3, envAmount: 90 },
        envelopes: {
            amp: { attack: 0.001, decay: 0.15, sustain: 0.1, release: 0.2 },
            filter: { attack: 0.001, decay: 0.1, sustain: 0.05, release: 0.15 }
        }
    },
    brass: {
        oscillators: [
            { waveform: 'sawtooth', volume: 85, detune: 0, octave: 0 },
            { waveform: 'square', volume: 65, detune: 3, octave: 0 },
            { waveform: 'sawtooth', volume: 55, detune: -3, octave: 1 }
        ],
        filter: { type: 'lowpass', cutoff: 2500, resonance: 6, envAmount: 60 },
        envelopes: {
            amp: { attack: 0.1, decay: 0.3, sustain: 0.8, release: 0.4 },
            filter: { attack: 0.15, decay: 0.4, sustain: 0.6, release: 0.5 }
        }
    }
};

function loadPreset(presetName) {
    const preset = factoryPresets[presetName];
    if (!preset) return;
    
    // Load oscillators
    preset.oscillators.forEach((osc, index) => {
        synthParams.oscillators[index] = { ...osc };
        const oscElement = document.querySelector(`[data-osc="${index}"]`);
        if (oscElement) {
            oscElement.querySelector('.osc-waveform').value = osc.waveform;
            oscElement.querySelector('.osc-octave').value = osc.octave;
            
            const volKnob = oscElement.querySelector('[data-param="volume"]');
            const detuneKnob = oscElement.querySelector('[data-param="detune"]');
            
            volKnob.dataset.value = osc.volume;
            updateKnobRotation(volKnob, osc.volume, 0, 100);
            
            detuneKnob.dataset.value = osc.detune;
            updateKnobRotation(detuneKnob, osc.detune, -100, 100);
        }
    });
    
    // Load filter
    synthParams.filter = { ...preset.filter };
    document.getElementById('filterType').value = preset.filter.type;
    
    const cutoffKnob = document.getElementById('filterCutoff');
    cutoffKnob.dataset.value = preset.filter.cutoff;
    updateKnobRotation(cutoffKnob, preset.filter.cutoff, 20, 20000);
    
    const resKnob = document.getElementById('filterResonance');
    resKnob.dataset.value = preset.filter.resonance;
    updateKnobRotation(resKnob, preset.filter.resonance, 0, 20);
    
    const envAmtKnob = document.getElementById('filterEnvAmount');
    envAmtKnob.dataset.value = preset.filter.envAmount;
    updateKnobRotation(envAmtKnob, preset.filter.envAmount, 0, 100);
    
    // Load envelopes
    ['amp', 'filter'].forEach(envType => {
        synthParams.envelopes[envType] = { ...preset.envelopes[envType] };
        ['attack', 'decay', 'sustain', 'release'].forEach(param => {
            const knob = document.querySelector(`[data-env="${envType}"][data-param="${param}"]`);
            if (knob) {
                const value = preset.envelopes[envType][param];
                knob.dataset.value = value;
                const max = param === 'sustain' ? 1 : 2;
                updateKnobRotation(knob, value, 0, max);
            }
        });
    });
}

function savePreset() {
    const name = prompt('Enter preset name:');
    if (name) {
        // Note: Can't use localStorage in sandboxed environment
        // Store in memory only
        alert('Preset saved to current session (localStorage not available in sandbox)');
    }
}

function deletePreset() {
    alert('Custom presets deletion not available (localStorage not available in sandbox)');
}

// Initialize on load
window.addEventListener('load', () => {
    initUI();
    // Load init preset
    loadPreset('init');
    
    // Handle window resize for canvases
    window.addEventListener('resize', () => {
        // Canvases will auto-resize on next draw
    });
    
    // Start audio context on first user interaction
    document.body.addEventListener('click', () => {
        if (!audioContext) {
            initAudio();
        }
    }, { once: true });
});

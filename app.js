// AuroraWave editor using Web Audio API. [web:18]
let audioCtx;
let audioBuffer = null;
let sourceNode = null;
let gainNode;
let filterNode = null;
let startTime = 0;
let pauseOffset = 0;
let isPlaying = false;
let loopEnabled = false;
let selection = { start: null, end: null };
let zoom = 1;

const canvas = document.getElementById("waveform-canvas");
const playhead = document.getElementById("playhead");
const selectionOverlay = document.getElementById("selection-overlay");

const currentTimeEl = document.getElementById("current-time");
const totalTimeEl = document.getElementById("total-time");
const selStartEl = document.getElementById("sel-start");
const selEndEl = document.getElementById("sel-end");
const selDurationEl = document.getElementById("sel-duration");
const exportBtn = document.getElementById("btn-export");
const trimBtn = document.getElementById("btn-trim");
const loopBtn = document.getElementById("btn-loop");

const fileInput = document.getElementById("file-input");
const zoomRange = document.getElementById("zoom-range");
const volumeRange = document.getElementById("volume-range");
const speedRange = document.getElementById("speed-range");
const filterTypeEl = document.getElementById("filter-type");
const filterFreqEl = document.getElementById("filter-frequency");
const filterQEl = document.getElementById("filter-q");

const btnPlay = document.getElementById("btn-play");
const btnPause = document.getElementById("btn-pause");
const btnStop = document.getElementById("btn-stop");
const btnRewind = document.getElementById("btn-rewind");
const btnForward = document.getElementById("btn-forward");

document.getElementById("year").textContent = new Date().getFullYear();
document
	.getElementById("open-editor-btn")
	.addEventListener("click", () =>
		document.getElementById("editor").scrollIntoView({ behavior: "smooth" })
	);

function initAudioCtx() {
	if (!audioCtx) {
		audioCtx = new (window.AudioContext || window.webkitAudioContext)();
		gainNode = audioCtx.createGain();
		gainNode.connect(audioCtx.destination);
	}
}

// Load file
fileInput.addEventListener("change", async (e) => {
	const file = e.target.files[0];
	if (!file) return;
	initAudioCtx();
	const arrBuf = await file.arrayBuffer();
	audioBuffer = await audioCtx.decodeAudioData(arrBuf);
	pauseOffset = 0;
	isPlaying = false;
	selection = { start: null, end: null };
	zoom = 1;
	zoomRange.value = 1;
	redrawWaveform();
	updateSelectionText();
	updateTimes();
	exportBtn.disabled = false;
	trimBtn.disabled = false;
});

// Build graph
function createSource() {
	if (!audioBuffer || !audioCtx) return null;
	const source = audioCtx.createBufferSource();
	source.buffer = audioBuffer;
	source.playbackRate.value = parseFloat(speedRange.value);

	let chainHead = source;
	const type = filterTypeEl.value;
	if (type !== "none") {
		filterNode = audioCtx.createBiquadFilter();
		filterNode.type = type;
		filterNode.frequency.value = parseFloat(filterFreqEl.value);
		filterNode.Q.value = parseFloat(filterQEl.value);
		chainHead.connect(filterNode);
		chainHead = filterNode;
	}

	chainHead.connect(gainNode);
	source.onended = handleEnded;
	return source;
}

function handleEnded() {
	if (!isPlaying) return;
	const endT = selectionIsValid() ? selection.end : audioBuffer.duration;
	if (loopEnabled && getCurrentTime() >= endT - 0.01) {
		seek(selectionIsValid() ? selection.start : 0);
		play();
	} else {
		isPlaying = false;
		pauseOffset = endT;
	}
}

// Controls
btnPlay.addEventListener("click", play);
btnPause.addEventListener("click", pause);
btnStop.addEventListener("click", stop);
btnRewind.addEventListener("click", () => seek(getCurrentTime() - 1));
btnForward.addEventListener("click", () => seek(getCurrentTime() + 1));

loopBtn.addEventListener("click", () => {
	loopEnabled = !loopEnabled;
	loopBtn.textContent = loopEnabled ? "Loop: On" : "Loop: Off";
	loopBtn.style.color = loopEnabled ? "#00e5ff" : "";
});

function play() {
	if (!audioBuffer) return;
	if (isPlaying) return;
	const src = createSource();
	if (!src) return;
	sourceNode = src;

	let startAt = pauseOffset;
	if (selectionIsValid() && pauseOffset < selection.start) {
		startAt = selection.start;
		pauseOffset = startAt;
	}

	startTime = audioCtx.currentTime - startAt;
	if (selectionIsValid()) {
		const dur = selection.end - startAt;
		sourceNode.start(0, startAt, dur);
	} else {
		sourceNode.start(0, startAt);
	}
	isPlaying = true;
}

function pause() {
	if (!sourceNode || !isPlaying) return;
	sourceNode.stop();
	pauseOffset = getCurrentTime();
	isPlaying = false;
}

function stop() {
	if (sourceNode) sourceNode.stop();
	isPlaying = false;
	pauseOffset = selectionIsValid() ? selection.start : 0;
}

function getCurrentTime() {
	if (!audioCtx || !audioBuffer) return 0;
	if (!isPlaying) return pauseOffset;
	const rate = parseFloat(speedRange.value);
	return (audioCtx.currentTime - startTime) * rate;
}

function seek(t) {
	if (!audioBuffer) return;
	const clamped = Math.max(0, Math.min(audioBuffer.duration, t));
	pauseOffset = clamped;
	if (isPlaying) {
		stop();
		play();
	} else {
		updateTimes();
		redrawSelectionOverlay();
	}
}

// Volume / speed / filter
volumeRange.addEventListener("input", () => {
	if (gainNode) gainNode.gain.value = parseFloat(volumeRange.value);
});

speedRange.addEventListener("input", () => {
	if (!audioBuffer) return;
	if (isPlaying) {
		const t = getCurrentTime();
		stop();
		pauseOffset = t;
		play();
	}
});

filterTypeEl.addEventListener("change", () => {
	if (isPlaying) {
		const t = getCurrentTime();
		stop();
		pauseOffset = t;
		play();
	}
});

[filterFreqEl, filterQEl].forEach((el) =>
	el.addEventListener("input", () => {
		if (filterNode) {
			filterNode.frequency.value = parseFloat(filterFreqEl.value);
			filterNode.Q.value = parseFloat(filterQEl.value);
		}
	})
);

// Zoom
zoomRange.addEventListener("input", () => {
	zoom = parseFloat(zoomRange.value);
	redrawWaveform();
	redrawSelectionOverlay();
});

// Canvas drawing
function resizeCanvas() {
	const rect = canvas.getBoundingClientRect();
	canvas.width = rect.width;
	canvas.height = rect.height;
}

window.addEventListener("resize", () => {
	resizeCanvas();
	redrawWaveform();
	redrawSelectionOverlay();
});

function redrawWaveform() {
	resizeCanvas();
	const ctx = canvas.getContext("2d");
	ctx.fillStyle = "#02040a";
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	if (!audioBuffer) return;

	const data = audioBuffer.getChannelData(0);
	const width = canvas.width;
	const height = canvas.height;
	const mid = height / 2;

	const totalSamples = data.length;
	const samplesPerPixel = Math.max(1, Math.floor((totalSamples / zoom) / width));

	ctx.strokeStyle = "#4fc3f7";
	ctx.lineWidth = 1;
	ctx.beginPath();

	let x = 0;
	const amp = (height / 2) * 0.9;
	for (let i = 0; i < totalSamples; i += samplesPerPixel) {
		const slice = data.subarray(i, i + samplesPerPixel);
		let min = 1;
		let max = -1;
		for (let v of slice) {
			if (v < min) min = v;
			if (v > max) max = v;
		}
		const y1 = mid + min * amp;
		const y2 = mid + max * amp;
		ctx.moveTo(x, y1);
		ctx.lineTo(x, y2);
		x++;
		if (x > width) break;
	}
	ctx.stroke();
}

// Selection on canvas
let isMouseDown = false;

canvas.addEventListener("mousedown", (e) => {
	if (!audioBuffer) return;
	isMouseDown = true;
	const x = e.offsetX;
	const t = xToTime(x);
	selection.start = t;
	selection.end = t;
	redrawSelectionOverlay();
	updateSelectionText();
});

canvas.addEventListener("mousemove", (e) => {
	if (!isMouseDown || !audioBuffer) return;
	selection.end = xToTime(e.offsetX);
	redrawSelectionOverlay();
	updateSelectionText();
});

window.addEventListener("mouseup", () => {
	isMouseDown = false;
});

canvas.addEventListener("dblclick", () => {
	selection = { start: null, end: null };
	redrawSelectionOverlay();
	updateSelectionText();
});

canvas.addEventListener("click", (e) => {
	if (!audioBuffer) return;
	if (!isMouseDown) {
		const t = xToTime(e.offsetX);
		seek(t);
	}
});

function xToTime(x) {
	if (!audioBuffer) return 0;
	const width = canvas.getBoundingClientRect().width;
	const visibleDuration = audioBuffer.duration / zoom;
	const centerPos = getCurrentTime();
	const startVisible = Math.max(0, centerPos - visibleDuration / 2);
	const clampedX = Math.max(0, Math.min(width, x));
	return startVisible + (clampedX / width) * visibleDuration;
}

function selectionIsValid() {
	return (
		selection.start != null &&
		selection.end != null &&
		selection.end !== selection.start
	);
}

function redrawSelectionOverlay() {
	const rect = canvas.getBoundingClientRect();
	selectionOverlay.innerHTML = "";
	if (!audioBuffer || !selectionIsValid()) return;

	const width = rect.width;
	const visibleDuration = audioBuffer.duration / zoom;
	const centerPos = getCurrentTime();
	const startVisible = Math.max(0, centerPos - visibleDuration / 2);

	const a = Math.min(selection.start, selection.end);
	const b = Math.max(selection.start, selection.end);

	const startRatio = (a - startVisible) / visibleDuration;
	const endRatio = (b - startVisible) / visibleDuration;

	const left = Math.max(0, startRatio * width);
	const right = Math.min(width, endRatio * width);
	if (right <= 0 || left >= width) return;

	const span = document.createElement("div");
	span.style.position = "absolute";
	span.style.top = "0";
	span.style.bottom = "0";
	span.style.left = `${left}px`;
	span.style.width = `${right - left}px`;
	span.style.background = "rgba(79,195,247,0.18)";
	span.style.borderLeft = "1px solid rgba(79,195,247,0.7)";
	span.style.borderRight = "1px solid rgba(79,195,247,0.7)";
	selectionOverlay.appendChild(span);
}

function updateSelectionText() {
	if (!selectionIsValid()) {
		selStartEl.textContent = "--:--:---";
		selEndEl.textContent = "--:--:---";
		selDurationEl.textContent = "--:--:---";
		return;
	}
	const a = Math.min(selection.start, selection.end);
	const b = Math.max(selection.start, selection.end);
	selStartEl.textContent = formatTime(a);
	selEndEl.textContent = formatTime(b);
	selDurationEl.textContent = formatTime(b - a);
}

// Trim to selection
trimBtn.addEventListener("click", () => {
	if (!audioBuffer || !selectionIsValid()) return;

	const a = Math.min(selection.start, selection.end);
	const b = Math.max(selection.start, selection.end);
	const sr = audioBuffer.sampleRate;
	const startSample = Math.floor(a * sr);
	const endSample = Math.floor(b * sr);
	const length = endSample - startSample;

	const newBuffer = audioCtx.createBuffer(
		audioBuffer.numberOfChannels,
		length,
		sr
	);

	for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
		const oldData = audioBuffer.getChannelData(ch);
		const newData = newBuffer.getChannelData(ch);
		for (let i = 0; i < length; i++) {
			newData[i] = oldData[startSample + i];
		}
	}

	audioBuffer = newBuffer;
	pauseOffset = 0;
	selection = { start: null, end: null };
	redrawWaveform();
	redrawSelectionOverlay();
	updateSelectionText();
	updateTimes();
});

// Export selection / full buffer to WAV offline. [web:22]
exportBtn.addEventListener("click", async () => {
	if (!audioBuffer) return;

	let buf = audioBuffer;
	if (selectionIsValid()) {
		const a = Math.min(selection.start, selection.end);
		const b = Math.max(selection.start, selection.end);
		const sr = audioBuffer.sampleRate;
		const startSample = Math.floor(a * sr);
		const endSample = Math.floor(b * sr);
		const length = endSample - startSample;

		const trimmed = audioCtx.createBuffer(audioBuffer.numberOfChannels, length, sr);
		for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
			trimmed
				.getChannelData(ch)
				.set(audioBuffer.getChannelData(ch).subarray(startSample, endSample));
		}
		buf = trimmed;
	}

	const offline = new OfflineAudioContext(
		buf.numberOfChannels,
		buf.length,
		buf.sampleRate
	);
	const src = offline.createBufferSource();
	src.buffer = buf;
	src.connect(offline.destination);
	src.start(0);

	const rendered = await offline.startRendering();
	const wavData = audioBufferToWav(rendered);
	const blob = new Blob([wavData], { type: "audio/wav" });
	const url = URL.createObjectURL(blob);

	const a = document.createElement("a");
	a.href = url;
	a.download = "aurora-export.wav";
	a.click();
	URL.revokeObjectURL(url);
});

// WAV encoder
function audioBufferToWav(buffer) {
	const numOfChan = buffer.numberOfChannels;
	const sampleRate = buffer.sampleRate;
	const length = buffer.length * numOfChan * 2 + 44;
	const out = new ArrayBuffer(length);
	const view = new DataView(out);

	writeString(view, 0, "RIFF");
	view.setUint32(4, 36 + buffer.length * numOfChan * 2, true);
	writeString(view, 8, "WAVE");
	writeString(view, 12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, numOfChan, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * numOfChan * 2, true);
	view.setUint16(32, numOfChan * 2, true);
	view.setUint16(34, 16, true);
	writeString(view, 36, "data");
	view.setUint32(40, buffer.length * numOfChan * 2, true);

	let offset = 44;
	for (let i = 0; i < buffer.length; i++) {
		for (let ch = 0; ch < numOfChan; ch++) {
			let sample = buffer.getChannelData(ch)[i];
			sample = Math.max(-1, Math.min(1, sample));
			view.setInt16(
				offset,
				sample < 0 ? sample * 0x8000 : sample * 0x7fff,
				true
			);
			offset += 2;
		}
	}
	return out;

	function writeString(dv, offset, str) {
		for (let i = 0; i < str.length; i++) {
			dv.setUint8(offset + i, str.charCodeAt(i));
		}
	}
}

// Time + playhead
function formatTime(seconds) {
	if (!isFinite(seconds) || seconds < 0) seconds = 0;
	const ms = Math.floor((seconds % 1) * 1000);
	const s = Math.floor(seconds) % 60;
	const m = Math.floor(seconds / 60);
	return (
		String(m).padStart(2, "0") +
		":" +
		String(s).padStart(2, "0") +
		":" +
		String(ms).padStart(3, "0")
	);
}

function updateTimes() {
	if (!audioBuffer) {
		currentTimeEl.textContent = "00:00:000";
		totalTimeEl.textContent = "00:00:000";
		playhead.style.left = "0px";
	} else {
		const t = getCurrentTime();
		currentTimeEl.textContent = formatTime(t);
		totalTimeEl.textContent = formatTime(audioBuffer.duration);

		const rect = canvas.getBoundingClientRect();
		const width = rect.width;
		const visibleDuration = audioBuffer.duration / zoom;
		const centerPos = t;
		const startVisible = Math.max(0, centerPos - visibleDuration / 2);
		const ratio = (t - startVisible) / visibleDuration;
		playhead.style.left = Math.max(0, Math.min(1, ratio)) * width + "px";
	}
	requestAnimationFrame(updateTimes);
}
requestAnimationFrame(updateTimes);

// Keyboard shortcuts
window.addEventListener("keydown", (e) => {
	if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
	if (e.code === "Space") {
		e.preventDefault();
		if (isPlaying) pause();
		else play();
	} else if (e.code === "ArrowLeft") {
		seek(getCurrentTime() - 1);
	} else if (e.code === "ArrowRight") {
		seek(getCurrentTime() + 1);
	}
});

// EmailJS integration for contact + feedback. [web:33][web:42]
const CONTACT_SERVICE_ID = "service_rl9b0qf";       // TODO
const CONTACT_TEMPLATE_ID = "template_dodriwh"; // TODO
const FEEDBACK_TEMPLATE_ID = "template_pes14h6"; // TODO

document.getElementById("contact-form").addEventListener("submit", (e) => {
	e.preventDefault();
	emailjs
		.sendForm(CONTACT_SERVICE_ID, CONTACT_TEMPLATE_ID, e.target)
		.then(() => {
			alert("Thanks, your message was sent!");
			e.target.reset();
		})
		.catch((err) => {
			console.error(err);
			alert("Sorry, sending failed. Please try again later.");
		});
});

document.getElementById("feedback-form").addEventListener("submit", (e) => {
	e.preventDefault();
	emailjs
		.sendForm(CONTACT_SERVICE_ID, FEEDBACK_TEMPLATE_ID, e.target)
		.then(() => {
			alert("Thanks for your feedback!");
			e.target.reset();
		})
		.catch((err) => {
			console.error(err);
			alert("Sorry, feedback sending failed. Please try again later.");
		});
});

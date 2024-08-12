const codecSelect = document.getElementById('codecSelectId');
const sourceSelect = document.getElementById('sourceId');
const roleSelect = document.getElementById('roleSelectId');
const contentHintSelect = document.getElementById('contentHintId');
const offerInput = document.getElementById('offerInputId');
const answerInput = document.getElementById('answerInputId');

const statusParagraph = document.getElementById('statusParagraphId');

const s_minfps = document.getElementById('s_minfpsid');
const s_maxfps = document.getElementById('s_maxfpsid');

const encodingsTable = document.getElementById('encodingsTableId');
const e0_maxfps = document.getElementById('e0_maxfpsid');
const e0_scalabilityMode = document.getElementById('e0_scalabilityModeId');
const e0_scaleResolutionDownBy = document.getElementById('e0_scaleResolutionDownById');
const e0_maxBitrate = document.getElementById('e0_maxBitrateId');
const e0_active = document.getElementById('e0_activeId');
const e1_maxfps = document.getElementById('e1_maxfpsid');
const e1_scalabilityMode = document.getElementById('e1_scalabilityModeId');
const e1_scaleResolutionDownBy = document.getElementById('e1_scaleResolutionDownById');
const e1_maxBitrate = document.getElementById('e1_maxBitrateId');
const e1_active = document.getElementById('e1_activeId');
const e2_maxfps = document.getElementById('e2_maxfpsid');
const e2_scalabilityMode = document.getElementById('e2_scalabilityModeId');
const e2_scaleResolutionDownBy = document.getElementById('e2_scaleResolutionDownById');
const e2_maxBitrate = document.getElementById('e2_maxBitrateId');
const e2_active = document.getElementById('e2_activeId');
const encodings_scalabilityMode = [
  e0_scalabilityMode, e1_scalabilityMode, e2_scalabilityMode
];
const encodings_scaleResolutionDownBy = [
  e0_scaleResolutionDownBy, e1_scaleResolutionDownBy, e2_scaleResolutionDownBy
];
const encodings_active = [
  e0_active, e1_active, e2_active
];
const encodings_maxBitrate = [
  e0_maxBitrate, e1_maxBitrate, e2_maxBitrate
];
const encodings_maxfps = [
  e0_maxfps, e1_maxfps, e2_maxfps
];
const encodingStatusParagraph = document.getElementById('encodingStatusParagraphId');

const recvVideo0 = document.getElementById('recvVideo0Id');
const recvVideo1 = document.getElementById('recvVideo1Id');
const recvVideo2 = document.getElementById('recvVideo2Id');
const recvVideos = [recvVideo0, recvVideo1, recvVideo2];
const recvVideoParagraph0 = document.getElementById('recvVideoParagraph0Id');
const recvVideoParagraph1 = document.getElementById('recvVideoParagraph1Id');
const recvVideoParagraph2 = document.getElementById('recvVideoParagraph2Id');
const recvVideoParagraphs =
    [recvVideoParagraph0, recvVideoParagraph1, recvVideoParagraph2];

let pc1 = null;
let pc2 = null;
let track = null;
const pc1PrevStatsReport = new Map();
const pc2PrevStatsReport = new Map();

function configScreenshare() {
  s_maxfps.value = s_minfps.value = 30;
  e0_scalabilityMode.value = e1_scalabilityMode.value = "L1T2";
  e0_active.value = e1_active.value = true;
  e2_active.value = false;
  e0_scaleResolutionDownBy.value = e1_scaleResolutionDownBy.value = 1;
  e1_maxfps.value = 30;
  e0_maxfps.value = 5;
  e1_maxBitrate.value = 2500;
  e0_maxBitrate.value = 420;
  sourceSelect.value = "gdm";
  contentHintSelect.value = "detail";
}

function onConfigAV1Screenshare3030() {
  configScreenshare();
  codecSelect.value = "AV1";
}

function onConfigVP8Screenshare3030() {
  configScreenshare();
  codecSelect.value = "VP8";
}

function onStop() {
  if (pc1) {
    pc1.close();
    pc1 = null;
  }
  if (pc2) {
    pc2.close();
    pc2 = null;
  }
  pc1PrevStatsReport.clear();
  pc2PrevStatsReport.clear();
  if (track) {
    track.stop();
    track = null;
  }
  codecSelect.disabled = false;
  roleSelect.disabled = false;
  offerInput.onchange = null;
  offerInput.value = '';
  offerInput.disabled = true;
  answerInput.value = '';
  answerInput.disabled = true;
  statusParagraph.innerText = '';
  encodingsTable.className = '';
  for (let i = 0; i < recvVideos.length; ++i) {
    recvVideos[i].srcObject = null;
    recvVideoParagraphs[i].innerText = '';
  }
  clearHighlighting();
}

async function getStream() {
  const role = sourceSelect.options[sourceSelect.selectedIndex].value;
  if (role === "gum") {
    return navigator.mediaDevices.getUserMedia({video:{
      width:1280, height:720
    }});
  } else {
    return navigator.mediaDevices.getDisplayMedia({video: true});
  }
}

async function applyConstraints(track) {
  let framerateConstraints = {};
  const maxfps = parseFloat(s_maxfps.value);
  if (!isNaN(maxfps) && typeof maxfps === 'number') {
    framerateConstraints.max = maxfps;
  }
  const minfps = parseFloat(s_minfps.value);
  if (!isNaN(minfps) && typeof minfps === 'number') {
    framerateConstraints.min = minfps;
  }
  if (Object.keys(framerateConstraints).length !== 0) {
    await track.applyConstraints({frameRate: framerateConstraints});
  }
}

async function onStart(doStop = true) {
  if (doStop) {
    onStop();
  }

  // The role is one of the following:
  // - "loopback": The page contains both `pc1` and `pc2`, O/A is automatic.
  // - "sender": The page only contains `pc1`, O/A is done via copy-pasting.
  // - "receiver": The page only contains `pc2`, O/A is done via copy-pasting.
  const role = roleSelect.options[roleSelect.selectedIndex].value;
  let encodedOffer = null;
  let encodedAnswer = null;

  roleSelect.disabled = true;
  if (role != 'loopback') {
    codecSelect.disabled = true;
  }
  if (role == 'sender') {
    answerInput.disabled = false;
  }
  if (role == 'receiver') {
    offerInput.disabled = false;
    encodingsTable.className = 'hide';
  }

  // Create sender and SDP offer.
  if (pc1 == null && (role == 'loopback' || role == 'sender')) {
    pc1 = new RTCPeerConnection();
    const pc1GatheringComplete = new Promise(
        resolve => pc1.onicegatheringstatechange = () => {
          if (pc1.iceGatheringState == 'complete') {
            resolve();
          }
        });

    const stream = await getStream();
    track = stream.getTracks()[0];
    await applyConstraints(track);
    if (contentHintSelect.value !== "") {
      track.contentHint = contentHintSelect.value;
    }
    const transceiver =
        pc1.addTransceiver(track, {sendEncodings:getEncodingsFromHtml()});
    preferCodec(transceiver,
                codecSelect.options[codecSelect.selectedIndex].value);

    // Complete `pc1` ICE gathering and get final offer.
    await pc1.setLocalDescription();
    await pc1GatheringComplete;
    await pc1.setLocalDescription();  // Now the offer contains a=candidates.

    // Base64 encode the offer for easier copy-pasting.
    encodedOffer = btoa(pc1.localDescription.sdp);
    offerInput.value = encodedOffer;

    if (role == 'sender') {
      answerInput.onchange = () => onStart(/*doStop=*/false);
      statusParagraph.innerText =
          'Pass Base64 Offer to receiver tab and then enter the Base64 ' +
          'Answer to continue...';
      return;
    }
  }

  // Create receiver and SDP answer.
  if (role == 'loopback' || role == 'receiver') {
    if (role == 'receiver') {
      if (offerInput.value.length == 0) {
        offerInput.onchange = () => onStart(/*doStop=*/false);
        statusParagraph.innerText = 'Enter Base64 Offer to continue...';
        return;
      }
      encodedOffer = offerInput.value;
    }
    offerInput.onchange = null;
    offerInput.disabled = true;
    statusParagraph.innerText = 'Creating answer...';
    const offer = {type:'offer', sdp:atob(encodedOffer)};

    pc2 = new RTCPeerConnection();
    const pc2GatheringComplete = new Promise(
        resolve => pc2.onicegatheringstatechange = () => {
          if (pc2.iceGatheringState == 'complete') {
            resolve();
          }
        });
    pc2.ontrack = e => {
      const recvVideo = recvVideos[e.transceiver.mid];
      recvVideo.srcObject = new MediaStream();
      recvVideo.srcObject.addTrack(e.track);
    };

    // Complete `pc2` ICE gathering and get final answer.
    await negotiateWithSimulcastTweaks(null, pc2, offer);
    await pc2GatheringComplete;
    // Now the answer contains the a=candidate lines.
    const answer = await negotiateWithSimulcastTweaks(null, pc2, offer);
    // To/from base64.
    encodedAnswer = btoa(answer.sdp);
    answerInput.value = encodedAnswer;
    if (role == 'receiver') {
      statusParagraph.innerText = 'Pass the Base64 Answer to the sender tab...';
    }
  }

  // The final step: Set remote answer on sender.
  if (pc1 != null) {
    if (role == 'sender') {
      encodedAnswer = answerInput.value;
      answerInput.disabled = true;
    }
    const answer = {type:'answer', sdp:atob(encodedAnswer)};
    await pc1.setRemoteDescription(answer);
    // Workaround to browser bug: if we negotiate kSVC or S-modes, we have to
    // setParameters() again or else it does fallback to L1T3 so we end up with
    // 1:1:1 L1T3 so the "lowest" layer has trouble keeping up at 720p.
    onEncodingsChanged();
  }
}

async function renegotiate() {
  if (pc1 == null || pc2 == null) {
    return;
  }
  let transceiver = null;
  for (const t of pc1.getTransceivers()) {
    if (t.receiver.track.kind == 'video') {
      transceiver = t;
      break;
    }
  }
  preferCodec(transceiver,
              codecSelect.options[codecSelect.selectedIndex].value);
  await negotiateWithSimulcastTweaks(pc1, pc2);
  pc1PrevStatsReport.clear();
  pc2PrevStatsReport.clear();
}

function setValueAndMaybeHighlight(element, value) {
  if (element.value != value) {
    element.classList.add('highlightColor');
  }
  element.value = value;
}
function clearHighlighting() {
  for (const elements of
       [encodings_scalabilityMode, encodings_scaleResolutionDownBy,
        encodings_maxBitrate, encodings_active]) {
    for (const element of elements) {
      element.classList.remove('highlightColor');
    }
  }
}

async function onEncodingsChanged(optionsStr) {
  clearHighlighting();
  if (optionsStr == 'triggerPresets') {
    const scalabilityMode = e0_scalabilityMode.value;
    e0_scalabilityMode.classList.add('highlightColor');
    setValueAndMaybeHighlight(e1_scalabilityMode, scalabilityMode);
    setValueAndMaybeHighlight(e2_scalabilityMode, scalabilityMode);
    if (scalabilityMode.startsWith('S') || scalabilityMode.endsWith('_KEY')) {
      // S-modes or kSVC
      if (scalabilityMode[1] != '2') {
        // Full-scale (S3Ty or L3Ty_KEY).
        setValueAndMaybeHighlight(e0_scaleResolutionDownBy, '1');
      } else {
        // Half-scale (S2Ty or L2Ty_KEY).
        setValueAndMaybeHighlight(e0_scaleResolutionDownBy, '2');
      }
      setValueAndMaybeHighlight(e0_active, 'true');
      setValueAndMaybeHighlight(e1_scaleResolutionDownBy, '');
      setValueAndMaybeHighlight(e1_active, 'false');
      setValueAndMaybeHighlight(e2_scaleResolutionDownBy, '');
      setValueAndMaybeHighlight(e2_active, 'false');
    } else {
      setValueAndMaybeHighlight(e0_scaleResolutionDownBy, '4');
      setValueAndMaybeHighlight(e0_active, 'true');
      setValueAndMaybeHighlight(e1_scaleResolutionDownBy, '2');
      setValueAndMaybeHighlight(e1_active, 'true');
      setValueAndMaybeHighlight(e2_scaleResolutionDownBy, '1');
      setValueAndMaybeHighlight(e2_active, 'true');
    }
  }
  if (pc1 == null) {
    return;
  }
  const sender = pc1.getSenders()[0];
  const params = sender.getParameters();
  const newEncodings =
      getEncodingsFromHtml(/*deleteUndefined=*/false);
  for (let i = 0; i < 3; ++i) {
    for (let attribute in newEncodings[i]) {
      params.encodings[i][attribute] = newEncodings[i][attribute];
    }
  }
  encodingStatusParagraph.className = '';
  encodingStatusParagraph.innerText = 'Setting parameters...';
  try {
    await sender.setParameters(params);
    encodingStatusParagraph.innerText = '';
  } catch (e) {
    encodingStatusParagraph.className = 'highlightColor';
    encodingStatusParagraph.innerText = e.message;
  }
}

function getEncodingsFromHtml(deleteUndefined = true) {
  const encodings = [];
  for (let i = 0; i < 3; ++i) {
    encodings.push({});
    encodings[i].scalabilityMode = encodings_scalabilityMode[i].value;
    encodings[i].scaleResolutionDownBy =
        parseFloat(encodings_scaleResolutionDownBy[i].value);
    if (isNaN(encodings[i].scaleResolutionDownBy)) {
      if (deleteUndefined) {
        delete encodings[i].scaleResolutionDownBy;
      } else {
        encodings[i].scaleResolutionDownBy = undefined;
      }
    }
    encodings[i].maxBitrate =
        parseFloat(encodings_maxBitrate[i].value);
    if (isNaN(encodings[i].maxBitrate) ||
        typeof encodings[i].maxBitrate !== 'number') {
      if (deleteUndefined) {
        delete encodings[i].maxBitrate;
      } else {
        encodings[i].maxBitrate = undefined;
      }
    } else {
      encodings[i].maxBitrate = encodings[i].maxBitrate * 1000;  // kbps -> bps
    }

    encodings[i].maxFramerate = parseFloat(encodings_maxfps[i].value);
    if (isNaN(encodings[i].maxFramerate) ||
      typeof encodings[i].maxFramerate !== 'number') {
      if (deleteUndefined) {
        delete encodings[i].maxFramerate;
      } else {
        encodings[i].maxFramerate = undefined;
      }
    }

    encodings[i].active = (encodings_active[i].value == 'true');
  }
  return encodings;
}

function preferCodec(transceiver, codec) {
  const preferredCodecs = RTCRtpReceiver.getCapabilities('video').codecs;
  for (let i = 0; i < preferredCodecs.length; ++i) {
    if (!preferredCodecs[i].mimeType.endsWith(codec)) {
      continue;
    }
    const swappedCodec = preferredCodecs[0];
    preferredCodecs[0] = preferredCodecs[i];
    preferredCodecs[i] = swappedCodec;
    break;
  }
  transceiver.setCodecPreferences(preferredCodecs);
}

async function pollGetStats() {
  if (pc1 !== null && (pc1.iceConnectionState == 'connected' ||
                       pc1.iceConnectionState == 'completed')) {
    const report = await pc1.getStats();
    const outboundRtpsByRid = new Map();
    for (const stats of report.values()) {
      if (stats.type !== 'outbound-rtp') {
        continue;
      }
      outboundRtpsByRid.set(stats.rid, stats);
    }
    let totalSendBytes = 0;
    let prevTotalSendBytes = 0;
    let deltaTimestampMs = 1000;

    let statusStr = '';
    let qpStr = '';
    for (let i = 0; i < 3; ++i) {
      if (i != 0) {
        statusStr += '\n';
        qpStr += ', ';
      }
      const outboundRtp = outboundRtpsByRid.get(`${i}`);
      const prevOutboundRtp = pc1PrevStatsReport.get(outboundRtp?.id);

      totalSendBytes += outboundRtp?.bytesSent ?? 0;
      if (prevOutboundRtp) {
        prevTotalSendBytes += prevOutboundRtp.bytesSent;
        // The delta of all RTP stats objects should be the same so it doesn't
        // matter from which RID we take the delta timestamp.
        deltaTimestampMs = outboundRtp.timestamp - prevOutboundRtp.timestamp;
      }

      statusStr += outboundRtpToString(report, outboundRtp, prevOutboundRtp);
      if (prevOutboundRtp && outboundRtp &&
          outboundRtp.framesEncoded > prevOutboundRtp.framesEncoded) {
        qpStr += Math.round(
            (outboundRtp.qpSum - prevOutboundRtp.qpSum) /
            (outboundRtp.framesEncoded - prevOutboundRtp.framesEncoded));
      } else {
        qpStr += 'N/A';
      }
    }
    const totalBps =
        (totalSendBytes - prevTotalSendBytes) / deltaTimestampMs * 1000;
    statusStr =
        `Sending ${Math.round(totalBps * 8 / 1000)} kbps...\n\n${statusStr}`;
    const reason =
        outboundRtpsByRid.get('0')?.qualityLimitationReason ?? 'none';
    statusStr += `\n\nLimited by ${reason} (QP values: ${qpStr}).`;
    statusParagraph.innerText = statusStr;

    pc1PrevStatsReport.clear();
    for (const stats of report.values()) {
      pc1PrevStatsReport.set(stats.id, stats);
    }
  }
  if (pc2 !== null) {
    const report = await pc2.getStats();
    let bytesReceived = 0;
    for (const stats of report.values()) {
      if (stats.type !== 'inbound-rtp') {
        continue;
      }
      const recvVideoParagraph = recvVideoParagraphs[stats.mid];
      recvVideoParagraph.innerText = inboundRtpToString(
          report, stats, pc2PrevStatsReport.get(stats.id));
      bytesReceived += stats.bytesReceived ?? 0;
    }
    if (pc1 === null && bytesReceived > 0) {
      statusParagraph.innerText = '';
    }

    pc2PrevStatsReport.clear();
    for (const stats of report.values()) {
      pc2PrevStatsReport.set(stats.id, stats);
    }
  }
  setTimeout(pollGetStats, 5000);
}
pollGetStats();

function outboundRtpToString(report, outboundRtp, prevOutboundRtp) {
  if (!outboundRtp) {
    return 'null';
  }
  if (!outboundRtp.active) {
    return `rid:${outboundRtp.rid}, inactive`;
  }
  const currFramesEncoded = outboundRtp.framesEncoded ?? 0;
  const prevFramesEncoded = prevOutboundRtp?.framesEncoded ?? 0;
  if (currFramesEncoded <= prevFramesEncoded) {
    return `rid:${outboundRtp.rid}, active but not encoding`;
  }
  let codec = null;
  if (outboundRtp.codecId) {
    const codecStats = report.get(outboundRtp.codecId);
    codec = codecStats.mimeType.substring(codecStats.mimeType.indexOf('/') + 1);
  }
  let str = `rid:${outboundRtp.rid}`;
  str += ` ${codec} ${outboundRtp.scalabilityMode} ${simplifyEncoderString(
      outboundRtp.rid, outboundRtp.encoderImplementation)}`;
  if (outboundRtp.frameWidth && outboundRtp.frameHeight &&
      outboundRtp.framesPerSecond) {
    str +=
        ` ${outboundRtp.frameWidth}x${outboundRtp.frameHeight}` +
        ` @ ${outboundRtp.framesPerSecond} fps`;
  }
  if (prevOutboundRtp) {
    str += ` @ target ${Math.round(outboundRtp.targetBitrate / 1000)}`
    const bytesPerSecond =
        (outboundRtp.bytesSent - prevOutboundRtp.bytesSent) /
        (outboundRtp.timestamp - prevOutboundRtp.timestamp) * 1000;
    str += ` actual ${Math.round(bytesPerSecond * 8 / 1000)} kbps`;
  }
  return str;
}

function simplifyEncoderString(rid, encoderImplementation) {
  if (!encoderImplementation) {
    return null;
  }
  if (encoderImplementation.startsWith('SimulcastEncoderAdapter')) {
    let simplified = encoderImplementation.substring(
        encoderImplementation.indexOf('(') + 1,
        encoderImplementation.length - 1);
    simplified = simplified.split(', ');
    if (simplified.length === 3) {
      // We only know how to simplify the string if we have three encoders
      // otherwise the RID might not map 1:1 to the index here.
      return `[${simplified[rid]}]`;
    }
  }
  return encoderImplementation;
}

function inboundRtpToString(report, inboundRtp, prevInboundRtp) {
  if (!inboundRtp.frameWidth || !inboundRtp.frameHeight ||
      !inboundRtp.framesPerSecond) {
    return '';
  }
  let str = `${inboundRtp.frameWidth}x${inboundRtp.frameHeight} ` +
            ` @ ${inboundRtp.framesPerSecond} fps`;
  if (prevInboundRtp) {
    const bytesPerSecond =
        (inboundRtp.bytesReceived - prevInboundRtp.bytesReceived) /
        (inboundRtp.timestamp - prevInboundRtp.timestamp) * 1000;
    str += ` @ ${Math.round(bytesPerSecond * 8 / 1000)} kbps`;
  }
  return str;
}

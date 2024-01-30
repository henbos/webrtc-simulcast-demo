const codecSelect = document.getElementById('codecSelectId');
const roleSelect = document.getElementById('roleSelectId');
const offerInput = document.getElementById('offerInputId');
const answerInput = document.getElementById('answerInputId');
const statusParagraph = document.getElementById('statusParagraphId');

let pc1 = null;
let pc2 = null;
let track = null;
let prevOutboundRtpsByRid = null;

const configuredEncodings = [
  {rid:'0', scaleResolutionDownBy:4, scalabilityMode: 'L1T1'},
  {rid:'1', scaleResolutionDownBy:2, scalabilityMode: 'L1T1'},
  {rid:'2', scaleResolutionDownBy:1, scalabilityMode: 'L1T1'},
];

function onStop() {
  if (pc1) {
    pc1.close();
    pc1 = null;
  }
  if (pc2) {
    pc2.close();
    pc2 = null;
  }
  prevOutboundRtpsByRid = null;
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

    const stream = await navigator.mediaDevices.getUserMedia({video:{
      width:1280, height:720
    }});
    track = stream.getTracks()[0];
    const transceiver =
        pc1.addTransceiver(track, {sendEncodings:configuredEncodings});
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

    // Complete `pc2` ICE gathering and get final answer.
    await negotiateWithSimulcastTweaks(null, pc2, offer);
    await pc2GatheringComplete;
    // Now the answer contains the a=candidate lines.
    const plaintextAnswer = await negotiateWithSimulcastTweaks(null, pc2, offer);
    // To/from base64.
    encodedAnswer = btoa(plaintextAnswer.sdp);
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
  prevOutboundRtpsByRid = null;
}

function preferCodec(transceiver, codec) {
  const preferredCodecs = RTCRtpSender.getCapabilities('video').codecs;
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
    let statusStr = '';
    for (let i = 0; i < 3; ++i) {
      if (i != 0) {
        statusStr += '\n';
      }
      statusStr += outboundRtpToString(
          report, outboundRtpsByRid.get(`${i}`),
          prevOutboundRtpsByRid?.get(`${i}`));
    }
    statusParagraph.innerText = statusStr;

    const qualityLimitationReason =
        outboundRtpsByRid.get('0')?.qualityLimitationReason ?? 'none';
    statusParagraph.innerText += `\n\nLimited by ${qualityLimitationReason}.`;

    prevOutboundRtpsByRid = outboundRtpsByRid;
  } else if (pc2 !== null) {
    const report = await pc2.getStats();
    let bytesReceived = 0;
    for (const stats of report.values()) {
      if (stats.type !== 'inbound-rtp') {
        continue;
      }
      bytesReceived += stats.bytesReceived ?? 0;
    }
    if (bytesReceived > 0) {
      statusParagraph.innerText =
          `Received: ${Math.ceil(bytesReceived/1000)} kB`;
    }
  }
  setTimeout(pollGetStats, 1000);
}
pollGetStats();

function outboundRtpToString(report, outboundRtp, prevOutboundRtp) {
  if (!outboundRtp) {
    return 'null';
  }
  if (!outboundRtp.active) {
    return `{rid:${outboundRtp.rid}, inactive}`;
  }
  const currFramesEncoded = outboundRtp.framesEncoded ?? 0;
  const prevFramesEncoded = prevOutboundRtp?.framesEncoded ?? 0;
  if (currFramesEncoded <= prevFramesEncoded) {
    return `{rid:${outboundRtp.rid}, active but not encoding}`;
  }
  let codec = null;
  if (outboundRtp.codecId) {
    const codecStats = report.get(outboundRtp.codecId);
    codec = codecStats.mimeType.substring(codecStats.mimeType.indexOf('/') + 1);
  }
  let str = `rid:${outboundRtp.rid}`;
  if (codec && outboundRtp.frameWidth && outboundRtp.frameHeight &&
      outboundRtp.framesPerSecond) {
    str +=
        ` ${codec} ${outboundRtp.frameWidth}x${outboundRtp.frameHeight}` +
        `@${outboundRtp.framesPerSecond} ${outboundRtp.scalabilityMode}`;
  }
  str += ` ${simplifyEncoderString(
      outboundRtp.rid, outboundRtp.encoderImplementation)}`;
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

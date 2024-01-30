const codecSelect = document.getElementById('codecSelectId');
const statsParagraph = document.getElementById('statsParagraphId');

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
  if (pc1 && pc2) {
    pc1.close();
    pc2.close();
    pc1 = pc2 = null;
    prevOutboundRtpsByRid = null;
  }
  if (track) {
    track.stop();
    track = null;
  }
  statsParagraph.innerText = '';
}

async function onStart() {
  onStop();
  // Initial setup relying on ICE gathering as part of the SDP exchanged.
  pc1 = new RTCPeerConnection();
  const pc1GatheringComplete = new Promise(
      resolve => pc1.onicegatheringstatechange = () => {
        if (pc1.iceGatheringState == 'complete') {
          resolve();
        }
      });
  pc2 = new RTCPeerConnection();
  const pc2GatheringComplete = new Promise(
      resolve => pc2.onicegatheringstatechange = () => {
        if (pc2.iceGatheringState == 'complete') {
          resolve();
        }
      });

  const stream = await navigator.mediaDevices.getUserMedia({video:{
    width:1280, height:720
  }});
  track = stream.getTracks()[0];
  pc1.addTransceiver(track, {sendEncodings:configuredEncodings});

  // Do an initial negotiation where we wait for ICE gathering to complete. This
  // ensures that all ICE candidates are present in subsequent renegotiations.
  await renegotiate();
  await Promise.all([pc1GatheringComplete, pc2GatheringComplete]);

  // Negotiate a second time, this time ICE candidates should be present.
  await renegotiate();
}

async function renegotiate() {
  if (pc1 == null) {
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
  if (pc1 !== null) {
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
    statsParagraph.innerText = statusStr;

    const qualityLimitationReason =
        outboundRtpsByRid.get('0')?.qualityLimitationReason ?? 'none';
    statsParagraph.innerText += `\n\nLimited by ${qualityLimitationReason}.`;

    prevOutboundRtpsByRid = outboundRtpsByRid;
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

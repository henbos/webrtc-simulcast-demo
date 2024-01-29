const statsParagraph = document.getElementById('statsParagraphId');

let pc1 = null;
let pc2 = null;
let track = null;
let prevOutboundRtpsByRid = null;

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
}

async function onStart() {
  onStop();
  pc1 = new RTCPeerConnection();
  pc2 = new RTCPeerConnection();
  pc1.onicecandidate = (e) => pc2.addIceCandidate(e.candidate);
  pc2.onicecandidate = (e) => pc1.addIceCandidate(e.candidate);
  const iceConnectedPromise = new Promise(
      resolve => pc1.oniceconnectionstatechange = () => {
        if (pc1.iceConnectionState == 'connected' ||
            pc1.iceConnectionState == 'connected') {
          resolve();
        }
      });

  const stream = await navigator.mediaDevices.getUserMedia({video:{
    width:1280, height:720
  }});
  track = stream.getTracks()[0];
  const transceiver = pc1.addTransceiver(track, {sendEncodings:[
    {rid:'0', scaleResolutionDownBy:4, scalabilityMode: 'L1T1'},
    {rid:'1', scaleResolutionDownBy:2, scalabilityMode: 'L1T1'},
    {rid:'2', scaleResolutionDownBy:1, scalabilityMode: 'L1T1'},
  ]});

  preferCodec(transceiver, 'VP9');
  await negotiateWithSimulcastTweaks(pc1, pc2);

  await iceConnectedPromise;
  console.log('Connected');

  // // What if pc2 stops receiving?
  // for (const transceiver of pc2.getTransceivers()) {
  //   transceiver.stop();
  // }
  // await pc2.setLocalDescription();  // Bug: has to SLD to stop receiving.
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
  const json = {
    rid: outboundRtp.rid ?? null,
    resFps: 1,  // placeholder
    impl: simplifyEncoderString(outboundRtp.rid,
                                outboundRtp.encoderImplementation),
  };
  let resolutionFpsStr = 'undefined';
  if (codec && outboundRtp.frameWidth && outboundRtp.frameHeight &&
      outboundRtp.framesPerSecond) {
    resolutionFpsStr =
        `${codec} ${outboundRtp.frameWidth}x${outboundRtp.frameHeight}` +
        `@${outboundRtp.framesPerSecond}`;
  }
  return JSON.stringify(json).replaceAll('"', '').replaceAll(',', ', ')
      .replaceAll('resFps:1', resolutionFpsStr).replaceAll('impl:', '');
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

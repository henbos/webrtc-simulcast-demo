
let pc1 = null;
let pc2 = null;
let track = null;

function onStop() {
  if (pc1 && pc2) {
    pc1.close();
    pc2.close();
    pc1 = pc2 = null;
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
  console.log(preferredCodecs);
  transceiver.setCodecPreferences(preferredCodecs);
}

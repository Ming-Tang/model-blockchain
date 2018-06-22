const targetFrameRate = 20;
const updatesPerFrame = 1;
const ticksPerSecond = targetFrameRate * updatesPerFrame;
const second = ticksPerSecond;
const dTime = 1.0 / ticksPerSecond;

function vlerp(t, v1, v2) {
  let d = v2.copy().sub(v1).mult(t);
  return v1.copy().add(d);
}

const minDifficulty = 1;
const initDifficulty = 100;



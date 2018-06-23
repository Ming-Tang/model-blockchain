'use strict';

function vlerp(t, v1, v2) {
  let d = v2.copy().sub(v1).mult(t);
  return v1.copy().add(d);
}

class Vertex {
  constructor({pos, vel, kind, props}) {
    this.pos = pos || createVector();
    this.vel = vel || createVector();
    this.kind = kind || 'node';
    this.props = props || {};
  }
}

class Edge {
  constructor(props) {
    this.props = props || {};
  }
}

/**
 * Schedules events that follows Poisson process.
 *
 * Can also be done by performing a Bernouli trial at every simulation tick,
 * but there is suspected precision problem for small lambda.
 */
class PoissonProcess {
  static Qexp(p, lambda) {
    return -Math.log(1 - p) / lambda;
  }

  constructor(lambda) {
    this.nextEvent = null;
    this.lambda = lambda || 1;
  }

  updateNextEvent(time) {
    let p = Math.random();
    let {lambda} = this;
    this.nextEvent = time + PoissonProcess.Qexp(p, lambda);
  }

  update(time, lambda) {
    let isFirst = this.nextEvent === null;
    let lambdaChanged = lambda !== this.lambda && Math.abs((lambda - this.lambda) / this.lambda) >= 1e-2;
    if (time >= this.nextEvent || lambdaChanged) {
      this.lambda = lambda;
      this.updateNextEvent(time);
      return !isFirst && !lambdaChanged;
    }

    return false;
  }
}

class Graph {
  constructor(props) {
    this.vertices = {};
    this.adj = {};
    this.radj = {};
    this.radius = 15;
    this.time = 0;
    this.props = props || {
      edgeDelay: 1,
      blockTime: 5,
      defaultHashrate: 1
    };
    this.memo = {};
  }

  draw() {
    this.drawEdges();
    this.drawVertices();
  }

  update() {
    this.updateNodes();
    this.updateTransits();
    this.time++;
  }

  updateTransits() {
    let vks = this.getVertexKeys();
    var nTransits = 0, nFinishes = 0;
    for (let vk1 of vks) {
      let v1 = this.vertices[vk1];
      let edges = this.getEdges(vk1);
      for (let vk2 in edges) {
        if (!edges.hasOwnProperty(vk2)) continue;

        let e = edges[vk2];
        if (!e.props) continue;
        if (!e.props.transit) continue;

        let {transit} = e.props;
        let {items} = transit;
        let newItems = [];
        for (var item of items) {
          nTransits++;
          if (item.timeLeft <= 0) {
            //console.log('finished transit', e, item);
            let {to} = item;
            let vto = this.vertices[to];
            if (!vto.props) vto.props = {};
            if (!vto.props.inbox) vto.props.inbox = [];

            let {inbox} = vto.props;
            let {from, message} = item;
            inbox.push({from, edge: e, message});
            //console.log(from, '->', to, 'add to inbox', item);
            nFinishes++;
            continue;
          }

          item.timeLeft--;
          newItems.push(item);
        }

        transit.items = newItems;
      }
    }

    //if (nTransits && nFinishes) console.log('transits processed', nFinishes, '/', nTransits);
  }

  updateNodes() {
    let vks = this.getVertexKeys();

    let {edgeDelay, blockTime, defaultHashrate} = this.props;

    let nMiners = 0;
    let totalHashrate = 0;

    for (let vk of vks) {
      let {kind, props: vp} = this.vertices[vk];
      if (!vp.tip) {
        vp.tip = BlockRegistry.genesis();
        vp.tip.registerTip(vk);
      }

      let isSelfish = parseInt(vk.substring(1)) <= 3;

      if (kind === 'miner') {
        let {hashrate, miner, poissonMining} = vp;
        if (!hashrate) vp.hashrate = isSelfish ? 10 * defaultHashrate : defaultHashrate;
        if (!poissonMining) vp.poissonMining = new PoissonProcess();
        if (!miner) vp.miner = isSelfish ? new LeadSelfishMiner() : new HonestMiner();
        totalHashrate += vp.hashrate;
        nMiners++;
      }
    }

    this.totalHashrate = totalHashrate;

    for (let vk of vks) {
      var {kind, props} = this.vertices[vk];
      var vp = this.vertices[vk].props;

      if (!vp.inbox) vp.inbox = [];
      if (!vp.outbox) vp.outbox = [];
      if (!vp.peers) vp.peers = {};

      function isLongerChain(tip, b1) {
        //return !tip || b1.height > tip.height;
        return !tip || b1.totalWork > tip.totalWork;
      }

      let {inbox, outbox, peers, joined} = vp;
      let edges = this.getEdges(vk);

      function send(vk1, message) {
        if (!edges.hasOwnProperty(vk1)) return false;

        outbox.push({ edge: edges[vk1], target: vk1, message });
        //console.log('send', vk, ' -> ', vk1, message);
        return true;
      }

      function broadcastBlock(block) {
        for (let vk1 in edges) {
          if (!edges.hasOwnProperty(vk1)) continue;

          if (!peers[vk1]) peers[vk1] = {};
          let {[vk1]: peer} = peers;
          if (peer.tip instanceof Block && !isLongerChain(peer.tip, block)) continue;

          peer.tip = block;
          send(vk1, {block});
        }
      }

      function transferTip(vp, key, vk, block, kind) {
        if (vp[key] === block) return;
        if (vp[key]) vp[key].unregisterTip(vk, kind);
        vp[key] = block;
        if (vp[key]) vp[key].registerTip(vk, kind);
      }

      function updateTip(block) {
        if (!block) {
          console.error('updateTip: not a block.');
        }
        if (!isLongerChain(vp.tip, block)) {
          return {success: false, reason: 'height'};
        }

        //console.log(vk, "update tip:", {from: tip, to: block});
        let bCA = vp.tip.commonAncestor(block);
        let advance = block.height - vp.tip.height;
        var info = null;
        if (bCA === vp.tip) {
          info = {reorg: false, advance};
          //console.log(vk, 'udpate tip: advance: ', { advance });
        } else {
          let depth = vp.tip.height - bCA.height;
          let {maxReorgDepth = Infinity} = vp;
          if (depth > maxReorgDepth) {
            console.log(vk, 'update tip: reorg: refused', { advance, depth });
            return {success: false, reason: 'depth'};
          }

          //console.log(vk, 'udpate tip: reorg:', { advance, depth });
          info = {reorg: true, advance, depth};
        }

        transferTip(vp, 'tip', vk, block);

        return {success: true, info};
      }

      function findBestFromReceivedBlocks(received) {
        var shouldBroadcast = false;
        var bestHeight = 0;
        var best = null;
        for (let item of received) {
          let {from, message: {block}} = item;
          let {height} = block;
          if (!peers[from]) peers[from] = {};

          if (peers[from].tip instanceof Block) {
            if (isLongerChain(peers[from].tip, block)) {
              peers[from].tip = block;
            }
          } else {
            shouldBroadcast = true;
            peers[from].tip = block;
          }

          if (height > bestHeight) {
            bestHeight = height;
            best = item;
          }
        }
        return {shouldBroadcast, best};
      }

      // read messages
      var received = null, receivedJoined;
      if (inbox.length) {
        received = inbox.filter(({message}) => message.block && isLongerChain(vp.tip, message.block));
        receivedJoined = inbox.filter(({message}) => message.joined);
      }

      if (received) {
        var sender = null;
        //console.log(vk, 'received', received);

        let {shouldBroadcast, best} = findBestFromReceivedBlocks(received);

        if (best) {
          updateTip(best.message.block);
          if (!vp.disableRelayBlock) broadcastBlock(vp.tip);
        } else if (shouldBroadcast) {
          // broadcast to peers with lower block
          broadcastBlock(vp.tip);
        }
      }

      // reply to new nodes
      if (receivedJoined) {
        broadcastBlock(vp.tip);
      }

      // new node
      if (!joined) {
        for (let vk1 in edges) {
          if (!edges.hasOwnProperty(vk1)) continue;
          send(vk1, {joined: true});
        }

        vp.joined = true;
      }

      if (this.time % 10000 === Math.floor(1000 * Math.random()) && vp.tip) {
        //console.log(vk, 'periodic broadcast', tip);
        broadcastBlock(vp.tip);
      }

      if (kind === 'miner') {
        let {hashrate, poissonMining, miner} = vp;

        function updateMiningTip(tip1, msg='update mining tip') {
          transferTip(vp, 'miningTip', vk, tip1, 'miners');
          if (msg) console.log(vk, msg, vp.miningTip, tip1);
        }

        if (!vp.miningTip) {
          updateMiningTip(vp.tip, 'initial mining tip');
        }

        // use total hashrate as initial difficulty
        let difficulty = vp.tip.height === 0 ? Math.floor(totalHashrate * 1000) : vp.tip.difficulty;
        let blockTimeTicks = blockTime * ticksPerSecond;
        let probPerBlock = hashrate / (difficulty / 1000);
        let lambdaPerTick = probPerBlock / blockTimeTicks;

        let selectedTip = vp.tip;
        if (selectedTip !== vp.miningTip) {
          let {mTip, broadcast, newTip} = miner.onNewTip(vp.tip, vp.miningTip);
          if (mTip !== vp.miningTip) {
            updateMiningTip(mTip);
          }

          if (newTip) {
            updateTip(newTip);
          }

          if (broadcast) {
            broadcastBlock(broadcast);
          }
        }

        if (poissonMining.update(this.time, lambdaPerTick) && vp.miningTip) {
          //vp.isMining = true;
          let retargetBlocks = 50;
          let exponent = 0.2;
          let actualBlockTimeTicks = vp.miningTip.actualBlockTime(2 * retargetBlocks);
          let ratio = blockTimeTicks / actualBlockTimeTicks;
          let ratioE = Math.pow(ratio, exponent);
          var newDifficulty = difficulty;

          if (vp.miningTip.height % retargetBlocks == retargetBlocks - 1) {
            newDifficulty = difficulty * ratioE;
          }

          let mined = new Block({parent: vp.miningTip, miner: vk, time: this.time, difficulty: newDifficulty});
          BlockRegistry.add(mined);
          console.log(vk, 'mined block', mined, this.time);

          let {mTip, broadcast, newTip} = miner.onBlockMined(vp.tip, vp.miningTip, mined);
          if (mTip && mTip !== vp.miningTip) {
            updateMiningTip(mTip, 'after block mined');
          }

          if (newTip) {
            updateTip(newTip);
          }

          if (broadcast) {
            broadcastBlock(broadcast);
          }
        }
      }

      while (vp.inbox.pop());

      //if (outbox.length) console.log(vk, 'outbox', Array.from(outbox));
      while (outbox) {
        let out = outbox.pop();
        if (!out) break;

        let {edge, target, message} = out;
        if (!edge.props) edge.props = {};
        if (!edge.props.transit) edge.props.transit = {items: []};
        let {transit} = edge.props;
        let {items} = transit;
        let edgeDelayTicks = Math.floor(edgeDelay * ticksPerSecond);
        items.push({initTime: edgeDelayTicks, timeLeft: edgeDelayTicks, from: vk, to: target, message});
      }
    }

  }

  invalidate() {
    this.memo = {};
  }

  addVertex(vk, params) {
    if (this.vertices.hasOwnProperty(vk)) return false;

    this.vertices[vk] = new Vertex(params);
    this.invalidate();
    return true;
  }

  addEdge(vk1, vk2, params) {
    let {a: vka, b: vkb} = this.getKeys(vk1, vk2);
    if (!this.vertices.hasOwnProperty(vka)
      || !this.vertices.hasOwnProperty(vkb)) return false;
    if (!this.adj.hasOwnProperty(vka)) this.adj[vka] = {};
    if (!this.radj.hasOwnProperty(vkb)) this.radj[vkb] = {};

    if (this.adj[vka].hasOwnProperty(vkb)) return false;
    this.adj[vka][vkb] = new Edge(params);
    this.radj[vkb][vka] = true;

    this.invalidate();
    return true;
  }

  getKeys(a, b) {
    if (a > b) return {a: b, b: a};
    return {a, b};
  }

  drawVertices() {
    noStroke();
    ellipseMode(CENTER);

    let {vertices: vs, adj, radius} = this;
    let vks = this.getVertexKeys();
    let minH = 1e8, maxH = -1;
    for (let vk of vks) {
      var v = vs[vk];
      if (v.props && v.props.tip) {
        let h = v.props.tip.height;
        minH = Math.min(minH, h);
        maxH = Math.max(maxH, h);
      }
    }

    for (let vk of vks) {
      var v = vs[vk];
      let h = v.props && v.props.tip ? v.props.tip.height : 0;
      if (!v.props.opacity) v.props.opacity = 30;
      let {opacity} = v.props;
      let opa1 = minH === maxH ? 255 : 105 + Math.floor(150 * (h - minH) / (maxH - minH));
      let opa = Math.floor(opacity + (opa1 < opacity ? 0.3 : 0.15) * (opa1 - opacity));
      if (opa > 253) opa = 255;
      v.props.opacity = opa;

      strokeWeight(3);
      stroke(0, 0, 0, 100);
      fill(0, 0, 0, 100);
      ellipse(v.pos.x, v.pos.y, 2 * radius, 2 * radius);

      if (v && v.props && v.props.tip) {
        let [r, g, b] = v.props.tip.colorCode;
        stroke(r, g, b, opa);
      } else {
        stroke(0, 0, 0, opa);
      }

      if (v.kind === 'miner') {
        fill(255, 140, 140, opa);
      } else {
        fill(220, 220, 220, opa);
      }

      ellipse(v.pos.x, v.pos.y, 2 * radius, 2 * radius);

      fill(0, 0, 0, 255);
      noStroke();
      textAlign(CENTER);
      textSize(10);
      text(`${vk}\n${h}`, Math.round(v.pos.x), Math.round(v.pos.y) - 1);
    }

  }

  drawEdges() {
    let {vertices: vs, adj: adj} = this;
    for (let vk1 in adj) {
      let {pos: p1} = vs[vk1];
      for (let vk2 in adj[vk1]) {
        let v2 = vs[vk2];
        let {pos: p2} = v2;


        strokeWeight(1);
        stroke(200);
        line(p1.x, p1.y, p2.x, p2.y);

        let edge = this.adj[vk1][vk2];
        if (!edge.props || !edge.props.transit || !edge.props.transit.items) continue;
        let {transit: {items}} = edge.props;
        for (let {initTime: tMax, timeLeft: t0, from, to} of items) {
          let posFrom = vs[from].pos, posTo = vs[to].pos;
          let dir = posTo.copy().sub(posFrom);
          let u = 1 - t0 / tMax;
          let pos1 = posFrom.copy().add(dir.copy().mult(u));
          let pos2 = posFrom.copy().add(dir.copy().mult(u + 0.05 > 1 ? 1 : u + 0.05));

          strokeWeight(3);
          stroke(180, 240, 255, 180);
          line(pos1.x, pos1.y, pos2.x, pos2.y);
        }
      }
    }
  }

  getVertexKeys() {
    return Object.keys(this.vertices);
  }

  getKeysSortedByDist(p0) {
    let ks = this.getVertexKeys();
    let {vertices} = this;
    ks.sort((vk1, vk2) => {
      let p1 = vertices[vk1].pos.copy().sub(p0);
      let p2 = vertices[vk2].pos.copy().sub(p0);
      let d1 = p1.mag(), d2 = p2.mag();
      return d2 < d1;
    });
    return ks;
  }

  getEdges(vk) {
    let {memo} = this;
    if (!memo.getEdges) memo.getEdges = {};

    if (memo.getEdges.hasOwnProperty(vk)) {
      return memo.getEdges[vk];
    }

    var edges = {};
    let {adj, radj} = this;
    for (var vk1 in adj[vk]) {
      if (adj[vk].hasOwnProperty(vk1)) {
        edges[vk1] = adj[vk][vk1];
      }
    }

    for (var vk1 in radj[vk]) {
      if (radj[vk].hasOwnProperty(vk1)) {
        edges[vk1] = adj[vk1][vk];
      }
    }

    memo.getEdges[vk] = {...edges};

    return edges;
  }

  forceLayout(params) {
    let {
      dt: dt = 8e-1,
      center: center = null,
      cS: cS = 2e-2,
      cA: cA = 4e-4,
      cR: cR = 500,
      cD: cD = 0.35,
      range: range = 500
    } = params || {};
    center = center || createVector(width / 2, height / 2);

    var forces = {};
    let vks = this.getVertexKeys();
    let {vertices: vs, adj} = this;

    function cf(a, pow, {x: x0, y: y0, z: z0}, {x: x1, y: y1, z: z1}, dmax) {
      let dx = x1 - x0;
      let dy = y1 - y0;
      let dz = z1 - z0;
      let r2 = dx * dx + dy * dy + dz * dz;
      if (r2 >= dmax * dmax || !Number.isFinite(r2)) return createVector();

      let r = Math.sqrt(r2);
      if (!Number.isFinite(r)) return createVector();

      if (pow === 1) {
        return createVector(a * dx, a * dy, a * dz).limit(1e4);
      } else if (pow === 0) {
        return createVector(a * dx / r, a * dy / r, a * dz / r).limit(1e4);
      } else if (pow === -1) {
        return createVector(a * dx / r2, a * dy / r2, a * dz / r2).limit(1e4);
      } else if (pow === -2) {
        let r3 = r * r2;
        return createVector(a * dx / r3, a * dy / r3, a * dz / r3).limit(1e4);
      } else {
        let rp = r * Math.pow(r, pow);
        return createVector(a * dx / rp, a * dy / rp, a * dz / rp).limit(1e4);
      }
    }

    let centroid = createVector();
    for (let vk of vks) {
      forces[vk] = createVector(0, 0);
      centroid.add(vs[vk].pos);
    }

    if (vks.length)
      centroid.div(vks.length);

    let centerForce = cf(cS, 1, centroid, center, 1e8).limit(30);
    for (let vk of vks) {
      forces[vk].add(centerForce);
    }

    // repel
    for (let vk1 of vks) {
      for (let vk2 of vks) {
        forces[vk1].add(cf(-cR, -2, vs[vk1].pos, vs[vk2].pos, range).limit(40));
      }
    }

    // attract
    for (let vk1 in adj) {
      for (let vk2 in adj[vk1]) {
        let fa = cf(cA, 1, vs[vk1].pos, vs[vk2].pos, 1e8).limit(100);
        forces[vk1].add(fa);
        forces[vk2].add(fa.mult(-1));
      }
    }

    // damping
    for (let vk of vks) {
      let vel = vs[vk].vel.copy();
      forces[vk].add(vel.mult(-cD));
    }

    // noise
    for (let vk of vks) {
      let vel = vs[vk].vel.copy();
      forces[vk].add(1e-6 * (Math.random() - 0.5), 1e-6 * (Math.random() - 0.5));
    }

    for (let vk of vks) {
      let v = vs[vk];
      let f = forces[vk];
      f.mult(dt).limit(1e3);
      v.vel.add(f.copy().mult(dt));
      if (v.vel.mag() < 1e-1) v.vel.mult(0);
      v.pos.add(v.vel.limit(1e3).copy().mult(dt));
    }
  }
}

let graph = new Graph();

var selected = null;
var counter = 0;
var doLayout = true;

var layoutIters = 0;
var connectRadius = 200;
var kind = 'node';
var nPeers = 8;
var spreadFactor = 0.3;
var timelineMode = true;

var keyHandlers;
let controls = {};

let opts = { speedup: 1 };

function setup() {
  createCanvas(1800, 1200).parent('main-canvas');
  frameRate(targetFrameRate);

  for (var i = 0; i < 80; i++) {
    addConnectedNode(createVector(
      100 + 10 * i + 400 * Math.random(),
      200 + 400 * Math.random()
    ), 3, 0.55, 300);
  }

  for (var i = 0; i < 12; i++) {
    addConnectedNode(createVector(
      (i % 2 == 0 ? 0 : 1300) + 400 * Math.random(),
       800 * Math.random()
    ), 3, 0.55, 1000, 'miner');
  }

  let controlsDecl = {
    simulation: [
      { obj: () => opts, key: 'speedup', create: () => createSlider(1, 200, 1) },
    ],
    blockchain: [
      { obj: () => graph.props, key: 'blockTime', create: () => createSlider(1.0, 60.0, 0.5) },
      { obj: () => graph.props, key: 'edgeDelay', create: () => createSlider(0.1, 20.0, 0.0, 0.1) }
    ]
  };

  for (let pkey of Object.keys(controlsDecl)) {
    let cdecls = controlsDecl[pkey];
    if (!controls.hasOwnProperty(pkey)) controls[pkey] = {};
    let cs = controls[pkey];
    for (let cdecl of cdecls) {
      let {obj, key, label, create} = cdecl;
      let control = create();
      control.parent(`c-${pkey}-${key}`);
      cs[key] = { control, cdecl };
      control.value(obj()[key]);
    }
  }

  createButton('Toggle add node/miner')
    .mouseClicked(keyHandlers['M'])
    .parent('toggle-miner-btn');

  createButton('Toggle auto layout')
    .mouseClicked(keyHandlers['L'])
    .parent('toggle-layout-btn');

  createButton('Toggle timeline/block height')
    .mouseClicked(keyHandlers['T'])
    .parent('toggle-timeline-btn');

  createButton('Reset')
    .mouseClicked(keyHandlers['C'])
    .parent('clear-btn');
}

function draw() {
  background(0);

  for (let pkey of Object.keys(controls)) {
    for (let ckey of Object.keys(controls[pkey])) {
      let { control, cdecl: {obj, key} } = controls[pkey][ckey];
      let o = obj();
      if (o && key) o[key] = control.value();
    }
  }

  let nUpdates = updatesPerFrame * opts.speedup;
  for (var i = 0; i < nUpdates; i++) graph.update();

  if (doLayout) {
    graph.forceLayout({ range: 100 /* , dt: 2 * 1.0 / ticksPerSecond */ });
    layoutIters++;
  }

  graph.draw();

  strokeWeight(0.5);
  stroke(255, 255, 255, 100);
  ellipseMode(CENTER);
  noFill();
  ellipse(mouseX, mouseY, 2 * connectRadius, 2 * connectRadius);

  stroke(255, 255, 255, 50);
  ellipse(mouseX, mouseY, 2 * spreadFactor * connectRadius, 2 * spreadFactor * connectRadius);

  for (var i = 0; i < nPeers; i++) {
    line(
      mouseX,
      mouseY,
      mouseX + connectRadius * Math.cos(2 * Math.PI * i / nPeers),
      mouseY + connectRadius * Math.sin(2 * Math.PI * i / nPeers)
    );
  }

  BlockRegistry.draw(timelineMode ? 'time' : 'height', graph.time);

  fill(255);
  noStroke();
  textSize(14);
  textAlign(RIGHT);

  let blockHeight = BlockRegistry.blocks.length - 1;
  let totalBlocks = BlockRegistry.blocks.reduce((s, {length}) => s + length, 0);
  let orphanRate = 1 - (1.0 * (1 + blockHeight)) / totalBlocks;
  let tip = BlockRegistry.blocks && BlockRegistry.blocks[blockHeight] ? BlockRegistry.blocks[blockHeight][0] : null;

  let bt50 = tip ? tip.actualBlockTime(50).toFixed(2) / ticksPerSecond : 0;
  let bt200 = tip ? tip.actualBlockTime(200).toFixed(2) / ticksPerSecond : 0;
  let bt1000 = tip ? tip.actualBlockTime(1000).toFixed(2) / ticksPerSecond : 0;

  let statusText = (''
    + `Speedup: ${opts.speedup}x;  ${Math.round(getFrameRate())} fps\n`
    + `Block time: ${graph.props.blockTime} s\n`
    + `Propagation time: ${graph.props.edgeDelay} s\n`
    + `Block height: ${blockHeight}, Total blocks: ${totalBlocks}\n`
    + `Orphan rate: ${(orphanRate * 100).toFixed(2)} %\n\n`
    + `Measured block time (50/200/1000): ${bt50} | ${bt200} | ${bt1000}\n`
    + `Difficulty: ${tip ? tip.difficulty : 1}`
  );
  text(statusText, width - 10, 20);

  let dty = 12;
  let ty = 10 + dty;
  let {totalHashrate} = graph;
  let x = (h) => 50 + (100.0 * h) / (1.0 * totalHashrate);

  for (let vk of graph.getVertexKeys()) {
    let node = graph.vertices[vk];
    if (node.kind !== 'miner') continue;

    fill(255);
    noStroke();
    textSize(10);
    textAlign(LEFT);
    text(vk, 10, ty);

    strokeWeight(2);
    stroke(255, 100, 100);
    line(x(0), ty, x(node.props.hashrate), ty);

    ty += dty;
  }

  strokeWeight(1);
  stroke(255, 255, 255, 50);
  for (var i = 0; i <= 5; i++) {
    line(x(i * totalHashrate * 0.1), 10, x(i * totalHashrate * 0.1), ty);
  }
}

function mousePos() { return createVector(mouseX, mouseY); }

function addConnectedNode(pos, n, c, radius = 10000, kind = 'node') {
  layoutIters = Math.floor(layoutIters / 3);

  if (!c) c = 0;
  let vks = graph.getKeysSortedByDist(mousePos());
  let vk = `v${counter++}`;
  graph.addVertex(vk, {pos, kind});
  var j = 0, changed = true;
  while (j < n && changed) {
    changed = false;
    for (var i = 0; j < n && i < vks.length; i++) {
      if (Math.random() < c) continue;
      if (graph.vertices[vks[i]].pos.dist(pos) > radius) continue;
      if (graph.addEdge(vk, vks[i])) {
        j++;
        changed = true;
      }
    }
  }
}

function mousePressed() {
  if (touches && touches.length > 1) return;
  if (mouseX < 0 || mouseX > width || mouseY < 0 || mouseY > height) return;

  addConnectedNode(
    mousePos().add(createVector(Math.random() - 0.5, Math.random() - 0.5)),
    nPeers, spreadFactor, connectRadius, kind);
}

keyHandlers = {
  'M': () => { kind = kind === 'miner' ? 'node' : 'miner'; },
  'C': () => { graph = new Graph(); counter = 0; BlockRegistry.reset(); },
  'L': () => { doLayout = !doLayout; },
  'R': () => { layoutIters = 0; },
  'S': () => { layoutIters *= 2; },
  'T': () => { timelineMode = !timelineMode; },
  [192]: () => { connectRadius = 50; },
  '1': () => { connectRadius = 100; },
  '2': () => { connectRadius = 200; },
  '3': () => { connectRadius = 300; },
  '4': () => { connectRadius = 400; },
  '5': () => { connectRadius = 500; },
  '6': () => { connectRadius = 600; },
  '7': () => { connectRadius = 700; },
  '8': () => { connectRadius = 800; },
  '9': () => { connectRadius = 900; },
  '0': () => { connectRadius = 50; },
  [189]: () => { nPeers = Math.max(1, nPeers - 1); },
  [187]: () => { nPeers = Math.min(50, nPeers + 1); },
  // [ ]
  [219]: () => { spreadFactor = Math.max(0, spreadFactor - 0.05); },
  [221]: () => { spreadFactor = Math.min(1, spreadFactor + 0.05); },
};

function keyPressed() {
  console.log(key, keyCode);
  if (key in keyHandlers) { return keyHandlers[key](); }
  if (keyCode in keyHandlers) { return keyHandlers[keyCode](); }
}


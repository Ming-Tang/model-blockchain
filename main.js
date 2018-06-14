class Block {
  constructor(params) {
    let {miner, height, parent, time, fork} = params || {};
    this.miner = miner || '';
    this.height = height || (parent && 1 + parent.height) || 0;
    this.parent = parent || null;
    this.fork = fork || 0;
    this.time = time || 0;
    if (parent && !(parent instanceof Block)) {
      console.error("parent is not a block", parent);
    }
  }

  nthParent(n) {
    var b = this;
    while (b && n) {
      b = b.parent;
      n--;
    }

    return b;
  }

  *parents() {
    var b = this;
    while (b) {
      yield b;
      b = b.parent;
    }
  }

  commonAncestor(b1) {
    while (true) {
      n = 10;
    }
  }
}

class BlockRegistry {
  static ensureInit() {
    if (!BlockRegistry.blocks) BlockRegistry.blocks = [];
  }

  static genesis() {
    BlockRegistry.ensureInit();
    if ( BlockRegistry.blocks[0] && BlockRegistry.blocks[0][0])
      return BlockRegistry.blocks[0][0];

    let block = new Block();
    BlockRegistry.add(block);
    return block;
  }

  static add(block) {
    BlockRegistry.ensureInit();
    if (!(block instanceof Block)) return;
    let {blocks} = BlockRegistry;
    if (!blocks[block.height]) blocks[block.height] = [];
    blocks[block.height].push(block);
  }

  static getNextForkId(h) {
    BlockRegistry.ensureInit();
    return BlockRegistry.blocks[h] ? BlockRegistry.blocks[h].length : 0;
  }

  static draw() {
    let {blocks} = BlockRegistry;
    if (!blocks) return;

    let i0 = Math.max(0, blocks.length - 30);
    let nForks = blocks.reduce(Math.max, 1);
    function getPos(i, j) {
      return createVector(20 + (i - i0) * 40, height - 20 - j * 20);
    };

    for (var i = i0; i < blocks.length; i++) {
      if (!blocks[i]) continue;

      for (var j = 0; j < blocks[i].length; j++) {
        let block = blocks[i][j];
        var pos = block.pos;
        if (!pos) {
          block.pos = pos = getPos(i, j);
        }

        let {x, y} = pos;

        rectMode(CENTER);
        fill(255);
        noStroke();
        rect(x, y, 10, 10);

        let {parent} = block;
        if (!parent || !parent.pos) continue;

        strokeWeight(1);
        stroke(255);
        line(x, y, parent.pos.x, parent.pos.y);
      }
    }
  }
}

if (false) {
  let b0 = new Block();
  let b1 = new Block({ parent: b0 });
  let b2 = new Block({ parent: b1 });
  let b3 = new Block({ parent: b2 });
  let b4a = new Block({ label: 'a', parent: b3 });
  let b4b = new Block({ label: 'b', parent: b3 });
  let b5a = new Block({ label: 'aa', parent: b4a });
  console.log(b5a);
  console.log(b4b);
  console.log(Array.from(b5a.parents()));
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

class Graph {
  constructor() {
    this.vertices = {};
    this.adj = {};
    this.radj = {};
    this.radius = 15;
    this.time = 0;
    this.edgeDelay = 100;
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
    let nMiners = 0;
    for (let vk of vks) {
      if (this.vertices[vk].props.kind === 'miner')
        nMiners++;
    }

    for (let vk of vks) {
      var {kind, props} = this.vertices[vk];
      var vp = this.vertices[vk].props;
      if (!vp.tip) { vp.tip = BlockRegistry.genesis(); }

      if (!vp.inbox) vp.inbox = [];
      if (!vp.outbox) vp.outbox = [];


      function isLongerChain(tip, b1) {
        return !tip || b1.height > tip.height;
      }

      let {inbox, outbox} = vp;
      let edges = this.getEdges(vk);

      function send(vk1, message) {
        if (!edges.hasOwnProperty(vk1)) return false;

        outbox.push({ edge: edges[vk1], target: vk1, message });
        //console.log('send', vk, ' -> ', vk1, message);
        return true;
      }

      function broadcast(message) {
        for (let vk1 in edges) {
          if (edges.hasOwnProperty(vk1)) {
            send(vk1, message);
          }
        }
      }

      function updateTip(block) {
        //console.log(vk, "update tip:", {from: tip, to: block});
        vp.tip = block;
      }

      var received = null;
      if (inbox.length) {
        received = inbox.filter(({message}) => message instanceof Block && isLongerChain(vp.tip, message));
      }

      if (received) {
        var sender = null;
        //console.log(vk, 'received', received);

        var bestHeight = 0;
        var best = null;
        for (let item of received) {
          let {sender, message} = item;
          let {height} = message;
          if (height > bestHeight) {
            bestHeight = height;
            best = item;
          }
        }

        if (best) {
          updateTip(best.message);
          broadcast(vp.tip);
        }
      }

      // TODO broadcast new node entry message
      if (this.time % 10000 === Math.floor(1000 * Math.random()) && vp.tip) {
        //console.log(vk, 'periodic broadcast', tip);
        broadcast(vp.tip);
      }

      if (kind === 'miner') {
        let {hashrate: lambda = 2e-5} = props;
        if (Math.random() < lambda / (0.1 + nMiners)) {
          let mined = new Block({parent: vp.tip, miner: vk, time: this.time, fork: BlockRegistry.getNextForkId(vp.tip.height)});
          BlockRegistry.add(mined);
          console.log(vk, 'mined block', mined, this.time);
          updateTip(mined);
          broadcast(mined);
        }
      }

      while (vp.inbox.pop());

      //if (outbox.length) console.log(vk, 'outbox', Array.from(outbox));
      let {edgeDelay} = this;
      while (outbox) {
        let out = outbox.pop();
        if (!out) break;

        let {edge, target, message} = out;
        if (!edge.props) edge.props = {};
        if (!edge.props.transit) edge.props.transit = {items: []};
        let {transit} = edge.props;
        let {items} = transit;
        items.push({initTime: edgeDelay, timeLeft: edgeDelay, from: vk, to: target, message});
      }
    }

  }

  addVertex(vk, params) {
    if (this.vertices.hasOwnProperty(vk)) return false;

    this.vertices[vk] = new Vertex(params);
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
      let opa1 = minH === maxH ? 255 : 155 + Math.floor(100 * (h - minH) / (maxH - minH));
      let opa = Math.floor(opacity + (opa1 < opacity ? 0.3 : 0.15) * (opa1 - opacity));
      if (opa > 253) opa = 255;
      v.props.opacity = opa;

      strokeWeight(2);
      let f = (v && v.props && v.props.tip ? v.props.tip.fork : 0);
      stroke(128 + 128 * (f % 3 == 0), 128 + 128 * (f % 4 == 1), 128 + 128 * (f % 5 == 2));
      if (v.kind === 'miner') {
        fill(255, 80, 80, opa);
      } else {
        fill(255, 255, 255, opa);
      }

      ellipse(v.pos.x, v.pos.y, 2 * radius, 2 * radius);

      fill(0, 0, 0, 255);
      noStroke();
      textAlign(CENTER);
      textSize(10);
      text(`${vk}\n${h}`, Math.round(v.pos.x), Math.round(v.pos.y));
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

    const cf = (a, pow, pos0, pos1, dmax) => {
      let p = pos1.copy().sub(pos0);
      let r = p.mag();
      if (r > dmax) return createVector();
      p.normalize();
      let val = a * (pow === 0 ? r : pow === 1 ? r : Math.pow(r, pow));
      p.mult(Number.isFinite(val) ? val : 0);
      p.limit(1e4);
      return p;
    }

    let centroid = createVector();
    for (let vk of vks) {
      forces[vk] = createVector(0, 0);
      centroid.add(vs[vk].pos);
    }

    if (vks.length)
      centroid.div(vks.length);

    let centerForce = cf(cS, 1, centroid, center, 1e8);
    for (let vk of vks) {
      forces[vk].add(centerForce);
    }

    // repel
    for (let vk1 of vks) {
      for (let vk2 of vks) {
        forces[vk1].add(cf(-cR, -2, vs[vk1].pos, vs[vk2].pos, range).limit(100));
      }
    }

    // attract
    for (let vk1 in adj) {
      for (let vk2 in adj[vk1]) {
        let fa = cf(cA, 1, vs[vk1].pos, vs[vk2].pos, 1e8);
        forces[vk1].add(fa);
        forces[vk2].add(fa.mult(-1));
      }
    }

    // damping
    for (let vk of vks) {
      let vel = vs[vk].vel.copy();
      forces[vk].add(vel.mult(-cD));
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

function setup() {
  createCanvas(1600, 1000);
  frameRate(60);

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
}

function draw() {
  background(0);
  graph.update();
  graph.draw();

  let exp1 = (x) => x > 1 ? Math.exp(-(x - 1)) : 1;

  if (doLayout) {
    for (var i = 0; i < 2; i++) {
      graph.forceLayout({ range: 100 });
      layoutIters++;
    }
  }

  strokeWeight(0.5);
  stroke(255, 255, 255, 100);
  ellipseMode(CENTER);
  noFill();
  ellipse(mouseX, mouseY, 2 * connectRadius, 2 * connectRadius);

  BlockRegistry.draw();
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
  addConnectedNode(mousePos(), kind === 'miner' ? 3 : Math.floor(3 + Math.random() * 6), 0.1, connectRadius, kind);
}

function keyPressed() {
  let keyHandlers = {
    'M': () => { kind = kind === 'miner' ? 'node' : 'miner'; },
    'C': () => { graph = new Graph(); },
    'L': () => { doLayout = !doLayout; },
    'R': () => { layoutIters = 0; },
    'S': () => { layoutIters *= 2; },
    '~': () => { connectRadius = 50; },
    '1': () => { connectRadius = 100; },
    '2': () => { connectRadius = 200; },
    '3': () => { connectRadius = 300; },
    '4': () => { connectRadius = 400; },
    '5': () => { connectRadius = 500; }
  };
  if (key in keyHandlers) { keyHandlers[key](); }
}

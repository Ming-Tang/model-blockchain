
class Block {
  constructor(params) {
    let {miner, height, parent, time, fork, props, difficulty} = params || {};
    this.miner = miner || '';
    this.height = height || (parent && 1 + parent.height) || 0;
    this.parent = parent || null;
    this.fork = fork || 0;
    this.time = time || 0;
    this.difficulty = Math.floor(Math.max(difficulty, minDifficulty) || initDifficulty);
    this.totalWork = (parent ? parent.totalWork : 0) + this.difficulty;
    if (parent && !(parent instanceof Block)) {
      console.error("parent is not a block", parent);
    }

    this.props = typeof props === 'object' ? props : { nodes: {}, miners: {} };
  }

  get colorCode() {
    let colorCodes = [
      [0, 2, 2],
      //[1, 0, 0],
      [2, 2, 0],
      [0, 0, 1],
      [2, 0, 2],
      [0, 1, 0]
    ];
    let cA = 100, cB = 77;

    let f = this.fork || 0;
    let col = colorCodes[f % colorCodes.length];
    return [cA + cB * col[0], cA + cB * col[1], cA + cB * col[2]];
  }

  nthParent(n) {
    var b = this;
    while (n) {
      if (!b.parent) return b;
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

  parentOfHeight(h) {
    let {height} = this;
    if (h == height) return this;
    if (h > height) return null;

    var b = this.parent;
    while (b) {
      if (b.height == h) return b;
      b = b.parent;
    }
    return null;
  }

  commonAncestor(b1) {
    var ba, bb;
    let b2 = this;
    if (b1.height > b2.height) {
      ba = b1.parentOfHeight(b2.height);
      bb = b2;
    } else {
      ba = b2.parentOfHeight(b1.height);
      bb = b1;
    }

    while (true) {
      if (ba === bb) return ba;
      ba = ba.parent;
      bb = bb.parent;

      if (!ba.parent != !bb.parent || ba.height !== bb.height) {
        throw new Error('commonAncestor: bad heights.');
      }
    }

    return ba;
  }

  registerTip(vk, kind='nodes') {
    let {props: {[kind]: nodes}} = this;

    if (!nodes.hasOwnProperty(vk)) nodes[vk] = 0;
    nodes[vk]++;
  }

  unregisterTip(vk, kind='nodes') {
    let {props: {[kind]: nodes}} = this;

    nodes[vk]--;
    if (!nodes[vk]) delete nodes[vk];
  }

  actualBlockTime(n) {
    let {time = 0, height = 0} = this;
    let tf = time;
    let bi = this.parentOfHeight(height - n);
    let ti = bi ? bi.time || 0 : 0;
    return Math.round((tf - ti) / Math.min(n, height));
  }
}

class BlockRegistry {
  static reset() { BlockRegistry.blocks = []; }

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
    block.fork = blocks[block.height].length;
    blocks[block.height].push(block);
  }

  static getNextForkId(block) {
    BlockRegistry.ensureInit();
    let {blocks} = BlockRegistry;
    let {height: h} = block;
    return blocks[h] ? blocks[h].length : 0;
  }

  static *allBlocks() {
    BlockRegistry.ensureInit();
    for (let bs of BlockRegistry.blocks) {
      for (let block of bs) yield block;
    }
  }

  static draw(mode = 'time', maxTime = 0) {
    let {blocks} = BlockRegistry;
    if (!blocks || !blocks.length || !blocks[0].length) return;

    let blockWidth = 30;
    let margin = 20;
    let maxWidth = width - 2 * margin;
    let minHeight = Math.max(0, blocks.length - 60);

    let lowestBlocks = blocks[minHeight], highestBlocks = blocks[blocks.length - 1];

    let minTime = mode === 'time' ? lowestBlocks.reduce(((mtime, {time}) => Math.min(mtime, time)), lowestBlocks[0].time) : 0;
    if (!maxTime)
      maxTime = mode === 'time' ? highestBlocks.reduce(((mtime, {time}) => Math.max(mtime, time)), highestBlocks[0].time) : 0;
    //console.log(minTime, maxTime);

    let totalWidthT = Math.min(width - 2 * margin, 10 * maxTime / ticksPerSecond);

    function dxTime(time) {
      return (totalWidthT * (1.0 * (time - minTime))) / (1.0 * (maxTime - minTime));
    }

    function getPos(i, j, {time, fork}) {
      let j1 = fork || j;
      if (mode === 'time') {
        let dx = dxTime(time);
        return createVector(margin + dx, height - 20 - j1 * 25);
      }

      return createVector(margin + (i - minHeight) * blockWidth, height - 20 - j1 * 25);
    };

    for (var i = minHeight; i < blocks.length; i++) {
      if (!blocks[i]) continue;

      for (var j = 0; j < blocks[i].length; j++) {
        let block = blocks[i][j];
        let {props} = block;
        let targetPos = props.targetPos = getPos(i, j, block);

        if (!props.pos) {
          props.pos = targetPos;
        } else {
          props.pos = vlerp(0.5, props.pos, targetPos);
        }

        let {x, y} = props.pos || createVector();

        let {parent, miner} = block;
        if (parent && parent.props.pos && parent.height >= minHeight) {
          let {props: {pos: parentPos}} = parent;
          strokeWeight(1);
          stroke(255);
          line(x, y, parentPos.x, parentPos.y);
        }

        rectMode(CENTER);
        noStroke();
        let [r, g, b] = block.colorCode;
        fill(r, g, b);
        rect(x, y, 4, 10);

        fill(255);
        noStroke();
        textSize(8);
        textAlign(CENTER);
        text(`${miner}`, x, y + 12);

        function objTotal(obj) {
          var s = 0;
          for (let k of Object.keys(obj)) s += obj[k];
          return s;
        }

        if (props.nodes) {
          let {nodes} = props;
          let s = objTotal(nodes);
          if (s) {
            fill(255);
            noStroke();
            textSize(11);
            textAlign(CENTER);
            text(`${s}`, x + 4, y - 6);
          }
        }

        if (props.miners) {
          let {miners} = props;
          let s = objTotal(miners);
          if (s) {
            fill(255, 120, 120);
            noStroke();
            textSize(10);
            textAlign(CENTER);
            text(`${s}`, x + 4, y - 16);
          }
        }
      }
    }

    if (mode === 'time') {
      strokeWeight(1);
      stroke(255, 255, 255, 80);
      let x1 = margin + dxTime(maxTime);
      line(x1, height - 40, x1, height - 20);

      let blockTimeTicks = graph.props.blockTime * ticksPerSecond;
      let t0 = Math.ceil(minTime / ticksPerSecond) * ticksPerSecond;
      for (var t = t0; t < Math.max(maxTime + 5 * ticksPerSecond, t0 + 25 * blockTimeTicks); t += blockTimeTicks) {
        let x1 = margin + dxTime(t);
        line(x1, height - 5, x1, height - 10);
      }
    }
  }
}


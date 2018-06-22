
class Miner {
  constructor(props) {
    if (this.constructor === Miner) {
      console.error('Miner: abstract class.');
    }
  }

  // mTip: block to mine on top of ('private chain')
  // broadcast: block to broadcast
  // update node's tip
  res(mTip, broadcast, newTip) {
    return {mTip, broadcast, newTip};
  }

  /** Returns new mining tip and broadcasted block. */
  onBlockMined(tip, mTip, mined) {
    return this.res(mined, mined);
  }

  /** Returns new mining tip. */
  onNewTip(tip, mTip) {
    return this.res(tip);
  }
}

class HonestMiner extends Miner { }

/** Selfish mining as described by arXiv:1311.0243 */
class SelfishMiner extends Miner {
  onBlockMined(tip, mTip, mined) {
    let lead = mined.height - tip.height;
    if (lead >= 1) {
      return this.res(mined, mined.parentOfHeight(tip.height));
    }

    return this.res(mined);
  }

  onNewTip(tip, mTip) {
    let lead = mTip.height - tip.height;
    if (lead < 0) {
      // they win
      return this.res(tip);
    } else if (lead === 0) {
      // same length
      return this.res(mTip, mTip);
    } else {
      // selectively reveal private chain
      return this.res(mTip, mTip.parentOfHeight(tip.height));
    }
  }
}

/**
 * Mine on top of 'mineBehind' blocks behind public (that is not just published) chain.
 * When private chain's lead is >= 'publishLead', broadcast the entire private
 * chain.
 * When private chain's lag is >= 'abandonLag', abandon public chain and
 * re-create new private chain.
 */
class LeadSelfishMiner extends Miner {
  constructor(props) {
    super(props);
    let {mineBehind = 3, abandonLag = 4, publishLead = 5, selectiveLead = 1} = props || {};
    this.mineBehind = mineBehind;
    this.abandonLag = abandonLag;
    this.publishLead = publishLead;
    this.selectiveLead = selectiveLead;
  }

  onBlockMined(tip, mTip, mined) {
    let {publishLead, abandonLag, selectiveLead} = this;
    let lead = mined.height - tip.height;
    let isMining = tip !== mTip;
    if (lead <= -abandonLag) {
      console.error("LeadSelfishMiner::onBlockMined: can't happen.");
    }

    if (lead >= publishLead) {
      if (typeof selectiveLead === 'number') {
        // selectively broadcast private chain, transition to lower mining state
        //   'publishLead - selectiveLead'
        let newTip = mined.parentOfHeight(tip.height + selectiveLead);
        return this.res(mined, newTip);
      } else {
        // broadcast private chain, transition to state 'even'
        return this.res(mined, mined);
      }
    } else {
      // still in mining state, keep private chain,
      // transition to state (lead + 1)
      return this.res(mined);
    }
  }

  onNewTip(tip, mTip) {
    let lead = mTip.height - tip.height;
    let {publishLead, abandonLag, mineBehind} = this;

    if (lead >= publishLead) {
      console.error("LeadSelfishMiner::onNewTip: can't happen.");
    }

    if (lead <= -abandonLag) {
      // abandon private chain due to lag, transition to state 'even'
      return this.res(tip.nthParent(mineBehind));
    } else {
      // still in mining state, keep private chain,
      // transition to state (lead + 1)
      return this.res(mTip);
    }
  }
}


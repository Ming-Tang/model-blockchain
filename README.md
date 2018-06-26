# model-blockchain

Try it online here: https://model-blockchain.herokuapp.com

Computer simulation of a bitcoin network, with focus on nodes, mining and information propagation.

# What is simulated

 - The peer-to-peer network structure of nodes and mining nodes
 - Block propagation delays and orphan blocks
 - Statistical properties of proof-of-work mining
 - Difficulty adjustment
 - Longest chain is based on total chain work
 - Mining strategies: Selfish mining and 51% attack

# What is NOT simulated

 - Actual proof-of-work mining
 - Transactions and transaction verification
 - The time required to download the entire blockchain (or a significant missing part)
 - Realistic propagation time that vary based on amount of data
 - Different consensus rules
 - Fixed block time (in the real world, block time cannot be changed easily)
 - Clock variance across the network

/**
 * Provides a WETH address for the Marketplace.
 * - Live network with WETH_ADDRESS set: nothing to deploy (real WETH is used).
 * - Otherwise: deploy a MockWETH (local / test networks).
 */
module.exports = async ({ getNamedAccounts, deployments, network }) => {
  const { deploy } = deployments
  const { deployer } = await getNamedAccounts()

  if (network.live && process.env.WETH_ADDRESS) return

  await deploy('MockWETH', { from: deployer, args: [], log: true })
}

module.exports.tags = ['WETH']

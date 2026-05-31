const fs = require('fs')
const path = require('path')

/**
 * Deploys the Marketplace with a WETH address (from WETH_ADDRESS, or the local
 * MockWETH) and exports { address, abi, weth } to shared/Marketplace.json.
 */
module.exports = async ({ getNamedAccounts, deployments }) => {
  const { deploy, get, log } = deployments
  const { deployer } = await getNamedAccounts()

  let weth = process.env.WETH_ADDRESS
  if (!weth) {
    weth = (await get('MockWETH')).address
  }

  const marketplace = await deploy('Marketplace', {
    from: deployer,
    args: [weth],
    log: true,
  })

  const artifact = await deployments.getArtifact('Marketplace')
  const dir = path.join(__dirname, '..', 'shared')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'Marketplace.json'),
    JSON.stringify({ address: marketplace.address, weth, abi: artifact.abi }, null, 2)
  )

  log(`Marketplace deployed at ${marketplace.address} (WETH ${weth})`)
  log('Exported to shared/Marketplace.json')
}

module.exports.tags = ['Marketplace']
module.exports.dependencies = ['WETH']

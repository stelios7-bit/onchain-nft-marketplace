const { expect } = require('chai')
const { ethers } = require('hardhat')
const { loadFixture } = require('@nomicfoundation/hardhat-toolbox/network-helpers')

const { ZeroAddress, parseEther } = ethers
const FEE_BPS = 55n
const BPS = 10_000n
const feeOf = (p) => (p * FEE_BPS) / BPS
const proceedsOf = (p) => p - feeOf(p)

const ERC721_ID = 1n
const ERC1155_ID = 7n
const ERC1155_SUPPLY = 100n
const PRICE = parseEther('1')

describe('Marketplace', function () {
  async function fixture() {
    const [owner, seller, buyer, other] = await ethers.getSigners()

    const WETH = await (await ethers.getContractFactory('MockWETH')).deploy()
    const PAY = await (
      await ethers.getContractFactory('MockERC20')
    ).deploy('Pay', 'PAY')
    const ERC721 = await (
      await ethers.getContractFactory('MockERC721')
    ).deploy('Art', 'ART')
    const ERC1155 = await (
      await ethers.getContractFactory('MockERC1155')
    ).deploy()
    const Market = await (
      await ethers.getContractFactory('Marketplace')
    ).deploy(await WETH.getAddress())

    const market = await Market.getAddress()
    const nft721 = await ERC721.getAddress()
    const nft1155 = await ERC1155.getAddress()

    // seller owns the assets and approves the marketplace
    await ERC721.mint(seller.address, ERC721_ID)
    await ERC1155.mint(seller.address, ERC1155_ID, ERC1155_SUPPLY)
    await ERC721.connect(seller).setApprovalForAll(market, true)
    await ERC1155.connect(seller).setApprovalForAll(market, true)

    // buyer funds: ERC20 + WETH, both approved to the marketplace
    await PAY.mint(buyer.address, parseEther('100'))
    await PAY.connect(buyer).approve(market, ethers.MaxUint256)
    await WETH.connect(buyer).deposit({ value: parseEther('10') })
    await WETH.connect(buyer).approve(market, ethers.MaxUint256)

    return {
      owner, seller, buyer, other,
      WETH, PAY, ERC721, ERC1155, Market,
      market, nft721, nft1155,
      weth: await WETH.getAddress(),
      pay: await PAY.getAddress(),
    }
  }

  describe('createSale', function () {
    it('lists an ERC721 sale and emits SaleListed', async function () {
      const { Market, seller, nft721 } = await loadFixture(fixture)
      await expect(
        Market.connect(seller).createSaleERC721(nft721, ERC721_ID, PRICE, ZeroAddress)
      )
        .to.emit(Market, 'SaleListed')
        .withArgs(false, nft721, ERC721_ID, seller.address, 1, PRICE, ZeroAddress, false)
    })

    it('lists an ERC1155 sale', async function () {
      const { Market, seller, nft1155 } = await loadFixture(fixture)
      await expect(
        Market.connect(seller).createSaleERC1155(nft1155, ERC1155_ID, 10, PRICE, ZeroAddress)
      )
        .to.emit(Market, 'SaleListed')
        .withArgs(true, nft1155, ERC1155_ID, seller.address, 10, PRICE, ZeroAddress, false)
    })

    it('updates an existing sale on re-call (updated = true)', async function () {
      const { Market, seller, nft721 } = await loadFixture(fixture)
      await Market.connect(seller).createSaleERC721(nft721, ERC721_ID, PRICE, ZeroAddress)
      const newPrice = parseEther('2')
      await expect(
        Market.connect(seller).createSaleERC721(nft721, ERC721_ID, newPrice, ZeroAddress)
      )
        .to.emit(Market, 'SaleListed')
        .withArgs(false, nft721, ERC721_ID, seller.address, 1, newPrice, ZeroAddress, true)
      const sale = await Market.erc721Sales(nft721, ERC721_ID, seller.address)
      expect(sale.price).to.equal(newPrice)
    })

    it('reverts when a non-owner lists an ERC721', async function () {
      const { Market, other, nft721 } = await loadFixture(fixture)
      await expect(
        Market.connect(other).createSaleERC721(nft721, ERC721_ID, PRICE, ZeroAddress)
      ).to.be.revertedWithCustomError(Market, 'NotAssetOwner')
    })

    it('reverts when listing more ERC1155 than owned', async function () {
      const { Market, seller, nft1155 } = await loadFixture(fixture)
      await expect(
        Market.connect(seller).createSaleERC1155(nft1155, ERC1155_ID, 200, PRICE, ZeroAddress)
      ).to.be.revertedWithCustomError(Market, 'InsufficientBalance')
    })

    it('reverts on zero price / zero amount', async function () {
      const { Market, seller, nft721, nft1155 } = await loadFixture(fixture)
      await expect(
        Market.connect(seller).createSaleERC721(nft721, ERC721_ID, 0, ZeroAddress)
      ).to.be.revertedWithCustomError(Market, 'ZeroPrice')
      await expect(
        Market.connect(seller).createSaleERC1155(nft1155, ERC1155_ID, 0, PRICE, ZeroAddress)
      ).to.be.revertedWithCustomError(Market, 'ZeroAmount')
    })
  })

  describe('buy — ERC721', function () {
    it('ETH sale paid in ETH: seller proceeds, fee accrued, NFT moves', async function () {
      const { Market, seller, buyer, nft721, ERC721 } = await loadFixture(fixture)
      await Market.connect(seller).createSaleERC721(nft721, ERC721_ID, PRICE, ZeroAddress)
      await expect(
        Market.connect(buyer).buyERC721(nft721, ERC721_ID, seller.address, { value: PRICE })
      ).to.changeEtherBalance(seller, proceedsOf(PRICE))
      expect(await ERC721.ownerOf(ERC721_ID)).to.equal(buyer.address)
      expect(await Market.accruedFees(ZeroAddress)).to.equal(feeOf(PRICE))
    })

    it('ETH sale paid in WETH: settles in WETH', async function () {
      const { Market, seller, buyer, nft721, WETH, weth } = await loadFixture(fixture)
      await Market.connect(seller).createSaleERC721(nft721, ERC721_ID, PRICE, ZeroAddress)
      await expect(
        Market.connect(buyer).buyERC721(nft721, ERC721_ID, seller.address)
      ).to.changeTokenBalances(WETH, [seller, Market], [proceedsOf(PRICE), feeOf(PRICE)])
      expect(await Market.accruedFees(weth)).to.equal(feeOf(PRICE))
    })

    it('WETH sale paid in ETH (interchangeable)', async function () {
      const { Market, seller, buyer, nft721, weth } = await loadFixture(fixture)
      await Market.connect(seller).createSaleERC721(nft721, ERC721_ID, PRICE, weth)
      await expect(
        Market.connect(buyer).buyERC721(nft721, ERC721_ID, seller.address, { value: PRICE })
      ).to.changeEtherBalance(seller, proceedsOf(PRICE))
      expect(await Market.accruedFees(ZeroAddress)).to.equal(feeOf(PRICE))
    })

    it('ERC20 sale paid in ERC20', async function () {
      const { Market, seller, buyer, nft721, PAY, pay } = await loadFixture(fixture)
      await Market.connect(seller).createSaleERC721(nft721, ERC721_ID, PRICE, pay)
      await expect(
        Market.connect(buyer).buyERC721(nft721, ERC721_ID, seller.address)
      ).to.changeTokenBalances(PAY, [seller, Market], [proceedsOf(PRICE), feeOf(PRICE)])
    })

    it('refunds excess ETH (contract keeps only the fee)', async function () {
      const { Market, seller, buyer, nft721, market } = await loadFixture(fixture)
      await Market.connect(seller).createSaleERC721(nft721, ERC721_ID, PRICE, ZeroAddress)
      await Market.connect(buyer).buyERC721(nft721, ERC721_ID, seller.address, {
        value: PRICE + parseEther('0.5'),
      })
      expect(await ethers.provider.getBalance(market)).to.equal(feeOf(PRICE))
    })

    it('reverts on insufficient ETH', async function () {
      const { Market, seller, buyer, nft721 } = await loadFixture(fixture)
      await Market.connect(seller).createSaleERC721(nft721, ERC721_ID, PRICE, ZeroAddress)
      await expect(
        Market.connect(buyer).buyERC721(nft721, ERC721_ID, seller.address, {
          value: PRICE - 1n,
        })
      ).to.be.revertedWithCustomError(Market, 'InsufficientPayment')
    })

    it('reverts when sending ETH to an ERC20 sale', async function () {
      const { Market, seller, buyer, nft721, pay } = await loadFixture(fixture)
      await Market.connect(seller).createSaleERC721(nft721, ERC721_ID, PRICE, pay)
      await expect(
        Market.connect(buyer).buyERC721(nft721, ERC721_ID, seller.address, { value: PRICE })
      ).to.be.revertedWithCustomError(Market, 'UnexpectedETH')
    })

    it('reverts buying a non-existent sale', async function () {
      const { Market, seller, buyer, nft721 } = await loadFixture(fixture)
      await expect(
        Market.connect(buyer).buyERC721(nft721, ERC721_ID, seller.address, { value: PRICE })
      ).to.be.revertedWithCustomError(Market, 'SaleNotFound')
    })
  })

  describe('buy — ERC1155', function () {
    it('transfers the listed amount and pays the seller', async function () {
      const { Market, seller, buyer, nft1155, ERC1155 } = await loadFixture(fixture)
      const AMOUNT = 10n
      await Market.connect(seller).createSaleERC1155(nft1155, ERC1155_ID, AMOUNT, PRICE, ZeroAddress)
      await expect(
        Market.connect(buyer).buyERC1155(nft1155, ERC1155_ID, seller.address, { value: PRICE })
      ).to.changeEtherBalance(seller, proceedsOf(PRICE))
      expect(await ERC1155.balanceOf(buyer.address, ERC1155_ID)).to.equal(AMOUNT)
      expect(await ERC1155.balanceOf(seller.address, ERC1155_ID)).to.equal(ERC1155_SUPPLY - AMOUNT)
    })
  })

  describe('fees', function () {
    it('owner withdraws accrued ETH fees', async function () {
      const { Market, owner, seller, buyer, nft721 } = await loadFixture(fixture)
      await Market.connect(seller).createSaleERC721(nft721, ERC721_ID, PRICE, ZeroAddress)
      await Market.connect(buyer).buyERC721(nft721, ERC721_ID, seller.address, { value: PRICE })
      await expect(Market.connect(owner).withdrawFees(ZeroAddress)).to.changeEtherBalance(
        owner,
        feeOf(PRICE)
      )
      expect(await Market.accruedFees(ZeroAddress)).to.equal(0)
    })

    it('owner withdraws accrued ERC20 fees', async function () {
      const { Market, owner, seller, buyer, nft721, PAY, pay } = await loadFixture(fixture)
      await Market.connect(seller).createSaleERC721(nft721, ERC721_ID, PRICE, pay)
      await Market.connect(buyer).buyERC721(nft721, ERC721_ID, seller.address)
      await expect(Market.connect(owner).withdrawFees(pay)).to.changeTokenBalance(
        PAY,
        owner,
        feeOf(PRICE)
      )
    })

    it('reverts withdraw by non-owner', async function () {
      const { Market, other } = await loadFixture(fixture)
      await expect(
        Market.connect(other).withdrawFees(ZeroAddress)
      ).to.be.revertedWithCustomError(Market, 'OwnableUnauthorizedAccount')
    })

    it('reverts withdraw when nothing accrued', async function () {
      const { Market, owner } = await loadFixture(fixture)
      await expect(
        Market.connect(owner).withdrawFees(ZeroAddress)
      ).to.be.revertedWithCustomError(Market, 'NothingToWithdraw')
    })
  })

  describe('no-escrow receiver reverts', function () {
    it('rejects a direct ERC721 transfer into the marketplace', async function () {
      const { ERC721, seller, market } = await loadFixture(fixture)
      await expect(
        ERC721.connect(seller).safeTransferFrom(seller.address, market, ERC721_ID)
      ).to.be.reverted
    })

    it('rejects a direct ERC1155 transfer into the marketplace', async function () {
      const { ERC1155, seller, market } = await loadFixture(fixture)
      await expect(
        ERC1155.connect(seller).safeTransferFrom(seller.address, market, ERC1155_ID, 1, '0x')
      ).to.be.reverted
    })
  })
})

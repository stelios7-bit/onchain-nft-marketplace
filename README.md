# Onchain NFT Marketplace

A marketplace for **ERC-721** and **ERC-1155** assets. Sellers register sales
without escrowing their assets; buyers pay in ETH, WETH, or an ERC-20, and the
asset and funds settle in a single transaction.

## Features

- Register a sale for an ERC-1155 asset (contract, id, amount, price, payment token)
- Register a sale for an ERC-721 asset
- Payment token `address(0)` means ETH; **ETH and WETH are interchangeable** at purchase
- **No escrow** — the seller keeps the asset and approves the marketplace
- Re-calling the sale function **updates** the existing sale
- `buy`: funds to the seller, asset to the buyer, in one call
- **0.55%** fee reserved for the marketplace owner (withdrawable per currency)
- Direct `onERC1155Received` / `onERC721Received` transfers **revert**

## Design notes

- **No escrow.** Assets never enter the marketplace. The seller keeps custody and
  grants `setApprovalForAll`; on `buy`, the asset moves seller → buyer directly.
  The receiver hooks revert so nothing can be parked in the contract.
- **ETH ⇄ WETH.** A sale priced in ETH (`address(0)`) can be paid in WETH, and a
  WETH-priced sale can be paid in native ETH. Other ERC-20s settle in that token.
- **Fee.** `FEE_BPS = 55` (0.55%). The seller receives `price − fee`; the fee
  accrues per currency and the owner withdraws with `withdrawFees(token)`.
- **Pricing.** `price` is the total for the listed ERC-1155 `amount`; a buy takes
  the whole listing. ERC-721 sales list a single token.

## Stack

- Solidity `0.8.24` (evmVersion `cancun`) + Hardhat
- OpenZeppelin contracts (`Ownable`, `ReentrancyGuard`, `SafeERC20`)
- hardhat-deploy
- chai / mocha tests

## Setup

```bash
npm install
```

## Test

```bash
npm test          # 21 tests
```

## Deploy (local)

```bash
npm run node               # terminal 1 — local node
npm run deploy:localhost   # terminal 2 — deploys MockWETH + Marketplace
```

On live networks set `WETH_ADDRESS` (see `.env.example`) to use real WETH; the
deploy writes `{ address, weth, abi }` to `shared/Marketplace.json`.

## Contract API

```solidity
// list / update (no escrow; seller must own the asset + approve the marketplace)
createSaleERC721(address nft, uint256 id, uint256 price, address paymentToken)
createSaleERC1155(address nft, uint256 id, uint256 amount, uint256 price, address paymentToken)

// buy (payable; pay in ETH, WETH, or the listed ERC-20)
buyERC721(address nft, uint256 id, address seller)
buyERC1155(address nft, uint256 id, address seller)

// fees
withdrawFees(address token)   // owner only; address(0) == ETH
```

## Project structure

```
contracts/Marketplace.sol      the marketplace
contracts/mocks/               ERC20 / ERC721 / ERC1155 / WETH test doubles
test/Marketplace.test.js       21 tests
deploy/                        hardhat-deploy scripts (WETH + Marketplace)
```

## License

MIT

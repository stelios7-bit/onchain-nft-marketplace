# Onchain NFT Marketplace

A marketplace for **ERC-721** and **ERC-1155** assets. Sellers register sales
without escrowing their assets; buyers pay in ETH, WETH, or an ERC-20, and the
asset and funds settle in a single transaction.

## Features (planned)

- Register a sale for an ERC-1155 asset (contract, id, amount, price, payment token)
- Register a sale for an ERC-721 asset
- Payment token `address(0)` means ETH; ETH and WETH are interchangeable
- No escrow — the seller keeps the asset and approves the marketplace
- Re-calling the sale function updates the existing sale
- `buy`: funds to the seller, asset to the buyer, in one call
- 0.55% fee reserved for the marketplace owner (withdrawable)
- Incoming `onERC1155Received` / `onERC721Received` transfers revert

## Stack

- Solidity + Hardhat
- OpenZeppelin contracts
- hardhat-deploy
- chai / mocha tests

## Status

In active development, PR-driven. See the issues and milestones for scope.

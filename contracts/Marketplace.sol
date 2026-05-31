// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";

/// @title Onchain NFT Marketplace
/// @notice No-escrow marketplace for ERC-721 and ERC-1155 assets. Sellers
///         register sales while keeping custody of their assets (and granting
///         the marketplace an approval); buyers settle asset + payment in one
///         call. Payment token `address(0)` means ETH, and ETH and WETH are
///         treated as interchangeable at purchase time.
/// @dev    `price` is the TOTAL price for the listed `amount` of an ERC-1155
///         sale (ERC-721 sales always list a single token).
contract Marketplace is Ownable, ReentrancyGuard {
    /// @notice Marketplace fee in basis points (0.55%).
    uint256 public constant FEE_BPS = 55;
    uint256 internal constant BPS_DENOMINATOR = 10_000;

    /// @notice WETH address; sales priced in ETH are payable in WETH and vice versa.
    address public immutable weth;

    struct Sale {
        address seller;
        uint256 amount; // ERC-1155 quantity; 1 for ERC-721
        uint256 price; // total price for `amount`
        address paymentToken; // address(0) == ETH
        bool active;
    }

    // nft contract => token id => seller => Sale
    mapping(address => mapping(uint256 => mapping(address => Sale))) public erc721Sales;
    mapping(address => mapping(uint256 => mapping(address => Sale))) public erc1155Sales;

    event SaleListed(
        bool indexed isERC1155,
        address indexed nft,
        uint256 id,
        address indexed seller,
        uint256 amount,
        uint256 price,
        address paymentToken,
        bool updated
    );

    error ZeroAmount();
    error ZeroPrice();
    error NotAssetOwner();
    error InsufficientBalance();

    constructor(address weth_) Ownable(msg.sender) {
        weth = weth_;
    }

    /// @notice Create or update a sale for an ERC-1155 asset. No transfer occurs;
    ///         the seller must own at least `amount` of the asset.
    /// @param nft ERC-1155 contract address.
    /// @param id Token id being sold.
    /// @param amount Number of units offered.
    /// @param price Total price for `amount` units.
    /// @param paymentToken ERC-20 accepted as payment, or address(0) for ETH.
    function createSaleERC1155(
        address nft,
        uint256 id,
        uint256 amount,
        uint256 price,
        address paymentToken
    ) external {
        if (amount == 0) revert ZeroAmount();
        if (price == 0) revert ZeroPrice();
        if (IERC1155(nft).balanceOf(msg.sender, id) < amount) {
            revert InsufficientBalance();
        }

        bool updated = erc1155Sales[nft][id][msg.sender].active;
        erc1155Sales[nft][id][msg.sender] = Sale({
            seller: msg.sender,
            amount: amount,
            price: price,
            paymentToken: paymentToken,
            active: true
        });

        emit SaleListed(true, nft, id, msg.sender, amount, price, paymentToken, updated);
    }

    /// @notice Create or update a sale for an ERC-721 asset. No transfer occurs;
    ///         the seller must own the token.
    /// @param nft ERC-721 contract address.
    /// @param id Token id being sold.
    /// @param price Sale price.
    /// @param paymentToken ERC-20 accepted as payment, or address(0) for ETH.
    function createSaleERC721(
        address nft,
        uint256 id,
        uint256 price,
        address paymentToken
    ) external {
        if (price == 0) revert ZeroPrice();
        if (IERC721(nft).ownerOf(id) != msg.sender) revert NotAssetOwner();

        bool updated = erc721Sales[nft][id][msg.sender].active;
        erc721Sales[nft][id][msg.sender] = Sale({
            seller: msg.sender,
            amount: 1,
            price: price,
            paymentToken: paymentToken,
            active: true
        });

        emit SaleListed(false, nft, id, msg.sender, 1, price, paymentToken, updated);
    }
}

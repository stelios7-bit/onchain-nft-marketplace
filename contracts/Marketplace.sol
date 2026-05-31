// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title Onchain NFT Marketplace
/// @notice No-escrow marketplace for ERC-721 and ERC-1155 assets. Sellers
///         register sales while keeping custody of their assets (and granting
///         the marketplace an approval); buyers settle asset + payment in one
///         call. Payment token `address(0)` means ETH, and ETH and WETH are
///         treated as interchangeable at purchase time.
/// @dev    `price` is the TOTAL price for the listed `amount` of an ERC-1155
///         sale (ERC-721 sales always list a single token).
contract Marketplace is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

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

    /// @notice Fees collected per payment currency (address(0) == ETH).
    mapping(address => uint256) public accruedFees;

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

    event Purchase(
        bool indexed isERC1155,
        address indexed nft,
        uint256 id,
        address seller,
        address indexed buyer,
        uint256 amount,
        uint256 price,
        address paidIn
    );

    event FeeWithdrawn(address indexed token, address indexed to, uint256 amount);

    error ZeroAmount();
    error ZeroPrice();
    error NotAssetOwner();
    error InsufficientBalance();
    error SaleNotFound();
    error InsufficientPayment();
    error UnexpectedETH();
    error NothingToWithdraw();
    error TransferFailed();

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

    // --- buying -------------------------------------------------------------

    /// @notice Buy an ERC-721 asset listed by `seller`. Pays the seller and
    ///         transfers the token to the buyer.
    function buyERC721(address nft, uint256 id, address seller)
        external
        payable
        nonReentrant
    {
        Sale memory sale = erc721Sales[nft][id][seller];
        if (!sale.active) revert SaleNotFound();
        delete erc721Sales[nft][id][seller];

        _settle(sale.paymentToken, sale.price, sale.seller);
        IERC721(nft).safeTransferFrom(sale.seller, msg.sender, id);

        emit Purchase(false, nft, id, sale.seller, msg.sender, 1, sale.price, _paidIn(sale.paymentToken));
    }

    /// @notice Buy the full listed amount of an ERC-1155 asset from `seller`.
    function buyERC1155(address nft, uint256 id, address seller)
        external
        payable
        nonReentrant
    {
        Sale memory sale = erc1155Sales[nft][id][seller];
        if (!sale.active) revert SaleNotFound();
        delete erc1155Sales[nft][id][seller];

        _settle(sale.paymentToken, sale.price, sale.seller);
        IERC1155(nft).safeTransferFrom(sale.seller, msg.sender, id, sale.amount, "");

        emit Purchase(true, nft, id, sale.seller, msg.sender, sale.amount, sale.price, _paidIn(sale.paymentToken));
    }

    // --- payment + fees -----------------------------------------------------

    /// @dev Routes payment from the buyer to the seller, takes the fee, and
    ///      supports paying an ETH sale in WETH (and a WETH sale in ETH).
    function _settle(address paymentToken, uint256 price, address seller) internal {
        uint256 fee = (price * FEE_BPS) / BPS_DENOMINATOR;
        uint256 proceeds = price - fee;
        bool ethClass = paymentToken == address(0) || paymentToken == weth;

        if (ethClass && msg.value > 0) {
            // pay in native ETH
            if (msg.value < price) revert InsufficientPayment();
            accruedFees[address(0)] += fee;
            _sendETH(seller, proceeds);
            if (msg.value > price) _sendETH(msg.sender, msg.value - price);
        } else if (ethClass) {
            // pay an ETH/WETH sale in WETH
            IERC20(weth).safeTransferFrom(msg.sender, seller, proceeds);
            if (fee > 0) IERC20(weth).safeTransferFrom(msg.sender, address(this), fee);
            accruedFees[weth] += fee;
        } else {
            // plain ERC-20 sale
            if (msg.value != 0) revert UnexpectedETH();
            IERC20(paymentToken).safeTransferFrom(msg.sender, seller, proceeds);
            if (fee > 0) IERC20(paymentToken).safeTransferFrom(msg.sender, address(this), fee);
            accruedFees[paymentToken] += fee;
        }
    }

    /// @notice Withdraw collected fees for a given currency (address(0) == ETH).
    function withdrawFees(address token) external onlyOwner nonReentrant {
        uint256 amount = accruedFees[token];
        if (amount == 0) revert NothingToWithdraw();
        accruedFees[token] = 0;

        if (token == address(0)) {
            _sendETH(owner(), amount);
        } else {
            IERC20(token).safeTransfer(owner(), amount);
        }
        emit FeeWithdrawn(token, owner(), amount);
    }

    /// @dev Currency the buyer actually paid in, for the Purchase event.
    function _paidIn(address paymentToken) internal view returns (address) {
        bool ethClass = paymentToken == address(0) || paymentToken == weth;
        if (ethClass) return msg.value > 0 ? address(0) : weth;
        return paymentToken;
    }

    function _sendETH(address to, uint256 amount) internal {
        (bool ok, ) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}

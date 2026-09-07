// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Interface sketch only. The real implementation must verify
/// domain-separated user authorization and reject arbitrary calldata.
interface ITapTradeCashierTradeAuthorization {
    event TradeAuthorizationConsumed(
        bytes32 indexed authorizationHash,
        address indexed smartWallet,
        address indexed target,
        bytes4 selector,
        uint256 amount,
        uint256 deadline
    );

    function isAuthorizedTrade(
        bytes32 authorizationHash,
        address smartWallet,
        address target,
        bytes4 selector,
        uint256 amount,
        uint256 deadline,
        bytes calldata signature
    ) external view returns (bool);

    function consumeTradeAuthorization(
        bytes32 authorizationHash,
        address smartWallet,
        address target,
        bytes4 selector,
        uint256 amount,
        uint256 deadline
    ) external;
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Interface sketch only. Do not deploy before implementation review and audit.
interface ITapTradeCashierCollateral {
    event CollateralMinted(
        bytes32 indexed depositIntentId,
        address indexed smartWallet,
        uint256 amount
    );

    event CollateralBurned(
        bytes32 indexed withdrawalIntentId,
        address indexed smartWallet,
        uint256 amount
    );

    function collateralAsset() external view returns (address);

    function mintFromSettledBridge(
        bytes32 depositIntentId,
        address smartWallet,
        uint256 amount
    ) external;

    function burnForWithdrawal(
        bytes32 withdrawalIntentId,
        address smartWallet,
        uint256 amount
    ) external;
}

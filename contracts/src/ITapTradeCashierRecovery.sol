// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Interface sketch only. Recovery actions require off-chain policy,
/// audit evidence, and multi-operator approval before any implementation ships.
interface ITapTradeCashierRecovery {
    enum RecoveryAction {
        SettleToSmartWallet,
        RefundToUserControlledAddress,
        Quarantine,
        Deny
    }

    event RecoveryActionRecorded(
        bytes32 indexed recoveryId,
        bytes32 indexed subjectId,
        RecoveryAction action,
        bytes32 evidenceHash
    );

    function recordRecoveryAction(
        bytes32 recoveryId,
        bytes32 subjectId,
        RecoveryAction action,
        bytes32 evidenceHash
    ) external;
}

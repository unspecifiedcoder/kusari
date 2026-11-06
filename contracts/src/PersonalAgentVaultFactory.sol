// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {AgentVault} from "./AgentVault.sol";

/// @notice A separate factory for atomic onboarding; the original shared-demo factory is unchanged.
contract PersonalAgentVaultFactory {
    IPoolManager public immutable poolManager;
    address public immutable hook;
    address public coordinator;
    address public initializer;
    mapping(address owner => address[]) internal _vaultsOf;

    error OnlyInitializer();
    error OnlyCoordinator();
    error InvalidIdentity();
    event VaultCreated(address indexed owner, address indexed vault, address indexed agent);

    constructor(IPoolManager _poolManager, address _hook) {
        poolManager = _poolManager;
        hook = _hook;
        initializer = msg.sender;
    }

    /// @dev One-time deployment wiring. The initializer is permanently erased afterwards.
    function initializeCoordinator(address who) external {
        if (msg.sender != initializer || coordinator != address(0)) revert OnlyInitializer();
        if (who.code.length == 0) revert InvalidIdentity();
        coordinator = who;
        initializer = address(0);
    }

    function createFor(address owner, address agent) external returns (AgentVault vault) {
        if (msg.sender != coordinator) revert OnlyCoordinator();
        if (owner == address(0) || agent == address(0) || owner == agent) revert InvalidIdentity();
        vault = new AgentVault(poolManager, owner, agent, hook);
        _vaultsOf[owner].push(address(vault));
        emit VaultCreated(owner, address(vault), agent);
    }

    function vaultsOf(address owner) external view returns (address[] memory) {
        return _vaultsOf[owner];
    }
}

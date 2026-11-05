// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";

import {AgentVault} from "./AgentVault.sol";

/// @title AgentVaultFactory
/// @notice Anyone can create their own vault. The caller becomes its owner.
contract AgentVaultFactory {
    IPoolManager public immutable poolManager;
    address public immutable hook;

    mapping(address owner => address[] vaults) internal _vaultsOf;

    event VaultCreated(address indexed owner, address indexed vault, address indexed agent);

    constructor(IPoolManager _poolManager, address _hook) {
        poolManager = _poolManager;
        hook = _hook;
    }

    function create(address agent) external returns (AgentVault vault) {
        vault = new AgentVault(poolManager, msg.sender, agent, hook);
        _vaultsOf[msg.sender].push(address(vault));
        emit VaultCreated(msg.sender, address(vault), agent);
    }

    function vaultsOf(address owner) external view returns (address[] memory) {
        return _vaultsOf[owner];
    }
}

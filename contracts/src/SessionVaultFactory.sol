// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {SessionAgentVault} from "./SessionAgentVault.sol";

/// @notice Optional session vaults; does not modify or replace the original Kusari vault factory.
contract SessionVaultFactory {
    IPoolManager public immutable poolManager;
    address public immutable hook;
    Currency public immutable token0;
    Currency public immutable token1;
    PoolId public immutable allowedPool;
    mapping(address owner => address[]) private _vaultsOf;
    event VaultCreated(address indexed owner, address indexed vault, address indexed agent);

    constructor(IPoolManager _poolManager, address _hook, Currency _token0, Currency _token1, PoolId _allowedPool) {
        if (address(_poolManager).code.length == 0 || _hook.code.length == 0 || Currency.unwrap(_token0) >= Currency.unwrap(_token1) || PoolId.unwrap(_allowedPool) == bytes32(0)) revert SessionAgentVault.InvalidPool();
        poolManager = _poolManager; hook = _hook; token0 = _token0; token1 = _token1; allowedPool = _allowedPool;
    }

    function create(address agent) external returns (SessionAgentVault vault) {
        // SessionAgentVault's constructor enforces nonzero, distinct owner and agent.
        vault = new SessionAgentVault(poolManager, msg.sender, agent, hook, token0, token1, allowedPool);
        _vaultsOf[msg.sender].push(address(vault));
        emit VaultCreated(msg.sender, address(vault), agent);
    }

    function vaultsOf(address owner) external view returns (address[] memory) { return _vaultsOf[owner]; }
}

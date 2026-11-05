// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapIntent} from "./PolicyTypes.sol";

interface IAgentVault {
    error OnlyAgent();
    error OnlyOwner();
    error OnlyPoolManager();
    error WrongHook();
    error IntentNotForVault();

    event Swapped(address indexed agent, uint256 amountIn, int128 amount0, int128 amount1);
    event Withdrawn(address indexed to, Currency indexed currency, uint256 amount);

    function owner() external view returns (address);
    function agent() external view returns (address);
    function hook() external view returns (address);

    /// @notice Only the agent may call. Only pools whose hook is the PolicyHook are allowed.
    function swap(PoolKey calldata key, SwapIntent calldata intent, bytes calldata signature)
        external
        returns (BalanceDelta);

    /// @notice Only the owner may withdraw. The agent never can.
    function withdraw(Currency currency, address to, uint256 amount) external;
}

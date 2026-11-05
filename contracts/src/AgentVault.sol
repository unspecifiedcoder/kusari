// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPoolManager, SwapParams} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

import {IAgentVault} from "./interfaces/IAgentVault.sol";
import {SwapIntent} from "./interfaces/PolicyTypes.sol";

/// @title AgentVault
/// @notice Holds the funds so the agent never does. The agent can only swap, only through
/// pools guarded by the PolicyHook, and only by talking to the PoolManager directly (no router).
contract AgentVault is IAgentVault, IUnlockCallback {
    using CurrencyLibrary for Currency;

    IPoolManager public immutable poolManager;
    address public immutable owner;
    address public immutable agent;
    address public immutable hook;

    constructor(IPoolManager _poolManager, address _owner, address _agent, address _hook) {
        poolManager = _poolManager;
        owner = _owner;
        agent = _agent;
        hook = _hook;
    }

    receive() external payable {}

    function swap(PoolKey calldata key, SwapIntent calldata intent, bytes calldata signature)
        external
        returns (BalanceDelta delta)
    {
        if (msg.sender != agent) revert OnlyAgent();
        if (address(key.hooks) != hook) revert WrongHook();
        if (intent.vault != address(this) || intent.agent != agent) revert IntentNotForVault();

        delta = abi.decode(poolManager.unlock(abi.encode(key, intent, signature)), (BalanceDelta));
        emit Swapped(agent, intent.amountIn, delta.amount0(), delta.amount1());
    }

    /// @dev Only reachable through our own unlock() call: the PoolManager calls back msg.sender.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        (PoolKey memory key, SwapIntent memory intent, bytes memory signature) =
            abi.decode(data, (PoolKey, SwapIntent, bytes));

        BalanceDelta delta = poolManager.swap(
            key,
            SwapParams({
                zeroForOne: intent.zeroForOne,
                amountSpecified: -int256(intent.amountIn), // exact input
                sqrtPriceLimitX96: intent.zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            abi.encode(intent, signature)
        );

        _settleOrTake(key.currency0, delta.amount0());
        _settleOrTake(key.currency1, delta.amount1());
        return abi.encode(delta);
    }

    function withdraw(Currency currency, address to, uint256 amount) external {
        if (msg.sender != owner) revert OnlyOwner();
        currency.transfer(to, amount);
        emit Withdrawn(to, currency, amount);
    }

    /// @dev Negative delta: we owe the pool. Positive: the pool owes us.
    function _settleOrTake(Currency currency, int128 amount) internal {
        if (amount < 0) {
            uint256 owed = uint256(uint128(-amount));
            if (currency.isAddressZero()) {
                poolManager.settle{value: owed}();
            } else {
                poolManager.sync(currency);
                currency.transfer(address(poolManager), owed);
                poolManager.settle();
            }
        } else if (amount > 0) {
            poolManager.take(currency, address(this), uint256(uint128(amount)));
        }
    }
}

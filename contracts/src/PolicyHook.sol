// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BaseHook} from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager, SwapParams} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";

import {IPolicySource} from "./interfaces/IPolicySource.sol";
import {IPolicyHook} from "./interfaces/IPolicyHook.sol";
import {Policy, SwapIntent} from "./interfaces/PolicyTypes.sol";

/// @title PolicyHook
/// @notice Enforces an agent's on-chain policy on every swap it makes.
/// Swaps with empty hookData are ordinary public swaps and pass through untouched.
/// Agent funds can only reach the pool via an AgentVault, which always attaches a SwapIntent.
contract PolicyHook is BaseHook {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    IPolicySource public immutable policySource;

    /// @notice agent => day (unix days) => amount spent
    mapping(address => mapping(uint256 => uint256)) public spentOn;

    // Carried from beforeSwap to afterSwap within the same swap (EIP-1153 transient storage).
    uint160 transient _sqrtPriceBefore;
    uint16 transient _maxImpactBps;

    constructor(IPoolManager _poolManager, IPolicySource _policySource) BaseHook(_poolManager) {
        policySource = _policySource;
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    function _beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (hookData.length != 0) {
            (SwapIntent memory intent,) = abi.decode(hookData, (SwapIntent, bytes));
            _checkIntentMatchesSwap(sender, key, params, intent);
            uint16 maxImpactBps = _enforcePolicy(key, intent);

            // Remember the pre-swap price for the impact check in afterSwap.
            (uint160 sqrtPriceBefore,,,) = poolManager.getSlot0(key.toId());
            _sqrtPriceBefore = sqrtPriceBefore;
            _maxImpactBps = maxImpactBps;
        }
        return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    /// @dev A hook can't see the trader's minAmountOut, so it bounds price impact instead.
    /// Reverting here rolls back the entire swap.
    function _afterSwap(address, PoolKey calldata key, SwapParams calldata, BalanceDelta, bytes calldata hookData)
        internal
        override
        returns (bytes4, int128)
    {
        if (hookData.length != 0) {
            (uint160 sqrtPriceAfter,,,) = poolManager.getSlot0(key.toId());
            if (priceImpactBps(_sqrtPriceBefore, sqrtPriceAfter) > _maxImpactBps) {
                revert IPolicyHook.PriceImpactTooHigh();
            }
            _sqrtPriceBefore = 0;
            _maxImpactBps = 0;
        }
        return (BaseHook.afterSwap.selector, 0);
    }

    /// @notice |price_after / price_before - 1| in basis points, where price = sqrtPrice^2.
    function priceImpactBps(uint160 sqrtBefore, uint160 sqrtAfter) public pure returns (uint256) {
        uint256 ratioBps = FullMath.mulDiv(FullMath.mulDiv(sqrtAfter, sqrtAfter, sqrtBefore), 10_000, sqrtBefore);
        return ratioBps > 10_000 ? ratioBps - 10_000 : 10_000 - ratioBps;
    }

    /// @dev The swap actually executed must be exactly what the agent signed, sent by the vault it named.
    function _checkIntentMatchesSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        SwapIntent memory intent
    ) internal pure {
        if (params.amountSpecified >= 0) revert IPolicyHook.ExactInputOnly();
        if (
            sender != intent.vault || PoolId.unwrap(intent.poolId) != PoolId.unwrap(key.toId())
                || params.zeroForOne != intent.zeroForOne || uint256(-params.amountSpecified) != intent.amountIn
        ) revert IPolicyHook.IntentMismatch();
    }

    function _enforcePolicy(PoolKey calldata key, SwapIntent memory intent) internal returns (uint16) {
        if (!policySource.isAuthorized(intent.agent)) revert IPolicyHook.NotAuthorized();
        Policy memory p = policySource.policyOf(intent.agent);
        if (!p.active) revert IPolicyHook.PolicyInactive();
        if (PoolId.unwrap(p.allowedPool) != PoolId.unwrap(key.toId())) revert IPolicyHook.PoolNotAllowed();
        if (intent.amountIn > p.maxPerSwap) revert IPolicyHook.ExceedsPerSwap();

        uint256 day = block.timestamp / 1 days;
        uint256 spent = spentOn[intent.agent][day] + intent.amountIn;
        if (spent > p.dailyCap) revert IPolicyHook.ExceedsDaily();
        spentOn[intent.agent][day] = spent;

        emit IPolicyHook.SwapApproved(intent.agent, intent.vault, intent.amountIn, spent);
        return p.maxImpactBps;
    }
}

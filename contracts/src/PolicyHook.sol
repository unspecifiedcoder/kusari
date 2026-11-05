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

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

import {IPolicySource} from "./interfaces/IPolicySource.sol";
import {IPolicyHook} from "./interfaces/IPolicyHook.sol";
import {Policy, SwapIntent, PolicyTypes} from "./interfaces/PolicyTypes.sol";

/// @title PolicyHook
/// @notice Enforces an agent's on-chain policy on every swap it makes.
/// Swaps with empty hookData are ordinary public swaps and pass through untouched.
/// Agent funds can only reach the pool via an AgentVault, which always attaches a SwapIntent.
contract PolicyHook is BaseHook, EIP712, IPolicyHook {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    IPolicySource public immutable policySource;

    /// @notice agent => day (unix days) => amount spent
    mapping(address => mapping(uint256 => uint256)) public spentOn;

    /// @notice agent => nonce => used
    mapping(address => mapping(uint256 => bool)) public nonceUsed;

    // Carried from beforeSwap to afterSwap within the same swap (EIP-1153 transient storage).
    uint160 transient _sqrtPriceBefore;
    uint16 transient _maxImpactBps;

    constructor(IPoolManager _poolManager, IPolicySource _policySource)
        BaseHook(_poolManager)
        EIP712("Kusari", "1")
    {
        policySource = _policySource;
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
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
            (SwapIntent memory intent, bytes memory signature) = abi.decode(hookData, (SwapIntent, bytes));
            _checkIntentMatchesSwap(sender, key, params, intent);
            _verifyAndConsume(intent, signature);
            uint16 maxImpactBps = _enforcePolicy(key, intent);

            // Remember the pre-swap price for the impact check in afterSwap.
            (uint160 sqrtPriceBefore,,,) = poolManager.getSlot0(key.toId());
            _sqrtPriceBefore = sqrtPriceBefore;
            _maxImpactBps = maxImpactBps;
        }
        return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    /// @dev Post-trade checks on the swap that actually happened. Reverting here rolls back the entire swap.
    /// 1. price impact: the pool price may not move more than the policy's maxImpactBps
    /// 2. output: the vault must receive at least the minAmountOut the agent signed (bounds sandwich loss)
    function _afterSwap(address, PoolKey calldata key, SwapParams calldata, BalanceDelta delta, bytes calldata hookData)
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

            (SwapIntent memory intent,) = abi.decode(hookData, (SwapIntent, bytes));
            // zeroForOne only (enforced in beforeSwap): the vault receives token1, a positive amount1 for the caller
            int128 out = delta.amount1();
            if (out <= 0 || uint256(uint128(out)) < intent.minAmountOut) revert IPolicyHook.InsufficientOutput();
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
        // Caps are denominated in token0 (the vault's funding token), so the agent may only sell token0.
        // Selling the bought token1 back is the owner's call (withdraw), not the agent's.
        if (!intent.zeroForOne) revert IPolicyHook.DirectionNotAllowed();
        if (
            sender != intent.vault || PoolId.unwrap(intent.poolId) != PoolId.unwrap(key.toId())
                || params.zeroForOne != intent.zeroForOne || uint256(-params.amountSpecified) != intent.amountIn
        ) revert IPolicyHook.IntentMismatch();
    }

    /// @dev Proves the agent signed this exact intent. Proves identity, not intent: the policy is what protects funds.
    function _verifyAndConsume(SwapIntent memory intent, bytes memory signature) internal {
        if (block.timestamp > intent.deadline) revert Expired();
        if (nonceUsed[intent.agent][intent.nonce]) revert NonceUsed();
        bytes32 digest = _hashTypedDataV4(PolicyTypes.hash(intent));
        if (!SignatureChecker.isValidSignatureNow(intent.agent, digest, signature)) revert BadSignature();
        nonceUsed[intent.agent][intent.nonce] = true;
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

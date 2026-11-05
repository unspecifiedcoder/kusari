// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {LiquidityAmounts} from "@uniswap/v4-core/test/utils/LiquidityAmounts.sol";
import {Constants} from "@uniswap/v4-core/test/utils/Constants.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {CustomRevert} from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import {Policy, SwapIntent} from "../../src/interfaces/PolicyTypes.sol";

import {EasyPosm} from "./libraries/EasyPosm.sol";
import {BaseTest} from "./BaseTest.sol";

import {PolicyHook} from "../../src/PolicyHook.sol";
import {MockPolicySource} from "../../src/mocks/MockPolicySource.sol";

/// @notice Local v4 stack + PolicyHook + a full-range pool. Shared by all Kusari tests.
abstract contract KusariFixture is BaseTest {
    using EasyPosm for IPositionManager;
    using PoolIdLibrary for PoolKey;

    Currency currency0;
    Currency currency1;
    PoolKey poolKey;
    PoolId poolId;

    PolicyHook hook;
    MockPolicySource source;

    uint128 constant LIQUIDITY = 100e18;

    function _setUpKusari() internal {
        deployArtifactsAndLabel();
        (currency0, currency1) = deployCurrencyPair();

        source = new MockPolicySource();

        address flags = address(uint160(Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG) ^ (0x4444 << 144));
        deployCodeTo("PolicyHook.sol:PolicyHook", abi.encode(poolManager, source), flags);
        hook = PolicyHook(flags);
        vm.label(address(hook), "PolicyHook");

        poolKey = PoolKey(currency0, currency1, 3000, 60, IHooks(hook));
        poolId = poolKey.toId();
        poolManager.initialize(poolKey, Constants.SQRT_PRICE_1_1);

        int24 lower = TickMath.minUsableTick(poolKey.tickSpacing);
        int24 upper = TickMath.maxUsableTick(poolKey.tickSpacing);
        (uint256 a0, uint256 a1) = LiquidityAmounts.getAmountsForLiquidity(
            Constants.SQRT_PRICE_1_1, TickMath.getSqrtPriceAtTick(lower), TickMath.getSqrtPriceAtTick(upper), LIQUIDITY
        );
        positionManager.mint(
            poolKey, lower, upper, LIQUIDITY, a0 + 1, a1 + 1, address(this), block.timestamp, Constants.ZERO_BYTES
        );
    }

    // ---------- helpers ----------

    function _policy(uint128 maxPerSwap, uint128 dailyCap, uint16 maxImpactBps) internal view returns (Policy memory) {
        return Policy({
            maxPerSwap: maxPerSwap, dailyCap: dailyCap, maxImpactBps: maxImpactBps, allowedPool: poolId, active: true
        });
    }

    function _intent(address agent, address vault, uint256 amountIn, uint256 nonce)
        internal
        view
        returns (SwapIntent memory)
    {
        return SwapIntent({
            agent: agent,
            vault: vault,
            poolId: poolId,
            zeroForOne: true,
            amountIn: amountIn,
            nonce: nonce,
            deadline: block.timestamp + 1 hours
        });
    }

    /// @dev Swap via the test router, which then acts as the "vault" (it's the hook's sender).
    function _routerSwap(SwapIntent memory intent, bytes memory sig) internal returns (BalanceDelta) {
        return swapRouter.swapExactTokensForTokens({
            amountIn: intent.amountIn,
            amountOutMin: 0,
            zeroForOne: intent.zeroForOne,
            poolKey: poolKey,
            hookData: abi.encode(intent, sig),
            receiver: address(this),
            deadline: block.timestamp + 1
        });
    }

    /// @dev v4 wraps hook reverts: WrappedError(hook, hookSelector, reason, HookCallFailed).
    function _expectHookRevert(bytes4 hookSelector, bytes memory reason) internal {
        vm.expectRevert(
            abi.encodeWithSelector(
                CustomRevert.WrappedError.selector,
                address(hook),
                hookSelector,
                reason,
                abi.encodeWithSelector(Hooks.HookCallFailed.selector)
            )
        );
    }
}

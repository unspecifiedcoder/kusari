// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";

import {KusariFixture} from "./utils/KusariFixture.sol";
import {IPolicyHook} from "../src/interfaces/IPolicyHook.sol";
import {SwapIntent} from "../src/interfaces/PolicyTypes.sol";

/// Direction lock + signed minimum output (both found in the readiness review).
contract PolicyHookGuardsTest is KusariFixture {
    address vault;

    function setUp() public {
        _setUpKusari();
        vault = address(swapRouter);
        source.setAuthorized(agent, true);
        source.setPolicy(agent, _policy({maxPerSwap: 5e18, dailyCap: 20e18, maxImpactBps: 10_000}));
    }

    /// Caps are in token0 units; selling token1 would sidestep them, so the agent can't.
    function test_reverseDirection_isRejected() public {
        SwapIntent memory i = _intent(agent, vault, 1e18, 0);
        i.zeroForOne = false;
        _expectHookRevert(IHooks.beforeSwap.selector, abi.encodeWithSelector(IPolicyHook.DirectionNotAllowed.selector));
        _swapSigned(i);
    }

    function test_outputBelowSignedMinimum_revertsWholeSwap() public {
        SwapIntent memory i = _intent(agent, vault, 1e18, 0);
        i.minAmountOut = 1e18; // impossible: fee + impact mean < 1e18 out at a 1:1 price
        _expectHookRevert(IHooks.afterSwap.selector, abi.encodeWithSelector(IPolicyHook.InsufficientOutput.selector));
        _swapSigned(i);
        assertEq(hook.spentOn(agent, block.timestamp / 1 days), 0);
    }

    function test_outputAtOrAboveSignedMinimum_passes() public {
        SwapIntent memory i = _intent(agent, vault, 1e18, 0);
        i.minAmountOut = 0.95e18;
        BalanceDelta d = _swapSigned(i);
        assertGe(uint256(uint128(d.amount1())), 0.95e18);
    }

    function test_tamperedMinimum_breaksSignature() public {
        SwapIntent memory i = _intent(agent, vault, 1e18, 0);
        i.minAmountOut = 0.95e18;
        bytes memory sig = _sign(agentPk, i);
        i.minAmountOut = 0; // relayer/attacker tries to loosen it
        _expectHookRevert(IHooks.beforeSwap.selector, abi.encodeWithSelector(IPolicyHook.BadSignature.selector));
        _routerSwap(i, sig);
    }
}

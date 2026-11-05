// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";

import {KusariFixture} from "./utils/KusariFixture.sol";
import {IPolicyHook} from "../src/interfaces/IPolicyHook.sol";
import {Policy, SwapIntent} from "../src/interfaces/PolicyTypes.sol";

contract PolicyHookCapsTest is KusariFixture {
    address agent = makeAddr("agent");
    address vault; // the test router plays the vault here

    function setUp() public {
        _setUpKusari();
        vault = address(swapRouter);
        source.setAuthorized(agent, true);
        source.setPolicy(agent, _policy({maxPerSwap: 1e18, dailyCap: 2.5e18, maxImpactBps: 10_000}));
    }

    function test_withinCap_passes_andTracksSpend() public {
        vm.expectEmit(true, true, false, true, address(hook));
        emit IPolicyHook.SwapApproved(agent, vault, 1e18, 1e18);
        _routerSwap(_intent(agent, vault, 1e18, 0), "");
        assertEq(hook.spentOn(agent, block.timestamp / 1 days), 1e18);
    }

    function test_overPerSwapCap_reverts() public {
        _expectHookRevert(IHooks.beforeSwap.selector, abi.encodeWithSelector(IPolicyHook.ExceedsPerSwap.selector));
        _routerSwap(_intent(agent, vault, 1e18 + 1, 0), "");
    }

    function test_overDailyCap_reverts() public {
        _routerSwap(_intent(agent, vault, 1e18, 0), "");
        _routerSwap(_intent(agent, vault, 1e18, 1), "");
        _expectHookRevert(IHooks.beforeSwap.selector, abi.encodeWithSelector(IPolicyHook.ExceedsDaily.selector));
        _routerSwap(_intent(agent, vault, 0.6e18, 2), "");
    }

    function test_dailyCap_resetsNextDay() public {
        _routerSwap(_intent(agent, vault, 1e18, 0), "");
        _routerSwap(_intent(agent, vault, 1e18, 1), "");
        vm.warp(block.timestamp + 1 days);
        _routerSwap(_intent(agent, vault, 1e18, 2), "");
        assertEq(hook.spentOn(agent, block.timestamp / 1 days), 1e18);
    }

    function test_unauthorizedAgent_reverts() public {
        source.setAuthorized(agent, false);
        _expectHookRevert(IHooks.beforeSwap.selector, abi.encodeWithSelector(IPolicyHook.NotAuthorized.selector));
        _routerSwap(_intent(agent, vault, 1e18, 0), "");
    }

    function test_inactivePolicy_reverts() public {
        Policy memory p = _policy(1e18, 2.5e18, 10_000);
        p.active = false;
        source.setPolicy(agent, p);
        _expectHookRevert(IHooks.beforeSwap.selector, abi.encodeWithSelector(IPolicyHook.PolicyInactive.selector));
        _routerSwap(_intent(agent, vault, 1e18, 0), "");
    }

    function test_poolNotAllowed_reverts() public {
        Policy memory p = _policy(1e18, 2.5e18, 10_000);
        p.allowedPool = PoolId.wrap(bytes32(uint256(1)));
        source.setPolicy(agent, p);
        _expectHookRevert(IHooks.beforeSwap.selector, abi.encodeWithSelector(IPolicyHook.PoolNotAllowed.selector));
        _routerSwap(_intent(agent, vault, 1e18, 0), "");
    }

    function test_intentFromOtherVault_reverts() public {
        _expectHookRevert(IHooks.beforeSwap.selector, abi.encodeWithSelector(IPolicyHook.IntentMismatch.selector));
        _routerSwap(_intent(agent, makeAddr("otherVault"), 1e18, 0), "");
    }

    function test_publicSwapWithoutIntent_unaffected() public {
        source.setAuthorized(agent, false); // policy state is irrelevant for public swaps
        _routerSwapPublic(5e18);
    }

    function _routerSwapPublic(uint256 amountIn) internal {
        swapRouter.swapExactTokensForTokens({
            amountIn: amountIn,
            amountOutMin: 0,
            zeroForOne: true,
            poolKey: poolKey,
            hookData: "",
            receiver: address(this),
            deadline: block.timestamp + 1
        });
    }
}

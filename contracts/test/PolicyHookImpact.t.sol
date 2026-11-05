// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Constants} from "@uniswap/v4-core/test/utils/Constants.sol";

import {KusariFixture} from "./utils/KusariFixture.sol";
import {IPolicyHook} from "../src/interfaces/IPolicyHook.sol";

contract PolicyHookImpactTest is KusariFixture {
    using StateLibrary for IPoolManager;

    address vault;

    function setUp() public {
        _setUpKusari();
        vault = address(swapRouter);
        source.setAuthorized(agent, true);
        // generous caps; only the 1% impact limit should bite
        source.setPolicy(agent, _policy({maxPerSwap: 50e18, dailyCap: 100e18, maxImpactBps: 100}));
    }

    function test_smallSwap_underImpactLimit_passes() public {
        _swapSigned(_intent(agent, vault, 0.1e18, 0));
        (uint160 sqrtP,,,) = poolManager.getSlot0(poolId);
        assertLe(hook.priceImpactBps(Constants.SQRT_PRICE_1_1, sqrtP), 100);
    }

    function test_largeSwap_overImpactLimit_revertsInAfterSwap() public {
        _expectHookRevert(IHooks.afterSwap.selector, abi.encodeWithSelector(IPolicyHook.PriceImpactTooHigh.selector));
        _swapSigned(_intent(agent, vault, 1e18, 0));
    }

    function test_afterSwapRevert_rollsBackEverything() public {
        uint256 bal0 = currency0.balanceOf(address(this));
        try this.externalSwap(1e18) {
            fail();
        } catch {}
        // the whole swap was undone: no spend recorded, no balance moved, price unchanged
        assertEq(hook.spentOn(agent, block.timestamp / 1 days), 0);
        assertEq(currency0.balanceOf(address(this)), bal0);
        (uint160 sqrtP,,,) = poolManager.getSlot0(poolId);
        assertEq(sqrtP, Constants.SQRT_PRICE_1_1);
    }

    function test_priceImpactBps_math() public view {
        assertEq(hook.priceImpactBps(Constants.SQRT_PRICE_1_1, Constants.SQRT_PRICE_1_1), 0);
        // sqrt price x2 => price x4 => +300%
        assertEq(hook.priceImpactBps(Constants.SQRT_PRICE_1_1, 2 * Constants.SQRT_PRICE_1_1), 30_000);
        // sqrt price /2 => price /4 => -75%
        assertEq(hook.priceImpactBps(Constants.SQRT_PRICE_1_1, Constants.SQRT_PRICE_1_1 / 2), 7_500);
    }

    function externalSwap(uint256 amountIn) external {
        _swapSigned(_intent(agent, vault, amountIn, 0));
    }
}

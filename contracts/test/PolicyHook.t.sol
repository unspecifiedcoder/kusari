// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {Constants} from "@uniswap/v4-core/test/utils/Constants.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";

import {KusariFixture} from "./utils/KusariFixture.sol";

contract PolicyHookTest is KusariFixture {
    function setUp() public {
        _setUpKusari();
    }

    function test_hookAddressHasSwapFlags() public view {
        uint160 a = uint160(address(hook));
        assertTrue(a & Hooks.BEFORE_SWAP_FLAG != 0);
        assertTrue(a & Hooks.AFTER_SWAP_FLAG != 0);
        assertEq(address(hook.policySource()), address(source));
    }

    function test_swapGoesThroughHook() public {
        uint256 amountIn = 1e18;
        BalanceDelta d = swapRouter.swapExactTokensForTokens({
            amountIn: amountIn,
            amountOutMin: 0,
            zeroForOne: true,
            poolKey: poolKey,
            hookData: Constants.ZERO_BYTES,
            receiver: address(this),
            deadline: block.timestamp + 1
        });
        assertEq(int256(d.amount0()), -int256(amountIn));
        assertGt(d.amount1(), 0);
    }
}

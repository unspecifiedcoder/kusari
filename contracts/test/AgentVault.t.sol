// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";

import {KusariFixture} from "./utils/KusariFixture.sol";
import {AgentVault} from "../src/AgentVault.sol";
import {IAgentVault} from "../src/interfaces/IAgentVault.sol";
import {IPolicyHook} from "../src/interfaces/IPolicyHook.sol";
import {SwapIntent} from "../src/interfaces/PolicyTypes.sol";

contract AgentVaultTest is KusariFixture {
    address owner = makeAddr("owner");
    AgentVault vault;

    function setUp() public {
        _setUpKusari();
        vault = new AgentVault(poolManager, owner, agent, address(hook));
        currency0.transfer(address(vault), 10e18);
        source.setAuthorized(agent, true);
        source.setPolicy(agent, _policy({maxPerSwap: 1e18, dailyCap: 3e18, maxImpactBps: 300}));
    }

    function _agentSwap(uint256 amountIn, uint256 nonce) internal returns (BalanceDelta) {
        SwapIntent memory i = _intent(agent, address(vault), amountIn, nonce);
        bytes memory sig = _sign(agentPk, i);
        vm.prank(agent);
        return vault.swap(poolKey, i, sig);
    }

    function test_agentSwapWithinPolicy_settlesInVault() public {
        BalanceDelta d = _agentSwap(1e18, 0);
        assertEq(currency0.balanceOf(address(vault)), 9e18);
        assertEq(currency1.balanceOf(address(vault)), uint256(uint128(d.amount1())));
        assertGt(d.amount1(), 0);
    }

    /// The demo moment: a hijacked agent tries to swap everything. The hook says no.
    function test_hijackedAgent_cannotDrainVault() public {
        SwapIntent memory i = _intent(agent, address(vault), 10e18, 0);
        bytes memory sig = _sign(agentPk, i);
        _expectHookRevert(IHooks.beforeSwap.selector, abi.encodeWithSelector(IPolicyHook.ExceedsPerSwap.selector));
        vm.prank(agent);
        vault.swap(poolKey, i, sig);
        assertEq(currency0.balanceOf(address(vault)), 10e18);
    }

    function test_onlyAgentCanSwap() public {
        SwapIntent memory i = _intent(agent, address(vault), 1e18, 0);
        bytes memory sig = _sign(agentPk, i);
        vm.expectRevert(IAgentVault.OnlyAgent.selector);
        vm.prank(makeAddr("stranger"));
        vault.swap(poolKey, i, sig);
    }

    function test_poolWithoutKusariHook_rejected() public {
        PoolKey memory unguarded = PoolKey(currency0, currency1, 3000, 60, IHooks(address(0)));
        SwapIntent memory i = _intent(agent, address(vault), 1e18, 0);
        bytes memory sig = _sign(agentPk, i);
        vm.expectRevert(IAgentVault.WrongHook.selector);
        vm.prank(agent);
        vault.swap(unguarded, i, sig);
    }

    function test_intentForAnotherVault_rejected() public {
        SwapIntent memory i = _intent(agent, makeAddr("otherVault"), 1e18, 0);
        bytes memory sig = _sign(agentPk, i);
        vm.expectRevert(IAgentVault.IntentNotForVault.selector);
        vm.prank(agent);
        vault.swap(poolKey, i, sig);
    }

    function test_agentCannotWithdraw() public {
        vm.expectRevert(IAgentVault.OnlyOwner.selector);
        vm.prank(agent);
        vault.withdraw(currency0, agent, 1e18);
    }

    function test_ownerCanWithdraw() public {
        vm.prank(owner);
        vault.withdraw(currency0, owner, 4e18);
        assertEq(currency0.balanceOf(owner), 4e18);
        assertEq(currency0.balanceOf(address(vault)), 6e18);
    }

    function test_unlockCallback_onlyPoolManager() public {
        vm.expectRevert(IAgentVault.OnlyPoolManager.selector);
        vault.unlockCallback("");
    }
}

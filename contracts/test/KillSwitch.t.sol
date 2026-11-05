// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";

import {KusariFixture} from "./utils/KusariFixture.sol";
import {AgentVault} from "../src/AgentVault.sol";
import {IPolicyHook} from "../src/interfaces/IPolicyHook.sol";
import {SwapIntent} from "../src/interfaces/PolicyTypes.sol";

/// Demo beat 4: the owner revokes the agent's role and the very next swap reverts.
/// The agent doesn't need to cooperate, and an intent it signed earlier is useless too.
contract KillSwitchTest is KusariFixture {
    AgentVault vault;

    function setUp() public {
        _setUpKusari();
        vault = new AgentVault(poolManager, makeAddr("owner"), agent, address(hook));
        currency0.transfer(address(vault), 10e18);
        source.setAuthorized(agent, true);
        source.setPolicy(agent, _policy({maxPerSwap: 1e18, dailyCap: 5e18, maxImpactBps: 300}));
    }

    function _signed(uint256 nonce) internal view returns (SwapIntent memory i, bytes memory sig) {
        i = _intent(agent, address(vault), 0.5e18, nonce);
        sig = _sign(agentPk, i);
    }

    function test_revoke_freezesNextSwap_evenPreSigned() public {
        (SwapIntent memory i0, bytes memory s0) = _signed(0);
        (SwapIntent memory i1, bytes memory s1) = _signed(1); // signed before the revoke

        vm.prank(agent);
        vault.swap(poolKey, i0, s0);

        source.setAuthorized(agent, false); // owner revokes the ENS role

        _expectHookRevert(IHooks.beforeSwap.selector, abi.encodeWithSelector(IPolicyHook.NotAuthorized.selector));
        vm.prank(agent);
        vault.swap(poolKey, i1, s1);
    }

    function test_reauthorize_restoresTrading() public {
        source.setAuthorized(agent, false);
        source.setAuthorized(agent, true);
        (SwapIntent memory i, bytes memory s) = _signed(0);
        vm.prank(agent);
        vault.swap(poolKey, i, s);
        assertEq(currency0.balanceOf(address(vault)), 9.5e18);
    }
}

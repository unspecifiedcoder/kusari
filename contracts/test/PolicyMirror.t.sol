// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";

import {PolicyMirror} from "../src/PolicyMirror.sol";
import {Policy} from "../src/interfaces/PolicyTypes.sol";

contract PolicyMirrorTest is Test {
    PolicyMirror mirror;
    address admin = makeAddr("kusari.mirror.admin");
    address owner = makeAddr("kusari.mirror.owner");
    address agent = makeAddr("kusari.mirror.agent");
    address stranger = makeAddr("kusari.mirror.stranger");

    function setUp() public {
        mirror = new PolicyMirror(admin);
        vm.prank(admin);
        mirror.setPolicy(agent, owner, _p(5e18));
    }

    function _p(uint128 maxPerSwap) internal pure returns (Policy memory) {
        return Policy({maxPerSwap: maxPerSwap, dailyCap: 20e18, maxImpactBps: 200, allowedPool: PoolId.wrap(bytes32(uint256(1))), active: true});
    }

    function test_setPolicy_authorizesAndStores() public view {
        assertTrue(mirror.isAuthorized(agent));
        assertEq(mirror.policyOf(agent).maxPerSwap, 5e18);
        assertEq(mirror.ownerOf(agent), owner);
    }

    /// The gap MockPolicySource had: strangers must not be able to raise limits.
    function test_strangerCannotChangePolicy() public {
        vm.expectRevert(PolicyMirror.OnlyAdmin.selector);
        vm.prank(stranger);
        mirror.setPolicy(agent, stranger, _p(1_000e18));
    }

    function test_agentCannotChangeOwnPolicy() public {
        vm.expectRevert(PolicyMirror.OnlyAdmin.selector);
        vm.prank(agent);
        mirror.setPolicy(agent, agent, _p(1_000e18));
    }

    function test_ownerCanFreeze_withoutAdmin() public {
        vm.prank(owner);
        mirror.freeze(agent);
        assertFalse(mirror.isAuthorized(agent));
    }

    function test_strangerAndAgentCannotFreezeOrUnfreeze() public {
        vm.expectRevert(PolicyMirror.OnlyAdminOrOwner.selector);
        vm.prank(stranger);
        mirror.freeze(agent);

        vm.prank(owner);
        mirror.freeze(agent);
        vm.expectRevert(PolicyMirror.OnlyAdminOrOwner.selector);
        vm.prank(agent);
        mirror.unfreeze(agent);
    }

    function test_adminHandover() public {
        vm.prank(admin);
        mirror.setAdmin(stranger);
        assertEq(mirror.admin(), stranger);
        vm.expectRevert(PolicyMirror.OnlyAdmin.selector);
        vm.prank(admin);
        mirror.setAdmin(admin);
    }
}

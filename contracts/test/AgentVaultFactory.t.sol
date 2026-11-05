// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {KusariFixture} from "./utils/KusariFixture.sol";
import {AgentVault} from "../src/AgentVault.sol";
import {AgentVaultFactory} from "../src/AgentVaultFactory.sol";
import {IAgentVault} from "../src/interfaces/IAgentVault.sol";

contract AgentVaultFactoryTest is KusariFixture {
    AgentVaultFactory factory;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        _setUpKusari();
        factory = new AgentVaultFactory(poolManager, address(hook));
    }

    function test_create_setsOwnerAgentHook_andIndexes() public {
        vm.expectEmit(true, false, true, false, address(factory));
        emit AgentVaultFactory.VaultCreated(alice, address(0), agent);
        vm.prank(alice);
        AgentVault v = factory.create(agent);

        assertEq(v.owner(), alice);
        assertEq(v.agent(), agent);
        assertEq(v.hook(), address(hook));
        assertEq(factory.vaultsOf(alice).length, 1);
        assertEq(factory.vaultsOf(alice)[0], address(v));
    }

    function test_usersCannotTouchEachOthersVaults() public {
        vm.prank(alice);
        AgentVault va = factory.create(agent);
        vm.prank(bob);
        AgentVault vb = factory.create(agent);
        currency0.transfer(address(va), 1e18);

        vm.expectRevert(IAgentVault.OnlyOwner.selector);
        vm.prank(bob);
        va.withdraw(currency0, bob, 1e18);

        assertEq(factory.vaultsOf(bob)[0], address(vb));
        assertTrue(address(va) != address(vb));
    }
}

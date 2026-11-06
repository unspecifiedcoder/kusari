// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {OwnedAgentIsolationForkTest} from "./OwnedAgentIsolation.t.sol";
import {IPermissionedResolverV2} from "./ENSPolicySource.t.sol";
import {OwnedAgentCoordinator} from "../../src/ens/OwnedAgentCoordinator.sol";
import {PersonalAgentVaultFactory} from "../../src/PersonalAgentVaultFactory.sol";
import {AgentVault} from "../../src/AgentVault.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {IENSv2AccessControl} from "../../src/ens/IENSv2.sol";

interface IAtomicRootGrant { function grantRootRoles(uint256 bitmap, address account) external returns (bool); }

/// @notice Inherits the exact two-owner real-swap isolation checks, replacing 6-step setup with ONE create call.
contract AtomicOwnedAgentForkTest is OwnedAgentIsolationForkTest {
    OwnedAgentCoordinator coordinator;
    PersonalAgentVaultFactory personalFactory;

    function _onboard(address owner, address agent, uint256)
        internal override returns (AgentVault vault, IPermissionedResolverV2 resolver, string memory label, bytes memory dns)
    {
        if (address(coordinator) == address(0)) {
            personalFactory = new PersonalAgentVaultFactory(IPoolManager(address(VAULT_FACTORY.poolManager())), address(HOOK));
            coordinator = new OwnedAgentCoordinator(address(REGISTRY), address(SOURCE), address(PROXY_FACTORY), RESOLVER_IMPL,
                address(personalFactory), address(TOKEN0), PoolId.wrap(POOL), hex"0d6b75736172692d7072616d6f640365746800", vm.ensNamehash("kusari-pramod.eth"));
            personalFactory.initializeCoordinator(address(coordinator));
            vm.prank(PARENT_OWNER);
            IAtomicRootGrant(address(REGISTRY)).grantRootRoles(1, address(coordinator));
        }
        vm.deal(owner, 1 ether);
        vm.prank(owner);
        (address v, address r, string memory l) = coordinator.create{value: 0.0001 ether}(agent, 5e18, 100e18, 200);
        vault = AgentVault(payable(v)); resolver = IPermissionedResolverV2(r); label = l;
        dns = SOURCE.bindingOf(agent).dnsName;
    }

    function _startingTokens() internal pure override returns (uint256) { return 25e18; }

    function test_atomicSetup_leavesNoCoordinatorPolicyOrFreezeAuthority() public {
        IENSv2AccessControl access = IENSv2AccessControl(address(REGISTRY));
        uint256 id = uint256(keccak256(bytes(labelA)));
        assertEq(access.roles(0, address(coordinator)), 1); // registrar only, no admin bits
        assertEq(access.roles(id, address(coordinator)), 0); // all temporary label roles moved to owner
        assertFalse(access.hasRoles(id, 1 << 24, address(coordinator)));
        assertEq(REGISTRY.getOwner(id), ownerA);
        assertEq(IENSv2AccessControl(address(resolverA)).roles(0, address(coordinator)), 0);
        assertEq(IENSv2AccessControl(address(resolverA)).roles(0, ownerA), ALL);
        assertEq(address(vaultA.owner()), ownerA);
        assertEq(address(vaultA.agent()), agentA);
        assertEq(agentA.balance, 0.0001 ether);
        assertEq(TOKEN0.balanceOf(address(vaultA)), 25e18);
        assertEq(personalFactory.vaultsOf(ownerA)[0], address(vaultA));
        assertEq(personalFactory.initializer(), address(0));
        vm.startPrank(address(coordinator));
        vm.expectRevert();
        REGISTRY.revokeRoles(id, AUTH, agentA);
        vm.expectRevert();
        resolverA.setData(dnsA, "kusari.policy", hex"1234");
        vm.stopPrank();
    }

    function test_ownerCanEditOwnAtomicPolicy() public {
        bytes memory beforePolicy = abi.encode(SOURCE.policyOf(agentA));
        vm.prank(ownerA);
        resolverA.setData(dnsA, "kusari.policy", beforePolicy);
        assertEq(SOURCE.policyOf(agentA).maxPerSwap, 5e18);
    }

    function test_factoryInitializerCannotBeReused_andCreateForIsRestricted() public {
        vm.expectRevert(PersonalAgentVaultFactory.OnlyInitializer.selector);
        personalFactory.initializeCoordinator(ownerA);
        vm.prank(ownerA);
        vm.expectRevert(PersonalAgentVaultFactory.OnlyCoordinator.selector);
        personalFactory.createFor(ownerA, agentB);
    }

    function test_atomicCreate_rejectsRepeatAndUnboundedGas() public {
        vm.startPrank(ownerA);
        vm.expectRevert(OwnedAgentCoordinator.AlreadyCreated.selector);
        coordinator.create(agentA, 5e18, 100e18, 200);
        vm.expectRevert(OwnedAgentCoordinator.InvalidGasFunding.selector);
        coordinator.create{value: 0.002 ether}(makeAddr("atomic.new.agent"), 5e18, 100e18, 200);
        vm.stopPrank();
    }
}

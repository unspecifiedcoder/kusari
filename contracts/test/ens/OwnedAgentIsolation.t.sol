// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ENSPolicySource} from "../../src/ens/ENSPolicySource.sol";
import {IENSv2AccessControl} from "../../src/ens/IENSv2.sol";
import {OwnedAgentRegistrar, IOwnedNameRegistry} from "../../src/ens/OwnedAgentRegistrar.sol";
import {AgentVaultFactory} from "../../src/AgentVaultFactory.sol";
import {AgentVault} from "../../src/AgentVault.sol";
import {PolicyHook} from "../../src/PolicyHook.sol";
import {Policy, SwapIntent, PolicyTypes} from "../../src/interfaces/PolicyTypes.sol";
import {IAgentVault} from "../../src/interfaces/IAgentVault.sol";
import {IPolicyHook} from "../../src/interfaces/IPolicyHook.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {CustomRevert} from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {IVerifiableFactory, IUserRegistryV2, IPermissionedResolverV2, EACGrant} from "./ENSPolicySource.t.sol";

interface IMintableOwnedToken {
    function mint(address to, uint256 amount) external;
    function balanceOf(address who) external view returns (uint256);
}

interface IRootRoleGrant {
    function grantRootRoles(uint256 roleBitmap, address account) external returns (bool);
}

/// @notice Real ENSv2 + deployed Kusari hook/pool/vault factory on a Sepolia fork. No mock policy source.
contract OwnedAgentIsolationForkTest is Test {
    address constant PARENT_OWNER = 0xc815eDb747e34DA879AFE1a0EF3DF641B4921000;
    IUserRegistryV2 constant REGISTRY = IUserRegistryV2(0x479a0588634C3c20509707D05d95561BC2d5FB36);
    ENSPolicySource constant SOURCE = ENSPolicySource(0x2dAA4eEacfDe394679aaE27e1F554442002b3438);
    AgentVaultFactory constant VAULT_FACTORY = AgentVaultFactory(0xa73BDda27e66A0BfF20d85De8EAf20c0C8EE5370);
    PolicyHook constant HOOK = PolicyHook(0x9C8dfb140ffc368694644783a3f2Ac37B8B400c0);
    IVerifiableFactory constant PROXY_FACTORY = IVerifiableFactory(0xDa70306C98E97eCe36F997a21368e53298572991);
    address constant RESOLVER_IMPL = 0x115eb53F0c60696633855F90b138178Fb40b2b2C;
    IMintableOwnedToken constant TOKEN0 = IMintableOwnedToken(0x218885DEB694Dd7a822B936ca0a214C35C2467Fa);
    address constant TOKEN1 = 0xabD19b8591318cf8EAB1fE106000DDFf0E31d9F0;
    bytes32 constant POOL = 0xa5919e6e4fdea32ead5822ec741ac0dd9e6155c32ec37c9d417452849eb5fc93;
    uint256 constant ALL = 0x1111111111111111111111111111111111111111111111111111111111111111;
    uint256 constant AUTH = 1 << 16;
    uint256 constant AGENT_A_PK = 0x121233987;
    uint256 constant AGENT_B_PK = 0x456763111;
    address ownerA;
    address ownerB;
    address agentA;
    address agentB;
    OwnedAgentRegistrar registrar;
    AgentVault vaultA;
    AgentVault vaultB;
    IPermissionedResolverV2 resolverA;
    IPermissionedResolverV2 resolverB;
    string labelA;
    string labelB;
    bytes dnsA;
    bytes dnsB;

    function setUp() public {
        vm.createSelectFork(vm.envOr("SEPOLIA_RPC_URL", string("https://ethereum-sepolia-rpc.publicnode.com")));
        vm.rollFork(block.number - 8);
        ownerA = makeAddr("kusari.owned.owner.a");
        ownerB = makeAddr("kusari.owned.owner.b");
        agentA = vm.addr(AGENT_A_PK);
        agentB = vm.addr(AGENT_B_PK);
        registrar = new OwnedAgentRegistrar(IOwnedNameRegistry(address(REGISTRY)));
        vm.prank(PARENT_OWNER);
        IRootRoleGrant(address(REGISTRY)).grantRootRoles(1, address(registrar));
        (vaultA, resolverA, labelA, dnsA) = _onboard(ownerA, agentA, 1);
        (vaultB, resolverB, labelB, dnsB) = _onboard(ownerB, agentB, 2);
    }

    function _onboard(address owner, address agent, uint256 salt)
        internal virtual returns (AgentVault vault, IPermissionedResolverV2 resolver, string memory label, bytes memory dns)
    {
        EACGrant[] memory grants = new EACGrant[](1);
        grants[0] = EACGrant(owner, ALL);
        vm.startPrank(owner);
        resolver = IPermissionedResolverV2(PROXY_FACTORY.deployProxy(RESOLVER_IMPL, salt,
            abi.encodeCall(IPermissionedResolverV2.initialize, (grants, new bytes[](0)))));
        label = registrar.claim(agent, address(resolver));
        dns = abi.encodePacked(bytes1(uint8(bytes(label).length)), label, hex"0d6b75736172692d7072616d6f640365746800");
        Policy memory p = Policy(5e18, 100e18, 200, PoolId.wrap(POOL), true);
        resolver.setData(dns, "kusari.policy", abi.encode(p));
        SOURCE.bind(agent, label, dns, vm.ensNamehash(string.concat(label, ".kusari-pramod.eth")));
        REGISTRY.grantRoles(uint256(keccak256(bytes(label))), AUTH, agent);
        vault = VAULT_FACTORY.create(agent);
        TOKEN0.mint(address(vault), 10e18);
        vm.stopPrank();
    }

    function _startingTokens() internal pure virtual returns (uint256) { return 10e18; }

    function _swap(AgentVault vault, uint256 pk, uint256 nonce) internal returns (BalanceDelta) {
        return _performSwap(vault, pk, nonce, false);
    }

    function _performSwap(AgentVault vault, uint256 pk, uint256 nonce, bool expectFailure) internal returns (BalanceDelta) {
        SwapIntent memory intent = SwapIntent(vm.addr(pk), address(vault), PoolId.wrap(POOL), true, 1e18, 1, nonce, block.timestamp + 600);
        bytes32 digest = keccak256(abi.encodePacked(hex"1901", HOOK.domainSeparator(), PolicyTypes.hash(intent)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        PoolKey memory key = PoolKey(Currency.wrap(address(TOKEN0)), Currency.wrap(TOKEN1), 3000, 60, IHooks(address(HOOK)));
        if (expectFailure) vm.expectRevert(abi.encodeWithSelector(
            CustomRevert.WrappedError.selector, address(HOOK), IHooks.beforeSwap.selector,
            abi.encodeWithSelector(IPolicyHook.NotAuthorized.selector), abi.encodeWithSelector(Hooks.HookCallFailed.selector)
        ));
        vm.prank(vm.addr(pk));
        return vault.swap(key, intent, abi.encodePacked(r, s, v));
    }

    function test_freezeA_doesNotAffectB_andRestoreA() public {
        assertGt(_swap(vaultA, AGENT_A_PK, 0).amount1(), 0);
        assertGt(_swap(vaultB, AGENT_B_PK, 0).amount1(), 0);
        vm.prank(ownerA);
        REGISTRY.revokeRoles(uint256(keccak256(bytes(labelA))), AUTH, agentA);
        assertFalse(SOURCE.isAuthorized(agentA));
        assertTrue(SOURCE.isAuthorized(agentB));
        // A's attempted swap reaches the real Uniswap hook and reverts; B still executes.
        _performSwap(vaultA, AGENT_A_PK, 1, true);
        assertGt(_swap(vaultB, AGENT_B_PK, 1).amount1(), 0);
        assertEq(TOKEN0.balanceOf(address(vaultA)), _startingTokens() - 1e18);
        assertEq(TOKEN0.balanceOf(address(vaultB)), _startingTokens() - 2e18);
        assertEq(HOOK.spentOn(agentA, block.timestamp / 1 days), 1e18);
        assertEq(HOOK.spentOn(agentB, block.timestamp / 1 days), 2e18);
        vm.prank(ownerA);
        REGISTRY.grantRoles(uint256(keccak256(bytes(labelA))), AUTH, agentA);
        assertGt(_swap(vaultA, AGENT_A_PK, 1).amount1(), 0);
    }

    function test_ownerA_cannotFreezeOrEditOrWithdrawB() public {
        vm.startPrank(ownerA);
        vm.expectRevert();
        REGISTRY.revokeRoles(uint256(keccak256(bytes(labelB))), AUTH, agentB);
        vm.expectRevert();
        resolverB.setData(dnsB, "kusari.policy", abi.encode(Policy(100e18, 1000e18, 10000, PoolId.wrap(POOL), true)));
        vm.expectRevert(ENSPolicySource.NotNameOwner.selector);
        SOURCE.bind(agentB, labelA, dnsA, bytes32(0));
        vm.expectRevert(IAgentVault.OnlyOwner.selector);
        vaultB.withdraw(Currency.wrap(address(TOKEN0)), ownerA, 1e18);
        vm.stopPrank();
        assertTrue(SOURCE.isAuthorized(agentB));
        assertEq(SOURCE.policyOf(agentB).maxPerSwap, 5e18);
    }

    function test_registrar_hasOnlyRegister_andCannotControlClaimedNames() public {
        // No registrar ownership/admin was retained after a direct-to-user registration.
        assertEq(IENSv2AccessControl(address(REGISTRY)).roles(0, address(registrar)), 1);
        assertEq(REGISTRY.getOwner(uint256(keccak256(bytes(labelA)))), ownerA);
        assertTrue(keccak256(bytes(labelA)) != keccak256(bytes(labelB)));
        vm.prank(address(registrar));
        vm.expectRevert();
        REGISTRY.revokeRoles(uint256(keccak256(bytes(labelA))), AUTH, agentA);
        vm.prank(ownerA);
        vm.expectRevert();
        registrar.claim(agentA, address(resolverA));
    }

    function test_invalidAgentAndResolverAreRejected() public {
        vm.startPrank(ownerA);
        vm.expectRevert(OwnedAgentRegistrar.InvalidAgent.selector);
        registrar.claim(address(0), address(resolverA));
        vm.expectRevert(OwnedAgentRegistrar.InvalidAgent.selector);
        registrar.claim(ownerA, address(resolverA));
        vm.expectRevert(OwnedAgentRegistrar.InvalidResolver.selector);
        registrar.claim(agentA, address(0));
        vm.stopPrank();
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";

import {ENSPolicySource} from "../../src/ens/ENSPolicySource.sol";
import {Policy} from "../../src/interfaces/PolicyTypes.sol";
import {MockDataResolver} from "./mocks/MockDataResolver.sol";

interface IETHRegistryV2 {
    function register(
        string calldata label,
        address owner,
        address registry,
        address resolver,
        uint256 roleBitmap,
        uint64 expiry
    ) external returns (uint256 tokenId);
    function grantRoles(uint256 anyId, uint256 roleBitmap, address account) external returns (bool);
    function revokeRoles(uint256 anyId, uint256 roleBitmap, address account) external returns (bool);
}

/// Runs ENSPolicySource against the REAL ENSv2 ETHRegistry on a Sepolia fork:
/// real registration, real EnhancedAccessControl role grants and revokes.
contract ENSPolicySourceForkTest is Test {
    IETHRegistryV2 constant ETH_REGISTRY = IETHRegistryV2(0xD4eBcbBdF463C9c45784603Db0dDD499BC44A8B4);
    address constant ETH_REGISTRAR = 0xf633e7FC17e2bbE0D0965D18ec1821dcB754a3d3;

    uint256 constant ROLE_RENEW = 1 << 16;
    uint256 constant ROLE_SET_RESOLVER = 1 << 24;
    uint256 constant ADMIN = 128; // admin role = role << 128

    string constant LABEL = "kusari-forktest";
    uint256 labelId = uint256(keccak256(bytes(LABEL)));
    bytes32 node = keccak256("alpha.kusari-forktest.eth"); // any stable node works for the resolver record

    // Unique labels: well-known ones like makeAddr("owner") have public keys and may carry code on Sepolia.
    address owner = makeAddr("kusari.ens.fork.owner");
    address agent = makeAddr("kusari.ens.fork.agent");

    ENSPolicySource source;
    MockDataResolver resolver;
    Policy policy;

    function setUp() public {
        vm.createSelectFork(vm.envOr("SEPOLIA_RPC_URL", string("https://ethereum-sepolia-rpc.publicnode.com")));
        // public RPCs are load-balanced; pin a few blocks back so every backend has the state
        vm.rollFork(block.number - 8);
        vm.etch(owner, "");
        vm.etch(agent, "");
        source = new ENSPolicySource();
        resolver = new MockDataResolver();

        // Register a throwaway name the way the ETHRegistrar would.
        uint256 ownerRoles =
            ROLE_RENEW | (ROLE_RENEW << ADMIN) | ROLE_SET_RESOLVER | (ROLE_SET_RESOLVER << ADMIN);
        vm.prank(ETH_REGISTRAR);
        ETH_REGISTRY.register(LABEL, owner, address(0), address(resolver), ownerRoles, uint64(block.timestamp + 365 days));

        policy = Policy({
            maxPerSwap: 5e18,
            dailyCap: 20e18,
            maxImpactBps: 200,
            allowedPool: PoolId.wrap(keccak256("pool")),
            active: true
        });
        resolver.setData(node, source.POLICY_KEY(), abi.encode(policy));

        vm.startPrank(owner);
        source.bind(agent, address(ETH_REGISTRY), LABEL, node);
        ETH_REGISTRY.grantRoles(labelId, ROLE_RENEW, agent);
        vm.stopPrank();
    }

    function test_authorizedAgent_readsPolicyFromENS() public view {
        assertTrue(source.isAuthorized(agent));
        Policy memory p = source.policyOf(agent);
        assertEq(p.maxPerSwap, 5e18);
        assertEq(p.dailyCap, 20e18);
        assertEq(p.maxImpactBps, 200);
        assertEq(PoolId.unwrap(p.allowedPool), keccak256("pool"));
        assertTrue(p.active);
    }

    /// The kill switch: one revokeRoles on the real ENSv2 registry.
    function test_revokeRole_deauthorizesImmediately() public {
        vm.prank(owner);
        ETH_REGISTRY.revokeRoles(labelId, ROLE_RENEW, agent);
        assertFalse(source.isAuthorized(agent));
    }

    /// Fail-safe: an agent able to repoint its own resolver could raise its own limits.
    function test_agentWithResolverPower_isNotAuthorized() public {
        vm.prank(owner);
        ETH_REGISTRY.grantRoles(labelId, ROLE_SET_RESOLVER, agent);
        assertFalse(source.isAuthorized(agent));
    }

    /// Approved operators inherit the owner's roles, so an approved agent is caught by the fail-safe too.
    function test_agentApprovedAsOperator_isNotAuthorized() public {
        vm.prank(owner);
        (bool ok,) = address(ETH_REGISTRY).call(abi.encodeWithSignature("setApprovalForAll(address,bool)", agent, true));
        assertTrue(ok);
        assertFalse(source.isAuthorized(agent));
    }

    function test_onlyNameOwnerCanBind() public {
        vm.expectRevert(ENSPolicySource.NotNameOwner.selector);
        vm.prank(makeAddr("stranger"));
        source.bind(makeAddr("otherAgent"), address(ETH_REGISTRY), LABEL, node);
    }

    function test_unboundAgent_isInactive() public {
        address nobody = makeAddr("nobody");
        assertFalse(source.isAuthorized(nobody));
        assertFalse(source.policyOf(nobody).active);
    }

    function test_editLimitsInENS_takesEffectImmediately() public {
        policy.maxPerSwap = 1e18;
        resolver.setData(node, source.POLICY_KEY(), abi.encode(policy));
        assertEq(source.policyOf(agent).maxPerSwap, 1e18);
    }
}

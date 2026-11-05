// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";

import {ENSPolicySource} from "../../src/ens/ENSPolicySource.sol";
import {Policy} from "../../src/interfaces/PolicyTypes.sol";

interface IVerifiableFactory {
    function deployProxy(address implementation, uint256 salt, bytes calldata data) external returns (address);
}

struct EACGrant {
    address account;
    uint256 roleBitmap;
}

interface IUserRegistryV2 {
    function initialize(EACGrant[] calldata grants) external;
    function register(string calldata label, address owner, address registry, address resolver, uint256 roleBitmap, uint64 expiry)
        external
        returns (uint256);
    function grantRoles(uint256 anyId, uint256 roleBitmap, address account) external returns (bool);
    function revokeRoles(uint256 anyId, uint256 roleBitmap, address account) external returns (bool);
    function getResolver(string calldata label) external view returns (address);
    function getOwner(uint256 anyId) external view returns (address);
}

interface IPermissionedResolverV2 {
    function initialize(EACGrant[] calldata grants, bytes[] calldata calls) external;
    function setData(bytes calldata name, string calldata key, bytes calldata value) external;
}

/// The attacker-controlled "registry + resolver" from the auditor's proof of concept.
contract FakeENS {
    address immutable who;

    constructor(address w) {
        who = w;
    }

    function getOwner(uint256) external view returns (address) {
        return who;
    }

    function hasRoles(uint256, uint256 bm, address) external pure returns (bool) {
        return bm == (1 << 16);
    }

    function roles(uint256, address) external pure returns (uint256) {
        return 1 << 16;
    }
}

/// Runs ENSPolicySource against the REAL live ENSv2 contracts on a Sepolia fork, exactly as the live setup will:
/// our own UserRegistry + PermissionedResolver proxies from ENS's VerifiableFactory, real roles, real records.
contract ENSPolicySourceForkTest is Test {
    IVerifiableFactory constant FACTORY = IVerifiableFactory(0xDa70306C98E97eCe36F997a21368e53298572991);
    address constant USER_REGISTRY_IMPL = 0x9BD8a88719068D09ecee662f36C0E3856708366a;
    address constant RESOLVER_IMPL = 0x115eb53F0c60696633855F90b138178Fb40b2b2C;

    uint256 constant ALL = 0x1111111111111111111111111111111111111111111111111111111111111111;
    uint256 constant ROLE_RENEW = 1 << 16;
    uint256 constant ROLE_SET_RESOLVER = 1 << 24;

    // "alpha.kusari-demo.eth"
    bytes constant DNS_NAME = hex"05616c7068610b6b75736172692d64656d6f0365746800";
    string constant LABEL = "alpha";
    uint256 labelId = uint256(keccak256(bytes(LABEL)));
    bytes32 node;

    // Unique labels: well-known ones like makeAddr("owner") have public keys and may carry code on Sepolia.
    address owner = makeAddr("kusari.ens.fork.owner");
    address agent = makeAddr("kusari.ens.fork.agent");

    ENSPolicySource source;
    IUserRegistryV2 registry;
    IPermissionedResolverV2 resolver;
    Policy policy;

    function setUp() public {
        vm.createSelectFork(vm.envOr("SEPOLIA_RPC_URL", string("https://ethereum-sepolia-rpc.publicnode.com")));
        vm.rollFork(block.number - 8); // load-balanced RPCs: pin a few blocks back
        vm.etch(owner, "");
        vm.etch(agent, "");
        node = vm.ensNamehash("alpha.kusari-demo.eth");

        EACGrant[] memory grants = new EACGrant[](1);
        grants[0] = EACGrant(owner, ALL);
        vm.startPrank(owner);
        registry = IUserRegistryV2(
            FACTORY.deployProxy(USER_REGISTRY_IMPL, uint256(keccak256("kusari.fork.registry")), abi.encodeCall(IUserRegistryV2.initialize, (grants)))
        );
        resolver = IPermissionedResolverV2(
            FACTORY.deployProxy(
                RESOLVER_IMPL,
                uint256(keccak256("kusari.fork.resolver")),
                abi.encodeCall(IPermissionedResolverV2.initialize, (grants, new bytes[](0)))
            )
        );

        registry.register(LABEL, owner, address(0), address(resolver), ALL, uint64(block.timestamp + 365 days));
        source = new ENSPolicySource(address(registry)); // pinned trust root

        policy = Policy({maxPerSwap: 5e18, dailyCap: 20e18, maxImpactBps: 200, allowedPool: PoolId.wrap(keccak256("pool")), active: true});
        resolver.setData(DNS_NAME, source.POLICY_KEY(), abi.encode(policy));

        source.bind(agent, LABEL, DNS_NAME, node);
        registry.grantRoles(labelId, ROLE_RENEW, agent);
        vm.stopPrank();
    }

    function test_realResolver_readsPolicyViaResolve() public view {
        assertEq(registry.getResolver(LABEL), address(resolver));
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
        registry.revokeRoles(labelId, ROLE_RENEW, agent);
        assertFalse(source.isAuthorized(agent));
    }

    /// Fail-safe: an agent able to repoint its own resolver could raise its own limits.
    function test_agentWithResolverPower_isNotAuthorized() public {
        vm.prank(owner);
        registry.grantRoles(labelId, ROLE_SET_RESOLVER, agent);
        assertFalse(source.isAuthorized(agent));
    }

    /// Approved operators inherit the owner's roles, so an approved agent is caught by the fail-safe too.
    function test_agentApprovedAsOperator_isNotAuthorized() public {
        vm.prank(owner);
        (bool ok,) = address(registry).call(abi.encodeWithSignature("setApprovalForAll(address,bool)", agent, true));
        assertTrue(ok);
        assertFalse(source.isAuthorized(agent));
    }

    function test_onlyNameOwnerCanBind() public {
        vm.expectRevert(ENSPolicySource.NotNameOwner.selector);
        vm.prank(makeAddr("kusari.ens.fork.stranger"));
        source.bind(makeAddr("kusari.ens.fork.other"), LABEL, DNS_NAME, node);
    }

    function test_unboundAgent_isInactive() public {
        address nobody = makeAddr("kusari.ens.fork.nobody");
        assertFalse(source.isAuthorized(nobody));
        assertFalse(source.policyOf(nobody).active);
    }

    function test_editLimitsInENS_takesEffectImmediately() public {
        policy.maxPerSwap = 1e18;
        string memory key = source.POLICY_KEY(); // read first: an external call would consume the prank
        vm.prank(owner);
        resolver.setData(DNS_NAME, key, abi.encode(policy));
        assertEq(source.policyOf(agent).maxPerSwap, 1e18);
    }

    // ---- regression: the readiness review's bind() bypass ----

    /// The agent (with its stolen key) tries to re-bind itself. The registry is pinned, and the agent
    /// owns no label in it, so it cannot. Its real binding and the kill switch stay intact.
    function test_agentCannotRebindItself() public {
        vm.prank(agent);
        vm.expectRevert(ENSPolicySource.NotNameOwner.selector);
        source.bind(agent, LABEL, DNS_NAME, node);
        assertEq(source.bindingOf(agent).node, node);
    }

    /// A stranger can't re-point (and so grief-freeze) somebody else's agent.
    function test_strangerCannotRebindAnAgent() public {
        vm.prank(makeAddr("kusari.ens.fork.stranger"));
        vm.expectRevert(ENSPolicySource.NotNameOwner.selector);
        source.bind(agent, "other", DNS_NAME, node);
        assertTrue(source.isAuthorized(agent));
    }

    /// The source ignores any registry but the pinned one: a fake "registry" that lies about owners,
    /// roles and policy has no effect, because it's never consulted.
    function test_fakeRegistryIsNeverConsulted() public {
        FakeENS fake = new FakeENS(agent);
        assertTrue(source.registry() == address(registry));
        assertTrue(address(fake) != source.registry());
        // the only state the source reads is the pinned registry's:
        vm.prank(owner);
        registry.revokeRoles(labelId, ROLE_RENEW, agent);
        assertFalse(source.isAuthorized(agent));
    }

    /// Exactly the marker role: an agent that holds anything else on the label is not authorized.
    /// (ENSv2 itself refuses to grant admin roles after registration: EACCannotGrantRoles.)
    function test_agentWithExtraRole_isNotAuthorized() public {
        vm.prank(owner);
        registry.grantRoles(labelId, 1 << 36, agent); // ROLE_SET_URI
        assertFalse(source.isAuthorized(agent));
    }

    function test_adminRolesCannotBeGrantedAfterRegistration() public {
        vm.prank(owner);
        vm.expectRevert();
        registry.grantRoles(labelId, ROLE_RENEW << 128, agent);
    }

    function test_agentCannotWriteItsOwnPolicy() public {
        policy.maxPerSwap = 1_000e18;
        string memory key = source.POLICY_KEY();
        vm.prank(agent);
        vm.expectRevert();
        resolver.setData(DNS_NAME, key, abi.encode(policy));
    }
}
